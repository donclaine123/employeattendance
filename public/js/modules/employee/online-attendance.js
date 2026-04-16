/**
 * Online Attendance Module
 * Records online class attendance with offline support and sync capability
 * Requires HR verification before being marked as confirmed
 */

const DB_NAME = 'workline_offline';
const STORE_NAME = 'online_attendance_drafts';
let db = null;
let isOnline = navigator.onLine;

export function initOnlineAttendance(user) {
  if (!user || !user.employee_id) return;

  // Initialize offline database
  initOfflineDB();

  // Load records
  loadOnlineAttendanceRecords(user);

  // Setup event listeners
  setupEventListeners(user);

  // Monitor online/offline status
  setupNetworkMonitoring(user);

  // Expose refresh function
  window.refreshOnlineAttendance = () => {
    loadOnlineAttendanceRecords(user);
  };
}

/**
 * Initialize IndexedDB for offline storage
 */
function initOfflineDB() {
  return new Promise((resolve) => {
    if (!window.indexedDB) {
      console.warn('[Online Attendance] IndexedDB not available - offline mode disabled');
      resolve();
      return;
    }

    const request = window.indexedDB.open(DB_NAME, 1);

    request.onerror = () => {
      console.error('[Online Attendance] Failed to open IndexedDB');
      resolve();
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      console.log('[Online Attendance] IndexedDB initialized');
      resolve();
    };

    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('date', 'date', { unique: false });
        console.log('[Online Attendance] Object store created');
      }
    };
  });
}

/**
 * Setup event listeners for modal and buttons
 */
function setupEventListeners(user) {
  const recordBtn = document.getElementById('recordOnlineAttendanceBtn');
  const submitBtn = document.getElementById('onlineAttendanceSubmit');
  const cancelBtn = document.getElementById('onlineAttendanceCancel');
  const closeBtn = document.getElementById('onlineAttendanceClose');
  const backdrop = document.getElementById('onlineAttendanceBackdrop');
  const classDateInput = document.getElementById('classDate');
  const subjectDropdown = document.getElementById('subjectDropdown');

  if (recordBtn) {
    recordBtn.addEventListener('click', () => openModal(user));
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', () => handleSubmit(user));
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeModal());
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeModal());
  }

  if (backdrop) {
    backdrop.addEventListener('click', () => closeModal());
  }

  // Refresh dropdown when date changes
  if (classDateInput) {
    classDateInput.addEventListener('change', () => {
      loadScheduleForDate(user);
    });
  }

  // Auto-fill form when subject is selected
  if (subjectDropdown) {
    subjectDropdown.addEventListener('change', () => {
      const selectedValue = subjectDropdown.value;
      if (selectedValue) {
        autoFillFormFromSchedule(selectedValue);
      }
    });
  }

  // Setup tab switching
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });
}

/**
 * Switch between tabs
 */
function switchTab(tabName) {
  // Deactivate all tab buttons and contents
  const allTabBtns = document.querySelectorAll('.tab-btn');
  const allTabContents = document.querySelectorAll('.tab-content');

  allTabBtns.forEach(btn => btn.classList.remove('active'));
  allTabContents.forEach(content => content.classList.remove('active'));

  // Activate selected tab button and content
  const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
  const activeContent = document.getElementById(`tab-${tabName}`);

  if (activeBtn) activeBtn.classList.add('active');
  if (activeContent) activeContent.classList.add('active');
}

/**
 * Monitor online/offline status
 */
function setupNetworkMonitoring(user) {
  window.addEventListener('online', () => {
    isOnline = true;
    console.log('[Online Attendance] Back online - syncing pending submissions');
    syncPendingSubmissions(user);
    showOfflineIndicator(false);
  });

  window.addEventListener('offline', () => {
    isOnline = false;
    console.log('[Online Attendance] Offline mode - submissions will be saved locally');
    showOfflineIndicator(true);
  });

  // Check initial status
  showOfflineIndicator(!isOnline);
}

/**
 * Open the modal
 */
function openModal(user) {
  const modal = document.getElementById('onlineAttendanceModal');
  const backdrop = document.getElementById('onlineAttendanceBackdrop');
  const today = new Date().toISOString().split('T')[0];

  // Populate instructor name with user's first and last name
  const instructorNameElement = document.getElementById('instructorName');
  if (instructorNameElement && user) {
    const firstName = user.first_name || '';
    const lastName = user.last_name || '';
    instructorNameElement.textContent = `${firstName} ${lastName}`.trim() || 'Your Name';
  }

  // Set today's date as default
  const dateInput = document.getElementById('classDate');
  if (dateInput && !dateInput.value) {
    dateInput.value = today;
  }

  // Load schedule for today's date
  loadScheduleForDate(user);

  if (modal) modal.style.display = 'flex';
  if (backdrop) backdrop.style.display = 'block';

  // Focus first editable input
  setTimeout(() => {
    const dateInput = document.getElementById('classDate');
    if (dateInput) dateInput.focus();
  }, 100);
}

/**
 * Close the modal
 */
function closeModal() {
  const modal = document.getElementById('onlineAttendanceModal');
  const backdrop = document.getElementById('onlineAttendanceBackdrop');

  if (modal) modal.style.display = 'none';
  if (backdrop) backdrop.style.display = 'none';

  // Clear form
  clearForm();
}

/**
 * Clear form fields
 */
function clearForm() {
  // Don't clear instructor name - it's auto-populated
  document.getElementById('classDate').value = '';
  document.getElementById('subjectDropdown').value = '';
  document.getElementById('classTimeIn').value = '';
  document.getElementById('modalType').value = '';
  document.getElementById('classPeriod').value = '';
  document.getElementById('programYearSection').value = '';
  document.getElementById('subject').value = '';
  document.getElementById('onlineClassLink').value = '';
  document.getElementById('termsAccepted').checked = false;
  document.getElementById('onlineAttendanceMessage').style.display = 'none';
}

/**
 * Format time from 24-hour (HH:MM:SS) to 12-hour AM/PM format
 */
function formatTimeTo12Hour(timeStr) {
  if (!timeStr) return '';
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours);
  const min = minutes;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${min} ${ampm}`;
}

/**
 * Load and populate schedule dropdown for selected date
 */
async function loadScheduleForDate(user) {
  if (!user || !user.employee_id) return;

  const dateInput = document.getElementById('classDate');
  const dropdown = document.getElementById('subjectDropdown');
  const emptyState = document.getElementById('scheduleEmptyState');

  if (!dateInput || !dropdown) return;

  const selectedDate = dateInput.value;
  if (!selectedDate) return;

  try {
    const apiBase = window.API_URL || '/api';
    const response = await fetch(
      `${apiBase}/attendance/subject?date=${selectedDate}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to load schedule');
    }

    const data = await response.json();
    const records = Array.isArray(data.data) ? data.data : data;
    
    if (!records || records.length === 0) {
      dropdown.innerHTML = '<option value="">-- No schedules for this date --</option>';
      dropdown.disabled = true;
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    // Extract subjects
    const employeeRecord = Array.isArray(records) ? records[0] : records;
    const subjects = employeeRecord.subjects || [];

    if (subjects.length === 0) {
      dropdown.innerHTML = '<option value="">-- No schedules for this date --</option>';
      dropdown.disabled = true;
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    // Group subjects by (subject_code, start_time, end_time)
    const groupedSubjects = groupSubjectsByTimeSlot(subjects);

    // Populate dropdown
    dropdown.innerHTML = '<option value="">-- Select a scheduled class --</option>';
    groupedSubjects.forEach((group, index) => {
      const label = `${group.subject_name} (${group.subject_code}) - ${formatTimeTo12Hour(group.start_time)} - ${formatTimeTo12Hour(group.end_time)} [Sections: ${group.sections.join(', ')}]`;
      const option = document.createElement('option');
      option.value = JSON.stringify(group);
      option.textContent = label;
      dropdown.appendChild(option);
    });

    dropdown.disabled = false;
    if (emptyState) emptyState.style.display = 'none';

    console.log('[Online Attendance] Schedule loaded:', groupedSubjects);
  } catch (error) {
    console.error('[Online Attendance] Error loading schedule:', error);
    dropdown.innerHTML = '<option value="">-- Error loading schedule --</option>';
    if (emptyState) emptyState.style.display = 'block';
  }
}

/**
 * Group subjects by (subject_code, start_time, end_time)
 * Returns array of grouped subjects with combined sections
 */
function groupSubjectsByTimeSlot(subjects) {
  const grouped = {};

  subjects.forEach(subject => {
    const key = `${subject.subject_code}|${subject.start_time}|${subject.end_time}`;
    
    if (!grouped[key]) {
      grouped[key] = {
        subject_code: subject.subject_code,
        subject_name: subject.subject_name,
        start_time: subject.start_time,
        end_time: subject.end_time,
        year_level: subject.year_level,
        dept_name: subject.dept_name,
        sections: []
      };
    }
    
    // Add section to the group
    if (subject.section_name && !grouped[key].sections.includes(subject.section_name)) {
      grouped[key].sections.push(subject.section_name);
    }
  });

  return Object.values(grouped);
}

/**
 * Auto-fill form fields when a subject is selected from dropdown
 */
function autoFillFormFromSchedule(selectedValue) {
  try {
    const group = JSON.parse(selectedValue);
    console.log('[Online Attendance] Parsed group object:', group);

    // Format class period (e.g., "8:00 AM - 9:30 AM")
    const classPeriod = `${formatTimeTo12Hour(group.start_time)} - ${formatTimeTo12Hour(group.end_time)}`;

    // Format program/section (e.g., "Computer Science - 1A, 1B")
    const deptName = group.dept_name || 'Unknown Program';
    const sections = group.sections.join(', ');
    const programYearSection = `${deptName} - ${sections}`;

    // Format subject (e.g., "Data Structures (CS201)")
    const subject = `${group.subject_name} (${group.subject_code})`;

    // Populate form fields (but NOT classTimeIn - user must enter manually)
    document.getElementById('classPeriod').value = classPeriod;
    document.getElementById('programYearSection').value = programYearSection;
    document.getElementById('subject').value = subject;

    console.log('[Online Attendance] Form auto-filled from schedule:', {
      classPeriod,
      programYearSection,
      subject
    });
  } catch (error) {
    console.error('[Online Attendance] Error auto-filling form:', error);
  }
}

/**
 * Validate form before submission
 */
function validateForm() {
  const instructorName = document.getElementById('instructorName').textContent.trim();
  const classDate = document.getElementById('classDate').value;
  const classTimeIn = document.getElementById('classTimeIn').value;
  const modalType = document.getElementById('modalType').value;
  const classPeriod = document.getElementById('classPeriod').value;
  const programYearSection = document.getElementById('programYearSection').value.trim();
  const subject = document.getElementById('subject').value.trim();
  const onlineClassLink = document.getElementById('onlineClassLink').value.trim();
  const termsAccepted = document.getElementById('termsAccepted').checked;

  const errors = [];

  if (!instructorName || instructorName === '--') errors.push('Instructor name is not set');
  if (!classDate) errors.push('Date is required');
  if (!classTimeIn) errors.push('Time in is required');
  if (!modalType) errors.push('Delivery mode is required');
  if (!classPeriod) errors.push('Class period is required');
  if (!programYearSection) errors.push('Program/Year/Section is required');
  if (!subject) errors.push('Subject is required');
  if (!onlineClassLink) errors.push('Online class link is required');
  if (!termsAccepted) errors.push('You must accept the terms and conditions');

  if (errors.length > 0) {
    showMessage(errors.join('\n'), true);
    return false;
  }

  return true;
}

/**
 * Check for duplicate attendance (same date + subject)
 */
async function isDuplicateSubmission(classDate, subject) {
  try {
    const apiBase = window.API_URL || '/api';
    const response = await fetch(
      `${apiBase}/attendance/online-check-duplicate?date=${classDate}&subject=${encodeURIComponent(subject)}`,
      {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
        }
      }
    );

    if (!response.ok) return false;
    const data = await response.json();
    return data.exists || false;
  } catch (error) {
    console.error('[Online Attendance] Duplicate check failed:', error);
    return false;
  }
}

/**
 * Handle form submission
 */
async function handleSubmit(user) {
  if (!validateForm()) return;

  const submitBtn = document.getElementById('onlineAttendanceSubmit');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  try {
    const classDate = document.getElementById('classDate').value;
    const subject = document.getElementById('subject').value;

    // Check for duplicates
    if (await isDuplicateSubmission(classDate, subject)) {
      showMessage('You have already submitted attendance for this class on this date', true);
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      return;
    }

    const formData = {
      employee_id: user.employee_id,
      instructor_name: document.getElementById('instructorName').textContent.trim(),
      date: classDate,
      time_in: document.getElementById('classTimeIn').value,
      online_class_modal: document.getElementById('modalType').value,
      class_period: document.getElementById('classPeriod').value,
      program_year_section: document.getElementById('programYearSection').value.trim(),
      subject: document.getElementById('subject').value.trim(),
      online_class_link: document.getElementById('onlineClassLink').value.trim(),
      terms_accepted: true,
      submitted_at: new Date().toISOString(),
      status: 'pending' // Awaiting HR verification
    };

    if (isOnline) {
      // Submit to server directly
      await submitOnlineAttendance(formData);
    } else {
      // Save to offline storage
      await saveToOfflineDB(formData);
      showMessage('✓ Saved offline. Will sync when back online.', false);
    }

    // Refresh the list
    setTimeout(() => {
      loadOnlineAttendanceRecords(user);
      closeModal();
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }, 1000);

  } catch (error) {
    showMessage(error.message || 'Submission failed', true);
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

/**
 * Submit attendance to server
 */
async function submitOnlineAttendance(formData) {
  const apiBase = window.API_URL || '/api';
  const response = await fetch(`${apiBase}/attendance/online-attendance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
    },
    body: JSON.stringify(formData)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Server error: ${response.status}`);
  }

  const result = await response.json();
  showMessage('✓ Online attendance recorded successfully!', false);
  return result;
}

/**
 * Save to IndexedDB for offline sync
 */
async function saveToOfflineDB(formData) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Offline storage not available'));
      return;
    }

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const record = { ...formData, status: 'syncing_pending', saved_at: new Date().toISOString() };

    const request = store.add(record);

    request.onsuccess = () => {
      console.log('[Online Attendance] Saved to offline DB:', record);
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to save offline'));
    };
  });
}

/**
 * Sync pending submissions when back online
 */
async function syncPendingSubmissions(user) {
  if (!db || !isOnline) return;

  try {
    const records = await getAllPendingRecords();
    console.log(`[Online Attendance] Found ${records.length} records to sync`);

    for (const record of records) {
      try {
        // Mark as syncing
        await updateOfflineRecord(record.id, { status: 'syncing' });

        // Submit to server
        const submitRecord = { ...record };
        delete submitRecord.id;
        delete submitRecord.saved_at;
        delete submitRecord.status;

        await submitOnlineAttendance(submitRecord);

        // Remove from offline DB
        await deleteOfflineRecord(record.id);
        console.log('[Online Attendance] Synced record ID:', record.id);
      } catch (error) {
        console.error('[Online Attendance] Sync failed for record:', record.id, error);
        // Keep in offline DB for retry
      }
    }

    // Refresh UI
    loadOnlineAttendanceRecords(user);
  } catch (error) {
    console.error('[Online Attendance] Sync error:', error);
  }
}

/**
 * Get all pending records from offline DB
 */
function getAllPendingRecords() {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve([]);
      return;
    }

    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(new Error('Failed to read offline DB'));
    };
  });
}

/**
 * Update offline record
 */
function updateOfflineRecord(id, updates) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Offline storage not available'));
      return;
    }

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const record = getRequest.result;
      const updateRequest = store.put({ ...record, ...updates });

      updateRequest.onsuccess = () => resolve();
      updateRequest.onerror = () => reject(new Error('Update failed'));
    };

    getRequest.onerror = () => reject(new Error('Record not found'));
  });
}

/**
 * Delete offline record
 */
function deleteOfflineRecord(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Offline storage not available'));
      return;
    }

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('Delete failed'));
  });
}

/**
 * Load online attendance records from server
 */
async function loadOnlineAttendanceRecords(user) {
  try {
    const loadingState = document.getElementById('online-attendance-loading-state');
    const list = document.getElementById('onlineAttendanceList');
    const emptyState = document.getElementById('online-attendance-empty-state');

    if (loadingState) loadingState.style.display = 'flex';
    if (list) list.innerHTML = '';

    if (!isOnline) {
      // Show offline records from local DB
      const offlineRecords = await getAllPendingRecords();
      renderRecords([...offlineRecords], true);
    } else {
      // Fetch from server
      const apiBase = window.API_URL || '/api';
      const response = await fetch(`${apiBase}/attendance/online-records`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load records: ${response.status}`);
      }

      const data = await response.json();
      const records = Array.isArray(data) ? data : (data.data || []);

      // Also check offline DB for syncing records
      const pendingRecords = await getAllPendingRecords();
      const allRecords = [...records, ...pendingRecords];

      renderRecords(allRecords, false);
    }

    if (loadingState) loadingState.style.display = 'none';
  } catch (error) {
    console.error('[Online Attendance] Load error:', error);
    const emptyState = document.getElementById('online-attendance-empty-state');
    if (emptyState) emptyState.style.display = 'flex';
  }
}

/**
 * Render attendance records into Pending and History sections
 */
function renderRecords(records, isOffline) {
  const pendingList = document.getElementById('onlineAttendancePendingList');
  const historyList = document.getElementById('onlineAttendanceHistoryList');
  const pendingEmpty = document.getElementById('online-attendance-pending-empty');
  const historyEmpty = document.getElementById('online-attendance-history-empty');

  if (!pendingList || !historyList) return;

  // Separate records into pending and verified
  const pendingRecords = [];
  const verifiedRecords = [];

  if (records && records.length > 0) {
    records.forEach(record => {
      const metadata = record.metadata || {};
      
      // Check if HR has verified this record
      if (metadata.verified_at && metadata.verification_action === 'verify') {
        verifiedRecords.push(record);
      } else {
        pendingRecords.push(record);
      }
    });
  }

  // Render pending records
  if (pendingRecords.length === 0) {
    pendingList.innerHTML = '';
    if (pendingEmpty) pendingEmpty.style.display = 'block';
  } else {
    if (pendingEmpty) pendingEmpty.style.display = 'none';
    pendingList.innerHTML = pendingRecords.map(record => createRecordCard(record, isOffline)).join('');
  }

  // Render history (verified) records
  if (verifiedRecords.length === 0) {
    historyList.innerHTML = '';
    if (historyEmpty) historyEmpty.style.display = 'block';
  } else {
    if (historyEmpty) historyEmpty.style.display = 'none';
    historyList.innerHTML = verifiedRecords.map(record => createRecordCard(record, isOffline)).join('');
  }
}

/**
 * Create a single record card HTML
 */
function createRecordCard(record, isOffline) {
  // Get data from metadata (stored in JSONB)
  const metadata = record.metadata || {};
  
  const status = record.status || 'present';
  const subject = metadata.subject || 'N/A';
  const instructor = metadata.instructor_name || 'N/A';
  const date = formatDate(record.date);
  const timeIn = formatTime(record.time_in);
  const modal = metadata.online_class_modal || 'N/A';

  let statusBadgeClass = 'pending';
  let statusText = 'Pending HR Verification';

  // Check if HR has verified or rejected this record
  if (metadata.verified_at) {
    if (metadata.verification_action === 'verify') {
      statusBadgeClass = 'verified';
      statusText = 'Verified ✓';
    } else if (metadata.verification_action === 'reject') {
      statusBadgeClass = 'rejected';
      statusText = 'Rejected';
    }
  } else if (metadata.rejection_reason) {
    statusBadgeClass = 'rejected';
    statusText = 'Rejected';
  } else if (status === 'syncing' || status === 'syncing_pending') {
    statusBadgeClass = 'syncing';
    statusText = 'Syncing...';
  }

  return `
    <div class="online-attendance-card">
      <div class="card-left">
        <div class="card-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </div>
        <div class="card-content">
          <p class="card-title">${escapeHtml(subject)}</p>
          <p class="card-subject">${escapeHtml(instructor)}</p>
          <div class="card-info">
            <span>${date} at ${timeIn}</span>
            <span>${escapeHtml(modal)}</span>
            ${isOffline ? '<span style="color: var(--yellow-primary);">📱 Offline</span>' : ''}
          </div>
        </div>
      </div>
      <div class="card-right">
        <span class="status-badge ${statusBadgeClass}">${statusText}</span>
      </div>
    </div>
  `;
}

/**
 * Show/hide offline indicator
 */
function showOfflineIndicator(show) {
  const indicator = document.getElementById('offlineIndicator');
  if (indicator) {
    indicator.style.display = show ? 'flex' : 'none';
  }
}

/**
 * Show form message
 */
function showMessage(message, isError = false) {
  const messageEl = document.getElementById('onlineAttendanceMessage');
  if (!messageEl) return;

  messageEl.textContent = message;
  messageEl.className = `form-message ${isError ? 'error' : 'success'}`;
  messageEl.style.display = 'block';

  if (!isError) {
    setTimeout(() => {
      messageEl.style.display = 'none';
    }, 5000);
  }
}

/**
 * Format date to readable format
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr + 'T00:00:00');
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

/**
 * Format time to 12-hour format
 */
function formatTime(timeStr) {
  if (!timeStr) return '-';
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours, 10);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${period}`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}
