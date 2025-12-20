// QR scanner / attendance UI handler

(() => {
    // Populate employee header from backend
    document.addEventListener('DOMContentLoaded', async () => {
        try{
            const user = await window.fetchUserProfile();
            const email = user && user.email;
            // set today text
            const todayEl = document.getElementById('todayText');
            if (todayEl){
                const d = new Date();
                todayEl.textContent = d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'2-digit', year:'numeric' });
            }
            if (!email) return;
            const apiBase = window.API_URL || '/api';
            fetchWithAuth(`${apiBase}/employee/by-email?email=${encodeURIComponent(email)}`, {}).then(async resp => {
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
    const switchCameraBtn = document.getElementById('switchCameraBtn');
    const attendanceTbody = document.querySelector('.attendance-table tbody');

    let html5QrcodeScanner = null;
    let availableCameras = [];
    let currentCameraIndex = -1;
    let preferBackCamera = true; // Start with back camera preference

    // Helper: return session user object from API
    async function getSessionUser(){
        try{
            return await window.fetchUserProfile();
        }catch(e){ return null; }
    }

    // Helper: show a temporary message in the status-notice area
    function showMessage(msg, isError = false, timeout = 3500){
        const notice = document.querySelector('.status-notice div p');
        const container = document.querySelector('.status-notice');
        
        if (notice && container) {
            notice.textContent = msg;
            container.classList.add('show');
            
            // Add visual styling
            if (isError) {
                notice.style.fontWeight = '500';
                if (container) container.style.backgroundColor = '#ffebee';
                if (container) container.style.borderLeft = '4px solid #b00020';
            } else {
                notice.style.fontWeight = '500';
                if (container) container.style.backgroundColor = '#e8f5e9';
                if (container) container.style.borderLeft = '4px solid #0b6e4f';
            }
        }
        
        if (container) {
            container.style.color = isError ? '#b00020' : '#0b6e4f';
            container.style.padding = '12px 16px';
            container.style.borderRadius = '4px';
        }
        
        if (timeout > 0) {
            setTimeout(() => { 
                try {
                    if (notice) notice.textContent = ''; 
                    if (container) {
                        container.classList.remove('show');
                        container.style.backgroundColor = 'transparent';
                        container.style.borderLeft = 'none';
                    }
                } catch(e) {}
            }, timeout);
        }
    }

    // Helper: format time in 12-hour AM/PM format
    function formatTimeAMPM(dateObj) {
        if (!dateObj) return '-';
        
        let hours, minutes;
        
        if (typeof dateObj === 'string') {
            const timePart = dateObj.split('.')[0];
            const parts = timePart.split(':');
            hours = parseInt(parts[0], 10);
            minutes = parseInt(parts[1], 10);
        } else {
            const dateToUse = typeof dateObj === 'number' ? new Date(dateObj) : dateObj;
            hours = dateToUse.getHours();
            minutes = dateToUse.getMinutes();
        }
        
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hour12 = hours % 12 || 12;
        return `${hour12}:${String(minutes).padStart(2, '0')} ${ampm}`;
    }

    // Load and display today's attendance status in the "Today's Status" card
    async function loadTodayStatus(user) {
        try {
            if (!user || !user.employee_id) return;

            const apiBase = window.API_URL || '/api';
            const dateParam = new Date().toISOString().split('T')[0];
            
            // Fetch today's attendance
            const historyUrl = `${apiBase}/attendance/history?employee_id=${user.employee_id}&start=${dateParam}&end=${dateParam}`;
            const attResp = await fetch(historyUrl, {
                headers: { 'Accept': 'application/json' }
            });

            if (!attResp.ok) {
                // No attendance found for today
                document.getElementById('todayStatusText').textContent = 'Not Logged In';
                document.getElementById('todayStatusTimeIn').textContent = '—:—';
                document.getElementById('todayStatusTimeOut').textContent = '—:—';
                document.getElementById('todayStatus').className = 'status-badge pending';
                document.getElementById('todayStatus').textContent = 'Pending';
                return;
            }

            const attData = await attResp.json();
            const todayAttendance = Array.isArray(attData) ? attData[0] : null; // Get first record (today's)

            if (!todayAttendance) {
                document.getElementById('todayStatusText').textContent = 'Not Logged In';
                document.getElementById('todayStatusTimeIn').textContent = '—:—';
                document.getElementById('todayStatusTimeOut').textContent = '—:—';
                document.getElementById('todayStatus').className = 'status-badge pending';
                document.getElementById('todayStatus').textContent = 'Pending';
                return;
            }

            console.log('[loadTodayStatus] Record found:', todayAttendance);
            console.log('[loadTodayStatus] time_in:', todayAttendance.time_in, 'type:', typeof todayAttendance.time_in);
            console.log('[loadTodayStatus] time_out:', todayAttendance.time_out, 'type:', typeof todayAttendance.time_out);

            // Update time in
            if (todayAttendance.time_in && 
                (typeof todayAttendance.time_in === 'string' || typeof todayAttendance.time_in === 'object')) {
                document.getElementById('todayStatusTimeIn').textContent = formatTimeAMPM(todayAttendance.time_in);
            } else {
                document.getElementById('todayStatusTimeIn').textContent = '—:—';
            }

            // Defensive check for time_out - must be string/object AND not null
            const hasTimeOut = todayAttendance.time_out && 
                              (typeof todayAttendance.time_out === 'string' || typeof todayAttendance.time_out === 'object') &&
                              String(todayAttendance.time_out).toLowerCase() !== 'null';
            
            if (hasTimeOut) {
                console.log('[loadTodayStatus] Displaying time_out:', todayAttendance.time_out);
                const timeOutEl = document.getElementById('todayStatusTimeOut');
                console.log('[loadTodayStatus] timeOutEl found?', !!timeOutEl);
                if (timeOutEl) timeOutEl.textContent = formatTimeAMPM(todayAttendance.time_out);
                
                const textEl = document.getElementById('todayStatusText');
                if (textEl) textEl.textContent = 'Logged Out';
                
                const statusEl = document.getElementById('todayStatus');
                if (statusEl) {
                    statusEl.className = 'status-badge completed';
                    statusEl.textContent = 'Completed';
                }
            } else {
                console.log('[loadTodayStatus] No time_out, showing as active');
                const timeOutEl = document.getElementById('todayStatusTimeOut');
                if (timeOutEl) timeOutEl.textContent = '—:—';
                document.getElementById('todayStatusText').textContent = 'Logged In';
                document.getElementById('todayStatus').className = 'status-badge active';
                document.getElementById('todayStatus').textContent = 'Active';
            }
        } catch (error) {
            console.error('[loadTodayStatus] Error:', error);
            // Silent fail - show default state
            document.getElementById('todayStatusText').textContent = 'Not Logged In';
            document.getElementById('todayStatusTimeIn').textContent = '—:—';
            document.getElementById('todayStatusTimeOut').textContent = '—:—';
        }
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
            // Use employee_id from user object - this is what the backend expects
            const employeeId = user && (user.employee_id || user.id);
            if (!employeeId) {
                console.log('[fetchAndDisplayAttendance] No employee_id found in user:', user);
                return;
            }
            const today = new Date();
            const start = new Date(today.getTime() - 6*24*60*60*1000); // last 7 days inclusive
            const iso = (d)=> d.toISOString().slice(0,10);
            const params = { employee: employeeId, start: iso(start), end: iso(today) };
            const records = await window.AppApi.getAttendanceHistory(params);

            const tbody = document.querySelector('.attendance-table tbody');
            if (!tbody) return;
            const emptyRow = document.getElementById('attendance-empty-row');
            // Clear existing rows except template if present
            tbody.innerHTML = '';
            if (emptyRow) tbody.appendChild(emptyRow);

            if (Array.isArray(records) && records.length){
                records.forEach((r, idx) => {
                    const tr = document.createElement('tr');
                    // Extract just the date part (YYYY-MM-DD) from the date field
                    const date = r.date ? new Date(r.date).toISOString().split('T')[0] : (r.time_in ? String(r.time_in).slice(0,10) : '');
                    
                    // Format time_in
                    let timeIn = '-';
                    if (r.time_in && r.date) {
                        try {
                            const dateStr = new Date(r.date).toISOString().split('T')[0];
                            const dateTimeStr = `${dateStr}T${r.time_in}`;
                            const dateTime = new Date(dateTimeStr);
                            timeIn = formatTimeAMPM(dateTime);
                        } catch (e) {
                            try {
                                const fallbackTime = new Date(`2000-01-01T${r.time_in}`);
                                timeIn = formatTimeAMPM(fallbackTime);
                            } catch {
                                timeIn = formatTimeAMPM(r.time_in);
                            }
                        }
                    }
                    
                    // Format time_out
                    let timeOut = '-';
                    
                    if (r.time_out && r.time_out !== 'NULL') {
                        try {
                            const dateStr = new Date(r.date).toISOString().split('T')[0];
                            const dateTimeStr = `${dateStr}T${r.time_out}`;
                            const dateTime = new Date(dateTimeStr);
                            timeOut = formatTimeAMPM(dateTime);
                        } catch (e) {
                            try {
                                const fallbackTime = new Date(`2000-01-01T${r.time_out}`);
                                timeOut = formatTimeAMPM(fallbackTime);
                            } catch (e2) {
                                timeOut = formatTimeAMPM(r.time_out);
                            }
                        }
                    }

                    // Get day of week
                    const dayName = new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });

                    // Get status
                    const status = (r.status || 'present');
                    
                    tr.innerHTML = `
                        <td>${date}</td>
                        <td>${dayName}</td>
                        <td>${timeIn}</td>
                        <td>—</td>
                        <td>—</td>
                        <td>${timeOut}</td>
                        <td>—</td>
                        <td><span class="status ${status.toLowerCase()==='late'?'late':'on-time'}">${status}</span></td>
                    `;
                    tbody.appendChild(tr);
                });
                if (emptyRow) emptyRow.style.display = 'none';
            } else {
                if (emptyRow) emptyRow.style.display = '';
            }
        }catch(e){ 
            console.error('[fetchAndDisplayAttendance] Error:', e);
        }
    }

    // Logout handler
    async function handleLogout(){
        try{ if (window.AppApi && window.AppApi.logout) await window.AppApi.logout(); }catch(e){}
        try{ sessionStorage.removeItem('workline_token'); if (window.clearProfileCache) window.clearProfileCache(); }catch(e){}
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
        if (qrMessage) qrMessage.textContent = 'QR Code scanned successfully...';

        try {
            // Get user profile to extract employee_id
            const user = await window.fetchUserProfile();
            const employee_id = user ? (user.employee_id || user.user_id || user.username) : null;
            const employee_name = user ? (user.name || user.full_name || user.email) : null;
            
            if (!employee_id) {
                if (qrMessage) qrMessage.textContent = 'Error: Could not identify employee';
                return;
            }
            
            console.log('[QR] Employee identified:', employee_id);

            // STEP 1: Validate QR session BEFORE opening modal
            if (qrMessage) qrMessage.textContent = 'Validating QR session...';
            
            const apiBase = window.API_URL || '/api';
            const validateResp = await fetch(`${apiBase}/qr/validate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: decodedText })
            });
            
            const validateResult = await validateResp.json();
            
            if (!validateResp.ok || !validateResult.valid) {
                console.log('[QR] Session validation failed:', validateResult.error);
                if (qrMessage) qrMessage.textContent = `Error: ${validateResult.error || 'Invalid QR session'}`;
                
                // Reopen scanner after showing error
                setTimeout(() => {
                    if (qrModal) qrModal.style.display = 'flex';
                    if (qrModalBackdrop) qrModalBackdrop.style.display = 'block';
                    openQrScanner();
                }, 2000);
                return;
            }
            
            console.log('[QR] Session validated successfully');

            // Store employee ID from QR scan globally
            window.scannedEmployeeId = employee_id;
            window.scannedEmployeeName = employee_name;
            window.scannedQRSessionId = decodedText;

            // STEP 2: Close QR scanner modal and open attendance action modal
            if (qrMessage) qrMessage.textContent = 'Opening authentication...';
            
            setTimeout(() => {
                try { stopScanner(); } catch(e){}
                if (qrModalBackdrop) qrModalBackdrop.style.display = 'none';
                if (qrModal) qrModal.style.display = 'none';
            }, 800);

            // STEP 3: Open the attendance modal (will pre-populate employee ID and fetch status)
            setTimeout(() => {
                window.openAttendanceActionModal();
            }, 1000);
            
        } catch (error) {
            console.error('Error processing QR scan:', error);
            if (qrMessage) qrMessage.textContent = 'Error: ' + (error.message || 'Unknown error');
            
            // Reopen scanner on error after delay
            setTimeout(() => {
                if (qrModal) qrModal.style.display = 'flex';
                if (qrModalBackdrop) qrModalBackdrop.style.display = 'block';
                openQrScanner();
            }, 2000);
        }
    }

    async function initializeCameras() {
        try {
            // Check if mediaDevices is supported
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Camera access not supported on this device/browser');
            }

            // Request camera permission first
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(t => t.stop());

            // Get available cameras
            const cameras = await Html5Qrcode.getCameras();
            
            if (!cameras || cameras.length === 0) {
                throw new Error('No cameras found on this device');
            }

            availableCameras = cameras;
            
            // Find back and front cameras
            const backCameraIndex = cameras.findIndex(camera => 
                camera.label.toLowerCase().includes('back') || 
                camera.label.toLowerCase().includes('rear') ||
                camera.label.toLowerCase().includes('environment')
            );
            
            const frontCameraIndex = cameras.findIndex(camera => 
                camera.label.toLowerCase().includes('front') || 
                camera.label.toLowerCase().includes('user') ||
                camera.label.toLowerCase().includes('facing')
            );

            // Set initial camera (prefer back camera)
            if (preferBackCamera && backCameraIndex !== -1) {
                currentCameraIndex = backCameraIndex;
            } else if (frontCameraIndex !== -1) {
                currentCameraIndex = frontCameraIndex;
            } else {
                // Default to last camera (often back) or first if only one
                currentCameraIndex = cameras.length > 1 ? cameras.length - 1 : 0;
            }

            // Show switch button only if multiple cameras available
            if (switchCameraBtn) {
                switchCameraBtn.style.display = cameras.length > 1 ? 'inline-block' : 'none';
            }

            return true;
        } catch (error) {
            // Show appropriate error message
            let errorMsg = 'Camera Error: ';
            if (error.message.includes('not supported')) {
                errorMsg += 'Your browser does not support camera access';
            } else if (error.message.includes('No cameras found')) {
                errorMsg += 'No cameras detected on your device';
            } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorMsg += 'Camera permission denied. Please enable camera access in your browser settings';
            } else if (error.name === 'NotFoundError') {
                errorMsg += 'No camera found on your device';
            } else {
                errorMsg += error.message || 'Unable to access camera';
            }
            
            if (qrMessage) {
                qrMessage.textContent = errorMsg;
                qrMessage.style.color = '#ef4444';
            }
            throw error;
        }
    }

    async function startCameraWithIndex(cameraIndex) {
        if (!html5QrcodeScanner || !availableCameras[cameraIndex]) return;

        const config = { fps: 10, qrbox: 250 };
        const cameraId = availableCameras[cameraIndex].id;

        try {
            await html5QrcodeScanner.start(
                { deviceId: { exact: cameraId } },
                config,
                (decodedText) => { handleScanResult(decodedText); },
                (errorMessage) => { /* ignore per-frame errors */ }
            );
            
            // Update message with camera info
            const cameraType = availableCameras[cameraIndex].label.toLowerCase().includes('back') || 
                               availableCameras[cameraIndex].label.toLowerCase().includes('rear') ? 
                               'back' : 'front';
            if (qrMessage) {
                qrMessage.textContent = `Using ${cameraType} camera. Point at the QR code.`;
                qrMessage.style.color = 'var(--muted-foreground)';
            }
        } catch (error) {
            // If specific camera fails, try with facingMode fallback
            const facingMode = preferBackCamera ? "environment" : "user";
            try {
                await html5QrcodeScanner.start(
                    { facingMode: facingMode },
                    config,
                    (decodedText) => { handleScanResult(decodedText); },
                    (errorMessage) => { }
                );
                if (qrMessage) {
                    qrMessage.textContent = 'Camera started. Point at the QR code.';
                    qrMessage.style.color = 'var(--muted-foreground)';
                }
            } catch (e) {
                if (qrMessage) {
                    qrMessage.textContent = 'Failed to start camera: ' + (e.message || e);
                    qrMessage.style.color = '#ef4444';
                }
            }
        }
    }

    async function startScanner() {
        if (html5QrcodeScanner) return;
        
        // Show modal
        if (qrModalBackdrop) qrModalBackdrop.style.display = 'block';
        if (qrModal) qrModal.style.display = 'flex';
        if (qrMessage) {
            qrMessage.textContent = 'Initializing camera...';
            qrMessage.style.color = 'var(--muted-foreground)';
        }

        qrContainer && (qrContainer.style.display = 'block');
        html5QrcodeScanner = new Html5Qrcode(qrReaderId);

        try {
            await initializeCameras();
            await startCameraWithIndex(currentCameraIndex);
        } catch (error) {
            console.error('Scanner initialization failed:', error);
            // Error message already set in initializeCameras
        }
    }

    async function switchCamera() {
        if (!html5QrcodeScanner || availableCameras.length <= 1) return;

        try {
            // Stop current camera
            await html5QrcodeScanner.stop();
            
            // Move to next camera
            currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
            preferBackCamera = !preferBackCamera;
            
            // Start new camera
            await startCameraWithIndex(currentCameraIndex);
        } catch (error) {
            console.error('Camera switch failed:', error);
            if (qrMessage) {
                qrMessage.textContent = 'Failed to switch camera: ' + (error.message || error);
                qrMessage.style.color = '#ef4444';
            }
        }
    }

    function stopScanner() {
        if (!html5QrcodeScanner) {
            qrContainer && (qrContainer.style.display = 'none');
            return;
        }
        html5QrcodeScanner.stop().then(() => {
            html5QrcodeScanner.clear();
            html5QrcodeScanner = null;
            availableCameras = [];
            currentCameraIndex = -1;
            qrContainer && (qrContainer.style.display = 'none');
        }).catch(() => {
            html5QrcodeScanner = null;
            availableCameras = [];
            currentCameraIndex = -1;
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
    document.addEventListener('DOMContentLoaded', async () => {
        const user = await getSessionUser();
        if (!user) {
            // not signed in, redirect to login
            console.log('[DOMContentLoaded] No user found, redirecting to login');
            window.location.href = '../index.html';
            return;
        }

        console.log('[DOMContentLoaded] User found:', user);

        // Populate employee info
        populateEmployeeInfo(user);
        loadTodayStatus(user);
        fetchAndDisplayAttendance(user);

        // Attach event listeners
        document.getElementById('logoutBtn').addEventListener('click', handleLogout);
        document.getElementById('qrScanBtn').addEventListener('click', openQrScanner);
        document.getElementById('qrModalClose').addEventListener('click', closeQrScanner);
        document.getElementById('qrModalCancel').addEventListener('click', closeQrScanner);
        document.getElementById('switchCameraBtn').addEventListener('click', switchCamera);
        
        // Refresh button - only if it exists
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => fetchAndDisplayAttendance(user));
        }

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

        // Mobile menu toggle
        const menuToggleBtn = document.getElementById('menuToggleBtn');
        const sidebar = document.querySelector('.sidebar');
        
        if (menuToggleBtn) {
            menuToggleBtn.addEventListener('click', () => {
                sidebar.classList.toggle('open');
            });
        }

        // Close sidebar when clicking nav items on tablets/mobile
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 1199) {
                    sidebar.classList.remove('open');
                }
            });
        });

        // Close sidebar when clicking outside on tablets/mobile
        document.addEventListener('click', function(event) {
            if (sidebar && menuToggleBtn && window.innerWidth <= 1199) {
                if (!sidebar.contains(event.target) && !menuToggleBtn.contains(event.target)) {
                    sidebar.classList.remove('open');
                }
            }
        });

        // Fetch initial data
        // NOTE: fetchAndDisplayRequests() is handled by dashboard script in HTML
        // fetchAndDisplayRequests();
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
                        <input type="date" id="leaveStartDate" class="form-input" required>
                    </div>
                    <div class="form-group">
                        <label for="leaveEndDate">End Date</label>
                        <input type="date" id="leaveEndDate" class="form-input" required>
                    </div>
                    <div class="form-group">
                        <label for="leaveReason">Reason</label>
                        <textarea id="leaveReason" class="form-input" rows="3" placeholder="e.g., Vacation, Sick leave"></textarea>
                    </div>
                `;
                break;
            case 'overtime':
                html = `
                    <div class="form-group">
                        <label for="overtimeDate">Date</label>
                        <input type="date" id="overtimeDate" class="form-input" required>
                    </div>
                    <div class="form-group">
                        <label for="overtimeHours">Hours</label>
                        <input type="number" id="overtimeHours" class="form-input" min="0.5" step="0.5" placeholder="e.g., 2.5" required>
                    </div>
                    <div class="form-group">
                        <label for="overtimeReason">Reason</label>
                        <textarea id="overtimeReason" class="form-input" rows="3" placeholder="e.g., Project deadline"></textarea>
                    </div>
                `;
                break;
            case 'correction':
                html = `
                    <div class="form-group">
                        <label for="correctionDate">Date of Missed Log</label>
                        <input type="date" id="correctionDate" class="form-input" required>
                    </div>
                    <div class="form-group">
                        <label for="correctionType">Log Type</label>
                        <select id="correctionType" class="form-input">
                            <option value="time_in">Time-in</option>
                            <option value="time_out">Time-out</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="correctionTime">Actual Time</label>
                        <input type="time" id="correctionTime" class="form-input" required>
                    </div>
                    <div class="form-group">
                        <label for="correctionReason">Reason</label>
                        <textarea id="correctionReason" class="form-input" rows="3" placeholder="e.g., Forgot to scan QR code"></textarea>
                    </div>
                `;
                break;
        }
        container.innerHTML = html;
        
        // Make entire date input fields clickable for date picker
        const dateInputs = container.querySelectorAll('input[type="date"]');
        dateInputs.forEach(input => {
            input.addEventListener('click', function() {
                this.showPicker();
            });
        });
    }

    async function handleSubmitRequest() {
        const requestType = document.getElementById('requestType').value;
        let details = {};
        let isValid = true;
        let errorMsg = '';

        try {
            // Validate request type
            if (!requestType) {
                showMessage('Please select a request type.', true);
                return;
            }

            console.log('[handleSubmitRequest] Request type:', requestType);

            switch (requestType) {
                case 'leave':
                    const leaveStartDate = document.getElementById('leaveStartDate');
                    const leaveEndDate = document.getElementById('leaveEndDate');
                    const leaveReason = document.getElementById('leaveReason');
                    
                    console.log('[handleSubmitRequest] Leave form elements:', { 
                        startDate: leaveStartDate?.value, 
                        endDate: leaveEndDate?.value, 
                        reason: leaveReason?.value 
                    });
                    
                    if (!leaveStartDate || !leaveEndDate || !leaveReason) {
                        errorMsg = 'Leave form fields not found. Please refresh the page.';
                        isValid = false;
                        console.error('[handleSubmitRequest] Missing elements:', { leaveStartDate, leaveEndDate, leaveReason });
                        break;
                    }
                    
                    details = {
                        startDate: leaveStartDate.value,
                        endDate: leaveEndDate.value,
                        reason: leaveReason.value,
                    };
                    console.log('[handleSubmitRequest] Leave details:', details);
                    if (!details.startDate || !details.endDate || !details.reason) {
                        errorMsg = 'Please fill in Start Date, End Date, and Reason.';
                        isValid = false;
                        console.error('[handleSubmitRequest] Missing values:', details);
                    }
                    break;
                    
                case 'overtime':
                    const overtimeDate = document.getElementById('overtimeDate');
                    const overtimeHours = document.getElementById('overtimeHours');
                    const overtimeReason = document.getElementById('overtimeReason');
                    
                    console.log('[handleSubmitRequest] Overtime form elements:', { 
                        date: overtimeDate?.value, 
                        hours: overtimeHours?.value, 
                        reason: overtimeReason?.value 
                    });
                    
                    if (!overtimeDate || !overtimeHours || !overtimeReason) {
                        errorMsg = 'Overtime form fields not found. Please refresh the page.';
                        isValid = false;
                        console.error('[handleSubmitRequest] Missing elements:', { overtimeDate, overtimeHours, overtimeReason });
                        break;
                    }
                    
                    const hoursValue = parseFloat(overtimeHours.value);
                    details = {
                        date: overtimeDate.value,
                        hours: hoursValue,
                        reason: overtimeReason.value,
                    };
                    console.log('[handleSubmitRequest] Overtime details:', details);
                    if (!details.date || isNaN(details.hours) || details.hours <= 0 || !details.reason) {
                        errorMsg = 'Please fill in Date (required), Hours (must be > 0), and Reason.';
                        isValid = false;
                        console.error('[handleSubmitRequest] Validation failed:', { 
                            date: details.date, 
                            hours: details.hours, 
                            hoursValid: !isNaN(details.hours) && details.hours > 0,
                            reason: details.reason 
                        });
                    }
                    break;
                    
                case 'correction':
                    const correctionDate = document.getElementById('correctionDate');
                    const correctionType = document.getElementById('correctionType');
                    const correctionTime = document.getElementById('correctionTime');
                    const correctionReason = document.getElementById('correctionReason');
                    
                    console.log('[handleSubmitRequest] Correction form elements:', { 
                        date: correctionDate?.value, 
                        type: correctionType?.value, 
                        time: correctionTime?.value, 
                        reason: correctionReason?.value 
                    });
                    
                    if (!correctionDate || !correctionType || !correctionTime || !correctionReason) {
                        errorMsg = 'Correction form fields not found. Please refresh the page.';
                        isValid = false;
                        console.error('[handleSubmitRequest] Missing elements:', { correctionDate, correctionType, correctionTime, correctionReason });
                        break;
                    }
                    
                    details = {
                        date: correctionDate.value,
                        type: correctionType.value,
                        time: correctionTime.value,
                        reason: correctionReason.value,
                    };
                    console.log('[handleSubmitRequest] Correction details:', details);
                    if (!details.date || !details.type || !details.time || !details.reason) {
                        errorMsg = 'Please fill in all required fields (Date, Type, Time, Reason).';
                        isValid = false;
                        console.error('[handleSubmitRequest] Missing values:', details);
                    }
                    break;
                    
                default:
                    errorMsg = `Invalid request type: ${requestType}`;
                    isValid = false;
                    console.error('[handleSubmitRequest] Unknown request type:', requestType);
            }

            if (!isValid) {
                console.error('[handleSubmitRequest] Validation failed:', errorMsg);
                showMessage(errorMsg || 'Please fill in all required fields.', true);
                return;
            }

            console.log('[handleSubmitRequest] Validation passed, submitting with details:', details);
            
            // Show loading state
            const submitBtn = document.querySelector('.request-modal button[type="submit"]');
            const originalText = submitBtn ? submitBtn.textContent : 'Submit';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Submitting...';
            }
            
            try {
                const result = await window.AppApi.createRequest({ request_type: requestType, details });
                console.log('[handleSubmitRequest] Request created successfully:', result);
                
                // Show success message
                showMessage('✓ Request submitted successfully! Your request has been recorded.', false, 5000);
                
                // Close modal after brief delay
                setTimeout(() => {
                    closeRequestModal();
                    
                    // Reset form fields
                    document.querySelectorAll('.request-modal input, .request-modal textarea, .request-modal select').forEach(el => {
                        if (el.type !== 'button' && el.type !== 'submit') {
                            el.value = '';
                        }
                    });
                    
                    // Refresh requests section
                    if (window.refreshRequestsSection) {
                        window.refreshRequestsSection();
                    }
                }, 500);
            } catch (apiError) {
                console.error('[handleSubmitRequest] API error:', apiError);
                
                // Parse error message
                let errorMsg = apiError.message;
                if (errorMsg.includes('Only employees can create requests')) {
                    errorMsg = 'Only employees can submit requests. Please check your account.';
                } else if (errorMsg.includes('Details must be')) {
                    errorMsg = 'Please fill in all required fields correctly.';
                } else if (errorMsg.includes('Invalid')) {
                    errorMsg = 'The request data is invalid. Please check and try again.';
                } else if (apiError.status === 403) {
                    errorMsg = '✗ Access denied: Only employees can submit requests.';
                } else if (apiError.status === 400) {
                    errorMsg = '✗ Invalid request data. Please fill in all fields.';
                } else if (apiError.status === 500) {
                    errorMsg = '✗ Server error. Please try again later.';
                }
                
                showMessage(errorMsg, true, 6000);
                
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                }
            }
        } catch (e) {
            console.error('[handleSubmitRequest] Exception caught:', e);
            showMessage(`✗ Error: ${e.message}`, true, 6000);
            
            // Re-enable submit button if there's an exception
            const submitBtn = document.querySelector('.request-modal button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit';
            }
        }
    }

    async function fetchAndDisplayRequests() {
        const tbody = document.querySelector('.request-table tbody');
        if (!tbody) {
            console.error('Requests table tbody not found');
            return;
        }
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

    // --- Responsive Design Handlers ---

    function handleResponsiveLayout() {
        const menuToggleBtn = document.getElementById('menuToggleBtn');
        const sidebar = document.querySelector('.sidebar');

        function updateMenuToggleVisibility() {
            if (window.innerWidth <= 1199) {
                if (menuToggleBtn) menuToggleBtn.style.display = 'flex';
            } else {
                if (menuToggleBtn) menuToggleBtn.style.display = 'none';
                if (sidebar) sidebar.classList.remove('open');
            }
        }

        updateMenuToggleVisibility();
        window.addEventListener('resize', updateMenuToggleVisibility);
    }

    // Initialize responsive layout
    document.addEventListener('DOMContentLoaded', handleResponsiveLayout);

    // ========== ATTENDANCE ACTION MODAL LOGIC ==========
    const attendanceActionBackdrop = document.getElementById('attendanceActionBackdrop');
    const attendanceActionModal = document.getElementById('attendanceActionModal');
    const attendanceActionClose = document.getElementById('attendanceActionClose');
    const attendanceActionCancel = document.getElementById('attendanceActionCancel');
    const attendanceActionBtn = document.getElementById('attendanceActionBtn');
    const attendanceStatusMessage = document.getElementById('attendanceStatusMessage');
    const attendanceActionContainer = document.getElementById('attendanceActionContainer');
    const attendanceCurrentStatus = document.getElementById('attendanceCurrentStatus');

    let currentAttendanceState = null; // Will hold: { employee_id, time_in, time_out, status }
    let currentEmployeeInfo = null; // Will hold employee info
    let determinedActionType = 'check-in'; // Will hold the action type (check-in or check-out)

    // Open attendance action modal
    window.openAttendanceActionModal = async function(scannedSessionId) {
        attendanceActionModal.style.display = 'block';
        attendanceActionBackdrop.style.display = 'block';
        attendanceStatusMessage.style.display = 'none';
        attendanceStatusMessage.textContent = ''; // Clear old messages
        attendanceActionContainer.style.display = 'none';
        attendanceCurrentStatus.style.display = 'none';
        
        // Reset button state
        attendanceActionBtn.disabled = false;
        attendanceActionBtn.textContent = '';
        attendanceActionBtn.style.display = 'none'; // Hide until fetching status
        
        // Hide action type indicator initially, will show after fetching status
        const actionTypeIndicator = document.getElementById('attendanceActionTypeIndicator');
        if (actionTypeIndicator) {
            actionTypeIndicator.style.display = 'none';
        }
        
        currentAttendanceState = null;
        currentEmployeeInfo = null;
        determinedActionType = 'check-in'; // Reset

        // If we have a scanned employee ID from QR, pre-populate and fetch status
        if (window.scannedEmployeeId) {
            console.log('[Modal] Using scanned employee ID:', window.scannedEmployeeId);
            document.getElementById('attendanceEmployeeId').textContent = window.scannedEmployeeId;
            if (window.scannedEmployeeName) {
                document.getElementById('attendanceEmployeeName').textContent = window.scannedEmployeeName;
            }
            
            // Automatically fetch attendance status for this employee
            await fetchAttendanceStatusForScannedEmployee();
        } else {
            // Show action buttons for manual entry (shouldn't happen in QR-first flow)
            showActionButtons();
        }
    };

    // Fetch attendance status for the scanned employee
    async function fetchAttendanceStatusForScannedEmployee() {
        const employee_id = window.scannedEmployeeId;
        
        if (!employee_id) {
            showAttendanceMessage('No employee ID available', 'error');
            return;
        }

        try {
            showAttendanceMessage('Authenticating...', 'info');

            const apiBase = window.API_URL || '/api';
            
            // Fetch today's attendance to detect status
            const dateParam = new Date().toISOString().split('T')[0];
            const historyUrl = `${apiBase}/attendance/history?start=${dateParam}&end=${dateParam}`;
            console.log('[fetchAttendanceStatus] Fetching from URL:', historyUrl);
            console.log('[fetchAttendanceStatus] Looking for employee_id:', employee_id);
            
            const attResp = await fetch(historyUrl, {
                headers: { 'Accept': 'application/json' }
            });

            const attData = attResp.ok ? await attResp.json() : [];
            console.log('[fetchAttendanceStatus] Raw API response:', attData);
            console.log('[fetchAttendanceStatus] Response is array?', Array.isArray(attData));
            console.log('[fetchAttendanceStatus] Response length:', Array.isArray(attData) ? attData.length : 'N/A');
            
            const todayAttendance = Array.isArray(attData) ? attData.find(a => {
                console.log('[fetchAttendanceStatus] Checking record:', a);
                console.log('[fetchAttendanceStatus] Record employee_id:', a.employee_id, 'Type:', typeof a.employee_id);
                console.log('[fetchAttendanceStatus] Comparing with:', employee_id, 'Type:', typeof employee_id);
                console.log('[fetchAttendanceStatus] String compare:', String(a.employee_id), '===', String(employee_id), '?', String(a.employee_id) === String(employee_id));
                return String(a.employee_id) === String(employee_id);
            }) : null;
            
            console.log('[fetchAttendanceStatus] Today attendance record found?', !!todayAttendance);
            console.log('[fetchAttendanceStatus] Today attendance record:', todayAttendance);
            if (todayAttendance) {
                console.log('[fetchAttendanceStatus] Record.time_in:', todayAttendance.time_in);
                console.log('[fetchAttendanceStatus] Record.time_out:', todayAttendance.time_out);
            }

            currentAttendanceState = todayAttendance || {
                employee_id: employee_id,
                time_in: null,
                time_out: null,
                status: 'pending'
            };
            
            console.log('[fetchAttendanceStatus] Current attendance state set to:', currentAttendanceState);

            // Store minimal employee info from QR scan
            currentEmployeeInfo = {
                employee_id: employee_id,
                name: window.scannedEmployeeName || 'Employee'
            };

            // Show action type indicator (Check In or Check Out)
            const actionTypeIndicator = document.getElementById('attendanceActionTypeIndicator');
            const actionTypeText = document.getElementById('attendanceActionTypeText');
            if (actionTypeIndicator && actionTypeText) {
                let actionLabel = 'Check In';
                determinedActionType = 'check-in'; // Default
                
                // Only show Check Out if: time_in exists AND time_out is null/empty
                if (currentAttendanceState.time_in && currentAttendanceState.time_in.trim && 
                    (currentAttendanceState.time_out === null || currentAttendanceState.time_out === undefined)) {
                    actionLabel = 'Check Out';
                    determinedActionType = 'check-out';
                    console.log('[fetchAttendanceStatus] Checkout detected - time_in:', currentAttendanceState.time_in, 'time_out:', currentAttendanceState.time_out);
                } else {
                    console.log('[fetchAttendanceStatus] Checkin will be shown - time_in:', currentAttendanceState.time_in, 'time_out:', currentAttendanceState.time_out);
                }
                
                actionTypeText.textContent = actionLabel;
                actionTypeIndicator.style.display = 'block';
                console.log('[fetchAttendanceStatus] Determined action type:', determinedActionType);
            }

            // Show action buttons after fetching status
            showActionButtons();

        } catch (error) {
            console.error('Error fetching attendance status:', error);
            showAttendanceMessage(`Error: ${error.message}`, 'error');
        }
    }

    // Close attendance action modal
    function closeAttendanceActionModal() {
        attendanceActionModal.style.display = 'none';
        attendanceActionBackdrop.style.display = 'none';
        currentAttendanceState = null;
        currentEmployeeInfo = null;
        window.scannedEmployeeId = null;
        window.scannedEmployeeName = null;
        window.scannedQRSessionId = null;
    }

    attendanceActionClose.addEventListener('click', closeAttendanceActionModal);
    attendanceActionCancel.addEventListener('click', closeAttendanceActionModal);
    attendanceActionBackdrop.addEventListener('click', closeAttendanceActionModal);

    // Show the appropriate action button based on attendance status
    function showActionButtons() {
        // Determine action type
        let actionType = 'check-in';
        let actionText = 'Check In Today?';
        let actionIcon = '→';
        let statusDetails = 'No time-in yet';

        console.log('[showActionButtons] Current attendance state:', currentAttendanceState);
        
        // Check if there's a valid time_in AND no time_out (pending checkout)
        const hasTimeIn = currentAttendanceState.time_in && 
                         (typeof currentAttendanceState.time_in === 'string' || typeof currentAttendanceState.time_in === 'object');
        const hasTimeOut = currentAttendanceState.time_out && 
                          (typeof currentAttendanceState.time_out === 'string' || typeof currentAttendanceState.time_out === 'object');
        
        if (hasTimeIn && !hasTimeOut) {
            actionType = 'check-out';
            actionText = 'Check Out Today?';
            actionIcon = '←';
            statusDetails = `Time In: ${formatTimeAMPM(currentAttendanceState.time_in)}`;
            console.log('[showActionButtons] Showing CHECK OUT button - time_in:', currentAttendanceState.time_in);
        } else if (hasTimeIn && hasTimeOut) {
            actionType = 'completed';
            actionText = 'Already Completed Today';
            actionIcon = '✓';
            statusDetails = `Time In: ${formatTimeAMPM(currentAttendanceState.time_in)} | Time Out: ${formatTimeAMPM(currentAttendanceState.time_out)}`;
            console.log('[showActionButtons] Already completed');
        } else {
            console.log('[showActionButtons] Showing CHECK IN button - time_in is:', currentAttendanceState.time_in, 'time_out is:', currentAttendanceState.time_out);
        }

        // Show action
        attendanceStatusMessage.style.display = 'none';
        attendanceActionContainer.style.display = 'block';
        attendanceCurrentStatus.style.display = 'block';
        document.getElementById('attendanceActionIcon').textContent = actionIcon;
        document.getElementById('attendanceActionText').textContent = actionText;
        document.getElementById('attendanceActionTime').textContent = formatTimeAMPM(new Date());
        document.getElementById('attendanceStatusDetails').textContent = statusDetails;

        // Setup action button
        attendanceActionBtn.style.display = actionType === 'completed' ? 'none' : 'block';
        attendanceActionBtn.textContent = actionType === 'check-out' ? '✓ Check Out' : '→ Check In';
        
        // Use the determined action type from attendance fetch as primary, fall back to current logic
        const finalActionType = (actionType === 'check-out' || actionType === 'check-in') ? actionType : determinedActionType;
        attendanceActionBtn.dataset.actionType = finalActionType;
        console.log('[showActionButtons] Final action type:', finalActionType);
        console.log('[showActionButtons] Button dataset.actionType set to:', attendanceActionBtn.dataset.actionType);
    }

    // Execute attendance action (check-in or check-out)
    attendanceActionBtn.addEventListener('click', async function() {
        const actionType = this.dataset.actionType;
        console.log('[Action Button Click] actionType from dataset:', actionType);
        console.log('[Action Button Click] currentAttendanceState:', currentAttendanceState);

        if (!currentAttendanceState || !currentEmployeeInfo) {
            showAttendanceMessage('Session expired. Please scan QR again.', 'error');
            return;
        }

        try {
            this.disabled = true;
            const originalText = this.textContent;
            this.textContent = 'Processing...';

            const apiBase = window.API_URL || '/api';
            const endpoint = actionType === 'check-out' ? 'attendance/checkout' : 'attendance/checkin';
            console.log('[Action Button Click] Using endpoint:', endpoint);
            
            let body = {};
            if (actionType === 'check-out') {
                body = { 
                    employee_id: currentAttendanceState.employee_id,
                    session_id: window.scannedQRSessionId,
                    lat: 0,
                    lon: 0,
                    deviceInfo: { qr_scanned: true }
                };
            } else {
                // For check-in, use session_id from QR scan
                body = { 
                    employee_id: currentAttendanceState.employee_id,
                    session_id: window.scannedQRSessionId || 'manual-checkin',
                    lat: 0,
                    lon: 0,
                    deviceInfo: { qr_scanned: true }
                };
            }

            const response = await fetch(apiBase + '/' + endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const result = await response.json();

            if (response.ok && result.ok) {
                const actionLabel = actionType === 'check-out' ? 'Checked Out' : 'Checked In';
                
                // Disable button and show success
                this.disabled = true;
                this.textContent = `✓ ${actionLabel} Successfully!`;
                
                // Show success message
                showAttendanceMessage(`✓ ${actionLabel} Successfully!`, 'success');
                
                // Close modal and refresh after a short delay
                setTimeout(() => {
                    closeAttendanceActionModal();
                    window.refreshDashboardAttendance?.();
                }, 1500);
            } else {
                // Handle specific error types
                let errorMessage = result.error || 'Unknown error';
                
                if (response.status === 409) {
                    errorMessage = `Already ${actionType === 'check-out' ? 'checked out' : 'checked in'} today`;
                } else if (response.status === 404) {
                    errorMessage = 'QR session not found. Please scan QR code again.';
                } else if (response.status === 410) {
                    errorMessage = 'QR session expired. Please scan QR code again.';
                } else {
                    errorMessage = `Failed: ${errorMessage}`;
                }
                
                showAttendanceMessage(errorMessage, 'error');
                this.disabled = false;
                this.textContent = originalText;
            }
        } catch (error) {
            console.error('Action error:', error);
            showAttendanceMessage(`Error: ${error.message}`, 'error');
            this.disabled = false;
            this.textContent = originalText;
        }
    });

    function showAttendanceMessage(message, type) {
        attendanceStatusMessage.textContent = message;
        attendanceStatusMessage.style.display = 'block';
        attendanceStatusMessage.className = `attendance-message attendance-${type}`;
        
        if (type === 'error') {
            attendanceStatusMessage.style.backgroundColor = 'var(--destructive)';
            attendanceStatusMessage.style.color = 'white';
        } else if (type === 'success') {
            attendanceStatusMessage.style.backgroundColor = 'var(--success)';
            attendanceStatusMessage.style.color = 'white';
        } else if (type === 'info') {
            attendanceStatusMessage.style.backgroundColor = 'var(--muted)';
            attendanceStatusMessage.style.color = 'var(--text-secondary)';
        }
    }

    // Load and display monthly attendance statistics
    async function loadAttendanceStats(user) {
        try {
            if (!user || !user.employee_id) {
                console.log('[loadAttendanceStats] No employee_id found in user');
                return;
            }

            const apiBase = window.API_URL || '/api';
            const statsUrl = `${apiBase}/attendance/stats?employee_id=${user.employee_id}`;
            
            const statsResp = await fetch(statsUrl, {
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            });

            if (!statsResp.ok) {
                console.warn('[loadAttendanceStats] Failed to fetch stats:', statsResp.status);
                return;
            }

            const stats = await statsResp.json();
            console.log('[loadAttendanceStats] Received stats:', stats);

            // Update attendance section stat cards
            const daysEl = document.getElementById('statDaysPresentAttendance');
            const lateEl = document.getElementById('statLateArrivalsAttendance');
            const avgHoursEl = document.getElementById('statAvgHoursAttendance');
            const absencesEl = document.getElementById('statAbsencesAttendance');

            if (daysEl) daysEl.textContent = stats.daysPresent || 0;
            if (lateEl) lateEl.textContent = stats.lateArrivals || 0;
            if (avgHoursEl) avgHoursEl.textContent = stats.avgHours || 0;
            if (absencesEl) absencesEl.textContent = stats.absences || 0;

            // Also update dashboard stat cards if they exist
            const dashDaysEl = document.getElementById('statDaysPresent');
            const dashLateEl = document.getElementById('statLateArrivals');
            
            if (dashDaysEl) dashDaysEl.textContent = stats.daysPresent || 0;
            if (dashLateEl) dashLateEl.textContent = stats.lateArrivals || 0;

        } catch (error) {
            console.error('[loadAttendanceStats] Error:', error);
        }
    }

    // Export refresh function to window so it can be called after attendance action
    window.refreshDashboardAttendance = async function() {
        try {
            const user = await window.fetchUserProfile();
            if (user) {
                await loadTodayStatus(user);
                await fetchAndDisplayAttendance(user);
                await loadAttendanceStats(user);
            }
        } catch (error) {
            console.error('[refreshDashboardAttendance] Error:', error);
        }
    };

    // Export stats loading function to window so it can be called from page load
    window.loadAttendanceStats = loadAttendanceStats;

})();
// ============================================================================
// SCHEDULING MODULE
// ============================================================================

(async function() {
    // Import scheduling API functions (note: this is a dynamic import workaround)
    // In production, you'd use proper ES6 imports
    const schedulingModule = await import('./scheduling-api.js');
    const {
        getMySchedule,
        getNextWeeksRange,
        getCurrentWeekRange,
        formatDateForDisplay,
        formatDateForAPI,
        formatTimeForDisplay,
        getShiftColor
    } = schedulingModule;

    let currentScheduleView = 'week'; // 'week' or 'month'

    // DOM Elements
    const scheduleWeekBtn = document.getElementById('scheduleWeekBtn');
    const scheduleMonthBtn = document.getElementById('scheduleMonthBtn');
    const scheduleList = document.getElementById('scheduleList');
    const scheduleEmptyState = document.getElementById('schedule-empty-state');
    const scheduleLoadingState = document.getElementById('schedule-loading-state');

    /**
     * Load and display employee schedule
     */
    async function loadMySchedule() {
        try {
            console.log('[loadMySchedule] Starting...');
            
            // Show loading
            if (scheduleLoadingState) scheduleLoadingState.style.display = 'block';
            if (scheduleList) scheduleList.innerHTML = '';
            if (scheduleEmptyState) scheduleEmptyState.style.display = 'none';

            // Get date range based on current view
            let dateRange;
            if (currentScheduleView === 'week') {
                dateRange = getCurrentWeekRange();
            } else {
                dateRange = getNextWeeksRange(4);
            }

            console.log('[loadMySchedule] Date range:', dateRange);
            console.log('[loadMySchedule] Fetching schedules...');

            // Fetch schedule from API
            const schedules = await getMySchedule(dateRange.startDate, dateRange.endDate);

            console.log('[loadMySchedule] Received schedules:', schedules);

            // Hide loading
            if (scheduleLoadingState) scheduleLoadingState.style.display = 'none';

            // Check if empty
            if (!schedules || schedules.length === 0) {
                console.log('[loadMySchedule] No schedules found');
                if (scheduleEmptyState) scheduleEmptyState.style.display = 'block';
                return;
            }

            console.log('[loadMySchedule] Found', schedules.length, 'schedules');

            // Sort by date
            schedules.sort((a, b) => new Date(a.schedule_date) - new Date(b.schedule_date));

            // Render schedule table
            renderScheduleTable(schedules);

        } catch (error) {
            console.error('[loadMySchedule] Error:', error);
            if (scheduleLoadingState) scheduleLoadingState.style.display = 'none';
            if (scheduleEmptyState) {
                scheduleEmptyState.style.display = 'block';
                scheduleEmptyState.querySelector('p:last-child').textContent = 
                    'Failed to load schedule. Please try again.';
            }
        }
    }

    /**
     * Render schedule table rows
     */
    function renderScheduleTable(schedules) {
        if (!scheduleList) return;

        scheduleList.innerHTML = '';

        schedules.forEach(schedule => {
            const tr = document.createElement('tr');

            // Format date
            const date = new Date(schedule.schedule_date + 'T00:00:00');
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const scheduleDate = new Date(date);
            scheduleDate.setHours(0, 0, 0, 0);
            
            const isToday = scheduleDate.getTime() === today.getTime();
            const isPast = scheduleDate < today;

            // Date column
            const dateCell = document.createElement('td');
            dateCell.textContent = formatDateForDisplay(schedule.schedule_date);
            if (isToday) dateCell.style.fontWeight = '600';
            tr.appendChild(dateCell);

            // Day column
            const dayCell = document.createElement('td');
            const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
            dayCell.textContent = dayName;
            tr.appendChild(dayCell);

            // Shift column with color badge
            const shiftCell = document.createElement('td');
            const shiftBadge = document.createElement('span');
            shiftBadge.className = 'shift-badge';
            shiftBadge.textContent = schedule.shift_name || 'N/A';
            shiftBadge.style.backgroundColor = schedule.color_code || '#757575';
            shiftBadge.style.color = 'white';
            shiftBadge.style.padding = '4px 12px';
            shiftBadge.style.borderRadius = '12px';
            shiftBadge.style.fontSize = '13px';
            shiftBadge.style.fontWeight = '500';
            shiftCell.appendChild(shiftBadge);
            tr.appendChild(shiftCell);

            // Time column
            const timeCell = document.createElement('td');
            if (schedule.shift_start_time && schedule.shift_end_time) {
                const startTime = formatTimeForDisplay(schedule.shift_start_time);
                const endTime = formatTimeForDisplay(schedule.shift_end_time);
                timeCell.textContent = `${startTime} - ${endTime}`;
            } else {
                timeCell.textContent = 'Off';
                timeCell.style.color = 'var(--text-secondary)';
            }
            tr.appendChild(timeCell);

            // Duration column
            const durationCell = document.createElement('td');
            if (schedule.duration_hours && schedule.duration_hours > 0) {
                durationCell.textContent = `${schedule.duration_hours} hrs`;
            } else {
                durationCell.textContent = 'Off';
                durationCell.style.color = 'var(--text-secondary)';
            }
            tr.appendChild(durationCell);

            // Status column
            const statusCell = document.createElement('td');
            const statusBadge = document.createElement('span');
            statusBadge.className = 'schedule-status-badge';
            
            if (isToday) {
                statusBadge.textContent = 'Today';
                statusBadge.style.backgroundColor = '#2196F3';
                statusBadge.style.color = 'white';
            } else if (isPast) {
                statusBadge.textContent = 'Past';
                statusBadge.style.backgroundColor = '#E0E0E0';
                statusBadge.style.color = '#757575';
            } else {
                statusBadge.textContent = 'Upcoming';
                statusBadge.style.backgroundColor = '#4CAF50';
                statusBadge.style.color = 'white';
            }
            
            statusBadge.style.padding = '4px 12px';
            statusBadge.style.borderRadius = '12px';
            statusBadge.style.fontSize = '12px';
            statusBadge.style.fontWeight = '500';
            statusCell.appendChild(statusBadge);
            tr.appendChild(statusCell);

            // Add CSS class for styling instead of inline styles
            if (isToday) {
                tr.classList.add('schedule-row-today');
            }

            // Add past schedule styling
            if (isPast) {
                tr.classList.add('schedule-row-past');
            }

            scheduleList.appendChild(tr);
        });
    }

    /**
     * Switch between week and month view
     */
    function switchScheduleView(view) {
        currentScheduleView = view;

        // Update button states
        if (scheduleWeekBtn) {
            if (view === 'week') {
                scheduleWeekBtn.classList.add('active');
                scheduleMonthBtn.classList.remove('active');
            } else {
                scheduleWeekBtn.classList.remove('active');
                scheduleMonthBtn.classList.add('active');
            }
        }

        // Toggle views
        const tableView = document.getElementById('scheduleTableView');
        const calendarView = document.getElementById('scheduleCalendarView');
        
        if (view === 'week') {
            if (tableView) tableView.style.display = 'block';
            if (calendarView) calendarView.style.display = 'none';
            loadMySchedule();
        } else {
            if (tableView) tableView.style.display = 'none';
            if (calendarView) calendarView.style.display = 'block';
            loadCalendarView();
        }
    }

    /**
     * Load and render calendar view
     */
    let currentCalendarMonth = new Date();

    async function loadCalendarView() {
        try {
            const calendarGrid = document.getElementById('calendarGrid');
            const calendarMonthLabel = document.getElementById('calendarMonthLabel');
            const calendarLoading = document.getElementById('calendar-loading-state');

            if (!calendarGrid) return;

            // Show loading
            if (calendarLoading) calendarLoading.style.display = 'block';
            calendarGrid.innerHTML = '';

            // Calculate month date range
            const year = currentCalendarMonth.getFullYear();
            const month = currentCalendarMonth.getMonth();
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);

            // Get start and end dates including padding days
            const startDay = new Date(firstDay);
            startDay.setDate(startDay.getDate() - firstDay.getDay()); // Start from Sunday

            const endDay = new Date(lastDay);
            const daysToAdd = 6 - lastDay.getDay();
            endDay.setDate(endDay.getDate() + daysToAdd); // End on Saturday

            // Fetch schedules for the entire period
            const startDate = formatDateForAPI(startDay);
            const endDate = formatDateForAPI(endDay);

            const schedules = await getMySchedule(startDate, endDate);
            const schedulesByDate = {};
            schedules.forEach(schedule => {
                schedulesByDate[schedule.schedule_date] = schedule;
            });

            // Update month label
            const monthName = currentCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            if (calendarMonthLabel) calendarMonthLabel.textContent = monthName;

            // Render day headers
            const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            dayHeaders.forEach(day => {
                const header = document.createElement('div');
                header.className = 'calendar-day-header';
                header.textContent = day;
                calendarGrid.appendChild(header);
            });

            // Render calendar days
            const currentDate = new Date(startDay);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            while (currentDate <= endDay) {
                const dayEl = document.createElement('div');
                dayEl.className = 'calendar-day';

                // Check if day is in current month
                if (currentDate.getMonth() !== month) {
                    dayEl.classList.add('other-month');
                }

                // Check if today
                const checkDate = new Date(currentDate);
                checkDate.setHours(0, 0, 0, 0);
                if (checkDate.getTime() === today.getTime()) {
                    dayEl.classList.add('today');
                }

                // Day number
                const dayNumber = document.createElement('div');
                dayNumber.className = 'calendar-day-number';
                dayNumber.textContent = currentDate.getDate();
                dayEl.appendChild(dayNumber);

                // Day content (shift info)
                const dayContent = document.createElement('div');
                dayContent.className = 'calendar-day-content';

                const dateStr = formatDateForAPI(currentDate);
                const schedule = schedulesByDate[dateStr];

                if (schedule && schedule.shift_name) {
                    const shiftBadge = document.createElement('div');
                    shiftBadge.className = 'calendar-shift-badge';
                    shiftBadge.textContent = schedule.shift_name;
                    shiftBadge.style.backgroundColor = schedule.color_code || '#3498db';
                    dayContent.appendChild(shiftBadge);

                    if (schedule.start_time && schedule.end_time) {
                        const shiftTime = document.createElement('div');
                        shiftTime.className = 'calendar-shift-time';
                        shiftTime.textContent = `${schedule.start_time} - ${schedule.end_time}`;
                        dayContent.appendChild(shiftTime);
                    }
                }

                dayEl.appendChild(dayContent);
                calendarGrid.appendChild(dayEl);

                // Move to next day
                currentDate.setDate(currentDate.getDate() + 1);
            }

            // Hide loading
            if (calendarLoading) calendarLoading.style.display = 'none';

        } catch (error) {
            console.error('[Calendar] Error:', error);
            const calendarLoading = document.getElementById('calendar-loading-state');
            if (calendarLoading) {
                calendarLoading.innerHTML = '<p style="color: var(--text-error);">Failed to load calendar</p>';
            }
        }
    }

    // Calendar navigation
    const calendarPrevBtn = document.getElementById('calendarPrevBtn');
    const calendarNextBtn = document.getElementById('calendarNextBtn');

    if (calendarPrevBtn) {
        calendarPrevBtn.addEventListener('click', () => {
            currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() - 1);
            loadCalendarView();
        });
    }

    if (calendarNextBtn) {
        calendarNextBtn.addEventListener('click', () => {
            currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() + 1);
            loadCalendarView();
        });
    }

    // Event listeners for view toggle buttons
    if (scheduleWeekBtn) {
        scheduleWeekBtn.addEventListener('click', () => switchScheduleView('week'));
    }

    if (scheduleMonthBtn) {
        scheduleMonthBtn.addEventListener('click', () => switchScheduleView('month'));
    }

    // Initial load - Wait for user to be authenticated
    // Use setTimeout to allow module to fully initialize before calling
    setTimeout(async () => {
        try {
            const user = await window.fetchUserProfile();
            if (user && user.employee_id) {
                console.log('[Schedule] Page loaded, calling loadMySchedule for user', user.employee_id);
                await loadMySchedule();
            } else {
                console.warn('[Schedule] No employee_id found in user profile');
            }
        } catch (error) {
            console.error('[Schedule] Failed to load on page load:', error);
        }
    }, 1000);  // Increased to 1 second to ensure everything is ready

    // Export for external access
    window.refreshSchedule = loadMySchedule;

})();
