// QR scanner / attendance UI handler

(() => {
    // Populate employee header from backend
    document.addEventListener('DOMContentLoaded', () => {
        try{
            const userRaw = sessionStorage.getItem('workline_user');
            const user = userRaw ? JSON.parse(userRaw) : null;
            const email = user && user.email;
            // set today text
            const todayEl = document.getElementById('todayText');
            if (todayEl){
                const d = new Date();
                todayEl.textContent = d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'2-digit', year:'numeric' });
            }
            if (!email) return;
            const apiBase = window.API_URL || '/api';
            const tok = sessionStorage.getItem('workline_token');
            const headers = { 'Accept':'application/json' };
            if (tok) headers['Authorization'] = 'Bearer ' + tok;
            fetch(`${apiBase}/employee/by-email?email=${encodeURIComponent(email)}`, { headers }).then(async resp => {
                if (!resp.ok) return;
                const emp = await resp.json();
                const nameEl = document.getElementById('empName'); if (nameEl) nameEl.textContent = emp.name || email;
                const deptEl = document.getElementById('empDept'); if (deptEl) deptEl.textContent = emp.department || '—';
                const dept2El = document.getElementById('empDept2'); if (dept2El) dept2El.textContent = emp.department || '—';
                const idEl = document.getElementById('empId'); if (idEl) idEl.textContent = emp.employee_id || (emp.id? String(emp.id): '—');
                // schedule remain TBA in both spots
                const schedEl = document.getElementById('empSchedule'); if (schedEl) schedEl.textContent = 'TBA';
                const sched2El = document.getElementById('empSchedule2'); if (sched2El) sched2El.textContent = 'TBA';
            }).catch(()=>{});
        }catch(e){}
    });
    const qrScanBtn = document.getElementById('qrScanBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const qrContainer = document.getElementById('qrContainer');
    const qrReaderId = 'qr-reader';
    const qrCloseBtn = document.getElementById('qrCloseBtn');
    const qrModalBackdrop = document.getElementById('qrModalBackdrop');
    const qrModal = document.getElementById('qrModal');
    const qrModalClose = document.getElementById('qrModalClose');
    const qrModalCancel = document.getElementById('qrModalCancel');
    const qrMessage = document.getElementById('qrMessage');
    const attendanceTbody = document.querySelector('.attendance-table tbody');

    let html5QrcodeScanner = null;

    // Helper: return session user object stored in sessionStorage
    function getSessionUser(){
        try{
            const raw = sessionStorage.getItem('workline_user');
            return raw ? JSON.parse(raw) : null;
        }catch(e){ return null; }
    }

    // Helper: show a temporary message in the status-notice area
    function showMessage(msg, isError = false, timeout = 3500){
        const notice = document.querySelector('.status-notice div p');
        if (notice) notice.textContent = msg;
        const el = document.querySelector('.status-notice');
        if (el) el.style.color = isError ? '#b00020' : '#0b6e4f';
        if (timeout > 0) setTimeout(() => { try{ if (notice) notice.textContent = ''; }catch(e){} }, timeout);
    }

    // Populate employee info into the header card
    async function populateEmployeeInfo(user){
        try{
            const email = user && user.email;
            if (!email) return;
            const emp = await window.AppApi.getEmployeeData(email);
            const nameEl = document.getElementById('empName'); if (nameEl) nameEl.textContent = emp.name || email;
            const deptEl = document.getElementById('empDept'); if (deptEl) deptEl.textContent = emp.department || '—';
            const dept2El = document.getElementById('empDept2'); if (dept2El) dept2El.textContent = emp.department || '—';
            const idEl = document.getElementById('empId'); if (idEl) idEl.textContent = emp.employee_id || (emp.id? String(emp.id): '—');
            // Keep schedule as TBA unless backend provides it later
            const schedEl = document.getElementById('empSchedule'); if (schedEl) schedEl.textContent = 'TBA';
            const sched2El = document.getElementById('empSchedule2'); if (sched2El) sched2El.textContent = 'TBA';
        }catch(e){ /* silent */ }
    }

    // Fetch last 7 days attendance and render table
    async function fetchAndDisplayAttendance(user){
        try{
            const email = user && user.email; if (!email) return;
            const today = new Date();
            const start = new Date(today.getTime() - 6*24*60*60*1000); // last 7 days inclusive
            const iso = (d)=> d.toISOString().slice(0,10);
            const records = await window.AppApi.getAttendanceHistory({ employee: email, start: iso(start), end: iso(today) });

            const tbody = document.querySelector('.attendance-table tbody');
            if (!tbody) return;
            const emptyRow = document.getElementById('attendance-empty-row');
            // Clear existing rows except template if present
            tbody.innerHTML = '';
            if (emptyRow) tbody.appendChild(emptyRow);

            if (Array.isArray(records) && records.length){
                records.forEach(r => {
                    const tr = document.createElement('tr');
                    // Extract just the date part (YYYY-MM-DD) from the date field
                    const date = r.date ? new Date(r.date).toISOString().split('T')[0] : (r.time_in ? String(r.time_in).slice(0,10) : '');
                    
                    // Fix time display - combine date and time_in to create proper timestamp
                    let time = '-';
                    if (r.time_in && r.date) {
                        try {
                            // Extract just the date part from the date field (in case it includes timezone)
                            const dateStr = new Date(r.date).toISOString().split('T')[0];
                            // Create a proper datetime by combining date and time
                            const dateTimeStr = `${dateStr}T${r.time_in}`;
                            const dateTime = new Date(dateTimeStr);
                            time = dateTime.toLocaleTimeString();
                        } catch (e) {
                            // Fallback: just display the time string as-is
                            time = r.time_in;
                        }
                    }
                    
                    const status = (r.status || 'present');
                    tr.innerHTML = `
                        <td>${date}</td>
                        <td>${time}</td>
                        <td><span class="status ${status.toLowerCase()==='late'?'late':'on-time'}">${status}</span></td>
                    `;
                    tbody.appendChild(tr);
                });
                if (emptyRow) emptyRow.style.display = 'none';
            } else {
                if (emptyRow) emptyRow.style.display = '';
            }
        }catch(e){ /* silent render failure */ }
    }

    // Logout handler
    async function handleLogout(){
        try{ if (window.AppApi && window.AppApi.logout) await window.AppApi.logout(); }catch(e){}
        try{ sessionStorage.removeItem('workline_user'); sessionStorage.removeItem('workline_token'); }catch(e){}
        window.location.href = '../index.html';
    }

    // QR open/close wrappers used by event handlers
    function openQrScanner(){ startScanner(); }
    function closeQrScanner(){ closeModal(); }

    function showStatus(text, isError = false) {
        const notice = document.querySelector('.status-notice div p');
        if (notice) notice.textContent = text;
        const el = document.querySelector('.status-notice');
        if (el) el.style.color = isError ? '#b00020' : '#0b6e4f';
    }

    function prependAttendanceRow({ date, time, status }) {
        if (!attendanceTbody) return;
        const tr = document.createElement('tr');
        const tdDate = document.createElement('td'); tdDate.textContent = date;
        const tdTime = document.createElement('td'); tdTime.textContent = time;
        const tdStatus = document.createElement('td');
        const span = document.createElement('span');
        span.className = 'status ' + (status && status.toLowerCase().includes('late') ? 'late' : 'on-time');
        span.textContent = status || 'On Time';
        tdStatus.appendChild(span);
        tr.appendChild(tdDate); tr.appendChild(tdTime); tr.appendChild(tdStatus);
        attendanceTbody.prepend(tr);
    }

    async function handleScanResult(decodedText) {
        // stop the scanner immediately to avoid duplicate reads
        stopScanner();

        // show immediate feedback in modal
        if (qrMessage) qrMessage.textContent = 'Scanned. Sending to server...';

        const userRaw = sessionStorage.getItem('workline_user');
        let email = null;
        try { email = userRaw ? JSON.parse(userRaw).email : null; } catch(e){ email = null; }
        // prefer employee_id over email if present in session storage
        let employee_id = null;
        try { employee_id = userRaw ? JSON.parse(userRaw).employee_id || JSON.parse(userRaw).id || JSON.parse(userRaw).email : null; } catch(e){ employee_id = null; }

        if (!window.AppApi || typeof window.AppApi.checkin !== 'function') {
            if (qrMessage) qrMessage.textContent = 'Backend not available. Start mock server and reload.';
            return;
        }

        // try to get geolocation (non-blocking with timeout)
        const getGeo = () => new Promise((resolve) => {
            if (!navigator.geolocation) return resolve(null);
            let done = false;
            const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 4000);
            navigator.geolocation.getCurrentPosition(pos => {
                if (done) return; done = true; clearTimeout(timer);
                resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy });
            }, () => { if (!done) { done = true; clearTimeout(timer); resolve(null); } }, { enableHighAccuracy: true, maximumAge: 0, timeout: 3000 });
        });

        try {
            const geo = await getGeo();
            const payload = { session_id: decodedText, employee_id, lat: geo && geo.lat, lon: geo && geo.lon, deviceInfo: { userAgent: navigator.userAgent } };
            const res = await AppApi.checkin(payload);

            // server returns record on success
            const rec = (res && res.record) ? res.record : res;
            const dateStr = rec.dateKey || (rec.timestamp ? rec.timestamp.slice(0,10) : new Date().toISOString().slice(0,10));
            const timeStr = rec.timestamp ? new Date(rec.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
            const statusStr = rec.status || 'On Time';

            prependAttendanceRow({ date: dateStr, time: timeStr, status: statusStr });
            if (qrMessage) qrMessage.textContent = 'Attendance recorded ✓';

            setTimeout(() => {
                try { stopScanner(); } catch(e){}
                if (qrModalBackdrop) qrModalBackdrop.style.display = 'none';
                if (qrModal) qrModal.style.display = 'none';
            }, 1500);
        } catch (err) {
            console.error('checkin failed', err);
            if (qrMessage) qrMessage.textContent = 'Failed to record attendance: ' + (err && err.message ? err.message : 'Server error');
        }
    }

    function startScanner() {
        if (html5QrcodeScanner) return;
        // show modal
        if (qrModalBackdrop) qrModalBackdrop.style.display = 'block';
        if (qrModal) qrModal.style.display = 'flex';
        if (qrMessage) qrMessage.textContent = 'Point your camera at the QR code.';

        qrContainer && (qrContainer.style.display = 'block');
        html5QrcodeScanner = new Html5Qrcode(qrReaderId);
        const config = { fps: 10, qrbox: 250 };

        // Warm camera permissions via getUserMedia (improves reliability in some browsers)
        const tryGetUserMedia = async () => {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                // close tracks immediately; Html5Qrcode will reopen
                stream.getTracks().forEach(t => t.stop());
                return true;
            } catch (e) {
                return null;
            }
        };

        tryGetUserMedia().then(() => {
            Html5Qrcode.getCameras().then(cameras => {
                const cameraId = cameras && cameras.length ? cameras[0].id : null;
                // html5-qrcode accepts either deviceId string or facingMode constraints; attempt both
                if (cameraId) {
                    html5QrcodeScanner.start(
                        { deviceId: { exact: cameraId } },
                        config,
                        (decodedText) => { handleScanResult(decodedText); },
                        (errorMessage) => { /* ignore per-frame errors */ }
                    ).catch(err => {
                        // fallback to generic start
                        html5QrcodeScanner.start(
                            { facingMode: "environment" },
                            config,
                            (decodedText) => { handleScanResult(decodedText); },
                            (errorMessage) => { }
                        ).catch(e => showStatus('Camera start failed: ' + (e.message || e), true));
                    });
                } else {
                    // try starting by facingMode if no device id provided
                    html5QrcodeScanner.start(
                        { facingMode: "environment" },
                        config,
                        (decodedText) => { handleScanResult(decodedText); },
                        (errorMessage) => { }
                    ).catch(err => showStatus('Camera start failed: ' + (err.message || err), true));
                }
            }).catch(err => {
                // getCameras may fail; try starting by facingMode
                html5QrcodeScanner.start(
                    { facingMode: "environment" },
                    config,
                    (decodedText) => { handleScanResult(decodedText); },
                    (errorMessage) => { }
                ).catch(e => showStatus('Camera access error: ' + (e.message || e), true));
            });
        });
    }

    function stopScanner() {
        if (!html5QrcodeScanner) {
            qrContainer && (qrContainer.style.display = 'none');
            return;
        }
        html5QrcodeScanner.stop().then(() => {
            html5QrcodeScanner.clear();
            html5QrcodeScanner = null;
            qrContainer && (qrContainer.style.display = 'none');
        }).catch(() => {
            html5QrcodeScanner = null;
            qrContainer && (qrContainer.style.display = 'none');
        });
    }

    function closeModal() {
        // hide modal elements and clear spinner
        if (qrModalBackdrop) qrModalBackdrop.style.display = 'none';
        if (qrModal) qrModal.style.display = 'none';
        if (qrModal) {
            const spinner = qrModal.querySelector('.btn-spinner');
            if (spinner) spinner.setAttribute('hidden', '');
        }
        try { stopScanner(); } catch(e){}
    }

    // --- Main script execution ---
    document.addEventListener('DOMContentLoaded', () => {
        const user = getSessionUser();
        if (!user) {
            // not signed in, redirect to login
            window.location.href = '../index.html';
            return;
        }

        // Populate employee info
        populateEmployeeInfo(user);
        fetchAndDisplayAttendance(user);

        // Attach event listeners
        document.getElementById('logoutBtn').addEventListener('click', handleLogout);
        document.getElementById('qrScanBtn').addEventListener('click', openQrScanner);
        document.getElementById('qrModalClose').addEventListener('click', closeQrScanner);
        document.getElementById('qrModalCancel').addEventListener('click', closeQrScanner);
        document.getElementById('refreshBtn').addEventListener('click', () => fetchAndDisplayAttendance(user));

        // New request management listeners
        document.getElementById('newRequestBtn').addEventListener('click', openRequestModal);
        document.getElementById('requestModalClose').addEventListener('click', closeRequestModal);
        document.getElementById('requestModalCancel').addEventListener('click', closeRequestModal);
        document.getElementById('requestType').addEventListener('change', renderRequestFormFields);
        document.getElementById('requestModalSubmit').addEventListener('click', handleSubmitRequest);

        // New notification listeners
        document.getElementById('notificationsBtn').addEventListener('click', toggleNotifications);
        document.getElementById('markAllReadBtn').addEventListener('click', handleMarkAllRead);

        // Password change modal listeners (accessed via profile)
        document.getElementById('passwordModalClose').addEventListener('click', closePasswordModal);
        document.getElementById('passwordModalCancel').addEventListener('click', closePasswordModal);
        document.getElementById('passwordModalSubmit').addEventListener('click', handleChangePassword);


        // Fetch initial data
        fetchAndDisplayRequests();
        fetchAndDisplayNotifications();

        // Close dropdown if clicking outside
        document.addEventListener('click', function(event) {
            const dropdown = document.getElementById('notificationsDropdown');
            const button = document.getElementById('notificationsBtn');
            if (!dropdown.contains(event.target) && !button.contains(event.target)) {
                dropdown.style.display = 'none';
            }
        });
    });

    // --- Password Change Functions ---

    function openPasswordModal() {
        document.getElementById('passwordModalBackdrop').style.display = 'block';
        document.getElementById('passwordModal').style.display = 'block';
    }

    function closePasswordModal() {
        document.getElementById('passwordModalBackdrop').style.display = 'none';
        document.getElementById('passwordModal').style.display = 'none';
        // Clear fields on close
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        // Clear modal message
        const msg = document.getElementById('passwordModalMessage'); if (msg) { msg.style.display='none'; msg.textContent=''; msg.className='modal-message'; }
    }

    async function handleChangePassword() {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const msgEl = document.getElementById('passwordModalMessage');

        function setModalMessage(text, isError){
            if (!msgEl) return; msgEl.style.display='block'; msgEl.textContent = text; msgEl.className = 'modal-message ' + (isError? 'error':'success');
        }

        if (!currentPassword || !newPassword || !confirmPassword) {
            setModalMessage('Please fill in all password fields.', true);
            return;
        }
        if (newPassword !== confirmPassword) {
            setModalMessage('New passwords do not match.', true);
            return;
        }
        if (newPassword.length < 8) {
            setModalMessage('New password must be at least 8 characters long.', true);
            return;
        }

        try {
            await window.AppApi.changePassword({ currentPassword, newPassword });
            setModalMessage('Password updated successfully! You will be logged out.', false);
            // Close modal after short delay
            setTimeout(() => {
                closePasswordModal();
                // Log the user out for security
                handleLogout();
            }, 1200);

        } catch (e) {
            setModalMessage(`Error: ${e.message}`, true);
        }
    }


    // --- Notification Functions ---

    function toggleNotifications() {
        const dropdown = document.getElementById('notificationsDropdown');
        const isVisible = dropdown.style.display === 'block';
        dropdown.style.display = isVisible ? 'none' : 'block';
        
        // Close dropdown when clicking outside
        if (!isVisible) {
            setTimeout(() => {
                document.addEventListener('click', closeNotificationsOnClickOutside);
            }, 10);
        } else {
            document.removeEventListener('click', closeNotificationsOnClickOutside);
        }
    }

    function closeNotificationsOnClickOutside(event) {
        const dropdown = document.getElementById('notificationsDropdown');
        const container = document.querySelector('.notifications-container');
        
        if (!container.contains(event.target)) {
            dropdown.style.display = 'none';
            document.removeEventListener('click', closeNotificationsOnClickOutside);
        }
    }

    async function fetchAndDisplayNotifications() {
        const list = document.getElementById('notificationsList');
        const badge = document.getElementById('notificationBadge');
        
        // Show loading state
        list.innerHTML = '<div class="empty-state">Loading...</div>';

        try {
            const notifications = await window.AppApi.getNotifications();
            
            if (notifications && notifications.length > 0) {
                list.innerHTML = ''; // Clear loading state
                let unreadCount = 0;
                
                notifications.forEach(n => {
                    const item = document.createElement('div');
                    item.className = `notification-item ${n.read ? '' : 'unread'}`;
                    if (!n.read) unreadCount++;
                    
                    item.dataset.id = n.notif_id;
                    
                    // Enhanced notification display
                    const timeAgo = getTimeAgo(new Date(n.created_at));
                    
                    item.innerHTML = `
                        <div class="title">${n.title || 'Notification'}</div>
                        <div class="message">${n.message}</div>
                        <div class="time">${timeAgo}</div>
                    `;
                    
                    // Mark as read when clicked
                    item.addEventListener('click', () => markNotificationAsRead(n.notif_id, item));
                    
                    list.appendChild(item);
                });
                
                // Update badge
                if (unreadCount > 0) {
                    badge.textContent = unreadCount;
                    badge.style.display = 'block';
                } else {
                    badge.style.display = 'none';
                }
            } else {
                list.innerHTML = '<div class="empty-state">You have no new notifications.</div>';
                badge.style.display = 'none';
            }
        } catch (e) {
            // If API fails, show sample notifications for demo
            console.warn('API not available, showing sample notifications');
            
            // Show sample notifications (already in HTML)
            const sampleItems = list.querySelectorAll('.notification-item');
            if (sampleItems.length > 0) {
                const unreadItems = list.querySelectorAll('.notification-item.unread');
                if (unreadItems.length > 0) {
                    badge.textContent = unreadItems.length;
                    badge.style.display = 'block';
                } else {
                    badge.style.display = 'none';
                }
                
                // Add click handlers to sample notifications
                sampleItems.forEach(item => {
                    item.addEventListener('click', () => {
                        item.classList.remove('unread');
                        updateBadgeCount();
                    });
                });
            } else {
                list.innerHTML = '<div class="empty-state">You have no new notifications.</div>';
                badge.style.display = 'none';
            }
        }
    }

    function getTimeAgo(date) {
        const now = new Date();
        const diffInMs = now - date;
        const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
        const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
        
        if (diffInHours < 1) {
            const diffInMins = Math.floor(diffInMs / (1000 * 60));
            return diffInMins <= 1 ? 'Just now' : `${diffInMins} minutes ago`;
        } else if (diffInHours < 24) {
            return diffInHours === 1 ? '1 hour ago' : `${diffInHours} hours ago`;
        } else if (diffInDays === 1) {
            return '1 day ago';
        } else if (diffInDays < 7) {
            return `${diffInDays} days ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    async function markNotificationAsRead(notifId, itemElement) {
        try {
            if (window.AppApi && window.AppApi.markNotificationRead) {
                await window.AppApi.markNotificationRead(notifId);
            }
            itemElement.classList.remove('unread');
            updateBadgeCount();
        } catch (e) {
            console.warn('Failed to mark notification as read:', e);
            // Still update UI for better UX
            itemElement.classList.remove('unread');
            updateBadgeCount();
        }
    }

    function updateBadgeCount() {
        const badge = document.getElementById('notificationBadge');
        const unreadItems = document.querySelectorAll('.notification-item.unread');
        
        if (unreadItems.length > 0) {
            badge.textContent = unreadItems.length;
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    }

    async function handleMarkAllRead() {
        try {
            // Mark all notifications as read on server
            if (window.AppApi && window.AppApi.markNotificationsRead) {
                await window.AppApi.markNotificationsRead();
            }
            
            // Update UI immediately
            const unreadItems = document.querySelectorAll('.notification-item.unread');
            unreadItems.forEach(item => item.classList.remove('unread'));
            updateBadgeCount();
            
            showMessage('All notifications marked as read.', false);
            
            setTimeout(() => {
                document.getElementById('notificationsDropdown').style.display = 'none';
                document.removeEventListener('click', closeNotificationsOnClickOutside);
            }, 800);
        } catch (e) {
            showMessage(`Error: ${e.message}`, true);
        }
    }


    // --- Request Management Functions ---

    function openRequestModal() {
        document.getElementById('requestModalBackdrop').style.display = 'block';
        document.getElementById('requestModal').style.display = 'block';
        renderRequestFormFields(); // Render fields for the default selection
    }

    function closeRequestModal() {
        document.getElementById('requestModalBackdrop').style.display = 'none';
        document.getElementById('requestModal').style.display = 'none';
    }

    function renderRequestFormFields() {
        const requestType = document.getElementById('requestType').value;
        const container = document.getElementById('request-form-fields');
        let html = '';

        switch (requestType) {
            case 'leave':
                html = `
                    <div class="form-group">
                        <label for="leaveStartDate">Start Date</label>
                        <input type="date" id="leaveStartDate" required>
                    </div>
                    <div class="form-group">
                        <label for="leaveEndDate">End Date</label>
                        <input type="date" id="leaveEndDate" required>
                    </div>
                    <div class="form-group">
                        <label for="leaveReason">Reason</label>
                        <textarea id="leaveReason" rows="3" placeholder="e.g., Vacation, Sick leave"></textarea>
                    </div>
                `;
                break;
            case 'overtime':
                html = `
                    <div class="form-group">
                        <label for="overtimeDate">Date</label>
                        <input type="date" id="overtimeDate" required>
                    </div>
                    <div class="form-group">
                        <label for="overtimeHours">Hours</label>
                        <input type="number" id="overtimeHours" min="0.5" step="0.5" placeholder="e.g., 2.5" required>
                    </div>
                    <div class="form-group">
                        <label for="overtimeReason">Reason</label>
                        <textarea id="overtimeReason" rows="3" placeholder="e.g., Project deadline"></textarea>
                    </div>
                `;
                break;
            case 'correction':
                html = `
                    <div class="form-group">
                        <label for="correctionDate">Date of Missed Log</label>
                        <input type="date" id="correctionDate" required>
                    </div>
                    <div class="form-group">
                        <label for="correctionType">Log Type</label>
                        <select id="correctionType">
                            <option value="time_in">Time-in</option>
                            <option value="time_out">Time-out</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="correctionTime">Actual Time</label>
                        <input type="time" id="correctionTime" required>
                    </div>
                    <div class="form-group">
                        <label for="correctionReason">Reason</label>
                        <textarea id="correctionReason" rows="3" placeholder="e.g., Forgot to scan QR code"></textarea>
                    </div>
                `;
                break;
        }
        container.innerHTML = html;
    }

    async function handleSubmitRequest() {
        const requestType = document.getElementById('requestType').value;
        let details = {};
        let isValid = true;

        try {
            switch (requestType) {
                case 'leave':
                    details = {
                        startDate: document.getElementById('leaveStartDate').value,
                        endDate: document.getElementById('leaveEndDate').value,
                        reason: document.getElementById('leaveReason').value,
                    };
                    if (!details.startDate || !details.endDate) isValid = false;
                    break;
                case 'overtime':
                    details = {
                        date: document.getElementById('overtimeDate').value,
                        hours: parseFloat(document.getElementById('overtimeHours').value),
                        reason: document.getElementById('overtimeReason').value,
                    };
                    if (!details.date || isNaN(details.hours) || details.hours <= 0) isValid = false;
                    break;
                case 'correction':
                    details = {
                        date: document.getElementById('correctionDate').value,
                        type: document.getElementById('correctionType').value,
                        time: document.getElementById('correctionTime').value,
                        reason: document.getElementById('correctionReason').value,
                    };
                    if (!details.date || !details.time) isValid = false;
                    break;
            }

            if (!isValid) {
                showMessage('Please fill in all required fields.', true);
                return;
            }

            await window.AppApi.createRequest({ request_type: requestType, details });
            showMessage('Request submitted successfully!', false);
            closeRequestModal();
            fetchAndDisplayRequests(); // Refresh the requests table
        } catch (e) {
            showMessage(`Error: ${e.message}`, true);
        }
    }

    async function fetchAndDisplayRequests() {
        const tbody = document.querySelector('.requests-table tbody');
        // Grab the template empty-row (if present) before manipulating innerHTML
        const emptyRowTemplate = document.getElementById('requests-empty-row');
        // show temporary loading row
        tbody.innerHTML = '<tr><td colspan="5">Loading requests...</td></tr>';

        try {
            const requests = await window.AppApi.getRequests();

            // Prepare a template row element we can re-insert. Clone if original exists, otherwise create a fallback.
            let templateRow;
            if (emptyRowTemplate) {
                templateRow = emptyRowTemplate.cloneNode(true);
            } else {
                templateRow = document.createElement('tr');
                templateRow.id = 'requests-empty-row';
                templateRow.innerHTML = '<td colspan="5" style="text-align:center;color:var(--muted-foreground);padding:24px;">You have not submitted any requests yet.</td>';
            }

            // Clear table and insert the template
            tbody.innerHTML = '';
            tbody.appendChild(templateRow);

            if (requests && requests.length > 0) {
                requests.forEach(req => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${req.request_id}</td>
                        <td>${req.request_type}</td>
                        <td>${new Date(req.created_at).toLocaleDateString()}</td>
                        <td><span class="status-badge status-${req.status}">${req.status}</span></td>
                        <td>${formatRequestDetails(req.details)}</td>
                    `;
                    tbody.prepend(tr);
                });
                templateRow.style.display = 'none';
            } else {
                templateRow.style.display = '';
            }
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="5" class="error">Failed to load requests: ${e.message}</td></tr>`;
        }
    }

    function formatRequestDetails(details) {
        if (!details) return 'N/A';
        return Object.entries(details)
            .map(([key, value]) => `<strong>${key}:</strong> ${value}`)
            .join('<br>');
    }

})();