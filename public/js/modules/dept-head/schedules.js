const API_BASE = '/api/curriculum';

const FALLBACK_DEPARTMENTS = {
	1: 'Information Technology',
	2: 'Computer Science'
};

const DAY_OPTIONS = [
	{ value: 'M', label: 'M' },
	{ value: 'T', label: 'T' },
	{ value: 'W', label: 'W' },
	{ value: 'Th', label: 'Th' },
	{ value: 'F', label: 'F' },
	{ value: 'Sat', label: 'Sat' },
	{ value: 'Sun', label: 'Sun' }
];

const DAY_ALIASES = {
	Monday: 'M', Mon: 'M', M: 'M',
	Tuesday: 'T', Tue: 'T', T: 'T',
	Wednesday: 'W', Wed: 'W', W: 'W',
	Thursday: 'Th', Thu: 'Th', TH: 'Th', TR: 'Th', Th: 'Th',
	Friday: 'F', Fri: 'F', F: 'F',
	Saturday: 'Sat', Sat: 'Sat', Sa: 'Sat', S: 'Sat',
	Sunday: 'Sun', Sun: 'Sun', Su: 'Sun', U: 'Sun'
};

let loadedSchedules = [];
let currentViewingScheduleId = null;
let selectedSwapRow = null;
let departmentsById = { ...FALLBACK_DEPARTMENTS };

export function initSchedules() {
	console.log('[DepartmentHead] Initializing schedules module...');
	bindEventListeners();
	loadSchedules();
}

function bindEventListeners() {
	document.getElementById('scheduleFilterLevel')?.addEventListener('change', loadSchedules);
	document.getElementById('scheduleFilterTerm')?.addEventListener('change', loadSchedules);
	document.getElementById('scheduleFilterDept')?.addEventListener('change', loadSchedules);

	document.getElementById('btnNewSchedule')?.addEventListener('click', () => openCreateScheduleModal());
	document.getElementById('btnCloneTerm')?.addEventListener('click', openCloneTermModal);
	document.getElementById('btnAddSubject')?.addEventListener('click', () => addSubjectRow());
	document.getElementById('btnEditAddSubject')?.addEventListener('click', () => addSubjectRow('editSubjectsListContainer'));

	document.getElementById('createScheduleForm')?.addEventListener('submit', handleCreateSchedule);
	document.getElementById('editScheduleForm')?.addEventListener('submit', handleUpdateSchedule);
	document.getElementById('cloneTermForm')?.addEventListener('submit', handleCloneTerm);
}

function populateDepartmentSelects(departments) {
	const createSelect = document.querySelector('#createScheduleForm select[name="dept_id"]');
	const editSelect = document.querySelector('#editScheduleForm select[name="dept_id"]');
	const filterSelect = document.getElementById('scheduleFilterDept');

	const populate = (selectEl, placeholderText, keepFirstOption = false) => {
		if (!selectEl) return;

		const firstOption = selectEl.querySelector('option[value=""]');
		selectEl.innerHTML = '';

		if (firstOption) {
			selectEl.appendChild(firstOption);
		} else if (placeholderText) {
			const placeholder = document.createElement('option');
			placeholder.value = '';
			placeholder.textContent = placeholderText;
			selectEl.appendChild(placeholder);
		}

		departments.forEach(department => {
			const option = document.createElement('option');
			option.value = department.dept_id;
			option.textContent = department.dept_name;
			selectEl.appendChild(option);
		});

		if (keepFirstOption && selectEl.options.length && selectEl.options[0].value !== '') {
			const option = document.createElement('option');
			option.value = '';
			option.textContent = placeholderText;
			selectEl.insertBefore(option, selectEl.firstChild);
		}
	};

	populate(createSelect, 'Select Department');
	populate(editSelect, 'Select Department');
	populate(filterSelect, 'All Departments');
}

function syncDepartmentsFromSchedules(schedules) {
	const departments = [];
	const seenDepartmentIds = new Set();

	(schedules || []).forEach(schedule => {
		const deptId = schedule?.dept_id;
		if (deptId == null) return;

		const deptKey = String(deptId);
		if (seenDepartmentIds.has(deptKey)) return;
		seenDepartmentIds.add(deptKey);

		const deptName = schedule.department?.dept_name || departmentsById[deptId] || FALLBACK_DEPARTMENTS[deptId] || `Department ${deptId}`;
		departmentsById[deptId] = deptName;
		departments.push({ dept_id: deptId, dept_name: deptName });
	});

	if (departments.length > 0) {
		populateDepartmentSelects(departments);
	}
}

async function loadSchedules() {
	const container = document.getElementById('schedulesGrid');
	if (!container) return;

	container.innerHTML = '<div class="loading-spinner"></div>';

	try {
		const params = new URLSearchParams();
		const yearLevel = document.getElementById('scheduleFilterLevel')?.value || '';
		const term = document.getElementById('scheduleFilterTerm')?.value || '';
		const dept = document.getElementById('scheduleFilterDept')?.value || '';

		if (yearLevel) params.set('year_level', yearLevel);
		if (term) params.set('term', term);
		if (dept) params.set('dept_id', dept);

		const response = await fetch(`${API_BASE}${params.toString() ? `?${params.toString()}` : ''}`);
		if (!response.ok) {
			throw new Error('Failed to fetch schedules');
		}

		const result = await response.json();
		loadedSchedules = Array.isArray(result) ? result : (result.data || []);
		syncDepartmentsFromSchedules(loadedSchedules);
		renderSchedules(loadedSchedules);
	} catch (error) {
		console.error('[DepartmentHead] Error loading schedules:', error);
		container.innerHTML = '';
		const message = document.createElement('div');
		message.className = 'error-message';
		message.textContent = `Error loading schedules: ${error.message}`;
		container.appendChild(message);
	}
}

function renderSchedules(schedules) {
	const container = document.getElementById('schedulesGrid');
	if (!container) return;

	container.innerHTML = '';

	if (!schedules || schedules.length === 0) {
		container.innerHTML = `
			<div class="empty-state">
				<div class="empty-icon">📅</div>
				<h3>No Schedules Found</h3>
				<p>Create a new section schedule or clone from a previous term.</p>
			</div>
		`;
		return;
	}

	schedules.forEach(schedule => {
		const subjects = getScheduleSubjects(schedule);
		const unassignedCount = subjects.filter(subject => !subject.assigned_professor_id).length;
		const statusClass = unassignedCount === 0 ? 'status-success' : 'status-warning';
		const statusText = unassignedCount === 0 ? 'Completed' : `${unassignedCount} Needs Assignment`;
		const departmentName = schedule.department?.dept_name || getDepartmentName(schedule.dept_id);

		const card = document.createElement('div');
		card.className = 'schedule-card';
		card.dataset.templateId = String(schedule.template_id);
		card.innerHTML = `
			<div class="schedule-header">
				<div class="schedule-title">
					<h4>Section ${escapeHtml(schedule.section_name || '-')}</h4>
					<span class="schedule-meta">${escapeHtml(String(schedule.year_level || ''))} Year • ${escapeHtml(schedule.term || '-')}</span>
				</div>
				<div class="schedule-actions">
					<button type="button" class="btn-edit-schedule" onclick="window.editSchedule(${Number(schedule.template_id)}); event.stopPropagation();">EDIT</button>
					<button type="button" class="btn-clone-schedule" onclick="window.cloneSchedule(${Number(schedule.template_id)}); event.stopPropagation();">CLONE</button>
					<button type="button" class="btn-delete-schedule" onclick="window.deleteSchedule(${Number(schedule.template_id)}); event.stopPropagation();">DELETE</button>
				</div>
			</div>
			<div class="schedule-body">
				<div class="info-row"><span class="label">School Year</span><span class="value">${escapeHtml(schedule.school_year || '-')}</span></div>
				<div class="info-row"><span class="label">Department</span><span class="value">${escapeHtml(departmentName)}</span></div>
				<div class="info-row"><span class="label">Subjects</span><span class="value">${subjects.length} Subjects</span></div>
			</div>
			<div class="schedule-footer"><span class="status-badge ${statusClass}">${statusText}</span></div>
		`;

		card.addEventListener('click', () => openViewScheduleModal(schedule.template_id));
		container.appendChild(card);
	});
}

function openCreateScheduleModal(prefillSchedule = null) {
	const modal = document.getElementById('createScheduleModal');
	const form = document.getElementById('createScheduleForm');
	if (!modal || !form) return;

	selectedSwapRow = null;
	form.reset();
	form.querySelectorAll('.input-required-empty').forEach(element => element.classList.remove('input-required-empty'));

	if (prefillSchedule) {
		form.querySelector('[name="dept_id"]').value = prefillSchedule.dept_id || '';
		form.querySelector('[name="year_level"]').value = prefillSchedule.year_level || '';
		form.querySelector('[name="school_year"]').value = prefillSchedule.school_year || '';
		form.querySelector('[name="term"]').value = prefillSchedule.term || '';

		const sectionInput = form.querySelector('[name="section_name"]');
		if (sectionInput) {
			sectionInput.value = '';
			sectionInput.classList.add('input-required-empty');
		}
	}

	const container = document.getElementById('subjectsListContainer');
	if (container) {
		container.innerHTML = '';
		const subjects = prefillSchedule ? getScheduleSubjects(prefillSchedule) : [];
		if (subjects.length > 0) {
			sortSubjectsByTime(subjects).forEach(subject => addSubjectRow('subjectsListContainer', subject));
		} else {
			addSubjectRow('subjectsListContainer');
		}
	}

	modal.classList.add('visible');
}

function openEditScheduleModal(id) {
	const schedule = loadedSchedules.find(item => Number(item.template_id) === Number(id));
	const modal = document.getElementById('editScheduleModal');
	const form = document.getElementById('editScheduleForm');
	if (!schedule || !modal || !form) {
		showToast('Schedule not found', 'error');
		return;
	}

	selectedSwapRow = null;
	form.reset();
	form.querySelector('[name="template_id"]').value = schedule.template_id;
	form.querySelector('[name="dept_id"]').value = schedule.dept_id || '';
	form.querySelector('[name="year_level"]').value = schedule.year_level || '';
	form.querySelector('[name="section_name"]').value = schedule.section_name || '';
	form.querySelector('[name="school_year"]').value = schedule.school_year || '';
	form.querySelector('[name="term"]').value = schedule.term || '';

	const container = document.getElementById('editSubjectsListContainer');
	if (container) {
		container.innerHTML = '';
		const subjects = getScheduleSubjects(schedule);
		if (subjects.length > 0) {
			sortSubjectsByTime(subjects).forEach(subject => addSubjectRow('editSubjectsListContainer', subject));
		} else {
			addSubjectRow('editSubjectsListContainer');
		}
	}

	modal.classList.add('visible');
}

function openViewScheduleModal(id) {
	const schedule = loadedSchedules.find(item => Number(item.template_id) === Number(id));
	const modal = document.getElementById('viewScheduleModal');
	if (!schedule || !modal) {
		showToast('Schedule not found', 'error');
		return;
	}

	currentViewingScheduleId = Number(id);
	document.getElementById('viewDeptName').value = getDepartmentName(schedule.dept_id);
	document.getElementById('viewYearLevel').value = getOrdinalYearLevel(schedule.year_level);
	document.getElementById('viewSchoolYear').value = schedule.school_year || '';
	document.getElementById('viewTerm').value = schedule.term || '';
	document.getElementById('viewSectionName').value = schedule.section_name || '';

	const container = document.getElementById('viewSubjectsListContainer');
	if (!container) return;

	container.innerHTML = '';
	const subjects = getScheduleSubjects(schedule);

	if (subjects.length > 0) {
		sortSubjectsByTime(subjects).forEach(subject => {
			const row = document.createElement('div');
			row.className = 'view-subject-row';
			row.innerHTML = `
				<div class="col-code">${escapeHtml(subject.subject_code || '-')}</div>
				<div class="col-name">${escapeHtml(subject.subject_name || '-')}</div>
				<div class="col-days">${escapeHtml(formatDays(subject.days_of_week))}</div>
				<div class="col-time">${escapeHtml(convertTo12Hour(subject.start_time))} - ${escapeHtml(convertTo12Hour(subject.end_time))}</div>
				<div class="col-room">${escapeHtml(subject.room_name || '-')}</div>
			`;
			container.appendChild(row);
		});
	} else {
		const emptyRow = document.createElement('div');
		emptyRow.className = 'view-subject-row';
		emptyRow.innerHTML = `
			<div class="col-code">-</div>
			<div class="col-name">No subjects loaded</div>
			<div class="col-days">-</div>
			<div class="col-time">-</div>
			<div class="col-room">-</div>
		`;
		container.appendChild(emptyRow);
	}

	modal.classList.add('visible');
}

function openCloneTermModal() {
	document.getElementById('cloneTermModal')?.classList.add('visible');
}

function addSubjectRow(containerId = 'subjectsListContainer', data = null) {
	const container = document.getElementById(containerId);
	if (!container) return;

	const row = document.createElement('div');
	row.className = 'subject-row-entry';

	const days = data?.days_of_week || '';
	row.innerHTML = `
		<div class="col-code">
			<input type="text" name="subject_code" value="${escapeAttribute(data?.subject_code || '')}" placeholder="Code" required>
		</div>
		<div class="col-name">
			<input type="text" name="subject_name" value="${escapeAttribute(data?.subject_name || '')}" placeholder="Subject Name" required>
		</div>
		<div class="col-days">
			${renderDaySelector(days)}
		</div>
		<div class="col-time">
			<div class="time-range-group">
				<input type="time" name="start_time" value="${escapeAttribute(data?.start_time || '')}" required>
				<span>-</span>
				<input type="time" name="end_time" value="${escapeAttribute(data?.end_time || '')}" required>
			</div>
		</div>
		<div class="col-room">
			<input type="text" name="room_name" value="${escapeAttribute(data?.room_name || '')}" placeholder="Room" required>
		</div>
		<div class="col-action">
			<button type="button" class="btn-swap-row" onclick="window.swapSubjectTimes(this)" title="Swap Times with Another Subject">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 12l-3-3m3 3l3-3M17 8v12m0-12l3 3m-3-3l-3 3"></path></svg>
			</button>
			<button type="button" class="btn-remove-row" onclick="this.closest('.subject-row-entry').remove()" title="Remove Subject">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 14h10l1-14"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>
			</button>
		</div>
	`;

	container.appendChild(row);

	const codeInput = row.querySelector('input[name="subject_code"]');
	codeInput?.addEventListener('input', event => {
		event.target.value = event.target.value.toUpperCase();
	});

	wireDaySelector(row);
}

function renderDaySelector(daysValue) {
	const selectedDays = new Set(normalizeDayValues(daysValue));
	const hiddenValue = DAY_OPTIONS.filter(day => selectedDays.has(day.value)).map(day => day.value).join(', ');

	const buttons = DAY_OPTIONS.map(day => {
		const isSelected = selectedDays.has(day.value);
		return `
			<button type="button" class="day-pill${isSelected ? ' is-selected' : ''}" data-day="${day.value}" aria-pressed="${isSelected}">${day.label}</button>
		`;
	}).join('');

	return `
		<input type="hidden" name="days" value="${escapeAttribute(hiddenValue)}">
		<div class="day-selector" role="group" aria-label="Select class days">
			${buttons}
		</div>
	`;
}

function wireDaySelector(row) {
	const hiddenInput = row.querySelector('input[name="days"]');
	const dayButtons = row.querySelectorAll('.day-pill');

	if (!hiddenInput || dayButtons.length === 0) return;

	const syncDaysValue = () => {
		const selectedDays = Array.from(dayButtons)
			.filter(button => button.classList.contains('is-selected'))
			.map(button => button.dataset.day)
			.filter(Boolean);

		hiddenInput.value = selectedDays.join(', ');
	};

	dayButtons.forEach(button => {
		button.addEventListener('click', () => {
			const isSelected = button.classList.toggle('is-selected');
			button.setAttribute('aria-pressed', String(isSelected));
			syncDaysValue();
		});
	});

	syncDaysValue();
}

function getSubjectsFromContainer(containerId) {
	const container = document.getElementById(containerId);
	if (!container) return [];

	const rows = container.querySelectorAll('.subject-row-entry');
	const subjects = [];

	rows.forEach(row => {
		const daysValue = row.querySelector('[name="days"]')?.value || '';
		subjects.push({
			subject_code: row.querySelector('[name="subject_code"]')?.value || '',
			subject_name: row.querySelector('[name="subject_name"]')?.value || '',
			days_of_week: normalizeDayValues(daysValue),
			start_time: row.querySelector('[name="start_time"]')?.value || '',
			end_time: row.querySelector('[name="end_time"]')?.value || '',
			room_name: row.querySelector('[name="room_name"]')?.value || ''
		});
	});

	return sortSubjectsByTime(subjects);
}

function getScheduleSubjects(schedule) {
	const subjects = schedule?.subjects;
	if (Array.isArray(subjects)) return subjects;

	if (typeof subjects === 'string') {
		try {
			const parsed = JSON.parse(subjects);
			return Array.isArray(parsed) ? parsed : [];
		} catch (error) {
			return [];
		}
	}

	return [];
}

function normalizeDayValues(daysValue) {
	if (!daysValue) return [];

	const sourceValues = Array.isArray(daysValue) ? daysValue : String(daysValue).split(',');
	return sourceValues.map(value => String(value).trim()).map(value => DAY_ALIASES[value] || value).filter(Boolean);
}

function formatDays(daysValue) {
	return normalizeDayValues(daysValue).join(', ');
}

function convertTo12Hour(time24) {
	if (!time24) return '-';

	const [hoursText, minutesText = '00'] = String(time24).split(':');
	let hours = Number.parseInt(hoursText, 10);
	if (Number.isNaN(hours)) return '-';

	const period = hours >= 12 ? 'PM' : 'AM';
	if (hours > 12) hours -= 12;
	if (hours === 0) hours = 12;

	return `${hours}:${minutesText} ${period}`;
}

function getOrdinalYearLevel(year) {
	const value = Number.parseInt(year, 10);
	if (value === 1) return '1st Year';
	if (value === 2) return '2nd Year';
	if (value === 3) return '3rd Year';
	if (value === 4) return '4th Year';
	return Number.isNaN(value) ? '-' : `${value} Year`;
}

function getDepartmentName(deptId) {
	return departmentsById[deptId] || FALLBACK_DEPARTMENTS[deptId] || 'N/A';
}

function sortSubjectsByTime(subjects) {
	const DAY_ORDER = {
		Monday: 0, M: 0,
		Tuesday: 1, T: 1,
		Wednesday: 2, W: 2,
		Thursday: 3, Th: 3, TH: 3, TR: 3,
		Friday: 4, F: 4,
		Saturday: 5, Sat: 5,
		Sunday: 6, Sun: 6
	};

	return [...subjects].sort((left, right) => {
		const leftDays = normalizeDayValues(left.days_of_week);
		const rightDays = normalizeDayValues(right.days_of_week);
		const leftDay = leftDays[0] || '';
		const rightDay = rightDays[0] || '';
		const leftOrder = DAY_ORDER[leftDay] ?? 999;
		const rightOrder = DAY_ORDER[rightDay] ?? 999;

		if (leftOrder !== rightOrder) {
			return leftOrder - rightOrder;
		}

		return String(left.start_time || '').localeCompare(String(right.start_time || ''));
	});
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
	return escapeHtml(value).replaceAll('`', '&#96;');
}

async function handleCreateSchedule(event) {
	event.preventDefault();
	const submitButton = document.querySelector('button[form="createScheduleForm"][type="submit"]');
	const originalText = submitButton?.textContent || 'Create Schedule';
	if (submitButton) {
		submitButton.textContent = 'Saving...';
		submitButton.disabled = true;
	}

	try {
		const formData = new FormData(event.target);
		const subjects = getSubjectsFromContainer('subjectsListContainer');

		if (subjects.length === 0) {
			throw new Error('Add at least one subject');
		}

		if (subjects.some(subject => !subject.days_of_week || subject.days_of_week.length === 0)) {
			throw new Error('Select at least one day for each subject');
		}

		const payload = {
			dept_id: formData.get('dept_id'),
			year_level: formData.get('year_level'),
			section_name: formData.get('section_name'),
			school_year: formData.get('school_year'),
			term: formData.get('term'),
			subjects
		};

		const response = await fetch(API_BASE, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const errorPayload = await response.json().catch(() => ({}));
			throw new Error(errorPayload.message || 'Failed to create schedule');
		}

		closeModal('createScheduleModal');
		await loadSchedules();
		showToast('Schedule created successfully', 'success');
	} catch (error) {
		console.error('[DepartmentHead] Create schedule failed:', error);
		showToast(error.message, 'error');
	} finally {
		if (submitButton) {
			submitButton.textContent = originalText;
			submitButton.disabled = false;
		}
	}
}

async function handleUpdateSchedule(event) {
	event.preventDefault();
	const submitButton = document.querySelector('button[form="editScheduleForm"][type="submit"]');
	const originalText = submitButton?.textContent || 'Save Changes';
	if (submitButton) {
		submitButton.textContent = 'Saving...';
		submitButton.disabled = true;
	}

	try {
		const formData = new FormData(event.target);
		const templateId = formData.get('template_id');
		const subjects = getSubjectsFromContainer('editSubjectsListContainer');

		if (subjects.length === 0) {
			throw new Error('Add at least one subject');
		}

		if (subjects.some(subject => !subject.days_of_week || subject.days_of_week.length === 0)) {
			throw new Error('Select at least one day for each subject');
		}

		const payload = {
			dept_id: formData.get('dept_id'),
			year_level: formData.get('year_level'),
			section_name: formData.get('section_name'),
			school_year: formData.get('school_year'),
			term: formData.get('term'),
			subjects
		};

		const response = await fetch(`${API_BASE}/${templateId}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const errorPayload = await response.json().catch(() => ({}));
			throw new Error(errorPayload.message || 'Failed to update schedule');
		}

		closeModal('editScheduleModal');
		await loadSchedules();
		showToast('Schedule updated successfully', 'success');
	} catch (error) {
		console.error('[DepartmentHead] Update schedule failed:', error);
		showToast(error.message, 'error');
	} finally {
		if (submitButton) {
			submitButton.textContent = originalText;
			submitButton.disabled = false;
		}
	}
}

async function handleCloneTerm(event) {
	event.preventDefault();
	const submitButton = document.querySelector('button[form="cloneTermForm"][type="submit"]');
	const originalText = submitButton?.textContent || 'Clone Schedules';
	if (submitButton) {
		submitButton.textContent = 'Cloning...';
		submitButton.disabled = true;
	}

	try {
		const formData = new FormData(event.target);
		const payload = {
			from_school_year: formData.get('from_school_year'),
			from_term: formData.get('from_term'),
			to_school_year: formData.get('to_school_year'),
			to_term: formData.get('to_term')
		};

		const response = await fetch(`${API_BASE}/clone`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const errorPayload = await response.json().catch(() => ({}));
			throw new Error(errorPayload.message || 'Failed to clone term');
		}

		closeModal('cloneTermModal');
		await loadSchedules();
		showToast('Term cloned successfully', 'success');
	} catch (error) {
		console.error('[DepartmentHead] Clone term failed:', error);
		showToast(error.message, 'error');
	} finally {
		if (submitButton) {
			submitButton.textContent = originalText;
			submitButton.disabled = false;
		}
	}
}

function openEditScheduleModalFromView() {
	if (currentViewingScheduleId != null) {
		closeModal('viewScheduleModal');
		openEditScheduleModal(currentViewingScheduleId);
	}
}

function closeModal(id) {
	document.getElementById(id)?.classList.remove('visible');
}

function showToast(message, type = 'info') {
	const toast = document.createElement('div');
	toast.textContent = message;
	toast.setAttribute('role', 'status');

	const accent = type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : '#2563eb';

	Object.assign(toast.style, {
		position: 'fixed',
		bottom: '20px',
		right: '20px',
		zIndex: '10000',
		maxWidth: '360px',
		padding: '12px 16px',
		borderRadius: '12px',
		background: 'var(--bg-secondary)',
		color: 'var(--text-primary)',
		border: '1px solid var(--border-primary)',
		borderLeft: `4px solid ${accent}`,
		boxShadow: '0 12px 28px rgba(0, 0, 0, 0.18)',
		fontWeight: '600',
		lineHeight: '1.4',
		opacity: '0',
		transform: 'translateY(8px)',
		transition: 'opacity 0.2s ease, transform 0.2s ease'
	});

	document.body.appendChild(toast);
	requestAnimationFrame(() => {
		toast.style.opacity = '1';
		toast.style.transform = 'translateY(0)';
	});

	window.setTimeout(() => {
		toast.style.opacity = '0';
		toast.style.transform = 'translateY(8px)';
		window.setTimeout(() => toast.remove(), 220);
	}, 2600);
}

window.closeModal = closeModal;
window.editSchedule = id => openEditScheduleModal(id);
window.deleteSchedule = async id => {
	const schedule = loadedSchedules.find(item => Number(item.template_id) === Number(id));
	if (!schedule) {
		showToast('Schedule not found', 'error');
		return;
	}

	const confirmed = window.confirm(
		`Are you sure you want to delete the schedule for Section ${schedule.section_name} (${schedule.year_level} Year, ${schedule.term})?\n\nThis action cannot be undone.`
	);

	if (!confirmed) return;

	try {
		const response = await fetch(`${API_BASE}/${id}`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' }
		});

		if (!response.ok) {
			const errorPayload = await response.json().catch(() => ({}));
			throw new Error(errorPayload.message || 'Failed to delete schedule');
		}

		loadedSchedules = loadedSchedules.filter(item => Number(item.template_id) !== Number(id));
		renderSchedules(loadedSchedules);
		showToast(`Schedule for Section ${schedule.section_name} deleted successfully`, 'success');
	} catch (error) {
		console.error('[DepartmentHead] Delete schedule failed:', error);
		showToast(error.message, 'error');
	}
};

window.cloneSchedule = id => {
	const schedule = loadedSchedules.find(item => Number(item.template_id) === Number(id));
	if (!schedule) {
		showToast('Schedule not found', 'error');
		return;
	}

	openCreateScheduleModal({
		...schedule,
		section_name: ''
	});

	const sectionInput = document.querySelector('#createScheduleForm [name="section_name"]');
	sectionInput?.classList.add('input-required-empty');
};

window.openEditScheduleModalFromView = openEditScheduleModalFromView;
window.swapSubjectTimes = button => {
	const currentRow = button.closest('.subject-row-entry');
	if (!currentRow) return;

	if (!selectedSwapRow) {
		selectedSwapRow = currentRow;
		currentRow.classList.add('swap-selected');
		button.classList.add('swap-active');
		showToast('Click another subject to swap times with', 'info');
		return;
	}

	if (selectedSwapRow === currentRow) {
		currentRow.classList.remove('swap-selected');
		button.classList.remove('swap-active');
		selectedSwapRow = null;
		showToast('Swap cancelled', 'info');
		return;
	}

	const firstStart = selectedSwapRow.querySelector('[name="start_time"]');
	const firstEnd = selectedSwapRow.querySelector('[name="end_time"]');
	const secondStart = currentRow.querySelector('[name="start_time"]');
	const secondEnd = currentRow.querySelector('[name="end_time"]');

	if (!firstStart || !firstEnd || !secondStart || !secondEnd) return;

	const tempStart = firstStart.value;
	const tempEnd = firstEnd.value;

	firstStart.value = secondStart.value;
	firstEnd.value = secondEnd.value;
	secondStart.value = tempStart;
	secondEnd.value = tempEnd;

	selectedSwapRow.classList.remove('swap-selected');
	selectedSwapRow.querySelector('.btn-swap-row')?.classList.remove('swap-active');
	selectedSwapRow = null;

	showToast('Times swapped successfully', 'success');
};
