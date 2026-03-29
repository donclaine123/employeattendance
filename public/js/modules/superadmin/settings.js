/**
 * settings.js
 * System Settings Management
 */

import { fetchWithAuth, safeAdd, showToast } from './utils.js';

function setFieldValue(fieldId, value, fallback = '') {
  const field = document.getElementById(fieldId);
  if (!field) return;

  if (value === undefined || value === null || value === '') {
    field.value = fallback;
    return;
  }

  field.value = String(value);
}

function readIntegerField(formData, fieldName, fallback, min, max) {
  const rawValue = formData.get(fieldName);
  const parsedValue = Number.parseInt(rawValue, 10);

  if (Number.isNaN(parsedValue)) {
    return fallback;
  }

  if (typeof min === 'number' && parsedValue < min) {
    throw new Error(`${fieldName} must be at least ${min}.`);
  }

  if (typeof max === 'number' && parsedValue > max) {
    throw new Error(`${fieldName} must be at most ${max}.`);
  }

  return parsedValue;
}

export async function fetchAndRenderSettings() {
  const settingsForm = document.getElementById('settings-form');
  if (!settingsForm) return;

  try {
    const response = await fetchWithAuth(`/admin/settings`, {
      credentials: 'include'
    });
    if (response.ok) {
      const json = await response.json();
      const settings = json.data || json || {};

      // Populate form fields
      setFieldValue('company_name', settings.company_name, '');
      setFieldValue('timezone', settings.timezone, 'Asia/Manila');
      setFieldValue('session_timeout', settings.session_timeout, '30');

      // QR Automation Settings only - with null checks
      setFieldValue('qr_auto_generate_enabled', settings.qr_auto_generate_enabled ?? 'false', 'false');
      setFieldValue('qr_auto_interval_seconds', settings.qr_auto_interval_seconds, '60');
      setFieldValue('qr_session_schedule_start', settings.qr_session_schedule_start, '07:00');
      setFieldValue('qr_session_schedule_end', settings.qr_session_schedule_end, '18:00');
      setFieldValue('qr_active_days', settings.qr_active_days, '1,2,3,4,5');
      setFieldValue('qr_allow_hr_pause', settings.qr_allow_hr_pause ?? 'true', 'true');
      setFieldValue('qr_automation_location', settings.qr_automation_location, 'cloud');

      // Database Sync Settings
      setFieldValue('sync_interval_seconds', settings.sync_interval_seconds, '3');
      setFieldValue('sync_conflict_resolution', settings.sync_conflict_resolution, 'last_write_wins');
      setFieldValue('sync_timeout_seconds', settings.sync_timeout_seconds, '30');

      // Add submit listener if not already added
      if (!settingsForm.dataset.listenerAttached) {
        safeAdd(settingsForm, 'submit', handleSettingsSubmit);
        const revertBtn = document.getElementById('revert-settings-btn');
        if (revertBtn) safeAdd(revertBtn, 'click', fetchAndRenderSettings);
        settingsForm.dataset.listenerAttached = 'true';
      }

    } else {
      console.error('Failed to fetch settings:', response.status);
    }
  } catch (e) {
    console.error('Error fetching settings:', e);
  }
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const settingsForm = document.getElementById('settings-form');
  const formData = new FormData(settingsForm);

  try {
    // Validate QR active days format
    const activeDays = formData.get('qr_active_days').trim();
    if (activeDays && !/^[1-7](,[1-7])*$/.test(activeDays)) {
      throw new Error('Invalid active days format. Use comma-separated numbers 1-7 (e.g., 1,2,3,4,5).');
    }

    const interval = readIntegerField(formData, 'qr_auto_interval_seconds', 60, 30, 600);
    const syncInterval = readIntegerField(formData, 'sync_interval_seconds', 3, 3, 3600);
    const syncTimeout = readIntegerField(formData, 'sync_timeout_seconds', 30, 5, 600);

    const syncConflictResolution = formData.get('sync_conflict_resolution') || 'last_write_wins';
    if (!['last_write_wins', 'local_first', 'cloud_first'].includes(syncConflictResolution)) {
      throw new Error('Invalid sync conflict resolution strategy.');
    }

    const data = {
      // Core settings
      company_name: formData.get('company_name'),
      timezone: formData.get('timezone'),

      // QR Automation Settings only
      qr_auto_generate_enabled: formData.get('qr_auto_generate_enabled') === 'true',
      qr_auto_interval_seconds: interval,
      qr_session_schedule_start: formData.get('qr_session_schedule_start'),
      qr_session_schedule_end: formData.get('qr_session_schedule_end'),
      qr_active_days: activeDays,
      qr_allow_hr_pause: formData.get('qr_allow_hr_pause') === 'true',
      qr_automation_location: formData.get('qr_automation_location') || 'cloud',

      // Sync Settings
      sync_interval_seconds: syncInterval,
      sync_conflict_resolution: syncConflictResolution,
      sync_timeout_seconds: syncTimeout,
    };

    const response = await fetchWithAuth(`/admin/settings`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });

    if (response.ok) {
      showToast('Settings saved successfully.', 'success');
      fetchAndRenderSettings();
    } else {
      const error = await response.json();
      showToast(error.error || 'Failed to save settings.', 'error');
    }
  } catch (err) {
    console.error('Failed to save settings:', err);
    showToast(err.message || 'An unexpected error occurred.', 'error');
  }
}
