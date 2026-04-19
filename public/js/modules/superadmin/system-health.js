/**
 * System Health Module
 * Loads and displays system health metrics on the superadmin dashboard
 */

export async function loadHealthData() {
  try {
    const response = await fetch('/api/admin/system-health', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    const result = await response.json();
    return result.health || result;
  } catch (error) {
    console.error('[health] Failed to load health data:', error);
    return null;
  }
}

/**
 * Render health cards with data
 */
export function renderHealthCards(health) {
  if (!health) return;

  // Render Database Health Card
  renderDatabaseCard(health.database);

  // Render QR Sessions Card
  renderQRCard(health.qr);

  // Render Backup Status Card
  renderBackupCard(health.backup);

  // Update overall status
  updateOverallStatus(health.overallStatus);
}

function renderCompactMetric(label, value, badgeText = '', badgeStatus = '') {
  const badgeMarkup = badgeText
    ? `<span class="health-metric-badge status-badge status-${badgeStatus || 'unknown'}">${badgeText}</span>`
    : '';

  return `
    <div class="health-mini-card">
      <div class="health-mini-label">${label}</div>
      <div class="health-mini-row">
        <div class="health-mini-value">${value}</div>
        ${badgeMarkup}
      </div>
    </div>
  `;
}

/**
 * Render database health card
 */
function renderDatabaseCard(database) {
  const pgStatus = database.postgres?.status || 'unknown';
  const supStatus = database.supabase?.status || 'unknown';
  const syncStatus = database.sync?.status || 'unknown';

  const card = document.getElementById('health-card-database');
  if (!card) return;

  const statusIcon = getStatusIcon(pgStatus);
  const bgClass = `health-status-${pgStatus}`;

  card.innerHTML = `
    <div class="health-card-header">
      <div class="health-card-title">
        <span class="health-status-icon ${statusIcon}"></span>
        Database Health
      </div>
      <span class="health-update-time">${formatTime(new Date())}</span>
    </div>
    <div class="health-card-content">
      ${renderCompactMetric('PostgreSQL', `${database.postgres?.responseTime || 'N/A'} • ${database.postgres?.message || 'Unknown'}`, 'Live', 'healthy')}
      ${renderCompactMetric('Supabase', `${database.supabase?.responseTime || 'N/A'} • ${database.supabase?.message || 'Unknown'}`, 'Live', supStatus === 'critical' ? 'critical' : 'healthy')}
      ${renderCompactMetric('Sync Service', database.sync?.message || 'Unknown', /sync/i.test(database.sync?.message || '') ? 'Syncing' : capitalizeStatus(syncStatus), syncStatus)}
    </div>
  `;

  card.className = `health-card ${bgClass}`;
}

/**
 * Render QR sessions card
 */
function renderQRCard(qr) {
  const status = qr?.status || 'unknown';
  const bgClass = `health-status-${status}`;
  const statusIcon = getStatusIcon(status);

  const card = document.getElementById('health-card-qr');
  if (!card) return;

  const lastGenTime = formatDisplayTimestamp(qr?.lastGenerated);

  card.innerHTML = `
    <div class="health-card-header">
      <div class="health-card-title">
        <span class="health-status-icon ${statusIcon}"></span>
        QR Sessions
      </div>
      <span class="health-update-time">${formatTime(new Date())}</span>
    </div>
    <div class="health-card-content">
      ${renderCompactMetric('Active Sessions', String(qr?.activeSessions || 0), qr?.automationEnabled ? 'Enabled' : 'Disabled', qr?.automationEnabled ? 'healthy' : 'warning')}
      ${renderCompactMetric('Last Generated', lastGenTime)}
      ${renderCompactMetric('Condition', qr?.automationReason || 'Unknown')}
    </div>
  `;

  card.className = `health-card ${bgClass}`;
}

/**
 * Render backup status card
 */
function renderBackupCard(backup) {
  const status = backup?.status || 'unknown';
  const bgClass = `health-status-${status}`;
  const statusIcon = getStatusIcon(status);

  const card = document.getElementById('health-card-backup');
  if (!card) return;

  const lastBackupTime = formatDisplayTimestamp(backup?.lastBackup);
  const nextBackupRun = formatDisplayTimestamp(backup?.nextBackupRun);

  const scheduleBadgeClass = backup?.scheduleEnabled ? 'info' : 'warning';
  const runStatusClass = backup?.lastRunStatus === 'failed'
    ? 'critical'
    : backup?.lastRunStatus === 'success'
      ? 'healthy'
      : 'unknown';

  card.innerHTML = `
    <div class="health-card-header">
      <div class="health-card-title">
        <span class="health-status-icon ${statusIcon}"></span>
        Backup Status
      </div>
      <span class="health-update-time">${formatTime(new Date())}</span>
    </div>
    <div class="health-card-content">
      ${renderCompactMetric('Backup Size', backup?.lastBackupSize || 'Unknown')}
      ${renderCompactMetric('Schedule', backup?.backupSchedule || 'Unknown', backup?.scheduleEnabled ? 'Scheduled' : 'Disabled', scheduleBadgeClass)}
      ${renderCompactMetric('Last Run', lastBackupTime, capitalizeStatus(backup?.lastRunStatus), runStatusClass)}
    </div>
  `;

  card.className = `health-card ${bgClass}`;
}

/**
 * Update overall system status indicator
 */
function updateOverallStatus(status) {
  const statusElement = document.getElementById('health-overall-status');
  if (!statusElement) return;

  const statusText = {
    healthy: 'Healthy',
    warning: 'Warning',
    critical: 'Critical'
  };

  statusElement.textContent = statusText[status] || 'Unknown';
  statusElement.className = `health-status-badge status-${status}`;
}

/**
 * Get status icon class
 */
function getStatusIcon(status) {
  const icons = {
    healthy: 'health-icon-healthy',
    warning: 'health-icon-warning',
    critical: 'health-icon-critical',
    unknown: 'health-icon-unknown'
  };
  return icons[status] || icons.unknown;
}

/**
 * Format time for display
 */
function formatTime(date) {
  return date.toLocaleTimeString();
}

function capitalizeStatus(value) {
  const text = String(value || 'unknown').replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDisplayTimestamp(value) {
  if (!value) return 'Never';

  if (typeof value !== 'string') return String(value);

  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}:?\d{2})?$/
  );

  if (!match) return value;

  const [, year, month, day, hour24, minute, second] = match;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIndex = Number(month) - 1;
  const hourNumber = Number(hour24);
  const hour12 = hourNumber % 12 || 12;
  const ampm = hourNumber >= 12 ? 'PM' : 'AM';

  return `${monthNames[monthIndex] || month} ${Number(day)}, ${year} ${hour12}:${minute}:${second} ${ampm}`;
}

/**
 * Initialize Socket.IO real-time updates
 */
export function initializeHealthSocketIO() {
  try {
    // Check if Socket.IO is available globally
    if (typeof window.io === 'undefined') {
      console.warn('[health] Socket.IO library not loaded yet, using polling instead');
      startHealthPolling();
      return;
    }

    // Create a single client connection and reuse it.
    if (!window.__healthSocket) {
      window.__healthSocket = window.io();
    }

    const socket = window.__healthSocket;

    if (!socket || typeof socket.on !== 'function') {
      console.warn('[health] Socket.IO socket not accessible, using polling instead');
      startHealthPolling();
      return;
    }

    if (socket.__healthListenersRegistered) {
      console.log('[health] Socket.IO listeners already registered');
      return;
    }

    socket.__healthListenersRegistered = true;

    // Handle connection events
    socket.on('connect', () => {
      console.log('[health] Socket.IO connected, listening for health updates');
    });

    socket.on('disconnect', () => {
      console.log('[health] Socket.IO disconnected, will use polling');
    });

    socket.on('health:update', (data) => {
      console.log('[health] Received health update via Socket.IO');
      if (data && data.health) {
        renderHealthCards(data.health);
      }
    });

    console.log('[health] Socket.IO listeners registered');
  } catch (error) {
    console.error('[health] Socket.IO initialization error:', error.message);
    console.log('[health] Falling back to polling...');
    startHealthPolling();
  }
}

/**
 * Fallback polling method (every 30 seconds)
 */
function startHealthPolling() {
  setInterval(async () => {
    const health = await loadHealthData();
    if (health) {
      renderHealthCards(health);
    }
  }, 30000);

  console.log('[health] Polling started (every 30 seconds)');
}

/**
 * Initialize health dashboard on page load
 */
export async function initializeHealthDashboard() {
  console.log('[health] Initializing health dashboard...');

  // Load initial data
  const health = await loadHealthData();
  if (health) {
    renderHealthCards(health);
  }

  // Setup real-time updates with a delay to ensure Socket.IO is ready
  setTimeout(() => {
    initializeHealthSocketIO();
  }, 2000); // Wait 2 seconds to ensure Socket.IO loads

  console.log('[health] Dashboard initialized');
}

export default {
  loadHealthData,
  renderHealthCards,
  initializeHealthDashboard,
  initializeHealthSocketIO
};
