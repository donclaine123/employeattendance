@echo off
REM Employee Attendance System - Quick Setup Script
REM This script deploys the entire system with one command
REM Requirements: Docker Desktop installed and running

SETLOCAL ENABLEDELAYEDEXPANSION

echo.
echo ========================================
echo Employee Attendance - Docker Setup
echo ========================================
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker is not installed or not in PATH
    echo.
    echo Please install Docker Desktop first:
    echo https://www.docker.com/products/docker-desktop
    echo.
    echo Or run: winget install Docker.DockerDesktop
    pause
    exit /b 1
)

echo [✓] Docker found: 
docker --version

REM Check if Docker daemon is running
docker ps >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Docker daemon is not running
    echo Please start Docker Desktop and try again
    pause
    exit /b 1
)

echo [✓] Docker daemon is running
echo.

REM Navigate to project directory
cd /d "%~dp0"
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to navigate to project directory
    pause
    exit /b 1
)

echo [INFO] Starting services...
echo.

REM Stop existing services
echo [STEP 1/4] Stopping any existing services...
docker compose down 2>nul

REM Build and start services
echo [STEP 2/4] Building containers...
docker compose build --no-cache

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)

echo [STEP 3/4] Starting services...
docker compose up -d

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to start services
    docker compose logs
    pause
    exit /b 1
)

echo.
echo [STEP 4/4] Waiting for services to start...
timeout /t 15 /nobreak

REM Check service status
echo.
echo [INFO] Checking service status...
docker compose ps

echo.
echo ========================================
echo ✓ DEPLOYMENT SUCCESSFUL!
echo ========================================
echo.
echo Your system is now running!
echo.
echo ACCESS:
echo   - Frontend: http://localhost:5000
echo   - API: http://localhost:5000/api
echo   - Database: postgresql://postgres:postgres@localhost:54322/postgres
echo.
echo USEFUL COMMANDS:
echo   - View logs: docker compose logs -f
echo   - Stop services: docker compose down
echo   - Restart app: docker compose restart app
echo   - Check status: docker compose ps
echo.
echo For detailed documentation, see: DEPLOYMENT_GUIDE.md
echo.
pause
