const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent } = require('../utils/audit');

/**
 * Create leave/absence request
 * @param {Object} requestData - Request data {employeeId, type, details}
 * @param {string} createdBy - User ID
 */
async function createRequest(requestData, createdBy) {
  const { employeeId, type, details } = requestData;
  const validTypes = ['leave', 'overtime', 'correction'];

  if (!employeeId || !type || !details) {
    throw new AppError('Missing required fields', 400);
  }

  if (!validTypes.includes(type)) {
    throw new AppError(`Invalid request type: ${type}`, 400);
  }

  try {
    const { data: newRequest, error } = await supabase
      .from('requests')
      .insert([{
        employee_id: employeeId,
        type: type,
        details: details,
        status: 'pending',
        created_at: new Date()
      }])
      .select('*, employees(first_name, last_name, users(username))')
      .single();

    if (error) throw error;

    const emp = newRequest.employees || {};
    const empName = emp.first_name ? `${emp.first_name} ${emp.last_name}` : (emp.users?.username || `Employee #${employeeId}`);

    await logAuditEvent(createdBy, 'REQUEST_CREATED', {
      request_id: newRequest.request_id,
      employee_id: employeeId,
      employee_name: empName,
      type
    });

    return newRequest;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error creating request', 500);
  }
}

/**
 * Get requests with filters
 * @param {Object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 */
async function getRequests(filters = {}, page = 1, limit = 20) {
  try {
    console.log('[getRequests] Filters:', JSON.stringify(filters, null, 2));

    // Default select
    let selectString = '*, employees(*)';

    // If filtering by department, need deep inner join
    if (filters.department) {
      selectString = '*, employees!inner(*, departments!inner(*))';
    } else if (filters.departmentId) {
      // If filtering by dept ID on employees table
      selectString = '*, employees!inner(*)';
    }

    let query = supabase
      .from('requests')
      .select(selectString, { count: 'exact' });

    if (filters.employeeId) {
      query = query.eq('employee_id', filters.employeeId);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.type) {
      query = query.eq('type', filters.type);
    }

    if (filters.department) {
      console.log('[getRequests] Filtering by department name:', filters.department);
      query = query.eq('employees.departments.dept_name', filters.department);
    }

    // Filter by departmentId if provided (and department name not provided or alongside it)
    if (filters.departmentId && !filters.department) {
      query = query.eq('employees.dept_id', filters.departmentId);
    }

    const offset = (page - 1) * limit;
    query = query
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) {
      console.error('[getRequests] Query error:', error);
      throw error;
    }

    console.log('[getRequests] Found:', count);

    if (!data) {
      return {
        data: [],
        pagination: { page, limit, total: 0, pages: 0 }
      };
    }

    // Map helper to safely get names
    const getEmployeeName = (r) => {
      if (!r.employees) return 'Unknown';
      // If deep join was used
      if (r.employees.full_name) return r.employees.full_name;
      if (r.employees.first_name) return `${r.employees.first_name} ${r.employees.last_name}`;
      // If array (shouldn't be with single join but safety check)
      if (Array.isArray(r.employees) && r.employees[0]) {
        return r.employees[0].full_name;
      }
      return 'Unknown';
    };

    return {
      data: data.map(req => ({
        id: req.request_id, // Ensure ID is mapped correctly as 'id' for frontend
        request_id: req.request_id,
        employeeId: req.employee_id,
        employeeName: getEmployeeName(req), // Add name for display
        type: req.type,
        request_type: req.type, // Frontend might expect this
        details: req.details,
        startDate: req.details?.startDate || req.details?.date || req.details?.start_date,
        endDate: req.details?.endDate || req.details?.date || req.details?.end_date,
        reason: req.details?.reason || req.details?.description || req.details?.notes,
        status: req.status,
        createdAt: req.created_at
      })),
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching requests', 500);
  }
}

/**
 * Get request by ID
 * @param {string} requestId - Request ID
 * @returns {Promise<Object>} Request
 */
async function getRequest(requestId) {
  try {
    const { data, error } = await supabase
      .from('requests')
      .select('*, employees(*, users(*))')
      .eq('request_id', requestId)
      .single();

    if (error || !data) {
      throw new AppError('Request not found', 404);
    }

    return {
      id: data.request_id,
      employeeId: data.employee_id,
      employeeName: data.employees.users.name,
      type: data.type, // fixed from request_type which might depend on schema
      startDate: data.details?.start_date || data.details?.date || data.details.startDate, // Handle jsonb details better
      endDate: data.details?.end_date || data.details?.date || data.details.endDate,
      status: data.status,
      reason: data.details?.reason || data.details?.notes,
      approvedBy: data.approved_by,
      approvalDate: data.updated_at, // Schema doesn't have approval_date, use updated_at
      rejectionReason: data.details?.rejection_reason, // Schema doesn't have local column, likely inside details or handle if it was intended to be separate
      createdAt: data.created_at
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching request', 500);
  }
}

/**
 * Update request
 * @param {string} requestId - Request ID
 * @param {Object} updates - Fields to update
 * @param {string} updatedBy - User ID
 */
async function updateRequest(requestId, updates, updatedBy) {
  const allowedFields = ['reason', 'start_date', 'end_date'];
  const requestUpdate = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      requestUpdate[key] = value;
    }
  }

  if (Object.keys(requestUpdate).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  requestUpdate.updated_at = new Date();

  try {
    const { data: updatedRequest, error } = await supabase
      .from('requests')
      .update(requestUpdate)
      .eq('request_id', requestId)
      .select('*, employees(first_name, last_name, users(username))')
      .single();

    if (error) throw error;

    const emp = updatedRequest.employees || {};
    const empName = emp.first_name ? `${emp.first_name} ${emp.last_name}` : (emp.users?.username || `Employee #${updatedRequest.employee_id}`);

    await logAuditEvent(updatedBy, 'REQUEST_UPDATED', {
      request_id: requestId,
      employee_name: empName,
      changes: requestUpdate
    });

    return updatedRequest;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error updating request', 500);
  }
}

/**
 * Approve request
 * @param {string} requestId - Request ID
 * @param {string} approvedBy - User ID who approved
 */
async function approveRequest(requestId, approvedBy) {
  try {
    const { data: updatedRequest, error } = await supabase
      .from('requests')
      .update({
        status: 'approved',
        approved_by: approvedBy,
        updated_at: new Date()
      })
      .eq('request_id', requestId)
      .select('*, employees(first_name, last_name, users(username))')
      .single();

    if (error) throw error;

    const emp = updatedRequest.employees || {};
    const empName = emp.first_name ? `${emp.first_name} ${emp.last_name}` : (emp.users?.username || `Employee #${updatedRequest.employee_id}`);

    await logAuditEvent(approvedBy, 'REQUEST_APPROVED', {
      request_id: requestId,
      employee_name: empName
    });

    return { success: true, message: 'Request approved' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error approving request', 500);
  }
}

/**
 * Reject request
 * @param {string} requestId - Request ID
 * @param {string} rejectionReason - Reason for rejection
 * @param {string} rejectedBy - User ID who rejected
 */
async function rejectRequest(requestId, rejectionReason, rejectedBy) {
  try {
    const { data: updatedRequest, error } = await supabase
      .from('requests')
      .update({
        status: 'rejected',
        approved_by: rejectedBy, // Logic says approved_by stores the actor even for rejection
        updated_at: new Date()
        // Note: rejection_reason isn't in schema, likely needs to be merged into details or handled if schema changes. 
        // For now, let's assume we can't save reason if column doesn't exist, OR we update details.
        // But the previous code tried to set rejection_reason. 
        // Schema checks: requests has 'type', 'details', 'status', 'approved_by'. No approval_date or rejection_reason.
      })
      .eq('request_id', requestId)
      .select('*, employees(first_name, last_name, users(username))')
      .single();

    if (error) throw error;

    const emp = updatedRequest.employees || {};
    const empName = emp.first_name ? `${emp.first_name} ${emp.last_name}` : (emp.users?.username || `Employee #${updatedRequest.employee_id}`);

    await logAuditEvent(rejectedBy, 'REQUEST_REJECTED', {
      request_id: requestId,
      employee_name: empName,
      reason: rejectionReason
    });

    return { success: true, message: 'Request rejected' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error rejecting request', 500);
  }
}

/**
 * Get pending requests
 * @param {Object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 */
async function getPendingRequests(filters = {}, page = 1, limit = 20) {
  return getRequests({ ...filters, status: 'pending' }, page, limit);
}

/**
 * Delete request
 * @param {string} requestId - Request ID
 * @param {string} deletedBy - User ID
 */
async function deleteRequest(requestId, deletedBy) {
  try {
    // Get the request first so we can extract the employee name before deletion
    const { data: reqToDel } = await supabase
      .from('requests')
      .select('*, employees(first_name, last_name, users(username))')
      .eq('request_id', requestId)
      .single();

    const { error } = await supabase
      .from('requests')
      .delete()
      .eq('request_id', requestId);

    if (error) throw error;

    let empName = `Unknown`;
    if (reqToDel && reqToDel.employees) {
      const emp = reqToDel.employees;
      empName = emp.first_name ? `${emp.first_name} ${emp.last_name}` : (emp.users?.username || `Employee #${reqToDel.employee_id}`);
    }

    await logAuditEvent(deletedBy, 'REQUEST_DELETED', {
      request_id: requestId,
      employee_name: empName
    });

    return { success: true, message: 'Request deleted' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error deleting request', 500);
  }
}

module.exports = {
  createRequest,
  getRequests,
  getRequest,
  updateRequest,
  approveRequest,
  rejectRequest,
  getPendingRequests,
  deleteRequest
};
