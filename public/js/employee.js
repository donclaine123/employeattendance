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

    // Wire events (guard for missing elements)
    if (qrScanBtn) qrScanBtn.addEventListener('click', startScanner);
    if (qrCloseBtn) qrCloseBtn.addEventListener('click', stopScanner);
    if (qrModalClose) qrModalClose.addEventListener('click', closeModal);
    if (qrModalCancel) qrModalCancel.addEventListener('click', closeModal);
    if (refreshBtn) refreshBtn.addEventListener('click', () => { showStatus('Status refreshed', false); });

})();