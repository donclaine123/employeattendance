#!/bin/bash
# DNS-01 Certificate Setup for Linux (Let's Encrypt + Cloudflare)
# This script installs Certbot and generates HTTPS certificates for your domain
#
# Prerequisites:
# - Ubuntu 20.04+ or Debian 11+
# - sudo access (will be prompted)
# - Cloudflare account with domain configured
# - Cloudflare API token (created in My Profile > API Tokens)
#
# Usage: bash scripts/setup-certbot-linux.sh
# Or: chmod +x scripts/setup-certbot-linux.sh && ./scripts/setup-certbot-linux.sh

set -e

echo "========================================"
echo "Let's Encrypt DNS-01 Certificate Setup"
echo "========================================"
echo ""

# Check if running on Linux
if [[ ! "$OSTYPE" =~ ^linux ]]; then
    echo "❌ This script is for Linux only"
    echo "For Windows, use: scripts/setup-certbot-windows.ps1"
    exit 1
fi

# Require sudo for system-level operations
if [[ $EUID -ne 0 ]]; then
    echo "This script requires sudo privileges (will prompt if needed)"
    echo "Running with sudo..."
    exec sudo "$0" "$@"
fi

# Step 1: Update package manager
echo "[1/5] Updating package manager..." 
apt-get update -qq

# Step 2: Install Certbot and Cloudflare plugin
echo "[2/5] Installing Certbot and Cloudflare DNS plugin..."
apt-get install -y certbot python3-certbot-dns-cloudflare > /dev/null 2>&1

if ! command -v certbot &> /dev/null; then
    echo "❌ Certbot installation failed"
    exit 1
fi

echo "✓ Certbot installed successfully"
echo "✓ Cloudflare plugin installed successfully"
echo ""

# Step 3: Gather input from user
echo "[3/5] Collecting configuration..."
echo ""

# Domain name
read -p "Enter your domain name (e.g., stclare-qr.com): " domain
if [[ -z "$domain" ]]; then
    echo "❌ Domain name is required"
    exit 1
fi

# Email for Let's Encrypt
read -p "Enter your email for Let's Encrypt expiration notices: " email
if [[ -z "$email" ]]; then
    echo "❌ Email is required"
    exit 1
fi

# Cloudflare API token
echo ""
echo "Enter your Cloudflare API token:"
echo "(Get from: https://dash.cloudflare.com/profile/api-tokens)"
read -sp "API Token (input hidden): " apiToken
echo ""

if [[ -z "$apiToken" ]]; then
    echo "❌ API token is required"
    exit 1
fi

echo ""

# Step 4: Create credentials file
echo "[4/5] Setting up Cloudflare credentials..."

# Create certbot config directory if it doesn't exist
mkdir -p /etc/letsencrypt/conf.d

credsFile="/etc/letsencrypt/conf.d/cloudflare.ini"

# Write credentials file
cat > "$credsFile" << EOF
# Cloudflare DNS-01 Challenge Credentials
dns_cloudflare_api_token = $apiToken
EOF

# Set strict permissions (600 = read/write for owner only)
chmod 600 "$credsFile"

echo "✓ Credentials saved to $credsFile"
echo "✓ Permissions set to 600 (owner-only access)"
echo ""

# Step 5: Run Certbot
echo "[5/5] Running Certbot DNS-01 challenge..."
echo ""
echo "This will:"
echo "  1. Create TXT record in Cloudflare for _acme-challenge.$domain"
echo "  2. Validate domain ownership with Let's Encrypt"
echo "  3. Generate certificate files"
echo ""
echo "Certificates will be stored in: /etc/letsencrypt/live/$domain/"
echo ""

# Run certbot with DNS-01 challenge
certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials "$credsFile" \
    --dns-cloudflare-propagation-seconds 60 \
    -d "$domain" \
    -d "*.$domain" \
    -m "$email" \
    --agree-tos \
    --non-interactive

if [[ $? -eq 0 ]]; then
    echo ""
    echo "========================================"
    echo "✓ Certificate generation SUCCESSFUL!"
    echo "========================================"
    echo ""
    echo "Your certificates are ready at:"
    echo "  Private Key:  /etc/letsencrypt/live/$domain/privkey.pem"
    echo "  Certificate:  /etc/letsencrypt/live/$domain/fullchain.pem"
    echo ""
    echo "Next steps:"
    echo "1. Set up Cloudflare A record pointing $domain to your local IP"
    echo "   (Set 'Proxy status' to DNS Only - grey cloud)"
    echo "2. Configure Nginx reverse proxy to use these certificates"
    echo "3. Restart Docker: docker-compose down && docker-compose up -d"
    echo ""
    echo "Certificate renewal (needed every 90 days):"
    echo "  sudo certbot renew --dns-cloudflare"
    echo ""
    echo "Or set up automatic renewal with:"
    echo "  sudo systemctl enable certbot.timer"
    echo "  sudo systemctl start certbot.timer"
    echo ""
else
    echo ""
    echo "========================================"
    echo "❌ Certificate generation FAILED"
    echo "========================================"
    echo ""
    echo "Troubleshooting:"
    echo "1. Verify your Cloudflare API token is correct"
    echo "2. Verify your domain is active in Cloudflare"
    echo "3. Check internet connection"
    echo "4. Check credentials file: cat $credsFile"
    echo "5. Run test: sudo certbot certonly --dns-cloudflare -d $domain --dry-run"
    echo ""
    exit 1
fi
