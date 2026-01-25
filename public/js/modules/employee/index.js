
import { initProfile } from './profile.js';
import { initAttendance } from './attendance.js';
import { initQRScanner } from './qr-scanner.js';
import { initRequests } from './requests.js';
// import { initNotifications } from './notifications.js';
import { initResponsiveLayout } from './ui.js';
import { initSchedule } from './schedule.js';

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Employee] Dashboard initializing...');

  // 1. Initialize Profile (gets user session)
  const user = await initProfile();

  if (user) {
    // 2. Initialize Attendance
    initAttendance(user);

    // 3. Initialize QR Scanner
    initQRScanner();

    // 4. Initialize Requests
    initRequests();

    // 5. Initialize Notifications
    // initNotifications();

    // 6. UI / Layout
    initResponsiveLayout();

    // 7. Initialize Schedule
    initSchedule(user);

    // 8. System Checks
    checkSystemStatus();
  } else {
    console.warn('[Employee] No user session found during init.');
  }
});

async function checkSystemStatus() {
  try {
    const apiBase = window.API_URL ? window.API_URL.replace('/api', '') : '';
    const response = await fetch(`${apiBase}/health`);
    const statusEl = document.getElementById('systemStatus');

    if (!statusEl) return;

    if (response.ok) {
      statusEl.textContent = 'Active';
      statusEl.className = 'info-value status-active';
    } else {
      statusEl.textContent = 'Issues detected';
      statusEl.className = 'info-value status-error';
    }
  } catch (e) {
    const statusEl = document.getElementById('systemStatus');
    if (statusEl) {
      statusEl.textContent = 'Connection error';
      statusEl.className = 'info-value status-error';
    }
  }
}
