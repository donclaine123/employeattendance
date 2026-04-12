# Restore a raw PostgreSQL backup into the local Supabase container and reapply permissions.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,
    [string]$ContainerName = "supabase_db_employeattendance",
    [string]$DatabaseName = "postgres",
    [string]$DatabaseUser = "supabase_admin",
    [string]$DatabasePassword = "postgres"
)

$ErrorActionPreference = 'Stop'

$permissionsScript = Join-Path $PSScriptRoot "apply-supabase-permissions.ps1"

if (-not (Test-Path -LiteralPath $BackupPath)) {
    throw "Backup file not found: $BackupPath"
}

$resolvedBackupPath = (Resolve-Path -LiteralPath $BackupPath).Path

if (-not (Test-Path $permissionsScript)) {
    throw "Permissions helper not found: $permissionsScript"
}

$containerCheck = docker ps --filter "name=$ContainerName" --format "{{.Names}}" 2>$null
if (-not $containerCheck) {
    throw "Supabase Docker container '$ContainerName' is not running. Start it first with: .\bin\supabase.exe start"
}

Write-Host "[Restore] Refreshing template1 collation version..." -ForegroundColor Yellow
& docker exec -e PGPASSWORD=$DatabasePassword -i $ContainerName psql -U $DatabaseUser -d template1 -v ON_ERROR_STOP=1 -c "ALTER DATABASE template1 REFRESH COLLATION VERSION"
if ($LASTEXITCODE -ne 0) {
    throw "Failed to refresh template1 collation version"
}

Write-Host "[Restore] Recreating local postgres database..." -ForegroundColor Yellow
& docker exec -e PGPASSWORD=$DatabasePassword -i $ContainerName psql -U $DatabaseUser -d template1 -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS postgres WITH (FORCE)"
if ($LASTEXITCODE -ne 0) {
    throw "Failed to drop the existing postgres database"
}

& docker exec -e PGPASSWORD=$DatabasePassword -i $ContainerName psql -U $DatabaseUser -d template1 -v ON_ERROR_STOP=1 -c "CREATE DATABASE postgres OWNER supabase_admin"
if ($LASTEXITCODE -ne 0) {
    throw "Failed to recreate the postgres database"
}

Write-Host "[Restore] Importing backup: $resolvedBackupPath" -ForegroundColor Yellow
$restoreCommand = "docker exec -e PGPASSWORD=$DatabasePassword -i $ContainerName psql -v ON_ERROR_STOP=1 -U $DatabaseUser -d $DatabaseName < `"$resolvedBackupPath`""
cmd /c $restoreCommand
if ($LASTEXITCODE -ne 0) {
    throw "Failed to restore backup file"
}

& $permissionsScript -ContainerName $ContainerName -DatabaseName $DatabaseName -DatabaseUser $DatabaseUser -DatabasePassword $DatabasePassword

Write-Host "[Restore] Verifying restored data as service_role..." -ForegroundColor Yellow
& docker exec -e PGPASSWORD=$DatabasePassword -i $ContainerName psql -U $DatabaseUser -d $DatabaseName -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT (SELECT count(*) FROM public.employees) AS employees_count, (SELECT count(*) FROM public.system_settings) AS settings_count, (SELECT count(*) FROM public.qr_sessions) AS qr_sessions_count;"
if ($LASTEXITCODE -ne 0) {
    throw "Restore verification failed"
}

Write-Host "[Restore] Backup restored and permissions reapplied successfully." -ForegroundColor Green
