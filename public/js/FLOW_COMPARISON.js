// Diagnostic: Compare employee edit vs department edit flows
// Run this in browser console to understand the difference

console.log('=== FLOW COMPARISON ===\n');

console.log('1. EMPLOYEE EDIT FLOW:');
console.log('   Endpoint: PUT /api/hr/employees/:id');
console.log('   Auth: requireAuth([\'hr\', \'superadmin\'])');
console.log('   Checks: Token → sessionId → role → updateEmployee()');

console.log('\n2. DEPARTMENT EDIT FLOW:');
console.log('   Endpoint: PUT /api/hr/departments/:id');
console.log('   Auth: requireAuth([\'hr\', \'superadmin\'])');
console.log('   Checks: Token → sessionId → role → updateDepartment()');

console.log('\n3. AUTHENTICATION COMPARISON:');
console.log('   Both endpoints use SAME middleware (requireAuth)');
console.log('   Both require: valid JWT + sessionId field + role check');
console.log('   => Both should FAIL IDENTICALLY if token lacks sessionId');

console.log('\n4. QUESTION: Why would ONE work but not the OTHER?');
console.log('   Possible answers:');
console.log('   A) Different tokens used for each operation?');
console.log('   B) One endpoint called before token expires?');
console.log('   C) Cache/stale code in browser?');
console.log('   D) Different error happening at Supabase helper level?');

console.log('\n5. WHAT TO CHECK:');
console.log('   - Open DevTools → Network tab');
console.log('   - Try employee edit → Check request headers & response');
console.log('   - Try department edit → Check request headers & response');
console.log('   - Compare: Do both send same Authorization/Cookie headers?');
console.log('   - If both fail: What is the exact error message?');

console.log('\n6. CHECK ACCESS TOKEN:');
const getToken = () => {
    const cookies = document.cookie.split(';');
    const tokenCookie = cookies.find(c => c.includes('workline_access_token'));
    if (tokenCookie) {
        const token = tokenCookie.split('=')[1];
        const parts = token.split('.');
        try {
            const decoded = JSON.parse(atob(parts[1]));
            console.log('\n✓ Access Token Payload:');
            console.log('  - Has sessionId?', !!decoded.sessionId);
            console.log('  - sessionId value:', decoded.sessionId);
            console.log('  - Role:', decoded.role);
            console.log('  - ID:', decoded.id);
            return decoded;
        } catch (e) {
            console.error('Failed to decode token:', e);
        }
    } else {
        console.log('\n❌ Access token cookie NOT FOUND');
    }
};

const tokenData = getToken();

console.log('\n=== END DIAGNOSTIC ===');
