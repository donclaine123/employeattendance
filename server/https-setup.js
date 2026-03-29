/**
 * HTTPS Certificate Setup Utility
 * 
 * Checks if Let's Encrypt certificates exist on filesystem and returns HTTPS options
 * Supports both Linux (/etc/letsencrypt/live/{domain}/) and Windows (C:\Certbot\live\{domain}\) paths
 * 
 * Usage:
 *   const httpsSetup = require('./https-setup');
 *   const httpsOptions = httpsSetup.getHttpsOptions();
 *   
 *   if (httpsOptions) {
 *     https.createServer(httpsOptions, app).listen(443);
 *   } else {
 *     http.createServer(app).listen(5000);
 *   }
 */

const fs = require('fs');
const path = require('path');

/**
 * Get domain name from environment or infer from certificate paths
 * @returns {string|null} Domain name or null
 */
function getDomainName() {
  // Try environment variable first
  if (process.env.DOMAIN_NAME) {
    return process.env.DOMAIN_NAME;
  }
  
  // Try from FRONTEND_URL or BASE_URL
  if (process.env.FRONTEND_URL) {
    try {
      const url = new URL(process.env.FRONTEND_URL);
      return url.hostname;
    } catch (e) {
      // Ignore parsing errors
    }
  }
  
  if (process.env.BASE_URL) {
    try {
      const url = new URL(process.env.BASE_URL);
      return url.hostname;
    } catch (e) {
      // Ignore parsing errors
    }
  }
  
  return null;
}

/**
 * Get certificate file paths for a given domain
 * Tries multiple locations (Linux, Windows)
 * 
 * @param {string} domain - Domain name (e.g., 'stclare-qr.com')
 * @returns {Object|null} Object with keyPath and certPath, or null if not found
 */
function getCertificatePaths(domain) {
  if (!domain) {
    return null;
  }
  
  // Try common certificate locations in order
  const possiblePaths = [
    // Linux standard (most common)
    {
      key: `/etc/letsencrypt/live/${domain}/privkey.pem`,
      cert: `/etc/letsencrypt/live/${domain}/fullchain.pem`,
      label: `Linux standard (/etc/letsencrypt/live/${domain}/)`
    },
    // Windows Certbot installation
    {
      key: `C:\\Certbot\\live\\${domain}\\privkey.pem`,
      cert: `C:\\Certbot\\live\\${domain}\\fullchain.pem`,
      label: `Windows Certbot (C:\\Certbot\\live\\${domain}\\)`
    },
    // Alternative Windows paths (if Certbot installed elsewhere)
    {
      key: `C:\\ProgramData\\Certbot\\live\\${domain}\\privkey.pem`,
      cert: `C:\\ProgramData\\Certbot\\live\\${domain}\\fullchain.pem`,
      label: `Windows ProgramData (C:\\ProgramData\\Certbot\\...)`
    },
    // Docker volume mounted path (Linux in container)
    {
      key: `/etc/letsencrypt/live/${domain}/privkey.pem`,
      cert: `/etc/letsencrypt/live/${domain}/fullchain.pem`,
      label: `Docker mounted volume (/etc/letsencrypt/...)`
    }
  ];
  
  for (const pathConfig of possiblePaths) {
    // Normalize paths for current OS
    const keyPath = path.normalize(pathConfig.key);
    const certPath = path.normalize(pathConfig.cert);
    
    // Check if both files exist
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      return {
        keyPath,
        certPath,
        label: pathConfig.label
      };
    }
  }
  
  return null;
}

/**
 * Get HTTPS options for Node.js https module
 * 
 * @returns {Object|null} Object with {key, cert} buffers, or null if certificates not found
 */
function getHttpsOptions() {
  try {
    // Get domain name
    const domain = getDomainName();
    
    if (!domain) {
      console.log('[HTTPS] No domain name found in environment (DOMAIN_NAME, FRONTEND_URL, or BASE_URL)');
      console.log('[HTTPS] Running in HTTP-only mode');
      return null;
    }
    
    console.log(`[HTTPS] Looking for certificates for domain: ${domain}`);
    
    // Get certificate paths
    const certPaths = getCertificatePaths(domain);
    
    if (!certPaths) {
      console.log(`[HTTPS] ⚠️  No certificates found for ${domain}`);
      console.log('[HTTPS] Falling back to HTTP mode');
      console.log('[HTTPS] To generate certificates, run the Certbot setup script:');
      console.log('[HTTPS]   - Windows: scripts/setup-certbot-windows.ps1');
      console.log('[HTTPS]   - Linux: bash scripts/setup-certbot-linux.sh');
      return null;
    }
    
    // Read certificate files
    console.log(`[HTTPS] ✓ Found certificates from ${certPaths.label}`);
    
    const privateKey = fs.readFileSync(certPaths.keyPath, 'utf8');
    const certificate = fs.readFileSync(certPaths.certPath, 'utf8');
    
    console.log('[HTTPS] ✓ Certificates loaded successfully');
    console.log(`[HTTPS] ✓ Private key: ${certPaths.keyPath}`);
    console.log(`[HTTPS] ✓ Certificate: ${certPaths.certPath}`);
    
    // Return HTTPS options for https.createServer()
    return {
      key: privateKey,
      cert: certificate
    };
    
  } catch (error) {
    console.error('[HTTPS] ❌ Error loading HTTPS certificates:', error.message);
    console.log('[HTTPS] Falling back to HTTP mode');
    return null;
  }
}

/**
 * Check if HTTPS certificates are available
 * @returns {boolean} True if certificates exist and can be loaded
 */
function isHttpsAvailable() {
  return getHttpsOptions() !== null;
}

/**
 * Get certificate expiration date information (for monitoring/renewal alerts)
 * 
 * @param {string} domain - Domain name (optional, will use environment if not provided)
 * @returns {Object|null} Object with expiration info or null
 */
function getCertificateInfo(domain = null) {
  try {
    const domainName = domain || getDomainName();
    if (!domainName) return null;
    
    const certPaths = getCertificatePaths(domainName);
    if (!certPaths) return null;
    
    // Get file stats (creation time, modification time)
    const stats = fs.statSync(certPaths.certPath);
    
    return {
      domain: domainName,
      certPath: certPaths.certPath,
      keyPath: certPaths.keyPath,
      issued: stats.birthtime || stats.mtime,
      // Note: Let's Encrypt certificates are valid for 90 days
      // Renewal is recommended at 60 days
      renewalRecommendedAt: new Date(stats.mtime.getTime() + (60 * 24 * 60 * 60 * 1000))
    };
  } catch (error) {
    return null;
  }
}

/**
 * Test certificate accessibility without loading into memory
 * Useful for startup diagnostics
 * 
 * @param {string} domain - Domain name (optional)
 * @returns {Object} Result with {available, readable, message}
 */
function testCertificateAccess(domain = null) {
  const domainName = domain || getDomainName();
  if (!domainName) {
    return {
      available: false,
      readable: false,
      message: 'No domain name configured'
    };
  }
  
  const certPaths = getCertificatePaths(domainName);
  if (!certPaths) {
    return {
      available: false,
      readable: false,
      message: `No certificates found for ${domainName}`
    };
  }
  
  try {
    // Test read permissions without loading full content
    fs.accessSync(certPaths.keyPath, fs.constants.R_OK);
    fs.accessSync(certPaths.certPath, fs.constants.R_OK);
    
    return {
      available: true,
      readable: true,
      message: `Certificates accessible for ${domainName}`,
      paths: certPaths
    };
  } catch (error) {
    return {
      available: true,
      readable: false,
      message: `Certificates found but not readable (permission denied): ${error.message}`,
      paths: certPaths
    };
  }
}

// Export functions
module.exports = {
  getHttpsOptions,
  isHttpsAvailable,
  getDomainName,
  getCertificatePaths,
  getCertificateInfo,
  testCertificateAccess
};
