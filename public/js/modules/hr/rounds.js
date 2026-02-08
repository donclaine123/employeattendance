import { fetchWithAuth, showLoading, hideLoading } from './utils.js';

let currentRoundsDate = new Date().toISOString().split('T')[0];
let allRoundsData = [];
let allDepartments = new Set();

export function initHourlyRounds() {
  const container = document.getElementById('section-hourly-rounds');
  if (!container) return;

  console.log('[Hourly Rounds] Initializing...');

  // Initialize date display
  updateDateDisplay();

  // Attach event listeners
  const prevBtn = document.getElementById('prevDayBtn');
  const nextBtn = document.getElementById('nextDayBtn');
  
  console.log('[Hourly Rounds] Date buttons:', { prevBtn: !!prevBtn, nextBtn: !!nextBtn });
  
  prevBtn?.addEventListener('click', (e) => {
    console.log('[Hourly Rounds] Previous day clicked');
    e.preventDefault();
    changeDate(-1);
  });
  
  nextBtn?.addEventListener('click', (e) => {
    console.log('[Hourly Rounds] Next day clicked');
    e.preventDefault();
    changeDate(1);
  });

  // Department filter
  document.getElementById('deptFilter')?.addEventListener('change', () => applyFilters());

  // Search input
  document.getElementById('searchInput')?.addEventListener('input', debounce(applyFilters, 300));

  // Initial load
  loadHourlyRounds();
}

function updateDateDisplay() {
  const display = document.getElementById('currentDateDisplay');
  if (!display) return;

  const dateObj = new Date(currentRoundsDate + 'T00:00:00');
  const today = new Date().toISOString().split('T')[0];

  if (currentRoundsDate === today) {
    display.textContent = 'Today';
  } else {
    display.textContent = dateObj.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }
}

function changeDate(days) {
  console.log('[Hourly Rounds] changeDate called with days:', days, 'currentDate:', currentRoundsDate);
  const date = new Date(currentRoundsDate + 'T00:00:00');
  date.setDate(date.getDate() + days);
  
  // Format date as YYYY-MM-DD in local timezone (not UTC)
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  currentRoundsDate = `${year}-${month}-${day}`;
  
  console.log('[Hourly Rounds] newDate:', currentRoundsDate);
  updateDateDisplay();
  loadHourlyRounds();
}

async function loadHourlyRounds() {
  const tbody = document.getElementById('hourlyRoundsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" class="no-records" style="padding: 3rem; text-align: center; color: var(--text-muted);">Loading...</td></tr>';

  try {
    const response = await fetchWithAuth(`/api/hr/rounds/daily?date=${currentRoundsDate}`);
    if (response.ok) {
      const json = await response.json();
      if (json.success) {
        allRoundsData = json.data;
        
        // Extract departments for filter
        allDepartments = new Set();
        allRoundsData.forEach(record => {
          if (record.department) allDepartments.add(record.department);
        });

        // Populate department filter if empty
        populateDepartmentFilter();

        // Render table
        renderRoundsTable(allRoundsData);
      } else {
        tbody.innerHTML = `<tr><td colspan="6" class="no-records">Error: ${json.message}</td></tr>`;
      }
    } else {
      tbody.innerHTML = `<tr><td colspan="6" class="no-records">Server Error: ${response.status}</td></tr>`;
    }
  } catch (error) {
    console.error('Error loading rounds:', error);
    tbody.innerHTML = `<tr><td colspan="6" class="no-records">Connection Error</td></tr>`;
  }
}

function populateDepartmentFilter() {
  const select = document.getElementById('deptFilter');
  if (!select) {
    // Create filter UI if it doesn't exist
    createFilterUI();
    return;
  }

  // Clear existing options (except "All")
  const allOption = select.querySelector('option[value=""]');
  select.innerHTML = '';
  if (allOption) select.appendChild(allOption);

  // Add department options
  Array.from(allDepartments).sort().forEach(dept => {
    const option = document.createElement('option');
    option.value = dept;
    option.textContent = dept;
    select.appendChild(option);
  });
}

function createFilterUI() {
  // Insert filter UI above table if it doesn't exist
  const container = document.querySelector('.table-container');
  if (!container) return;

  const filterHTML = `
    <div style="display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
      <input 
        type="text" 
        id="searchInput" 
        placeholder="Search professor name..." 
        style="flex: 1; min-width: 200px; padding: 8px 12px; border: 1px solid var(--border-primary); border-radius: 6px; font-size: 14px;">
      
      <select 
        id="deptFilter" 
        style="padding: 8px 12px; border: 1px solid var(--border-primary); border-radius: 6px; font-size: 14px; background-color: var(--bg-secondary);">
        <option value="">All Departments</option>
      </select>
    </div>
  `;

  const filterDiv = document.createElement('div');
  filterDiv.innerHTML = filterHTML;
  container.parentElement.insertBefore(filterDiv, container);

  // Attach event listeners
  document.getElementById('searchInput')?.addEventListener('input', debounce(applyFilters, 300));
  document.getElementById('deptFilter')?.addEventListener('change', applyFilters);
}

function applyFilters() {
  const searchValue = document.getElementById('searchInput')?.value.toLowerCase() || '';
  const deptValue = document.getElementById('deptFilter')?.value || '';

  const filtered = allRoundsData.filter(record => {
    const nameMatch = record.employeeName.toLowerCase().includes(searchValue);
    const deptMatch = deptValue === '' || record.department === deptValue;
    return nameMatch && deptMatch;
  });

  renderRoundsTable(filtered);
}

function formatTimeToAMPM(time) {
  if (!time) return '-';
  const [hour, minute] = time.split(':').slice(0, 2);
  const h = parseInt(hour);
  const m = minute;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayHour = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return `${displayHour}:${m} ${ampm}`;
}

// Global store for group data
let groupDataStore = {};

function renderRoundsTable(records) {
  const tbody = document.getElementById('hourlyRoundsTableBody');
  if (!tbody) return;

  if (!records || records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="no-records" style="padding: 3rem; text-align: center; color: var(--text-muted);">No professors scheduled for this date.</td></tr>';
    return;
  }

  // Clear the data store for fresh render
  groupDataStore = {};

  // Flatten all subjects from all employees into a single array with employee info
  const allSubjects = [];
  records.forEach(record => {
    if (record.subjects && record.subjects.length > 0) {
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
    }
  });

  // Sort all subjects by start_time (earliest first)
  allSubjects.sort((a, b) => {
    const timeA = (a.start_time || '23:59:59');
    const timeB = (b.start_time || '23:59:59');
    return timeA.localeCompare(timeB);
  });

  // GROUP by employee + time (start_time + end_time)
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

  // Convert grouped data to array and sort
  const groupedRecords = Object.values(groupedData).sort((a, b) => {
    return (a.start_time || '23:59:59').localeCompare(b.start_time || '23:59:59');
  });

  // Render grouped rows
  const rowsHTML = groupedRecords.map((group) => {
    const firstSubject = group.subjects[0];
    const statusClass = firstSubject.verified_status === 'verified' 
      ? 'status-verified' 
      : firstSubject.verified_status === 'late'
      ? 'status-late'
      : firstSubject.verified_status === 'absent'
      ? 'status-absent'
      : 'status-unverified';

    const statusText = firstSubject.verified_status === 'verified'
      ? 'Verified'
      : firstSubject.verified_status === 'late'
      ? 'Late'
      : firstSubject.verified_status === 'absent'
      ? 'Absent'
      : 'Unverified';

    // Build subject display (deduplicate by subject code, combine sections)
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
      return `<div style="margin-bottom: 8px;">
        <div style="font-weight: 500; color: var(--text-primary);">${subj.subject_code}</div>
        <div style="font-size: 11px; color: var(--text-muted);">${subj.subject_name}</div>
        <div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">Sections: ${uniqueSections}</div>
      </div>`;
    }).join('');

    // Build locations display (unique locations only)
    const uniqueLocations = [...new Set(group.subjects.map(subj => subj.room_name))];
    const locationsHTML = uniqueLocations.map(location => {
      return `<div style="font-size: 12px; margin-bottom: 3px;">${location}</div>`;
    }).join('');

    // Create unique group identifier for radio buttons
    const groupIdentifier = `${group.employee_id}-${group.start_time}-${group.end_time}`;

    // Store group data for later retrieval
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
      <tr style="border-bottom: 1px solid var(--border-primary);${!group.has_checked_in ? 'background: rgba(245, 158, 11, 0.05);' : ''}">
        <td style="padding: 12px 16px; font-weight: 600; color: var(--text-primary);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span>${group.employeeName}</span>
            ${!group.has_checked_in ? '<span style="font-size: 11px; background: #f59e0b; color: white; padding: 2px 6px; border-radius: 4px; font-weight: 600;">NO CHECK-IN</span>' : ''}
          </div>
          <div style="font-size: 11px; color: var(--text-muted);">ID: ${group.employee_id}</div>
        </td>
        <td style="padding: 12px 16px;">
          <div style="font-size: 13px; color: var(--text-secondary);">${group.department}</div>
        </td>
        
        <td style="padding: 12px 16px;">
          ${subjectsHTML}
        </td>
        
        <td style="padding: 12px 16px;">
          <div style="font-size: 13px;">${formatTimeToAMPM(group.start_time)} - ${formatTimeToAMPM(group.end_time)}</div>
        </td>
        
        <td style="padding: 12px 16px;">
          ${locationsHTML}
        </td>
        
        <td style="padding: 12px 16px;">
          <div class="status-radio-group">
            <label class="radio-option verified-option">
              <input type="radio" name="status-group-${groupIdentifier}" value="verified" ${firstSubject.verified_status === 'verified' ? 'checked' : ''} onchange="window.handleGroupStatusChange('${groupIdentifier}', '${group.date}', this)">
              <span class="radio-icon">✓</span>
              <span class="radio-label">Verified</span>
            </label>
            <label class="radio-option late-option">
              <input type="radio" name="status-group-${groupIdentifier}" value="late" ${firstSubject.verified_status === 'late' ? 'checked' : ''} onchange="window.handleGroupStatusChange('${groupIdentifier}', '${group.date}', this)">
              <span class="radio-icon">⚠</span>
              <span class="radio-label">Late</span>
            </label>
            <label class="radio-option absent-option">
              <input type="radio" name="status-group-${groupIdentifier}" value="absent" ${firstSubject.verified_status === 'absent' ? 'checked' : ''} onchange="window.handleGroupStatusChange('${groupIdentifier}', '${group.date}', this)">
              <span class="radio-icon">✕</span>
              <span class="radio-label">Absent</span>
            </label>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rowsHTML;

  // Attach global function for group status change
  window.handleGroupStatusChange = handleGroupStatusChange;
}

async function handleGroupStatusChange(groupIdentifier, date, radioInput) {
  const newStatus = radioInput.value;
  
  // Retrieve group data from store
  const groupData = groupDataStore[groupIdentifier];
  if (!groupData || !groupData.subjects) {
    console.error('Group data not found for:', groupIdentifier);
    radioInput.checked = false;
    return;
  }
  
  try {
    // Update ALL subjects in this group with the same status
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

    console.log(`[Hourly Rounds] Group ${groupIdentifier} updated to ${newStatus}`);
  } catch (error) {
    console.error('Verify group error:', error);
    radioInput.checked = false;
  }
}

// Utility: Debounce function for search
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
}
