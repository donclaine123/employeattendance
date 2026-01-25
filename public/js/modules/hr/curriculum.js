/**
 * Curriculum Template Management Module
 * Handles CRUD operations for semester-based curriculum templates
 */

import { fetchWithAuth, showLoading, hideLoading } from './utils.js';

// State management
let currentTemplates = [];
let currentSubjects = []; // For the add/edit modal
let departments = [];

export function initCurriculumModule() {
  // Load initial data
  loadDepartments();
  loadSemesters();
  setupEventListeners();

  // Load templates with default filters
  loadTemplates();
}

function setupEventListeners() {
  // Filters
  document.getElementById('curriculumDeptFilter')?.addEventListener('change', loadTemplates);
  document.getElementById('curriculumSemesterFilter')?.addEventListener('change', loadTemplates);
  document.getElementById('curriculumYearFilter')?.addEventListener('change', loadTemplates);

  // Buttons
  document.getElementById('createTemplateBtn')?.addEventListener('click', openCreateModal);
  document.getElementById('cloneSemesterBtn')?.addEventListener('click', openCloneModal);

  // Modal Buttons
  document.getElementById('closeTemplateModal')?.addEventListener('click', closeTemplateModal);
  document.getElementById('cancelTemplateBtn')?.addEventListener('click', closeTemplateModal);
  document.getElementById('addSubjectBtn')?.addEventListener('click', addBoundSubject);

  // Form Submission
  document.getElementById('templateForm')?.addEventListener('submit', handleTemplateSubmit);
}

async function loadDepartments() {
  try {
    const response = await fetchWithAuth('/api/hr/departments');
    if (response.ok) {
      const json = await response.json();
      if (json.success) {
        departments = json.data;

        const filterSelect = document.getElementById('curriculumDeptFilter');
        const modalSelect = document.getElementById('templateDept');

        if (filterSelect) {
          populateSelect(filterSelect, departments, 'dept_id', 'dept_name', 'All Departments');
        }

        if (modalSelect) {
          populateSelect(modalSelect, departments, 'dept_id', 'dept_name', 'Select Department');
        }
      } else {
        console.error('[Curriculum] Department API reported failure:', json);
      }
    } else {
      console.error('[Curriculum] Failed to load departments:', response.status);
    }
  } catch (error) {
    console.error('[Curriculum] Error loading departments:', error);
  }
}

async function loadSemesters() {
  try {
    const response = await fetchWithAuth('/api/curriculum-templates/utilities/semesters');
    if (response.ok) {
      const json = await response.json();
      if (json.success) {
        const select = document.getElementById('curriculumSemesterFilter');
        if (select) {
          // Clear except first option
          while (select.options.length > 1) select.remove(1);

          json.data.forEach(sem => {
            const option = document.createElement('option');
            option.value = sem.name;
            option.textContent = sem.name;
            select.appendChild(option);
          });
        }
      } else {
        console.error('[Curriculum] Semesters API reported failure:', json);
      }
    } else {
      console.error('[Curriculum] Failed to load semesters:', response.status);
    }
  } catch (error) {
    console.error('[Curriculum] Error loading semesters:', error);
  }
}

async function loadTemplates() {
  const container = document.getElementById('curriculumGrid');
  if (!container) return;

  const filters = {
    dept_id: document.getElementById('curriculumDeptFilter')?.value,
    semester: document.getElementById('curriculumSemesterFilter')?.value,
    year_level: document.getElementById('curriculumYearFilter')?.value
  };

  // Construct query string
  const queryParams = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) queryParams.append(key, value);
  });

  try {
    container.innerHTML = '<div class="curriculum-loading"><div class="spinner"></div><p>Loading templates...</p></div>';

    const response = await fetchWithAuth(`/api/curriculum-templates?${queryParams.toString()}`);

    if (response.ok) {
      const json = await response.json();
      if (json.success) {
        currentTemplates = json.data;
        renderTemplates(currentTemplates);
      } else {
        console.error('[Curriculum] Templates API reported failure:', json);
        container.innerHTML = `<div class="empty-state"><p>Error loading templates: ${json.message || 'Unknown API error'}</p></div>`;
      }
    } else {
      console.error('[Curriculum] Failed to load templates:', response.status);
      container.innerHTML = `<div class="empty-state"><p>Error loading templates (Status: ${response.status})</p></div>`;
    }
  } catch (error) {
    console.error('[Curriculum] Error fetching templates:', error);
    container.innerHTML = `<div class="empty-state"><p>Error connecting to server: ${error.message}</p></div>`;
  }
}

function renderTemplates(templates) {
  const container = document.getElementById('curriculumGrid');
  container.innerHTML = '';

  if (templates.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 3rem;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="color: var(--text-muted); margin-bottom: 1rem;">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <path d="M14 2v6h6"></path>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <line x1="10" y1="9" x2="8" y2="9"></line>
        </svg>
        <h3>No Templates Found</h3>
        <p style="color: var(--text-muted);">Try adjusting your filters or create a new template.</p>
      </div>
    `;
    return;
  }

  templates.forEach(template => {
    const deptName = departments.find(d => d.dept_id === template.dept_id)?.dept_name || 'Unknown Dept';
    const subjectCount = template.subjects?.length || 0;

    const card = document.createElement('div');
    card.className = 'curriculum-card';
    card.innerHTML = `
      <div class="card-header">
        <span class="pattern-badge">Pattern ${template.schedule_pattern}</span>
        <div class="dropdown">
          <button class="btn-icon">⋮</button>
          <!-- Dropdown content would go here -->
        </div>
      </div>
      <h3 class="card-title">${deptName} - Year ${template.year_level}</h3>
      <div class="card-subtitle">${template.semester_name}</div>
      <div class="card-description" style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">
        ${template.pattern_description || 'No description'}
      </div>
      
      <div class="card-stats">
        <span>📚 ${subjectCount} Subjects</span>
        <span>🗓️ ${template.semester_type}</span>
      </div>
      
      <div class="card-actions">
        <button class="btn-secondary btn-sm" onclick="window.editTemplate(${template.template_id})">Edit</button>
        <button class="btn-danger btn-sm" onclick="window.deleteTemplate(${template.template_id})">Delete</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// --- Subject Management ---

function addBoundSubject() {
  const subject = {
    subject_code: '',
    subject_name: '',
    days_of_week: [],
    start_time: '',
    end_time: '',
    room_name: ''
  };
  currentSubjects.push(subject);
  renderSubjects();
}

function removeSubject(index) {
  currentSubjects.splice(index, 1);
  renderSubjects();
}

function renderSubjects() {
  const container = document.getElementById('subjectsList');
  container.innerHTML = '';

  currentSubjects.forEach((subject, index) => {
    const item = document.createElement('div');
    item.className = 'subject-item';
    item.innerHTML = `
      <button type="button" class="btn-remove-subject" onclick="window.removeSubject(${index})">×</button>
      
      <div class="form-row" style="margin-bottom: 8px;">
        <input type="text" class="form-input" placeholder="Code (e.g. MATH101)" value="${subject.subject_code}" onchange="window.updateSubject(${index}, 'subject_code', this.value)">
        <input type="text" class="form-input" placeholder="Subject Name" value="${subject.subject_name}" onchange="window.updateSubject(${index}, 'subject_name', this.value)">
      </div>
      
      <div class="form-row" style="margin-bottom: 8px;">
        <div class="days-select" style="display: flex; gap: 4px;">
          ${['M', 'T', 'W', 'Th', 'F', 'S'].map(day => `
            <label style="font-size: 12px; display: flex; align-items: center; gap: 2px;">
              <input type="checkbox" ${subject.days_of_week.includes(day) ? 'checked' : ''} onchange="window.updateSubjectDays(${index}, '${day}', this.checked)"> ${day}
            </label>
          `).join('')}
        </div>
        <input type="text" class="form-input" placeholder="Room" value="${subject.room_name || ''}" onchange="window.updateSubject(${index}, 'room_name', this.value)">
      </div>
      
      <div class="form-row" style="margin-bottom: 0;">
        <input type="time" class="form-input" value="${subject.start_time}" onchange="window.updateSubject(${index}, 'start_time', this.value)">
        <input type="time" class="form-input" value="${subject.end_time}" onchange="window.updateSubject(${index}, 'end_time', this.value)">
      </div>
    `;
    container.appendChild(item);
  });
}

// --- Modal Handling ---

function openCreateModal() {
  document.getElementById('templateModalTitle').textContent = 'Create Curriculum Template';
  document.getElementById('templateForm').reset();
  document.getElementById('templateId').value = '';
  currentSubjects = [];
  renderSubjects();

  document.getElementById('templateModal').style.display = 'flex';
}

function closeTemplateModal() {
  document.getElementById('templateModal').style.display = 'none';
}

async function handleTemplateSubmit(e) {
  e.preventDefault();

  // Basic validation for subjects
  if (currentSubjects.length === 0) {
    alert('Please add at least one subject');
    return;
  }

  const formData = {
    deptId: document.getElementById('templateDept').value,
    yearLevel: document.getElementById('templateYear').value,
    semesterName: document.getElementById('templateSemester').value,
    semesterType: document.getElementById('templateSemesterType').value,
    semesterStartDate: document.getElementById('templateStartDate').value,
    semesterEndDate: document.getElementById('templateEndDate').value,
    schedulePattern: document.getElementById('templatePattern').value,
    patternDescription: document.getElementById('templateDescription').value,
    subjects: currentSubjects
  };

  try {
    const response = await fetchWithAuth('/api/curriculum-templates', {
      method: 'POST',
      body: JSON.stringify(formData)
    });

    if (response.ok) {
      const json = await response.json();
      if (json.success) {
        closeTemplateModal();
        loadTemplates();
        // Also refresh semester filter list
        loadSemesters();
      } else {
        alert(json.message || 'Error creating template');
      }
    } else {
      alert(`Server error: ${response.status}`);
    }
  } catch (error) {
    console.error('Error submitting template:', error);
    alert('An unexpected error occurred');
  }
}

// --- Clone Semester Logic ---

function openCloneModal() {
  // Logic to open clone modal would go here
  // For now, simple alert or separate modal implementation
  const fromSem = prompt("Clone from Semester (e.g. 1st Term 2025-2026):");
  if (!fromSem) return;

  const toSem = prompt("Clone to Semester (e.g. 2nd Term 2025-2026):");
  if (!toSem) return;

  const confirmClone = confirm(`Are you sure you want to clone ALL templates from ${fromSem} to ${toSem}? This action cannot be undone.`);

  if (confirmClone) {
    executeClone(fromSem, toSem);
  }
}

async function executeClone(fromSem, toSem) {
  showLoading();
  try {
    const startDate = prompt("Start Date (YYYY-MM-DD):");
    const endDate = prompt("End Date (YYYY-MM-DD):");

    if (!startDate || !endDate) {
      hideLoading();
      return;
    }

    const response = await fetchWithAuth('/api/curriculum-templates/clone-semester', {
      method: 'POST',
      body: JSON.stringify({
        fromSemester: fromSem,
        toSemester: toSem,
        startDate,
        endDate,
        clearProfessors: true
      })
    });

    if (response.ok) {
      const json = await response.json();
      if (json.success) {
        alert(`Successfully cloned ${json.count} templates!`);
        loadTemplates();
        loadSemesters();
      } else {
        alert(json.message || 'Error cloning semester');
      }
    } else {
      alert(`Server error: ${response.status}`);
    }
  } catch (error) {
    console.error('Clone error:', error);
    alert('Error connecting to server');
  } finally {
    hideLoading();
  }
}

// Window exports for inline event handlers
window.editTemplate = (id) => {
  // Fetch full details and open modal
  // Implementation pending
  alert('Edit feature coming next');
};

window.deleteTemplate = async (id) => {
  if (!confirm('Delete this template?')) return;

  try {
    const response = await fetchWithAuth(`/api/curriculum-templates/${id}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      const json = await response.json();
      if (json.success) {
        loadTemplates();
      } else {
        alert(json.message || 'Error deleting template');
      }
    } else {
      alert(`Server error: ${response.status}`);
    }
  } catch (error) {
    console.error('Delete error:', error);
  }
};

window.removeSubject = removeSubject;
window.updateSubject = (index, field, value) => {
  if (currentSubjects[index]) {
    currentSubjects[index][field] = value;
  }
};
window.updateSubjectDays = (index, day, checked) => {
  if (currentSubjects[index]) {
    const days = currentSubjects[index].days_of_week;
    if (checked && !days.includes(day)) {
      days.push(day);
    } else if (!checked && days.includes(day)) {
      const i = days.indexOf(day);
      if (i > -1) days.splice(i, 1);
    }
    // Simple attendance rule: same as scheduled days for now
    currentSubjects[index].attendance_days = [...days];
  }
};

// Helper
function populateSelect(select, items, valueKey, textKey, defaultText = null) {
  select.innerHTML = '';
  if (defaultText) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = defaultText;
    select.appendChild(option);
  }

  items.forEach(item => {
    const option = document.createElement('option');
    option.value = item[valueKey];
    option.textContent = item[textKey];
    select.appendChild(option);
  });
}
