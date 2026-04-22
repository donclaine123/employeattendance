import { escapeHtml } from './utils.js';

let analyticsReportsInitialized = false;
let analyticsReportsLoading = null;
let analyticsReportsCache = null;
let analyticsReportsRefreshBound = false;

const ANALYTICS_DAYS = 7;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getApiBase() {
  return window.API_URL || '/api';
}

function formatDayLabel(dateValue) {
  if (!dateValue) return '-';

  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return String(dateValue);
  }

  return date.toLocaleDateString([], { weekday: 'short' });
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = String(value);
  }
}

function setPlaceholder(id, message) {
  const element = document.getElementById(id);
  if (element) {
    element.innerHTML = `
      <div style="min-height: 220px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); text-align: center; padding: 20px;">
        ${escapeHtml(message)}
      </div>
    `;
  }
}

function setAnalyticsLoadingState() {
  setPlaceholder('deptAnalyticsTrendChart', 'Loading attendance trend...');
  setPlaceholder('deptAnalyticsHourlyTrendChart', 'Loading hourly attendance trend...');
  const reviewList = document.getElementById('deptAnalyticsReviewList');
  if (reviewList) {
    reviewList.innerHTML = '<div style="padding: 12px 14px; border: 1px solid var(--border-primary); border-radius: 12px; background: var(--bg-input); color: var(--text-muted);">Loading review items...</div>';
  }
}

function renderAnalyticsErrorState(message) {
  setPlaceholder('deptAnalyticsTrendChart', message);
  setPlaceholder('deptAnalyticsHourlyTrendChart', message);
  const reviewList = document.getElementById('deptAnalyticsReviewList');
  if (reviewList) {
    reviewList.innerHTML = `<div style="padding: 12px 14px; border: 1px solid var(--border-primary); border-radius: 12px; background: var(--bg-input); color: var(--text-muted);">${escapeHtml(message)}</div>`;
  }
}

function refreshAnalyticsReportsIfVisible() {
  const section = document.getElementById('section-analytics-reports');
  const analyticsPanel = document.getElementById('analyticsReportsAnalyticsPanel');

  if (!section || section.hidden || !analyticsPanel || analyticsPanel.hidden) {
    return;
  }

  void loadAnalyticsReportsData(true);
}

function renderStackedTrend(containerId, points, options) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!Array.isArray(points) || points.length === 0) {
    setPlaceholder(containerId, options.emptyMessage || 'No trend data available yet.');
    return;
  }

  const segments = Array.isArray(options.segments) ? options.segments : [];
  const maxTotal = Math.max(
    ...points.map(point => segments.reduce((sum, segment) => sum + toNumber(point[segment.key]), 0)),
    1
  );

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(${points.length}, minmax(0, 1fr)); gap: 10px; align-items: end; min-height: 220px;">
      ${points.map(point => {
        const total = segments.reduce((sum, segment) => sum + toNumber(point[segment.key]), 0);
        const barHeight = total > 0 ? Math.max(18, Math.round((total / maxTotal) * 150)) : 0;
        const dayLabel = formatDayLabel(point.date);

        return `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0;">
            <div style="height: 160px; width: 100%; display: flex; align-items: flex-end; justify-content: center;">
              <div style="width: 22px; height: ${barHeight}px; display: flex; flex-direction: column-reverse; overflow: hidden; border-radius: 999px; background: rgba(148, 163, 184, 0.12); box-shadow: inset 0 0 0 1px var(--border-primary);">
                ${segments.map(segment => {
                  const value = toNumber(point[segment.key]);
                  const segmentHeight = total > 0 ? Math.round((value / total) * barHeight) : 0;
                  return `<span title="${escapeHtml(segment.label)}: ${value}" style="display: block; width: 100%; height: ${segmentHeight}px; background: ${segment.color};"></span>`;
                }).join('')}
              </div>
            </div>
            <div style="font-size: 11px; font-weight: 700; color: var(--text-primary);">${escapeHtml(dayLabel)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderReviewList(items) {
  const container = document.getElementById('deptAnalyticsReviewList');
  if (!container) return;

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = '<div style="padding: 12px 14px; border: 1px solid var(--border-primary); border-radius: 12px; background: var(--bg-input); color: var(--text-muted);">No review items yet.</div>';
    return;
  }

  const toneStyles = {
    danger: {
      background: 'rgba(239, 68, 68, 0.12)',
      color: '#ef4444'
    },
    warning: {
      background: 'rgba(245, 158, 11, 0.12)',
      color: '#f59e0b'
    },
    neutral: {
      background: 'rgba(148, 163, 184, 0.12)',
      color: 'var(--text-secondary)'
    },
    success: {
      background: 'rgba(16, 185, 129, 0.12)',
      color: '#10b981'
    }
  };

  container.innerHTML = items.slice(0, 3).map(item => {
    const tone = toneStyles[item.tone] || toneStyles.neutral;
    const title = item.title || item.label || 'Review item';
    const note = item.note || '';
    const value = item.value ?? 0;

    return `
      <div style="padding: 12px 14px; border: 1px solid var(--border-primary); border-radius: 12px; background: var(--bg-input);">
        <div style="display: flex; justify-content: space-between; gap: 12px; align-items: flex-start;">
          <div>
            <strong style="display: block; color: var(--text-primary); margin-bottom: 4px; font-size: 14px;">${escapeHtml(title)}</strong>
            <p style="margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.45;">${escapeHtml(note)}</p>
          </div>
          <span style="display: inline-flex; align-items: center; justify-content: center; min-width: 40px; padding: 5px 10px; border-radius: 999px; background: ${tone.background}; color: ${tone.color}; font-size: 12px; font-weight: 700;">${escapeHtml(value)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderAnalyticsReports(data) {
  const campusToday = data?.campusToday || {};
  const hourlyToday = data?.hourlyToday || {};

  setText('deptAnalyticsTeamSize', toNumber(data?.teamSize));
  setText('deptAnalyticsPresentToday', toNumber(campusToday.present ?? data?.presentToday ?? 0));
  setText('deptAnalyticsAbsentToday', toNumber(campusToday.absent ?? data?.absentToday ?? 0));

  renderStackedTrend('deptAnalyticsTrendChart', Array.isArray(data?.campusTrend) ? data.campusTrend : [], {
    emptyMessage: 'No attendance trend data yet.',
    segments: [
      { key: 'present', label: 'Present', color: 'var(--green-primary)' },
      { key: 'absent', label: 'Absent', color: 'var(--red-primary)' }
    ]
  });

  renderStackedTrend('deptAnalyticsHourlyTrendChart', Array.isArray(data?.hourlyTrend) ? data.hourlyTrend : [], {
    emptyMessage: 'No hourly attendance trend data yet.',
    segments: [
      { key: 'verified', label: 'Verified', color: 'var(--green-primary)' },
      { key: 'late', label: 'Late', color: 'var(--yellow-primary)' },
      { key: 'absent', label: 'Absent', color: 'var(--red-primary)' },
      { key: 'pending', label: 'Pending', color: 'var(--text-muted)' }
    ]
  });

  renderReviewList(Array.isArray(data?.reviewItems) ? data.reviewItems : [
    { title: 'On-campus absent', value: toNumber(campusToday.absent), note: 'Today', tone: 'danger' },
    { title: 'Hourly late', value: toNumber(hourlyToday.late), note: 'Today', tone: 'warning' },
    { title: 'Hourly absent', value: toNumber(hourlyToday.absent), note: 'Today', tone: 'neutral' }
  ]);
}

async function loadAnalyticsReportsData(forceRefresh = false) {
  if (!forceRefresh && analyticsReportsCache) {
    renderAnalyticsReports(analyticsReportsCache);
    return analyticsReportsCache;
  }

  if (analyticsReportsLoading) {
    return analyticsReportsLoading;
  }

  analyticsReportsLoading = (async () => {
    try {
      setAnalyticsLoadingState();

      const response = await window.fetchWithAuth(`${getApiBase()}/departmenthead/analytics-overview?days=${ANALYTICS_DAYS}`, {});
      if (!response.ok) {
        throw new Error(`Failed to load analytics (${response.status})`);
      }

      const payload = await response.json();
      const data = payload.data || payload || {};
      analyticsReportsCache = data;
      renderAnalyticsReports(data);
      return data;
    } catch (error) {
      console.error('[Analytics Reports] Error loading data:', error);
      renderAnalyticsErrorState('Analytics data is unavailable right now.');
      return null;
    } finally {
      analyticsReportsLoading = null;
    }
  })();

  return analyticsReportsLoading;
}

function setAnalyticsReportsView(view) {
  const normalizedView = view === 'analytics' || view === 'reports' ? view : 'analytics';
  const section = document.getElementById('section-analytics-reports');
  if (!section) return;

  const tabs = section.querySelectorAll('.curriculum-suite-tab[data-analytics-view]');
  const analyticsPanel = document.getElementById('analyticsReportsAnalyticsPanel');
  const reportsPanel = document.getElementById('analyticsReportsReportsPanel');

  tabs.forEach(tab => {
    const isActive = tab.getAttribute('data-analytics-view') === normalizedView;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  if (analyticsPanel) {
    analyticsPanel.hidden = normalizedView !== 'analytics';
    if (normalizedView === 'analytics') {
      analyticsPanel.style.removeProperty('display');
    } else {
      analyticsPanel.style.setProperty('display', 'none', 'important');
    }
  }

  if (reportsPanel) {
    reportsPanel.hidden = normalizedView !== 'reports';
    if (normalizedView === 'reports') {
      reportsPanel.style.removeProperty('display');
    } else {
      reportsPanel.style.setProperty('display', 'none', 'important');
    }
  }

  if (normalizedView === 'analytics') {
    void loadAnalyticsReportsData(true);
  }

  try {
    sessionStorage.setItem('depthead_analytics_reports_view', normalizedView);
  } catch (error) {
    console.debug('Could not persist analytics reports view:', error);
  }
}

export function initAnalyticsReports() {
  const section = document.getElementById('section-analytics-reports');
  if (!section) return;

  if (!analyticsReportsInitialized) {
    section.querySelectorAll('.curriculum-suite-tab[data-analytics-view]').forEach(tab => {
      tab.addEventListener('click', () => {
        setAnalyticsReportsView(tab.getAttribute('data-analytics-view') || 'analytics');
      });
    });

    analyticsReportsInitialized = true;
  }

  if (!analyticsReportsRefreshBound) {
    window.addEventListener('focus', refreshAnalyticsReportsIfVisible);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshAnalyticsReportsIfVisible();
      }
    });

    analyticsReportsRefreshBound = true;
  }

  let initialView = 'analytics';
  try {
    initialView = sessionStorage.getItem('depthead_analytics_reports_view') || 'analytics';
  } catch (error) {
    console.debug('Could not read analytics reports view:', error);
  }

  setAnalyticsReportsView(initialView);
}