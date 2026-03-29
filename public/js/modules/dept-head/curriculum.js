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
  if (viewToggle?.value === 'subject') {
    loadSubjectsView();
  } else {
    loadCurriculumSchedules();
  }
}

function setupEventListeners() {
  const filterHandler = () => {
    const tabs = document.querySelectorAll('.tab-button');
    const activeTab = Array.from(tabs).find(tab => tab.classList.contains('tab-active'));
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
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', function() {
      // Update active tab
      document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('tab-active');
      });
      this.classList.add('tab-active');
      
      // Update hidden attribute on original dropdown
      const originalViewToggle = document.getElementById('viewToggle');
      const view = this.getAttribute('data-view');
      if (originalViewToggle) {
        originalViewToggle.value = view;
      }

      const gridContainer = document.getElementById('curriculumSchedulesGrid');
      const subjectsContainer = document.getElementById('curriculumSubjectsView');
      
      if (view === 'section') {
        if (gridContainer) gridContainer.style.display = 'grid';
        if (subjectsContainer) subjectsContainer.style.display = 'none';
        loadCurriculumSchedules();
      } else {
        if (gridContainer) gridContainer.style.display = 'none';
        if (subjectsContainer) subjectsContainer.style.display = 'block';
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

    const response = await fetch(`${API_BASE}?${params.toString()}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to fetch schedules');
    }

    const result = await response.json();
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

/**
 * Load and display all subjects from schedules in a chronological list view
 */
async function loadSubjectsView() {
  const container = document.getElementById('curriculumSubjectsView');
  if (!container) return;

  try {
    // Re-fetch schedules from server to ensure we have latest data
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

    // Apply filters
    const filteredYearLevel = document.getElementById('curriculumFilterLevel')?.value || '';
    const filteredTerm = document.getElementById('curriculumFilterTerm')?.value || '';
    const filteredSchoolYear = document.getElementById('curriculumFilterYear')?.value || '';

    // Collect all subjects from all schedules with metadata
    const allSubjects = [];
    loadedSchedules.forEach(schedule => {
      if (
        (!filteredYearLevel || schedule.year_level == filteredYearLevel) &&
        (!filteredTerm || schedule.term === filteredTerm) &&
        (!filteredSchoolYear || schedule.school_year === filteredSchoolYear)
      ) {
        (schedule.subjects || []).forEach((subject, templateIndex) => {
            const enrichedSubject = {
              ...subject,
              section_name: schedule.section_name,
              year_level: schedule.year_level,
              term: schedule.term,
              school_year: schedule.school_year,
              template_id: schedule.template_id,
              template_index: templateIndex  // Add index within this template
            };
            allSubjects.push(enrichedSubject);
          });
      }
    });

    if (allSubjects.length === 0) {
      container.innerHTML = '<div class="empty-state" style="text-align: center; padding: 40px;"><h4>No subjects found</h4><p>No subjects match the selected filters.</p></div>';
      updateSummaryCard();
      return;
    }

    // Sort subjects chronologically
    const sortedSubjects = sortSubjectsByTime(allSubjects);

    // Fetch professors
    const professors = await fetchDepartmentProfessors();

    // Group subjects by subject code
    const subjectsByCode = {};
    sortedSubjects.forEach((subject, actualIndex) => {
      if (!subjectsByCode[subject.subject_code]) {
        subjectsByCode[subject.subject_code] = {
          code: subject.subject_code,
          name: subject.subject_name,
          instances: []
        };
      }
      // Create a clean copy with only the properties we need
      // Don't spread the subject to avoid overwriting properties across different instances
      const subjectWithIndex = {
        // Core subject data
        subject_code: subject.subject_code,
        subject_name: subject.subject_name,
        start_time: subject.start_time,
        end_time: subject.end_time,
        days_of_week: subject.days_of_week,
        room_name: subject.room_name,
        assigned_professor_id: subject.assigned_professor_id,
        // Template info
        template_id: subject.template_id,
        section_name: subject.section_name,
        year_level: subject.year_level,
        term: subject.term,
        school_year: subject.school_year,
        // Index info - CRITICAL: use the correct template-specific index, NOT actualIndex
        template_index: subject.template_index,
        templateIndex: subject.template_index,  // Store both for clarity
        actualIndex: actualIndex  // Global position for reference only
      };
      subjectsByCode[subject.subject_code].instances.push(subjectWithIndex);
    });

    // Sort codes alphabetically and render grouped subjects
    const sortedCodes = Object.keys(subjectsByCode).sort();
    let groupedHTML = '';

    sortedCodes.forEach(code => {
      const group = subjectsByCode[code];
      
      // Further group instances by time and days to merge same-time classes
      const instancesByTimeAndDays = {};
      group.instances.forEach((subject) => {
        const daysStr = Array.isArray(subject.days_of_week) 
          ? subject.days_of_week.join(',') 
          : (subject.days_of_week || '');
        const startTime = subject.start_time ? subject.start_time.substring(0, 5) : '';
        const endTime = subject.end_time ? subject.end_time.substring(0, 5) : '';
        const timeKey = `${startTime}|${endTime}|${daysStr}`;
        
        if (!instancesByTimeAndDays[timeKey]) {
          instancesByTimeAndDays[timeKey] = [];
        }
        // Use actualIndex from subject, which is the index in the full allSubjects array
        instancesByTimeAndDays[timeKey].push(subject);
      });
      
      // Render merged instances
      const instancesHTML = Object.entries(instancesByTimeAndDays).map(([timeKey, subjects]) => {
        const primary = subjects[0];
        const sections = subjects.map(s => s.section_name).join(', ');
        
        // Create assignment data: each subject with its template_id and subject_index
        const assignmentData = subjects.map(s => ({
          template_id: s.template_id,
          subject_index: s.templateIndex
        }));
        const assignmentDataJson = JSON.stringify(assignmentData);
        

        
        return `
          <div class="subject-row-entry ${!primary.assigned_professor_id ? 'unassigned' : 'assigned'}" data-subject-code="${primary.subject_code}">
            ${!primary.assigned_professor_id ? '<div class="unassigned-badge">⚠️ Unassigned</div>' : ''}
            <div class="col-days">${Array.isArray(primary.days_of_week) ? primary.days_of_week.join(',') : primary.days_of_week}</div>
            <div class="col-time">${convertTo12Hour(primary.start_time)} - ${convertTo12Hour(primary.end_time)}</div>
            <div class="col-room">${primary.room_name || '-'}</div>
            <div class="col-section">${sections}</div>
            <div class="col-professor">
              <select class="professor-select" data-subject-code="${primary.subject_code}" data-assignment-data="${assignmentDataJson.replace(/"/g, '&quot;')}">
                <option value="">-- Unassigned --</option>
                ${professors.map(prof => {
                  // Compare as numbers to handle type differences
                  const profId = parseInt(prof.user_id);
                  const assignedId = parseInt(primary.assigned_professor_id);
                  const isSelected = assignedId === profId && !isNaN(assignedId);
                  return `
                    <option value="${prof.user_id}" ${isSelected ? 'selected' : ''}>
                      ${prof.full_name}
                    </option>
                  `;
                }).join('')}
              </select>
            </div>
          </div>
        `;
      }).join('');
      
      // Count assigned professors (from primary/merged view)
      const assignedCount = Object.values(instancesByTimeAndDays).filter(subjects => subjects[0].assigned_professor_id).length;
      const totalCount = Object.values(instancesByTimeAndDays).length;
      
      // Append this subject group to groupedHTML
      groupedHTML += `
        <div class="subject-group">
          <div class="subject-group-header">
            <span class="group-code" style="font-weight: 700; color: #1f2937;">${group.code}</span>
            <span style="color: #6b7280; font-size: 14px;">${group.name}</span>
            <span style="margin-left: auto; color: #9ca3af; font-size: 13px;">${assignedCount}/${totalCount} assigned</span>
          </div>
          <div class="subject-group-content">
            ${instancesHTML}
          </div>
        </div>
      `;
    });

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-end; padding: 24px 0 16px 0; gap: 16px; flex-wrap: wrap;">
        <div class="subjects-section-title" style="margin: 0; display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 700;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
          All Subjects (${sortedSubjects.length})
        </div>
        <div style="display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap;">
          <button id="showUnassignedBtn" style="padding: 8px 16px; background-color: #f3f4f6; color: #374151; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; transition: all 0.2s; display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 14px;">📌</span>
            <span>Unassigned Only</span>
          </button>
          <div class="filter-group" style="display: flex; flex-direction: column; gap: 6px; min-width: 200px;">
            <label style="margin: 0; color: #6b7280; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Filter by Subject Code</label>
            <div style="position: relative; width: 100%;">
               <input id="subjectsViewSubjectFilter" type="text" placeholder="All Subject Codes" style="width: 100%; padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; font-size: 14px; color: #374151; transition: border-color 0.2s;" />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); pointer-events: none; color: #9ca3af;"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
            </div>
          </div>
        </div>
      </div>

      <div style="margin-bottom: 32px; padding: 20px; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
        <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #1f2937;">Assign Professor by Subject</h3>
        <div style="display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 200px;">
            <label style="display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500; color: #374151;">Select Subject Code</label>
            <select id="bulkAssignSubjectCode" style="width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; background: white; font-size: 14px; color: #374151;">
              <option value="">-- Choose Subject --</option>
              ${Object.keys(subjectsByCode).sort().map(code => `<option value="${code}">${code} - ${subjectsByCode[code].name}</option>`).join('')}
            </select>
          </div>
          <div style="flex: 1; min-width: 200px;">
            <label style="display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500; color: #374151;">Select Professor</label>
            <select id="bulkAssignProfessor" style="width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; background: white; font-size: 14px; color: #374151;">
              <option value="">-- Unassign All --</option>
              ${professors.map(prof => `<option value="${prof.user_id}">${prof.full_name}</option>`).join('')}
            </select>
          </div>
          <button id="bulkAssignButton" style="padding: 10px 20px; background-color: #3b82f6; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; white-space: nowrap; transition: background-color 0.2s;">Assign to All Instances</button>
        </div>
        <div id="bulkAssignMessage" style="margin-top: 8px; font-size: 13px; color: #6b7280;"></div>
      </div>
      
      <div class="subjects-assignment-list" style="display: flex; flex-direction: column; gap: 0;">
        ${groupedHTML}
      </div>
    `;

    // Store subjectsByCode for bulk assignment access
    window.subjectsByCodeData = subjectsByCode;

    // Add bulk assignment handler
    const bulkAssignButton = document.getElementById('bulkAssignButton');
    if (bulkAssignButton) {
      bulkAssignButton.addEventListener('click', async function() {
        const subjectCode = document.getElementById('bulkAssignSubjectCode')?.value;
        const professorIdValue = document.getElementById('bulkAssignProfessor')?.value;
        const professorId = professorIdValue ? parseInt(professorIdValue) : null;
        const messageDiv = document.getElementById('bulkAssignMessage');
        
        if (!subjectCode) {
          messageDiv.textContent = '❌ Please select a subject code';
          messageDiv.style.color = '#dc2626';
          return;
        }

        try {
          // Get all instances of the selected subject
          const subjectGroup = window.subjectsByCodeData[subjectCode];
          if (!subjectGroup || !subjectGroup.instances) {
            messageDiv.textContent = '❌ Subject not found';
            messageDiv.style.color = '#dc2626';
            return;
          }

          // Build assignments for all instances
          const assignments = subjectGroup.instances.map(instance => ({
            template_id: instance.template_id,
            subject_index: instance.templateIndex,
            professor_id: professorId
          }));

          messageDiv.textContent = '⏳ Assigning...';
          messageDiv.style.color = '#6b7280';
          this.disabled = true;
          this.style.opacity = '0.6';

          // Send to backend
          const response = await fetch(`${API_BASE}/assign-professors-bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignments })
          });

          if (!response.ok) throw new Error('Failed to assign professor');

          const professorName = professorId 
            ? professors.find(p => p.user_id == professorId)?.full_name || 'Unknown'
            : 'None';
          const action = professorId ? 'Assigned' : 'Unassigned';
          
          messageDiv.textContent = `✅ ${action} ${professorName} to ${assignments.length} instance(s) of ${subjectCode}`;
          messageDiv.style.color = '#16a34a';

          // Reset form
          document.getElementById('bulkAssignSubjectCode').value = '';
          document.getElementById('bulkAssignProfessor').value = '';

          // Reload to show changes
          setTimeout(() => {
            loadSubjectsView();
          }, 1500);
        } catch (error) {
          messageDiv.textContent = `❌ Error: ${error.message}`;
          messageDiv.style.color = '#dc2626';
        } finally {
          this.disabled = false;
          this.style.opacity = '1';
        }
      });
    }

    // Add filter handler for subject code filter
    const subjectsViewFilter = container.querySelector('#subjectsViewSubjectFilter');
    if (subjectsViewFilter) {
      subjectsViewFilter.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase().trim();
        const allGroups = container.querySelectorAll('.subject-group');
        
        allGroups.forEach(group => {
          const groupCode = group.querySelector('.group-code')?.textContent.toLowerCase() || '';
          if (!searchTerm || groupCode.includes(searchTerm)) {
            group.style.display = 'block';
          } else {
            group.style.display = 'none';
          }
        });
      });
    }

    // Add handler for "Show Unassigned Only" button
    const showUnassignedBtn = container.querySelector('#showUnassignedBtn');
    if (showUnassignedBtn) {
      let isFilteringUnassigned = false;

      showUnassignedBtn.addEventListener('click', function() {
        isFilteringUnassigned = !isFilteringUnassigned;
        
        // Update button style
        if (isFilteringUnassigned) {
          showUnassignedBtn.style.backgroundColor = '#fee2e2';
          showUnassignedBtn.style.borderColor = '#fecaca';
          showUnassignedBtn.style.color = '#dc2626';
        } else {
          showUnassignedBtn.style.backgroundColor = '#f3f4f6';
          showUnassignedBtn.style.borderColor = '#d1d5db';
          showUnassignedBtn.style.color = '#374151';
        }

        // Get the assignment list container
        const assignmentList = container.querySelector('.subjects-assignment-list');
        const allGroups = Array.from(container.querySelectorAll('.subject-group'));
        
        if (isFilteringUnassigned) {
          // Separate groups into unassigned and assigned
          const unassignedGroups = [];
          const assignedGroups = [];
          
          allGroups.forEach(group => {
            const unassignedRows = group.querySelectorAll('.subject-row-entry.unassigned');
            if (unassignedRows.length > 0) {
              unassignedGroups.push(group);
            } else {
              assignedGroups.push(group);
            }
          });
          
          // Reorder in DOM: unassigned first, then assigned
          assignmentList.innerHTML = '';
          unassignedGroups.forEach(group => assignmentList.appendChild(group));
          assignedGroups.forEach(group => assignmentList.appendChild(group));
          
          // Hide all assigned rows within each group
          const allRows = container.querySelectorAll('.subject-row-entry');
          allRows.forEach(row => {
            row.style.display = row.classList.contains('unassigned') ? 'grid' : 'none';
          });
        } else {
          // Show all rows and restore original order by reloading
          const allRows = container.querySelectorAll('.subject-row-entry');
          allRows.forEach(row => {
            row.style.display = 'grid';
          });
          
          // Reload the subjects view to restore original order
          loadSubjectsView();
          return;
        }

        // Update button text
        if (isFilteringUnassigned) {
          const unassignedCount = container.querySelectorAll('.subject-row-entry.unassigned').length;
          showUnassignedBtn.innerHTML = `<span style="font-size: 14px;">✓</span> <span>Showing ${unassignedCount} Unassigned</span>`;
        } else {
          showUnassignedBtn.innerHTML = `<span style="font-size: 14px;">📌</span> <span>Unassigned Only</span>`;
        }
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
        const assignmentDataStr = this.getAttribute('data-assignment-data');
        const professorIdValue = this.value;
        const professorId = professorIdValue ? parseInt(professorIdValue) : null;

        try {
          // Parse assignment data: array of {template_id, subject_index}
          const assignmentData = JSON.parse(assignmentDataStr);
          
          // Create assignments array: add professor_id to each template+index pair
          // Allow null for unassignment
          const assignments = assignmentData.map(({ template_id, subject_index }) => ({
            template_id,
            subject_index,
            professor_id: professorId
          }));
          
          // Use bulk assignment endpoint (no template_id in URL, it's in each assignment)
          const response = await fetch(`${API_BASE}/assign-professors-bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignments })
          });

          if (!response.ok) throw new Error('Failed to assign professor');

          const message = professorId ? 'Professor assigned successfully' : 'Professor unassigned successfully';
          const title = professorId ? 'Professor Assigned Successfully' : 'Professor Unassigned';
          
          // Show success modal for assign, toast for unassign
          if (professorId && window.showSuccessModal) {
            window.showSuccessModal(title, message);
          } else {
            showToast(message, 'success');
          }
          
          // Reload the subjects view to reflect the changes
          await loadSubjectsView();
        } catch (error) {
          console.error('Error assigning professor:', error);
          showToast('Error assigning professor: ' + error.message, 'error');
          this.value = '';
        }
      });
    });

    updateSummaryCard();

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