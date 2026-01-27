/**
 * curriculum-api.js
 * API functions for fetching and managing curriculum-based schedules
 * Replaces the old shift-based scheduling system
 */

/**
 * Get professor's assigned schedule across all curriculum sections
 * @returns {Promise<Array>} Array of curriculum templates with assigned subjects
 */
export async function getMySchedule() {
  try {
    const url = '/api/employee/schedule';
    console.log('[getMySchedule] Calling:', url);

    const response = await window.fetchWithAuth(url);

    console.log('[getMySchedule] Response status:', response.status);

    if (!response.ok) {
      const error = await response.json();
      console.error('[getMySchedule] Error response:', error);
      throw new Error(error.error || 'Failed to fetch schedule');
    }

    const result = await response.json();
    console.log('[getMySchedule] Success, data:', result.data);
    return result.data || [];
  } catch (error) {
    console.error('[getMySchedule] Error:', error);
    throw error;
  }
}

/**
 * Convert time string (HH:mm:ss) to 12-hour format with AM/PM
 * @param {string} timeStr - Time in HH:mm:ss format
 * @returns {string} Formatted time like "9:00 AM"
 */
export function formatTimeForDisplay(timeStr) {
  if (!timeStr) return '';
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

/**
 * Format date for display
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {string} Formatted date
 */
export function formatDateForDisplay(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Get day abbreviation from days array
 * @param {Array} daysArray - Array like ["M", "W", "F"]
 * @returns {string} Formatted like "M, W, F"
 */
export function formatDaysOfWeek(daysArray) {
  if (!Array.isArray(daysArray) || daysArray.length === 0) {
    return '';
  }
  return daysArray.join(', ');
}

/**
 * Get day names from days array
 * @param {Array} daysArray - Array like ["M", "W", "F"]
 * @returns {string} Formatted like "Monday, Wednesday, Friday"
 */
export function getDayNames(daysArray) {
  if (!Array.isArray(daysArray) || daysArray.length === 0) {
    return '';
  }

  const dayMap = {
    'M': 'Monday',
    'T': 'Tuesday',
    'W': 'Wednesday',
    'TH': 'Thursday',
    'F': 'Friday',
    'Sat': 'Saturday',
    'Sun': 'Sunday'
  };

  return daysArray.map(day => dayMap[day] || day).join(', ');
}
