const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent } = require('../utils/audit');

/**
 * Create schedule
 * @param {Object} scheduleData - Schedule data
 * @param {string} createdBy - User ID
 */
async function createSchedule(scheduleData, createdBy) {
  const { employeeId, startDate, endDate, shiftTypeId, notes } = scheduleData;

  if (!employeeId || !startDate || !endDate || !shiftTypeId) {
    throw new AppError('Missing required fields', 400);
  }

  try {
    const { data: newSchedule, error } = await supabase
      .from('schedules')
      .insert([{
        employee_id: employeeId,
        start_date: startDate,
        end_date: endDate,
        shift_type_id: shiftTypeId,
        notes,
        created_by: createdBy,
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent(createdBy, 'SCHEDULE_CREATED', {
      schedule_id: newSchedule.id,
      employee_id: employeeId
    });

    return newSchedule;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error creating schedule', 500);
  }
}

/**
 * Get schedules with filters
 * @param {Object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 */
async function getSchedules(filters = {}, page = 1, limit = 20) {
  try {
    console.log('[schedulingService.getSchedules] Starting with filters:', filters);
    
    let query = supabase
      .from('schedules')
      .select('*', { count: 'exact' });

    if (filters.employeeId) {
      console.log('[schedulingService.getSchedules] Filtering by employeeId:', filters.employeeId);
      query = query.eq('employee_id', filters.employeeId);
    }

    if (filters.startDate && filters.endDate) {
      console.log('[schedulingService.getSchedules] Filtering by dates:', filters.startDate, 'to', filters.endDate);
      query = query
        .gte('schedule_date', filters.startDate)
        .lte('schedule_date', filters.endDate);
    }

    if (filters.departmentId) {
      console.log('[schedulingService.getSchedules] Filtering by departmentId:', filters.departmentId);
      // Get employee IDs in this department first, then filter
      const { data: deptEmployees, error: deptError } = await supabase
        .from('employees')
        .select('id')
        .eq('department_id', filters.departmentId);
      
      console.log('[schedulingService.getSchedules] Found employees in dept:', deptEmployees?.length);
      
      if (deptError) throw deptError;
      
      if (deptEmployees?.length > 0) {
        const employeeIds = deptEmployees.map(e => e.id);
        query = query.in('employee_id', employeeIds);
      } else {
        // No employees in department, return empty
        return {
          data: [],
          pagination: { page, limit, total: 0, pages: 0 }
        };
      }
    }

    const offset = (page - 1) * limit;
    const start = offset;
    const end = offset + limit - 1;
    
    console.log('[schedulingService.getSchedules] Applying range:', start, 'to', end);
    query = query.range(start, end);
    
    console.log('[schedulingService.getSchedules] Ordering by schedule_date...');
    try {
      query = query.order('schedule_date', { ascending: true });
    } catch (orderError) {
      console.error('[schedulingService.getSchedules] Order error:', orderError);
      throw orderError;
    }

    console.log('[schedulingService.getSchedules] Executing query...');
    
    let data, count, error;
    try {
      // Add timeout to catch hanging queries
      const queryPromise = query;
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout after 10 seconds')), 10000)
      );
      
      const result = await Promise.race([queryPromise, timeoutPromise]);
      console.log('[schedulingService.getSchedules] Query completed, result:', !!result);
      data = result.data;
      count = result.count;
      error = result.error;
      console.log('[schedulingService.getSchedules] Extracted - data:', !!data, 'count:', count, 'error:', !!error);
    } catch (e) {
      console.error('[schedulingService.getSchedules] Query threw exception:', e.message);
      console.error('[schedulingService.getSchedules] Exception stack:', e.stack);
      throw e;
    }

    if (error) {
      console.error('[schedulingService.getSchedules] Query returned error:', JSON.stringify(error));
      throw error;
    }
    
    console.log('[schedulingService.getSchedules] Got data:', data?.length, 'records, count:', count);
    
    if (!data) {
      return {
        data: [],
        pagination: { page, limit, total: 0, pages: 0 }
      };
    }

    console.log('[schedulingService.getSchedules] Mapping data...');
    const mappedData = data.map(schedule => {
      console.log('[schedulingService.getSchedules] Mapping schedule:', schedule.schedule_id);
      return {
        id: schedule.schedule_id,
        employeeId: schedule.employee_id,
        scheduleDate: schedule.schedule_date,
        shiftType: schedule.shift_type,
        shiftStartTime: schedule.shift_start_time,
        shiftEndTime: schedule.shift_end_time,
        notes: schedule.notes
      };
    });
    
    console.log('[schedulingService.getSchedules] Mapped successfully, count:', count);
    const totalPages = count ? Math.ceil(count / limit) : 0;
    console.log('[schedulingService.getSchedules] Calculated pages:', totalPages);
    
    return {
      data: mappedData,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: totalPages
      }
    };
  } catch (error) {
    console.error('[schedulingService.getSchedules] Error caught:', error.message);
    console.error('[schedulingService.getSchedules] Error stack:', error.stack);
    console.error('[schedulingService.getSchedules] Error details:', JSON.stringify(error));
    if (error.isOperational) throw error;
    throw new AppError('Error fetching schedules', 500);
  }
}

/**
 * Update schedule
 * @param {string} scheduleId - Schedule ID
 * @param {Object} updates - Fields to update
 * @param {string} updatedBy - User ID
 */
async function updateSchedule(scheduleId, updates, updatedBy) {
  const allowedFields = ['start_date', 'end_date', 'shift_type_id', 'notes'];
  const scheduleUpdate = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      scheduleUpdate[key] = value;
    }
  }

  if (Object.keys(scheduleUpdate).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  scheduleUpdate.updated_at = new Date();

  try {
    const { data: updatedSchedule, error } = await supabase
      .from('schedules')
      .update(scheduleUpdate)
      .eq('id', scheduleId)
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent(updatedBy, 'SCHEDULE_UPDATED', {
      schedule_id: scheduleId,
      changes: scheduleUpdate
    });

    return updatedSchedule;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error updating schedule', 500);
  }
}

/**
 * Delete schedule
 * @param {string} scheduleId - Schedule ID
 * @param {string} deletedBy - User ID
 */
async function deleteSchedule(scheduleId, deletedBy) {
  try {
    const { error } = await supabase
      .from('schedules')
      .delete()
      .eq('id', scheduleId);

    if (error) throw error;

    await logAuditEvent(deletedBy, 'SCHEDULE_DELETED', {
      schedule_id: scheduleId
    });

    return { success: true, message: 'Schedule deleted' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error deleting schedule', 500);
  }
}

/**
 * Bulk create schedules
 * @param {Array} schedules - Array of schedule objects
 * @param {string} createdBy - User ID
 */
async function bulkCreateSchedules(schedules, createdBy) {
  if (!Array.isArray(schedules) || schedules.length === 0) {
    throw new AppError('Invalid schedules array', 400);
  }

  try {
    const schedulesWithMetadata = schedules.map(schedule => ({
      ...schedule,
      created_by: createdBy,
      created_at: new Date()
    }));

    const { data: newSchedules, error } = await supabase
      .from('schedules')
      .insert(schedulesWithMetadata)
      .select();

    if (error) throw error;

    await logAuditEvent(createdBy, 'SCHEDULES_BULK_CREATED', {
      count: newSchedules.length
    });

    return newSchedules;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error creating schedules', 500);
  }
}

/**
 * Copy schedule for a week
 * @param {string} sourceScheduleId - Source schedule ID
 * @param {number} weeks - Number of weeks to copy
 * @param {string} copiedBy - User ID
 */
async function copyScheduleForWeeks(sourceScheduleId, weeks = 1, copiedBy) {
  try {
    const { data: sourceSchedule, error: fetchError } = await supabase
      .from('schedules')
      .select('*')
      .eq('id', sourceScheduleId)
      .single();

    if (fetchError || !sourceSchedule) {
      throw new AppError('Source schedule not found', 404);
    }

    const newSchedules = [];
    const baseDate = new Date(sourceSchedule.start_date);

    for (let i = 1; i <= weeks; i++) {
      const startDate = new Date(baseDate);
      startDate.setDate(startDate.getDate() + (i * 7));

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);

      newSchedules.push({
        employee_id: sourceSchedule.employee_id,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        shift_type_id: sourceSchedule.shift_type_id,
        notes: sourceSchedule.notes,
        created_by: copiedBy,
        created_at: new Date()
      });
    }

    const { data: createdSchedules, error } = await supabase
      .from('schedules')
      .insert(newSchedules)
      .select();

    if (error) throw error;

    await logAuditEvent(copiedBy, 'SCHEDULE_COPIED', {
      source_schedule_id: sourceScheduleId,
      weeks_copied: weeks,
      count: createdSchedules.length
    });

    return createdSchedules;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error copying schedule', 500);
  }
}

/**
 * List shift types
 * @returns {Promise<Array>} Shift types
 */
async function listShiftTypes() {
  try {
    const { data, error } = await supabase
      .from('shift_types')
      .select('*')
      .order('shift_name', { ascending: true });

    if (error) throw error;

    return data;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching shift types', 500);
  }
}

/**
 * Create shift type
 * @param {Object} shiftData - Shift type data
 * @param {string} createdBy - User ID
 */
async function createShiftType(shiftData, createdBy) {
  const { name, startTime, endTime, breakMinutes } = shiftData;

  if (!name || !startTime || !endTime) {
    throw new AppError('Missing required fields', 400);
  }

  try {
    const { data: newShift, error } = await supabase
      .from('shift_types')
      .insert([{
        name,
        start_time: startTime,
        end_time: endTime,
        break_minutes: breakMinutes || 0,
        is_active: true,
        created_by: createdBy,
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent(createdBy, 'SHIFT_TYPE_CREATED', {
      shift_type_id: newShift.id,
      name
    });

    return newShift;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error creating shift type', 500);
  }
}

/**
 * Update shift type
 * @param {string} shiftTypeId - Shift type ID
 * @param {Object} updates - Fields to update
 * @param {string} updatedBy - User ID
 */
async function updateShiftType(shiftTypeId, updates, updatedBy) {
  const allowedFields = ['name', 'start_time', 'end_time', 'break_minutes'];
  const shiftUpdate = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      shiftUpdate[key] = value;
    }
  }

  if (Object.keys(shiftUpdate).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  shiftUpdate.updated_at = new Date();

  try {
    const { data: updatedShift, error } = await supabase
      .from('shift_types')
      .update(shiftUpdate)
      .eq('id', shiftTypeId)
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent(updatedBy, 'SHIFT_TYPE_UPDATED', {
      shift_type_id: shiftTypeId,
      changes: shiftUpdate
    });

    return updatedShift;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error updating shift type', 500);
  }
}

/**
 * Toggle shift type status
 * @param {string} shiftTypeId - Shift type ID
 * @param {string} toggledBy - User ID
 */
async function toggleShiftTypeStatus(shiftTypeId, toggledBy) {
  try {
    // Get current shift type
    const { data: shiftType } = await supabase
      .from('shift_types')
      .select('is_active')
      .eq('id', shiftTypeId)
      .single();

    const newStatus = !shiftType.is_active;

    const { data: updatedShift, error } = await supabase
      .from('shift_types')
      .update({ is_active: newStatus })
      .eq('id', shiftTypeId)
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent(toggledBy, 'SHIFT_TYPE_TOGGLED', {
      shift_type_id: shiftTypeId,
      new_status: newStatus
    });

    return updatedShift;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error toggling shift type', 500);
  }
}

/**
 * Delete shift type
 * @param {string} shiftTypeId - Shift type ID
 * @param {string} deletedBy - User ID
 */
async function deleteShiftType(shiftTypeId, deletedBy) {
  try {
    const { error } = await supabase
      .from('shift_types')
      .delete()
      .eq('id', shiftTypeId);

    if (error) throw error;

    await logAuditEvent(deletedBy, 'SHIFT_TYPE_DELETED', {
      shift_type_id: shiftTypeId
    });

    return { success: true, message: 'Shift type deleted' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error deleting shift type', 500);
  }
}

module.exports = {
  createSchedule,
  getSchedules,
  updateSchedule,
  deleteSchedule,
  bulkCreateSchedules,
  copyScheduleForWeeks,
  listShiftTypes,
  createShiftType,
  updateShiftType,
  toggleShiftTypeStatus,
  deleteShiftType,
  listAllShiftTypes: listShiftTypes
};
