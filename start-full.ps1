Write-Host "🚀 Starting Employee Attendance System (Full Stack)..." -ForegroundColor Cyan

# 1. Start Supabase (Database, Auth, Realtime, etc.)
Write-Host "1. Starting Supabase services..." -ForegroundColor Yellow
.\bin\supabase.exe start

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to start Supabase. Please check Docker Desktop." -ForegroundColor Red
    exit
}

Write-Host "1b. Reapplying Supabase permissions..." -ForegroundColor Yellow
try {
    & .\scripts\apply-supabase-permissions.ps1
} catch {
    Write-Host "❌ Failed to reapply Supabase permissions. $_" -ForegroundColor Red
    exit 1
}

# 2. Start App and Nginx
Write-Host "2. Starting Web App and Nginx..." -ForegroundColor Yellow
docker-compose up -d --build app nginx

Write-Host "`n✅ System Started Successfully!" -ForegroundColor Green
Write-Host "   - Supabase Studio: http://localhost:14323"
Write-Host "   - Web App:         http://localhost"
