// Test script to verify login endpoint returns cookies correctly
// Run: node test-login-cookies.js

const http = require('http');

async function testLogin() {
    console.log('\n=== Testing Login Endpoint for Cookies ===\n');
    
    const postData = JSON.stringify({
        email: 'hr@example.com',
        password: 'password123'
    });

    const options = {
        hostname: 'localhost',
        port: 5000,
        path: '/api/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'User-Agent': 'Test-Client/1.0'
        }
    };

    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            console.log(`STATUS: ${res.statusCode}`);
            console.log('\n--- RESPONSE HEADERS ---');
            Object.entries(res.headers).forEach(([key, val]) => {
                console.log(`${key}: ${val}`);
            });

            // Specifically look for Set-Cookie header
            console.log('\n--- COOKIES ANALYSIS ---');
            if (res.headers['set-cookie']) {
                console.log('✓ Set-Cookie headers found!');
                res.headers['set-cookie'].forEach((cookie, idx) => {
                    console.log(`  Cookie ${idx + 1}: ${cookie}`);
                });
            } else {
                console.log('❌ NO Set-Cookie header found!');
            }

            // Check CORS headers
            console.log('\n--- CORS ANALYSIS ---');
            console.log('Access-Control-Allow-Origin:', res.headers['access-control-allow-origin'] || 'MISSING');
            console.log('Access-Control-Allow-Credentials:', res.headers['access-control-allow-credentials'] || 'MISSING');

            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });

            res.on('end', () => {
                console.log('\n--- RESPONSE BODY ---');
                try {
                    const json = JSON.parse(body);
                    console.log(JSON.stringify(json, null, 2));
                } catch (e) {
                    console.log(body);
                }
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error(`Problem with request: ${e.message}`);
            reject(e);
        });

        console.log('Sending POST request to /api/login...\n');
        req.write(postData);
        req.end();
    });
}

testLogin().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
