/**
 * activity.js
 * Session Activity Monitor
 */

import { fetchWithAuth, escapeHtml, safeAdd } from './utils.js';
import { fetchAuditLogs, renderAuditLogs } from './audit.js'; // Circular dependency risk? 
// Actually, activity monitor updates 'total logins today' by querying audit logs.
// To avoid circular refs, we might need a dedicated audit service/module or just duplicates.
// Or pass the function in. Let's assume we can import it.
// To be safe, let's implement the specific audit fetch needed here or imports carefully.
// If audit.js imports activity.js, we have a cycle. Let's check the plan.
// Audit.js doesn't seem to need activity.js. So we should be fine.

async function fetchActiveSessions() {
  try {
    const response = await fetchWithAuth(`/admin/sessions`, {});
    if (response.ok) {
      const responseData = await response.json();
      return responseData.data || responseData || [];
    }
    return [];
  } catch (e) {
    console.error('Error fetching active sessions:', e);
    return [];
  }
}

function renderActiveSessions(sessions) {
  const activityMonitorTbody = document.getElementById('activity-monitor-tbody');
  if (!activityMonitorTbody) return;

  activityMonitorTbody.innerHTML = '';
  if (!sessions || sessions.length === 0) {
    activityMonitorTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted-foreground);">No active sessions found.</td></tr>';
    return;
  }
  // Update stats: active sessions count
  const activeCountEl = document.getElementById('stat-active-sessions');
  if (activeCountEl) activeCountEl.textContent = String(sessions.length);

  // Compute avg session duration if possible (session.duration in seconds or compute from start)
  const durations = sessions.map(s => {
    if (s.duration_seconds) return Number(s.duration_seconds);
    if (s.login_time && s.last_seen) {
      const start = new Date(s.login_time);
      const end = new Date(s.last_seen);
      return Math.max(0, Math.round((end - start) / 1000));
    }
    return 0;
  }).filter(d => d > 0);

  const avgSeconds = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const avgDisplay = avgSeconds ? (avgSeconds < 3600 ? `${Math.round(avgSeconds / 60)}m` : `${(avgSeconds / 3600).toFixed(1)}h`) : '—';
  const avgEl = document.getElementById('stat-avg-duration');
  if (avgEl) avgEl.textContent = avgDisplay;

  sessions.forEach((session) => {
    const loginTime = new Date(session.login_time).toLocaleString();

    const row = `
            <tr data-session-id="${session.session_id}">
                <td>${escapeHtml(session.full_name || session.username)}</td>
                <td>${escapeHtml(loginTime)}</td>
                <td>${escapeHtml(session.ip_address)}</td>
                <td><button class="btn-force-logout" data-session-id="${session.session_id}">Force Logout</button></td>
            </tr>
        `;
    activityMonitorTbody.insertAdjacentHTML('beforeend', row);
  });

  // Update total logins today by querying audit logs for LOGIN events today
  updateTotalLoginsToday();
}

async function updateTotalLoginsToday() {
  try {
    // We need fetchWithAuth here. 
    // We'll perform a manual fetch instead of importing fetchAuditLogs to avoid full dependency if not needed.
    // Actually, let's just use the shared fetchWithAuth.
    const response = await fetchWithAuth('/admin/audit-logs', {});
    if (response.ok) {
      const json = await response.json();
      const logs = json.data || json || [];

      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

      const count = logs.filter(l => {
        if (!l || !l.action_type || !l.created_at) return false;
        if (l.action_type !== 'LOGIN') return false;
        const d = new Date(l.created_at);
        return d >= start && d <= end;
      }).length;

      const totalLoginsEl = document.getElementById('stat-total-logins');
      if (totalLoginsEl) totalLoginsEl.textContent = String(count);
    }
  } catch (err) {
    console.warn('Failed to compute total logins from audit logs:', err);
  }
}

async function handleForceLogout(sessionId) {
  if (!confirm('Are you sure you want to forcefully log out this session?')) return;
  try {
    const response = await fetchWithAuth(`/admin/sessions/${sessionId}/logout`, {
      method: 'POST'
    });
    if (response.ok) {
      alert('Session logged out.');
      initializeActivityMonitor();
    } else {
      const error = await response.json();
      alert(`Error: ${error.error}`);
    }
  } catch (err) {
    console.error('Failed to force logout:', err);
    alert('An unexpected error occurred.');
  }
}

export async function initializeActivityMonitor() {
  setupActivityListeners();
  const sessions = await fetchActiveSessions();
  renderActiveSessions(sessions);
}

function setupActivityListeners() {
  const activityMonitorTbody = document.getElementById('activity-monitor-tbody');
  const refreshBtn = document.getElementById('refresh-sessions-btn');

  if (activityMonitorTbody && !activityMonitorTbody.dataset.listenerAttached) {
    activityMonitorTbody.addEventListener('click', (e) => {
      // Support legacy btn-logout-session and new btn-force-logout
      const target = e.target;
      if (target.classList.contains('btn-logout-session') || target.classList.contains('btn-force-logout')) {
        const sessionId = target.dataset.sessionId || target.closest('tr').dataset.sessionId;
        handleForceLogout(sessionId);
      }
    });
    activityMonitorTbody.dataset.listenerAttached = 'true';
  }

  if (refreshBtn) {
    refreshBtn.onclick = initializeActivityMonitor; // simple override is fine
  }
}
