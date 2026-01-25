const { supabase } = require('./server/conn-supabase');

async function checkDepartments() {
  try {
    console.log('Fetching departments...');
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .limit(1);

    if (error) {
      console.error('Error fetching departments:', JSON.stringify(error, null, 2));
    } else {
      console.log('Departments data:', JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

checkDepartments();
