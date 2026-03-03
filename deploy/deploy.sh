#!/bin/bash
# =====================================================
# Maids Dashboard 一键部署/更新脚本
# 适用于 Ubuntu 20.04 / 22.04 LTS
# 进程管理：systemd（无需 Node.js / PM2）
# =====================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Maids Dashboard 部署/更新脚本${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}请使用 root 权限运行: sudo bash deploy.sh${NC}"
    exit 1
fi

APP_DIR="/opt/maids-dashboard"
BACKEND_PORT=18889
STATIC_DIR="/var/www/maids-dashboard"
SERVICE_NAME="maids-dashboard"

# 检测公网 IP（多云兼容）
SERVER_IP=$(curl -sf --max-time 3 http://metadata.tencentyun.com/latest/meta-data/public-ipv4 2>/dev/null \
         || curl -sf --max-time 3 http://100.100.100.200/latest/meta-data/eipv4-ipv4 2>/dev/null \
         || curl -sf --max-time 3 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null \
         || hostname -I | awk '{print $1}')

# 检测是否为更新模式
IS_UPDATE=false
if [ -d "$APP_DIR" ] && [ -f "$APP_DIR/dashboard_backend.py" ]; then
    IS_UPDATE=true
    echo -e "${BLUE}ℹ 检测到已有部署，将执行更新操作${NC}"
fi

# =====================================================
# 1. 安装系统依赖
# =====================================================
echo -e "${YELLOW}[1/6] 安装系统依赖...${NC}"
apt-get update -q
apt-get install -y python3 python3-pip python3-venv nginx curl unzip
echo -e "${GREEN}✓ 依赖安装完成${NC}"

# =====================================================
# 2. 备份 / 停止服务（更新模式）
# =====================================================
if [ "$IS_UPDATE" = true ]; then
    echo -e "${YELLOW}[2/6] 备份现有数据并停止服务...${NC}"

    BACKUP_DIR="/opt/maids-dashboard-backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"

    [ -f "$APP_DIR/data/dashboard.db" ] && cp "$APP_DIR/data/dashboard.db" "$BACKUP_DIR/" \
        && echo -e "${BLUE}  数据库已备份: $BACKUP_DIR/dashboard.db${NC}"
    [ -f "$APP_DIR/.env" ] && cp "$APP_DIR/.env" "$BACKUP_DIR/"

    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    echo -e "${GREEN}✓ 备份完成: $BACKUP_DIR${NC}"
else
    echo -e "${YELLOW}[2/6] 首次部署，跳过备份...${NC}"
    mkdir -p "$APP_DIR"
fi

# =====================================================
# 3. 解压代码
# =====================================================
echo -e "${YELLOW}[3/6] 解压代码...${NC}"

EXTRACT_TO=$(mktemp -d)

if [ -f "/root/maids-dashboard.tar.gz" ]; then
    tar -xzf /root/maids-dashboard.tar.gz -C "$EXTRACT_TO"
elif ls /root/maids-dashboard*.zip 2>/dev/null | head -1 | grep -q .; then
    ZIPFILE=$(ls -t /root/maids-dashboard*.zip | head -1)
    echo -e "${BLUE}  使用: $ZIPFILE${NC}"
    unzip -q -o "$ZIPFILE" -d "$EXTRACT_TO"
else
    echo -e "${RED}错误：/root/ 下未找到代码压缩包 (maids-dashboard.tar.gz 或 *.zip)${NC}"
    rm -rf "$EXTRACT_TO"
    exit 1
fi

# 处理打包时可能产生的嵌套目录
SRC="$EXTRACT_TO"
if [ ! -f "$SRC/dashboard_backend.py" ]; then
    SUBDIR=$(find "$SRC" -maxdepth 2 -name "dashboard_backend.py" -type f | head -1 | xargs -r dirname)
    [ -n "$SUBDIR" ] && SRC="$SUBDIR"
fi

# 覆盖部署（data/ logs/ .env 不在包内，不会被覆盖）
cp -a "$SRC/." "$APP_DIR/"
rm -rf "$EXTRACT_TO"

echo -e "${GREEN}✓ 代码解压完成${NC}"

# =====================================================
# 4. 部署后端
# =====================================================
echo -e "${YELLOW}[4/6] 部署后端...${NC}"
cd "$APP_DIR"

# 虚拟环境
if [ -d "$APP_DIR/venv" ]; then
    echo -e "${BLUE}  更新虚拟环境...${NC}"
    "$APP_DIR/venv/bin/pip" install -q --upgrade pip
    "$APP_DIR/venv/bin/pip" install -q -e . --force-reinstall
else
    echo -e "${BLUE}  创建虚拟环境...${NC}"
    python3 -m venv venv
    "$APP_DIR/venv/bin/pip" install -q --upgrade pip
    "$APP_DIR/venv/bin/pip" install -q -e .
fi

mkdir -p "$APP_DIR/data" "$APP_DIR/logs"
chmod 755 "$APP_DIR/data"

# openclaw 状态目录（events.jsonl）
mkdir -p /root/.openclaw/workspace/maids/state
touch /root/.openclaw/workspace/maids/state/events.jsonl

# 环境变量文件（已有则保留）
if [ ! -f "$APP_DIR/.env" ]; then
    cat > "$APP_DIR/.env" << EOF
DASHBOARD_BIND_HOST=0.0.0.0
DASHBOARD_PORT=$BACKEND_PORT
DASHBOARD_DB_PATH=$APP_DIR/data/dashboard.db
EOF
    echo -e "${BLUE}  创建 .env 配置文件${NC}"
else
    echo -e "${BLUE}  保留现有 .env 配置文件${NC}"
fi

echo -e "${GREEN}✓ 后端部署完成${NC}"

# =====================================================
# 5. 部署前端静态文件
# =====================================================
echo -e "${YELLOW}[5/6] 部署前端静态文件...${NC}"

if [ ! -d "$APP_DIR/static" ] || [ -z "$(ls -A "$APP_DIR/static" 2>/dev/null)" ]; then
    echo -e "${RED}错误：包内 static/ 目录为空，前端未预构建。请在 Windows 端重新打包。${NC}"
    exit 1
fi

mkdir -p "$STATIC_DIR"
rm -rf "${STATIC_DIR:?}"/*
cp -r "$APP_DIR/static/." "$STATIC_DIR/"
echo -e "${GREEN}✓ 静态文件已部署到 $STATIC_DIR${NC}"

# =====================================================
# 6. 配置 Nginx
# =====================================================
echo -e "${YELLOW}[6/6] 配置服务...${NC}"

cat > /etc/nginx/sites-available/maids-dashboard << 'NGINXCONF'
server {
    listen 80;
    server_name _;

    # 静态资源长缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        root /var/www/maids-dashboard;
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # 后端 API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:18889/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
    }

    # SPA 前端（所有未匹配路径返回 index.html）
    location / {
        root /var/www/maids-dashboard;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # 健康检查
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml+rss;
}
NGINXCONF

ln -sf /etc/nginx/sites-available/maids-dashboard /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
systemctl enable nginx

# systemd 服务
cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=Maids Dashboard API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/venv/bin/python3 dashboard_backend.py
Restart=always
RestartSec=5
StandardOutput=append:$APP_DIR/logs/out.log
StandardError=append:$APP_DIR/logs/err.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# 防火墙
if command -v ufw &>/dev/null; then
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable 2>/dev/null || true
fi

echo -e "${GREEN}✓ 服务配置完成${NC}"

# =====================================================
# 验证
# =====================================================
echo ""
echo -e "${YELLOW}验证部署...${NC}"
sleep 3

echo ""
echo "=== 服务状态 ==="
systemctl status "$SERVICE_NAME" --no-pager -l | head -20

echo ""
echo "=== 端口监听 ==="
ss -tlnp | grep -E '(80|18889)' || true

echo ""
echo "=== API 测试 ==="
curl -sf http://127.0.0.1:18889/api/v1/health 2>/dev/null || echo "API 未就绪（可能需要更长启动时间）"

echo ""
echo "=== 前端页面测试 ==="
curl -s -o /dev/null -w "首页: %{http_code}\n" http://127.0.0.1/

echo ""
echo -e "${GREEN}========================================${NC}"
if [ "$IS_UPDATE" = true ]; then
    echo -e "${GREEN}  更新完成！${NC}"
    echo -e "${BLUE}  数据备份: $BACKUP_DIR${NC}"
else
    echo -e "${GREEN}  部署完成！${NC}"
fi
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "访问地址: ${YELLOW}http://$SERVER_IP${NC}"
echo ""
echo "常用命令:"
echo -e "  查看日志:  ${YELLOW}journalctl -u $SERVICE_NAME -f${NC}"
echo -e "  重启服务:  ${YELLOW}systemctl restart $SERVICE_NAME${NC}"
echo -e "  服务状态:  ${YELLOW}systemctl status $SERVICE_NAME${NC}"
echo -e "  重启 Nginx: ${YELLOW}systemctl restart nginx${NC}"
echo ""
