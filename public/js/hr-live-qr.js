// HR Live QR Dashboard - Automated QR Code Management
// This module handles the real-time QR display, pause/resume controls, and session history

(function() {
  function qs(sel, root=document) { return root.querySelector(sel); }
  function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  const apiBase = window.API_URL || '/api';
  let qrStatusPollHandle = null;
  let qrCountdownHandle = null;
  let currentQRSession = null;
  let qrHistoryCurrentPage = 1;
  const qrHistoryPageSize = 10;

  // Initialize Live QR Dashboard
  function initializeLiveQR() {
    console.log('[Live QR] Initializing automated QR dashboard');
    
    // Set up event listeners
    const pauseBtn = qs('#qr-pause-btn');
    const resumeBtn = qs('#qr-resume-btn');
    const refreshBtn = qs('#qr-refresh-btn');
    const historyRefreshBtn = qs('#history-refresh-btn');
    const historyPrevBtn = qs('#history-prev-btn');
    const historyNextBtn = qs('#history-next-btn');
    const historyStatusFilter = qs('#history-status-filter');

    if (pauseBtn) pauseBtn.addEventListener('click', pauseQRGeneration);
    if (resumeBtn) resumeBtn.addEventListener('click', resumeQRGeneration);
    if (refreshBtn) refreshBtn.addEventListener('click', () => { updateQRStatus(); updateCurrentQR(); });
    if (historyRefreshBtn) historyRefreshBtn.addEventListener('click', () => loadQRHistory(qrHistoryCurrentPage));
    if (historyPrevBtn) historyPrevBtn.addEventListener('click', () => { 
      if (qrHistoryCurrentPage > 1) { 
        qrHistoryCurrentPage--; 
        loadQRHistory(qrHistoryCurrentPage); 
      } 
    });
    if (historyNextBtn) historyNextBtn.addEventListener('click', () => { 
      qrHistoryCurrentPage++; 
      loadQRHistory(qrHistoryCurrentPage); 
    });
    if (historyStatusFilter) historyStatusFilter.addEventListener('change', () => { 
      qrHistoryCurrentPage = 1; 
      loadQRHistory(qrHistoryCurrentPage); 
    });

    // Start polling for status updates every 5 seconds
    updateQRStatus();
    updateCurrentQR();
    loadQRHistory(1);
    loadTodayStats();
    
    if (qrStatusPollHandle) clearInterval(qrStatusPollHandle);
    qrStatusPollHandle = setInterval(() => {
      updateQRStatus();
      updateCurrentQR();
    }, 5000);
  }

  // Stop Live QR Dashboard (when switching tabs)
  function stopLiveQR() {
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
      const resp = await fetch(apiBase + '/hr/qr/status', { credentials: 'include' });
      if (!resp.ok) throw new Error('Failed to fetch status');
      const data = await resp.json();

      // Update status badge
      const statusBadge = qs('#qr-status-badge');
      const statusMessage = qs('#qr-status-message');
      const automationStatus = qs('#qr-automation-status');
      const pausedNotice = qs('#qr-paused-notice');
      const pauseReason = qs('#qr-pause-reason');
      const pauseBtn = qs('#qr-pause-btn');
      const resumeBtn = qs('#qr-resume-btn');

      if (statusBadge) {
        if (!data.enabled) {
          statusBadge.textContent = '○ Disabled';
          statusBadge.style.color = '#6c757d';
        } else if (data.paused) {
          statusBadge.textContent = '⏸ Paused';
          statusBadge.style.color = '#ffc107';
        } else {
          statusBadge.textContent = '● Active';
          statusBadge.style.color = '#28a745';
        }
      }

      if (statusMessage) {
        if (!data.enabled) statusMessage.textContent = 'Automation is currently disabled';
        else if (data.paused) statusMessage.textContent = 'QR generation is paused';
        else statusMessage.textContent = 'Automated QR generation active';
      }

      if (automationStatus) {
        if (!data.enabled) {
          automationStatus.textContent = 'Disabled (configure in Superadmin)';
        } else {
          const schedule = `${data.scheduleStart || '07:00'} - ${data.scheduleEnd || '18:00'}`;
          const days = data.activeDays || '1,2,3,4,5';
          automationStatus.innerHTML = `Active • ${data.intervalSeconds || 60}s interval<br><small style="font-size:11px;color:var(--muted-foreground);">${schedule} • Days: ${days}</small>`;
        }
      }

      if (pausedNotice) {
        if (data.paused && data.pausedReason) {
          pausedNotice.style.display = 'block';
          if (pauseReason) pauseReason.textContent = data.pausedReason;
        } else {
          pausedNotice.style.display = 'none';
        }
      }

      if (pauseBtn && resumeBtn) {
        if (data.paused) {
          pauseBtn.style.display = 'none';
          resumeBtn.style.display = 'inline-block';
        } else {
          pauseBtn.style.display = data.allowHrPause ? 'inline-block' : 'none';
          resumeBtn.style.display = 'none';
        }
      }

      // Update last generated timestamp
      const lastEl = qs('#qr-last');
      if (lastEl && data.lastGeneratedAt) {
        lastEl.textContent = new Date(data.lastGeneratedAt).toLocaleString();
      } else if (lastEl) {
        lastEl.textContent = '—';
      }

    } catch (e) {
      console.error('[Live QR] Failed to update QR status:', e);
    }
  }

  // Update Current QR Code Display
  async function updateCurrentQR() {
    try {
      const resp = await fetch(apiBase + '/hr/qr/current', { credentials: 'include' });
      if (!resp.ok) {
        // No current QR
        const qrImage = qs('#qr-code-image');
        const qrPlaceholder = qs('#qr-placeholder');
        if (qrImage) qrImage.style.display = 'none';
        if (qrPlaceholder) {
          qrPlaceholder.textContent = 'No active QR code';
          qrPlaceholder.style.display = 'block';
        }
        stopCountdown();
        return;
      }

      const data = await resp.json();
      currentQRSession = data.session;

      // Display QR code image
      const qrImage = qs('#qr-code-image');
      const qrPlaceholder = qs('#qr-placeholder');
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
      const expires = new Date(expiresAt);
      const secondsLeft = Math.max(0, Math.floor((expires - now) / 1000));
      
      if (secondsLeft > 0) {
        const mins = Math.floor(secondsLeft / 60);
        const secs = secondsLeft % 60;
        countdownEl.textContent = `${mins}m ${secs}s`;
      } else {
        countdownEl.textContent = 'Expired (refreshing...)';
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
    if (countdownEl) countdownEl.textContent = '—';
  }

  // Pause QR Generation
  async function pauseQRGeneration() {
    const reason = prompt('Please provide a reason for pausing QR generation:');
    if (!reason || reason.trim() === '') {
      alert('Pause reason is required');
      return;
    }

    try {
      const resp = await fetch(apiBase + '/hr/qr/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: reason.trim() })
      });

      if (!resp.ok) {
        const error = await resp.json().catch(() => ({ message: 'Failed to pause' }));
        alert(error.message || 'Failed to pause QR generation');
        return;
      }

      alert('QR generation paused successfully');
      updateQRStatus();
      loadQRHistory(qrHistoryCurrentPage);
    } catch (e) {
      console.error('[Live QR] Error pausing QR:', e);
      alert('Error pausing QR generation');
    }
  }

  // Resume QR Generation
  async function resumeQRGeneration() {
    if (!confirm('Resume automated QR generation?')) return;

    try {
      const resp = await fetch(apiBase + '/hr/qr/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({})
      });

      if (!resp.ok) {
        const error = await resp.json().catch(() => ({ message: 'Failed to resume' }));
        alert(error.message || 'Failed to resume QR generation');
        return;
      }

      alert('QR generation resumed successfully');
      updateQRStatus();
      updateCurrentQR();
      loadQRHistory(qrHistoryCurrentPage);
    } catch (e) {
      console.error('[Live QR] Error resuming QR:', e);
      alert('Error resuming QR generation');
    }
  }

  // Load QR Session History
  async function loadQRHistory(page = 1) {
    try {
      const statusFilter = qs('#history-status-filter');
      const status = statusFilter ? statusFilter.value : '';
      
      let url = `${apiBase}/hr/qr/history?_page=${page}&_limit=${qrHistoryPageSize}`;
      if (status) url += `&status=${status}`;

      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('Failed to fetch history');

      const sessions = await resp.json();
      const totalCount = parseInt(resp.headers.get('X-Total-Count') || '0', 10);

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
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted-foreground);">No sessions found</td></tr>';
      return;
    }

    tbody.innerHTML = sessions.map(s => {
      const createdAt = new Date(s.created_at).toLocaleString();
      const expiresAt = s.expires_at ? new Date(s.expires_at).toLocaleString() : '—';
      const statusClass = s.status === 'active' ? 'on-time' : s.status === 'paused' ? 'late' : '';
      const statusText = s.status || 'expired';
      const scans = s.total_scans || 0;
      const createdBy = s.created_by_name || s.created_by || 'System';
      const pauseReason = s.pause_reason || '—';

      return `
        <tr>
          <td><code style="font-size:12px;">${escapeHtml(s.session_id.substring(0, 8))}...</code></td>
          <td style="font-size:13px;">${createdAt}</td>
          <td style="font-size:13px;">${expiresAt}</td>
          <td><span class="status ${statusClass}">${escapeHtml(statusText)}</span></td>
          <td><strong>${scans}</strong></td>
          <td style="font-size:13px;">${escapeHtml(createdBy)}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${escapeHtml(pauseReason)}</td>
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
    
    if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages} (${totalCount} total)`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }

  // Load Today's Stats
  async function loadTodayStats() {
    try {
      // Get today's attendance count
      const attResp = await fetch(apiBase + '/hr/attendance', { credentials: 'include' });
      if (attResp.ok) {
        const attendance = await attResp.json();
        const todayScans = Array.isArray(attendance) ? attendance.length : 0;
        const scansEl = qs('#today-scans-count');
        if (scansEl) scansEl.textContent = todayScans;
      }

      // Get today's sessions count
      const today = new Date().toISOString().split('T')[0];
      const histResp = await fetch(`${apiBase}/hr/qr/history?from=${today}&to=${today}`, { credentials: 'include' });
      if (histResp.ok) {
        const sessions = await histResp.json();
        const todaySessions = Array.isArray(sessions) ? sessions.length : 0;
        const sessionsEl = qs('#today-sessions-count');
        if (sessionsEl) sessionsEl.textContent = todaySessions;
      }
    } catch (e) {
      console.error('[Live QR] Failed to load today stats:', e);
    }
  }

  // Expose functions globally for tab switching
  window.initializeLiveQR = initializeLiveQR;
  window.stopLiveQR = stopLiveQR;

  console.log('[Live QR] Module loaded successfully');
})();
