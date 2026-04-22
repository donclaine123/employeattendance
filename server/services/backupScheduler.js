const cron = require('node-cron');
const { supabase } = require('../conn-supabase');
const { logAuditEvent, AUDIT_ACTIONS } = require('../utils/audit');
const { buildSyncDirtyPatch } = require('../utils/syncDirty');
const adminService = require('./adminService');
const backupService = require('./backupService');

const MANILA_TIME_ZONE = 'Asia/Manila';

let scheduledTask = null;
let schedulerRefreshInProgress = false;

function parseBooleanSetting(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function parseTimeValue(timeValue) {
  const [hourValue = '0', minuteValue = '0'] = String(timeValue || '02:00').split(':');
  const hour = Number.parseInt(hourValue, 10);
  const minute = Number.parseInt(minuteValue, 10);

  return {
    hour: Number.isInteger(hour) ? Math.min(Math.max(hour, 0), 23) : 2,
    minute: Number.isInteger(minute) ? Math.min(Math.max(minute, 0), 59) : 0,
  };
}

function getManilaParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = {};
  for (const piece of formatter.formatToParts(date)) {
    if (piece.type !== 'literal') {
      parts[piece.type] = piece.value;
    }
  }

  return {
    year: Number.parseInt(parts.year, 10),
    month: Number.parseInt(parts.month, 10),
    day: Number.parseInt(parts.day, 10),
    hour: Number.parseInt(parts.hour, 10),
    minute: Number.parseInt(parts.minute, 10),
    second: Number.parseInt(parts.second, 10),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function getValidDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getScheduledTimeForToday(now, scheduleTime) {
  const parts = getManilaParts(now);
  const { hour, minute } = parseTimeValue(scheduleTime);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - 8, minute, 0, 0));
}

function buildCronExpression(settings) {
  const { hour, minute } = parseTimeValue(settings.backup_schedule_time);
  return `0 ${minute} ${hour} * * *`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function calculateDueAt(settings, now = new Date()) {
  const referenceNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(referenceNow.getTime()) || !parseBooleanSetting(settings.backup_schedule_enabled)) {
    return null;
  }

  const frequency = String(settings.backup_schedule_frequency || 'daily').toLowerCase();
  const lastRunAt = getValidDate(settings.backup_last_run_at);

  if (frequency === 'weekly') {
    return lastRunAt ? addDays(lastRunAt, 7) : getScheduledTimeForToday(referenceNow, settings.backup_schedule_time);
  }

  if (frequency === 'monthly') {
    return lastRunAt ? addMonths(lastRunAt, 1) : getScheduledTimeForToday(referenceNow, settings.backup_schedule_time);
  }

  return lastRunAt ? addDays(lastRunAt, 1) : getScheduledTimeForToday(referenceNow, settings.backup_schedule_time);
}

function calculateNextBackupRun(settings, now = new Date()) {
  const referenceNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(referenceNow.getTime()) || !parseBooleanSetting(settings.backup_schedule_enabled)) {
    return null;
  }

  const frequency = String(settings.backup_schedule_frequency || 'daily').toLowerCase();
  const scheduledToday = getScheduledTimeForToday(referenceNow, settings.backup_schedule_time);
  const lastRunAt = getValidDate(settings.backup_last_run_at);
  const currentParts = getManilaParts(referenceNow);
  const lastRunParts = lastRunAt ? getManilaParts(lastRunAt) : null;

  if (frequency === 'weekly') {
    if (lastRunAt) {
      const nextRun = addDays(lastRunAt, 7);
      if (referenceNow <= nextRun) {
        return nextRun;
      }
    }

    if (lastRunParts && lastRunParts.dateKey === currentParts.dateKey) {
      return addDays(scheduledToday, 7);
    }

    return referenceNow <= scheduledToday ? scheduledToday : addDays(scheduledToday, 7);
  }

  if (frequency === 'monthly') {
    if (lastRunAt) {
      const nextRun = addMonths(lastRunAt, 1);
      if (referenceNow <= nextRun) {
        return nextRun;
      }
    }

    if (lastRunParts && lastRunParts.dateKey === currentParts.dateKey) {
      return addMonths(scheduledToday, 1);
    }

    return referenceNow <= scheduledToday ? scheduledToday : addMonths(scheduledToday, 1);
  }

  if (lastRunParts && lastRunParts.dateKey === currentParts.dateKey) {
    return addDays(scheduledToday, 1);
  }

  return referenceNow <= scheduledToday ? scheduledToday : addDays(scheduledToday, 1);
}

function stopScheduledTask() {
  if (!scheduledTask) {
    return;
  }

  try {
    scheduledTask.stop();
  } catch (error) {
    console.warn('[backup-scheduler][debug] Failed to stop scheduler task:', error.message);
  }

  try {
    if (typeof scheduledTask.destroy === 'function') {
      scheduledTask.destroy();
    }
  } catch (error) {
    console.warn('[backup-scheduler][debug] Failed to destroy scheduler task:', error.message);
  }

  scheduledTask = null;
}

function scheduleTaskFromSettings(settings) {
  stopScheduledTask();

  if (!parseBooleanSetting(settings.backup_schedule_enabled)) {
    console.log('[backup-scheduler][debug] Scheduler disabled, no cron task created');
    return null;
  }

  const expression = buildCronExpression(settings);
  scheduledTask = cron.schedule(
    expression,
    () => {
      runScheduledBackupCheck().catch((error) => {
        console.error('[backup-scheduler] Unexpected scheduler error:', error.message);
      });
    },
    {
      timezone: MANILA_TIME_ZONE,
      name: 'backup-scheduler',
    }
  );

  const nextRun = typeof scheduledTask.getNextRun === 'function' ? scheduledTask.getNextRun() : null;
  console.log('[backup-scheduler][debug] Cron task scheduled', {
    expression,
    timezone: MANILA_TIME_ZONE,
    nextRun: nextRun ? nextRun.toISOString() : null,
  });

  return scheduledTask;
}

function getBackupSchedulerSnapshot(settings, now = new Date()) {
  const referenceNow = now instanceof Date ? now : new Date(now);
  return {
    enabled: parseBooleanSetting(settings.backup_schedule_enabled),
    frequency: settings.backup_schedule_frequency || 'daily',
    time: settings.backup_schedule_time || '02:00',
    retention: settings.backup_retention_count || 7,
    lastRunAt: settings.backup_last_run_at || null,
    dueAt: calculateDueAt(settings, referenceNow),
    nextRunAt: calculateNextBackupRun(settings, referenceNow),
    currentTime: referenceNow,
  };
}

async function writeRuntimeSettings(updates) {
  const rows = Object.entries(updates).map(([setting_key, setting_value]) => ({
    setting_key,
    setting_value,
    ...buildSyncDirtyPatch()
  }));
  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase
    .from('system_settings')
    .upsert(rows, { onConflict: 'setting_key' });

  if (error) {
    throw error;
  }
}

async function executeBackupJob({
  userId = null,
  scheduled = false,
  now = new Date(),
  settings: providedSettings = null,
  clientIP = null,
} = {}) {
  const referenceNow = now instanceof Date ? now : new Date(now);
  const settings = providedSettings || await adminService.getSystemSettings();
  const backup = await backupService.createDatabaseBackup();
  const retentionCount = Number.parseInt(settings.backup_retention_count || 7, 10);
  const retentionResult = backupService.enforceBackupRetention(retentionCount);
  const nextScheduledRunAt = calculateNextBackupRun({
    ...settings,
    backup_last_run_at: referenceNow.toISOString(),
  }, referenceNow);

  await writeRuntimeSettings({
    backup_last_run_at: referenceNow.toISOString(),
    backup_last_run_status: 'success',
    backup_last_run_file: backup.fileName,
    backup_last_run_size: String(backup.sizeBytes),
    backup_last_run_error: '',
    backup_next_run_at: nextScheduledRunAt ? nextScheduledRunAt.toISOString() : '',
  });

  await logAuditEvent(userId, AUDIT_ACTIONS.BACKUP_CREATED, {
    fileName: backup.fileName,
    sizeBytes: backup.sizeBytes,
    scheduled,
    retentionCount: Number.isInteger(retentionCount) ? retentionCount : 7,
    removedBackups: retentionResult.removed.map(entry => entry.fileName),
    timestamp: referenceNow.toISOString(),
    ...(clientIP ? { ipAddress: clientIP } : {}),
  });

  return {
    backup,
    retentionCount: Number.isInteger(retentionCount) ? retentionCount : 7,
    removedBackups: retentionResult.removed,
    nextScheduledRunAt,
  };
}

async function runScheduledBackupCheck() {
  if (schedulerRefreshInProgress) {
    console.log('[backup-scheduler][debug] Skipping check because refresh is already in progress');
    return;
  }

  const now = new Date();
  console.log('[backup-scheduler][debug] Cron tick started at', now.toISOString());

  try {
    const settings = await adminService.getSystemSettings();
    const snapshot = getBackupSchedulerSnapshot(settings, now);

    console.log('[backup-scheduler][debug] Settings snapshot', {
      enabled: snapshot.enabled,
      frequency: snapshot.frequency,
      time: snapshot.time,
      retention: snapshot.retention,
      lastRunAt: snapshot.lastRunAt,
      dueAt: snapshot.dueAt ? snapshot.dueAt.toISOString() : null,
      nextRunAt: snapshot.nextRunAt ? snapshot.nextRunAt.toISOString() : null,
      currentTime: snapshot.currentTime.toISOString(),
    });

    if (!snapshot.enabled) {
      console.log('[backup-scheduler][debug] Scheduler disabled, skipping run');
      return;
    }

    if (!snapshot.dueAt || Number.isNaN(snapshot.dueAt.getTime()) || now < snapshot.dueAt) {
      console.log('[backup-scheduler][debug] Not due yet, waiting until', snapshot.dueAt ? snapshot.dueAt.toISOString() : 'invalid due time');
      return;
    }

    console.log('[backup-scheduler][debug] Backup is due now, creating file');
    const result = await executeBackupJob({
      userId: null,
      scheduled: true,
      now,
      settings,
    });

    console.log('[backup-scheduler][debug] Runtime settings updated', {
      backup_last_run_at: now.toISOString(),
      backup_next_run_at: result.nextScheduledRunAt ? result.nextScheduledRunAt.toISOString() : null,
      retentionCount: result.retentionCount,
      removedBackups: result.removedBackups.map(entry => entry.fileName),
    });

    console.log(`[backup-scheduler] Created scheduled backup: ${result.backup.fileName}`);
  } catch (error) {
    console.error('[backup-scheduler] Failed to run scheduled backup:', error.message);

    try {
      const settings = await adminService.getSystemSettings();
      const snapshot = getBackupSchedulerSnapshot(settings, now);

      await writeRuntimeSettings({
        backup_last_run_at: now.toISOString(),
        backup_last_run_status: 'failed',
        backup_last_run_error: error.message,
        backup_next_run_at: snapshot.nextRunAt ? snapshot.nextRunAt.toISOString() : '',
      });
    } catch (settingsError) {
      console.error('[backup-scheduler] Failed to store scheduler error state:', settingsError.message);
    }
  }
}

async function refreshBackupScheduler() {
  if (schedulerRefreshInProgress) {
    console.log('[backup-scheduler][debug] Refresh already in progress');
    return scheduledTask;
  }

  schedulerRefreshInProgress = true;

  try {
    const settings = await adminService.getSystemSettings();
    return scheduleTaskFromSettings(settings);
  } finally {
    schedulerRefreshInProgress = false;
  }
}

async function startBackupScheduler() {
  if (scheduledTask) {
    console.log('[backup-scheduler][debug] Scheduler already running');
    return scheduledTask;
  }

  console.log('[backup-scheduler][debug] Starting cron-based scheduler for Manila time');
  const task = await refreshBackupScheduler();

  if (task) {
    await runScheduledBackupCheck();
  }

  console.log('[backup-scheduler] Started');
  return task;
}

function stopBackupScheduler() {
  stopScheduledTask();
}

module.exports = {
  startBackupScheduler,
  stopBackupScheduler,
  refreshBackupScheduler,
  executeBackupJob,
  runScheduledBackupCheck,
  calculateNextBackupRun,
};
