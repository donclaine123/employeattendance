/**
 * settings.js
 * System Settings Management
 */

import { fetchWithAuth, safeAdd } from './utils.js';

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
      const companyName = document.getElementById('company_name');
      if (companyName && settings) companyName.value = settings.company_name || '';

      const timezone = document.getElementById('timezone');
      if (timezone && settings) timezone.value = settings.timezone || 'Asia/Manila';

      const sessionTimeout = document.getElementById('session_timeout');
      if (sessionTimeout && settings) sessionTimeout.value = settings.session_timeout || '30'; // default 30 mins

      // QR Automation Settings only - with null checks
      const qrAutoGenerate = document.getElementById('qr_auto_generate_enabled');
      if (qrAutoGenerate && settings) qrAutoGenerate.value = String(settings.qr_auto_generate_enabled ?? 'false');

      const qrInterval = document.getElementById('qr_auto_interval_seconds');
      if (qrInterval && settings) qrInterval.value = settings.qr_auto_interval_seconds ?? '60';

      const qrStart = document.getElementById('qr_session_schedule_start');
      if (qrStart && settings) qrStart.value = settings.qr_session_schedule_start ?? '07:00';

      const qrEnd = document.getElementById('qr_session_schedule_end');
      if (qrEnd && settings) qrEnd.value = settings.qr_session_schedule_end ?? '18:00';

      const qrDays = document.getElementById('qr_active_days');
      if (qrDays && settings) qrDays.value = settings.qr_active_days ?? '1,2,3,4,5';

      const qrPause = document.getElementById('qr_allow_hr_pause');
      if (qrPause && settings) qrPause.value = String(settings.qr_allow_hr_pause ?? 'true');

      const qrLocation = document.getElementById('qr_automation_location');
      if (qrLocation && settings) qrLocation.value = settings.qr_automation_location ?? 'cloud';

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

  // Validate QR active days format
  const activeDays = formData.get('qr_active_days').trim();
  if (activeDays && !/^[1-7](,[1-7])*$/.test(activeDays)) {
    alert('Invalid active days format. Please use comma-separated numbers 1-7 (e.g., 1,2,3,4,5)');
    return;
  }

  // Validate interval range
  const interval = parseInt(formData.get('qr_auto_interval_seconds'), 10);
  if (interval < 30 || interval > 600) {
    alert('QR generation interval must be between 30 and 600 seconds.');
    return;
  }

  const data = {
    // Core settings
    company_name: formData.get('company_name'),
    timezone: formData.get('timezone'),
    session_timeout: parseInt(formData.get('session_timeout'), 10),

    // QR Automation Settings only
    qr_auto_generate_enabled: formData.get('qr_auto_generate_enabled') === 'true',
    qr_auto_interval_seconds: interval,
    qr_session_schedule_start: formData.get('qr_session_schedule_start'),
    qr_session_schedule_end: formData.get('qr_session_schedule_end'),
    qr_active_days: activeDays,
    qr_allow_hr_pause: formData.get('qr_allow_hr_pause') === 'true',
    qr_automation_location: formData.get('qr_automation_location') || 'cloud'
  };

  try {
    const response = await fetchWithAuth(`/admin/settings`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });

    if (response.ok) {
      alert('Settings saved successfully! Changes will take effect on the next QR generation cycle.');
      fetchAndRenderSettings();
    } else {
      const error = await response.json();
      alert(`Error: ${error.error}`);
    }
  } catch (err) {
    console.error('Failed to save settings:', err);
    alert('An unexpected error occurred.');
  }
}
