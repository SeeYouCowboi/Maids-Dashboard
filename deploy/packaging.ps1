# =====================================================
# Maids Dashboard Windows 自动打包脚本
# 用于打包项目并准备上传到云服务器部署
# =====================================================

#Requires -Version 5.1

[CmdletBinding()]
param(
    [string]$OutputName = "maids-dashboard",
    [string]$ServerIP = "",
    [string]$ServerUser = "root",
    [switch]$SkipBuild,
    [switch]$SkipUpload,
    [switch]$CreateTar
)

# 错误处理
$ErrorActionPreference = "Stop"

# 颜色输出函数
function Write-ColorOutput {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Message,
        [string]$Color = "White"
    )
    $originalColor = $Host.UI.RawUI.ForegroundColor
    $Host.UI.RawUI.ForegroundColor = $Color
    Write-Host $Message
    $Host.UI.RawUI.ForegroundColor = $originalColor
}

function Write-Success { param([string]$Message) Write-ColorOutput -Message "✓ $Message" -Color Green }
function Write-Info { param([string]$Message) Write-ColorOutput -Message "ℹ $Message" -Color Cyan }
function Write-Warning { param([string]$Message) Write-ColorOutput -Message "⚠ $Message" -Color Yellow }
function Write-Error { param([string]$Message) Write-ColorOutput -Message "✗ $Message" -Color Red }

# 获取脚本所在目录
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
Set-Location $ProjectRoot

Write-Host ""
Write-ColorOutput -Message "========================================" -Color Green
Write-ColorOutput -Message "  Maids Dashboard Windows 打包脚本" -Color Green
Write-ColorOutput -Message "========================================" -Color Green
Write-Host ""
Write-Info "项目目录: $ProjectRoot"
Write-Host ""

# =====================================================
# 步骤 1: 清理开发环境文件
# =====================================================
Write-ColorOutput -Message "[1/6] 清理开发环境文件..." -Color Yellow

$itemsToRemove = @(
    "node_modules"
    ".venv"
    "venv"
    "__pycache__"
    ".pytest_cache"
    ".mypy_cache"
    ".tox"
    "*.pyc"
    "*.pyo"
    "*.egg-info"
    "dist"
    "build"
    "frontend\dist"
    "frontend\node_modules"
    "static\assets"
    "*.log"
    "*.zip"
    "*.tar.gz"
)

$removedCount = 0
foreach ($pattern in $itemsToRemove) {
    $items = Get-ChildItem -Path $ProjectRoot -Filter $pattern -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($item in $items) {
        try {
            if ($item.PSIsContainer) {
                Remove-Item -Path $item.FullName -Recurse -Force -ErrorAction SilentlyContinue
            } else {
                Remove-Item -Path $item.FullName -Force -ErrorAction SilentlyContinue
            }
            $removedCount++
        } catch {
            Write-Warning "无法删除: $($item.FullName)"
        }
    }
}

# 删除 .git 目录
$gitDir = Join-Path $ProjectRoot ".git"
if (Test-Path $gitDir) {
    Remove-Item -Path $gitDir -Recurse -Force -ErrorAction SilentlyContinue
    $removedCount++
}

Write-Success "清理完成 (删除了 $removedCount 个项目)"

# =====================================================
# 步骤 2: 检查并安装 Node.js 依赖
# =====================================================
if (-not $SkipBuild) {
    Write-ColorOutput -Message "[2/6] 安装前端依赖..." -Color Yellow
    
    $frontendDir = Join-Path $ProjectRoot "frontend"
    if (-not (Test-Path $frontendDir)) {
        Write-Error "未找到 frontend 目录"
        exit 1
    }
    
    # 检查 Node.js
    try {
        $nodeVersion = node --version 2>$null
        Write-Info "Node.js 版本: $nodeVersion"
    } catch {
        Write-Error "未检测到 Node.js，请先安装 Node.js 20+"
        Write-Info "下载地址: https://nodejs.org/"
        exit 1
    }
    
    # 安装依赖
    Set-Location $frontendDir
    
    # 设置 npm 镜像（可选，加速国内下载）
    # npm config set registry https://registry.npmmirror.com
    
    Write-Info "正在安装 npm 依赖，请稍候..."
    npm install 2>&1 | ForEach-Object {
        if ($_ -match "ERR!" -or $_ -match "error") {
            Write-Error $_
        } elseif ($_ -match "WARN") {
            Write-Warning $_
        }
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm install 失败"
        exit 1
    }
    
    Write-Success "前端依赖安装完成"
} else {
    Write-ColorOutput -Message "[2/6] 跳过前端依赖安装 (--SkipBuild)" -Color Gray
}

# =====================================================
# 步骤 3: 构建前端
# =====================================================
if (-not $SkipBuild) {
    Write-ColorOutput -Message "[3/6] 构建前端项目..." -Color Yellow
    
    # 获取服务器 IP 用于配置 API 地址
    if (-not $ServerIP) {
        $ServerIP = Read-Host "请输入服务器公网 IP 地址（用于配置 API，直接回车则使用相对路径）"
    }
    
    # 创建生产环境配置文件
    $envFile = Join-Path $frontendDir ".env.production"
    if ($ServerIP) {
        $apiUrl = "http://$($ServerIP):18889"
        "VITE_API_BASE_URL=$apiUrl" | Out-File -FilePath $envFile -Encoding UTF8 -Force
        Write-Info "API 地址配置为: $apiUrl"
    } else {
        # 使用相对路径，让 Nginx 代理处理
        "VITE_API_BASE_URL=/api" | Out-File -FilePath $envFile -Encoding UTF8 -Force
        Write-Info "API 地址配置为相对路径: /api"
    }
    
    # 执行构建
    Write-Info "正在构建前端项目..."
    npm run build 2>&1 | ForEach-Object {
        if ($_ -match "ERR!" -or $_ -match "error") {
            Write-Error $_
        }
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "前端构建失败"
        exit 1
    }
    
    Write-Success "前端构建完成"
    
    # 复制构建产物到 static 目录
    Write-Info "复制构建产物到 static 目录..."
    $staticDir = Join-Path $ProjectRoot "static"
    $distDir = Join-Path $frontendDir "dist"
    
    # 确保 static 目录存在
    if (-not (Test-Path $staticDir)) {
        New-Item -ItemType Directory -Path $staticDir -Force | Out-Null
    } else {
        # 清理旧的静态文件
        Remove-Item -Path "$staticDir\*" -Recurse -Force -ErrorAction SilentlyContinue
    }
    
    # 复制文件
    Copy-Item -Path "$distDir\*" -Destination $staticDir -Recurse -Force
    
    Write-Success "静态文件复制完成"
    
    Set-Location $ProjectRoot
} else {
    Write-ColorOutput -Message "[3/6] 跳过前端构建 (--SkipBuild)" -Color Gray
}

# =====================================================
# 步骤 4: 验证项目结构
# =====================================================
Write-ColorOutput -Message "[4/6] 验证项目结构..." -Color Yellow

$requiredFiles = @(
    "dashboard_backend.py",
    "pyproject.toml",
    "deploy.sh"
)

$missingFiles = @()
foreach ($file in $requiredFiles) {
    $filePath = Join-Path $ProjectRoot $file
    if (-not (Test-Path $filePath)) {
        $missingFiles += $file
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Error "缺少必要的文件: $($missingFiles -join ', ')"
    exit 1
}

# 检查 static 目录
$staticDir = Join-Path $ProjectRoot "static"
if (-not (Test-Path $staticDir)) {
    Write-Warning "static 目录不存在，前端可能未正确构建"
} else {
    $staticFiles = Get-ChildItem $staticDir -Recurse -File | Measure-Object
    Write-Info "static 目录包含 $($staticFiles.Count) 个文件"
}

Write-Success "项目结构验证通过"

# =====================================================
# 步骤 5: 打包项目
# =====================================================
Write-ColorOutput -Message "[5/6] 打包项目..." -Color Yellow

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outputZip = "$OutputName`_$timestamp.zip"
$outputTar = "$OutputName`_$timestamp.tar.gz"

# 排除列表
$excludePatterns = @(
    "node_modules"
    ".venv"
    "venv"
    "__pycache__"
    ".pytest_cache"
    ".mypy_cache"
    ".tox"
    ".git"
    ".gitignore"
    "*.pyc"
    "*.pyo"
    "*.egg-info"
    "dist"
    "build"
    "frontend\node_modules"
    "frontend\dist"
    "*.zip"
    "*.tar.gz"
    "tests"
    ".pytest_cache"
    "*.log"
)

# 创建 zip 包
Write-Info "创建 ZIP 压缩包: $outputZip"

try {
    # 使用 .NET 的压缩功能，避免包含某些文件
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    
    # 创建临时目录进行打包
    $tempDir = Join-Path $env:TEMP "maids-dashboard-pack-$timestamp"
    if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Recurse -Force }
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    
    # 复制文件，排除不需要的文件
    $items = Get-ChildItem -Path $ProjectRoot -Exclude $excludePatterns
    foreach ($item in $items) {
        if ($item.PSIsContainer) {
            Copy-Item -Path $item.FullName -Destination $tempDir -Recurse -Force
        } else {
            Copy-Item -Path $item.FullName -Destination $tempDir -Force
        }
    }
    
    # 压缩
    $zipPath = Join-Path $ProjectRoot $outputZip
    if (Test-Path $zipPath) { Remove-Item -Path $zipPath -Force }
    
    [System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $zipPath)
    
    # 清理临时目录
    Remove-Item -Path $tempDir -Recurse -Force
    
    $zipSize = (Get-Item $zipPath).Length / 1MB
    Write-Success "ZIP 包创建成功: $outputZip ($([math]::Round($zipSize, 2)) MB)"
    
} catch {
    Write-Error "创建 ZIP 包失败: $_"
    
    # 备用方案：使用 Compress-Archive
    Write-Info "尝试使用备用方案..."
    Compress-Archive -Path "$ProjectRoot\*" -DestinationPath (Join-Path $ProjectRoot $outputZip) -Force
}

# 创建 tar.gz（如果需要）
if ($CreateTar) {
    Write-Info "创建 TAR.GZ 压缩包: $outputTar"
    
    # 检查是否有 tar 命令（Git Bash 或 WSL）
    $tarCmd = Get-Command tar -ErrorAction SilentlyContinue
    if ($tarCmd) {
        # 创建临时目录
        $tempDir = Join-Path $env:TEMP "maids-dashboard-tar-$timestamp"
        if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Recurse -Force }
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
        
        # 复制文件
        $items = Get-ChildItem -Path $ProjectRoot -Exclude $excludePatterns
        foreach ($item in $items) {
            if ($item.PSIsContainer) {
                Copy-Item -Path $item.FullName -Destination $tempDir -Recurse -Force
            } else {
                Copy-Item -Path $item.FullName -Destination $tempDir -Force
            }
        }
        
        # 打包
        $tarPath = Join-Path $ProjectRoot $outputTar
        Set-Location (Split-Path $tempDir -Parent)
        tar -czf $tarPath -C $tempDir .
        Set-Location $ProjectRoot
        
        # 清理
        Remove-Item -Path $tempDir -Recurse -Force
        
        $tarSize = (Get-Item $tarPath).Length / 1MB
        Write-Success "TAR.GZ 包创建成功: $outputTar ($([math]::Round($tarSize, 2)) MB)"
    } else {
        Write-Warning "未找到 tar 命令，跳过创建 tar.gz。建议安装 Git for Windows。"
    }
}

# =====================================================
# 步骤 6: 上传到服务器（可选）
# =====================================================
if (-not $SkipUpload -and $ServerIP) {
    Write-ColorOutput -Message "[6/6] 上传到服务器..." -Color Yellow
    
    # 检查 scp 或 sftp 可用性
    $scpCmd = Get-Command scp -ErrorAction SilentlyContinue
    if (-not $scpCmd) {
        Write-Warning "未找到 scp 命令，跳过上传"
        Write-Info "请手动上传文件: $outputZip"
    } else {
        Write-Info "正在上传到 $ServerUser@$ServerIP:/root/ ..."
        
        try {
            scp $outputZip "$ServerUser@${ServerIP}:/root/"
            Write-Success "上传成功！"

            # 同时上传 deploy.sh
            $deployScript = Join-Path $ProjectRoot "deploy.sh"
            if (Test-Path $deployScript) {
                Write-Info "上传部署脚本 deploy.sh..."
                scp $deployScript "$ServerUser@${ServerIP}:/root/"
                Write-Success "部署脚本上传成功！"
            }

            Write-Host ""
            Write-Info "服务器部署命令:"
            Write-Host "  ssh $ServerUser@$ServerIP `"bash /root/deploy.sh`"" -ForegroundColor Green
            
        } catch {
            Write-Error "上传失败: $_"
            Write-Info "请手动上传文件到服务器"
        }
    }
} else {
    Write-ColorOutput -Message "[6/6] 跳过上传 (--SkipUpload 或未指定 ServerIP)" -Color Gray
}

# =====================================================
# 完成
# =====================================================
Write-Host ""
Write-ColorOutput -Message "========================================" -Color Green
Write-ColorOutput -Message "  🎉 打包完成！" -Color Green
Write-ColorOutput -Message "========================================" -Color Green
Write-Host ""

$outputFile = if (Test-Path (Join-Path $ProjectRoot $outputZip)) { $outputZip } else { "maids-dashboard.zip" }
Write-Info "输出文件: $outputFile"
Write-Info "文件路径: $(Join-Path $ProjectRoot $outputFile)"

if (-not $ServerIP) {
    Write-Host ""
    Write-Info "后续步骤:"
    Write-Host "  1. 上传压缩包到服务器: scp $outputFile root@你的服务器IP:/root/"
    Write-Host "  2. 上传部署脚本: scp deploy.sh root@你的服务器IP:/root/"
    Write-Host "  3. 在服务器执行: bash /root/deploy.sh"
}

Write-Host ""
Write-Info "脚本参数说明:"
Write-Host "  -ServerIP <ip>      指定服务器 IP，自动配置 API 地址"
Write-Host "  -ServerUser <user>  指定 SSH 用户名 (默认: root)"
Write-Host "  -SkipBuild          跳过前端构建（使用已构建的静态文件）"
Write-Host "  -SkipUpload         跳过上传到服务器"
Write-Host "  -CreateTar          同时生成 tar.gz 格式（需要 Git Bash）"
Write-Host ""
