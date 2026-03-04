# =====================================================
# Maids Dashboard - Windows packaging script
# Builds the frontend, packages the project, and
# optionally uploads to a remote server via scp.
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

$ErrorActionPreference = "Stop"

function Write-ColorOutput {
    param([Parameter(Mandatory=$true)][string]$Message, [string]$Color = "White")
    $orig = $Host.UI.RawUI.ForegroundColor
    $Host.UI.RawUI.ForegroundColor = $Color
    Write-Host $Message
    $Host.UI.RawUI.ForegroundColor = $orig
}
function Write-Success { param([string]$Message) Write-ColorOutput -Message "OK  $Message" -Color Green }
function Write-Info    { param([string]$Message) Write-ColorOutput -Message "... $Message" -Color Cyan }
function Write-Warn    { param([string]$Message) Write-ColorOutput -Message "!   $Message" -Color Yellow }
function Write-Err     { param([string]$Message) Write-ColorOutput -Message "ERR $Message" -Color Red }

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }

# The script lives in deploy/, so the project root is one level up
$ProjectRoot = Split-Path -Parent $ProjectRoot

Set-Location $ProjectRoot

Write-Host ""
Write-ColorOutput -Message "========================================"  -Color Green
Write-ColorOutput -Message "  Maids Dashboard - Package Script"       -Color Green
Write-ColorOutput -Message "========================================"  -Color Green
Write-Host ""
Write-Info "Project root: $ProjectRoot"
Write-Host ""

# =====================================================
# Step 1: Clean dev artifacts
# =====================================================
Write-ColorOutput -Message "[1/6] Cleaning dev artifacts..." -Color Yellow

$itemsToRemove = @(
    # Python bytecode / cache — regenerated automatically, safe to delete
    "__pycache__", ".pytest_cache", ".mypy_cache", ".tox",
    "*.pyc", "*.pyo", "*.egg-info",
    # Frontend build artefacts — rebuilt by npm run build
    "frontend\dist",

    # Static output — rebuilt by Vite
    "static\assets", "static\index.html",
    # Leftover files / old packages
    "*.log", "*.zip", "*.tar.gz", "nul"
    # NOTE: venv/.venv, node_modules, frontend\node_modules are intentionally NOT listed here.
    # They are excluded from the ZIP via `$excludePatterns` and must NOT be deleted
    # from the local dev environment (especially dangerous with -SkipBuild).
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
            Write-Warn "Could not remove: $($item.FullName)"
        }
    }
}

# NOTE: .git is excluded from the ZIP via $excludePatterns — do NOT delete it here

Write-Success "Cleaned $removedCount items"

# =====================================================
# Step 2: Install frontend dependencies
# =====================================================
if (-not $SkipBuild) {
    Write-ColorOutput -Message "[2/6] Installing frontend dependencies..." -Color Yellow

    $frontendDir = Join-Path $ProjectRoot "frontend"
    if (-not (Test-Path $frontendDir)) {
        Write-Err "frontend/ directory not found"
        exit 1
    }

    try {
        $nodeVersion = node --version 2>$null
        Write-Info "Node.js: $nodeVersion"
    } catch {
        Write-Err "Node.js not found. Install from https://nodejs.org/"
        exit 1
    }

    Set-Location $frontendDir

    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    npm install 2>&1 | ForEach-Object {
        if ($_ -match "ERR!|^error") { Write-Err $_ }
        elseif ($_ -match "WARN")    { Write-Warn $_ }
    }
    $ErrorActionPreference = $prevEAP

    if ($LASTEXITCODE -ne 0) {
        Write-Err "npm install failed"
        exit 1
    }

    Write-Success "Frontend dependencies installed"
} else {
    Write-ColorOutput -Message "[2/6] Skipped (--SkipBuild)" -Color Gray
}

# =====================================================
# Step 3: Build frontend
# =====================================================
if (-not $SkipBuild) {
    Write-ColorOutput -Message "[3/6] Building frontend..." -Color Yellow

    if (-not $ServerIP) {
        $ServerIP = Read-Host "Server public IP (leave blank to use relative /api path)"
    }

    $envFile = Join-Path $frontendDir ".env.production"
    if ($ServerIP) {
        "VITE_API_BASE_URL=http://$($ServerIP):18889" | Out-File -FilePath $envFile -Encoding UTF8 -Force
        Write-Info "API base: http://$($ServerIP):18889"
    } else {
        "VITE_API_BASE_URL=/api" | Out-File -FilePath $envFile -Encoding UTF8 -Force
        Write-Info "API base: /api (relative, handled by Nginx)"
    }

    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    npm run build 2>&1 | ForEach-Object {
        if ($_ -match "ERR!|^error") { Write-Err $_ }
    }
    $ErrorActionPreference = $prevEAP

    if ($LASTEXITCODE -ne 0) {
        Write-Err "Frontend build failed"
        exit 1
    }

    Write-Success "Frontend built"

    # Vite outputs directly to ../static/ (outDir in vite.config.ts),
    # so no copy step is needed. Just verify the build output exists.
    $staticDir = Join-Path $ProjectRoot "static"
    if (-not (Test-Path (Join-Path $staticDir "index.html"))) {
        Write-Err "Build completed but static/index.html not found — check vite.config.ts outDir"
        exit 1
    }
    $assetCount = (Get-ChildItem (Join-Path $staticDir "assets") -File -ErrorAction SilentlyContinue | Measure-Object).Count
    Write-Success "Static output verified ($assetCount assets)"

    Set-Location $ProjectRoot
} else {
    Write-ColorOutput -Message "[3/6] Skipped (--SkipBuild)" -Color Gray
}

# =====================================================
# Step 4: Validate project structure
# =====================================================
Write-ColorOutput -Message "[4/6] Validating project structure..." -Color Yellow

$requiredFiles = @("dashboard_backend.py", "pyproject.toml", "deploy\deploy.sh")
$missingFiles  = $requiredFiles | Where-Object { -not (Test-Path (Join-Path $ProjectRoot $_)) }

if ($missingFiles.Count -gt 0) {
    Write-Err "Missing required files: $($missingFiles -join ', ')"
    exit 1
}

$staticDir = Join-Path $ProjectRoot "static"
if (-not (Test-Path $staticDir)) {
    Write-Warn "static/ directory missing — frontend may not have been built"
} else {
    $count = (Get-ChildItem $staticDir -Recurse -File | Measure-Object).Count
    Write-Info "static/ contains $count files"
}

Write-Success "Project structure OK"

# =====================================================
# Step 5: Package
# =====================================================
Write-ColorOutput -Message "[5/6] Creating package..." -Color Yellow

$timestamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$outputZip  = "${OutputName}_${timestamp}.zip"
$outputTar  = "${OutputName}_${timestamp}.tar.gz"

$excludePatterns = @(
    "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".tox", ".git", ".gitignore", "*.pyc", "*.pyo",
    "*.egg-info", "dist", "build", "frontend\node_modules", "frontend\dist",
    "*.zip", "*.tar.gz", "tests", "*.log",
    ".vs", ".agents", ".claude", ".sisyphus", ".github", ".ruff_cache"
)

Write-Info "Creating ZIP: $outputZip"

try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $tempDir = Join-Path $env:TEMP "maids-dashboard-pack-$timestamp"
    if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Recurse -Force }
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    Get-ChildItem -Path $ProjectRoot -Exclude $excludePatterns | ForEach-Object {
        try {
            if ($_.PSIsContainer) {
                Copy-Item -Path $_.FullName -Destination $tempDir -Recurse -Force -ErrorAction Stop
            } else {
                Copy-Item -Path $_.FullName -Destination $tempDir -Force -ErrorAction Stop
            }
        } catch {
            Write-Warn "Skipped (locked/inaccessible): $($_.Name)"
        }
    }

    $zipPath = Join-Path $ProjectRoot $outputZip
    if (Test-Path $zipPath) { Remove-Item -Path $zipPath -Force }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $zipPath)
    Remove-Item -Path $tempDir -Recurse -Force

    $zipMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
    Write-Success "ZIP created: $outputZip ($zipMB MB)"

} catch {
    Write-Err "ZIP creation failed: $_"
    if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
    exit 1
}

if ($CreateTar) {
    Write-Info "Creating TAR.GZ: $outputTar"
    $tarCmd = Get-Command tar -ErrorAction SilentlyContinue
    if ($tarCmd) {
        $tempDir = Join-Path $env:TEMP "maids-dashboard-tar-$timestamp"
        if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Recurse -Force }
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

        Get-ChildItem -Path $ProjectRoot -Exclude $excludePatterns | ForEach-Object {
            if ($_.PSIsContainer) {
                Copy-Item -Path $_.FullName -Destination $tempDir -Recurse -Force
            } else {
                Copy-Item -Path $_.FullName -Destination $tempDir -Force
            }
        }

        $tarPath = Join-Path $ProjectRoot $outputTar
        Set-Location (Split-Path $tempDir -Parent)
        tar -czf $tarPath -C $tempDir .
        Set-Location $ProjectRoot
        Remove-Item -Path $tempDir -Recurse -Force

        $tarMB = [math]::Round((Get-Item $tarPath).Length / 1MB, 2)
        Write-Success "TAR.GZ created: $outputTar ($tarMB MB)"
    } else {
        Write-Warn "tar not found — skipping TAR.GZ. Install Git for Windows to enable this."
    }
}

# =====================================================
# Step 6: Upload to server (optional)
# =====================================================
if (-not $SkipUpload -and $ServerIP) {
    Write-ColorOutput -Message "[6/6] Uploading to server..." -Color Yellow

    $scpCmd = Get-Command scp -ErrorAction SilentlyContinue
    if (-not $scpCmd) {
        Write-Warn "scp not found — skipping upload. Upload $outputZip manually."
    } else {
        Write-Info "Uploading to $ServerUser@${ServerIP}:/root/ ..."
        try {
            scp $outputZip "$ServerUser@${ServerIP}:/root/"
            Write-Success "Package uploaded"

            $deployScript = Join-Path $ProjectRoot "deploy\deploy.sh"
            if (Test-Path $deployScript) {
                Write-Info "Uploading deploy.sh..."
                scp $deployScript "$ServerUser@${ServerIP}:/root/"
                Write-Success "deploy.sh uploaded"
            }

            Write-Host ""
            Write-Info "Run on server:"
            Write-Host "  ssh $ServerUser@${ServerIP} `"bash /root/deploy.sh`"" -ForegroundColor Green
        } catch {
            Write-Err "Upload failed: $_"
            Write-Info "Upload $outputZip to the server manually."
        }
    }
} else {
    Write-ColorOutput -Message "[6/6] Skipped (--SkipUpload or no --ServerIP)" -Color Gray
}

# =====================================================
# Done
# =====================================================
Write-Host ""
Write-ColorOutput -Message "========================================" -Color Green
Write-ColorOutput -Message "  Done!" -Color Green
Write-ColorOutput -Message "========================================" -Color Green
Write-Host ""

$outputFile = if (Test-Path (Join-Path $ProjectRoot $outputZip)) { $outputZip } else { "maids-dashboard.zip" }
Write-Info "Output: $(Join-Path $ProjectRoot $outputFile)"

if (-not $ServerIP) {
    Write-Host ""
    Write-Info "Next steps:"
    Write-Host "  1. scp $outputFile root@YOUR_SERVER_IP:/root/"
    Write-Host "  2. scp deploy.sh root@YOUR_SERVER_IP:/root/"
    Write-Host "  3. ssh root@YOUR_SERVER_IP `"bash /root/deploy.sh`""
}

Write-Host ""
Write-Info "Parameters:"
Write-Host "  -ServerIP <ip>    Server public IP (configures API base URL)"
Write-Host "  -ServerUser <u>   SSH user (default: root)"
Write-Host "  -SkipBuild        Skip npm install + build"
Write-Host "  -SkipUpload       Package only, do not upload"
Write-Host "  -CreateTar        Also produce a .tar.gz (requires Git for Windows)"
Write-Host ""
