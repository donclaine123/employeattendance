/**
 * curriculum.js
 * Department Head - Assign Professors to Subjects in Curriculum
 */

import { fetchHeadInfo } from './utils.js';

const API_BASE = '/api/curriculum';
const DEPARTMENT_HEAD_API = '/api/department-head';

let loadedSchedules = [];
let currentDepartmentId = null;

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
  document.getElementById('curriculumFilterLevel')?.addEventListener('change', loadCurriculumSchedules);
  document.getElementById('curriculumFilterTerm')?.addEventListener('change', loadCurriculumSchedules);
  document.getElementById('curriculumFilterYear')?.addEventListener('change', loadCurriculumSchedules);
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
window.viewScheduleSubjects = async function(templateId) {
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
async function openAssignmentModal(schedule) {
  // Create modal HTML
  const modal = document.createElement('div');
  modal.className = 'curriculum-assignment-modal';
  modal.id = 'assignmentModal';
  
  // Fetch professors for the department
  const professors = await fetchDepartmentProfessors();
  
  const subjectsHTML = (schedule.subjects || []).map((subject, index) => {
    const assigned = subject.assigned_professor_id ? 
      professors.find(p => p.user_id === subject.assigned_professor_id)?.full_name : 
      'Unassigned';
    
    return `
      <div class="subject-assignment-row">
        <div class="subject-info">
          <div class="subject-code">${subject.subject_code}</div>
          <div class="subject-name">${subject.subject_name}</div>
        </div>
        <div class="subject-schedule">
          <span class="days">${Array.isArray(subject.days_of_week) ? subject.days_of_week.join(',') : subject.days_of_week}</span>
          <span class="time">${subject.start_time} - ${subject.end_time}</span>
        </div>
        <div class="subject-assignment">
          <select class="professor-select" data-subject-index="${index}" data-template-id="${schedule.template_id}">
            <option value="">-- Unassigned --</option>
            ${professors.map(prof => `
              <option value="${prof.user_id}" ${subject.assigned_professor_id === prof.user_id ? 'selected' : ''}>
                ${prof.full_name}
              </option>
            `).join('')}
          </select>
          <button class="btn-assign" onclick="window.assignProfessor(${schedule.template_id}, ${index})">Assign</button>
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
          
          <h4 class="subjects-header">Subject Assignments</h4>
          <div class="subjects-assignment-list">
            ${subjectsHTML}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="this.closest('.curriculum-assignment-modal').remove()">Cancel</button>
          <button class="btn-primary" onclick="window.saveAllAssignments(${schedule.template_id})">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            Save All Changes
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
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
 * Assign professor to a subject
 */
window.assignProfessor = async function(templateId, subjectIndex) {
  const select = document.querySelector(`select[data-subject-index="${subjectIndex}"]`);
  const professorId = select?.value;
  
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
    
    // Reload schedules
    loadCurriculumSchedules();
    
    // Close modal after a brief delay
    setTimeout(() => {
      document.getElementById('assignmentModal')?.remove();
    }, 500);
  } catch (error) {
    console.error('Error assigning professor:', error);
    showToast('Error assigning professor: ' + error.message, 'error');
  }
};

/**
 * Save all assignments in the modal
 */
window.saveAllAssignments = async function(templateId) {
  const assignments = [];
  document.querySelectorAll(`select.professor-select[data-template-id="${templateId}"]`).forEach(select => {
    const subjectIndex = parseInt(select.getAttribute('data-subject-index'));
    const professorId = select.value;
    
    if (professorId) {
      assignments.push({
        subject_index: subjectIndex,
        professor_id: parseInt(professorId)
      });
    }
  });
  
  if (assignments.length === 0) {
    showToast('No assignments to save', 'warning');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/${templateId}/assign-professors-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments })
    });
    
    if (!response.ok) throw new Error('Failed to save assignments');
    
    showToast('All assignments saved successfully', 'success');
    
    // Reload and close modal
    loadCurriculumSchedules();
    document.getElementById('assignmentModal')?.remove();
  } catch (error) {
    console.error('Error saving assignments:', error);
    showToast('Error saving assignments: ' + error.message, 'error');
  }
};

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