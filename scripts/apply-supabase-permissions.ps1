# Reapply the local Supabase permissions needed by the app after restore/reset.

[CmdletBinding()]
param(
    [string]$ContainerName = "supabase_db_employeattendance",
    [string]$DatabaseName = "postgres",
    [string]$DatabaseUser = "supabase_admin",
    [string]$DatabasePassword = "postgres"
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$permissionsFile = Join-Path $projectRoot "supabase\permissions.sql"

if (-not (Test-Path $permissionsFile)) {
    throw "Permissions file not found: $permissionsFile"
}

$containerCheck = docker ps --filter "name=$ContainerName" --format "{{.Names}}" 2>$null
if (-not $containerCheck) {
    throw "Supabase Docker container '$ContainerName' is not running. Start it first with: .\bin\supabase.exe start"
}

Write-Host "[Permissions] Applying local Supabase grants..." -ForegroundColor Yellow
Get-Content -Raw -Path $permissionsFile | docker exec -e PGPASSWORD=$DatabasePassword -i $ContainerName psql -v ON_ERROR_STOP=1 -U $DatabaseUser -d $DatabaseName

if ($LASTEXITCODE -ne 0) {
    throw "Failed to apply local Supabase permissions"
}

Write-Host "[Permissions] Grants applied successfully." -ForegroundColor Green
