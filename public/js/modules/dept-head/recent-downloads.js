/**
 * Recent Downloads Module
 * Department Head Dashboard - Display recent report downloads
 */

const RECENT_DOWNLOADS_LIMIT = 5;

/**
 * Initialize recent downloads functionality
 */
export async function initializeRecentDownloads() {
  try {
    await loadRecentDownloads();
    console.log('[RecentDownloads] Module initialized');
  } catch (error) {
    console.error('[RecentDownloads] Initialization error:', error);
  }
}

/**
 * Load and display recent downloads
 */
async function loadRecentDownloads() {
  try {
    const apiBase = window.API_URL || '/api';
    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/report-history?_page=1&_limit=${RECENT_DOWNLOADS_LIMIT}`);
    
    if (!response.ok) {
      console.warn('[RecentDownloads] Failed to fetch history');
      displayNoDownloads();
      return;
    }

    const result = await response.json();
    const downloads = result.data || [];

    if (downloads.length === 0) {
      displayNoDownloads();
      return;
    }

    displayDownloads(downloads);
  } catch (error) {
    console.error('[RecentDownloads] Error loading downloads:', error);
    displayErrorState();
  }
}

/**
 * Display download items
 */
function displayDownloads(downloads) {
  const container = document.querySelector('.downloads-list');
  if (!container) return;

  container.innerHTML = downloads.map(download => `
    <div class="download-item">
      <div class="download-info">
        <svg class="download-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <circle cx="12" cy="18" r="0.5" fill="currentColor" />
          <text x="12" y="20" font-size="10" text-anchor="middle"></text>
        </svg>
        <div>
          <p class="download-name">${formatReportName(download)}</p>
          <p class="download-meta">${formatTimestamp(download.generated_at)} • ${download.file_format.toUpperCase()}</p>
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Format report name for display
 */
function formatReportName(download) {
  let reportLabel = 'Report';
  
  if (download.report_type === 'attendance') {
    reportLabel = `Attendance Report - ${capitalizeFirstLetter(download.report_timeline)}`;
  } else if (download.report_type === 'curriculum_audit') {
    reportLabel = 'Curriculum Coverage Audit';
  }

  // Add date range if available
  if (download.date_from && download.date_to) {
    const sameDate = download.date_from === download.date_to;
    if (sameDate) {
      reportLabel += ` (${formatDateShort(download.date_from)})`;
    } else {
      reportLabel += ` (${formatDateShort(download.date_from)} - ${formatDateShort(download.date_to)})`;
    }
  }

  return reportLabel;
}

/**
 * Format timestamp to relative time
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return 'Just now';
  
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

  return formatDateShort(timestamp);
}

/**
 * Format date to short format (MM-DD-YYYY)
 */
function formatDateShort(dateStr) {
  if (!dateStr) return '';
  
  const date = new Date(dateStr);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  return `${month}-${day}-${year}`;
}

/**
 * Capitalize first letter
 */
function capitalizeFirstLetter(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Display no downloads message
 */
function displayNoDownloads() {
  const container = document.querySelector('.downloads-list');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align: center; padding: 20px; color: #6b7280;">
      <p style="margin: 0; font-size: 14px;">No reports generated yet</p>
      <p style="margin: 5px 0 0 0; font-size: 12px; color: #9ca3af;">Start by generating your first attendance or curriculum report</p>
    </div>
  `;
}

/**
 * Display error state
 */
function displayErrorState() {
  const container = document.querySelector('.downloads-list');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align: center; padding: 20px; color: #ef4444;">
      <p style="margin: 0; font-size: 14px;">Failed to load download history</p>
    </div>
  `;
}

/**
 * Refresh recent downloads (callable from other modules)
 */
export async function refreshRecentDownloads() {
  await loadRecentDownloads();
}

// Auto-refresh every 30 seconds when window is in focus
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadRecentDownloads();
    }
  });
}
