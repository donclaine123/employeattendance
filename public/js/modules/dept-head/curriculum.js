/**
 * curriculum.js
 * Department Head - Assign Professors to Subjects in Curriculum
 */

import { fetchHeadInfo } from './utils.js';

const API_BASE = '/api/curriculum';
const DEPARTMENT_HEAD_API = '/api/department-head';

let loadedSchedules = [];
let currentDepartmentId = null;

/**
 * Convert military time (HH:MM) to 12-hour format (h:MM AM/PM)
 * @param {string} time - Time in HH:MM format (24-hour)
 * @returns {string} Time in h:MM AM/PM format
 */
function convertTo12Hour(time) {
  if (!time) return time;
  
  try {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    
    return `${displayHour}:${minutes} ${ampm}`;
  } catch (error) {
    console.warn('Error converting time:', time, error);
    return time;
  }
}

async function initCurriculum() {
  console.log('[DeptHead] Initializing Curriculum Assignment Module');

  try {
    // Fetch department info for the current user
    const headInfo = await fetchHeadInfo();

    if (headInfo?.dept_id) {
      currentDepartmentId = headInfo.dept_id;
      console.log('[DeptHead] Department ID retrieved:', currentDepartmentId);
    } else {
      throw new Error('Could not retrieve department information');
    }
  } catch (error) {
    console.error('[DeptHead] Error getting department ID:', error);
    const container = document.getElementById('curriculumSchedulesGrid');
    if (container) {
      container.innerHTML = '<div class="error-message">Error: Could not load your department information. ' + error.message + '</div>';
    }
    return;
  }

  // Setup event listeners
  setupEventListeners();

  // Load initial schedules
  loadCurriculumSchedules();
}

function setupEventListeners() {
  const filterHandler = () => {
    if (document.getElementById('viewToggle')?.value === 'section') {
      loadCurriculumSchedules();
    } else {
      loadSubjectsView();
    }
  };

  document.getElementById('curriculumFilterLevel')?.addEventListener('change', filterHandler);
  document.getElementById('curriculumFilterTerm')?.addEventListener('change', filterHandler);
  document.getElementById('curriculumFilterYear')?.addEventListener('change', filterHandler);

  // View toggle
  const viewToggle = document.getElementById('viewToggle');
  if (viewToggle) {
    viewToggle.addEventListener('change', function() {
      const gridContainer = document.getElementById('curriculumSchedulesGrid');
      const subjectsContainer = document.getElementById('curriculumSubjectsView');
      
      if (this.value === 'section') {
        if (gridContainer) gridContainer.style.display = 'grid';
        if (subjectsContainer) subjectsContainer.style.display = 'none';
        loadCurriculumSchedules();
      } else {
        if (gridContainer) gridContainer.style.display = 'none';
        if (subjectsContainer) subjectsContainer.style.display = 'block';
        loadSubjectsView();
      }
    });
  }
}

/**
 * Load schedules for current department with filters
 */
async function loadCurriculumSchedules() {
  const container = document.getElementById('curriculumSchedulesGrid');
  const emptyState = document.getElementById('curriculumEmpty');

  if (!container) return;

  if (!currentDepartmentId) {
    container.innerHTML = '<div class="error-message">Error: Department ID not set. Please refresh the page.</div>';
    return;
  }

  container.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const yearLevel = document.getElementById('curriculumFilterLevel')?.value || '';
    const term = document.getElementById('curriculumFilterTerm')?.value || '';
    const schoolYear = document.getElementById('curriculumFilterYear')?.value || '';

    const params = new URLSearchParams();
    params.append('dept_id', currentDepartmentId);
    if (yearLevel) params.append('year_level', yearLevel);
    if (term) params.append('term', term);
    if (schoolYear) params.append('school_year', schoolYear);

    console.log('[loadCurriculumSchedules] Fetching with params:', {
      dept_id: currentDepartmentId,
      year_level: yearLevel,
      term,
      school_year: schoolYear
    });

    const response = await fetch(`${API_BASE}?${params.toString()}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to fetch schedules');
    }

    const result = await response.json();
    console.log('[loadCurriculumSchedules] Response:', result);

    loadedSchedules = result.data || [];

    container.innerHTML = '';
    emptyState.style.display = 'none';

    if (loadedSchedules.length === 0) {
      console.warn('[loadCurriculumSchedules] No schedules found for department:', currentDepartmentId);
      emptyState.style.display = 'block';
      container.innerHTML = '';
      return;
    }

    renderCurriculumCards(loadedSchedules);
  } catch (error) {
    console.error('Error loading curriculum schedules:', error);
    container.innerHTML = `<div class="error-message">Error loading schedules: ${error.message}</div>`;
  }
}

/**
 * Render curriculum cards showing schedules
 */
function renderCurriculumCards(schedules) {
  const container = document.getElementById('curriculumSchedulesGrid');
  if (!container) return;

  container.innerHTML = '';

  schedules.forEach(schedule => {
    const card = document.createElement('div');
    card.className = 'curriculum-card';
    card.setAttribute('data-template-id', schedule.template_id);

    const subjectCount = schedule.subjects?.length || 0;
    const assignedCount = (schedule.subjects || []).filter(s => s.assigned_professor_id).length;
    const unassignedCount = subjectCount - assignedCount;

    const statusClass = unassignedCount === 0 ? 'status-complete' : 'status-incomplete';
    const statusText = unassignedCount === 0 ? 'All Assigned' : `${unassignedCount} Unassigned`;

    card.innerHTML = `
      <div class="curriculum-card-header">
        <div class="curriculum-card-title">
          <h4>Section ${schedule.section_name}</h4>
          <span class="curriculum-meta">${getOrdinalYear(schedule.year_level)} • ${schedule.term}</span>
        </div>
        <span class="status-badge ${statusClass}">${statusText}</span>
      </div>
      
      <div class="curriculum-card-body">
        <div class="curriculum-info-row">
          <span class="label">School Year</span>
          <span class="value">${schedule.school_year}</span>
        </div>
        <div class="curriculum-info-row">
          <span class="label">Subjects</span>
          <span class="value">${assignedCount}/${subjectCount} Assigned</span>
        </div>
      </div>
      
      <div class="curriculum-card-footer">
        <button class="btn-view-subjects" onclick="window.viewScheduleSubjects(${schedule.template_id})">
          View & Assign Subjects
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

/**
 * Convert year level to ordinal format
 */
function getOrdinalYear(year) {
  const num = parseInt(year);
  if (num === 1) return '1st Year';
  if (num === 2) return '2nd Year';
  if (num === 3) return '3rd Year';
  if (num === 4) return '4th Year';
  return num + ' Year';
}

/**
 * View subjects in a schedule and manage assignments
 */
window.viewScheduleSubjects = async function (templateId) {
  const schedule = loadedSchedules.find(s => s.template_id === templateId);
  if (!schedule) {
    showToast('Schedule not found', 'error');
    return;
  }

  // Open modal with schedule details and subjects
  openAssignmentModal(schedule);
};

/**
 * Open assignment modal for a schedule
 */

// Day order mapping for sorting
const DAY_ORDER = {
  'Monday': 0, 'M': 0,
  'Tuesday': 1, 'T': 1,
  'Wednesday': 2, 'W': 2,
  'Thursday': 3, 'Th': 3, 'TR': 3,
  'Friday': 4, 'F': 4,
  'Saturday': 5, 'Sat': 5,
  'Sunday': 6, 'Sun': 6
};

// Sort subjects by day first, then by time (earliest first)
function sortSubjectsByTime(subjects) {
  return [...subjects].sort((a, b) => {
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
 * Open assignment modal for a schedule
 */
async function openAssignmentModal(schedule) {
  // Create modal HTML
  const modal = document.createElement('div');
  modal.className = 'curriculum-assignment-modal';
  modal.id = 'assignmentModal';

  // Fetch professors for the department
  const professors = await fetchDepartmentProfessors();

  // Sort subjects chronologically before rendering
  const sortedSubjects = sortSubjectsByTime(schedule.subjects || []);

  const subjectsHTML = sortedSubjects.map((subject, index) => {
    const originalIndex = (schedule.subjects || []).indexOf(subject);

    return `
      <div class="subject-row-entry" data-subject-index="${originalIndex}" data-template-id="${schedule.template_id}">
        <div class="col-code">${subject.subject_code}</div>
        <div class="col-name">${subject.subject_name}</div>
        <div class="col-days">${Array.isArray(subject.days_of_week) ? subject.days_of_week.join(',') : subject.days_of_week}</div>
        <div class="col-time">${convertTo12Hour(subject.start_time)} - ${convertTo12Hour(subject.end_time)}</div>
        <div class="col-room">${subject.room_name || '-'}</div>
        <div class="col-professor">
          <select class="professor-select" data-subject-index="${originalIndex}" data-template-id="${schedule.template_id}">
            <option value="">-- Unassigned --</option>
            ${professors.map(prof => `
              <option value="${prof.user_id}" ${subject.assigned_professor_id === prof.user_id ? 'selected' : ''}>
                ${prof.full_name}
              </option>
            `).join('')}
          </select>
        </div>
      </div>
    `;
  }).join('');

  modal.innerHTML = `
    <div class="curriculum-modal-wrapper">
      <div class="modal-content curriculum-modal">
        <div class="modal-header">
          <div>
            <h3>Assign Professors</h3>
            <p class="modal-subtitle">Section ${schedule.section_name}</p>
          </div>
          <button class="modal-close" onclick="this.closest('.curriculum-assignment-modal').remove()">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="schedule-info-card">
            <div class="info-item">
              <span class="info-label">Year Level</span>
              <span class="info-value">${getOrdinalYear(schedule.year_level)}</span>
            </div>
            <div class="info-divider"></div>
            <div class="info-item">
              <span class="info-label">Term</span>
              <span class="info-value">${schedule.term}</span>
            </div>
            <div class="info-divider"></div>
            <div class="info-item">
              <span class="info-label">School Year</span>
              <span class="info-value">${schedule.school_year}</span>
            </div>
          </div>
          
          <div class="subjects-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
            Subject Assignments
          </div>
          
          <div class="subjects-table-header">
            <div>Code</div>
            <div>Subject Name</div>
            <div>Days</div>
            <div>Time (Start - End)</div>
            <div>Room</div>
            <div>Assign Professor</div>
          </div>
          
          <div class="subjects-assignment-list">
            ${subjectsHTML}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="this.closest('.curriculum-assignment-modal').remove()">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add change handlers to professor selects
  document.querySelectorAll('.professor-select').forEach(select => {
    select.addEventListener('change', async function() {
      const subjectIndex = parseInt(this.getAttribute('data-subject-index'));
      const templateId = parseInt(this.getAttribute('data-template-id'));
      const professorId = this.value;

      if (!professorId) {
        showToast('Please select a professor', 'warning');
        return;
      }

      try {
        const response = await fetch(`${API_BASE}/${templateId}/assign-professor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject_index: subjectIndex,
            professor_id: parseInt(professorId)
          })
        });

        if (!response.ok) throw new Error('Failed to assign professor');

        showToast('Professor assigned successfully', 'success');
        
        // Reload schedules to reflect changes
        setTimeout(() => {
          loadCurriculumSchedules();
        }, 500);
      } catch (error) {
        console.error('Error assigning professor:', error);
        showToast('Error assigning professor: ' + error.message, 'error');
        // Reset select on error
        this.value = '';
      }
    });
  });
}

/**
 * Fetch list of professors in the department
 */
async function fetchDepartmentProfessors() {
  try {
    console.log(`[DeptHead] Fetching professors for dept_id=${currentDepartmentId}`);
    const response = await fetch(`${DEPARTMENT_HEAD_API}/professors?dept_id=${currentDepartmentId}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[DeptHead] Professor fetch error:', response.status, errorData);
      throw new Error(errorData.message || `Failed to fetch professors (${response.status})`);
    }

    const result = await response.json();
    console.log('[DeptHead] Professors loaded:', result.data?.length || 0);
    return result.data || [];
  } catch (error) {
    console.error('Error fetching professors:', error);
    showToast('Failed to load professors list: ' + error.message, 'error');
    return [];
  }
}

/**
 * Load and display all subjects from schedules in a chronological list view
 */
async function loadSubjectsView() {
  const container = document.getElementById('curriculumSubjectsView');
  if (!container) return;

  try {
    // Apply filters
    const yearLevel = document.getElementById('curriculumFilterLevel')?.value || '';
    const term = document.getElementById('curriculumFilterTerm')?.value || '';
    const schoolYear = document.getElementById('curriculumFilterYear')?.value || '';

    // Collect all subjects from all schedules with metadata
    const allSubjects = [];
    loadedSchedules.forEach(schedule => {
      if (
        (!yearLevel || schedule.year_level == yearLevel) &&
        (!term || schedule.term === term) &&
        (!schoolYear || schedule.school_year === schoolYear)
      ) {
        (schedule.subjects || []).forEach(subject => {
            allSubjects.push({
              ...subject,
              section_name: schedule.section_name,
              year_level: schedule.year_level,
              term: schedule.term,
              school_year: schedule.school_year,
              template_id: schedule.template_id
            });
          });
      }
    });

    if (allSubjects.length === 0) {
      container.innerHTML = '<div class="empty-state" style="text-align: center; padding: 40px;"><h4>No subjects found</h4><p>No subjects match the selected filters.</p></div>';
      return;
    }

    // Sort subjects chronologically
    const sortedSubjects = sortSubjectsByTime(allSubjects);

    // Fetch professors
    const professors = await fetchDepartmentProfessors();

    // Group subjects by subject code
    const subjectsByCode = {};
    sortedSubjects.forEach(subject => {
      if (!subjectsByCode[subject.subject_code]) {
        subjectsByCode[subject.subject_code] = {
          code: subject.subject_code,
          name: subject.subject_name,
          instances: []
        };
      }
      subjectsByCode[subject.subject_code].instances.push(subject);
    });

    // Sort codes alphabetically and render grouped subjects
    const sortedCodes = Object.keys(subjectsByCode).sort();
    let groupedHTML = '';

    sortedCodes.forEach(code => {
      const group = subjectsByCode[code];
      
      // Count assigned professors
      const assignedCount = group.instances.filter(s => s.assigned_professor_id).length;
      const totalCount = group.instances.length;
      
      const instancesHTML = group.instances.map((subject) => {
        return `
          <div class="subject-row-entry" data-template-id="${subject.template_id}" data-subject-code="${subject.subject_code}">
            <div class="col-days">${Array.isArray(subject.days_of_week) ? subject.days_of_week.join(',') : subject.days_of_week}</div>
            <div class="col-time">${convertTo12Hour(subject.start_time)} - ${convertTo12Hour(subject.end_time)}</div>
            <div class="col-room">${subject.room_name || '-'}</div>
            <div class="col-section">${subject.section_name}</div>
            <div class="col-professor">
              <select class="professor-select" data-subject-code="${subject.subject_code}" data-template-id="${subject.template_id}">
                <option value="">-- Unassigned --</option>
                ${professors.map(prof => `
                  <option value="${prof.user_id}" ${subject.assigned_professor_id === prof.user_id ? 'selected' : ''}>
                    ${prof.full_name}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>
        `;
      }).join('');

      groupedHTML += `
        <div class="subject-group">
          <div class="subject-group-header">
            <div class="subject-group-info">
              <div class="group-code">${code}</div>
              <div class="group-name">${group.name}</div>
            </div>
            <div class="subject-group-stats">
              <div class="progress-bar-minimal">
                <div class="progress-fill" style="width: ${(assignedCount / totalCount) * 100}%"></div>
              </div>
              <span class="stats-text">${assignedCount} of ${totalCount} filled</span>
            </div>
          </div>
          <div class="subject-group-content">
            ${instancesHTML}
          </div>
        </div>
      `;
    });

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 24px 0 16px 0;">
        <div class="subjects-section-title" style="margin: 0; display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 700; color: #1f2937;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #6b7280;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
          All Subjects (${sortedSubjects.length})
        </div>
        <div class="filter-group" style="min-width: 200px; display: flex; align-items: center; gap: 8px;">
          <label style="margin: 0; white-space: nowrap; color: #6b7280; font-size: 14px;">Filter by Subject Code</label>
          <div style="position: relative; width: 100%;">
             <select id="subjectsViewSubjectFilter" style="width: 100%; padding: 8px 12px; padding-right: 32px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; appearance: none; font-size: 14px; color: #374151;">
              <option value="">All Subject Codes</option>
              ${Object.keys(subjectsByCode).sort().map(code => `<option value="${code}">${code}</option>`).join('')}
            </select>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); pointer-events: none; color: #9ca3af;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </div>
        </div>
      </div>
      
      <div class="subjects-assignment-list" style="display: flex; flex-direction: column; gap: 0;">
        ${groupedHTML}
      </div>
    `;

    // Add filter handler for subject code filter
    const subjectsViewFilter = container.querySelector('#subjectsViewSubjectFilter');
    if (subjectsViewFilter) {
      subjectsViewFilter.addEventListener('change', function() {
        const selectedCode = this.value;
        const allGroups = container.querySelectorAll('.subject-group');
        
        allGroups.forEach(group => {
          const groupCode = group.querySelector('.group-code')?.textContent || '';
          if (!selectedCode || groupCode === selectedCode) {
            group.style.display = 'block';
          } else {
            group.style.display = 'none';
          }
        });
      });
    }

    // Add collapse/expand handlers for subject groups
    const groupHeaders = container.querySelectorAll('.subject-group-header');
    groupHeaders.forEach(header => {
      header.addEventListener('click', function() {
        const group = this.closest('.subject-group');
        if (group) {
          group.classList.toggle('collapsed');
        }
      });
    });

    // Add change handlers to professor selects
    container.querySelectorAll('.professor-select').forEach(select => {
      select.addEventListener('change', async function() {
        const subjectCode = this.getAttribute('data-subject-code');
        const templateId = parseInt(this.getAttribute('data-template-id'));
        const professorId = this.value;

        if (!professorId) {
          showToast('Please select a professor', 'warning');
          return;
        }

        try {
          // Find the subject index in the original schedule
          const schedule = loadedSchedules.find(s => s.template_id === templateId);
          if (!schedule) throw new Error('Schedule not found');

          const subjectIndex = (schedule.subjects || []).findIndex(s => s.subject_code === subjectCode);
          if (subjectIndex === -1) throw new Error('Subject not found');

          const response = await fetch(`${API_BASE}/${templateId}/assign-professor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subject_index: subjectIndex,
              professor_id: parseInt(professorId)
            })
          });

          if (!response.ok) throw new Error('Failed to assign professor');

          showToast('Professor assigned successfully', 'success');
        } catch (error) {
          console.error('Error assigning professor:', error);
          showToast('Error assigning professor: ' + error.message, 'error');
          this.value = '';
        }
      });
    });

  } catch (error) {
    console.error('Error loading subjects view:', error);
    container.innerHTML = `<div class="error-message">Error loading subjects: ${error.message}</div>`;
  }
}

/**
 * Open professor assignment modal for a single subject
 */
async function openProfessorAssignmentModal(subject, subjectIndex, templateId, professors) {
  // This function is no longer used - assignments are now inline via dropdown
  return;
}

// Helper function to show toast

function showToast(message, type = 'info') {
  if (window.showToast) {
    window.showToast(message, type);
  } else {
    alert(message);
  }
}

// Helper function to get profile
function getProfile() {
  if (window.getProfile) return window.getProfile();
  return null;
}

export { initCurriculum, loadCurriculumSchedules };