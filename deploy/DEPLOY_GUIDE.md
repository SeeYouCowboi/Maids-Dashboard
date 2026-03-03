# Maids Dashboard 生产环境部署指南

适用于 Ubuntu 20.04 / 22.04 LTS + Nginx + systemd。

---

## 架构概述

```
Windows（开发）             服务器（生产）
─────────────────           ──────────────────────────────
deploy/packaging.ps1        deploy/deploy.sh
  ├── npm run build          ├── 解压预构建产物
  ├── 复制 static/           ├── pip install (Python 虚拟环境)
  └── 打包 ZIP               ├── Nginx 代理 /api/ → uvicorn :18889
                             └── systemd 管理 Python 进程
```

**服务器不需要 Node.js**。前端在 Windows 端预构建，打包进 ZIP 后直接部署。

---

## 一、Windows 端打包

### 快速打包（推荐）

```powershell
# 完整构建并打包（会询问服务器 IP 用于 API 配置）
.\deploy\packaging.ps1

# 指定 IP 一步到位，自动配置 API 地址
.\deploy\packaging.ps1 -ServerIP "1.2.3.4"

# 构建 + 打包 + 自动上传
.\deploy\packaging.ps1 -ServerIP "1.2.3.4" -ServerUser "root"

# 跳过构建（已有构建产物时）
.\deploy\packaging.ps1 -SkipBuild

# 同时生成 tar.gz（需要 Git for Windows）
.\deploy\packaging.ps1 -CreateTar
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `-ServerIP` | 服务器公网 IP，配置前端的 API 地址；留空则使用相对路径 `/api`（Nginx 代理） |
| `-ServerUser` | SSH 用户名（默认 `root`） |
| `-SkipBuild` | 跳过 npm install + npm run build |
| `-SkipUpload` | 不上传，仅生成本地 ZIP |
| `-CreateTar` | 额外生成 tar.gz 格式 |

输出文件：`maids-dashboard_YYYYMMDD_HHmmss.zip`

---

## 二、服务器端部署

### 首次部署

```bash
# 1. 上传文件到服务器
scp maids-dashboard_*.zip root@服务器IP:/root/
scp deploy/deploy.sh root@服务器IP:/root/

# 2. 登录服务器执行
ssh root@服务器IP
bash /root/deploy.sh
```

### 增量更新

```bash
# 重新打包上传后，重新执行 deploy.sh
# 脚本会自动检测已有部署，执行备份后更新
bash /root/deploy.sh
```

脚本自动完成：
1. 安装 Python / Nginx 依赖
2. **备份数据库**到 `/opt/maids-dashboard-backup-时间戳/`
3. 停止服务，解压新代码（`data/` `logs/` `.env` 不会被覆盖）
4. 更新 Python 虚拟环境
5. 复制预构建静态文件到 `/var/www/maids-dashboard/`
6. 配置 Nginx + systemd，重启服务

---

## 三、服务管理

```bash
# 查看日志（实时）
journalctl -u maids-dashboard -f

# 服务状态
systemctl status maids-dashboard

# 重启后端
systemctl restart maids-dashboard

# 重启 Nginx
systemctl restart nginx

# 数据库备份
cp /opt/maids-dashboard/data/dashboard.db ~/backup-$(date +%Y%m%d).db
```

---

## 四、常见问题

### 502 Bad Gateway
```bash
systemctl status maids-dashboard
journalctl -u maids-dashboard --since "5 min ago"
curl http://127.0.0.1:18889/api/v1/health
```

### 前端 JS/CSS 404
```bash
ls /var/www/maids-dashboard/assets/
# 若为空，检查打包时前端是否构建成功（packaging.ps1 步骤 3）
```

### API 返回 404
```bash
# 确认 Nginx 代理配置
grep proxy_pass /etc/nginx/sites-available/maids-dashboard
nginx -t && systemctl reload nginx
```

### 回滚
```bash
# 找到最近备份目录
ls /opt/maids-dashboard-backup-*/

# 恢复数据库
BACKUP=/opt/maids-dashboard-backup-20260304-120000
systemctl stop maids-dashboard
cp "$BACKUP/dashboard.db" /opt/maids-dashboard/data/
systemctl start maids-dashboard
```

---

## 五、目录结构（服务器）

```
/opt/maids-dashboard/          # 应用目录
  ├── dashboard_backend.py
  ├── api/ core/ services/ ...
  ├── static/                  # 构建产物（原样保留，非 serve 目录）
  ├── venv/                    # Python 虚拟环境
  ├── data/dashboard.db        # 数据库（更新时保留）
  ├── logs/                    # 日志（更新时保留）
  └── .env                     # 环境变量（更新时保留）

/var/www/maids-dashboard/      # Nginx 实际 serve 目录
  ├── index.html
  └── assets/

/etc/systemd/system/maids-dashboard.service
/etc/nginx/sites-available/maids-dashboard
```

---

**文档版本**: 2.0
**适用系统**: Ubuntu 20.04 / 22.04 LTS
**进程管理**: systemd（无需 Node.js / PM2）
**最后更新**: 2026-03-04
