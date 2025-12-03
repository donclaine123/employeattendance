require('dotenv').config({ path: 'd:\\THESIS 1\\employeattendance\\.env' });
const { createClient } = require('@supabase/supabase-js');

let SUPABASE_URL = process.env.SUPABASE_URL || process.env.LOCAL_SUPABASE_URL;
const SECRET_KEYS = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SECRET_KEYS;

if (SUPABASE_URL && SUPABASE_URL.includes('host.docker.internal')) {
    SUPABASE_URL = SUPABASE_URL.replace('host.docker.internal', 'localhost');
}

console.log('Checking departments...');
console.log('URL:', SUPABASE_URL);
console.log('Key:', SECRET_KEYS ? 'Set' : 'Not Set');

if (!SUPABASE_URL || !SECRET_KEYS) {
    console.error('Missing credentials');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SECRET_KEYS);

async function check() {
    const { data, error } = await supabase
        .from('departments')
        .select('*');

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Departments found:', data.length);
        console.log(JSON.stringify(data, null, 2));
    }
}

check();
