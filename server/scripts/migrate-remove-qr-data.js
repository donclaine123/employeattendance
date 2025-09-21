/**
 * Migration script to remove qr_data column from qr_sessions table
 * This optimizes database storage by generating QR codes on-demand instead of storing them
 */

const { Pool } = require('pg');

// Create database connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://workline:secret@localhost:5432/workline'
});

async function migrateRemoveQrData() {
    console.log('🔄 Starting migration to remove qr_data column from qr_sessions...');
    
    try {
        // Start transaction
        await pool.query('BEGIN');
        
        // Check if qr_data column exists
        const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'qr_sessions' AND column_name = 'qr_data'
        `);
        
        if (columnCheck.rows.length === 0) {
            console.log('✅ qr_data column does not exist - migration already completed or not needed');
            await pool.query('ROLLBACK');
            return;
        }
        
        console.log('📊 Current qr_sessions structure:');
        const tableInfo = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'qr_sessions' 
            ORDER BY ordinal_position
        `);
        tableInfo.rows.forEach(row => {
            console.log(`  - ${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
        });
        
        // Count current records
        const countResult = await pool.query('SELECT COUNT(*) as count FROM qr_sessions');
        const recordCount = parseInt(countResult.rows[0].count);
        console.log(`📝 Found ${recordCount} existing QR session records`);
        
        if (recordCount > 0) {
            // Show sample of current data (without the large qr_data content)
            const sampleData = await pool.query(`
                SELECT qr_id, session_id, session_type, is_active, 
                       LENGTH(qr_data) as qr_data_size, expires_at, created_at
                FROM qr_sessions 
                ORDER BY created_at DESC 
                LIMIT 5
            `);
            
            console.log('📋 Sample of existing data:');
            sampleData.rows.forEach(row => {
                console.log(`  ID: ${row.qr_id}, Session: ${row.session_id}, Type: ${row.session_type}, Active: ${row.is_active}, QR Size: ${row.qr_data_size} chars`);
            });
            
            // Calculate space savings
            const spaceResult = await pool.query('SELECT SUM(LENGTH(qr_data)) as total_qr_size FROM qr_sessions');
            const totalSize = parseInt(spaceResult.rows[0].total_qr_size || 0);
            console.log(`💾 Space to be freed: ${Math.round(totalSize / 1024)} KB (${totalSize} characters)`);
        }
        
        // Remove the qr_data column
        console.log('🗑️ Removing qr_data column...');
        await pool.query('ALTER TABLE qr_sessions DROP COLUMN IF EXISTS qr_data');
        
        // Verify the column was removed
        const verifyRemoval = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'qr_sessions' AND column_name = 'qr_data'
        `);
        
        if (verifyRemoval.rows.length > 0) {
            throw new Error('qr_data column still exists after DROP operation');
        }
        
        // Show new structure
        console.log('📊 Updated qr_sessions structure:');
        const newTableInfo = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'qr_sessions' 
            ORDER BY ordinal_position
        `);
        newTableInfo.rows.forEach(row => {
            console.log(`  - ${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
        });
        
        // Verify data integrity
        const finalCount = await pool.query('SELECT COUNT(*) as count FROM qr_sessions');
        const finalRecordCount = parseInt(finalCount.rows[0].count);
        
        if (finalRecordCount !== recordCount) {
            throw new Error(`Data loss detected! Started with ${recordCount} records, now have ${finalRecordCount}`);
        }
        
        // Commit transaction
        await pool.query('COMMIT');
        
        console.log('✅ Migration completed successfully!');
        console.log(`📊 Preserved ${finalRecordCount} QR session records`);
        console.log('🎯 QR codes will now be generated on-demand from session_id');
        console.log(`💾 Database space optimized by removing stored QR image data`);
        
    } catch (error) {
        // Rollback on error
        await pool.query('ROLLBACK');
        console.error('❌ Migration failed:', error.message);
        console.error('🔄 Transaction rolled back - no changes made to database');
        throw error;
    }
}

// Run migration if called directly
if (require.main === module) {
    migrateRemoveQrData()
        .then(() => {
            console.log('🏁 Migration script completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Migration script failed:', error);
            process.exit(1);
        })
        .finally(() => {
            pool.end();
        });
}

module.exports = { migrateRemoveQrData };