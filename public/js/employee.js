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

        // New password change listeners
        document.getElementById('changePasswordBtn').addEventListener('click', openPasswordModal);
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
    }

    async function handleChangePassword() {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (!currentPassword || !newPassword || !confirmPassword) {
            showMessage('Please fill in all password fields.', true);
            return;
        }
        if (newPassword !== confirmPassword) {
            showMessage('New passwords do not match.', true);
            return;
        }
        if (newPassword.length < 8) {
            showMessage('New password must be at least 8 characters long.', true);
            return;
        }

        try {
            await window.AppApi.changePassword({ currentPassword, newPassword });
            showMessage('Password updated successfully! Please log in again.', false);
            closePasswordModal();
            
            // Log the user out for security
            setTimeout(() => {
                handleLogout();
            }, 1500);

        } catch (e) {
            showMessage(`Error: ${e.message}`, true);
        }
    }


    // --- Notification Functions ---

    function toggleNotifications() {
        const dropdown = document.getElementById('notificationsDropdown');
        const isVisible = dropdown.style.display === 'block';
        dropdown.style.display = isVisible ? 'none' : 'block';
    }

    async function fetchAndDisplayNotifications() {
        const list = document.getElementById('notificationsList');
        const badge = document.getElementById('notificationBadge');
        list.innerHTML = '<div class="empty-state">Loading...</div>';

        try {
            const notifications = await window.AppApi.getNotifications();
            
            if (notifications && notifications.length > 0) {
                list.innerHTML = ''; // Clear loading state
                notifications.forEach(n => {
                    const item = document.createElement('div');
                    item.className = 'notification-item';
                    item.dataset.id = n.notif_id;
                    item.innerHTML = `
                        <p>${n.message}</p>
                        <span class="timestamp">${new Date(n.created_at).toLocaleString()}</span>
                    `;
                    list.appendChild(item);
                });
                badge.textContent = notifications.length;
                badge.style.display = 'block';
            } else {
                list.innerHTML = '<div class="empty-state">You have no new notifications.</div>';
                badge.style.display = 'none';
            }
        } catch (e) {
            list.innerHTML = `<div class="empty-state error">Failed to load notifications.</div>`;
            badge.style.display = 'none';
        }
    }

    async function handleMarkAllRead() {
        try {
            await window.AppApi.markNotificationsRead(); // Mark all as read
            showMessage('All notifications marked as read.', false);
            fetchAndDisplayNotifications(); // Refresh the list
            setTimeout(() => {
                document.getElementById('notificationsDropdown').style.display = 'none';
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
        tbody.innerHTML = '<tr><td colspan="5">Loading requests...</td></tr>';

        try {
            const requests = await window.AppApi.getRequests();
            const emptyRow = document.getElementById('requests-empty-row');

            // Clear existing rows except the template
            tbody.innerHTML = '';
            tbody.appendChild(emptyRow);

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
                emptyRow.style.display = 'none';
            } else {
                emptyRow.style.display = '';
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