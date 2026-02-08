# Database Backup Script for Docker + Supabase (PowerShell)
# Backs up PostgreSQL database from Supabase container to SQL file with timestamp

# Create backups directory if it doesn't exist
$backupsDir = Join-Path (Split-Path $PSScriptRoot) "backups"
if (-not (Test-Path $backupsDir)) {
    New-Item -ItemType Directory -Path $backupsDir | Out-Null
    Write-Host "[Backup] Created backups directory" -ForegroundColor Green
}

# Create filename with timestamp
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$filename = "data_backup_$timestamp.sql"
$filepath = Join-Path $backupsDir $filename

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "DATABASE BACKUP (Docker + Supabase)" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Starting backup process..." -ForegroundColor White
Write-Host "Destination: $filename" -ForegroundColor Gray
Write-Host ""

try {
    # Check if Docker is available
    $dockerCheck = docker --version 2>$null
    if (-not $dockerCheck) {
        throw "Docker is not installed or not in PATH"
    }
    
    # Container name
    $containerName = "supabase_db_employeattendance"
    $dbPassword = "postgres"
    
    # Check if Supabase container is running
    Write-Host "Checking Supabase Docker container..." -ForegroundColor Gray
    $containerCheck = docker ps --filter "name=$containerName" --format "{{.Names}}" 2>$null
    
    if (-not $containerCheck) {
        throw "Supabase Docker container '$containerName' is not running. Please ensure Supabase is started with: supabase start"
    }
    
    Write-Host "Container found: $containerCheck" -ForegroundColor Green
    
    # Run pg_dump inside Docker container
    Write-Host "Running pg_dump inside container..." -ForegroundColor Gray
    docker exec -e PGPASSWORD=$dbPassword $containerName pg_dump `
        -U postgres `
        --column-inserts `
        --data-only `
        postgres | Out-File -FilePath $filepath -Encoding UTF8
    
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump failed with exit code $LASTEXITCODE"
    }
    
    # Get file size
    $fileSize = (Get-Item $filepath).Length / 1MB
    
    Write-Host ""
    Write-Host "[SUCCESS] Backup completed successfully!" -ForegroundColor Green
    Write-Host "File: $filename" -ForegroundColor Gray
    Write-Host "Size: $([math]::Round($fileSize, 2)) MB" -ForegroundColor Gray
    Write-Host "Location: $filepath" -ForegroundColor Gray
    Write-Host ""
    Write-Host "=================================================" -ForegroundColor Cyan

} catch {
    Write-Host ""
    Write-Host "[FAILED] Backup failed!" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ""
    exit 1
}
