import { fetchWithAuth } from './utils.js';
const ROUNDS_PAGE_SIZE = 8;
const FINAL_ROUNDS_STATUSES = new Set(['verified', 'late', 'absent']);

let currentRoundsDate = new Date().toISOString().split('T')[0];
let allRoundsData = [];
let allDepartments = new Set();
let roundsFilteredRecords = [];
let roundsCurrentPage = 1;
let roundsFiltersBound = false;
let roundsPaginationBound = false;
let roundsStatusPreviewBound = false;
let groupDataStore = {};

export function initHourlyRounds() {
  const container = document.getElementById('section-hourly-rounds');
  if (!container) return;

  syncDatePicker();
  bindFilterEvents();
  bindPaginationEvents();
  bindStatusPreviewEvents();
  loadHourlyRounds();
}

function formatRoundsDate(dateValue) {
  if (!dateValue) return 'Today';

  const dateObject = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(dateObject.getTime())) return String(dateValue);

  return dateObject.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function syncDatePicker() {
  const dateInput = document.getElementById('roundsDateFilter');
  if (!dateInput) return;

  dateInput.value = currentRoundsDate;
  dateInput.setAttribute('aria-label', `Hourly rounds date: ${formatRoundsDate(currentRoundsDate)}`);
}

function setRoundsDate(dateValue) {
  if (!dateValue || dateValue === currentRoundsDate) return;

  currentRoundsDate = dateValue;
  roundsCurrentPage = 1;
  syncDatePicker();
  loadHourlyRounds();
}

function bindFilterEvents() {
  if (roundsFiltersBound) return;

  const dateFilter = document.getElementById('roundsDateFilter');
  const deptFilter = document.getElementById('deptFilter');
  const searchInput = document.getElementById('searchInput');

  dateFilter?.addEventListener('change', (event) => {
    setRoundsDate(event.target.value);
  });

  deptFilter?.addEventListener('change', () => {
    roundsCurrentPage = 1;
    applyFilters();
  });

  searchInput?.addEventListener('input', debounce(() => {
    roundsCurrentPage = 1;
    applyFilters();
  }, 300));

  roundsFiltersBound = true;
}

function bindPaginationEvents() {
  if (roundsPaginationBound) return;

  const prevBtn = document.getElementById('roundsPrevPage');
  const nextBtn = document.getElementById('roundsNextPage');

  prevBtn?.addEventListener('click', () => {
    if (roundsCurrentPage > 1) {
      roundsCurrentPage -= 1;
      renderRoundsTable(roundsFilteredRecords);
    }
  });

  nextBtn?.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(roundsFilteredRecords.length / ROUNDS_PAGE_SIZE));
    if (roundsCurrentPage < totalPages) {
      roundsCurrentPage += 1;
      renderRoundsTable(roundsFilteredRecords);
    }
  });

  roundsPaginationBound = true;
}

function bindStatusPreviewEvents() {
  if (roundsStatusPreviewBound) return;

  const tbody = document.getElementById('hourlyRoundsTableBody');
  if (!tbody) return;

  const previewHandler = (event) => {
    const statusButton = event.target.closest('.rounds-status-pill');
    if (!statusButton) return;

    const statusGroup = statusButton.closest('.rounds-status-group');
    const groupIdentifier = statusGroup?.dataset.groupId;
    const groupData = groupDataStore[groupIdentifier];
    if (groupData?.isSavingStatus) return;

    previewRoundsStatusSelection(statusButton);
  };

  tbody.addEventListener('pointerdown', previewHandler);
  tbody.addEventListener('mousedown', previewHandler);
  tbody.addEventListener('touchstart', previewHandler, { passive: true });

  tbody.addEventListener('click', (event) => {
    const statusButton = event.target.closest('.rounds-status-pill');
    if (!statusButton) return;

    const statusGroup = statusButton.closest('.rounds-status-group');
    const input = statusButton.querySelector('input[type="radio"]');
    if (!statusGroup || !input) return;

    const groupIdentifier = statusGroup.dataset.groupId;
    const groupData = groupDataStore[groupIdentifier];
    if (groupData?.isSavingStatus) return;
    const committedStatus = String(groupData?.currentStatus || '').toLowerCase();
    const clickedStatus = String(input.value || '').toLowerCase();

    if (!committedStatus || committedStatus !== clickedStatus) return;

    event.preventDefault();
    event.stopPropagation();
    handleGroupStatusToggleOff(groupIdentifier, input);
  });

  roundsStatusPreviewBound = true;
}

async function loadHourlyRounds(options = {}) {
  const { preservePage = false } = options;
  const tbody = document.getElementById('hourlyRoundsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" class="no-records" style="padding: 3rem; text-align: center; color: var(--text-muted);">Loading...</td></tr>';
  updateRoundsPagination(0);

  try {
    const response = await fetchWithAuth(`/api/hr/rounds/daily?date=${currentRoundsDate}`);
    if (!response.ok) {
      tbody.innerHTML = `<tr><td colspan="6" class="no-records">Server Error: ${response.status}</td></tr>`;
      updateRoundsPendingBadge(0);
      return;
    }

    const json = await response.json();
    if (!json.success) {
      tbody.innerHTML = `<tr><td colspan="6" class="no-records">Error: ${json.message}</td></tr>`;
      updateRoundsPendingBadge(0);
      return;
    }

    allRoundsData = Array.isArray(json.data) ? json.data : [];

    allDepartments = new Set();
    allRoundsData.forEach(record => {
      if (record.department) {
        allDepartments.add(record.department);
      }
    });

    populateDepartmentFilter();
    if (!preservePage) {
      roundsCurrentPage = 1;
    }
    applyFilters();
  } catch (error) {
    console.error('Error loading rounds:', error);
    tbody.innerHTML = '<tr><td colspan="6" class="no-records">Connection Error</td></tr>';
    updateRoundsPendingBadge(0);
  }
}

function populateDepartmentFilter() {
  const select = document.getElementById('deptFilter');
  if (!select) return;

  const currentValue = select.value;
  const allOption = select.querySelector('option[value=""]');
  select.innerHTML = '';
  if (allOption) select.appendChild(allOption);

  Array.from(allDepartments).sort((a, b) => a.localeCompare(b)).forEach(dept => {
    const option = document.createElement('option');
    option.value = dept;
    option.textContent = dept;
    select.appendChild(option);
  });

  if (currentValue && allDepartments.has(currentValue)) {
    select.value = currentValue;
  } else {
    select.value = '';
  }
}

function applyFilters() {
  const searchValue = document.getElementById('searchInput')?.value.toLowerCase() || '';
  const deptValue = document.getElementById('deptFilter')?.value || '';

  roundsFilteredRecords = allRoundsData.filter(record => {
    const searchSource = [
      record.employeeName,
      record.department,
      record.role,
      ...(record.subjects || []).flatMap(subject => [
        subject.subject_code,
        subject.subject_name,
        subject.room_name,
        Array.isArray(subject.days_of_week) ? subject.days_of_week.join(' ') : subject.days_of_week
      ])
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const matchesSearch = !searchValue || searchSource.includes(searchValue);
    const matchesDept = deptValue === '' || record.department === deptValue;
    return matchesSearch && matchesDept;
  });

  renderRoundsTable(roundsFilteredRecords);
  updateRoundsPendingBadge(allRoundsData);
}

function formatTimeToAMPM(time) {
  if (!time) return '-';

  const [hour, minute] = String(time).split(':').slice(0, 2);
  const hourValue = parseInt(hour, 10);
  const period = hourValue >= 12 ? 'PM' : 'AM';
  const displayHour = hourValue > 12 ? hourValue - 12 : (hourValue === 0 ? 12 : hourValue);
  return `${displayHour}:${minute} ${period}`;
}

function buildGroupedRounds(records) {
  const allSubjects = [];

  (Array.isArray(records) ? records : []).forEach(record => {
    if (!Array.isArray(record.subjects) || record.subjects.length === 0) return;

    record.subjects.forEach(subject => {
      allSubjects.push({
        ...subject,
        employee_id: record.employee_id,
        employeeName: record.employeeName,
        department: record.department,
        role: record.role,
        attendance_id: record.attendance_id,
        date: record.date,
        has_checked_in: record.has_checked_in
      });
    });
  });


  allSubjects.sort((left, right) => {
    return (left.start_time || '23:59:59').localeCompare(right.start_time || '23:59:59');
  });

  const groupedData = {};

  allSubjects.forEach(subject => {
    const groupKey = `${subject.employee_id}|${subject.start_time}|${subject.end_time}`;
    if (!groupedData[groupKey]) {
      groupedData[groupKey] = {
        employee_id: subject.employee_id,
        employeeName: subject.employeeName,
        department: subject.department,
        role: subject.role,
        attendance_id: subject.attendance_id,
        date: subject.date,
        has_checked_in: subject.has_checked_in,
        start_time: subject.start_time,
        end_time: subject.end_time,
        subjects: []
      };
    }

    groupedData[groupKey].subjects.push(subject);
  });

  return Object.values(groupedData).sort((left, right) => {
    return (left.start_time || '23:59:59').localeCompare(right.start_time || '23:59:59');
  });
}

function getRoundsPendingCount(records) {
  return buildGroupedRounds(records).reduce((count, group) => {
    const status = String(group.subjects?.[0]?.verified_status || '').toLowerCase();
    return count + (FINAL_ROUNDS_STATUSES.has(status) ? 0 : 1);
  }, 0);
}

function updateRoundsPendingBadge(records) {
  const badge = document.getElementById('roundsPendingCount');
  const pendingCount = typeof records === 'number' ? records : getRoundsPendingCount(records);

  if (badge) {
    badge.textContent = String(pendingCount);
  }

  const summaryCard = document.querySelector('.rounds-summary-card');
  if (summaryCard) {
    summaryCard.setAttribute('aria-label', `Hourly rounds pending count: ${pendingCount}`);
  }
}

function applyLocalRoundsStatusUpdate(groupData, newStatus) {
  if (!Array.isArray(allRoundsData) || !groupData || !Array.isArray(groupData.subjects)) return;

  const attendanceIds = new Set(groupData.subjects.map(subject => String(subject.attendance_id)));

  allRoundsData = allRoundsData.map(record => {
    if (!Array.isArray(record.subjects) || record.subjects.length === 0) return record;

    let recordChanged = false;
    const subjects = record.subjects.map(subject => {
      if (attendanceIds.has(String(subject.attendance_id))) {
        recordChanged = true;
        return {
          ...subject,
          verified_status: newStatus
        };
      }
      return subject;
    });

    return recordChanged ? { ...record, subjects } : record;
  });
}

function getRoundsStatusGroup(target) {
  if (!target) return null;
  if (typeof target === 'string') {
    return document.querySelector(`.rounds-status-group[data-group-id="${target}"]`);
  }

  if (typeof target.closest === 'function') {
    return target.classList?.contains('rounds-status-group') ? target : target.closest('.rounds-status-group');
  }

  return null;
}

function setRoundsStatusVisualState(target, status, syncChecked = true) {
  const statusGroup = getRoundsStatusGroup(target);
  if (!statusGroup) return;

  const normalizedStatus = String(status || '').toLowerCase();
  const statusButtons = statusGroup.querySelectorAll('.rounds-status-pill');

  statusButtons.forEach(button => {
    const input = button.querySelector('input[type="radio"]');
    const isActive = Boolean(input && input.value === normalizedStatus);
    button.classList.toggle('rounds-status-pill--active', isActive);

    if (input && syncChecked) {
      input.checked = isActive;
    }
  });

  statusGroup.dataset.selectedStatus = normalizedStatus;
}

function previewRoundsStatusSelection(target) {
  const statusGroup = getRoundsStatusGroup(target);
  const input = target?.matches?.('input[type="radio"]')
    ? target
    : target?.querySelector?.('input[type="radio"]');

  if (!statusGroup || !input) return;

  setRoundsStatusVisualState(statusGroup, input.value, false);
}

async function handleGroupStatusToggleOff(groupIdentifier, radioInput) {
  const groupData = groupDataStore[groupIdentifier];

  if (!groupData || !Array.isArray(groupData.subjects)) {
    console.error('Group data not found for:', groupIdentifier);
    return;
  }

  if (groupData.isSavingStatus) return;

  groupData.isSavingStatus = true;

  const previousStatus = String(groupData.currentStatus || radioInput.value || '').toLowerCase();
  const statusGroup = radioInput.closest('.rounds-status-group');

  setRoundsStatusVisualState(statusGroup, '', true);
  groupData.currentStatus = '';

  try {
    for (const subject of groupData.subjects) {
      const response = await fetchWithAuth('/api/hr/rounds/verify', {
        method: 'POST',
        body: JSON.stringify({
          attendanceId: subject.attendance_id,
          subjectCode: subject.subject_code,
          templateId: subject.template_id,
          employeeId: subject.employee_id,
          date: groupData.date,
          status: previousStatus
        })
      });

      if (!response.ok) {
        console.error('Toggle-off verification failed for subject:', subject.subject_code);
        groupData.currentStatus = previousStatus;
        setRoundsStatusVisualState(statusGroup, previousStatus, true);
        return;
      }

      const json = await response.json();
      if (!json.success) {
        console.error('Toggle-off verification failed:', json.message);
        groupData.currentStatus = previousStatus;
        setRoundsStatusVisualState(statusGroup, previousStatus, true);
        return;
      }
    }

    applyLocalRoundsStatusUpdate(groupData, '');
    await loadHourlyRounds({ preservePage: true });
  } catch (error) {
    console.error('Toggle-off verify error:', error);
    groupData.currentStatus = previousStatus;
    setRoundsStatusVisualState(statusGroup, previousStatus, true);
  } finally {
    groupData.isSavingStatus = false;
  }
}

function renderRoundsTable(records) {
  const tbody = document.getElementById('hourlyRoundsTableBody');
  if (!tbody) return;

  const groupedRecords = buildGroupedRounds(records);

  if (groupedRecords.length === 0) {
    groupDataStore = {};
    tbody.innerHTML = '<tr><td colspan="6" class="no-records" style="padding: 3rem; text-align: center; color: var(--text-muted);">No professors scheduled for this date.</td></tr>';
    updateRoundsPagination(0);
    return;
  }

  groupDataStore = {};

  const totalPages = Math.max(1, Math.ceil(groupedRecords.length / ROUNDS_PAGE_SIZE));
  if (roundsCurrentPage > totalPages) roundsCurrentPage = totalPages;
  if (roundsCurrentPage < 1) roundsCurrentPage = 1;

  const startIndex = (roundsCurrentPage - 1) * ROUNDS_PAGE_SIZE;
  const pageGroups = groupedRecords.slice(startIndex, startIndex + ROUNDS_PAGE_SIZE);

  const rowsHTML = pageGroups.map((group) => {
    const firstSubject = group.subjects[0] || {};
    const groupIdentifier = `${group.employee_id}-${group.start_time}-${group.end_time}`;
    const employeeInitials = (group.employeeName || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() || '')
      .join('') || 'HR';
    const firstStatus = String(firstSubject.verified_status || '').toLowerCase();

    const statusButtonsHTML = [
      { value: 'verified', label: 'Verified', optionClass: 'verified-option', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>' },
      { value: 'late', label: 'Late', optionClass: 'late-option', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>' },
      { value: 'absent', label: 'Absent', optionClass: 'absent-option', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' }
    ].map(({ value, label, optionClass, icon }) => `
      <label class="radio-option rounds-status-pill ${firstStatus === value ? 'rounds-status-pill--active' : ''} ${optionClass}">
        <input type="radio" name="status-group-${groupIdentifier}" value="${value}" ${firstStatus === value ? 'checked' : ''} aria-label="Mark as ${label.toLowerCase()}" onchange="window.handleGroupStatusChange('${groupIdentifier}', '${group.date}', this)">
        <span class="radio-icon" aria-hidden="true">${icon}</span>
        <span class="radio-label">${label}</span>
      </label>
    `).join('');

    const subjectMap = {};
    group.subjects.forEach(subj => {
      if (!subjectMap[subj.subject_code]) {
        subjectMap[subj.subject_code] = {
          subject_code: subj.subject_code,
          subject_name: subj.subject_name,
          sections: []
        };
      }
      subjectMap[subj.subject_code].sections.push(subj.section_name);
    });

    const subjectsHTML = Object.values(subjectMap).map(subj => {
      const uniqueSections = [...new Set(subj.sections)].join(', ');
      return `<div class="rounds-subject-item">
        <div class="rounds-subject-code">${subj.subject_code}</div>
        <div class="rounds-subject-name">${subj.subject_name}</div>
        <div class="rounds-subject-meta">Sections: ${uniqueSections}</div>
      </div>`;
    }).join('');

    const uniqueLocations = [...new Set(group.subjects.map(subj => subj.room_name).filter(Boolean))];
    const locationLabel = uniqueLocations[0] || 'TBD';

    groupDataStore[groupIdentifier] = {
      subjects: group.subjects.map(s => ({
        attendance_id: s.attendance_id,
        subject_code: s.subject_code,
        template_id: s.template_id,
        employee_id: s.employee_id
      })),
      date: group.date,
      currentStatus: firstStatus
    };

    return `
      <tr class="rounds-card-row ${!group.has_checked_in ? 'rounds-card-row--no-check-in' : ''}">
        <td colspan="6">
          <div class="rounds-slot-row">
            <span class="rounds-slot-chip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="9"></circle>
                <path d="M12 7v5l3 2"></path>
              </svg>
              <span>${formatTimeToAMPM(group.start_time)} - ${formatTimeToAMPM(group.end_time)}</span>
            </span>
            <span class="rounds-slot-rule" aria-hidden="true"></span>
          </div>

          <article class="rounds-session-card ${!group.has_checked_in ? 'rounds-session-card--warning' : ''}">
            <div class="rounds-session-header">
              <div class="rounds-session-location">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M12 21s6-4.35 6-10a6 6 0 0 0-12 0c0 5.65 6 10 6 10z"></path>
                  <circle cx="12" cy="11" r="2.5"></circle>
                </svg>
                <span>${locationLabel}</span>
              </div>
              <span class="rounds-session-badge ${group.has_checked_in ? 'rounds-session-badge--success' : 'rounds-session-badge--warning'}">
                ${group.has_checked_in ? 'CHECKED IN' : 'NO CHECK-IN'}
              </span>
            </div>

            <div class="rounds-session-grid">
              <div class="rounds-employee-card">
                <div class="rounds-employee-avatar" aria-hidden="true">${employeeInitials}</div>
                <div class="rounds-employee-copy">
                  <div class="rounds-employee-name">${group.employeeName}</div>
                  <div class="rounds-employee-meta">ID: ${group.employee_id} • ${group.department}</div>
                </div>
              </div>

              <div class="rounds-subject-card">
                <div class="rounds-subject-list">
                  ${subjectsHTML}
                </div>
              </div>

              <div class="rounds-action-card">
                <div class="status-radio-group rounds-status-group" data-group-id="${groupIdentifier}" data-selected-status="${firstStatus}">
                  ${statusButtonsHTML}
                </div>
              </div>
            </div>
          </article>
        </td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rowsHTML;
  updateRoundsPagination(groupedRecords.length);
  window.previewRoundsStatusSelection = previewRoundsStatusSelection;
  window.handleGroupStatusChange = handleGroupStatusChange;
}

function updateRoundsPagination(totalRecords) {
  const footer = document.getElementById('roundsPaginationFooter');
  const pageInfo = document.getElementById('roundsPaginationInfo');
  const prevBtn = document.getElementById('roundsPrevPage');
  const nextBtn = document.getElementById('roundsNextPage');

  if (!footer || !pageInfo || !prevBtn || !nextBtn) return;

  if (totalRecords <= 0) {
    footer.style.display = 'none';
    pageInfo.textContent = '';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(totalRecords / ROUNDS_PAGE_SIZE));
  roundsCurrentPage = Math.min(Math.max(roundsCurrentPage, 1), totalPages);

  const startIndex = (roundsCurrentPage - 1) * ROUNDS_PAGE_SIZE + 1;
  const endIndex = Math.min(startIndex + ROUNDS_PAGE_SIZE - 1, totalRecords);

  pageInfo.textContent = totalRecords <= ROUNDS_PAGE_SIZE
    ? `Showing all ${totalRecords} records`
    : `Showing ${startIndex}-${endIndex} of ${totalRecords} records`;

  prevBtn.disabled = roundsCurrentPage <= 1;
  nextBtn.disabled = roundsCurrentPage >= totalPages;
  footer.style.display = 'flex';
}

async function handleGroupStatusChange(groupIdentifier, date, radioInput) {
  const newStatus = radioInput.value;
  const groupData = groupDataStore[groupIdentifier];

  if (!groupData || !Array.isArray(groupData.subjects)) {
    console.error('Group data not found for:', groupIdentifier);
    radioInput.checked = false;
    return;
  }

  if (groupData.isSavingStatus) return;

  groupData.isSavingStatus = true;

  const previousStatus = String(groupData.currentStatus || '').toLowerCase();

  setRoundsStatusVisualState(radioInput.closest('.rounds-status-group'), newStatus);
  groupData.currentStatus = newStatus;

  try {
    for (const subject of groupData.subjects) {
      const response = await fetchWithAuth('/api/hr/rounds/verify', {
        method: 'POST',
        body: JSON.stringify({
          attendanceId: subject.attendance_id,
          subjectCode: subject.subject_code,
          templateId: subject.template_id,
          employeeId: subject.employee_id,
          date,
          status: newStatus
        })
      });

      if (!response.ok) {
        console.error('Verification failed for subject:', subject.subject_code);
        groupData.currentStatus = previousStatus;
        setRoundsStatusVisualState(radioInput.closest('.rounds-status-group'), previousStatus);
        return;
      }

      const json = await response.json();
      if (!json.success) {
        console.error('Verification failed:', json.message);
        groupData.currentStatus = previousStatus;
        setRoundsStatusVisualState(radioInput.closest('.rounds-status-group'), previousStatus);
        return;
      }
    }

    applyLocalRoundsStatusUpdate(groupData, newStatus);
    await loadHourlyRounds({ preservePage: true });
  } catch (error) {
    console.error('Verify group error:', error);
    groupData.currentStatus = previousStatus;
    setRoundsStatusVisualState(radioInput.closest('.rounds-status-group'), previousStatus);
  } finally {
    groupData.isSavingStatus = false;
  }
}

function debounce(func, wait) {
  let timeout;

  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}/* legacy duplicate block begins

let currentRoundsDate = new Date().toISOString().split('T')[0];
let allRoundsData = [];
let allDepartments = new Set();
let roundsFilteredRecords = [];
let roundsCurrentPage = 1;
  // Global store for group data
  let groupDataStore = {};

  function renderRoundsTable(records) {
    const tbody = document.getElementById('hourlyRoundsTableBody');
    if (!tbody) return;

    const groupedRecords = buildGroupedRounds(records);

    if (!groupedRecords.length) {
      groupDataStore = {};
      tbody.innerHTML = '<tr><td colspan="6" class="no-records" style="padding: 3rem; text-align: center; color: var(--text-muted);">No professors scheduled for this date.</td></tr>';
      updateRoundsPagination(0);
      updateRoundsPendingBadge(0);
      return;
    }

    groupDataStore = {};

    const totalPages = Math.max(1, Math.ceil(groupedRecords.length / ROUNDS_PAGE_SIZE));
    if (roundsCurrentPage > totalPages) roundsCurrentPage = totalPages;
    if (roundsCurrentPage < 1) roundsCurrentPage = 1;

    const startIndex = (roundsCurrentPage - 1) * ROUNDS_PAGE_SIZE;
    const pageGroups = groupedRecords.slice(startIndex, startIndex + ROUNDS_PAGE_SIZE);

    const rowsHTML = pageGroups.map(group => {
      const firstSubject = group.subjects[0];
      const groupIdentifier = `${group.employee_id}-${group.start_time}-${group.end_time}`;
      const employeeInitials = getEmployeeInitials(group.employeeName);

      const statusButtonsHTML = [
        {
          value: 'verified',
          label: 'Verified',
          optionClass: 'verified-option',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>'
        },
        {
          value: 'late',
          label: 'Late',
          optionClass: 'late-option',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>'
        },
        {
          value: 'absent',
          label: 'Absent',
          optionClass: 'absent-option',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
        }
      ].map(({ value, label, optionClass, icon }) => `
        <label class="radio-option rounds-status-pill ${optionClass}">
          <input type="radio" name="status-group-${groupIdentifier}" value="${value}" ${firstSubject.verified_status === value ? 'checked' : ''} aria-label="Mark as ${label.toLowerCase()}" onchange="window.handleGroupStatusChange('${groupIdentifier}', '${group.date}', this)">
          <span class="radio-icon" aria-hidden="true">${icon}</span>
          <span class="radio-label">${label}</span>
        </label>
      `).join('');

      const subjectMap = {};
      group.subjects.forEach(subj => {
        if (!subjectMap[subj.subject_code]) {
          subjectMap[subj.subject_code] = {
            subject_code: subj.subject_code,
            subject_name: subj.subject_name,
            sections: []
          };
        }
        subjectMap[subj.subject_code].sections.push(subj.section_name);
      });

      const subjectsHTML = Object.values(subjectMap).map(subj => {
        const uniqueSections = [...new Set(subj.sections)].join(', ');
        return `<div class="rounds-subject-item">
          <div class="rounds-subject-code">${subj.subject_code}</div>
          <div class="rounds-subject-name">${subj.subject_name}</div>
          <div class="rounds-subject-meta">Sections: ${uniqueSections}</div>
        </div>`;
      }).join('');

      const uniqueLocations = [...new Set(group.subjects.map(subj => subj.room_name).filter(Boolean))];
      const locationLabel = uniqueLocations[0] || 'TBD';

      groupDataStore[groupIdentifier] = {
        subjects: group.subjects.map(s => ({
          attendance_id: s.attendance_id,
          subject_code: s.subject_code,
          template_id: s.template_id,
          employee_id: s.employee_id
        })),
        date: group.date
      };

      return `
        <tr class="rounds-card-row ${!group.has_checked_in ? 'rounds-card-row--no-check-in' : ''}">
          <td colspan="6">
            <div class="rounds-slot-row">
              <span class="rounds-slot-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"></circle>
                  <path d="M12 7v5l3 2"></path>
                </svg>
                <span>${formatTimeToAMPM(group.start_time)} - ${formatTimeToAMPM(group.end_time)}</span>
              </span>
              <span class="rounds-slot-rule" aria-hidden="true"></span>
            </div>

            <article class="rounds-session-card ${!group.has_checked_in ? 'rounds-session-card--warning' : ''}">
              <div class="rounds-session-header">
                <div class="rounds-session-location">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M12 21s6-4.35 6-10a6 6 0 0 0-12 0c0 5.65 6 10 6 10z"></path>
                    <circle cx="12" cy="11" r="2.5"></circle>
                  </svg>
                  <span>${locationLabel}</span>
                </div>
                <span class="rounds-session-badge ${group.has_checked_in ? 'rounds-session-badge--success' : 'rounds-session-badge--warning'}">
                  ${group.has_checked_in ? 'CHECKED IN' : 'NO CHECK-IN'}
                </span>
              </div>

              <div class="rounds-session-grid">
                <div class="rounds-employee-card">
                  <div class="rounds-employee-avatar" aria-hidden="true">${employeeInitials}</div>
                  <div class="rounds-employee-copy">
                    <div class="rounds-employee-name">${group.employeeName}</div>
                    <div class="rounds-employee-meta">ID: ${group.employee_id} • ${group.department}</div>
                  </div>
                </div>

                <div class="rounds-subject-card">
                  <div class="rounds-subject-list">
                    ${subjectsHTML}
                  </div>
                </div>

                <div class="rounds-action-card">
                  <div class="status-radio-group rounds-status-group">
                    ${statusButtonsHTML}
                  </div>
                </div>
              </div>
            </article>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHTML;
    updateRoundsPagination(groupedRecords.length);
    updateRoundsPendingBadge(groupedRecords);

    window.handleGroupStatusChange = handleGroupStatusChange;
  }

  function updateRoundsPagination(totalRecords) {
    const footer = document.getElementById('roundsPaginationFooter');
    const pageInfo = document.getElementById('roundsPaginationInfo');
    const prevBtn = document.getElementById('roundsPrevPage');
    const nextBtn = document.getElementById('roundsNextPage');

    if (!footer || !pageInfo || !prevBtn || !nextBtn) return;

    if (totalRecords <= 0) {
      footer.style.display = 'none';
      pageInfo.textContent = '';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(totalRecords / ROUNDS_PAGE_SIZE));
    roundsCurrentPage = Math.min(Math.max(roundsCurrentPage, 1), totalPages);

    const startIndex = (roundsCurrentPage - 1) * ROUNDS_PAGE_SIZE + 1;
    const endIndex = Math.min(startIndex + ROUNDS_PAGE_SIZE - 1, totalRecords);

    pageInfo.textContent = totalRecords <= ROUNDS_PAGE_SIZE
      ? `Showing all ${totalRecords} records`
      : `Showing ${startIndex}-${endIndex} of ${totalRecords} records`;

    prevBtn.disabled = roundsCurrentPage <= 1;
    nextBtn.disabled = roundsCurrentPage >= totalPages;
    footer.style.display = 'flex';
  }

  async function handleGroupStatusChange(groupIdentifier, date, radioInput) {
    const newStatus = radioInput.value;

    const groupData = groupDataStore[groupIdentifier];
    if (!groupData || !groupData.subjects) {
      console.error('Group data not found for:', groupIdentifier);
      radioInput.checked = false;
      return;
    }

    try {
      for (const subject of groupData.subjects) {
        const response = await fetchWithAuth('/api/hr/rounds/verify', {
          method: 'POST',
          body: JSON.stringify({
            attendanceId: subject.attendance_id,
            subjectCode: subject.subject_code,
            templateId: subject.template_id,
            employeeId: subject.employee_id,
            date: date,
            status: newStatus
          })
        });

        if (!response.ok) {
          console.error('Verification failed for subject:', subject.subject_code);
          radioInput.checked = false;
          return;
        }

        const json = await response.json();
        if (!json.success) {
          console.error('Verification failed:', json.message);
          radioInput.checked = false;
          return;
        }

        console.log(`[Hourly Rounds] Updated ${subject.subject_code} to ${newStatus}`);
      }

      applyLocalRoundsStatusUpdate(groupData, newStatus);
      renderRoundsTable(roundsFilteredRecords);
      console.log(`[Hourly Rounds] Group ${groupIdentifier} updated to ${newStatus}`);
    } catch (error) {
      console.error('Verify group error:', error);
      radioInput.checked = false;
    }
  }

}
*/
