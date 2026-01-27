/**
 * schedule.js
 * Redesigned Schedule Module
 * Supports Weekly Column View and List View
 */

import {
  getMySchedule,
  formatTimeForDisplay
} from '../../shared/curriculum-api.js';

let currentUser = null;
let cachedTemplates = [];

// Day mapping for sorting/placing
const DAY_MAP = {
  'Monday': 'Mon', 'M': 'Mon',
  'Tuesday': 'Tue', 'T': 'Tue',
  'Wednesday': 'Wed', 'W': 'Wed',
  'Thursday': 'Thu', 'Th': 'Thu', 'TR': 'Thu',
  'Friday': 'Fri', 'F': 'Fri',
  'Saturday': 'Sat', 'Sat': 'Sat',
  'Sunday': 'Sun', 'Sun': 'Sun'
};

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Initialize Schedule Module
 */
export async function initSchedule(user) {
  if (!user) return;
  currentUser = user;

  // Setup View Toggles
  setupViewToggles();

  // Initial load
  await loadMySchedule();

  // Export refresh function
  window.refreshSchedule = loadMySchedule;
}

function setupViewToggles() {
  const toggles = document.querySelectorAll('.view-btn');
  toggles.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all
      toggles.forEach(t => t.classList.remove('active'));
      // Add to clicked
      btn.classList.add('active');

      const view = btn.dataset.view; // 'weekly' or 'list'
      switchView(view);
    });
  });
}

function switchView(viewName) {
  const weeklyContainer = document.getElementById('weeklyViewContainer');
  const listContainer = document.getElementById('listViewContainer');

  console.log('[switchView] Switching to:', viewName);

  if (viewName === 'weekly') {
    if (weeklyContainer) {
      weeklyContainer.classList.add('active');
      weeklyContainer.style.display = 'block';
    }
    if (listContainer) {
      listContainer.classList.remove('active');
      listContainer.style.display = 'none';
    }
  } else if (viewName === 'list') {
    if (weeklyContainer) {
      weeklyContainer.classList.remove('active');
      weeklyContainer.style.display = 'none';
    }
    if (listContainer) {
      listContainer.classList.add('active');
      listContainer.style.display = 'block';
    }
  }
}

/**
 * Load and display professor schedule
 */
async function loadMySchedule() {
  const loadingState = document.getElementById('schedule-loading-state');
  const emptyState = document.getElementById('schedule-empty-state');
  const weeklyContainer = document.getElementById('weeklyViewContainer');
  const listContainer = document.getElementById('listViewContainer');

  try {
    // Show loading state
    if (loadingState) loadingState.style.display = 'flex';
    if (emptyState) emptyState.style.display = 'none';
    
    // Hide both containers while loading
    if (weeklyContainer) weeklyContainer.style.display = 'none';
    if (listContainer) listContainer.style.display = 'none';

    // Fetch schedule
    console.log('[Schedule] Fetching schedule...');
    cachedTemplates = await getMySchedule();
    console.log('[Schedule] Fetched templates:', cachedTemplates);

    // Hide loading
    if (loadingState) loadingState.style.display = 'none';

    // Process Data
    console.log('[Schedule] Raw Templates:', cachedTemplates);
    const allSubjects = flattenSchedule(cachedTemplates);
    console.log('[Schedule] Flattened Subjects:', allSubjects);

    if (allSubjects.length === 0) {
      console.warn('[Schedule] No subjects found after flattening.');
      if (emptyState) emptyState.style.display = 'block';
      updateDashboardSchedule([]);
      return;
    }

    // Hide empty state
    if (emptyState) emptyState.style.display = 'none';

    // Render Views (populate both before showing)
    console.log('[Schedule] Rendering Weekly View...');
    renderWeeklyView(allSubjects);
    console.log('[Schedule] Rendering List View...');
    renderListView(allSubjects);

    // Now determine which view to show
    const activeBtn = document.querySelector('.view-btn.active');
    const currentView = activeBtn ? activeBtn.dataset.view : 'weekly';
    console.log('[Schedule] Switching to view:', currentView);
    switchView(currentView);

    // Update Dashboard Widget
    updateDashboardSchedule(cachedTemplates);

  } catch (error) {
    console.error('[loadMySchedule] Error:', error);
    if (loadingState) loadingState.style.display = 'none';
    // Show empty with error msg
    if (emptyState) {
      emptyState.style.display = 'block';
      const p = emptyState.querySelector('p');
      if (p) p.textContent = 'Error loading schedule. Please try refreshing.';
    }
  }
}

/**
 * Flatten hierarchical data (Template -> Subjects) to Subject List
 */
function flattenSchedule(templates) {
  const flat = [];
  if (!templates || !Array.isArray(templates)) {
    console.warn('[Flatten] Templates is not an array:', templates);
    return flat;
  }

  templates.forEach(t => {
    // Debug individual template
    // console.log('[Flatten] Processing template:', t.section_name, t.subjects);
    if (t.subjects && Array.isArray(t.subjects)) {
      t.subjects.forEach(s => {
        flat.push({
          ...s,
          section_name: t.section_name,
          color_class: getTimeColorClass(s.start_time || '00:00:00')
        });
      });
    } else {
      console.warn('[Flatten] Template missing subjects array:', t);
    }
  });

  // Sort by time
  return flat.sort((a, b) => {
    const timeA = a.start_time || '00:00:00';
    const timeB = b.start_time || '00:00:00';
    return timeA.localeCompare(timeB);
  });
}

function getTimeColorClass(time) {
  if (!time) return 'morning';
  const hour = parseInt(time.split(':')[0]);
  if (hour < 12) return 'morning'; // Orange
  if (hour < 17) return 'afternoon'; // Blue
  return 'evening'; // Purple
}

/**
 * Render Weekly Column View
 */
function renderWeeklyView(subjects) {
  const grid = document.getElementById('weeklyScheduleGrid');
  console.log('[RenderWeek] Grid element:', grid);
  if (!grid) return;

  grid.innerHTML = '';
  console.log('[RenderWeek] cleared innerHTML');

  // Create columns for Mon-Sat
  DAY_ORDER.forEach(day => {
    const col = document.createElement('div');
    col.className = 'day-column';
    col.dataset.day = day; // for mobile header

    // Filter subjects for this day
    const daySubjects = subjects.filter(s => {
      if (!s.days_of_week) return false;
      // Handle "M,W,F" or ["M", "W"] or "Monday"
      const days = Array.isArray(s.days_of_week) ? s.days_of_week : s.days_of_week.split(',');
      return days.some(d => {
        const cleanDay = d ? d.trim() : '';
        return DAY_MAP[cleanDay] === day;
      });
    });

    if (daySubjects.length === 0) {
      col.innerHTML = `<div class="day-empty-slot">No Classes</div>`;
    } else {
      // Render Cards
      daySubjects.forEach(s => {
        const card = document.createElement('div');
        card.className = `subject-card ${s.color_class}`;
        card.innerHTML = `
          <span class="subject-time">${formatTimeForDisplay(s.start_time)} - ${formatTimeForDisplay(s.end_time)}</span>
          <h4 class="subject-title">${s.subject_name}</h4>
          <span class="subject-code">${s.subject_code} • ${s.section_name}</span>
          <div class="subject-location">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            ${s.room_name || 'TBA'}
          </div>
        `;
        col.appendChild(card);
      });
    }
    grid.appendChild(col);
  });
}

/**
 * Render Legacy List View (Refined)
 */
function renderListView(subjects) {
  const container = document.getElementById('scheduleList');
  if (!container) return;
  container.innerHTML = '';

  subjects.forEach(s => {
    const row = document.createElement('div');
    row.className = 'schedule-subject-row';
    row.innerHTML = `
      <div class="list-time-block">
        <div>${formatTimeForDisplay(s.start_time)}</div>
        <div style="font-size:10px; color:var(--text-tertiary); margin:2px 0;">to</div>
        <div>${formatTimeForDisplay(s.end_time)}</div>
      </div>
      <div class="list-details">
        <h4>${s.subject_name}</h4>
        <div class="list-meta">
          <span>${s.subject_code}</span>
          <span>•</span>
          <span>${s.section_name}</span>
          <span>•</span>
          <span>${Array.isArray(s.days_of_week) ? s.days_of_week.join(',') : s.days_of_week}</span>
        </div>
      </div>
      <div class="subject-location">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
         ${s.room_name || 'TBA'}
      </div>
    `;
    container.appendChild(row);
  });
}

// ... updateDashboardSchedule stays mostly same or simplified ...
function updateDashboardSchedule(templates) {
  const dashList = document.getElementById('dashboardScheduleList');
  if (!dashList) return;

  // Quick simple list for dashboard (top 3)
  const flat = flattenSchedule(templates).slice(0, 3);

  dashList.innerHTML = '';

  if (flat.length === 0) {
    dashList.innerHTML = `
        <div class="dashboard-empty-state">
          <p>No classes today</p>
        </div>`;
    return;
  }

  flat.forEach(s => {
    const div = document.createElement('div');
    div.className = 'schedule-item'; // Assumes dashboard css exists
    div.innerHTML = `
           <div class="subject-badge"><span class="code">${s.subject_code}</span></div>
           <div class="schedule-details">
             <span class="schedule-title">${s.subject_name}</span>
             <span class="schedule-time">${formatTimeForDisplay(s.start_time)}</span>
           </div>
        `;
    dashList.appendChild(div);
  });
}
