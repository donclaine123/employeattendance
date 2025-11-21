// HR Live QR Dashboard - Automated QR Code Management
// This module handles the real-time QR display, pause/resume controls, and session history

(function() {
  function qs(sel, root=document) { return root.querySelector(sel); }
  function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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

      // Update status badge and automation status
      const automationStatus = qs('#qr-automation-status');
      const pausedNotice = qs('#qr-paused-notice');
      const pauseReason = qs('#qr-pause-reason');
      const pauseBtn = qs('#qr-pause-btn');
      const resumeBtn = qs('#qr-resume-btn');
      const lastGenerated = qs('#qr-last');

      if (automationStatus) {
        let statusHTML = '';
        if (!data.enabled) {
          statusHTML = '<span class="status-badge-inactive">Disabled</span> Not generating';
        } else if (data.paused) {
          statusHTML = '<span class="status-badge-paused">⏸ Paused</span> Generation paused';
        } else {
          statusHTML = '<span class="status-badge-active">Active</span> Auto-generating';
        }
        automationStatus.innerHTML = statusHTML;
      }

      // Show/hide pause notice
      if (pausedNotice) {
        if (data.paused && data.pausedReason) {
          pausedNotice.style.display = 'block';
          if (pauseReason) pauseReason.textContent = data.pausedReason;
        } else {
          pausedNotice.style.display = 'none';
        }
      }

      // Toggle pause/resume buttons
      if (pauseBtn && resumeBtn) {
        if (data.paused) {
          pauseBtn.style.display = 'none';
          resumeBtn.style.display = 'flex';
        } else {
          pauseBtn.style.display = data.allowHrPause ? 'flex' : 'none';
          resumeBtn.style.display = 'none';
        }
      }

      // Last generated timestamp removed (UI cleanup)

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

      const data = await resp.json();
      currentQRSession = data.session;

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
      const expires = new Date(expiresAt);
      const secondsLeft = Math.max(0, Math.floor((expires - now) / 1000));
      
      const timeSpan = countdownEl.querySelector('span');
      if (secondsLeft > 0) {
        const mins = Math.floor(secondsLeft / 60);
        const secs = secondsLeft % 60;
        const timeText = `${mins}:${secs.toString().padStart(2, '0')}`;
        if (timeSpan) {
          timeSpan.textContent = timeText;
        } else {
          countdownEl.textContent = timeText;
        }
      } else {
        if (timeSpan) {
          timeSpan.textContent = 'Expired';
        } else {
          countdownEl.textContent = 'Expired (refreshing...)';
        }
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
      const status = statusFilter ? statusFilter.value : 'with-scans'; // Default to with-scans
      
      let url = `${apiBase}/hr/qr/history?_page=${page}&_limit=${qrHistoryPageSize}`;
      if (status && status !== 'with-scans') {
        url += `&status=${status}`;
      } else if (status === 'with-scans') {
        url += `&has_scans=true`; // New filter parameter
      }

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
      tbody.innerHTML = '<tr><td colspan="6" class="qr-history-loading">No sessions found</td></tr>';
      return;
    }

    tbody.innerHTML = sessions.map(s => {
      const createdDate = new Date(s.created_at);
      const createdAt = getTimeAgo(createdDate);
      
      let expiresText = '—';
      if (s.expires_at) {
        const expiresDate = new Date(s.expires_at);
        const now = new Date();
        if (expiresDate > now) {
          const hoursLeft = Math.floor((expiresDate - now) / (1000 * 60 * 60));
          expiresText = `${hoursLeft} hours`;
        } else {
          expiresText = 'Expired';
        }
      }
      
      let statusBadge = '';
      if (s.status === 'active') {
        statusBadge = '<span class="badge-green">active</span>';
      } else if (s.status === 'paused') {
        statusBadge = '<span class="badge-yellow">paused</span>';
      } else {
        statusBadge = '<span class="badge-red">expired</span>';
      }
      
      const checkins = s.checkins || 0;
      const checkouts = s.checkouts || 0;
      const createdBy = s.created_by_name || s.created_by || 'Admin User';

      return `
        <tr>
          <td><strong>${escapeHtml(s.session_id || 'Unknown')}</strong></td>
          <td>${createdAt}</td>
          <td>${expiresText}</td>
          <td>${statusBadge}</td>
          <td><strong>${checkins}</strong></td>
          <td><strong>${checkouts}</strong></td>
          <td>${escapeHtml(createdBy)}</td>
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
      const attResp = await fetch(`${apiBase}/hr/attendance?start_date=${today}&end_date=${today}`, { credentials: 'include' });
      if (attResp.ok) {
        const attendance = await attResp.json();
        
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

  // Expose functions globally for tab switching
  window.initializeLiveQR = initializeLiveQR;
  window.stopLiveQR = stopLiveQR;

  console.log('[Live QR] Module loaded successfully');
})();
