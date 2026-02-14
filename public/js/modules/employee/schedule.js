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
  'Thursday': 'Thu', 'Th': 'Thu', 'TH': 'Thu', 'TR': 'Thu',
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

  // Initial load - no toggles needed, both views shown
  await loadMySchedule();

  // Export refresh function
  window.refreshSchedule = loadMySchedule;
}

function setupViewToggles() {
  // Toggle functionality removed - both views are shown side by side
  return;
}

function switchView(viewName) {
  // View switching removed - both views always visible side by side
  return;
}

/**
 * Load and display professor schedule
 */
async function loadMySchedule() {
  const loadingState = document.getElementById('schedule-loading-state');
  const emptyState = document.getElementById('schedule-empty-state');
  const weeklyContainer = document.getElementById('weeklyViewContainer');

  try {
    // Show loading state
    if (loadingState) loadingState.style.display = 'flex';
    if (emptyState) emptyState.style.display = 'none';
    
    // Show weekly container
    if (weeklyContainer) weeklyContainer.style.display = 'flex';

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

    // Update Overview Cards
    updateScheduleOverviewCards(allSubjects);

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
 * Update Schedule Overview Cards (Today, This Week, Next Class)
 */
function updateScheduleOverviewCards(subjects) {
  if (!subjects || subjects.length === 0) {
    return;
  }

  // Get today's date
  const today = new Date();
  const todayDay = today.toLocaleDateString('en-US', { weekday: 'long' });
  const dayAbbr = todayDay.substring(0, 3).charAt(0).toUpperCase() + todayDay.substring(1, 3);
  
  // Calculate today's classes
  const todayClasses = subjects.filter(s => {
    if (!s.days_of_week) return false;
    const days = Array.isArray(s.days_of_week) ? s.days_of_week : s.days_of_week.split(',').map(d => d.trim());
    return days.some(d => {
      const mapped = DAY_MAP[d] || d;
      return mapped === dayAbbr || mapped === todayDay;
    });
  });

  // Calculate this week's total classes
  const thisWeekClasses = subjects;
  
  // Find next class (first class chronologically from now)
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
  
  let nextClass = null;
  let nextClassDayLabel = '';
  
  // First, look for classes later today
  const laterToday = todayClasses.filter(s => (s.start_time || '00:00:00') > currentTime);
  if (laterToday.length > 0) {
    nextClass = laterToday[0]; // Already sorted by time
    nextClassDayLabel = 'Today';
  }
  
  // If no classes later today, find the next class by day
  if (!nextClass && thisWeekClasses.length > 0) {
    nextClass = thisWeekClasses[0];
    
    // Determine which day this class occurs on
    if (nextClass && nextClass.days_of_week) {
      const classDays = Array.isArray(nextClass.days_of_week) 
        ? nextClass.days_of_week 
        : nextClass.days_of_week.split(',').map(d => d.trim());
      
      // Map class days to DAY_ORDER indices
      const classDay = classDays[0]; // Get first day it occurs
      const mapped = DAY_MAP[classDay] || classDay;
      const classDayIndex = DAY_ORDER.indexOf(mapped);
      const todayDayIndex = DAY_ORDER.indexOf(dayAbbr);
      
      // Calculate days difference
      let daysAhead = 0;
      if (classDayIndex > todayDayIndex) {
        daysAhead = classDayIndex - todayDayIndex;
      } else if (classDayIndex < todayDayIndex) {
        daysAhead = (DAY_ORDER.length - todayDayIndex) + classDayIndex;
      }
      
      // Set label based on days ahead
      if (daysAhead === 1) {
        nextClassDayLabel = 'Tomorrow';
      } else if (daysAhead > 1) {
        nextClassDayLabel = mapped; // Show day name like "Wednesday", "Friday"
      }
    }
  }

  // Update Today Card
  const todayCard = document.getElementById('todayCard');
  if (todayCard) {
    const dayName = todayCard.querySelector('.card-day-name');
    const subtitle = todayCard.querySelector('.card-subtitle');
    
    if (dayName) dayName.textContent = todayDay;
    if (subtitle) {
      const firstClassTime = todayClasses.length > 0 ? formatTimeForDisplay(todayClasses[0].start_time) : '-';
      subtitle.textContent = `${todayClasses.length} classes • starts at ${firstClassTime}`;
    }
  }

  // Update This Week Card
  const thisWeekCard = document.getElementById('thisWeekCard');
  if (thisWeekCard) {
    const dayName = thisWeekCard.querySelector('.card-day-name');
    const subtitle = thisWeekCard.querySelector('.card-subtitle');
    
    if (dayName) dayName.textContent = `${thisWeekClasses.length} classes`;
    if (subtitle) {
      const subjectCount = new Set(thisWeekClasses.map(s => s.subject_code)).size;
      subtitle.textContent = `${subjectCount} subjects`;
    }
  }

  // Update Next Class Card
  const nextClassCard = document.getElementById('nextClassCard');
  if (nextClassCard && nextClass) {
    const dayName = nextClassCard.querySelector('.card-day-name');
    const subtitle = nextClassCard.querySelector('.card-subtitle');
    
    if (dayName) dayName.textContent = nextClass.subject_name || '-';
    if (subtitle) {
      const time = formatTimeForDisplay(nextClass.start_time);
      const room = nextClass.room_name || 'TBA';
      subtitle.textContent = `${nextClassDayLabel} • ${time} • ${room}`;
    }
  } else if (nextClassCard) {
    const dayName = nextClassCard.querySelector('.card-day-name');
    const subtitle = nextClassCard.querySelector('.card-subtitle');
    if (dayName) dayName.textContent = '-';
    if (subtitle) subtitle.textContent = 'No upcoming classes';
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

/**
 * Merge subjects by subject_code + time + days (group same classes across sections)
 */
function mergeSubjectsBySameTime(subjects) {
  const merged = {};
  
  subjects.forEach(subject => {
    const daysStr = Array.isArray(subject.days_of_week) 
      ? subject.days_of_week.join(',') 
      : (subject.days_of_week || '');
    const startTime = subject.start_time || '00:00:00';
    const endTime = subject.end_time || '00:00:00';
    
    // Create unique key for same subject+time+days
    const key = `${subject.subject_code}|${startTime}|${endTime}|${daysStr}`;
    
    if (!merged[key]) {
      merged[key] = {
        ...subject,
        sections: [subject.section_name],
        allSections: subject.section_name
      };
    } else {
      // Add section to existing entry
      if (!merged[key].sections.includes(subject.section_name)) {
        merged[key].sections.push(subject.section_name);
        merged[key].allSections = merged[key].sections.join(', ');
      }
    }
  });
  
  return Object.values(merged);
}

function getTimeColorClass(time) {
  if (!time) return 'morning';
  const hour = parseInt(time.split(':')[0]);
  if (hour < 12) return 'morning'; // Orange
  if (hour < 17) return 'afternoon'; // Blue
  return 'evening'; // Purple
}

/**
 * Render Weekly Column View - with merged sections
 */
function renderWeeklyView(subjects) {
  const grid = document.getElementById('weeklyScheduleGrid');
  console.log('[RenderWeek] Grid element:', grid);
  if (!grid) return;

  grid.innerHTML = '';
  console.log('[RenderWeek] cleared innerHTML');

  // Merge subjects with same subject_code, time, and days
  const mergedSubjects = mergeSubjectsBySameTime(subjects);

  // Create columns for Mon-Sat
  DAY_ORDER.forEach(day => {
    const col = document.createElement('div');
    col.className = 'day-column';
    col.dataset.day = day; // for mobile header

    // Filter merged subjects for this day
    const daySubjects = mergedSubjects.filter(s => {
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
          <span class="subject-code">${s.subject_code} • ${s.allSections}</span>
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
 * Render Legacy List View (Refined) - with merged sections
 */
function renderListView(subjects) {
  const container = document.getElementById('scheduleList');
  if (!container) return;
  container.innerHTML = '';

  // Merge subjects with same subject_code, time, and days
  const mergedSubjects = mergeSubjectsBySameTime(subjects);

  mergedSubjects.forEach(s => {
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
          <span>${s.allSections}</span>
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
    div.className = 'schedule-item-new';
    
    // Parse time for display
    const timeStr = formatTimeForDisplay(s.start_time);
    const [time, meridiem] = timeStr.split(' ');
    
    div.innerHTML = `
      <div class="schedule-item-time">
        <div class="schedule-item-hour">${time}</div>
        <div class="schedule-item-meridiem">${meridiem}</div>
      </div>
      <div class="schedule-item-content">
        <p class="schedule-item-title">${s.subject_code} - ${s.subject_name}</p>
        <p class="schedule-item-description">${s.description || ''}</p>
        <div class="schedule-item-details">
          ${s.room_name ? `
            <div class="schedule-item-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <span>${s.room_name}</span>
            </div>
          ` : ''}
          ${s.instructor_name ? `
            <div class="schedule-item-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              <span>Mr./Ms. ${s.instructor_name}</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    dashList.appendChild(div);
  });
}
