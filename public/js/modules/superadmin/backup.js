/**
 * Backup Management Module
 * Handles listing, downloading, deleting, and scheduling backups.
 */

import { fetchWithAuth, safeAdd, showConfirmDialog, showToast, escapeHtml } from './utils.js';

let backupState = {
  backups: [],
  settings: {
    backup_schedule_enabled: false,
    backup_schedule_frequency: 'daily',
    backup_schedule_time: '02:00',
    backup_retention_count: 7,
  }
};

export async function initializeBackupManagement() {
  bindBackupControls();
  await loadBackupData();
}

function bindBackupControls() {
  const createBtn = document.getElementById('create-backup-btn');
  const refreshBtn = document.getElementById('backup-refresh-btn');
  const form = document.getElementById('backup-settings-form');

  safeAdd(createBtn, 'click', createBackupNow);
  safeAdd(refreshBtn, 'click', loadBackupData);
  safeAdd(form, 'submit', saveBackupSettings);
}

async function loadBackupData() {
  const tbody = document.getElementById('backup-files-tbody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted-foreground);">Loading backup archives...</td></tr>';
  }

  try {
    const response = await fetchWithAuth('/admin/backups', {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`Failed to load backups (${response.status})`);
    }

    const result = await response.json();
    const payload = result.data || {};
    backupState.backups = payload.backups || [];
    backupState.settings = {
      ...backupState.settings,
      ...(payload.settings || {})
    };

    renderBackups();
    populateScheduleForm();
    renderSchedulerStatus();
  } catch (error) {
    console.error('[backup] loadBackupData error:', error);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted-foreground);">Failed to load backups.</td></tr>';
    }
    showToast('Failed to load backups.', 'error');
  }
}

function renderBackups() {
  const tbody = document.getElementById('backup-files-tbody');
  const badge = document.getElementById('backup-count-badge');
  if (!tbody) return;

  if (badge) {
    badge.textContent = `Total: ${backupState.backups.length} file${backupState.backups.length === 1 ? '' : 's'}`;
  }

  if (!backupState.backups.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="backup-empty-state">No backup archives found yet.</div></td></tr>';
    return;
  }

  tbody.innerHTML = backupState.backups.map((backup) => {
    const fileName = escapeHtml(backup.fileName);
    const fileMeta = escapeHtml(backup.modifiedAt || backup.createdAt || 'Unknown date');
    const createdAt = escapeHtml(formatBackupDate(backup.modifiedAt || backup.createdAt));
    const fileSize = escapeHtml(backup.sizeLabel || 'Unknown');

    return `
      <tr>
        <td>
          <div class="backup-file-cell">
            <div class="backup-file-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                <path d="M14 3v5h5" />
                <path d="M9 13h6" />
                <path d="M9 17h6" />
              </svg>
            </div>
            <div class="backup-file-content">
              <div class="backup-file-name">${fileName}</div>
              <span class="backup-file-meta">${fileMeta}</span>
            </div>
          </div>
        </td>
        <td>${createdAt}</td>
        <td>${fileSize}</td>
        <td>
          <div class="backup-actions">
            <button type="button" class="backup-action-btn backup-action-btn--download" data-action="download" data-file="${fileName}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M7 10l5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
              <span>Download</span>
            </button>
            <button type="button" class="backup-action-btn backup-action-btn--delete" data-action="delete" data-file="${fileName}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
              <span>Delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-action="download"]').forEach(button => {
    safeAdd(button, 'click', () => downloadBackup(button.getAttribute('data-file')));
  });

  tbody.querySelectorAll('[data-action="delete"]').forEach(button => {
    safeAdd(button, 'click', () => confirmDeleteBackup(button.getAttribute('data-file')));
  });
}

function populateScheduleForm() {
  const enabled = document.getElementById('backup_schedule_enabled');
  const frequency = document.getElementById('backup_schedule_frequency');
  const time = document.getElementById('backup_schedule_time');
  const retention = document.getElementById('backup_retention_count');

  if (enabled) enabled.value = backupState.settings.backup_schedule_enabled ? 'true' : 'false';
  if (frequency) frequency.value = backupState.settings.backup_schedule_frequency || 'daily';
  if (time) time.value = backupState.settings.backup_schedule_time || '02:00';
  if (retention) retention.value = String(backupState.settings.backup_retention_count || 7);
}

function renderSchedulerStatus() {
  const schedulerEnabled = document.getElementById('backup-scheduler-enabled');
  const lastRunAt = document.getElementById('backup-last-run-at');
  const nextRunAt = document.getElementById('backup-next-run-at');
  const lastRunStatus = document.getElementById('backup-last-run-status');

  if (schedulerEnabled) {
    const isActive = Boolean(backupState.settings.backup_schedule_enabled);
    schedulerEnabled.textContent = isActive ? 'Active' : 'Inactive';
    schedulerEnabled.dataset.state = isActive ? 'active' : 'inactive';
  }

  if (lastRunAt) {
    lastRunAt.textContent = backupState.settings.backup_last_run_at
      ? formatBackupDate(backupState.settings.backup_last_run_at)
      : 'Never';
  }

  if (nextRunAt) {
    nextRunAt.textContent = backupState.settings.backup_next_run_at
      ? formatBackupDate(backupState.settings.backup_next_run_at)
      : 'Not scheduled';
  }

  if (lastRunStatus) {
    const status = String(backupState.settings.backup_last_run_status || 'idle').toLowerCase();
    if (status === 'success') {
      lastRunStatus.textContent = 'Success';
    } else if (status === 'failed') {
      lastRunStatus.textContent = 'Failed';
    } else {
      lastRunStatus.textContent = 'Idle';
    }

    lastRunStatus.dataset.state = status;
  }
}

async function createBackupNow() {
  try {
    const response = await fetchWithAuth('/admin/backup/download', { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Backup request failed (${response.status})`);
    }

    const result = await response.json().catch(() => ({}));
    showToast(result.message || 'Backup created successfully.', 'success');
    await loadBackupData();
  } catch (error) {
    console.error('[backup] createBackupNow error:', error);
    showToast('Failed to create backup.', 'error');
  }
}

async function downloadBackup(fileName) {
  if (!fileName) return;

  try {
    const response = await fetchWithAuth(`/admin/backups/${encodeURIComponent(fileName)}/download`, {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`);
    }

    const blob = await response.blob();
    triggerBrowserDownload(blob, fileName);
    showToast(`Downloaded ${fileName}.`, 'success');
  } catch (error) {
    console.error('[backup] downloadBackup error:', error);
    showToast('Failed to download backup.', 'error');
  }
}

async function confirmDeleteBackup(fileName) {
  if (!fileName) return;

  const confirmed = await showConfirmDialog(
    'Delete Backup',
    `Delete backup file "${fileName}"? This cannot be undone.`
  );

  if (!confirmed) {
    showToast('Delete canceled.', 'info');
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/backups/${encodeURIComponent(fileName)}`, {
      method: 'DELETE'
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.message || `Delete failed (${response.status})`);
    }

    showToast(result.message || 'Backup deleted successfully.', 'success');
    await loadBackupData();
  } catch (error) {
    console.error('[backup] confirmDeleteBackup error:', error);
    showToast(error.message || 'Failed to delete backup.', 'error');
  }
}

async function saveBackupSettings(event) {
  event.preventDefault();

  const payload = {
    backup_schedule_enabled: document.getElementById('backup_schedule_enabled')?.value === 'true',
    backup_schedule_frequency: document.getElementById('backup_schedule_frequency')?.value || 'daily',
    backup_schedule_time: document.getElementById('backup_schedule_time')?.value || '02:00',
    backup_retention_count: Number(document.getElementById('backup_retention_count')?.value || 7),
  };

  try {
    const response = await fetchWithAuth('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.message || `Failed to save settings (${response.status})`);
    }

    showToast('Backup settings saved.', 'success');
    await loadBackupData();
  } catch (error) {
    console.error('[backup] saveBackupSettings error:', error);
    showToast(error.message || 'Failed to save backup settings.', 'error');
  }
}

function formatBackupDate(value) {
  if (!value) return 'Unknown';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

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

function triggerBrowserDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getDownloadFileName(contentDisposition) {
  if (!contentDisposition) return '';
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : '';
}

export default {
  initializeBackupManagement,
};