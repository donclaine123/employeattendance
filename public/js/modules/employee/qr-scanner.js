
let html5QrcodeScanner = null;
let availableCameras = [];
let currentCameraIndex = -1;
let preferBackCamera = true;
const qrReaderId = 'qr-reader';

export function initQRScanner() {
  const qrScanBtn = document.getElementById('qrScanBtn');
  const qrCloseBtn = document.getElementById('qrModalClose');
  const qrCancelBtn = document.getElementById('qrModalCancel');
  const switchCameraBtn = document.getElementById('switchCameraBtn');
  const qrBackdrop = document.getElementById('qrModalBackdrop');

  if (qrScanBtn) qrScanBtn.addEventListener('click', openQrScanner);
  if (qrCloseBtn) qrCloseBtn.addEventListener('click', closeQrScanner);
  if (qrCancelBtn) qrCancelBtn.addEventListener('click', closeQrScanner);
  if (switchCameraBtn) switchCameraBtn.addEventListener('click', switchCamera);

  // Global exposure needed?? checks...
  // The original code had specific wrappers, but direct listeners should work.
}

function openQrScanner() {
  startScanner();
}

function closeQrScanner() {
  closeModal();
}

async function startScanner() {
  if (html5QrcodeScanner) return;

  const qrModalBackdrop = document.getElementById('qrModalBackdrop');
  const qrModal = document.getElementById('qrModal');
  const qrMessage = document.getElementById('qrMessage');

  // Show modal
  if (qrModalBackdrop) qrModalBackdrop.style.display = 'block';
  if (qrModal) qrModal.style.display = 'flex';
  if (qrMessage) {
    qrMessage.innerHTML = `
      <div class="modal-spinner"></div>
      <div>Initializing camera...</div>
    `;
    qrMessage.style.color = 'var(--text-primary)';
  }

  html5QrcodeScanner = new Html5Qrcode(qrReaderId);

  try {
    await initializeCameras();
    await startCameraWithIndex(currentCameraIndex);
  } catch (error) {
    console.error('Scanner initialization failed:', error);
  }
}

async function initializeCameras() {
  const qrMessage = document.getElementById('qrMessage');
  const switchCameraBtn = document.getElementById('switchCameraBtn');

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

  const qrMessage = document.getElementById('qrMessage');

  // Dynamic QR Box Size
  const readerEl = document.getElementById(qrReaderId);
  let boxSize = 250;
  if (readerEl && readerEl.clientWidth > 0) {
    // Ensure box is smaller than container width (with padding buffer)
    boxSize = Math.min(250, readerEl.clientWidth - 40);
  }
  // Mobile fallback safety: minimum 180px
  if (boxSize < 150) boxSize = 150;

  const config = { fps: 10, qrbox: { width: boxSize, height: boxSize } };
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

async function switchCamera() {
  if (!html5QrcodeScanner || availableCameras.length <= 1) return;
  const qrMessage = document.getElementById('qrMessage');

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
    return;
  }
  html5QrcodeScanner.stop().then(() => {
    html5QrcodeScanner.clear();
    html5QrcodeScanner = null;
    availableCameras = [];
    currentCameraIndex = -1;
  }).catch(() => {
    html5QrcodeScanner = null;
    availableCameras = [];
    currentCameraIndex = -1;
  });
}

function closeModal() {
  const qrModalBackdrop = document.getElementById('qrModalBackdrop');
  const qrModal = document.getElementById('qrModal');

  // hide modal elements and clear spinner
  if (qrModalBackdrop) qrModalBackdrop.style.display = 'none';
  if (qrModal) qrModal.style.display = 'none';
  if (qrModal) {
    const spinner = qrModal.querySelector('.btn-spinner');
    if (spinner) spinner.setAttribute('hidden', '');
  }
  try { stopScanner(); } catch (e) { }
}

async function handleScanResult(decodedText) {
  stopScanner(); // stop immediately

  const qrMessage = document.getElementById('qrMessage');
  const qrModal = document.getElementById('qrModal');
  const qrModalBackdrop = document.getElementById('qrModalBackdrop');

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
    const validateUrl = `${apiBase}/attendance/qr/validate`;
    const payload = { qrSessionId: decodedText };

    const validateResp = await fetch(validateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const validateResult = await validateResp.json();

    if (!validateResp.ok || !validateResult.valid) {
      if (qrMessage) qrMessage.textContent = `Error: ${validateResult.error || 'Invalid QR session'}`;

      // Reopen scanner after showing error
      setTimeout(() => {
        if (qrModal) qrModal.style.display = 'flex';
        if (qrModalBackdrop) qrModalBackdrop.style.display = 'block';
        openQrScanner();
      }, 2000);
      return;
    }

    // Store employee ID from QR scan globally
    window.scannedEmployeeId = employee_id;
    window.scannedEmployeeName = employee_name;
    window.scannedQRSessionId = decodedText;

    // STEP 2: Close QR scanner modal and open attendance action modal
    if (qrMessage) qrMessage.textContent = 'Opening authentication...';

    setTimeout(() => {
      try { stopScanner(); } catch (e) { }
      if (qrModalBackdrop) qrModalBackdrop.style.display = 'none';
      if (qrModal) qrModal.style.display = 'none';
    }, 800);

    // STEP 3: Open the attendance modal
    setTimeout(() => {
      if (window.openAttendanceActionModal) {
        window.openAttendanceActionModal();
      } else {
        console.error('Attendance Modal function not found');
      }
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
