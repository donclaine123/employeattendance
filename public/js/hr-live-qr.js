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

  // Convert database timestamp (Manila time with UTC marker) to local Date object
  // The database returns Manila time (e.g., 14:09) but marks it as UTC+00
  // Browser interprets it as UTC, so we need to subtract 8 hours to get the correct time
  function parseDbTimestamp(isoString) {
    if (!isoString) return null;
    const date = new Date(isoString);
    // Subtract 8 hours for Manila timezone offset
    date.setHours(date.getHours() - 8);
    return date;
  }

  const apiBase = window.API_URL || '/api';
  let qrStatusPollHandle = null;
  let qrCountdownHandle = null;
  let currentQRSession = null;
  let qrHistoryCurrentPage = 1;
  const qrHistoryPageSize = 10;
  let socket = null;
  let socketConnected = false;

  // Initialize WebSocket for real-time QR updates
  function initWebSocket() {
    try {
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
  function initializeLiveQR() {
    console.log('[Live QR] Initializing automated QR dashboard');
    
    // Initialize WebSocket for real-time updates
    initWebSocket();
    
    // Set up event listeners
    const pauseBtn = qs('#qr-pause-btn');
    const resumeBtn = qs('#qr-resume-btn');
    const historyPrevBtn = qs('#history-prev-btn');
    const historyNextBtn = qs('#history-next-btn');
    const historyStatusFilter = qs('#history-status-filter');

    if (pauseBtn) pauseBtn.addEventListener('click', pauseQRGeneration);
    if (resumeBtn) resumeBtn.addEventListener('click', resumeQRGeneration);
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
    }, 1000);
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
  // Note: Updates based on current session status instead of automation state endpoint
  async function updateQRStatus() {
    try {
      // Get automation status from QR session (no dedicated endpoint exists)
      // For now, just update UI based on currentQRSession if available
      const automationStatus = qs('#qr-automation-status');
      const pauseBtn = qs('#qr-pause-btn');
      const resumeBtn = qs('#qr-resume-btn');

      if (automationStatus && currentQRSession) {
        let statusHTML = '';
        if (currentQRSession.is_active === false) {
          statusHTML = '<span class="status-badge-inactive">Disabled</span> Not active';
        } else if (currentQRSession.is_paused) {
          statusHTML = '<span class="status-badge-paused">⏸ Paused</span> Session paused';
        } else {
          statusHTML = '<span class="status-badge-active">Active</span> Auto-generating';
        }
        automationStatus.innerHTML = statusHTML;
      }

      // Toggle pause/resume buttons based on session state
      if (pauseBtn && resumeBtn && currentQRSession) {
        if (currentQRSession.is_paused) {
          pauseBtn.style.display = 'none';
          resumeBtn.style.display = 'flex';
        } else {
          pauseBtn.style.display = 'flex';
          resumeBtn.style.display = 'none';
        }
      }

    } catch (e) {
      console.error('[Live QR] Failed to update QR status:', e);
    }
  }

  // Update Current QR Code Display
  async function updateCurrentQR() {
    try {
      const resp = await fetchWithAuth(apiBase + '/hr/qr/current', { credentials: 'include' });
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
      
      // Get employee ID from current QR session if available
      const employeeId = currentQRSession?.employee_id || '';
      
      let url = `${apiBase}/hr/qr/history?_page=${page}&_limit=${qrHistoryPageSize}`;
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
      tbody.innerHTML = `<tr><td colspan="7" class="qr-history-loading" style="text-align:center;padding:24px;color:var(--muted-foreground);">${message}</td></tr>`;
      return;
    }

    tbody.innerHTML = sessions.map(s => {
      // Parse database timestamps (Manila time with UTC marker)
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
      
      let statusBadge = '';
      // Determine status from is_active and is_paused fields (snake_case from API)
      const isActive = s.is_active !== undefined ? s.is_active : s.isActive;
      const isPaused = s.is_paused !== undefined ? s.is_paused : s.isPaused;
      
      if (isActive && !isPaused) {
        statusBadge = '<span class="badge-green">active</span>';
      } else if (isActive && isPaused) {
        statusBadge = '<span class="badge-yellow">paused</span>';
      } else {
        statusBadge = '<span class="badge-red">inactive</span>';
      }
      
      const checkins = s.checkins || 0;
      const checkouts = s.checkouts || 0;
      const sessionId = s.session_id || s.id || 'Unknown';

      return `
        <tr>
          <td><strong>${escapeHtml(sessionId)}</strong></td>
          <td>${createdAt}</td>
          <td>${expiresText}</td>
          <td>${statusBadge}</td>
          <td><strong>${checkins}</strong></td>
          <td><strong>${checkouts}</strong></td>
          <td>QR Session</td>
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
