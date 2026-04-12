/**
 * curriculum.js
 * Department Head - Assign Professors to Subjects in Curriculum
 */

import { fetchHeadInfo } from './utils.js';

const API_BASE = '/api/curriculum';
const DEPARTMENT_HEAD_API = '/api/department-head';

let loadedSchedules = [];
let currentDepartmentId = null;
let curriculumSubjectBrowserState = {
  search: '',
  status: 'all',
  selectedCode: null,
  page: 1,
  pageSize: 10,
  gliderFromStatus: null
};
let curriculumSubjectViewData = {
  groups: [],
  map: {},
  professors: []
};
let curriculumSubjectViewRequestId = 0;
let curriculumSubjectBrowserGliderResizeBound = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDaysLabel(days) {
  if (Array.isArray(days)) {
    return days.length > 0 ? days.join(', ') : '-';
  }

  return days || '-';
}

function getSubjectStatusMeta(group) {
  if (!group) {
    return {
      label: 'No subject selected',
      tone: 'neutral',
      description: 'Choose a subject from the left panel.'
    };
  }

  if (group.pendingCount === 0) {
    return {
      label: 'All instances assigned',
      tone: 'complete',
      description: 'All class instances already have professors assigned.'
    };
  }

  if (group.assignedCount === 0) {
    return {
      label: 'Needs action',
      tone: 'warning',
      description: `${group.pendingCount} class instance${group.pendingCount === 1 ? '' : 's'} still need assignments.`
    };
  }

  return {
    label: `${group.pendingCount} Instance${group.pendingCount === 1 ? '' : 's'} needs attention`,
    tone: 'warning',
    description: `${group.assignedCount} assigned and ${group.pendingCount} pending.`
  };
}

function buildSubjectGroups(subjects) {
  const map = {};

  subjects.forEach((subject, actualIndex) => {
    const code = subject.subject_code || 'Unknown';

    if (!map[code]) {
      map[code] = {
        code,
        name: subject.subject_name || code,
        instances: []
      };
    }

    map[code].instances.push({
      ...subject,
      actualIndex
    });
  });

  const groups = Object.values(map)
    .map(group => {
      const instances = sortSubjectsByTime(group.instances);
      const assignedCount = instances.filter(instance => instance.assigned_professor_id).length;
      const totalCount = instances.length;

      return {
        ...group,
        instances,
        totalCount,
        assignedCount,
        pendingCount: totalCount - assignedCount,
        status: totalCount === 0 || assignedCount === totalCount ? 'complete' : 'needs-action'
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const groupMap = groups.reduce((accumulator, group) => {
    accumulator[group.code] = group;
    return accumulator;
  }, {});

  return { groups, map: groupMap };
}

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
  try {
    // Fetch department info for the current user
    const headInfo = await fetchHeadInfo();

    if (headInfo?.dept_id) {
      currentDepartmentId = headInfo.dept_id;
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

  // Load initial view based on dropdown selection
  const viewToggle = document.getElementById('viewToggle');
  const gridContainer = document.getElementById('curriculumSchedulesGrid');
  const subjectsContainer = document.getElementById('curriculumSubjectsView');

  if (viewToggle?.value === 'section') {
    if (gridContainer) gridContainer.style.display = '';
    if (subjectsContainer) subjectsContainer.style.display = 'none';
    loadCurriculumSchedules();
  } else {
    if (gridContainer) gridContainer.style.display = 'none';
    if (subjectsContainer) subjectsContainer.style.display = '';
    loadSubjectsView();
  }
}

function setupEventListeners() {
  const section = document.getElementById('section-curriculum');
  if (!section) return;

  const filterHandler = () => {
    const tabs = section.querySelectorAll('.curriculum-suite-tab');
    const activeTab = Array.from(tabs).find(tab => tab.classList.contains('active'));
    const currentView = activeTab?.getAttribute('data-view') || 'subject';
    
    if (currentView === 'section') {
      loadCurriculumSchedules();
    } else {
      loadSubjectsView();
    }
  };

  document.getElementById('curriculumFilterLevel')?.addEventListener('change', filterHandler);
  document.getElementById('curriculumFilterTerm')?.addEventListener('change', filterHandler);
  document.getElementById('curriculumFilterYear')?.addEventListener('change', filterHandler);

  // Tab buttons view toggle
  section.querySelectorAll('.curriculum-suite-tab').forEach(button => {
    button.addEventListener('click', function() {
      // Update active tab
      section.querySelectorAll('.curriculum-suite-tab').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      });
      this.classList.add('active');
      this.setAttribute('aria-selected', 'true');
      
      // Update hidden attribute on original dropdown
      const originalViewToggle = document.getElementById('viewToggle');
      const view = this.getAttribute('data-view');
      if (originalViewToggle) {
        originalViewToggle.value = view;
      }

      if (view === 'section') {
        const gridContainer = document.getElementById('curriculumSchedulesGrid');
        const subjectsContainer = document.getElementById('curriculumSubjectsView');

        if (gridContainer) gridContainer.style.display = '';
        if (subjectsContainer) subjectsContainer.style.display = 'none';
        loadCurriculumSchedules();
      } else {
        const gridContainer = document.getElementById('curriculumSchedulesGrid');
        const subjectsContainer = document.getElementById('curriculumSubjectsView');

        if (gridContainer) gridContainer.style.display = 'none';
        if (subjectsContainer) subjectsContainer.style.display = '';
        loadSubjectsView();
      }
    });
  });
}

/**
 * Update the summary card with current assignment statistics
 */
function updateSummaryCard() {
  const totalSubjectsStat = document.getElementById('summaryTotalSubjects');
  const assignedStat = document.getElementById('summaryAssigned');
  const pendingStat = document.getElementById('summaryPending');
  const percentStat = document.getElementById('summaryPercent');

  if (!loadedSchedules || loadedSchedules.length === 0) {
    if (totalSubjectsStat) totalSubjectsStat.textContent = '0';
    if (assignedStat) assignedStat.textContent = '0';
    if (pendingStat) pendingStat.textContent = '0';
    if (percentStat) percentStat.textContent = '0%';
    return;
  }

  // Calculate statistics across all loaded schedules
  let totalSubjects = 0;
  let assignedCount = 0;

  loadedSchedules.forEach(schedule => {
    const subjects = schedule.subjects || [];
    totalSubjects += subjects.length;
    assignedCount += subjects.filter(s => s.assigned_professor_id).length;
  });

  const pendingCount = totalSubjects - assignedCount;
  const percentage = totalSubjects > 0 ? Math.round((assignedCount / totalSubjects) * 100) : 0;

  // Update DOM
  if (totalSubjectsStat) totalSubjectsStat.textContent = totalSubjects;
  if (assignedStat) assignedStat.textContent = assignedCount;
  if (pendingStat) pendingStat.textContent = pendingCount;
  if (percentStat) percentStat.textContent = percentage + '%';
}

function setCurriculumWorkspaceMode(view) {
  const workspace = document.getElementById('section-curriculum')?.querySelector('.attendance-tab-content');
  const detailLayout = document.getElementById('curriculumSubjectDetailLayout');

  if (!workspace) return;

  if (view === 'section') {
    workspace.style.gridTemplateColumns = 'minmax(0, 1fr)';
    if (detailLayout) {
      detailLayout.hidden = true;
      detailLayout.style.setProperty('display', 'none', 'important');
      detailLayout.setAttribute('aria-hidden', 'true');
    }
  } else {
    workspace.style.gridTemplateColumns = '22rem minmax(0, 1fr)';
    if (detailLayout) {
      detailLayout.hidden = false;
      detailLayout.style.removeProperty('display');
      detailLayout.setAttribute('aria-hidden', 'false');
    }
  }
}

/**
 * Load schedules for current department with filters
 */
async function loadCurriculumSchedules() {
  const container = document.getElementById('curriculumSchedulesGrid');
  const emptyState = document.getElementById('curriculumEmpty');

  if (!container) return;

  setCurriculumWorkspaceMode('section');

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

    const response = await fetch(`${API_BASE}?${params.toString()}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to fetch schedules');
    }

    const result = await response.json();
    loadedSchedules = result.data || [];

    container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'none';

    if (loadedSchedules.length === 0) {
      console.warn('[loadCurriculumSchedules] No schedules found for department:', currentDepartmentId);
      if (emptyState) emptyState.style.display = 'flex';
      container.innerHTML = '';
      return;
    }

    renderCurriculumCards(loadedSchedules);
    updateSummaryCard();
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
  'Thursday': 3, 'Th': 3, 'TH': 3, 'TR': 3,
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
 * Group subjects by: subject_code + start_time + end_time + days_of_week
 * This merges multiple sections of the same class at the same time
 * @param {Array} subjects - Array of subject objects
 * @returns {Array} Array of grouped subject objects with combined sections and original indices
 */
function groupSubjectsByTimeAndDays(subjects) {
  if (!subjects || subjects.length === 0) return [];

  const grouped = {};
  
  subjects.forEach((subject, index) => {
    // Normalize days_of_week to string for consistent key creation
    const daysStr = Array.isArray(subject.days_of_week) 
      ? subject.days_of_week.join(',') 
      : (subject.days_of_week || '');
    
    // Normalize times to ensure consistency (remove seconds if present)
    const startTime = subject.start_time ? subject.start_time.substring(0, 5) : '';
    const endTime = subject.end_time ? subject.end_time.substring(0, 5) : '';
    
    // Create unique key for grouping
    const key = `${subject.subject_code}|${startTime}|${endTime}|${daysStr}`;
    
    if (!grouped[key]) {
      grouped[key] = {
        subject_code: subject.subject_code,
        subject_name: subject.subject_name,
        start_time: subject.start_time,
        end_time: subject.end_time,
        days_of_week: subject.days_of_week,
        room_name: subject.room_name,
        sections: [],
        originalIndices: [],
        assigned_professor_id: subject.assigned_professor_id // Take from first entry
      };
    }
    
    // Add section and original index
    if (subject.section_name && !grouped[key].sections.includes(subject.section_name)) {
      grouped[key].sections.push(subject.section_name);
    }
    grouped[key].originalIndices.push(index);
  });
  
  const result = Object.values(grouped);

  
  return result;
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

  // Sort subjects chronologically before grouping
  const sortedSubjects = sortSubjectsByTime(schedule.subjects || []);
  
  // Group subjects by time, days, and subject code
  const groupedSubjects = groupSubjectsByTimeAndDays(sortedSubjects);

  const subjectsHTML = groupedSubjects.map((group) => {
    // Store original indices as JSON for bulk assignment
    const indicesJson = JSON.stringify(group.originalIndices);
    
    return `
      <div class="subject-row-entry ${!group.assigned_professor_id ? 'unassigned' : 'assigned'}" data-original-indices='${indicesJson}' data-template-id="${schedule.template_id}">
        ${!group.assigned_professor_id ? '<div class="unassigned-badge">⚠️ Unassigned</div>' : ''}
        <div class="col-code">${group.subject_code}</div>
        <div class="col-name">${group.subject_name}</div>
        <div class="col-days">${Array.isArray(group.days_of_week) ? group.days_of_week.join(',') : group.days_of_week}</div>
        <div class="col-time">${convertTo12Hour(group.start_time)} - ${convertTo12Hour(group.end_time)}</div>
        <div class="col-room">${group.room_name || '-'}</div>
        <div class="col-sections">${group.sections.join(', ')}</div>
        <div class="col-professor">
          <select class="professor-select" data-original-indices='${indicesJson}' data-template-id="${schedule.template_id}">
            <option value="">-- Unassigned --</option>
            ${professors.map(prof => `
              <option value="${prof.user_id}" ${group.assigned_professor_id === prof.user_id ? 'selected' : ''}>
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
            <div>Sections</div>
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

  // Add change handlers to professor selects (supports bulk assignment for grouped subjects)
  document.querySelectorAll('.professor-select').forEach(select => {
    select.addEventListener('change', async function() {
      const indicesJson = this.getAttribute('data-original-indices');
      const templateId = parseInt(this.getAttribute('data-template-id'));
      const professorId = this.value;

      if (!professorId) {
        showToast('Please select a professor', 'warning');
        return;
      }

      try {
        const originalIndices = JSON.parse(indicesJson);
        
        // If multiple sections (grouped), use bulk assignment
        if (originalIndices.length > 1) {
          const assignments = originalIndices.map(index => ({
            subject_index: index,
            professor_id: parseInt(professorId)
          }));
          
          const response = await fetch(`${API_BASE}/${templateId}/assign-professors-bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignments })
          });

          if (!response.ok) throw new Error('Failed to assign professor to sections');
        } else {
          // Single assignment for single subject
          const response = await fetch(`${API_BASE}/${templateId}/assign-professor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subject_index: originalIndices[0],
              professor_id: parseInt(professorId)
            })
          });

          if (!response.ok) throw new Error('Failed to assign professor');
        }

        // Show success modal instead of toast
        if (window.showSuccessModal) {
          window.showSuccessModal('Professor Assigned Successfully', 'The professor has been assigned to the subject.');
        } else {
          showToast('Professor assigned successfully', 'success');
        }
        
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
    const response = await fetch(`${DEPARTMENT_HEAD_API}/professors?dept_id=${currentDepartmentId}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[DeptHead] Professor fetch error:', response.status, errorData);
      throw new Error(errorData.message || `Failed to fetch professors (${response.status})`);
    }

    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching professors:', error);
    showToast('Failed to load professors list: ' + error.message, 'error');
    return [];
  }
}

function getSelectedSubjectGroup() {
  if (curriculumSubjectBrowserState.selectedCode && curriculumSubjectViewData.map[curriculumSubjectBrowserState.selectedCode]) {
    return curriculumSubjectViewData.map[curriculumSubjectBrowserState.selectedCode];
  }

  return curriculumSubjectViewData.groups[0] || null;
}

function getVisibleSubjectGroups() {
  const searchTerm = curriculumSubjectBrowserState.search.trim().toLowerCase();
  const statusFilter = curriculumSubjectBrowserState.status;

  return (curriculumSubjectViewData.groups || []).filter(group => {
    const searchableText = [
      group.code,
      group.name,
      group.status,
      ...group.instances.map(instance => [
        instance.section_name,
        instance.room_name,
        formatDaysLabel(instance.days_of_week)
      ].join(' '))
    ].join(' ').toLowerCase();

    const matchesSearch = !searchTerm || searchableText.includes(searchTerm);
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'needs-action' && group.pendingCount > 0)
      || (statusFilter === 'complete' && group.pendingCount === 0);

    return matchesSearch && matchesStatus;
  });
}

function getSubjectPageForCode(groups, subjectCode) {
  if (!subjectCode) return 1;

  const pageSize = curriculumSubjectBrowserState.pageSize || 10;
  const subjectIndex = (groups || []).findIndex(group => group.code === subjectCode);

  if (subjectIndex < 0) {
    return 1;
  }

  return Math.floor(subjectIndex / pageSize) + 1;
}

function getPaginatedSubjectGroups(visibleGroups) {
  const pageSize = curriculumSubjectBrowserState.pageSize || 10;
  const totalItems = visibleGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(curriculumSubjectBrowserState.page || 1, 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageItems = visibleGroups.slice(startIndex, startIndex + pageSize);

  curriculumSubjectBrowserState.page = currentPage;

  return {
    currentPage,
    totalPages,
    totalItems,
    startIndex,
    endIndex: Math.min(startIndex + pageSize, totalItems),
    pageItems
  };
}

function syncCurriculumBrowserGlider(animateFromStatus = null) {
  const tabGroup = document.querySelector('#curriculumSubjectsView .curriculum-filter-pill-group');
  if (!tabGroup) return;

  const glider = tabGroup.querySelector('.curriculum-filter-glider');
  const activeTab = tabGroup.querySelector('.curriculum-filter-pill.is-active');

  if (!glider || !activeTab) return;

  const groupRect = tabGroup.getBoundingClientRect();
  const activeRect = activeTab.getBoundingClientRect();
  const groupStyles = window.getComputedStyle(tabGroup);
  const paddingLeft = parseFloat(groupStyles.paddingLeft) || 0;
  const activeStatus = activeTab.getAttribute('data-status-filter') || 'all';
  const startStatus = animateFromStatus || curriculumSubjectBrowserState.gliderFromStatus || activeStatus;
  const startTab = tabGroup.querySelector(`[data-status-filter="${startStatus}"]`);
  const startRect = startTab ? startTab.getBoundingClientRect() : null;

  const toX = rect => rect.left - groupRect.left - paddingLeft;

  if (startRect && startStatus !== activeStatus) {
    glider.style.transition = 'none';
    glider.style.transform = `translateX(${toX(startRect)}px)`;
    glider.offsetHeight;

    requestAnimationFrame(() => {
      glider.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
      glider.style.transform = `translateX(${toX(activeRect)}px)`;
    });
  } else {
    glider.style.transition = 'none';
    glider.style.transform = `translateX(${toX(activeRect)}px)`;
  }

  curriculumSubjectBrowserState.gliderFromStatus = null;
}

function ensureCurriculumBrowserGliderResizeBinding() {
  if (curriculumSubjectBrowserGliderResizeBound) return;

  curriculumSubjectBrowserGliderResizeBound = true;
  window.addEventListener('resize', () => {
    window.requestAnimationFrame(syncCurriculumBrowserGlider);
  });
}

function renderCurriculumSubjectBrowser() {
  const container = document.getElementById('curriculumSubjectsView');
  if (!container) return;

  const groups = curriculumSubjectViewData.groups || [];
  const visibleGroups = getVisibleSubjectGroups();
  const selectedCode = curriculumSubjectBrowserState.selectedCode;
  const pagination = getPaginatedSubjectGroups(visibleGroups);
  const pageGroups = pagination.pageItems;

  const tabMarkup = [
    { id: 'all', label: 'All' },
    { id: 'needs-action', label: 'Needs Action' },
    { id: 'complete', label: 'Complete' }
  ].map(chip => `
    <button type="button" class="curriculum-filter-pill ${curriculumSubjectBrowserState.status === chip.id ? 'is-active' : ''}" data-status-filter="${chip.id}" role="tab" aria-selected="${curriculumSubjectBrowserState.status === chip.id}">
      <span>${escapeHtml(chip.label)}</span>
    </button>
  `).join('');

  const browserCards = pageGroups.length > 0
    ? pageGroups.map(group => {
        const isActive = selectedCode === group.code;
        const countLabel = `${group.assignedCount}/${group.totalCount}`;
        const countTone = group.pendingCount === 0 ? 'is-complete' : 'is-warning';

        return `
          <button type="button" class="curriculum-subject-card ${isActive ? 'is-active' : ''}" data-subject-code="${escapeHtml(group.code)}">
            <div class="curriculum-subject-card-top">
              <div class="curriculum-subject-card-copy">
                <div class="curriculum-subject-card-code">${escapeHtml(group.code)}</div>
                <div class="curriculum-subject-card-name">${escapeHtml(group.name)}</div>
              </div>
              <span class="curriculum-subject-card-count ${countTone}">${escapeHtml(countLabel)}</span>
            </div>
          </button>
        `;
      }).join('')
    : `
      <div class="curriculum-browser-empty">
        <div class="curriculum-browser-empty-title">No subjects match your filters.</div>
        <p class="curriculum-browser-empty-desc">Try a different search term or switch back to All.</p>
        <button type="button" class="curriculum-browser-empty-action" onclick="window.clearCurriculumFilters()">Show all subjects</button>
      </div>
    `;

  const paginationMarkup = pagination.totalItems > 0 && pagination.totalPages > 1
    ? `
      <div class="curriculum-browser-pagination" aria-label="Subject pagination">
        <button type="button" class="curriculum-browser-page-button" data-page-action="prev" aria-label="Previous page" ${pagination.currentPage === 1 ? 'disabled' : ''}>
          Prev
        </button>
        <div class="curriculum-browser-pagination-info">
          <span>Page ${pagination.currentPage} of ${pagination.totalPages}</span>
          <span>${pagination.startIndex + 1}-${pagination.endIndex} of ${pagination.totalItems}</span>
        </div>
        <button type="button" class="curriculum-browser-page-button" data-page-action="next" aria-label="Next page" ${pagination.currentPage === pagination.totalPages ? 'disabled' : ''}>
          Next
        </button>
      </div>
    `
    : '';

  container.innerHTML = `
    <div class="curriculum-subject-browser">
      <div class="curriculum-browser-toolbar">
        <div class="curriculum-browser-search">
          <svg class="curriculum-browser-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
          <input id="curriculumSubjectSearch" type="search" value="${escapeHtml(curriculumSubjectBrowserState.search)}" placeholder="Search subject code or name..." autocomplete="off" />
        </div>
        <div class="curriculum-filter-pill-group" role="tablist" aria-label="Subject assignment filters">
          <div class="curriculum-filter-glider" aria-hidden="true"></div>
          ${tabMarkup}
        </div>
      </div>

      <div class="curriculum-subject-card-list">
        ${browserCards}
      </div>

      ${paginationMarkup}
    </div>
  `;

  bindCurriculumSubjectBrowserEvents();
  ensureCurriculumBrowserGliderResizeBinding();
  window.requestAnimationFrame(() => syncCurriculumBrowserGlider(curriculumSubjectBrowserState.gliderFromStatus));
}

function renderCurriculumSubjectDetail() {
  const container = document.getElementById('curriculumSubjectDetailView');
  if (!container) return;

  const card = document.getElementById('curriculumSubjectDetailCard');
  const headerTitle = document.getElementById('curriculumSelectedSubjectTitle');
  const headerDesc = document.getElementById('curriculumSelectedSubjectDesc');
  const headerStatus = document.getElementById('curriculumSelectedSubjectStatus');
  const professorSelect = document.getElementById('curriculumSelectedProfessor');
  const applyButton = document.getElementById('curriculumSelectedBulkApply');

  let selectedGroup = getSelectedSubjectGroup();

  if (!selectedGroup) {
    if (headerTitle) {
      headerTitle.className = 'card-title curriculum-detail-title';
      headerTitle.textContent = 'Awaiting selection';
    }
    if (headerDesc) {
      headerDesc.className = 'card-description curriculum-detail-desc';
      headerDesc.textContent = 'Choose a subject from the list to inspect assignments and class instances.';
    }
    if (headerStatus) {
      headerStatus.textContent = 'No subject selected';
      headerStatus.className = 'curriculum-selected-status curriculum-selected-status--neutral';
    }

    if (professorSelect) {
      professorSelect.innerHTML = '<option value="">-- Select Professor --</option>';
      professorSelect.disabled = true;
    }
    if (applyButton) {
      applyButton.disabled = true;
      applyButton.textContent = 'Apply';
    }

    container.innerHTML = `
      <div class="card-header curriculum-instance-header">
        <div>
          <h4 class="card-title curriculum-instance-title">Class Instances</h4>
        </div>
        <span class="curriculum-instance-count">Total: -- Sections</span>
      </div>
      <div class="card-content curriculum-instance-content" style="margin-top: 0;">
        <div class="curriculum-instance-scroll">
          <table class="data-table curriculum-instance-table" style="margin-bottom: 0;">
            <thead>
              <tr>
                <th>Schedule</th>
                <th>Time</th>
                <th>Room</th>
                <th>Section</th>
                <th>Professor Assigned</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colspan="5" class="empty-state curriculum-instance-empty">Select a subject to view its class instances.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
    bindCurriculumSubjectDetailEvents();
    return;
  }

  curriculumSubjectBrowserState.selectedCode = selectedGroup.code;

  const statusMeta = getSubjectStatusMeta(selectedGroup);
  const professors = curriculumSubjectViewData.professors || [];
  const hasPending = selectedGroup.pendingCount > 0;
  const professorOptions = professors.length > 0
    ? professors.map(professor => {
        const professorId = String(professor.user_id);
        const professorName = professor.full_name || professor.name || `Professor ${professorId}`;

        return `<option value="${escapeHtml(professorId)}">${escapeHtml(professorName)}</option>`;
      }).join('')
    : '<option value="">No professors available</option>';

  if (headerTitle) {
    headerTitle.textContent = `${selectedGroup.code} - ${selectedGroup.name}`;
    headerTitle.className = 'card-title curriculum-detail-title';
  }
  if (headerDesc) {
    headerDesc.className = 'card-description curriculum-detail-desc';
    headerDesc.textContent = 'Manage assignments for this subject across all active sections.';
  }
  if (headerStatus) {
    headerStatus.textContent = statusMeta.label;
    headerStatus.className = `curriculum-selected-status curriculum-selected-status--${statusMeta.tone}`;
  }

  if (professorSelect) {
    professorSelect.innerHTML = `
      <option value="">-- Select Professor --</option>
      ${professorOptions}
    `;
    professorSelect.disabled = professors.length === 0 || !hasPending;
  }

  if (applyButton) {
    applyButton.textContent = 'Apply';
    applyButton.disabled = !hasPending || !professorSelect?.value;
  }

  const instanceRows = selectedGroup.instances.length > 0
    ? selectedGroup.instances.map(instance => {
        const assignedProfessorId = instance.assigned_professor_id != null ? String(instance.assigned_professor_id) : '';
        const rowClass = assignedProfessorId ? 'assigned' : 'unassigned';
        const professorSelectOptions = [`<option value="">-- Unassigned --</option>`]
          .concat(professors.map(professor => {
            const professorId = String(professor.user_id);
            const professorName = professor.full_name || professor.name || `Professor ${professorId}`;
            const selected = assignedProfessorId === professorId ? 'selected' : '';

            return `<option value="${escapeHtml(professorId)}" ${selected}>${escapeHtml(professorName)}</option>`;
          }))
          .join('');

        return `
          <tr class="curriculum-instance-row ${rowClass}" data-row-state="${rowClass}">
            <td>${escapeHtml(formatDaysLabel(instance.days_of_week))}</td>
            <td>${escapeHtml(convertTo12Hour(instance.start_time))} - ${escapeHtml(convertTo12Hour(instance.end_time))}</td>
            <td>${escapeHtml(instance.room_name || '-')}</td>
            <td><span class="curriculum-section-pill">${escapeHtml(instance.section_name || '-')}</span></td>
            <td>
              <select class="curriculum-instance-select" data-template-id="${escapeHtml(instance.template_id)}" data-subject-index="${escapeHtml(instance.template_index)}">
                ${professorSelectOptions}
              </select>
            </td>
          </tr>
        `;
      }).join('')
    : `
      <tr>
        <td colspan="5" class="empty-state curriculum-instance-empty">No class instances found for this subject.</td>
      </tr>
    `;

  container.innerHTML = `
    <div class="card-header curriculum-instance-header">
      <div>
        <h4 class="card-title curriculum-instance-title">Class Instances</h4>
      </div>
      <span class="curriculum-instance-count">Total: ${selectedGroup.totalCount} Sections</span>
    </div>
    <div class="card-content curriculum-instance-content" style="margin-top: 0;">
      <div class="curriculum-instance-scroll">
        <table class="data-table curriculum-instance-table">
          <thead>
            <tr>
              <th>Schedule</th>
              <th>Time</th>
              <th>Room</th>
              <th>Section</th>
              <th>Professor Assigned</th>
            </tr>
          </thead>
          <tbody id="curriculumSelectedInstancesBody">
            ${instanceRows}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (card) {
    card.dataset.pendingCount = String(selectedGroup.pendingCount);
  }

  bindCurriculumSubjectDetailEvents();
}

function bindCurriculumSubjectBrowserEvents() {
  const container = document.getElementById('curriculumSubjectsView');
  if (!container || container.dataset.curriculumBound === 'true') return;

  container.dataset.curriculumBound = 'true';

  container.addEventListener('input', event => {
    if (event.target && event.target.id === 'curriculumSubjectSearch') {
      const selectionStart = event.target.selectionStart;
      const selectionEnd = event.target.selectionEnd;
      curriculumSubjectBrowserState.search = event.target.value;
      curriculumSubjectBrowserState.page = 1;
      renderCurriculumSubjectBrowser();

      const nextSearch = document.getElementById('curriculumSubjectSearch');
      if (nextSearch) {
        nextSearch.focus({ preventScroll: true });
        if (typeof selectionStart === 'number' && typeof selectionEnd === 'number' && nextSearch.setSelectionRange) {
          nextSearch.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }
  });

  container.addEventListener('click', event => {
    const pageButton = event.target.closest('[data-page-action]');
    if (pageButton && container.contains(pageButton)) {
      const action = pageButton.getAttribute('data-page-action');
      const visibleGroups = getVisibleSubjectGroups();
      const pagination = getPaginatedSubjectGroups(visibleGroups);

      if (action === 'prev') {
        curriculumSubjectBrowserState.page = Math.max(1, pagination.currentPage - 1);
      } else if (action === 'next') {
        curriculumSubjectBrowserState.page = Math.min(pagination.totalPages, pagination.currentPage + 1);
      }

      renderCurriculumSubjectBrowser();
      return;
    }

    const filterButton = event.target.closest('[data-status-filter]');
    if (filterButton && container.contains(filterButton)) {
      const nextStatus = filterButton.getAttribute('data-status-filter') || 'all';
      if (nextStatus !== curriculumSubjectBrowserState.status) {
        curriculumSubjectBrowserState.gliderFromStatus = curriculumSubjectBrowserState.status;
      }
      curriculumSubjectBrowserState.status = nextStatus;
      curriculumSubjectBrowserState.page = 1;
      renderCurriculumSubjectBrowser();
      return;
    }

    const subjectCard = event.target.closest('[data-subject-code]');
    if (subjectCard && container.contains(subjectCard)) {
      curriculumSubjectBrowserState.selectedCode = subjectCard.getAttribute('data-subject-code');
      renderCurriculumSubjectBrowser();
      renderCurriculumSubjectDetail();
    }
  });
}

function updateCurriculumBulkButtonState() {
  const selectedGroup = getSelectedSubjectGroup();
  const professorSelect = document.getElementById('curriculumSelectedProfessor');
  const applyButton = document.getElementById('curriculumSelectedBulkApply');

  if (!professorSelect || !applyButton) return;

  const hasPending = Boolean(selectedGroup && selectedGroup.pendingCount > 0);
  applyButton.disabled = !hasPending || !professorSelect.value;
}

async function assignCurriculumSubjectInstances(assignments, successTitle, successMessage, reloadDelay = 0) {
  const response = await fetch(`${API_BASE}/assign-professors-bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments })
  });

  if (!response.ok) {
    throw new Error('Failed to assign professor');
  }

  if (successTitle && successMessage && window.showSuccessModal) {
    window.showSuccessModal(successTitle, successMessage);
  } else {
    showToast(successMessage || 'Professor assigned successfully', 'success');
  }

  if (reloadDelay > 0) {
    setTimeout(() => {
      loadSubjectsView();
    }, reloadDelay);
  } else {
    await loadSubjectsView();
  }
}

function bindCurriculumSubjectDetailEvents() {
  const container = document.getElementById('curriculumSubjectDetailLayout');
  if (!container || container.dataset.curriculumBound === 'true') return;

  container.dataset.curriculumBound = 'true';

  container.addEventListener('change', async event => {
    if (event.target && event.target.id === 'curriculumSelectedProfessor') {
      updateCurriculumBulkButtonState();
      return;
    }

    const instanceSelect = event.target.closest('.curriculum-instance-select');
    if (!instanceSelect || !container.contains(instanceSelect)) {
      return;
    }

    const templateId = parseInt(instanceSelect.getAttribute('data-template-id'));
    const subjectIndex = parseInt(instanceSelect.getAttribute('data-subject-index'));
    const professorIdValue = instanceSelect.value;
    const professorId = professorIdValue ? parseInt(professorIdValue) : null;

    try {
      await assignCurriculumSubjectInstances([
        {
          template_id: templateId,
          subject_index: subjectIndex,
          professor_id: professorId
        }
      ], professorId ? 'Professor Assigned Successfully' : 'Professor Unassigned', professorId ? 'The professor has been assigned to the selected section.' : 'The selected section has been cleared.');
    } catch (error) {
      console.error('Error assigning professor:', error);
      showToast('Error assigning professor: ' + error.message, 'error');
      instanceSelect.value = '';
    }
  });

  container.addEventListener('click', async event => {
    const applyButton = event.target.closest('#curriculumSelectedBulkApply');
    if (!applyButton || !container.contains(applyButton)) {
      return;
    }

    const selectedGroup = getSelectedSubjectGroup();
    const professorSelect = document.getElementById('curriculumSelectedProfessor');
    const professorIdValue = professorSelect?.value || '';

    if (!selectedGroup || selectedGroup.pendingCount === 0) {
      showToast('No pending instances to assign', 'warning');
      return;
    }

    if (!professorIdValue) {
      showToast('Please select a professor', 'warning');
      return;
    }

    const professorId = parseInt(professorIdValue);
    const professorName = curriculumSubjectViewData.professors.find(professor => String(professor.user_id) === String(professorId))?.full_name || 'Selected professor';
    const assignments = selectedGroup.instances
      .filter(instance => !instance.assigned_professor_id)
      .map(instance => ({
        template_id: instance.template_id,
        subject_index: instance.template_index,
        professor_id: professorId
      }));

    if (assignments.length === 0) {
      showToast('All instances are already assigned', 'info');
      return;
    }

    applyButton.disabled = true;
    applyButton.classList.add('is-loading');

    try {
      await assignCurriculumSubjectInstances(
        assignments,
        'Professor Assigned Successfully',
        `Assigned ${professorName} to ${assignments.length} pending instance${assignments.length === 1 ? '' : 's'}.`
      );
    } catch (error) {
      console.error('Error assigning professor:', error);
      showToast('Error assigning professor: ' + error.message, 'error');
    } finally {
      applyButton.disabled = false;
      applyButton.classList.remove('is-loading');
    }
  });
}

/**
 * Load and display all subjects from schedules in a searchable master-detail layout
 */
async function loadSubjectsView() {
  const browserContainer = document.getElementById('curriculumSubjectsView');
  const detailContainer = document.getElementById('curriculumSubjectDetailView');
  if (!browserContainer || !detailContainer) return;

  const requestId = ++curriculumSubjectViewRequestId;

  setCurriculumWorkspaceMode('subject');

  browserContainer.innerHTML = '<div class="loading-spinner"></div>';
  detailContainer.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const yearLevel = document.getElementById('curriculumFilterLevel')?.value || '';
    const term = document.getElementById('curriculumFilterTerm')?.value || '';
    const schoolYear = document.getElementById('curriculumFilterYear')?.value || '';

    const params = new URLSearchParams();
    params.append('dept_id', currentDepartmentId);
    if (yearLevel) params.append('year_level', yearLevel);
    if (term) params.append('term', term);
    if (schoolYear) params.append('school_year', schoolYear);

    const response = await fetch(`${API_BASE}?${params.toString()}`);
    if (!response.ok) {
      throw new Error('Failed to fetch updated schedules');
    }

    const result = await response.json();
    loadedSchedules = result.data || [];

    if (requestId !== curriculumSubjectViewRequestId) {
      return;
    }

    const emptyState = document.getElementById('curriculumEmpty');
    if (emptyState) emptyState.style.display = 'none';

    const allSubjects = [];
    loadedSchedules.forEach(schedule => {
      if (
        (!yearLevel || schedule.year_level == yearLevel) &&
        (!term || schedule.term === term) &&
        (!schoolYear || schedule.school_year === schoolYear)
      ) {
        (schedule.subjects || []).forEach((subject, templateIndex) => {
          allSubjects.push({
            ...subject,
            section_name: schedule.section_name,
            year_level: schedule.year_level,
            term: schedule.term,
            school_year: schedule.school_year,
            template_id: schedule.template_id,
            template_index: templateIndex
          });
        });
      }
    });

    const professors = await fetchDepartmentProfessors();

    if (requestId !== curriculumSubjectViewRequestId) {
      return;
    }

    if (allSubjects.length === 0) {
      curriculumSubjectViewData = { groups: [], map: {}, professors };
      window.subjectsByCodeData = {};

      browserContainer.innerHTML = `
        <div class="curriculum-subject-browser">
          <div class="curriculum-browser-empty curriculum-browser-empty--full">
            <div class="curriculum-browser-empty-title">No subjects found</div>
            <p class="curriculum-browser-empty-desc">No subjects match the selected filters.</p>
            <button type="button" class="curriculum-filter-pill is-active" onclick="clearCurriculumFilters()">Clear all filters</button>
          </div>
        </div>
      `;
      detailContainer.innerHTML = `
        <div class="curriculum-detail-empty">
          <p class="curriculum-detail-kicker">Selected subject</p>
          <h3 class="curriculum-detail-empty-title">No subject selected</h3>
          <p class="curriculum-detail-empty-desc">Select a subject once schedules are available.</p>
        </div>
      `;

      updateSummaryCard();
      return;
    }

    const sortedSubjects = sortSubjectsByTime(allSubjects);
    const groupedData = buildSubjectGroups(sortedSubjects);

    curriculumSubjectViewData = {
      groups: groupedData.groups,
      map: groupedData.map,
      professors
    };
    window.subjectsByCodeData = groupedData.map;

    if (!curriculumSubjectBrowserState.selectedCode || !groupedData.map[curriculumSubjectBrowserState.selectedCode]) {
      curriculumSubjectBrowserState.selectedCode = groupedData.groups[0]?.code || null;
    }

    curriculumSubjectBrowserState.page = getSubjectPageForCode(groupedData.groups, curriculumSubjectBrowserState.selectedCode);

    renderCurriculumSubjectBrowser();
    renderCurriculumSubjectDetail();
    updateSummaryCard();
  } catch (error) {
    console.error('Error loading subjects view:', error);
    browserContainer.innerHTML = `<div class="error-message">Error loading subjects: ${error.message}</div>`;
    detailContainer.innerHTML = `<div class="error-message">Error loading subjects: ${error.message}</div>`;
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

/**
 * Clear curriculum filters and reload
 */
window.clearCurriculumFilters = function () {
  const section = document.getElementById('section-curriculum');
  const levelSelect = document.getElementById('curriculumFilterLevel');
  const termSelect = document.getElementById('curriculumFilterTerm');
  const yearSelect = document.getElementById('curriculumFilterYear');
  const subjectSearch = section?.querySelector('#curriculumSubjectSearch');
  
  if (levelSelect) levelSelect.value = '';
  if (termSelect) termSelect.value = '';
  if (yearSelect) yearSelect.value = '';
  if (subjectSearch) subjectSearch.value = '';

  curriculumSubjectBrowserState.search = '';
  curriculumSubjectBrowserState.status = 'all';
  curriculumSubjectBrowserState.selectedCode = null;
  curriculumSubjectBrowserState.page = 1;
  curriculumSubjectBrowserState.gliderFromStatus = null;
  
  // Reload based on active tab
  const activeTab = Array.from(section?.querySelectorAll('.curriculum-suite-tab') || []).find(tab => tab.classList.contains('active'));
  const currentView = activeTab?.getAttribute('data-view') || 'subject';
  
  if (currentView === 'section') {
    loadCurriculumSchedules();
  } else {
    loadSubjectsView();
  }
};

export { initCurriculum, loadCurriculumSchedules };