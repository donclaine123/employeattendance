/**
 * QR Server Control Module
 * Manages which server(s) run QR automation
 * - local: Only local server generates QR codes
 * - cloud: Only cloud server generates QR codes
 * - both: Both servers can generate QR codes (requires conflict handling)
 * - none: No server generates QR codes (manual only)
 */

const { supabase } = require('../supabaseClient');

let cachedConfig = null;
let configCacheTime = 0;
const CACHE_DURATION = 30000; // 30 seconds

/**
 * Get current QR server configuration
 * @returns {Object} QR server configuration
 */
async function getQRServerConfig() {
    const now = Date.now();
    
    // Return cached config if still valid
    if (cachedConfig && (now - configCacheTime) < CACHE_DURATION) {
        return cachedConfig;
    }
    
    try {
        if (!supabase) {
            console.warn('[QR Control] Supabase client unavailable, using defaults');
            return getDefaultConfig();
        }
        
        const { data, error } = await supabase
            .from('qr_server_config')
            .select('*')
            .eq('config_id', 1)
            .single();
        
        if (error) {
            console.warn('[QR Control] Failed to fetch config:', error.message);
            return getDefaultConfig();
        }
        
        if (!data) {
            console.warn('[QR Control] No config found');
            return getDefaultConfig();
        }
        
        cachedConfig = data;
        configCacheTime = now;
        return data;
        
    } catch (error) {
        console.error('[QR Control] Error fetching config:', error.message);
        return getDefaultConfig();
    }
}

/**
 * Get default configuration
 */
function getDefaultConfig() {
    return {
        config_id: 1,
        active_server: 'local',
        local_server_name: 'local-dev',
        cloud_server_name: 'render-cloud',
        automation_enabled: true,
        schedule_start_time: '07:00:00',
        schedule_end_time: '18:00:00',
        active_days: '1,2,3,4,5',
        interval_seconds: 60,
        admin_notes: 'Default configuration'
    };
}

/**
 * Check if THIS server should run QR automation
 * @param {string} currentServerType - 'local' or 'cloud'
 * @returns {boolean} true if this server should run QR automation
 */
async function shouldRunQRAutomation(currentServerType) {
    const config = await getQRServerConfig();
    
    // First check: automation must be enabled globally
    if (!config.automation_enabled) {
        console.log('[QR Control] Automation is disabled globally');
        return false;
    }
    
    const activeServer = config.active_server.toLowerCase();
    
    if (activeServer === 'none') {
        console.log('[QR Control] No server is configured for QR automation');
        return false;
    }
    
    if (activeServer === currentServerType) {
        return true; // This server matches the active server
    }
    
    if (activeServer === 'both') {
        return true; // Both servers can run
    }
    
    return false; // This server is not configured to run
}

/**
 * Update QR server configuration
 * @param {Object} updates - Configuration updates
 * @param {Integer} adminUserId - User ID of admin making change
 * @param {string} reason - Reason for change
 * @returns {Object} Updated configuration
 */
async function updateQRServerConfig(updates, adminUserId, reason = '') {
    if (!supabase) {
        console.error('[QR Control] Supabase client unavailable');
        return null;
    }
    
    try {
        // Get current config for audit
        const currentConfig = await getQRServerConfig();
        
        // Prepare audit record
        const auditRecord = {
            config_id: 1,
            changed_by: adminUserId,
            previous_active_server: currentConfig.active_server,
            new_active_server: updates.active_server || currentConfig.active_server,
            previous_settings: {
                automation_enabled: currentConfig.automation_enabled,
                interval_seconds: currentConfig.interval_seconds,
                schedule_start: currentConfig.schedule_start_time,
                schedule_end: currentConfig.schedule_end_time
            },
            new_settings: {
                automation_enabled: updates.automation_enabled !== undefined ? updates.automation_enabled : currentConfig.automation_enabled,
                interval_seconds: updates.interval_seconds || currentConfig.interval_seconds,
                schedule_start: updates.schedule_start_time || currentConfig.schedule_start_time,
                schedule_end: updates.schedule_end_time || currentConfig.schedule_end_time
            },
            change_reason: reason
        };
        
        // Update configuration
        const updateData = {
            ...updates,
            updated_by: adminUserId,
            updated_at: new Date().toISOString()
        };
        
        const { data: updatedConfig, error: updateError } = await supabase
            .from('qr_server_config')
            .update(updateData)
            .eq('config_id', 1)
            .select()
            .single();
        
        if (updateError) {
            console.error('[QR Control] Failed to update config:', updateError.message);
            return null;
        }
        
        // Log the change
        const { error: auditError } = await supabase
            .from('qr_server_config_audit')
            .insert(auditRecord);
        
        if (auditError) {
            console.warn('[QR Control] Failed to log audit:', auditError.message);
        } else {
            console.log('[QR Control] Configuration updated and logged');
        }
        
        // Invalidate cache
        cachedConfig = null;
        configCacheTime = 0;
        
        return updatedConfig;
        
    } catch (error) {
        console.error('[QR Control] Error updating config:', error.message);
        return null;
    }
}

/**
 * Export current configuration as backup
 */
async function exportConfiguration() {
    const config = await getQRServerConfig();
    
    return {
        export_date: new Date().toISOString(),
        version: '1.0',
        qr_server_config: config,
        description: 'QR Server Configuration Backup - Safe to restore later'
    };
}

/**
 * Import/restore configuration from backup
 */
async function importConfiguration(backup, adminUserId, reason = 'Configuration restored from backup') {
    if (!backup.qr_server_config) {
        throw new Error('Invalid backup format: missing qr_server_config');
    }
    
    const configToRestore = backup.qr_server_config;
    
    // Remove readonly fields
    delete configToRestore.config_id;
    delete configToRestore.updated_at;
    delete configToRestore.created_at;
    
    return updateQRServerConfig(configToRestore, adminUserId, reason);
}

/**
 * Get current server type based on environment
 * @returns {string} 'local' or 'cloud'
 */
function getCurrentServerType() {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const serverName = process.env.SERVER_NAME || '';
    
    if (nodeEnv === 'production' || serverName.includes('render') || serverName.includes('cloud')) {
        return 'cloud';
    }
    
    return 'local';
}

/**
 * Get configuration status for display
 */
async function getConfigurationStatus() {
    const config = await getQRServerConfig();
    const currentServer = getCurrentServerType();
    const shouldRun = await shouldRunQRAutomation(currentServer);
    
    return {
        current_server: currentServer,
        current_server_running: shouldRun,
        configuration: {
            active_server: config.active_server,
            automation_enabled: config.automation_enabled,
            interval_seconds: config.interval_seconds,
            schedule_start: config.schedule_start_time,
            schedule_end: config.schedule_end_time,
            active_days: config.active_days
        },
        admin_notes: config.admin_notes,
        last_updated: config.updated_at
    };
}

module.exports = {
    getQRServerConfig,
    shouldRunQRAutomation,
    updateQRServerConfig,
    exportConfiguration,
    importConfiguration,
    getCurrentServerType,
    getConfigurationStatus,
    invalidateCache: () => {
        cachedConfig = null;
        configCacheTime = 0;
    }
};
