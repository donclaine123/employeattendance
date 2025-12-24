const { supabase } = require('../conn-supabase');

async function fixDepartmentSequence() {
  try {
    console.log('Checking departments table...');
    
    // Get the max dept_id
    const { data, error } = await supabase
      .from('departments')
      .select('dept_id, dept_name')
      .order('dept_id', { ascending: false });

    if (error) {
      console.error('Error fetching departments:', error);
      return;
    }

    console.log('Current departments:', data);
    const maxId = data.length > 0 ? data[0].dept_id : 0;
    console.log('Max dept_id:', maxId);
    console.log('Next sequence value should be:', maxId + 1);

    // Try to call the RPC function
    const { error: rpcError } = await supabase.rpc('reset_departments_sequence_safe');

    if (rpcError) {
      console.log('RPC error:', rpcError);
      console.log('\nTry running this SQL manually in Supabase dashboard:');
      console.log(`SELECT setval('departments_dept_id_seq', ${maxId + 1});`);
    } else {
      console.log('✓ Sequence reset successfully!');
    }
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

fixDepartmentSequence();
