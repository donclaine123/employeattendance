// Bonjour/mDNS Service Advertiser for workline.local
// Simple and reliable service discovery

const dgram = require('dgram');
const os = require('os');

// Get local IP address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Get first non-internal IPv4 address
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

const localIP = getLocalIP();
const hostname = 'workline';
const serviceName = '_http._tcp.local';

console.log(`
╔════════════════════════════════════════════════════════════╗
║  Bonjour Service Advertiser                                ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  Service: workline                                         ║
║  Type: HTTP (_http._tcp)                                  ║
║  Local IP: ${localIP}                                       ║
║  Hostname: ${hostname}.local                                    ║
║                                                            ║
║  Access from any device on WiFi:                          ║
║  → https://workline.local                                 ║
║  → https://${localIP}                              ║
║                                                            ║
║  Status: Starting advertiser...                           ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

// Build mDNS response packet (simplified)
function buildMDNSResponse(name, ip) {
    try {
        // mDNS packet structure (simplified)
        const packet = Buffer.alloc(512);
        let offset = 0;

        // Transaction ID
        packet.writeUInt16BE(0, offset); offset += 2;
        // Flags: response (0x8400), authoritative
        packet.writeUInt16BE(0x8400, offset); offset += 2;
        // Questions: 0
        packet.writeUInt16BE(0, offset); offset += 2;
        // Answer RRs: 1
        packet.writeUInt16BE(1, offset); offset += 2;
        // Authority RRs: 0
        packet.writeUInt16BE(0, offset); offset += 2;
        // Additional RRs: 0
        packet.writeUInt16BE(0, offset); offset += 2;

        // Answer section - A record for hostname
        const labels = name.split('.');
        for (const label of labels) {
            packet.writeUInt8(label.length, offset);
            offset += 1;
            offset += packet.write(label, offset);
        }
        packet.writeUInt8(0, offset); offset += 1;

        // Type: A (1)
        packet.writeUInt16BE(1, offset); offset += 2;
        // Class: IN (1)
        packet.writeUInt16BE(1, offset); offset += 2;
        // TTL: 120 seconds
        packet.writeUInt32BE(120, offset); offset += 4;
        // Data length: 4
        packet.writeUInt16BE(4, offset); offset += 2;

        // IP address
        const ipParts = ip.split('.').map(p => parseInt(p));
        for (const part of ipParts) {
            packet.writeUInt8(part, offset);
            offset += 1;
        }

        return packet.slice(0, offset);
    } catch (err) {
        console.error('[Bonjour] Error building mDNS packet:', err.message);
        return null;
    }
}

// Simple mDNS announcer
let advertisementInterval = null;
let socket = null;

function startBonjour() {
    try {
        // Create UDP socket for mDNS
        socket = dgram.createSocket('udp4');

        socket.on('error', (err) => {
            console.error('[Bonjour] Socket error:', err.message);
        });

        // Bind to mDNS port
        socket.bind(5353, '224.0.0.251', () => {
            console.log('[Bonjour] ✅ mDNS socket bound successfully');
        });

        // Announce service periodically
        const announcement = buildMDNSResponse(`${hostname}.local`, localIP);
        
        if (announcement) {
            // Send announcement every 30 seconds
            advertisementInterval = setInterval(() => {
                try {
                    socket.send(announcement, 0, announcement.length, 5353, '224.0.0.251', (err) => {
                        if (!err) {
                            console.log('[Bonjour] 📢 Service announcement sent');
                        } else {
                            console.error('[Bonjour] Send error:', err.message);
                        }
                    });
                } catch (err) {
                    console.error('[Bonjour] Announcement error:', err.message);
                }
            }, 30000);

            // Send first announcement immediately
            socket.send(announcement, 0, announcement.length, 5353, '224.0.0.251', (err) => {
                if (err) {
                    console.error('[Bonjour] Initial announcement error:', err.message);
                } else {
                    console.log('[Bonjour] ✅ Initial service announcement sent');
                }
            });

            console.log('[Bonjour] ✅ Bonjour advertiser started');
            return true;
        }

        return false;
    } catch (err) {
        console.error('[Bonjour] Failed to start advertiser:', err.message);
        return false;
    }
}

function stopBonjour() {
    try {
        if (advertisementInterval) {
            clearInterval(advertisementInterval);
        }
        if (socket) {
            socket.close();
        }
        console.log('[Bonjour] ⏹️  Advertiser stopped');
    } catch (err) {
        console.error('[Bonjour] Error stopping advertiser:', err.message);
    }
}

// Start on module load
const bonjourStarted = startBonjour();

// Handle graceful shutdown
process.on('SIGINT', stopBonjour);
process.on('SIGTERM', stopBonjour);

module.exports = {
    localIP,
    hostname,
    bonjourStarted,
    startBonjour,
    stopBonjour
};
