/**
 * qr.js
 * QR Code generation and WebSocket/Polling logic for HR Dashboard
 * Adapted from hr-live-qr.js (Legacy)
 */

import { fetchWithAuth } from './utils.js';

// Internal state
let qrStatusPollHandle = null;
let qrCountdownHandle = null;
let currentQRSession = null;
let qrHistoryCurrentPage = 1;
const qrHistoryPageSize = 10;
let socket = null;
let socketConnected = false;

// Helpers from legacy script
function qs(sel, root = document) { return root.querySelector(sel); }
function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Helper function to format time ago
function getTimeAgo(date) {
  const now = new Date();
  const secondsAgo = Math.floor((now - date) / 1000);

  if (secondsAgo < 60) return `${secondsAgo} second${secondsAgo !== 1 ? 's' : ''} ago`;
  const minutesAgo = Math.floor(secondsAgo / 60);
  if (minutesAgo < 60) return `${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago`;
  const hoursAgo = Math.floor(minutesAgo / 60);
  if (hoursAgo < 24) return `${hoursAgo} hour${hoursAgo !== 1 ? 's' : ''} ago`;
  const daysAgo = Math.floor(hoursAgo / 24);
  return `${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago`;
}

// Convert database timestamp (Manila time with UTC marker) to local Date object
// The database returns Manila time (e.g., 14:09) but marks it as UTC+00
// Browser interprets it as UTC, so we need to subtract 8 hours for Manila timezone offset
function parseDbTimestamp(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  // Subtract 8 hours for Manila timezone offset
  date.setHours(date.getHours() - 8);
  return date;
}

// Initialize WebSocket for real-time QR updates
export function initWebSocket() {
  try {
    if (typeof io !== 'function') {
      console.warn('[Live QR WebSocket] io is not defined, skipping init');
      return;
    }

    socket = io({
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    });

    socket.on('connect', () => {
      socketConnected = true;
      console.log('[Live QR WebSocket] Connected');
      socket.emit('join-hr-dashboard');
    });

    socket.on('qr:refreshed', () => {
      console.log('[Live QR WebSocket] QR refreshed event received');
      updateCurrentQR();
      loadQRHistory(qrHistoryCurrentPage);
    });

    // Also listen for qr-updated from other parts of the system
    socket.on('qr-updated', () => {
      console.log('[Live QR WebSocket] QR updated event received');
      updateCurrentQR();
      loadQRHistory(qrHistoryCurrentPage);
    });

    socket.on('disconnect', () => {
      socketConnected = false;
      console.log('[Live QR WebSocket] Disconnected, using polling fallback');
    });

    socket.on('error', (error) => {
      console.warn('[Live QR WebSocket] Error:', error);
    });

  } catch (error) {
    console.warn('[Live QR WebSocket] Failed to initialize:', error.message);
  }
}

// Initialize Live QR Dashboard
export function initializeLiveQR() {
  console.log('[Live QR] Initializing automated QR dashboard');

  // initWebSocket is called by index.js usually, but we can ensure it's called
  if (!socket) initWebSocket();

  // Set up event listeners
  const historyPrevBtn = qs('#history-prev-btn');
  const historyNextBtn = qs('#history-next-btn');
  const historyStatusFilter = qs('#history-status-filter');

  if (historyPrevBtn) historyPrevBtn.onclick = () => {
    if (qrHistoryCurrentPage > 1) {
      qrHistoryCurrentPage--;
      loadQRHistory(qrHistoryCurrentPage);
    }
  };
  if (historyNextBtn) historyNextBtn.onclick = () => {
    qrHistoryCurrentPage++;
    loadQRHistory(qrHistoryCurrentPage);
  };
  if (historyStatusFilter) historyStatusFilter.onchange = () => {
    qrHistoryCurrentPage = 1;
    loadQRHistory(qrHistoryCurrentPage);
  };

  // Start polling for status updates
  updateQRStatus();
  updateCurrentQR();
  loadQRHistory(1);
  loadTodayStats();

  if (qrStatusPollHandle) clearInterval(qrStatusPollHandle);
  qrStatusPollHandle = setInterval(() => {
    updateQRStatus();
    updateCurrentQR();
  }, 1000);
}

// Stop Live QR Dashboard (when switching tabs)
export function stopLiveQR() {
  console.log('[Live QR] Stopping automated QR dashboard');
  if (qrStatusPollHandle) {
    clearInterval(qrStatusPollHandle);
    qrStatusPollHandle = null;
  }
  if (qrCountdownHandle) {
    clearInterval(qrCountdownHandle);
    qrCountdownHandle = null;
  }
}

// Update QR Automation Status
async function updateQRStatus() {
  try {
    const automationStatus = qs('#qr-automation-status');

    if (automationStatus && currentQRSession) {
      let statusHTML = '';
      if (currentQRSession.is_active === false) {
        statusHTML = '<span class="status-badge-inactive">Disabled</span> Not active';
      } else {
        statusHTML = '<span class="status-badge-active">Active</span> Auto-generating';
      }
      automationStatus.innerHTML = statusHTML;
    }

  } catch (e) {
    console.error('[Live QR] Failed to update QR status:', e);
  }
}

// Update Current QR Code Display
async function updateCurrentQR() {
  try {
    // NOTE: fetchWithAuth auto-prepends API_URL, so just pass relative path
    const resp = await fetchWithAuth('/hr/qr/current', { credentials: 'include' });
    if (!resp.ok) {
      // No current QR
      const qrImage = qs('#qr-code-image');
      const qrPlaceholder = qs('#qr-placeholder');
      const qrSessionId = qs('#qr-session-id');

      if (qrImage) qrImage.style.display = 'none';
      if (qrPlaceholder) {
        qrPlaceholder.textContent = 'No active QR code';
        qrPlaceholder.style.display = 'block';
      }
      if (qrSessionId) qrSessionId.textContent = 'No session';
      stopCountdown();
      return;
    }

    const result = await resp.json();
    const data = result.data || result; // Handle both wrapped and unwrapped responses
    currentQRSession = data;

    // Display QR code image
    const qrImage = qs('#qr-code-image');
    const qrPlaceholder = qs('#qr-placeholder');
    const qrSessionId = qs('#qr-session-id');

    if (qrImage && currentQRSession && currentQRSession.imageDataUrl) {
      qrImage.src = currentQRSession.imageDataUrl;
      qrImage.style.display = 'block';
      if (qrPlaceholder) qrPlaceholder.style.display = 'none';
    } else {
      if (qrImage) qrImage.style.display = 'none';
      if (qrPlaceholder) {
        qrPlaceholder.textContent = 'No QR code available';
        qrPlaceholder.style.display = 'block';
      }
    }

    // Update session info
    if (qrSessionId && currentQRSession) {
      qrSessionId.textContent = `Session ${currentQRSession.session_id || 'Unknown'}`;
    }

    // Start countdown if expires_at exists
    if (currentQRSession && currentQRSession.expires_at) {
      startCountdown(currentQRSession.expires_at);
    } else {
      stopCountdown();
    }

  } catch (e) {
    console.error('[Live QR] Failed to update current QR:', e);
  }
}

// Countdown Timer
function startCountdown(expiresAt) {
  stopCountdown();
  const countdownEl = qs('#qr-countdown');
  if (!countdownEl) return;

  const updateCountdown = () => {
    const now = new Date();
    const expires = parseDbTimestamp(expiresAt);
    if (!expires) {
      countdownEl.textContent = 'Invalid';
      return;
    }

    const secondsLeft = Math.max(0, Math.floor((expires - now) / 1000));

    if (secondsLeft > 0) {
      const mins = Math.floor(secondsLeft / 60);
      const secs = secondsLeft % 60;
      const timeText = `${mins}:${secs.toString().padStart(2, '0')}`;
      countdownEl.textContent = timeText;
    } else {
      countdownEl.textContent = 'Expired';
      stopCountdown();
    }
  };

  updateCountdown();
  qrCountdownHandle = setInterval(updateCountdown, 1000);
}

function stopCountdown() {
  if (qrCountdownHandle) {
    clearInterval(qrCountdownHandle);
    qrCountdownHandle = null;
  }
  const countdownEl = qs('#qr-countdown');
  if (countdownEl) countdownEl.textContent = '--:--';
}

// Load QR Session History
export async function loadQRHistory(page = 1) {
  try {
    const statusFilter = qs('#history-status-filter');
    const status = statusFilter ? statusFilter.value : 'with-scans'; // Default to with-scans

    // Get employee ID from current QR session if available
    const employeeId = currentQRSession?.employee_id || '';

    let url = `/hr/qr/history?_page=${page}&_limit=${qrHistoryPageSize}`;
    if (employeeId) {
      url += `&employeeId=${encodeURIComponent(employeeId)}`;
    }

    if (status && status !== 'with-scans') {
      url += `&status=${status}`;
    } else if (status === 'with-scans') {
      url += `&has_scans=true`; // New filter parameter
    }

    const resp = await fetchWithAuth(url, { credentials: 'include' });
    if (!resp.ok) throw new Error('Failed to fetch history');

    const result = await resp.json();
    const sessions = result.data || result || []; // Handle wrapped and unwrapped responses

    // Get total count from X-Total-Count header OR from pagination object in response
    let totalCount = parseInt(resp.headers.get('X-Total-Count') || '0', 10);
    if (totalCount === 0 && result.pagination && result.pagination.total) {
      totalCount = result.pagination.total;
    }

    renderQRHistory(sessions);
    updateHistoryPagination(page, totalCount);
  } catch (e) {
    console.error('[Live QR] Failed to load QR history:', e);
    const tbody = qs('#qr-history-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--destructive);">Failed to load history</td></tr>';
  }
}

// Render QR History Table
function renderQRHistory(sessions) {
  const tbody = qs('#qr-history-tbody');
  if (!tbody) return;

  if (!sessions || sessions.length === 0) {
    const statusFilter = qs('#history-status-filter');
    const status = statusFilter ? statusFilter.value : 'all';
    let message = 'No sessions found';
    if (status === 'with-scans') {
      message = 'No sessions found with QR code scans';
    } else if (status === 'active') {
      message = 'No active QR sessions';
    } else if (status === 'paused') {
      message = 'No paused QR sessions';
    } else if (status === 'expired') {
      message = 'No expired QR sessions';
    }
    tbody.innerHTML = `<tr><td colspan="5" class="qr-history-loading" style="text-align:center;padding:24px;color:var(--muted-foreground);">${message}</td></tr>`;
    return;
  }

  tbody.innerHTML = sessions.map(s => {
    // Parse database timestamps (Manila time with UTC marker)
    // Handle camelCase (from backend) and snake_case (legacy/db)
    const createdDateStr = s.createdAt || s.created_at;
    const createdDate = parseDbTimestamp(createdDateStr);
    const createdAt = createdDate ? getTimeAgo(createdDate) : '—';

    let expiresText = '—';
    const expiresAtStr = s.expiresAt || s.expires_at;
    if (expiresAtStr) {
      const expiresDate = parseDbTimestamp(expiresAtStr);
      if (expiresDate) {
        const now = new Date();
        const secondsLeft = Math.floor((expiresDate - now) / 1000);

        if (secondsLeft > 0) {
          if (secondsLeft < 60) {
            expiresText = `${secondsLeft} seconds`;
          } else if (secondsLeft < 3600) {
            const minutesLeft = Math.floor(secondsLeft / 60);
            expiresText = `${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}`;
          } else {
            const hoursLeft = Math.floor(secondsLeft / 3600);
            expiresText = `${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}`;
          }
        } else {
          expiresText = 'Expired';
        }
      }
    }

    const checkins = s.checkins || s.check_in_count || 0;
    const checkouts = s.checkouts || s.check_out_count || 0;
    const sessionId = s.session_id || s.id || 'Unknown';

    return `
      <tr>
        <td><strong>${escapeHtml(sessionId)}</strong></td>
        <td>${createdAt}</td>
        <td>${expiresText}</td>
        <td><strong>${checkins}</strong></td>
        <td><strong>${checkouts}</strong></td>
      </tr>
    `;
  }).join('');
}

// Update History Pagination
function updateHistoryPagination(page, totalCount) {
  const pageInfo = qs('#history-page-info');
  const prevBtn = qs('#history-prev-btn');
  const nextBtn = qs('#history-next-btn');

  const totalPages = Math.ceil(totalCount / qrHistoryPageSize) || 1;
  const startItem = (page - 1) * qrHistoryPageSize + 1;
  const endItem = Math.min(page * qrHistoryPageSize, totalCount);

  if (pageInfo) pageInfo.textContent = `Showing ${startItem}-${endItem} of ${totalCount}`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= totalPages;
}

// Load Today's Stats
async function loadTodayStats() {
  try {
    // Get today's attendance with separate count for check-ins and check-outs
    const today = new Date().toISOString().split('T')[0];
    const attResp = await fetchWithAuth(`/hr/attendance?start_date=${today}&end_date=${today}`, { credentials: 'include' });
    if (attResp.ok) {
      const respJson = await attResp.json();
      const attendance = respJson.data || respJson;

      // Count separate check-ins and check-outs
      let checkins = 0;
      let checkouts = 0;
      if (Array.isArray(attendance)) {
        attendance.forEach(att => {
          if (att.checkin_session_id) checkins++;
          if (att.checkout_session_id) checkouts++;
        });
      }

      const checkinsEl = qs('#today-checkins-count');
      const checkoutsEl = qs('#today-checkouts-count');
      if (checkinsEl) checkinsEl.textContent = checkins;
      if (checkoutsEl) checkoutsEl.textContent = checkouts;
      console.log('[Live QR] Today stats loaded - Checkins:', checkins, 'Checkouts:', checkouts, 'from', today);
    }
  } catch (e) {
    console.error('[Live QR] Failed to load today stats:', e);
  }
}

// Global exposure for compatibility
window.initializeLiveQR = initializeLiveQR;
window.stopLiveQR = stopLiveQR;

console.log('[Live QR] Module loaded successfully (Legacy Port)');
