/**
 * Bidirectional Sync Service
 * Synchronizes data between local PostgreSQL and Supabase in real-time
 * 
 * Strategy:
 * 1. Local is PRIMARY during on-site usage
 * 2. Cloud is PRIMARY during off-site usage
 * 3. Conflict resolution: Last-write-wins with timestamp comparison
 * 4. Uses Supabase JavaScript SDK (more reliable than REST API for updates)
 */

const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

class SyncService {
    constructor() {
        // Local PostgreSQL connection (use 'postgres' hostname when running in Docker)
        const dbHost = process.env.NODE_ENV === 'development' && !process.env.DB_HOST
            ? 'postgres'  // Docker service name
            : (process.env.DB_HOST || 'localhost');

        this.localPool = new Pool({
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'postgres',
            host: dbHost,
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || 'postgres',
        });

        // Supabase REST API credentials
        // STRICTLY use CLOUD_SUPABASE_ vars for sync target. 
        // We do not fallback to SUPABASE_URL because that is now used for Local Supabase (Login/Auth).
        this.supabaseUrl = process.env.CLOUD_SUPABASE_URL;
        this.supabaseServiceKey = process.env.CLOUD_SUPABASE_SERVICE_ROLE_KEY;
        this.supabaseAnonKey = process.env.CLOUD_SUPABASE_ANON_KEY;

        // Initialize Supabase client with service role key (unrestricted access)
        this.supabaseClient = (this.supabaseUrl && this.supabaseServiceKey) ?
            createClient(this.supabaseUrl, this.supabaseServiceKey) : null;

        // Check if Supabase is configured
        this.supabaseEnabled = !!(this.supabaseUrl && this.supabaseServiceKey && this.supabaseAnonKey);
        if (this.supabaseEnabled && this.supabaseClient) {
            console.log('[Sync] Using Supabase JavaScript SDK for updates');
        }

        this.isSyncing = false;
        this.syncInterval = Number.parseInt(process.env.SYNC_INTERVAL || '3000', 10); // Sync every 3 seconds (default)
        this.syncConflictResolution = 'last_write_wins';
        this.syncTimeoutSeconds = 30;
        this.syncTimers = {
            general: null,
            qrSessions: null
        };
        this.hasStartedContinuousSync = false;
        // Table sync order matters - respect foreign key dependencies.
        // This is the baseline queue order; dependency readiness decides whether a table can run.
        this.tables = [
            'roles',                 // 1. Base table
            'users',                 // 2. Depends on roles
            'departments',           // 3. Depends on users
            'employees',             // 4. Depends on users + departments
            'curriculum_templates',  // 5. Depends on users + departments
            'qr_sessions',           // 6. Independent table
            'user_sessions',         // 7. Depends on users
            'refresh_tokens',        // 8. Depends on users + user_sessions
            'invitations',           // 9. Depends on roles + departments + users
            'attendance',            // 10. Depends on employees + users + qr_sessions
            'requests',              // 11. Depends on employees + users
            'report_downloads',      // 12. Depends on users + departments
            'audit_logs',            // 13. Depends on users
            'system_settings'        // 14. Independent table
        ];

        // Explicit foreign-key dependencies used to decide if a table can sync yet.
        // Self-references are intentionally omitted so they do not deadlock the queue.
        this.tableDependencies = {
            'roles': [],
            'users': ['roles'],
            'departments': ['users'],
            'employees': ['users', 'departments'],
            'curriculum_templates': ['users', 'departments'],
            'qr_sessions': [],
            'user_sessions': ['users'],
            'refresh_tokens': ['users', 'user_sessions'],
            'invitations': ['roles', 'departments', 'users'],
            'attendance': ['employees', 'users', 'qr_sessions'],
            'requests': ['employees', 'users'],
            'report_downloads': ['users', 'departments'],
            'audit_logs': ['users'],
            'system_settings': []
        };

        // Map table names to their primary key columns
        this.primaryKeys = {
            'roles': 'role_id',
            'users': 'user_id',
            'employees': 'employee_id',
            'attendance': 'attendance_id',
            'qr_sessions': 'session_id',
            'user_sessions': 'session_id',
            'refresh_tokens': 'id',
            'invitations': 'id',
            'departments': 'dept_id',
            'system_settings': 'setting_key',
            'audit_logs': 'log_id',
            'curriculum_templates': 'template_id',
            'requests': 'request_id',
            'report_downloads': 'download_id'
        };

        // Nullable Foreign Keys that can be temporarily set to NULL during sync
        // to resolve circular dependencies or missing parent records
        this.nullableFks = {
            'users': ['created_by'],
            'departments': ['head_id'],
            'employees': ['dept_id', 'created_by'],
            'qr_sessions': [],
            'attendance': ['checkin_session_id', 'checkout_session_id', 'overridden_by'],
            'invitations': ['dept_id', 'created_by', 'used_by'],
            'refresh_tokens': ['session_id'],

            'audit_logs': ['user_id'],
            'requests': ['approved_by'],
            'curriculum_templates': ['created_by', 'dept_id']
        };

        // NOT NULL columns per table (excluding primary keys which are always NOT NULL)
        // These columns MUST have values during sync, or the record will be skipped
        this.notNullColumns = {
            'attendance': ['date', 'employee_id'], // These are critical
            'invitations': ['email', 'role_id'], // Email is required
            'departments': ['dept_name'], // Department name is required
            'users': ['username'] // Email/Username is required
        };

        // Adaptive batch sizes based on table size
        // Larger tables use bigger batches for faster sync
        this.batchSizes = {
            'qr_sessions': 500,           // Very large table (50K+ records)
            'audit_logs': 500,            // Large table
            'attendance': 250,            // Medium-large table
            'refresh_tokens': 250,        // Medium table

            'invitations': 150,           // Small-medium table
            'requests': 150,
            'user_sessions': 150,
            'employees': 100,             // Small table
            'departments': 100,
            'users': 100,
            'curriculum_templates': 50,
            'report_downloads': 50,
            'system_settings': 100,
            'roles': 50                   // Very small table
        };
    }

    /**
     * Get adaptive batch size for a table
     */
    getBatchSize(tableName) {
        return this.batchSizes[tableName] || 100; // Default to 100 if not specified
    }

    /**
     * Get FK parent tables that must be synced before this table.
     */
    getParentTables(tableName) {
        const parentTables = this.tableDependencies[tableName] || [];
        return parentTables.filter(parentTable => this.tables.includes(parentTable));
    }

    /**
     * Check whether a table still has unsynced local rows.
     */
    async hasPendingLocalRows(tableName) {
        try {
            const result = await this.localPool.query(`
                SELECT 1
                FROM ${tableName}
                WHERE is_synced = false
                LIMIT 1
            `);
            return result.rowCount > 0;
        } catch (error) {
            return false;
        }
    }

    /**
     * Return parent tables that still need to finish syncing locally.
     */
    async getBlockedParentTables(tableName) {
        const blockedParents = [];
        for (const parentTable of this.getParentTables(tableName)) {
            if (await this.hasPendingLocalRows(parentTable)) {
                blockedParents.push(parentTable);
            }
        }
        return blockedParents;
    }

    /**
     * Initialize sync service
     */
    async init() {
        console.log('[Sync] Initializing bidirectional sync service...');
        console.log('[Sync] Configured Sync Target URL:', this.supabaseUrl);
        console.log('[Sync] Using Cloud Vars:', process.env.CLOUD_SUPABASE_URL ? 'YES' : 'NO');
        console.log('[Sync] Instance supabaseEnabled:', this.supabaseEnabled);
        console.log('[Sync] Instance supabaseServiceKey:', this.supabaseServiceKey ? 'SET (' + this.supabaseServiceKey.length + ' chars)' : 'NULL');

        try {
            // Check if we can connect to local database
            const testClient = await this.localPool.connect();
            testClient.release();

            // Add sync timestamp column to all tables if not exists
            await this.addSyncColumns();

            // Load persisted runtime settings
            await this.loadRuntimeSettings();

            // Start continuous sync
            this.startContinuousSync();

            console.log('[Sync] Service initialized successfully');
            return true;
        } catch (error) {
            console.error('[Sync] Initialization error:', error.message);
            // Don't throw - allow app to continue without sync
            return false;
        }
    }

    /**
     * Load runtime sync configuration from system settings
     */
    async loadRuntimeSettings() {
        try {
            const { getSystemSettings } = require('../services/adminService');
            const settings = await getSystemSettings();
            this.applyRuntimeSettings(settings);
        } catch (error) {
            console.warn('[Sync] Unable to load runtime settings, using defaults:', error.message);
        }
    }

    /**
     * Apply runtime sync settings and restart intervals when needed
     */
    applyRuntimeSettings(settings = {}) {
        const syncIntervalSeconds = Number.parseInt(settings.sync_interval_seconds, 10);
        if (Number.isInteger(syncIntervalSeconds) && syncIntervalSeconds >= 3) {
            this.syncInterval = syncIntervalSeconds * 1000;
        }

        const syncTimeoutSeconds = Number.parseInt(settings.sync_timeout_seconds, 10);
        if (Number.isInteger(syncTimeoutSeconds) && syncTimeoutSeconds >= 5) {
            this.syncTimeoutSeconds = syncTimeoutSeconds;
        }

        if (settings.sync_conflict_resolution) {
            this.syncConflictResolution = settings.sync_conflict_resolution;
        }

        if (this.hasStartedContinuousSync) {
            this.restartContinuousSync();
        }
    }

    /**
     * Clear all active sync timers
     */
    clearContinuousSyncTimers() {
        Object.values(this.syncTimers).forEach((timerId) => {
            if (timerId) {
                clearInterval(timerId);
            }
        });

        this.syncTimers.general = null;
        this.syncTimers.qrSessions = null;
    }

    /**
     * Restart continuous sync after configuration changes
     */
    restartContinuousSync() {
        this.clearContinuousSyncTimers();
        this.startContinuousSync();
    }

    /**
     * Add sync tracking columns to tables
     */
    async addSyncColumns() {
        const client = await this.localPool.connect();
        try {
            for (const table of this.tables) {
                try {
                    // Add sync_updated_at column for conflict resolution
                    await client.query(`
                        ALTER TABLE ${table}
                        ADD COLUMN IF NOT EXISTS sync_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    `);

                    // Add is_synced flag
                    await client.query(`
                        ALTER TABLE ${table}
                        ADD COLUMN IF NOT EXISTS is_synced BOOLEAN DEFAULT false
                    `);
                } catch (tableError) {
                    // Table might not exist yet - that's OK, skip it
                    if (tableError.message && tableError.message.includes('does not exist')) {
                        console.log(`[Sync] Table ${table} not yet created, skipping sync columns`);
                    } else if (tableError.message && (tableError.message.includes('must be owner') || tableError.message.includes('permission denied'))) {
                        // System tables like roles may not allow ALTER - that's OK
                        console.log(`[Sync] Cannot modify ${table} (system table or permission denied), skipping sync columns`);
                    } else {
                        console.error(`[Sync] Error adding columns to ${table}:`, tableError.message);
                    }
                }
            }
            console.log('[Sync] Sync columns added to all available tables');
        } catch (error) {
            console.error('[Sync] Error in addSyncColumns:', error.message);
        } finally {
            client.release();
        }
    }

    /**
     * Start continuous bidirectional sync
     */
    startContinuousSync() {
        this.clearContinuousSyncTimers();
        console.log('[Sync] Starting continuous sync intervals...');

        // General sync every 3 seconds (all tables)
        this.syncTimers.general = setInterval(async () => {
            if (!this.isSyncing) {
                try {
                    await this.syncAllTables();
                } catch (error) {
                    console.error('[Sync] Error in general sync:', error.message);
                }
            }
        }, this.syncInterval);

        // HIGH PRIORITY: Sync QR sessions every 500ms (10x faster)
        // QR sessions need to sync immediately for real-time display
        this.syncTimers.qrSessions = setInterval(async () => {
            if (!this.isSyncing) {
                try {
                    await this.syncTable('qr_sessions');
                } catch (error) {
                    console.error('[Sync] Error in QR sessions sync:', error.message);
                }
            }
        }, 500);

        this.hasStartedContinuousSync = true;
        console.log('[Sync] ✓ Continuous sync started (general: ' + this.syncInterval + 'ms, QR sessions: 500ms)');
    }

    /**
     * Sync all tables bidirectionally
     */
    async syncAllTables() {
        this.isSyncing = true;
        const syncStartTime = Date.now();
        let syncCount = 0;
        try {
            let pendingTables = [...this.tables];
            let passNumber = 1;

            while (pendingTables.length > 0) {
                const nextPendingTables = [];
                let syncedThisPass = 0;

                console.log(`[Sync] Starting dependency-aware pass ${passNumber} with ${pendingTables.length} table(s)`);

                for (const table of pendingTables) {
                    const blockedParents = await this.getBlockedParentTables(table);
                    if (blockedParents.length > 0) {
                        console.log(`[Sync] Deferring ${table} until parent tables are synced: ${blockedParents.join(', ')}`);
                        nextPendingTables.push(table);
                        continue;
                    }

                    try {
                        await this.syncTable(table);
                        syncCount++;
                        syncedThisPass++;
                    } catch (tableError) {
                        console.error(`[Sync] Failed to sync ${table}:`, tableError.message);
                    }
                }

                if (nextPendingTables.length === 0) {
                    break;
                }

                if (syncedThisPass === 0) {
                    console.log(`[Sync] Stopping queue pass ${passNumber}; remaining tables are still blocked: ${nextPendingTables.join(', ')}`);
                    break;
                }

                pendingTables = nextPendingTables;
                passNumber++;
            }

            const elapsed = Date.now() - syncStartTime;
            console.log(`[Sync] Completed sync of ${syncCount}/${this.tables.length} tables in ${elapsed}ms`);
        } catch (error) {
            console.error('[Sync] Error during sync:', error.message);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Sync individual table (local → cloud → local with conflict resolution)
     */
    async syncTable(tableName) {
        try {
            const primaryKey = this.primaryKeys[tableName] || 'id';

            // Step 1: Get unsynced changes from local
            const localChanges = await this.getLocalChanges(tableName, primaryKey);

            // Step 2: Push local changes to cloud
            if (localChanges.length > 0) {
                console.log(`[Sync] Pushing ${localChanges.length} local changes to cloud for ${tableName}`);
                await this.pushToCloud(tableName, localChanges, primaryKey);
            }

            // Step 3: Get changes from cloud
            const cloudChanges = await this.getCloudChanges(tableName);

            // Step 4: Pull cloud changes to local
            if (cloudChanges.length > 0) {
                console.log(`[Sync] Pulling ${cloudChanges.length} cloud changes to local for ${tableName}`);
                await this.pullFromCloud(tableName, cloudChanges, primaryKey);
            }

        } catch (error) {
            console.error(`[Sync] Error syncing table ${tableName}:`, error.message);
        }
    }

    /**
     * Get unsynced changes from local database
     */
    async getLocalChanges(tableName, primaryKey = 'id') {
        try {
            const batchSize = this.getBatchSize(tableName);
            const result = await this.localPool.query(`
                SELECT * FROM ${tableName}
                WHERE is_synced = false
                LIMIT ${batchSize}
            `);
            return result.rows;
        } catch (error) {
            // Table might not have is_synced column
            return [];
        }
    }

    /**
     * Push local changes to Supabase via REST API
     * Batches large syncs to prevent API overload (1000 records per batch)
     */
    async pushToCloud(tableName, records, primaryKey = 'id') {
        if (!this.supabaseEnabled) {
            console.log(`[Sync] Supabase not configured, skipping push for ${tableName}`);
            return;
        }

        const client = await this.localPool.connect();
        try {
            // Set session variable to prevent trigger from resetting is_synced
            await client.query("SET LOCAL app.syncing = 'true'");

            const BATCH_SIZE = this.getBatchSize(tableName) * 4; // Push batches 4x the pull size
            const totalRecords = records.length;

            // Process in batches
            for (let i = 0; i < totalRecords; i += BATCH_SIZE) {
                const batch = records.slice(i, i + BATCH_SIZE);
                await this.pushBatchToCloud(tableName, batch, primaryKey, client);
            }
        } finally {
            client.release();
        }
    }

    /**
     * Push a batch of records to Supabase
     */
    async pushBatchToCloud(tableName, records, primaryKey = 'id', client) {
        try {
            // Use Service Role Key for system sync (bypasses RLS)
            // Supabase REST API requires BOTH Authorization header AND apikey header
            const headers = {
                'Authorization': `Bearer ${this.supabaseServiceKey}`,
                'apikey': this.supabaseServiceKey,  // Required for REST API
                'Content-Type': 'application/json',
                'x-sync-source': 'server'
            };

            for (const record of records) {
                const pkValue = record[primaryKey];

                // Check if record exists in cloud
                const url = `${this.supabaseUrl}/rest/v1/${tableName}?${primaryKey}=eq.${pkValue}&select=*`;
                const checkResponse = await fetch(url, { headers });

                let existing = [];
                try {
                    existing = await checkResponse.json();
                } catch (e) {
                    console.error(`[Sync] Error parsing check response for ${tableName}:`, e.message);
                }

                if (existing && existing.length > 0) {
                    // Record exists - update if local is newer OR if local has pending changes (is_synced=false)
                    const localTime = new Date(record.sync_updated_at).getTime();
                    const cloudTime = new Date(existing[0].sync_updated_at).getTime();
                    const hasPendingChanges = record.is_synced === false;

                    // Push if local is newer OR if there are pending local changes
                    if (localTime > cloudTime || hasPendingChanges) {
                        // Send all columns except excluded ones
                        const excludedCols = this.getExcludedColumns(tableName);
                        const dataToSend = {};
                        Object.keys(record).forEach(key => {
                            if (!excludedCols[key]) {
                                dataToSend[key] = record[key];
                            }
                        });
                        // Explicitly mark as synced in cloud
                        dataToSend['is_synced'] = true;
                        dataToSend['sync_updated_at'] = record['sync_updated_at'];

                        const updateUrl = `${this.supabaseUrl}/rest/v1/${tableName}?${primaryKey}=eq.${pkValue}`;
                        const updateResponse = await fetch(updateUrl, {
                            method: 'PATCH',
                            headers,
                            body: JSON.stringify(dataToSend)
                        });

                        if (!updateResponse.ok) {
                            const errorText = await updateResponse.text();
                            console.error(`[Sync] Failed to update ${tableName}.${pkValue} in cloud: HTTP ${updateResponse.status}`, errorText);
                        } else {
                            // Mark as synced in local after successful push
                            // Update both is_synced AND sync_updated_at to indicate this is a sync operation
                            await client.query(`UPDATE ${tableName} SET is_synced = true, sync_updated_at = $1 WHERE ${primaryKey} = $2`, [new Date().toISOString(), pkValue]);
                            // console.log(`[Sync] Successfully updated ${tableName}.${pkValue} is_synced=true in cloud`);
                        }
                    }
                } else {
                    // Record doesn't exist - insert (or upsert if it was created concurrently)
                    const excludedCols = this.getExcludedColumns(tableName);
                    const dataToSend = {};
                    Object.keys(record).forEach(key => {
                        if (!excludedCols[key]) {
                            dataToSend[key] = record[key];
                        }
                    });
                    // Explicitly mark as synced in cloud
                    dataToSend['is_synced'] = true;
                    dataToSend['sync_updated_at'] = record['sync_updated_at'];

                    const insertUrl = `${this.supabaseUrl}/rest/v1/${tableName}`;
                    const insertResponse = await fetch(insertUrl, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(dataToSend)
                    });

                    if (!insertResponse.ok) {
                        const errorText = await insertResponse.text();
                        const status = insertResponse.status;
                        let errorPayload = null;

                        try {
                            errorPayload = JSON.parse(errorText);
                        } catch (parseError) {
                            errorPayload = null;
                        }

                        // Handle 409 Conflict by re-checking the cloud row before marking local data as synced.
                        if (status === 409) {
                            if (errorPayload && errorPayload.code === '23503') {
                                console.warn(`[Sync] FK conflict for ${tableName}.${pkValue}; leaving local row unsynced until parents are available: ${errorText}`);
                            } else {
                                console.warn(`[Sync] Insert conflict for ${tableName}.${pkValue} (409): ${errorText}`);

                                const confirmUrl = `${this.supabaseUrl}/rest/v1/${tableName}?${primaryKey}=eq.${pkValue}&select=${primaryKey}`;
                                const confirmResponse = await fetch(confirmUrl, { headers });
                                let cloudRowExists = false;

                                if (confirmResponse.ok) {
                                    const confirmRows = await confirmResponse.json();
                                    cloudRowExists = Array.isArray(confirmRows) && confirmRows.length > 0;
                                }

                                if (cloudRowExists) {
                                    console.log(`[Sync] Confirmed ${tableName}.${pkValue} exists in cloud after 409, marking as synced locally`);
                                    await client.query(`UPDATE ${tableName} SET is_synced = true, sync_updated_at = CURRENT_TIMESTAMP WHERE ${primaryKey} = $1`, [pkValue]);
                                } else {
                                    console.warn(`[Sync] 409 for ${tableName}.${pkValue} could not be confirmed in cloud. Leaving local row unsynced.`);
                                }
                            }
                        } else {
                            console.error(`[Sync] Failed to insert ${tableName}.${pkValue} to cloud: HTTP ${status}`, errorText);
                        }
                    } else {
                        // Mark as synced in local after successful push
                        await client.query(`UPDATE ${tableName} SET is_synced = true, sync_updated_at = CURRENT_TIMESTAMP WHERE ${primaryKey} = $1`, [pkValue]);
                        // console.log(`[Sync] Successfully inserted ${tableName}.${pkValue} is_synced=true in cloud`);
                    }
                }
            }

            // console.log(`[Sync] Pushed ${records.length} changes to cloud for ${tableName}`);
        } catch (error) {
            console.error(`[Sync] Error pushing batch to cloud (${tableName}):`, error.message, error.code);
        }
    }

    /**
     * Columns that should never be sent to cloud (generated columns, computed fields, etc.)
     */
    getExcludedColumns(tableName) {
        const excluded = {
            'is_synced': true,
            'sync_updated_at': true,
            'created_at': true,  // Let cloud manage its own timestamps
            'updated_at': true,
        };

        // Table-specific excluded columns (generated columns, computed fields)
        const tableSpecific = {
            'employees': {
                'full_name': true,  // Generated column on cloud
            },
            'users': {
                'created_at': true,
            }
        };

        return { ...excluded, ...(tableSpecific[tableName] || {}) };
    }

    /**
     * Get changes from Supabase via REST API
     */
    async getCloudChanges(tableName) {
        if (!this.supabaseEnabled) {
            return [];
        }

        try {
            const primaryKey = this.primaryKeys[tableName] || 'id';
            // Use Service Role Key for system sync (bypasses RLS)
            // Supabase REST API requires BOTH Authorization header AND apikey header
            // NOTE: Don't order by sync_updated_at since it may not exist in Supabase yet
            // Filter by is_synced=false to only get unsynced records
            // Order by primary key to respect self-referencing dependencies (e.g. users.created_by)
            const batchSize = this.getBatchSize(tableName);
            const url = `${this.supabaseUrl}/rest/v1/${tableName}?is_synced=eq.false&order=${primaryKey}.asc&limit=${batchSize}`;

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.supabaseServiceKey}`,
                    'apikey': this.supabaseServiceKey,  // Required for REST API
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[Sync] Supabase error (${tableName}): HTTP ${response.status}`, errorText.substring(0, 200));
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return data || [];
        } catch (error) {
            console.error(`[Sync] Error fetching cloud changes (${tableName}):`, error.message, error.code);
            return [];
        }
    }

    /**
     * Pull cloud changes to local database
     * Sets is_synced = true for pulled data (no need to push back)
     * Then updates Supabase to is_synced = true as well (prevents infinite loop)
     */
    async pullFromCloud(tableName, records, primaryKey = 'id') {
        const client = await this.localPool.connect();

        try {
            // Set session variable to prevent trigger from resetting is_synced
            await client.query("SET LOCAL app.syncing = 'true'");

            // Get local table columns
            const localColumnsResult = await client.query(`
                SELECT column_name FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = $1
            `, [tableName]);

            const localColumns = new Set(localColumnsResult.rows.map(row => row.column_name));

            // Track ALL record IDs we're pulling (regardless of insert/update)
            // Only mark as synced in cloud if we successfully inserted/updated with ALL fields
            const fullySyncedIds = [];

            for (const record of records) {
                const pkValue = record[primaryKey];
                let isPartialSuccess = false;

                // Check if record exists locally
                const localResult = await client.query(`
                    SELECT * FROM ${tableName} WHERE ${primaryKey} = $1
                `, [pkValue]);

                if (localResult.rows.length > 0) {
                    // Record exists - update if cloud is newer OR if local is a partial insert and cloud has complete data
                    const localRecord = localResult.rows[0];

                    // Check if local is a partial insert (has null FK values)
                    const nullableFks = this.nullableFks[tableName] || [];
                    const hasNullFks = nullableFks.some(fk => localRecord[fk] === null);

                    // Check if cloud has the complete data (non-null FKs)
                    const cloudHasCompleteFks = nullableFks.some(fk => record[fk] !== null && record[fk] !== undefined);

                    // Update if: Cloud is newer OR (Local has nulls AND Cloud has complete data)
                    const shouldUpdate = (record.sync_updated_at > localRecord.sync_updated_at) ||
                        (hasNullFks && cloudHasCompleteFks);

                    if (shouldUpdate) {
                        // Only update columns that exist in local schema (excluding sync metadata)
                        const columns = Object.keys(record)
                            .filter(col => col !== primaryKey && localColumns.has(col) && col !== 'is_synced' && col !== 'sync_updated_at');

                        if (columns.length > 0) {
                            const values = columns.map(col => {
                                const value = record[col];
                                // Convert jsonb values - ensure they're proper JSON
                                if (tableName === 'system_settings' && col === 'setting_value') {
                                    if (typeof value === 'string') {
                                        try {
                                            return JSON.stringify(JSON.parse(value));
                                        } catch {
                                            return JSON.stringify(value);
                                        }
                                    }
                                    return JSON.stringify(value);
                                }
                                return value;
                            });
                            const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');

                            try {
                                // Update with is_synced = true (pulled data is already synced)
                                await client.query(`
                                    UPDATE ${tableName}
                                    SET ${setClause}, is_synced = true, sync_updated_at = $${columns.length + 1}
                                    WHERE ${primaryKey} = $${columns.length + 2}
                                `, [...values, record.sync_updated_at || new Date(), pkValue]);
                                fullySyncedIds.push(pkValue);
                            } catch (updateError) {
                                // If update fails (e.g. FK violation), try updating without nullable FKs
                                if (updateError.code === '23503') { // Foreign key violation
                                    await this.handlePartialUpdate(client, tableName, primaryKey, pkValue, record, localColumns, columns);
                                    isPartialSuccess = true;
                                } else {
                                    console.error(`[Sync] Update failed for ${tableName}.${pkValue}: ${updateError.message}`);
                                }
                            }
                        }
                    } else {
                        // Even if cloud is not newer, only mark as synced if not already a partial insert
                        // Partial inserts (with nullified FKs) should stay unsynced until complete data arrives
                        if (localRecord.is_synced === false) {
                            // This is a partial insert - DON'T mark it as synced yet
                            console.log(`[Sync] Skipping sync mark for ${tableName}.${pkValue} (partial insert, waiting for dependencies)`);
                        } else {
                            // This is a normal record - mark as synced
                            await client.query(`
                                UPDATE ${tableName}
                                SET is_synced = true, sync_updated_at = $1
                                WHERE ${primaryKey} = $2
                            `, [record.sync_updated_at || new Date(), pkValue]);
                            fullySyncedIds.push(pkValue);
                        }
                    }
                } else {
                    // Record doesn't exist - insert only columns that exist locally
                    const columns = Object.keys(record)
                        .filter(col => localColumns.has(col) && col !== 'is_synced' && col !== 'sync_updated_at');

                    // Check if any NOT NULL columns are missing or NULL
                    const notNullCols = this.notNullColumns[tableName] || [];
                    const missingNotNullCols = [];
                    for (const notNullCol of notNullCols) {
                        if (!columns.includes(notNullCol) || record[notNullCol] === null || record[notNullCol] === undefined) {
                            missingNotNullCols.push(notNullCol);
                        }
                    }

                    if (missingNotNullCols.length > 0) {
                        console.warn(`[Sync] Skipping insert for ${tableName}.${pkValue} - missing NOT NULL columns: ${missingNotNullCols.join(', ')}`);
                        // Don't mark as synced, try again in next cycle when data is complete
                        return;
                    }

                    const values = columns.map(col => {
                        const value = record[col];
                        // Convert jsonb values - ensure they're proper JSON
                        if (tableName === 'system_settings' && col === 'setting_value') {
                            if (typeof value === 'string') {
                                try {
                                    // Try to parse as JSON first
                                    return JSON.stringify(JSON.parse(value));
                                } catch {
                                    // If not valid JSON, wrap the string as a JSON string value
                                    return JSON.stringify(value);
                                }
                            }
                            return JSON.stringify(value);
                        }
                        return value;
                    });

                    if (columns.length > 0) {
                        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

                        try {
                            // Insert with is_synced = true (pulled data is already synced)
                            await client.query(`
                                INSERT INTO ${tableName} (${columns.join(', ')}, is_synced, sync_updated_at)
                                VALUES (${placeholders}, true, $${columns.length + 1})
                                ON CONFLICT DO NOTHING
                            `, [...values, record.sync_updated_at || new Date()]);
                            fullySyncedIds.push(pkValue);
                        } catch (insertError) {
                            if (insertError.code === '23503') { // Foreign key violation
                                const partialSuccess = await this.handlePartialInsert(client, tableName, primaryKey, pkValue, record, localColumns);
                                if (partialSuccess) {
                                    // DO NOT mark partial inserts as synced on Cloud
                                    // Keep is_synced=false so they get re-pulled when dependencies are available
                                    console.log(`[Sync] Partial insert recorded but NOT marked synced (waiting for dependencies)`);
                                }
                                isPartialSuccess = true;
                            } else {
                                console.error(`[Sync] Insert failed for ${tableName}.${primaryKey}=${pkValue}: ${insertError.message}`);
                            }
                        }
                    } else {
                        console.warn(`[Sync] No columns to insert for ${tableName}.${primaryKey}=${pkValue}`);
                    }
                }
            }

            // console.log(`[Sync] Pulled ${records.length} changes from cloud for ${tableName}`);

            // After pulling records, update Supabase to mark them as synced
            // ONLY for records that were fully synced (no missing dependencies)
            // Partial records will be fetched again in next cycle to fill in missing FKs
            if (fullySyncedIds.length > 0) {
                await this.markSyncedInCloud(tableName, fullySyncedIds, primaryKey);
            }
        } catch (error) {
            console.error(`[Sync] Error pulling from cloud (${tableName}):`, error.message);
        } finally {
            client.release();
        }
    }

    /**
     * Handle partial insert by nullifying problematic foreign keys
     */
    async handlePartialInsert(client, tableName, primaryKey, pkValue, record, localColumns) {
        const nullableFks = this.nullableFks[tableName] || [];
        if (nullableFks.length === 0) {
            console.error(`[Sync] Insert failed for ${tableName}.${pkValue} (FK violation) and no nullable FKs defined`);
            return false;
        }

        // Create a copy of record with nullable FKs set to null
        const safeRecord = { ...record };
        let modified = false;
        for (const fk of nullableFks) {
            if (safeRecord[fk] !== null && safeRecord[fk] !== undefined) {
                safeRecord[fk] = null;
                modified = true;
            }
        }

        if (!modified) {
            console.error(`[Sync] Insert failed for ${tableName}.${pkValue} (FK violation) but no non-null FKs to clear`);
            return false;
        }

        const columns = Object.keys(safeRecord)
            .filter(col => localColumns.has(col) && col !== 'is_synced' && col !== 'sync_updated_at');
        const values = columns.map(col => safeRecord[col]);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

        // Build SET clause for ON CONFLICT UPDATE - exclude is_synced (always false for partials)
        const updateColumns = columns.filter(col => col !== primaryKey);
        const setClause = updateColumns.map(col => `${col} = EXCLUDED.${col}`).join(', ');

        try {
            await client.query(`
                INSERT INTO ${tableName} (${columns.join(', ')}, is_synced, sync_updated_at)
                VALUES (${placeholders}, false, $${columns.length + 1})
                ON CONFLICT (${primaryKey}) 
                DO UPDATE SET ${setClause}, is_synced = false, sync_updated_at = EXCLUDED.sync_updated_at
            `, [...values, safeRecord.sync_updated_at || new Date()]);
            console.log(`[Sync] ✓ Partial insert success for ${tableName}.${pkValue} (cleared FKs: ${nullableFks.join(', ')}) - marked as UNSYNCED to re-pull when dependencies available`);
            return true;  // Return success (but data is incomplete)
        } catch (retryError) {
            console.error(`[Sync] ✗ Partial insert ALSO failed for ${tableName}.${pkValue}: ${retryError.message}`);
            return false;  // Return failure
        }
    }

    /**
     * Handle partial update by nullifying problematic foreign keys
     */
    async handlePartialUpdate(client, tableName, primaryKey, pkValue, record, localColumns, originalColumns) {
        const nullableFks = this.nullableFks[tableName] || [];
        if (nullableFks.length === 0) return;

        // Filter out columns that are nullable FKs
        const safeColumns = originalColumns.filter(col => !nullableFks.includes(col));

        if (safeColumns.length === 0) return;

        const values = safeColumns.map(col => record[col]);
        const setClause = safeColumns.map((col, i) => `${col} = $${i + 1}`).join(', ');

        try {
            await client.query(`
                UPDATE ${tableName}
                SET ${setClause}, is_synced = true, sync_updated_at = $${safeColumns.length + 1}
                WHERE ${primaryKey} = $${safeColumns.length + 2}
            `, [...values, record.sync_updated_at || new Date(), pkValue]);
            console.log(`[Sync] Partial update success for ${tableName}.${pkValue}`);
        } catch (retryError) {
            console.error(`[Sync] Partial update ALSO failed for ${tableName}.${pkValue}: ${retryError.message}`);
        }
    }

    /**
     * Mark records as synced in Supabase
     * Prevents them from being pulled and pushed repeatedly
     */
    async markSyncedInCloud(tableName, recordIds, primaryKey = 'id') {
        if (!this.supabaseEnabled || recordIds.length === 0) {
            console.log(`[Sync] Skipping mark synced: supabaseEnabled=${this.supabaseEnabled}, ids=${recordIds.length}`);
            return;
        }

        try {
            // console.log(`[Sync] Marking ${recordIds.length} records as synced in Cloud: ${tableName}`);

            const now = new Date().toISOString();
            let markedCount = 0;
            let failedCount = 0;

            // Test with first batch only for detailed logging
            const batchSize = 5;  // Smaller batches for debugging
            for (let i = 0; i < recordIds.length; i += batchSize) {
                const batch = recordIds.slice(i, i + batchSize);

                // Build OR filter for batch
                const filterParts = batch.map(id => {
                    const encodedId = typeof id === 'string' ? encodeURIComponent(id) : id;
                    return `${primaryKey}.eq.${encodedId}`;
                });

                let filterQuery = '';
                if (filterParts.length === 1) {
                    filterQuery = `${primaryKey}=eq.${typeof batch[0] === 'string' ? encodeURIComponent(batch[0]) : batch[0]}`;
                } else {
                    filterQuery = `or=(${filterParts.join(',')})`;
                }

                const updateUrl = `${this.supabaseUrl}/rest/v1/${tableName}?${filterQuery}`;

                try {
                    const headers = {
                        'Authorization': `Bearer ${this.supabaseServiceKey}`,
                        'apikey': this.supabaseServiceKey,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=representation'
                    };

                    const updateData = {
                        is_synced: true,
                        sync_updated_at: now
                    };

                    const response = await fetch(updateUrl, {
                        method: 'PATCH',
                        headers,
                        body: JSON.stringify(updateData)
                    });

                    const responseText = await response.text();
                    let responseData = [];
                    try {
                        responseData = responseText ? JSON.parse(responseText) : [];
                    } catch (e) {
                        console.warn(`[Sync] Failed to parse response: ${responseText.substring(0, 100)}`);
                    }
                    const updateCount = Array.isArray(responseData) ? responseData.length : 0;

                    // DEBUG: Log first response in detail
                    /*
                    if (i === 0 && tableName === 'users') {
                        console.log(`[Sync] DEBUG ${tableName} batch 0: Response status=${response.status}, count=${updateCount}`);
                        if (updateCount > 0) {
                            console.log(`[Sync] DEBUG First row returned: is_synced=${responseData[0]?.is_synced}, sync_updated_at=${responseData[0]?.sync_updated_at}`);
                        }
                    }
                    */

                    if (response.ok) {
                        markedCount += updateCount;
                        /*
                        if (i === 0) {
                            console.log(`[Sync] ✓ Batch 1 PATCH HTTP 200: ${updateCount}/${batch.length} in ${tableName}`);
                        }
                        */
                    } else {
                        console.error(`[Sync] ✗ PATCH HTTP ${response.status}: ${responseText.substring(0, 150)}`);
                        failedCount += batch.length;
                    }
                } catch (batchError) {
                    console.error(`[Sync] Exception in batch: ${batchError.message}`);
                    failedCount += batch.length;
                }
            }

            // console.log(`[Sync] Result: Marked ${markedCount}/${recordIds.length} in cloud ${tableName}${failedCount > 0 ? ` [${failedCount} FAILED]` : ''}`);
        } catch (error) {
            console.error(`[Sync] Error in markSyncedInCloud (${tableName}):`, error.message);
        }
    }

    /**
     * Manual trigger sync (call after user actions)
     */
    async triggerSync() {
        if (!this.isSyncing) {
            console.log('[Sync] Manual sync triggered');
            await this.syncAllTables();
        }
    }

    /**
     * Get sync status
     */
    getSyncStatus() {
        return {
            isSyncing: this.isSyncing,
            syncInterval: this.syncInterval,
            syncConflictResolution: this.syncConflictResolution,
            syncTimeoutSeconds: this.syncTimeoutSeconds,
            tables: this.tables.length
        };
    }

    /**
     * Stop sync service
     */
    async stop() {
        console.log('[Sync] Stopping sync service...');
        // Clear intervals if any
        this.isSyncing = false;
        // Close local connection
        if (this.localPool) {
            await this.localPool.end();
            console.log('[Sync] Local pool closed');
        }
    }
}

module.exports = new SyncService();
