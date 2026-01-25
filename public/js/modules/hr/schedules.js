/**
 * schedules.js
 * Manages Section Schedules
 */

// import { AuthGuard } from '../../auth-guard.js'; // Assuming global AuthGuard
const API_BASE = '/api/curriculum';

// Department mapping
const DEPARTMENTS = {
  1: 'Information Technology',
  2: 'Computer Science'
};

function getDepartmentName(deptId) {
  return DEPARTMENTS[deptId] || 'N/A';
}

// Convert year level to ordinal format (1 -> 1st, 2 -> 2nd, etc.)
function getOrdinalYearLevel(year) {
  const num = parseInt(year);
  if (num === 1) return '1st Year';
  if (num === 2) return '2nd Year';
  if (num === 3) return '3rd Year';
  if (num === 4) return '4th Year';
  return num + ' Year';
}

// Convert 24-hour time to 12-hour format with AM/PM
function convertTo12Hour(time24) {
  if (!time24) return '-';
  const [hours, minutes] = time24.split(':');
  let hour = parseInt(hours);
  const min = minutes;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  
  if (hour > 12) {
    hour = hour - 12;
  } else if (hour === 0) {
    hour = 12;
  }
  
  return `${hour}:${min} ${ampm}`;
}

export function initSchedules() {
  console.log('[HR] Initializing Schedules Module...');
  setupEventListeners();
  loadDepartmentsFromBackend(); // Load departments first
  loadSchedules(); // Initial load
}

// Load departments from backend and populate select elements
async function loadDepartmentsFromBackend() {
  try {
    const response = await fetch('/api/hr/departments');
    if (!response.ok) {
      console.warn('[HR] Failed to load departments from backend, using default mapping');
      return;
    }

    const result = await response.json();
    const departments = Array.isArray(result) ? result : result.data || [];

    console.log('[HR] Loaded departments from backend:', departments);

    // Update the global DEPARTMENTS mapping with actual data from backend
    departments.forEach(dept => {
      DEPARTMENTS[dept.dept_id] = dept.dept_name;
    });

    // Populate department select elements in both create and edit modals
    populateDepartmentSelects(departments);
  } catch (error) {
    console.error('[HR] Error loading departments:', error);
    // Fall back to hardcoded departments
  }
}

// Populate department select dropdowns with actual departments from database
function populateDepartmentSelects(departments) {
  const createSelect = document.querySelector('#createScheduleForm select[name="dept_id"]');
  const editSelect = document.querySelector('#editScheduleForm select[name="dept_id"]');
  const filterSelect = document.getElementById('scheduleFilterDept');

  // Helper function to populate a select
  const populateSelect = (selectEl) => {
    if (!selectEl) return;

    // Keep the first option (Select Department / placeholder)
    const firstOption = selectEl.querySelector('option[value=""]');
    selectEl.innerHTML = '';
    if (firstOption) {
      selectEl.appendChild(firstOption);
    } else {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select Department';
      selectEl.appendChild(placeholder);
    }

    // Add all departments
    departments.forEach(dept => {
      const option = document.createElement('option');
      option.value = dept.dept_id;
      option.textContent = dept.dept_name;
      selectEl.appendChild(option);
    });
  };

  populateSelect(createSelect);
  populateSelect(editSelect);
  populateSelect(filterSelect);
}

function setupEventListeners() {
  // Filter Changes
  document.getElementById('scheduleFilterLevel')?.addEventListener('change', loadSchedules);
  document.getElementById('scheduleFilterTerm')?.addEventListener('change', loadSchedules);
  document.getElementById('scheduleFilterDept')?.addEventListener('change', loadSchedules);

  // Add Subject Button
  document.getElementById('btnAddSubject')?.addEventListener('click', () => addSubjectRow());

  // New Schedule Button
  document.getElementById('btnNewSchedule')?.addEventListener('click', openCreateScheduleModal);

  // Clone Term Button
  document.getElementById('btnCloneTerm')?.addEventListener('click', openCloneTermModal);

  // Form Submission (Create Schedule)
  document.getElementById('createScheduleForm')?.addEventListener('submit', handleCreateSchedule);

  // Clone Form Submission
  document.getElementById('cloneTermForm')?.addEventListener('submit', handleCloneTerm);

  // Edit Form Submission
  document.getElementById('editScheduleForm')?.addEventListener('submit', handleUpdateSchedule);

  // Add Subject Button (Edit Modal)
  document.getElementById('btnEditAddSubject')?.addEventListener('click', () => addSubjectRow('editSubjectsListContainer'));
}

/**
 * Load and Render Schedules
 */
async function loadSchedules() {
  const container = document.getElementById('schedulesGrid');
  if (!container) return;

  container.innerHTML = '<div class="loading-spinner"></div>';

  try {
    // Get filters
    const yearLevel = document.getElementById('scheduleFilterLevel')?.value || '';
    const term = document.getElementById('scheduleFilterTerm')?.value || '';
    const dept = document.getElementById('scheduleFilterDept')?.value || '';

    const params = new URLSearchParams();
    if (yearLevel) params.append('year_level', yearLevel);
    if (term) params.append('term', term);
    if (dept) params.append('dept_id', dept);

    // Determine current school year (mock or fetch)
    // For now, let's assume we fetch all or filter by active
    // params.append('school_year', '2025-2026'); 

    const response = await fetch(`${API_BASE}?${params.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch schedules');

    const result = await response.json();
    // Cache result
    loadedSchedules = result.data;
    renderSchedules(loadedSchedules);
  } catch (error) {
    console.error('Error loading schedules:', error);
    container.innerHTML = `<div class="error-message">Error loading schedules: ${error.message}</div>`;
  }
}

/**
 * Render Schedule Cards
 */
function renderSchedules(schedules) {
  const container = document.getElementById('schedulesGrid');
  if (!container) return;

  container.innerHTML = '';

  if (schedules.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <h3>No Schedules Found</h3>
        <p>Create a new section schedule or clone from a previous term.</p>
      </div>
    `;
    return;
  }

  schedules.forEach(schedule => {
    const card = document.createElement('div');
    card.className = 'schedule-card';
    card.setAttribute('data-template-id', schedule.template_id);
    const subjectCount = schedule.subjects ? schedule.subjects.length : 0;

    // Find unassigned slots (subjects without professors)
    // Note: subjects are stored as JSONB. Checking assigned_professor_id
    const unassignedCount = (schedule.subjects || []).filter(s => !s.assigned_professor_id).length;
    const statusClass = unassignedCount === 0 ? 'status-success' : 'status-warning';
    const statusText = unassignedCount === 0 ? 'Completed' : `${unassignedCount} NEEDS ASSIGNMENT`;

    card.innerHTML = `
      <div class="schedule-header">
        <div class="schedule-title">
          <h4>Section ${schedule.section_name}</h4>
          <span class="schedule-meta">${schedule.year_level} Year • ${schedule.term}</span>
        </div>
        <div class="schedule-actions">
          <button class="btn-edit-schedule" onclick="window.editSchedule(${schedule.template_id}); event.stopPropagation();">
            EDIT
          </button>
          <button class="btn-clone-schedule" onclick="window.cloneSchedule(${schedule.template_id}); event.stopPropagation();">
            CLONE
          </button>
          <button class="btn-delete-schedule" onclick="window.deleteSchedule(${schedule.template_id}); event.stopPropagation();">
            DELETE
          </button>
        </div>
      </div>
      
      <div class="schedule-body">
        <div class="info-row">
          <span class="label">School Year</span>
          <span class="value">${schedule.school_year}</span>
        </div>
        <div class="info-row">
          <span class="label">Department</span>
          <span class="value">${getDepartmentName(schedule.dept_id)}</span>
        </div>
        <div class="info-row">
          <span class="label">Subjects</span>
          <span class="value">${subjectCount} Subjects</span>
        </div>
      </div>

      <div class="schedule-footer">
        <span class="status-badge ${statusClass}">${statusText}</span>
      </div>
    `;
    
    // Add click handler to card to open view modal
    card.addEventListener('click', function() {
      openViewScheduleModal(schedule.template_id);
    });
    
    container.appendChild(card);
  });
}

/**
 * Open Create Modal
 */
function openCreateScheduleModal() {
  const modal = document.getElementById('createScheduleModal');
  if (modal) {
    modal.classList.add('visible');
    // Reset form
    document.getElementById('createScheduleForm')?.reset();
    // Clear subjects list UI
    const container = document.getElementById('subjectsListContainer');
    if (container) {
      container.innerHTML = '';
      // Add one initial row
      addSubjectRow('subjectsListContainer');
    }
  }
}

// ... (Create Schedule Handler - no changes needed if getSubjectsFromUI works) ...

/**
 * Add a new subject row to the form
 * Supports optional data for populating edit form
 */
function addSubjectRow(containerId = 'subjectsListContainer', data = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'subject-row-entry'; // New CSS class

  // Default values
  const code = data?.subject_code || '';
  const name = data?.subject_name || '';
  const days = data?.days_of_week ? (Array.isArray(data.days_of_week) ? data.days_of_week.join(',') : data.days_of_week) : '';
  const start = data?.start_time || '';
  const end = data?.end_time || '';
  const room = data?.room_name || '';

  div.innerHTML = `
        <div class="col-code">
            <input type="text" name="subject_code" value="${code}" placeholder="Code" required>
        </div>
        <div class="col-name">
            <input type="text" name="subject_name" value="${name}" placeholder="Subject Name" required>
        </div>
        <div class="col-days">
            <input type="text" name="days" value="${days}" placeholder="M,W,F" required>
        </div>
        <div class="col-time">
            <div class="time-range-group">
                <input type="time" name="start_time" value="${start}" required>
                <span>-</span>
                <input type="time" name="end_time" value="${end}" required>
            </div>
        </div>
        <div class="col-room">
            <input type="text" name="room_name" value="${room}" placeholder="Room" required>
        </div>
        <div class="col-action">
            <button type="button" class="btn-swap-row" onclick="window.swapSubjectTimes(this)" title="Swap Times with Another Subject">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 12l-3-3m3 3l3-3M17 8v12m0-12l3 3m-3-3l-3 3"></path></svg>
            </button>
            <button type="button" class="btn-remove-row" onclick="this.closest('.subject-row-entry').remove()" title="Remove Subject">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
    `;
  container.appendChild(div);
  
  // Add uppercase conversion for subject code input
  const codeInput = div.querySelector('input[name="subject_code"]');
  if (codeInput) {
    codeInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
  }
}

// ...

function openEditScheduleModal(id) {
    const modal = document.getElementById('editScheduleModal');
    const form = document.getElementById('editScheduleForm');
    if (!modal || !form) return;

    // Find schedule data
    const schedule = loadedSchedules.find(s => s.template_id === id);
    if (!schedule) {
        showToast('Schedule not found', 'error');
        return;
    }

    // Populate Fields
    form.querySelector('[name="template_id"]').value = schedule.template_id;
    form.querySelector('[name="dept_id"]').value = schedule.dept_id;
    form.querySelector('[name="year_level"]').value = schedule.year_level;
    form.querySelector('[name="section_name"]').value = schedule.section_name;
    form.querySelector('[name="school_year"]').value = schedule.school_year;
    form.querySelector('[name="term"]').value = schedule.term;

    // Populate Subjects using the helper
    const container = document.getElementById('editSubjectsListContainer');
    container.innerHTML = '';

    if (schedule.subjects && schedule.subjects.length > 0) {
        // Sort subjects by start_time before displaying
        const sortedSubjects = sortSubjectsByTime([...schedule.subjects]);
        sortedSubjects.forEach(sub => {
            // Normalize days if stored as string/array
            addSubjectRow('editSubjectsListContainer', sub);
        });
    } else {
        // Add one empty if none
        addSubjectRow('editSubjectsListContainer');
    }

    modal.classList.add('visible');
}

// Store current viewing schedule ID for edit from view
let currentViewingScheduleId = null;

// Open View-Only Modal
function openViewScheduleModal(id) {
    const modal = document.getElementById('viewScheduleModal');
    if (!modal) return;

    // Find schedule data
    const schedule = loadedSchedules.find(s => s.template_id === id);
    if (!schedule) {
        showToast('Schedule not found', 'error');
        return;
    }

    currentViewingScheduleId = id;

    // Populate read-only fields
    document.getElementById('viewDeptName').value = getDepartmentName(schedule.dept_id);
    document.getElementById('viewYearLevel').value = getOrdinalYearLevel(schedule.year_level);
    document.getElementById('viewSchoolYear').value = schedule.school_year;
    document.getElementById('viewTerm').value = schedule.term;
    document.getElementById('viewSectionName').value = schedule.section_name;

    // Populate read-only subjects
    const container = document.getElementById('viewSubjectsListContainer');
    container.innerHTML = '';

    if (schedule.subjects && schedule.subjects.length > 0) {
        // Sort subjects by day first, then by time before displaying
        const sortedSubjects = sortSubjectsByTime([...schedule.subjects]);
        sortedSubjects.forEach(subject => {
            const div = document.createElement('div');
            div.className = 'view-subject-row';
            
            const days = Array.isArray(subject.days_of_week) ? subject.days_of_week.join(',') : subject.days_of_week;
            
            div.innerHTML = `
                <div class="col-code">${subject.subject_code || '-'}</div>
                <div class="col-name">${subject.subject_name || '-'}</div>
                <div class="col-days">${days || '-'}</div>
                <div class="col-time">${convertTo12Hour(subject.start_time)} - ${convertTo12Hour(subject.end_time)}</div>
                <div class="col-room">${subject.room_name || '-'}</div>
            `;
            container.appendChild(div);
        });
    }

    modal.classList.add('visible');
}

// Open edit modal from view modal
window.openEditScheduleModalFromView = function() {
    if (currentViewingScheduleId !== null) {
        closeModal('viewScheduleModal');
        window.editSchedule(currentViewingScheduleId);
    }
};

function getSubjectsFromContainer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    
    // Scan entries using the new class
    const subjectEntries = container.querySelectorAll('.subject-row-entry');
    const subjects = [];

    subjectEntries.forEach(entry => {
        const daysVal = entry.querySelector('[name="days"]').value;
        subjects.push({
            subject_code: entry.querySelector('[name="subject_code"]').value,
            subject_name: entry.querySelector('[name="subject_name"]').value,
            days_of_week: daysVal.split(',').map(d => d.trim()),
            start_time: entry.querySelector('[name="start_time"]').value,
            end_time: entry.querySelector('[name="end_time"]').value,
            room_name: entry.querySelector('[name="room_name"]').value,
        });
    });
    
    // Sort subjects by day and time
    return sortSubjectsByTime(subjects);
}

// Update getSubjectsFromUI to use generic helper
function getSubjectsFromUI() {
    return getSubjectsFromContainer('subjectsListContainer');
}

// Day order mapping
const DAY_ORDER = {
    'Monday': 0, 'M': 0,
    'Tuesday': 1, 'T': 1,
    'Wednesday': 2, 'W': 2,
    'Thursday': 3, 'Th': 3, 'TR': 3,
    'Friday': 4, 'F': 4,
    'Saturday': 5, 'Sat': 5,
    'Sunday': 6, 'Sun': 6
};

// Track selected row for swapping
let selectedSwapRow = null;

// Swap times between two subject rows
window.swapSubjectTimes = function(button) {
    const currentRow = button.closest('.subject-row-entry');
    
    if (!selectedSwapRow) {
        // First selection
        selectedSwapRow = currentRow;
        currentRow.classList.add('swap-selected');
        button.classList.add('swap-active');
        showToast('Click another subject to swap times with', 'info');
    } else if (selectedSwapRow === currentRow) {
        // Deselect same row
        currentRow.classList.remove('swap-selected');
        button.classList.remove('swap-active');
        selectedSwapRow = null;
        showToast('Swap cancelled', 'info');
    } else {
        // Swap times between selectedSwapRow and currentRow
        const row1StartInput = selectedSwapRow.querySelector('[name="start_time"]');
        const row1EndInput = selectedSwapRow.querySelector('[name="end_time"]');
        const row2StartInput = currentRow.querySelector('[name="start_time"]');
        const row2EndInput = currentRow.querySelector('[name="end_time"]');
        
        // Store values
        const temp1Start = row1StartInput.value;
        const temp1End = row1EndInput.value;
        
        // Swap
        row1StartInput.value = row2StartInput.value;
        row1EndInput.value = row2EndInput.value;
        row2StartInput.value = temp1Start;
        row2EndInput.value = temp1End;
        
        // Clear selection
        selectedSwapRow.classList.remove('swap-selected');
        selectedSwapRow.querySelector('.btn-swap-row').classList.remove('swap-active');
        selectedSwapRow = null;
        
        showToast('Times swapped successfully', 'success');
    }
};

// Sort subjects by day first, then by time (earliest first)
function sortSubjectsByTime(subjects) {
    return subjects.sort((a, b) => {
        // Get first day from each subject's days_of_week
        const aDays = Array.isArray(a.days_of_week) ? a.days_of_week : (a.days_of_week ? a.days_of_week.split(',').map(d => d.trim()) : []);
        const bDays = Array.isArray(b.days_of_week) ? b.days_of_week : (b.days_of_week ? b.days_of_week.split(',').map(d => d.trim()) : []);
        
        const aFirstDay = aDays[0] ? aDays[0].trim() : '';
        const bFirstDay = bDays[0] ? bDays[0].trim() : '';
        
        const aDayOrder = DAY_ORDER[aFirstDay] ?? 999;
        const bDayOrder = DAY_ORDER[bFirstDay] ?? 999;
        
        // First sort by day
        if (aDayOrder !== bDayOrder) {
            return aDayOrder - bDayOrder;
        }
        
        // Then sort by time within same day
        if (!a.start_time || !b.start_time) return 0;
        return a.start_time.localeCompare(b.start_time);
    });
}

/**
 * Handle Create Schedule
 */
async function handleCreateSchedule(e) {
  e.preventDefault();
  const btn = document.querySelector('button[form="createScheduleForm"][type="submit"]');
  const originalText = btn.textContent;
  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    const formData = new FormData(e.target);
    const data = {
      dept_id: formData.get('dept_id'),
      year_level: formData.get('year_level'),
      section_name: formData.get('section_name'),
      school_year: formData.get('school_year'),
      term: formData.get('term'),
      subjects: getSubjectsFromUI() // Helper to scrape added subjects
    };

    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || 'Failed to create schedule');
    }

    const result = await response.json();
    const newSchedule = result.data;

    // Success
    closeModal('createScheduleModal');
    
    // Add to schedules and re-render
    loadedSchedules.unshift(newSchedule);
    renderSchedules(loadedSchedules);
    
    // Animate the newly created card
    setTimeout(() => {
      const newCard = document.querySelector(`[data-template-id="${newSchedule.template_id}"]`);
      if (newCard) {
        newCard.classList.add('schedule-cloned');
        // Remove animation class after animation completes
        setTimeout(() => {
          newCard.classList.remove('schedule-cloned');
        }, 1000);
      }
    }, 0);
    
    showToast('Schedule created successfully', 'success');

  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}



/**
 * Open Clone Modal
 */
function openCloneTermModal() {
  const modal = document.getElementById('cloneTermModal');
  if (modal) modal.classList.add('visible');
}

/**
 * Handle Clone Term
 */
async function handleCloneTerm(e) {
  e.preventDefault();
  // Implementation similar to create but calling /clone endpoint
  const btn = document.querySelector('button[form="cloneTermForm"][type="submit"]');
  const originalText = btn.textContent;
  btn.textContent = 'Cloning...';
  btn.disabled = true;

  try {
    const formData = new FormData(e.target);
    const data = {
      from_school_year: formData.get('from_school_year'),
      from_term: formData.get('from_term'),
      to_school_year: formData.get('to_school_year'),
      to_term: formData.get('to_term')
    };

    const response = await fetch(`${API_BASE}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || 'Failed to clone term');
    }

    const result = await response.json();
    closeModal('cloneTermModal');
    loadSchedules();
    showToast(result.message || 'Term cloned successfully', 'success');

  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Global Helpers
function closeModal(id) {
  document.getElementById(id)?.classList.remove('visible');
}

function showToast(msg, type = 'info') {
  // Assuming a showToast global exists or console
  console.log(`[${type.toUpperCase()}] ${msg}`);
  // If you have a toast component, call it here.
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Make functions globally available for onclick handlers
window.closeModal = closeModal;

// Store current schedules for edit lookup
let loadedSchedules = [];

// Update global edit handler to use new logic
window.editSchedule = (id) => {
  openEditScheduleModal(id);
};

// Delete schedule handler with confirmation
window.deleteSchedule = async (id) => {
  const schedule = loadedSchedules.find(s => s.template_id === id);
  if (!schedule) {
    showToast('Schedule not found', 'error');
    return;
  }
  
  // Show confirmation dialog
  const confirmed = confirm(
    `Are you sure you want to delete the schedule for Section ${schedule.section_name} (${schedule.year_level} Year, ${schedule.term})?\n\nThis action cannot be undone.`
  );
  
  if (!confirmed) return;
  
  try {
    const response = await fetch(`${API_BASE}/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || 'Failed to delete schedule');
    }

    // Remove from loaded schedules
    loadedSchedules = loadedSchedules.filter(s => s.template_id !== id);
    
    // Re-render schedules
    renderSchedules(loadedSchedules);
    
    showToast(`Schedule for Section ${schedule.section_name} deleted successfully`, 'success');
  } catch (error) {
    console.error('Delete error:', error);
    showToast(error.message, 'error');
  }
};

// Clone schedule handler - opens modal with pre-filled data
window.cloneSchedule = (id) => {
  const schedule = loadedSchedules.find(s => s.template_id === id);
  if (!schedule) {
    showToast('Schedule not found', 'error');
    return;
  }
  
  // Open create modal and pre-fill with clone data
  const modal = document.getElementById('createScheduleModal');
  const form = document.getElementById('createScheduleForm');
  
  // Reset form first
  form.reset();
  
  // Pre-fill with clone data
  const deptSelect = form.querySelector('select[name="dept_id"]');
  const yearSelect = form.querySelector('select[name="year_level"]');
  const sectionInput = form.querySelector('input[name="section_name"]');
  const schoolYearInput = form.querySelector('input[name="school_year"]');
  const termSelect = form.querySelector('select[name="term"]');
  
  if (deptSelect) deptSelect.value = schedule.dept_id || '';
  if (yearSelect) yearSelect.value = schedule.year_level || '';
  // Leave section_name empty for user to enter - mark with red border
  if (sectionInput) {
    sectionInput.value = '';
    sectionInput.classList.add('input-required-empty');
  }
  // PREFILL school_year and term from original
  if (schoolYearInput) schoolYearInput.value = schedule.school_year || '';
  if (termSelect) termSelect.value = schedule.term || '';
  
  // Copy subjects from original schedule with all details
  const subjectsContainer = document.getElementById('subjectsListContainer');
  subjectsContainer.innerHTML = ''; // Clear existing subjects
  
  if (schedule.subjects && schedule.subjects.length > 0) {
    // Sort subjects by day first, then by time before displaying
    const sortedSubjects = sortSubjectsByTime([...schedule.subjects]);
    sortedSubjects.forEach(subject => {
      // Use the addSubjectRow function with data to properly format subjects
      // Prefill all subject data including times
      addSubjectRow('subjectsListContainer', {
        subject_code: subject.subject_code || '',
        subject_name: subject.subject_name || '',
        days_of_week: subject.days_of_week || '',
        start_time: subject.start_time || '',
        end_time: subject.end_time || '',
        room_name: subject.room_name || ''
      });
    });
  } else {
    // Add one empty row if no subjects
    addSubjectRow('subjectsListContainer');
  }
  
  // Show the modal using class (not showModal)
  if (modal) {
    modal.classList.add('visible');
  }
  
  // Ensure section_name field shows red border as it's the only empty required field
  setTimeout(() => {
    if (sectionInput && !sectionInput.value) {
      sectionInput.classList.add('input-required-empty');
    }
  }, 0);
};


async function handleUpdateSchedule(e) {
    e.preventDefault();
    const btn = document.querySelector('button[form="editScheduleForm"][type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
        const formData = new FormData(e.target);
        const id = formData.get('template_id');
        
        // Use helper but point to edit container
        const subjects = getSubjectsFromContainer('editSubjectsListContainer');

        const data = {
            dept_id: formData.get('dept_id'),
            year_level: formData.get('year_level'),
            section_name: formData.get('section_name'),
            school_year: formData.get('school_year'),
            term: formData.get('term'),
            subjects: subjects
        };

        const response = await fetch(`${API_BASE}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || 'Failed to update schedule');
        }

        closeModal('editScheduleModal');
        loadSchedules();
        showToast('Schedule updated successfully', 'success');

    } catch (error) {
        console.error(error);
        showToast(error.message, 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}
