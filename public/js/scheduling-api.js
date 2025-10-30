/**
 * scheduling-api.js
 * Shared API functions for scheduling operations
 * Used by Employee, Department Head, and HR dashboards
 */

// fetchWithAuth is provided globally by config.js
// We don't use ES6 imports here since config.js uses window global assignment

/**
 * Get schedules for a date range with optional filters
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @param {number} deptId - Optional department filter
 * @param {number} employeeId - Optional employee filter
 * @returns {Promise<Array>} Array of schedule objects
 */
export async function getSchedules(startDate, endDate, deptId = null, employeeId = null) {
    try {
        const params = new URLSearchParams({
            start_date: startDate,
            end_date: endDate
        });
        
        if (deptId) params.append('dept_id', deptId);
        if (employeeId) params.append('employee_id', employeeId);
        
        const url = `/api/schedules?${params.toString()}`;
        console.log('[getSchedules] Calling:', url);
        
        const response = await window.fetchWithAuth(url);
        
        console.log('[getSchedules] Response status:', response.status);
        
        if (!response.ok) {
            const error = await response.json();
            console.error('[getSchedules] Error response:', error);
            throw new Error(error.error || 'Failed to fetch schedules');
        }
        
        const result = await response.json();
        console.log('[getSchedules] Success, data:', result.data);
        return result.data || [];
    } catch (error) {
        console.error('Error fetching schedules:', error);
        throw error;
    }
}

/**
 * Get employee's own schedule
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of schedule objects
 */
export async function getMySchedule(startDate, endDate) {
    // Backend automatically filters to current user's schedule for employees
    return getSchedules(startDate, endDate);
}

/**
 * Create a new schedule
 * @param {Object} scheduleData - Schedule data
 * @returns {Promise<Object>} Created schedule
 */
export async function createSchedule(scheduleData) {
    try {
        const response = await window.fetchWithAuth('/api/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scheduleData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create schedule');
        }
        
        const result = await response.json();
        return result.data;
    } catch (error) {
        console.error('Error creating schedule:', error);
        throw error;
    }
}

/**
 * Update an existing schedule
 * @param {number} scheduleId - Schedule ID
 * @param {Object} updateData - Updated schedule data
 * @returns {Promise<Object>} Updated schedule
 */
export async function updateSchedule(scheduleId, updateData) {
    try {
        const response = await window.fetchWithAuth(`/api/schedules/${scheduleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update schedule');
        }
        
        const result = await response.json();
        return result.data;
    } catch (error) {
        console.error('Error updating schedule:', error);
        throw error;
    }
}

/**
 * Delete a schedule
 * @param {number} scheduleId - Schedule ID
 * @returns {Promise<void>}
 */
export async function deleteSchedule(scheduleId) {
    try {
        const response = await window.fetchWithAuth(`/api/schedules/${scheduleId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete schedule');
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error deleting schedule:', error);
        throw error;
    }
}

/**
 * Create multiple schedules at once
 * @param {Array<Object>} schedules - Array of schedule objects
 * @returns {Promise<Object>} Bulk create result
 */
export async function bulkCreateSchedules(schedules) {
    try {
        const response = await window.fetchWithAuth('/api/schedules/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schedules })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create schedules');
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error bulk creating schedules:', error);
        throw error;
    }
}

/**
 * Copy schedules from one week to another
 * @param {string} sourceStartDate - Source week start date (YYYY-MM-DD)
 * @param {string} targetStartDate - Target week start date (YYYY-MM-DD)
 * @param {number} deptId - Department ID
 * @returns {Promise<Object>} Copy result
 */
export async function copyWeekSchedules(sourceStartDate, targetStartDate, deptId) {
    try {
        const response = await window.fetchWithAuth('/api/schedules/copy-week', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_start_date: sourceStartDate,
                target_start_date: targetStartDate,
                dept_id: deptId
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to copy schedules');
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error copying week schedules:', error);
        throw error;
    }
}

/**
 * Get all available shift types
 * @returns {Promise<Array>} Array of shift type objects
 */
export async function getShiftTypes() {
    try {
        const response = await window.fetchWithAuth('/api/shift-types');
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to fetch shift types');
        }
        
        const result = await response.json();
        return result.data || [];
    } catch (error) {
        console.error('Error fetching shift types:', error);
        throw error;
    }
}

/**
 * Format date for API (YYYY-MM-DD)
 * @param {Date} date - Date object
 * @returns {string} Formatted date string
 */
export function formatDateForAPI(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Get date range for next N weeks
 * @param {number} weeks - Number of weeks
 * @returns {Object} Object with startDate and endDate
 */
export function getNextWeeksRange(weeks = 2) {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + (weeks * 7));
    
    return {
        startDate: formatDateForAPI(today),
        endDate: formatDateForAPI(endDate)
    };
}

/**
 * Get start and end of current week (Monday to Sunday)
 * @returns {Object} Object with startDate and endDate
 */
export function getCurrentWeekRange() {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start
    
    const monday = new Date(today.setDate(diff));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    return {
        startDate: formatDateForAPI(monday),
        endDate: formatDateForAPI(sunday)
    };
}

/**
 * Format time for display (HH:MM AM/PM)
 * @param {string} time24 - Time in 24-hour format (HH:MM:SS)
 * @returns {string} Formatted time string
 */
export function formatTimeForDisplay(time24) {
    if (!time24) return 'N/A';
    
    const [hours, minutes] = time24.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    
    return `${hour12}:${minutes} ${ampm}`;
}

/**
 * Format date for display (Day, Mon DD)
 * @param {string} dateString - Date string (YYYY-MM-DD)
 * @returns {string} Formatted date string
 */
export function formatDateForDisplay(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

/**
 * Get shift color by shift type name
 * @param {string} shiftType - Shift type name
 * @returns {string} Hex color code
 */
export function getShiftColor(shiftType) {
    const colors = {
        'Full-Day': '#4CAF50',
        'Morning': '#2196F3',
        'Afternoon': '#FF9800',
        'Evening': '#9C27B0',
        'Half-Day': '#FFC107',
        'Off': '#E0E0E0'
    };
    
    return colors[shiftType] || '#757575';
}
