# DNS-01 Certificate Setup for Windows (Let's Encrypt + Cloudflare)
# This script installs Certbot and generates HTTPS certificates for your domain
# 
# Prerequisites:
# - Windows 10/11
# - PowerShell 5.0+ (run as Administrator)
# - Cloudflare account with domain configured
# - Cloudflare API token (created in My Profile > API Tokens)
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-certbot-windows.ps1

# Require admin privileges
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script requires Administrator privileges. Please run PowerShell as Administrator."
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Let's Encrypt DNS-01 Certificate Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if Certbot is installed
Write-Host "[1/5] Checking for Certbot installation..." -ForegroundColor Yellow
$certbotPath = "C:\Program Files\Certbot\bin\certbot.exe"
if (-NOT (Test-Path $certbotPath)) {
    Write-Host "❌ Certbot not found. Installing..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Certbot for Windows requires the installer from: https://certbot.eff.org/instructions?ws=other&os=windows" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Steps:" -ForegroundColor Green
    Write-Host "1. Download the Certbot installer"
    Write-Host "2. Run the installer (accept default paths)"
    Write-Host "3. Run this script again after installation"
    Write-Host ""
    Write-Host "Opening Certbot download page..." -ForegroundColor Yellow
    Start-Process "https://certbot.eff.org/instructions?ws=other&os=windows"
    exit 0
} else {
    Write-Host "✓ Certbot found at $certbotPath" -ForegroundColor Green
}

# Step 2: Check for Cloudflare plugin
Write-Host "[2/5] Checking for Cloudflare DNS plugin..." -ForegroundColor Yellow
try {
    & $certbotPath plugins 2>&1 | Select-String "cloudflare" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Cloudflare plugin not found. Installing..." -ForegroundColor Yellow
        Write-Host ""
        # Note: For Windows, the plugin is typically installed via pip
        Write-Host "To install Cloudflare plugin:" -ForegroundColor Cyan
        Write-Host "1. Open Command Prompt as Administrator" -ForegroundColor White
        Write-Host "2. Run: pip install certbot-dns-cloudflare" -ForegroundColor White
        Write-Host "3. Run this script again" -ForegroundColor White
        Write-Host ""
        exit 0
    } else {
        Write-Host "✓ Cloudflare DNS plugin is available" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️  Could not verify plugin (attempting to proceed anyway)" -ForegroundColor Yellow
}

Write-Host ""

# Step 3: Gather input from user
Write-Host "[3/5] Collecting configuration..." -ForegroundColor Yellow
Write-Host ""

# Domain name
$domain = Read-Host "Enter your domain name (e.g., stclare-qr.com)"
if ([string]::IsNullOrWhiteSpace($domain)) {
    Write-Host "❌ Domain name is required" -ForegroundColor Red
    exit 1
}

# Email for Let's Encrypt
$email = Read-Host "Enter your email for Let's Encrypt expiration notices"
if ([string]::IsNullOrWhiteSpace($email)) {
    Write-Host "❌ Email is required" -ForegroundColor Red
    exit 1
}

# Cloudflare API token
Write-Host ""
Write-Host "Enter your Cloudflare API token:" -ForegroundColor Cyan
Write-Host "(Get from: https://dash.cloudflare.com/profile/api-tokens)" -ForegroundColor Gray
$apiToken = Read-Host "API Token"
if ([string]::IsNullOrWhiteSpace($apiToken)) {
    Write-Host "❌ API token is required" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 4: Create credentials file
Write-Host "[4/5] Setting up Cloudflare credentials..." -ForegroundColor Yellow

# Create Certbot config directory if it doesn't exist
$certbotConfigDir = "C:\Certbot"
if (-NOT (Test-Path $certbotConfigDir)) {
    New-Item -ItemType Directory -Path $certbotConfigDir -Force | Out-Null
}

$credsFile = Join-Path $certbotConfigDir "cloudflare.ini"

# Write credentials file
$credsContent = @"
dns_cloudflare_api_token = $apiToken
"@

Set-Content -Path $credsFile -Value $credsContent -Force
Write-Host "✓ Credentials saved to $credsFile" -ForegroundColor Green

# Step 5: Run Certbot
Write-Host "[5/5] Running Certbot DNS-01 challenge..." -ForegroundColor Yellow
Write-Host ""
Write-Host "This will:" -ForegroundColor Cyan
Write-Host "  1. Create TXT record in Cloudflare for $_acme-challenge.$domain" -ForegroundColor Gray
Write-Host "  2. Validate domain ownership with Let's Encrypt" -ForegroundColor Gray
Write-Host "  3. Generate certificate files" -ForegroundColor Gray
Write-Host ""
Write-Host "Certificates will be stored in: C:\Certbot\live\$domain\" -ForegroundColor Cyan
Write-Host ""

# Run certbot
& $certbotPath certonly `
    --dns-cloudflare `
    --dns-cloudflare-credentials $credsFile `
    --dns-cloudflare-propagation-seconds 60 `
    -d $domain `
    -d "*.$domain" `
    -m $email `
    --agree-tos `
    --non-interactive

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "✓ Certificate generation SUCCESSFUL!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your certificates are ready at:" -ForegroundColor Cyan
    Write-Host "  Private Key:  C:\Certbot\live\$domain\privkey.pem" -ForegroundColor White
    Write-Host "  Certificate:  C:\Certbot\live\$domain\fullchain.pem" -ForegroundColor White
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Green
    Write-Host "1. Set up Cloudflare A record pointing $domain to your local IP" -ForegroundColor White
    Write-Host "   (Set 'Proxy status' to DNS Only - grey cloud)" -ForegroundColor Gray
    Write-Host "2. Configure Nginx reverse proxy to use these certificates" -ForegroundColor White
    Write-Host "3. Restart Docker: docker-compose down && docker-compose up -d" -ForegroundColor White
    Write-Host ""
    Write-Host "Certificate renewal (needed every 90 days):" -ForegroundColor Green
    Write-Host "  certbot renew --dns-cloudflare" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "❌ Certificate generation FAILED" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Verify your Cloudflare API token is correct" -ForegroundColor White
    Write-Host "2. Verify your domain is active in Cloudflare" -ForegroundColor White
    Write-Host "3. Check internet connection" -ForegroundColor White
    Write-Host "4. Run: certbot certonly --dns-cloudflare -d $domain --dry-run" -ForegroundColor White
    Write-Host ""
    exit 1
}
