
import {
  getMySchedule,
  getNextWeeksRange,
  getCurrentWeekRange,
  formatDateForDisplay,
  formatTimeForDisplay,
  getShiftColor,
  formatDateForAPI
} from '../../shared/scheduling-api.js';

let currentScheduleView = 'week'; // 'week' or 'month'
let currentCalendarMonth = new Date();
let currentUser = null;

// Initialize Schedule Module
export async function initSchedule(user) {
  if (!user) return;
  currentUser = user;
  console.log('[Schedule] Initializing module...');

  // DOM Elements
  const scheduleWeekBtn = document.getElementById('scheduleWeekBtn');
  const scheduleMonthBtn = document.getElementById('scheduleMonthBtn');
  const calendarPrevBtn = document.getElementById('calendarPrevBtn');
  const calendarNextBtn = document.getElementById('calendarNextBtn');

  // Event listeners for view toggle buttons
  if (scheduleWeekBtn) scheduleWeekBtn.addEventListener('click', () => switchScheduleView('week'));
  if (scheduleMonthBtn) scheduleMonthBtn.addEventListener('click', () => switchScheduleView('month'));

  // Calendar navigation
  if (calendarPrevBtn) {
    calendarPrevBtn.addEventListener('click', () => {
      currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() - 1);
      loadCalendarView();
    });
  }

  if (calendarNextBtn) {
    calendarNextBtn.addEventListener('click', () => {
      currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() + 1);
      loadCalendarView();
    });
  }

  // Initial load
  setTimeout(async () => {
    try {
      console.log('[Schedule] Page loaded, calling loadMySchedule for user', user.employee_id);
      await loadMySchedule();
    } catch (error) {
      console.error('[Schedule] Failed to load on page load:', error);
    }
  }, 500);

  // Export refresh function
  window.refreshSchedule = loadMySchedule;
}

/**
 * Switch between week and month view
 */
function switchScheduleView(view) {
  currentScheduleView = view;

  // DOM Elements
  const scheduleWeekBtn = document.getElementById('scheduleWeekBtn');
  const scheduleMonthBtn = document.getElementById('scheduleMonthBtn');
  const tableView = document.getElementById('scheduleTableView');
  const calendarView = document.getElementById('scheduleCalendarView');

  // Update button states
  if (scheduleWeekBtn && scheduleMonthBtn) {
    if (view === 'week') {
      scheduleWeekBtn.classList.add('active');
      scheduleMonthBtn.classList.remove('active');
    } else {
      scheduleWeekBtn.classList.remove('active');
      scheduleMonthBtn.classList.add('active');
    }
  }

  if (view === 'week') {
    if (tableView) tableView.style.display = 'block';
    if (calendarView) calendarView.style.display = 'none';
    loadMySchedule();
  } else {
    if (tableView) tableView.style.display = 'none';
    if (calendarView) calendarView.style.display = 'block';
    loadCalendarView();
  }
}

/**
 * Load and display employee schedule (Week View)
 */
async function loadMySchedule() {
  const scheduleList = document.getElementById('scheduleList');
  const scheduleEmptyState = document.getElementById('schedule-empty-state');
  const scheduleLoadingState = document.getElementById('schedule-loading-state');

  try {
    // Show loading
    if (scheduleLoadingState) scheduleLoadingState.style.display = 'block';
    if (scheduleList) scheduleList.innerHTML = '';
    if (scheduleEmptyState) scheduleEmptyState.style.display = 'none';

    // Get date range based on current view
    let dateRange;
    if (currentScheduleView === 'week') {
      dateRange = getCurrentWeekRange();
    } else {
      dateRange = getNextWeeksRange(4);
    }

    // Fetch schedule from API
    const schedules = await getMySchedule(dateRange.startDate, dateRange.endDate);

    // Hide loading
    if (scheduleLoadingState) scheduleLoadingState.style.display = 'none';

    // Check if empty
    if (!schedules || (Array.isArray(schedules) && schedules.length === 0)) {
      if (scheduleEmptyState) scheduleEmptyState.style.display = 'block';
      updateDashboardSchedule([]); // Update dashboard with empty
      return;
    }

    // Sort by date
    schedules.sort((a, b) => new Date(a.scheduleDate) - new Date(b.scheduleDate));

    // Render schedule table
    renderScheduleTable(schedules);
    updateDashboardSchedule(schedules);

  } catch (error) {
    console.error('[loadMySchedule] Error:', error);
    if (scheduleLoadingState) scheduleLoadingState.style.display = 'none';
    if (scheduleEmptyState) {
      scheduleEmptyState.style.display = 'block';
      const msg = scheduleEmptyState.querySelector('p:last-child');
      if (msg) msg.textContent = 'Failed to load schedule. Please try again.';
    }
    updateDashboardSchedule([]); // Fail safe
  }
}

/**
 * Update the Dashboard "My Schedule" Card
 */
function updateDashboardSchedule(schedules) {
  const dashList = document.getElementById('dashboardScheduleList');
  if (!dashList) return;

  // Reset innerHTML with empty state hidden by default
  const emptyStateHTML = `
        <div class="dashboard-empty-state" id="scheduleEmptyStateWidget" style="display: none;">
            <div class="empty-icon">📅</div>
            <p>No shifts scheduled</p>
        </div>
    `;
  dashList.innerHTML = emptyStateHTML;

  // Filter for today/future
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // We only want to show upcoming or today's shifts on the dashboard
  const upcoming = schedules.filter(s => {
    const d = new Date(s.scheduleDate);
    d.setHours(0, 0, 0, 0);
    return d >= now;
  }).slice(0, 2); // Show top 2

  if (upcoming.length === 0) {
    const el = dashList.querySelector('#scheduleEmptyStateWidget');
    if (el) el.style.display = 'flex';
    return;
  }

  upcoming.forEach((s, index) => {
    const d = new Date(s.scheduleDate);
    d.setHours(0, 0, 0, 0);
    const isToday = d.getTime() === now.getTime();

    const typeClass = isToday ? 'current' : 'upcoming';
    const label = isToday ? 'Current' : 'Upcoming';
    const labelColor = isToday ? 'var(--accent-primary)' : 'var(--text-secondary)';

    // Format Time
    let timeRange = 'Off';
    if (s.shiftStartTime && s.shiftEndTime) {
      // Basic cleaner formatting (assuming HH:mm:ss from API)
      const formatTime = (t) => {
        const [h, m] = t.split(':');
        const hour = parseInt(h);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        return `${hour12}:${m} ${ampm}`;
      };
      timeRange = `${formatTime(s.shiftStartTime)} - ${formatTime(s.shiftEndTime)}`;
    }

    const dateStr = isToday ? `Today, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : isToday ? 'Tomorrow' // Logic error in manual check? simplify
        : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    // Fix date display logic
    // We want Day Name and Date Number for the box
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNum = d.getDate();

    const item = document.createElement('div');
    item.className = 'schedule-item';
    item.innerHTML = `
        <div class="date-box ${isToday ? 'today' : ''}">
            <span class="date-day">${dayName}</span>
            <span class="date-num">${dayNum}</span>
        </div>
        <div class="schedule-details">
            <span class="schedule-title">${label}</span>
            <span class="schedule-time">${timeRange}</span>
        </div>
    `;
    dashList.appendChild(item);
  });
}

/**
 * Render schedule table rows
 */
function renderScheduleTable(schedules) {
  const scheduleList = document.getElementById('scheduleList');
  if (!scheduleList) return;

  scheduleList.innerHTML = '';

  schedules.forEach(schedule => {
    const tr = document.createElement('tr');

    // Format date
    const date = new Date(schedule.scheduleDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const scheduleDate = new Date(date);
    scheduleDate.setHours(0, 0, 0, 0);

    const isToday = scheduleDate.getTime() === today.getTime();
    const isPast = scheduleDate < today;

    // Date column
    const dateCell = document.createElement('td');
    dateCell.textContent = formatDateForDisplay(schedule.scheduleDate);
    if (isToday) dateCell.style.fontWeight = '600';
    tr.appendChild(dateCell);

    // Day column
    const dayCell = document.createElement('td');
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    dayCell.textContent = dayName;
    tr.appendChild(dayCell);

    // Shift column with color badge
    const shiftCell = document.createElement('td');
    const shiftBadge = document.createElement('span');
    shiftBadge.className = 'shift-badge';
    shiftBadge.textContent = schedule.shiftType || 'N/A';
    shiftBadge.style.backgroundColor = getShiftColor(schedule.shiftType);
    shiftBadge.style.color = 'white';
    shiftBadge.style.padding = '4px 12px';
    shiftBadge.style.borderRadius = '12px';
    shiftBadge.style.fontSize = '13px';
    shiftBadge.style.fontWeight = '500';
    shiftCell.appendChild(shiftBadge);
    tr.appendChild(shiftCell);

    // Time column
    const timeCell = document.createElement('td');
    if (schedule.shiftStartTime && schedule.shiftEndTime) {
      const startTime = formatTimeForDisplay(schedule.shiftStartTime);
      const endTime = formatTimeForDisplay(schedule.shiftEndTime);
      timeCell.textContent = `${startTime} - ${endTime}`;
    } else {
      timeCell.textContent = 'Off';
      timeCell.style.color = 'var(--text-secondary)';
    }
    tr.appendChild(timeCell);

    // Duration column
    const durationCell = document.createElement('td');
    let duration = 0;
    if (schedule.shiftStartTime && schedule.shiftEndTime) {
      const start = new Date(`1970-01-01T${schedule.shiftStartTime}`);
      const end = new Date(`1970-01-01T${schedule.shiftEndTime}`);
      if (end < start) end.setDate(end.getDate() + 1); // Handle overnight
      duration = (end - start) / (1000 * 60 * 60);
    }

    if (duration > 0) {
      durationCell.textContent = `${duration.toFixed(1)} hrs`;
    } else {
      durationCell.textContent = 'Off';
      durationCell.style.color = 'var(--text-secondary)';
    }
    tr.appendChild(durationCell);

    // Status column
    const statusCell = document.createElement('td');
    const statusBadge = document.createElement('span');
    statusBadge.className = 'schedule-status-badge';

    if (isToday) {
      statusBadge.textContent = 'Today';
      statusBadge.style.backgroundColor = '#2196F3';
      statusBadge.style.color = 'white';
    } else if (isPast) {
      statusBadge.textContent = 'Past';
      statusBadge.style.backgroundColor = '#E0E0E0';
      statusBadge.style.color = '#757575';
    } else {
      statusBadge.textContent = 'Upcoming';
      statusBadge.style.backgroundColor = '#4CAF50';
      statusBadge.style.color = 'white';
    }

    statusBadge.style.padding = '4px 12px';
    statusBadge.style.borderRadius = '12px';
    statusBadge.style.fontSize = '12px';
    statusBadge.style.fontWeight = '500';
    statusCell.appendChild(statusBadge);
    tr.appendChild(statusCell);

    // Add CSS class for styling
    if (isToday) tr.classList.add('schedule-row-today');
    if (isPast) tr.classList.add('schedule-row-past');

    scheduleList.appendChild(tr);
  });
}

/**
 * Load and render calendar view
 */
async function loadCalendarView() {
  const calendarGrid = document.getElementById('calendarGrid');
  const calendarMonthLabel = document.getElementById('calendarMonthLabel');
  const calendarLoading = document.getElementById('calendar-loading-state');

  try {
    if (!calendarGrid) return;

    // Show loading
    if (calendarLoading) calendarLoading.style.display = 'block';
    calendarGrid.innerHTML = '';

    // Calculate month date range
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Get start and end dates including padding days
    const startDay = new Date(firstDay);
    startDay.setDate(startDay.getDate() - firstDay.getDay()); // Start from Sunday

    const endDay = new Date(lastDay);
    const daysToAdd = 6 - lastDay.getDay();
    endDay.setDate(endDay.getDate() + daysToAdd); // End on Saturday

    // Fetch schedules for the entire period
    const startDate = formatDateForAPI(startDay);
    const endDate = formatDateForAPI(endDay);

    const schedules = await getMySchedule(startDate, endDate);
    const schedulesByDate = {};
    if (Array.isArray(schedules)) {
      schedules.forEach(schedule => {
        schedulesByDate[schedule.scheduleDate] = schedule;
      });
    }

    // Update month label
    const monthName = currentCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (calendarMonthLabel) calendarMonthLabel.textContent = monthName;

    // Render day headers
    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.forEach(day => {
      const header = document.createElement('div');
      header.className = 'calendar-day-header';
      header.textContent = day;
      calendarGrid.appendChild(header);
    });

    // Render calendar days
    const currentDate = new Date(startDay);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    while (currentDate <= endDay) {
      const dayEl = document.createElement('div');
      dayEl.className = 'calendar-day';

      // Check if day is in current month
      if (currentDate.getMonth() !== month) {
        dayEl.classList.add('other-month');
      }

      // Check if today
      const checkDate = new Date(currentDate);
      checkDate.setHours(0, 0, 0, 0);
      if (checkDate.getTime() === today.getTime()) {
        dayEl.classList.add('today');
      }

      // Day number
      const dayNumber = document.createElement('div');
      dayNumber.className = 'calendar-day-number';
      dayNumber.textContent = currentDate.getDate();
      dayEl.appendChild(dayNumber);

      // Day content (shift info)
      const dayContent = document.createElement('div');
      dayContent.className = 'calendar-day-content';

      const dateStr = formatDateForAPI(currentDate);
      const schedule = schedulesByDate[dateStr];

      if (schedule && schedule.shiftType) {
        const shiftBadge = document.createElement('div');
        shiftBadge.className = 'calendar-shift-badge';
        shiftBadge.textContent = schedule.shiftType;
        shiftBadge.style.backgroundColor = getShiftColor(schedule.shiftType);
        dayContent.appendChild(shiftBadge);

        if (schedule.shiftStartTime && schedule.shiftEndTime) {
          const shiftTime = document.createElement('div');
          shiftTime.className = 'calendar-shift-time';
          const startTime = formatTimeForDisplay(schedule.shiftStartTime);
          const endTime = formatTimeForDisplay(schedule.shiftEndTime);
          shiftTime.textContent = `${startTime} - ${endTime}`;
          dayContent.appendChild(shiftTime);
        }
      }

      dayEl.appendChild(dayContent);
      calendarGrid.appendChild(dayEl);

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Hide loading
    if (calendarLoading) calendarLoading.style.display = 'none';

  } catch (error) {
    console.error('[Calendar] Error:', error);
    if (calendarLoading) {
      calendarLoading.innerHTML = '<p style="color: var(--text-error);">Failed to load calendar</p>';
    }
  }
}
