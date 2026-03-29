/**
 * Health Service
 * Collects system health metrics for the superadmin dashboard
 */

const os = require('os');
const { pool } = require('../conn');
const { supabase, checkPostgresConnection: checkSupabaseConnection } = require('../conn-supabase');
const { calculateNextBackupRun } = require('./backupScheduler');
const syncService = require('../utils/syncService');

function asBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/**
 * Get PostgreSQL connection health
 */
async function getPostgresHealth() {
  const startTime = Date.now();
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    
    const responseTime = Date.now() - startTime;
    
    return {
      status: responseTime < 100 ? 'healthy' : responseTime < 500 ? 'warning' : 'critical',
      responseTime: `${responseTime}ms`,
      poolSize: `${pool.totalCount}/${pool.options?.max || 20}`,
      message: 'Connected'
    };
  } catch (error) {
    console.error('[healthService] PostgreSQL error:', error.message);
    return {
      status: 'critical',
      responseTime: 'N/A',
      poolSize: 'N/A',
      message: error.message.substring(0, 50)
    };
  }
}

/**
 * Get Supabase connection health
 */
async function getSupabaseHealth() {
  const startTime = Date.now();
  try {
    const isConnected = await checkSupabaseConnection();
    const responseTime = Date.now() - startTime;
    
    return {
      status: isConnected ? (responseTime < 200 ? 'healthy' : 'warning') : 'critical',
      responseTime: `${responseTime}ms`,
      connected: isConnected,
      lastCheck: new Date().toISOString(),
      message: isConnected ? 'Connected' : 'Connection failed'
    };
  } catch (error) {
    console.error('[healthService] Supabase error:', error.message);
    return {
      status: 'critical',
      responseTime: 'N/A',
      connected: false,
      lastCheck: new Date().toISOString(),
      message: error.message.substring(0, 50)
    };
  }
}

/**
 * Get sync service health
 */
async function getSyncHealth() {
  try {
    const syncStatus = syncService.getSyncStatus();
    
    // Determine status based on sync state
    let status = 'healthy';
    if (syncStatus.lastSyncTime) {
      const timeSinceSync = Date.now() - new Date(syncStatus.lastSyncTime).getTime();
      const fiveMinutes = 5 * 60 * 1000;
      
      if (timeSinceSync > fiveMinutes) {
        status = 'warning'; // Sync hasn't run in 5 minutes
      }
      if (timeSinceSync > 15 * 60 * 1000) {
        status = 'critical'; // Sync hasn't run in 15 minutes
      }
    }
    
    return {
      status,
      isSyncing: syncStatus.isSyncing,
      lastSync: syncStatus.lastSyncTime || 'Never',
      nextSync: syncStatus.isSyncing ? 'In progress' : 'Scheduled',
      message: syncStatus.isSyncing ? 'Syncing data...' : 'Idle'
    };
  } catch (error) {
    console.error('[healthService] Sync status error:', error.message);
    return {
      status: 'critical',
      isSyncing: false,
      lastSync: 'Unknown',
      nextSync: 'Unknown',
      message: 'Sync service unavailable'
    };
  }
}

/**
 * Get system resources (disk, memory)
 */
function getSystemHealth() {
  try {
    // Memory usage
    const memUsage = process.memoryUsage();
    const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const memTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const memPercent = Math.round((memUsedMB / memTotalMB) * 100);
    
    let memStatus = 'healthy';
    if (memPercent > 80) memStatus = 'critical';
    else if (memPercent > 50) memStatus = 'warning';
    
    // Uptime
    const upTimeSeconds = process.uptime();
    const days = Math.floor(upTimeSeconds / 86400);
    const hours = Math.floor((upTimeSeconds % 86400) / 3600);
    const minutes = Math.floor((upTimeSeconds % 3600) / 60);
    const uptime = `${days}d ${hours}h ${minutes}m`;
    
    // Disk space (estimate - using os totalmem as proxy since we can't reliably get disk space in Docker)
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const diskUsedMB = Math.round(usedMem / 1024 / 1024);
    const diskTotalMB = Math.round(totalMem / 1024 / 1024);
    const diskPercent = Math.round((usedMem / totalMem) * 100);
    
    let diskStatus = 'healthy';
    if (diskPercent > 95) diskStatus = 'critical';
    else if (diskPercent > 80) diskStatus = 'warning';
    
    return {
      memory: {
        status: memStatus,
        used: `${memUsedMB}MB`,
        total: `${memTotalMB}MB`,
        percent: memPercent
      },
      disk: {
        status: diskStatus,
        used: `${diskUsedMB}MB`,
        total: `${diskTotalMB}MB`,
        percent: diskPercent
      },
      uptime,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[healthService] System health error:', error.message);
    return {
      memory: { status: 'unknown', used: 'N/A', total: 'N/A', percent: 0 },
      disk: { status: 'unknown', used: 'N/A', total: 'N/A', percent: 0 },
      uptime: 'Unknown',
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Get active QR sessions count
 */
async function getQRSessionsHealth() {
  try {
    const currentEnv = process.env.NODE_ENV === 'production' ? 'cloud' : 'local';

    const { data: settingsRows, error: settingsError } = await supabase
      .from('system_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['qr_auto_generate_enabled', 'qr_automation_location']);

    const settings = {};
    if (!settingsError && Array.isArray(settingsRows)) {
      settingsRows.forEach(row => {
        settings[row.setting_key] = row.setting_value;
      });
    }

    const { count, error } = await supabase
      .from('qr_sessions')
      .select('session_id', { count: 'exact', head: true })
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString());
    
    if (error) {
      console.error('[healthService] QR sessions query error:', error.message);
      return {
        activeSessions: 0,
        status: 'critical',
        lastGenerated: 'Unknown',
        automationEnabled: false,
        message: 'Failed to fetch QR sessions'
      };
    }
    
    // Get last QR session
    const { data: lastSession } = await supabase
      .from('qr_sessions')
      .select('created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    const sessionCount = count || 0;
    const status = sessionCount > 0 ? 'healthy' : 'warning';
    const automationLocation = settings.qr_automation_location || 'local';
    const automationEnabled = asBoolean(settings.qr_auto_generate_enabled) && automationLocation === currentEnv;
    const automationReason = automationEnabled
      ? `Enabled on ${automationLocation}`
      : asBoolean(settings.qr_auto_generate_enabled)
        ? `Enabled in settings, but runs on ${automationLocation}`
        : 'Disabled in system settings';
    
    return {
      activeSessions: sessionCount,
      status,
      lastGenerated: lastSession ? lastSession.created_at : 'Never',
      automationEnabled,
      automationLocation,
      currentEnv,
      automationReason,
      message: `${sessionCount} active session${sessionCount !== 1 ? 's' : ''}`
    };
  } catch (error) {
    console.error('[healthService] QR sessions error:', error.message);
    return {
      activeSessions: 0,
      status: 'critical',
      lastGenerated: 'Unknown',
      automationEnabled: false,
      message: 'Unable to fetch QR status'
    };
  }
}

/**
 * Get backup scheduler health
 */
async function getBackupHealth() {
  try {
    const { data: settingsRows, error } = await supabase
      .from('system_settings')
      .select('setting_key, setting_value')
      .in('setting_key', [
        'backup_schedule_enabled',
        'backup_schedule_frequency',
        'backup_schedule_time',
        'backup_retention_count',
        'backup_last_run_at',
        'backup_last_run_status',
        'backup_last_run_file',
        'backup_last_run_size',
        'backup_last_run_error',
        'backup_next_run_at'
      ]);

    if (error) {
      throw error;
    }

    const settings = {};
    if (Array.isArray(settingsRows)) {
      settingsRows.forEach((row) => {
        settings[row.setting_key] = row.setting_value;
      });
    }

    const enabled = asBoolean(settings.backup_schedule_enabled);
    const frequency = String(settings.backup_schedule_frequency || 'daily').toLowerCase();
    const scheduleTime = String(settings.backup_schedule_time || '02:00');
    const lastRunAt = settings.backup_last_run_at || null;
    const lastRunStatus = String(settings.backup_last_run_status || 'idle').toLowerCase();
    const nextRunAt = settings.backup_next_run_at || (enabled ? calculateNextBackupRun(settings, new Date())?.toISOString() : null);
    const lastRunSize = settings.backup_last_run_size ? formatBytes(Number(settings.backup_last_run_size)) : 'Unknown';

    let status = 'healthy';
    if (!enabled) {
      status = 'warning';
    }
    if (lastRunStatus === 'failed') {
      status = 'critical';
    }

    const scheduleLabel = enabled
      ? `${capitalize(frequency)} at ${formatTimeLabel(scheduleTime)}`
      : 'Disabled';

    let message = enabled ? 'Awaiting next scheduled run' : 'Backup schedule disabled';
    if (lastRunStatus === 'success' && lastRunAt) {
      message = `Last run at ${formatDisplayTime(lastRunAt)}`;
    } else if (lastRunStatus === 'failed' && settings.backup_last_run_error) {
      message = String(settings.backup_last_run_error).slice(0, 80);
    }

    return {
      lastBackup: lastRunAt || 'Never',
      lastBackupSize: lastRunSize,
      backupSchedule: scheduleLabel,
      nextBackupRun: nextRunAt || 'Not scheduled',
      lastRunStatus,
      scheduleEnabled: enabled,
      scheduleFrequency: frequency,
      scheduleTime,
      backupFile: settings.backup_last_run_file || null,
      status,
      message
    };
  } catch (error) {
    console.error('[healthService] Backup health error:', error.message);
    return {
      lastBackup: 'Unknown',
      lastBackupSize: 'Unknown',
      backupSchedule: 'Unknown',
      nextBackupRun: 'Unknown',
      lastRunStatus: 'unknown',
      scheduleEnabled: false,
      status: 'critical',
      message: 'Unable to fetch backup info'
    };
  }
}

function formatBytes(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return 'Unknown';
  }

  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(2)}KB`;
  }

  return `${sizeBytes}B`;
}

function formatTimeLabel(timeValue) {
  const [hourValue = '2', minuteValue = '00'] = String(timeValue || '02:00').split(':');
  const hour = Number.parseInt(hourValue, 10);
  const minute = String(minuteValue).padStart(2, '0');

  if (!Number.isInteger(hour)) {
    return '2:00 AM';
  }

  const normalizedHour = hour % 12 || 12;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return `${normalizedHour}:${minute} ${ampm}`;
}

function formatDisplayTime(value) {
  if (!value) return 'Never';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

function capitalize(value) {
  const text = String(value || 'daily');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Get complete system health snapshot
 * This is the main function called by the API endpoint
 */
async function getFullHealth() {
  try {
    const [postgres, supabaseHealth, sync, system, qr, backup] = await Promise.all([
      getPostgresHealth(),
      getSupabaseHealth(),
      getSyncHealth(),
      getSystemHealth(),
      getQRSessionsHealth(),
      getBackupHealth()
    ]);
    
    // Determine overall system status
    const allStatuses = [
      postgres.status,
      supabaseHealth.status,
      sync.status,
      qr.status,
      backup.status
    ];
    
    let overallStatus = 'healthy';
    if (allStatuses.includes('critical')) overallStatus = 'critical';
    else if (allStatuses.includes('warning')) overallStatus = 'warning';
    
    return {
      overallStatus,
      timestamp: new Date().toISOString(),
      database: {
        postgres,
        supabase: supabaseHealth,
        sync
      },
      system,
      qr,
      backup
    };
  } catch (error) {
    console.error('[healthService] getFullHealth error:', error.message);
    
    // Return partial health data even if some checks fail
    return {
      overallStatus: 'critical',
      timestamp: new Date().toISOString(),
      error: 'Unable to retrieve full health status',
      database: {
        postgres: { status: 'unknown', message: 'Unable to check' },
        supabase: { status: 'unknown', message: 'Unable to check' },
        sync: { status: 'unknown', message: 'Unable to check' }
      },
      system: getSystemHealth(),
      qr: { status: 'unknown', message: 'Unable to check' },
      backup: { status: 'unknown', message: 'Unable to check' }
    };
  }
}

module.exports = {
  getFullHealth,
  getPostgresHealth,
  getSupabaseHealth,
  getSyncHealth,
  getSystemHealth,
  getQRSessionsHealth,
  getBackupHealth
};
