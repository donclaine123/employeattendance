import { fetchHeadInfo, convertTo12Hour, escapeHtml } from './utils.js';

const API_BASE = '/api/department-head';

const DAY_ORDER = [
  { key: 'mon', label: 'Monday', short: 'Mon' },
  { key: 'tue', label: 'Tuesday', short: 'Tue' },
  { key: 'wed', label: 'Wednesday', short: 'Wed' },
  { key: 'thu', label: 'Thursday', short: 'Thu' },
  { key: 'fri', label: 'Friday', short: 'Fri' },
  { key: 'sat', label: 'Saturday', short: 'Sat' }
];

const DAY_LOOKUP = {
  monday: 'mon',
  mon: 'mon',
  m: 'mon',
  tuesday: 'tue',
  tues: 'tue',
  tue: 'tue',
  t: 'tue',
  wednesday: 'wed',
  wed: 'wed',
  w: 'wed',
  thursday: 'thu',
  thur: 'thu',
  thurs: 'thu',
  thu: 'thu',
  th: 'thu',
  tr: 'thu',
  friday: 'fri',
  fri: 'fri',
  f: 'fri',
  saturday: 'sat',
  sat: 'sat',
  sa: 'sat',
  sunday: 'sun',
  sun: 'sun',
  su: 'sun',
  u: 'sun'
};

const state = {
  deptId: null,
  deptName: '',
  professors: [],
  selectedProfessorId: null,
  scheduleCache: new Map(),
  activeRequestId: 0,
  initialized: false
};

const apiFetch = (input, options = {}) => (
  typeof window !== 'undefined' && typeof window.fetchWithAuth === 'function'
    ? window.fetchWithAuth(input, options)
    : fetch(input, options)
);

function normalizeProfessor(professor) {
  const id = Number(professor?.user_id ?? professor?.employee_id ?? professor?.id);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  const name = professor?.full_name
    || professor?.fullName
    || [professor?.first_name, professor?.last_name].filter(Boolean).join(' ')
    || professor?.email
    || 'Unknown Professor';

  return {
    id,
    name,
    email: professor?.email || '',
    position: professor?.position || ''
  };
}

function getDepartmentId(headInfo) {
  const deptId = Number(headInfo?.dept_id ?? headInfo?.department?.dept_id ?? headInfo?.department_id);
  return Number.isFinite(deptId) && deptId > 0 ? deptId : null;
}

function getDepartmentName(headInfo) {
  return headInfo?.dept_name
    || headInfo?.department?.dept_name
    || headInfo?.department_name
    || 'Department';
}

function parseTimeToMinutes(timeValue) {
  if (!timeValue) {
    return null;
  }

  const rawValue = String(timeValue).trim();
  const match = rawValue.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?$/i);
  if (!match) {
    return null;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3] ? match[3].toUpperCase() : null;

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  if (meridiem) {
    if (hours === 12) {
      hours = 0;
    }

    if (meridiem === 'PM') {
      hours += 12;
    }
  }

  return (hours * 60) + minutes;
}

function calculateMeetingHours(startTime, endTime) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
    return 0;
  }

  return Math.round(((endMinutes - startMinutes) / 60) * 100) / 100;
}

function formatCompactNumber(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return '0';
  }

  const rounded = Math.round(numericValue * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
}

function formatHours(value) {
  return `${formatCompactNumber(value)} hrs`;
}

function normalizeDayKey(value) {
  if (value == null) {
    return null;
  }

  const rawValue = String(value).trim().toLowerCase();
  if (!rawValue) {
    return null;
  }

  if (DAY_LOOKUP[rawValue]) {
    return DAY_LOOKUP[rawValue];
  }

  const compactValue = rawValue.replace(/[\s._-]/g, '');
  return DAY_LOOKUP[compactValue] || null;
}

function normalizeDays(daysValue) {
  let rawDays = [];

  if (Array.isArray(daysValue)) {
    rawDays = daysValue;
  } else if (typeof daysValue === 'string') {
    const trimmedValue = daysValue.trim();
    if (!trimmedValue) {
      rawDays = [];
    } else if (trimmedValue.startsWith('[')) {
      try {
        const parsedValue = JSON.parse(trimmedValue);
        rawDays = Array.isArray(parsedValue) ? parsedValue : [trimmedValue];
      } catch (error) {
        rawDays = trimmedValue.split(/[\s,|/;-]+/);
      }
    } else {
      rawDays = trimmedValue.split(/[\s,|/;-]+/);
    }
  }

  const normalizedDays = rawDays
    .map(normalizeDayKey)
    .filter(Boolean);

  return DAY_ORDER
    .map(day => day.key)
    .filter(dayKey => normalizedDays.includes(dayKey));
}

function getDayShortLabel(dayKey) {
  return DAY_ORDER.find(day => day.key === dayKey)?.short || dayKey;
}

function formatDaysLabel(days) {
  if (!days.length) {
    return 'No days set';
  }

  return days.map(getDayShortLabel).join(', ');
}

function formatTimeRange(startTime, endTime) {
  if (!startTime && !endTime) {
    return 'TBA';
  }

  const startLabel = startTime ? convertTo12Hour(startTime) : 'TBA';
  const endLabel = endTime ? convertTo12Hour(endTime) : 'TBA';
  return `${startLabel} - ${endLabel}`;
}

function formatSectionMeta(template) {
  const metaParts = [];
  const schoolYear = template?.school_year || template?.schoolYear || '';
  const term = template?.term || '';
  const yearLevel = template?.year_level || template?.yearLevel || '';

  if (schoolYear) {
    metaParts.push(`School Year ${schoolYear}`);
  }

  if (term) {
    metaParts.push(term);
  }

  if (yearLevel) {
    metaParts.push(`Year ${yearLevel}`);
  }

  return metaParts.length ? metaParts.join(' • ') : 'Curriculum assignment';
}

function buildAssignmentGroupKey(template, subject, days) {
  const schoolYear = template?.school_year || template?.schoolYear || '';
  const term = template?.term || '';
  const yearLevel = template?.year_level || template?.yearLevel || '';
  const subjectCode = String(subject?.subject_code || '').trim().toLowerCase();
  const startTime = String(subject?.start_time || '').trim().toLowerCase();
  const endTime = String(subject?.end_time || '').trim().toLowerCase();

  return [schoolYear, term, yearLevel, subjectCode, days.join(','), startTime, endTime].join('|');
}

function normalizeSectionLabel(sectionNames) {
  return sectionNames.length ? sectionNames.join(', ') : 'Unknown section';
}

function flattenProfessorSchedule(templates) {
  const groupedAssignments = new Map();

  (Array.isArray(templates) ? templates : []).forEach(template => {
    const subjects = Array.isArray(template?.subjects) ? template.subjects : [];

    subjects.forEach((subject, subjectIndex) => {
      const days = normalizeDays(subject?.days_of_week);
      const meetingHours = calculateMeetingHours(subject?.start_time, subject?.end_time);

      if (!days.length) {
        return;
      }

      const groupKey = buildAssignmentGroupKey(template, subject, days);
      const sectionName = String(template?.section_name || '').trim();
      const subjectCode = subject?.subject_code || 'No code';
      const subjectName = subject?.subject_name || 'Untitled subject';
      const roomName = subject?.room_name || 'TBA';

      if (!groupedAssignments.has(groupKey)) {
        groupedAssignments.set(groupKey, {
          id: `${template?.template_id || 'template'}-${subject?.subject_id || subjectIndex}-${groupedAssignments.size}`,
          templateId: template?.template_id || null,
          sectionNames: new Set(sectionName ? [sectionName] : []),
          sectionMeta: formatSectionMeta(template),
          schoolYear: template?.school_year || '',
          term: template?.term || '',
          yearLevel: template?.year_level || '',
          subjectCode,
          subjectName,
          days,
          daysLabel: formatDaysLabel(days),
          startTime: subject?.start_time || '',
          endTime: subject?.end_time || '',
          timeLabel: formatTimeRange(subject?.start_time, subject?.end_time),
          roomName,
          meetingHours,
          weeklyHours: Math.round((meetingHours * days.length) * 100) / 100,
          sectionCount: sectionName ? 1 : 0
        });
        return;
      }

      const existingAssignment = groupedAssignments.get(groupKey);
      if (sectionName) {
        existingAssignment.sectionNames.add(sectionName);
      }
      existingAssignment.sectionCount = existingAssignment.sectionNames.size;

      if (existingAssignment.roomName === 'TBA' && roomName !== 'TBA') {
        existingAssignment.roomName = roomName;
      }
    });
  });

  const assignments = Array.from(groupedAssignments.values()).map(assignment => ({
    ...assignment,
    sectionNames: Array.from(assignment.sectionNames).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })),
    sectionLabel: normalizeSectionLabel(Array.from(assignment.sectionNames).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))),
    sectionMeta: assignment.sectionCount > 1
      ? `${assignment.sectionMeta} • ${assignment.sectionCount} sections`
      : assignment.sectionMeta
  }));

  assignments.sort((left, right) => {
    const leftDayIndex = left.days.length ? DAY_ORDER.findIndex(day => day.key === left.days[0]) : DAY_ORDER.length;
    const rightDayIndex = right.days.length ? DAY_ORDER.findIndex(day => day.key === right.days[0]) : DAY_ORDER.length;

    if (leftDayIndex !== rightDayIndex) {
      return leftDayIndex - rightDayIndex;
    }

    const leftStart = parseTimeToMinutes(left.startTime) ?? Number.MAX_SAFE_INTEGER;
    const rightStart = parseTimeToMinutes(right.startTime) ?? Number.MAX_SAFE_INTEGER;

    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }

    return `${left.subjectCode} ${left.sectionLabel}`.localeCompare(`${right.subjectCode} ${right.sectionLabel}`);
  });

  return assignments;
}

function buildDayStats(assignments) {
  const stats = DAY_ORDER.map(day => ({
    key: day.key,
    label: day.label,
    short: day.short,
    classes: 0,
    hours: 0
  }));

  assignments.forEach(assignment => {
    assignment.days.forEach(dayKey => {
      const dayStat = stats.find(entry => entry.key === dayKey);
      if (!dayStat) {
        return;
      }

      dayStat.classes += 1;
      dayStat.hours = Math.round((dayStat.hours + assignment.meetingHours) * 100) / 100;
    });
  });

  return stats;
}

function buildSummary(assignments, dayStats) {
  const totalClasses = assignments.length;
  const totalHours = Math.round(assignments.reduce((sum, assignment) => sum + assignment.weeklyHours, 0) * 100) / 100;
  const activeDays = dayStats.filter(day => day.classes > 0).length;

  const busiestDay = dayStats.reduce((best, day) => {
    if (!best) {
      return day;
    }

    if (day.hours > best.hours) {
      return day;
    }

    return best;
  }, null);

  return {
    totalClasses,
    totalHours,
    activeDays,
    busiestDay: busiestDay ? busiestDay.label : '—',
    busiestDayHours: busiestDay ? busiestDay.hours : 0
  };
}

function renderNoticeMarkup(title, detail) {
  return `
    <div class="empty-state">
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(detail)}</p>
    </div>
  `;
}

function renderLoadingMarkup() {
  return `
    <div class="prof-schedule-wireframe">
      ${renderNoticeMarkup('Loading professor roster', 'Fetching the live Department Head schedule source...')}
    </div>
  `;
}

function renderErrorMarkup(message) {
  return `
    <div class="prof-schedule-wireframe">
      ${renderNoticeMarkup('Unable to load professor schedules', message)}
    </div>
  `;
}

function renderProfessorOptions(professors, selectedProfessorId) {
  if (!professors.length) {
    return '<option value="">No active professors found</option>';
  }

  return professors.map(professor => {
    const optionLabel = professor.position
      ? `${professor.name} - ${professor.position}`
      : professor.name;

    return `<option value="${professor.id}"${professor.id === selectedProfessorId ? ' selected' : ''}>${escapeHtml(optionLabel)}</option>`;
  }).join('');
}

function buildSummaryCards(summary) {
  const cards = [
    {
      label: 'Classes',
      value: formatCompactNumber(summary.totalClasses),
      meta: summary.totalClasses ? 'Assigned subjects' : 'No assigned classes yet'
    },
    {
      label: 'Weekly hours',
      value: formatHours(summary.totalHours),
      meta: 'Monday to Saturday total'
    },
    {
      label: 'Active days',
      value: formatCompactNumber(summary.activeDays),
      meta: summary.activeDays ? 'Days with scheduled meetings' : 'No class meetings yet'
    },
    {
      label: 'Busiest day',
      value: summary.busiestDay,
      meta: summary.busiestDayHours ? `${formatHours(summary.busiestDayHours)} scheduled` : 'No classes yet'
    }
  ];

  return cards.map(card => `
    <article class="prof-schedule-summary-card">
      <span class="prof-schedule-summary-label">${escapeHtml(card.label)}</span>
      <strong class="prof-schedule-summary-value">${escapeHtml(card.value)}</strong>
      <span class="prof-schedule-summary-meta">${escapeHtml(card.meta)}</span>
    </article>
  `).join('');
}

function buildDayCards(dayStats) {
  const peakHours = dayStats.reduce((maxHours, day) => Math.max(maxHours, day.hours), 0);

  return dayStats.map(day => {
    const loadPercent = peakHours > 0 ? Math.max(8, Math.round((day.hours / peakHours) * 100)) : 0;
    const hoursLabel = formatHours(day.hours);
    const classesLabel = day.classes ? `${formatCompactNumber(day.classes)} classes` : 'No classes scheduled';

    return `
      <article class="prof-schedule-day-card">
        <div class="prof-schedule-day-label">${escapeHtml(day.label)}</div>
        <div class="prof-schedule-day-hours">${escapeHtml(hoursLabel)}</div>
        <div class="prof-schedule-day-classes">${escapeHtml(classesLabel)}</div>
        <div class="prof-schedule-day-bar"><span style="--load: ${loadPercent}%;"></span></div>
      </article>
    `;
  }).join('');
}

function buildAssignmentsRows(assignments, emptyMessage) {
  if (!assignments.length) {
    return `
      <tr class="prof-schedule-empty-row">
        <td colspan="6">${escapeHtml(emptyMessage)}</td>
      </tr>
    `;
  }

  return assignments.map(assignment => `
    <tr>
      <td>
        <div class="prof-schedule-subject">
          <strong>${escapeHtml(assignment.subjectCode)}</strong>
          <span>${escapeHtml(assignment.subjectName)}</span>
        </div>
      </td>
      <td>
        <div class="prof-schedule-subject">
          <strong>${escapeHtml(assignment.sectionLabel)}</strong>
          <span>${escapeHtml(assignment.sectionMeta)}</span>
        </div>
      </td>
      <td>${escapeHtml(assignment.daysLabel)}</td>
      <td>${escapeHtml(assignment.timeLabel)}</td>
      <td>${escapeHtml(assignment.roomName)}</td>
      <td class="prof-schedule-hours">${escapeHtml(formatHours(assignment.weeklyHours))}</td>
    </tr>
  `).join('');
}

function buildWireframeMarkup({
  deptName,
  professors,
  selectedProfessor,
  assignments,
  summary,
  dayStats,
  isLoading = false,
  message = ''
}) {
  const resolvedAssignments = Array.isArray(assignments) ? assignments : [];
  const resolvedDayStats = Array.isArray(dayStats) && dayStats.length ? dayStats : buildDayStats(resolvedAssignments);
  const resolvedSummary = summary || buildSummary(resolvedAssignments, resolvedDayStats);
  const hasAssignments = resolvedAssignments.length > 0;
  const selectedProfessorName = selectedProfessor ? selectedProfessor.name : 'No professor selected';
  const calloutSubtitle = (() => {
    if (isLoading && message) {
      return message;
    }

    if (selectedProfessor && hasAssignments) {
      const positionLabel = selectedProfessor.position || 'Teaching staff';
      return `${positionLabel} • ${resolvedSummary.totalClasses} classes • ${formatHours(resolvedSummary.totalHours)} weekly load`;
    }

    if (selectedProfessor && !hasAssignments) {
      return message || `${selectedProfessor.position || 'Teaching staff'} • no assigned classes yet`;
    }

    return message || 'Choose a professor to inspect the live schedule source.';
  })();

  return `
    <div class="prof-schedule-wireframe">
      <section class="prof-schedule-hero">
        <div class="prof-schedule-hero-copy">
          <span class="prof-schedule-eyebrow">Department Head workspace</span>
          <h2 class="prof-schedule-title">Prof. Schedule</h2>
          <p class="prof-schedule-desc">Live assignments sourced from the curriculum templates service. Select a professor to inspect classes, weekly hours, and day load.</p>
        </div>
        <div class="prof-schedule-badge">${escapeHtml(deptName || 'Department')}</div>
      </section>

      <section class="prof-schedule-toolbar">
        <label class="prof-schedule-field">
          <span class="prof-schedule-label">Professor</span>
          <select class="prof-schedule-select" data-prof-schedule-select${professors.length ? '' : ' disabled'}>
            ${renderProfessorOptions(professors, selectedProfessor?.id || null)}
          </select>
        </label>

        <div class="prof-schedule-callout">
          <div>
            <strong>${escapeHtml(selectedProfessorName)}</strong>
            <span>${escapeHtml(calloutSubtitle)}</span>
          </div>
        </div>
      </section>

      <section>
        <div class="prof-schedule-section-title">
          <div>
            <h4>Workload summary</h4>
            <p>${escapeHtml(hasAssignments ? 'Aggregated from live schedule subjects' : 'Summary updates once a professor with assignments is selected')}</p>
          </div>
        </div>
        <div class="prof-schedule-summary-grid">
          ${buildSummaryCards(resolvedSummary)}
        </div>
      </section>

      <section>
        <div class="prof-schedule-section-title">
          <div>
            <h4>Monday to Saturday load</h4>
            <p>${escapeHtml(hasAssignments ? 'Hours and class counts per day' : 'No meetings found yet for the selected professor')}</p>
          </div>
        </div>
        <div class="prof-schedule-week-grid">
          ${buildDayCards(resolvedDayStats)}
        </div>
      </section>

      <section class="prof-schedule-table-shell">
        <div class="prof-schedule-section-title">
          <div>
            <h4>Assigned subjects</h4>
            <p>Weekly breakdown of the selected professor's real curriculum load.</p>
          </div>
        </div>
        <div class="prof-schedule-table-wrap">
          <table class="prof-schedule-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Section</th>
                <th>Days</th>
                <th>Time</th>
                <th>Room</th>
                <th>Weekly Hours</th>
              </tr>
            </thead>
            <tbody>
              ${buildAssignmentsRows(resolvedAssignments, message || 'No assigned classes yet for this professor.')}
            </tbody>
          </table>
        </div>
        <p class="prof-schedule-footer-note">Schedules are sourced from curriculum templates and filtered by assigned professor.</p>
      </section>
    </div>
  `;
}

function bindSelectEvents(root) {
  const select = root.querySelector('[data-prof-schedule-select]');
  if (!select || select.disabled) {
    return;
  }

  select.addEventListener('change', event => {
    const nextProfessorId = Number(event.target.value);
    if (!Number.isFinite(nextProfessorId) || nextProfessorId <= 0) {
      return;
    }

    state.selectedProfessorId = nextProfessorId;
    void loadAndRenderProfessorSchedule(root, nextProfessorId);
  });
}

async function fetchProfessorsForDepartment(deptId) {
  const response = await apiFetch(`${API_BASE}/professors?dept_id=${encodeURIComponent(deptId)}`);
  if (!response.ok) {
    let message = 'Failed to load professors.';
    try {
      const errorBody = await response.json();
      message = errorBody?.message || errorBody?.error || message;
    } catch (error) {
      void error;
    }

    throw new Error(message);
  }

  const body = await response.json();
  const records = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  return records.map(normalizeProfessor).filter(Boolean);
}

async function fetchProfessorScheduleTemplates(professorId, deptId) {
  const cacheKey = `${professorId}:${deptId}`;
  if (state.scheduleCache.has(cacheKey)) {
    return state.scheduleCache.get(cacheKey);
  }

  const response = await apiFetch(`${API_BASE}/professors/${professorId}/schedule?dept_id=${encodeURIComponent(deptId)}`);
  if (!response.ok) {
    let message = 'Failed to load professor schedule.';
    try {
      const errorBody = await response.json();
      message = errorBody?.message || errorBody?.error || message;
    } catch (error) {
      void error;
    }

    throw new Error(message);
  }

  const body = await response.json();
  const records = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  state.scheduleCache.set(cacheKey, records);
  return records;
}

function renderWireframe(root, options) {
  const assignments = Array.isArray(options.assignments) ? options.assignments : [];
  const dayStats = Array.isArray(options.dayStats) && options.dayStats.length
    ? options.dayStats
    : buildDayStats(assignments);
  const summary = options.summary || buildSummary(assignments, dayStats);
  const message = options.message || '';
  const hasAssignments = assignments.length > 0;
  const emptyMessage = options.isLoading
    ? (message || 'Loading assigned classes...')
    : (message || (hasAssignments ? '' : 'No assigned classes yet for this professor.'));

  root.innerHTML = buildWireframeMarkup({
    deptName: options.deptName || state.deptName,
    professors: options.professors || state.professors,
    selectedProfessor: options.selectedProfessor || null,
    assignments,
    summary,
    dayStats,
    isLoading: Boolean(options.isLoading),
    message: emptyMessage
  });

  bindSelectEvents(root);
}

async function loadAndRenderProfessorSchedule(root, professorId) {
  const professor = state.professors.find(entry => entry.id === professorId) || state.professors[0] || null;
  if (!professor) {
    renderWireframe(root, {
      deptName: state.deptName,
      professors: state.professors,
      selectedProfessor: null,
      assignments: [],
      isLoading: false,
      message: 'No active professors were found for this department.'
    });
    return;
  }

  const requestId = ++state.activeRequestId;
  state.selectedProfessorId = professor.id;

  renderWireframe(root, {
    deptName: state.deptName,
    professors: state.professors,
    selectedProfessor: professor,
    assignments: [],
    isLoading: true,
    message: 'Loading assigned classes...'
  });

  try {
    const templates = await fetchProfessorScheduleTemplates(professor.id, state.deptId);
    if (requestId !== state.activeRequestId) {
      return;
    }

    const assignments = flattenProfessorSchedule(templates);
    renderWireframe(root, {
      deptName: state.deptName,
      professors: state.professors,
      selectedProfessor: professor,
      assignments,
      isLoading: false,
      message: assignments.length ? '' : 'No assigned classes yet for this professor.'
    });
  } catch (error) {
    if (requestId !== state.activeRequestId) {
      return;
    }

    renderWireframe(root, {
      deptName: state.deptName,
      professors: state.professors,
      selectedProfessor: professor,
      assignments: [],
      isLoading: false,
      message: error?.message || 'Unable to load the selected professor schedule.'
    });
  }
}

function buildLoadingBlock() {
  return renderLoadingMarkup();
}

async function loadDepartmentHeadContext() {
  const headInfo = await fetchHeadInfo(true);
  if (!headInfo) {
    throw new Error('Unable to determine the current department head profile.');
  }

  const deptId = getDepartmentId(headInfo);
  if (!deptId) {
    throw new Error('The current department profile is missing a department id.');
  }

  return {
    deptId,
    deptName: getDepartmentName(headInfo)
  };
}

export async function initProfScheduleWireframe() {
  const root = document.getElementById('curriculumProfScheduleView');
  if (!root || state.initialized) {
    return;
  }

  state.initialized = true;
  root.innerHTML = buildLoadingBlock();

  try {
    const context = await loadDepartmentHeadContext();
    state.deptId = context.deptId;
    state.deptName = context.deptName;

    const professors = await fetchProfessorsForDepartment(context.deptId);
    state.professors = professors;

    if (!professors.length) {
      renderWireframe(root, {
        deptName: state.deptName,
        professors: [],
        selectedProfessor: null,
        assignments: [],
        isLoading: false,
        message: 'No active professors were found for this department.'
      });
      return;
    }

    const initialProfessor = state.selectedProfessorId
      ? professors.find(entry => entry.id === state.selectedProfessorId)
      : professors[0];

    await loadAndRenderProfessorSchedule(root, initialProfessor?.id || professors[0].id);
  } catch (error) {
    root.innerHTML = renderErrorMarkup(error?.message || 'Unable to load professor schedule data.');
  }
}
