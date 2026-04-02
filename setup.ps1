# Employee Attendance System - Docker Setup Script
# Run this script with: powershell -ExecutionPolicy Bypass -File setup.ps1

param(
    [switch]$Clean = $false,
    [switch]$Logs = $false,
    [switch]$Stop = $false,
    [switch]$Status = $false
)

$ErrorActionPreference = "Continue"

function Write-Header {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host $args[0] -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

function Write-Success {
    Write-Host "[✓] " -ForegroundColor Green -NoNewline
    Write-Host $args[0]
}

function Write-Error-Custom {
    Write-Host "[✗] " -ForegroundColor Red -NoNewline
    Write-Host $args[0]
}

function Write-Info {
    Write-Host "[INFO] " -ForegroundColor Yellow -NoNewline
    Write-Host $args[0]
}

# Handle different commands
if ($Stop) {
    Write-Header "Stopping Services"
    docker compose down
    Write-Success "Services stopped"
    exit 0
}

if ($Status) {
    Write-Header "Service Status"
    docker compose ps
    exit 0
}

if ($Logs) {
    Write-Header "Viewing Logs"
    docker compose logs -f
    exit 0
}

# Main deployment flow
Write-Header "Employee Attendance - Docker Deployment"

# Check Docker installation
Write-Info "Checking Docker installation..."
$dockerVersion = docker --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "Docker is not installed or not in PATH"
    Write-Host ""
    Write-Host "Please install Docker Desktop:"
    Write-Host "  https://www.docker.com/products/docker-desktop"
    Write-Host ""
    Write-Host "Or via winget:"
    Write-Host "  winget install Docker.DockerDesktop"
    exit 1
}

Write-Success $dockerVersion

# Check Docker daemon
Write-Info "Checking Docker daemon..."
docker ps >$null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "Docker daemon is not running"
    Write-Host ""
    Write-Host "Please start Docker Desktop and try again"
    exit 1
}

Write-Success "Docker daemon is running"

# Navigate to project
$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectPath
Write-Info "Project directory: $projectPath"

# Handle clean flag
if ($Clean) {
    Write-Info "Running clean build (removing volumes)..."
    docker compose down -v 2>$null
}

# Deployment steps
Write-Host ""
Write-Info "Starting deployment..."
Write-Host ""

# Step 1: Stop existing
Write-Info "[STEP 1/4] Stopping any existing services..."
docker compose down 2>$null
Write-Success "Previous services stopped"

# Step 2: Build
Write-Info "[STEP 2/4] Building containers..."
docker compose build --no-cache
if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "Build failed - see errors above"
    exit 1
}
Write-Success "Containers built successfully"

# Step 3: Start
Write-Info "[STEP 3/4] Starting services..."
docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "Failed to start services"
    docker compose logs
    exit 1
}
Write-Success "Services started"

# Step 4: Wait
Write-Info "[STEP 4/4] Waiting 15 seconds for services to initialize..."
Start-Sleep -Seconds 15

Write-Host ""
Write-Info "Service status:"
docker compose ps

# Success message
Write-Header "Deployment Successful!"

Write-Host "✓ Your Employee Attendance system is now running!`n" -ForegroundColor Green
Write-Host "ACCESS POINTS:" -ForegroundColor Cyan
Write-Host "  Frontend:  " -NoNewline; Write-Host "http://localhost:5000" -ForegroundColor Yellow
Write-Host "  API:       " -NoNewline; Write-Host "http://localhost:5000/api" -ForegroundColor Yellow
Write-Host "  Database:  " -NoNewline; Write-Host "postgresql://postgres:postgres@localhost:14322/postgres" -ForegroundColor Yellow

Write-Host "`nUSEFUL COMMANDS:" -ForegroundColor Cyan
Write-Host "  Status:    " -NoNewline; Write-Host ".\setup.ps1 -Status" -ForegroundColor Yellow
Write-Host "  Logs:      " -NoNewline; Write-Host ".\setup.ps1 -Logs" -ForegroundColor Yellow
Write-Host "  Stop:      " -NoNewline; Write-Host ".\setup.ps1 -Stop" -ForegroundColor Yellow
Write-Host "  Clean:     " -NoNewline; Write-Host ".\setup.ps1 -Clean" -ForegroundColor Yellow

Write-Host "`nFor detailed help, see: DEPLOYMENT_GUIDE.md`n" -ForegroundColor Cyan
