# Automatic Let's Encrypt Certificate Renewal Script
# Renews local.employeeattendance.me certificate and restarts Docker
# Scheduled to run monthly via Windows Task Scheduler

# Log file for monitoring
$logFile = "C:\Certbot\renewal.log"

function Write-Log {
    param([string]$message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $message" | Add-Content -Path $logFile
    Write-Host $message
}

Write-Log "=========================================="
Write-Log "Starting certificate renewal process..."
Write-Log "=========================================="

# Step 1: Renew certificate using Certbot
Write-Log "Running Certbot renewal..."
& "C:\Program Files\Certbot\bin\certbot.exe" renew --dns-cloudflare --dns-cloudflare-credentials C:/Certbot/cloudflare.ini --quiet

if ($LASTEXITCODE -eq 0) {
    Write-Log "✓ Certificate renewal successful"
} else {
    Write-Log "✗ Certificate renewal failed (exit code: $LASTEXITCODE)"
    exit 1
}

# Step 2: Copy renewed certificates to project
Write-Log "Copying certificates to project..."
$source = "C:\Certbot\live\local.employeeattendance.me\"
$dest = "D:\THESIS 1\employeattendance\nginx\certs\"

try {
    copy "$source\fullchain.pem" "$dest" -Force
    Write-Log "✓ Copied fullchain.pem"
    
    copy "$source\privkey.pem" "$dest" -Force
    Write-Log "✓ Copied privkey.pem"
} catch {
    Write-Log "✗ Failed to copy certificates: $_"
    exit 1
}

# Step 3: Restart Docker Nginx to use new certificates
Write-Log "Restarting Docker Nginx..."
cd "D:\THESIS 1\employeattendance"

try {
    & docker-compose restart nginx
    Write-Log "✓ Docker Nginx restarted"
} catch {
    Write-Log "✗ Failed to restart Docker: $_"
    exit 1
}

Write-Log "=========================================="
Write-Log "Certificate renewal completed successfully!"
Write-Log "Next renewal: ~$(Get-Date -Date (Get-Date).AddMonths(1) -Format 'MM/dd/yyyy')"
Write-Log "==========================================="
