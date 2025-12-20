const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent } = require('../utils/audit');

/**
 * Create leave/absence request
 * @param {Object} requestData - Request data {employeeId, type, startDate, endDate, reason}
 * @param {string} createdBy - User ID
 */
async function createRequest(requestData, createdBy) {
  const { employeeId, type, startDate, endDate, reason } = requestData;
  const validTypes = ['leave', 'absence', 'emergency_leave', 'special_leave'];

  if (!employeeId || !type || !startDate || !endDate) {
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
        request_type: type,
        start_date: startDate,
        end_date: endDate,
        reason,
        status: 'pending',
        created_by: createdBy,
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent(createdBy, 'REQUEST_CREATED', {
      request_id: newRequest.id,
      employee_id: employeeId,
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
    let query = supabase
      .from('requests')
      .select('*, employees(*, users(*))', { count: 'exact' });

    if (filters.employeeId) {
      query = query.eq('employee_id', filters.employeeId);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.type) {
      query = query.eq('request_type', filters.type);
    }

    if (filters.departmentId) {
      query = query.eq('employees.department_id', filters.departmentId);
    }

    const offset = (page - 1) * limit;
    query = query
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) throw error;

    return {
      data: data.map(req => ({
        id: req.id,
        employeeId: req.employee_id,
        employeeName: req.employees.users.name,
        type: req.request_type,
        startDate: req.start_date,
        endDate: req.end_date,
        status: req.status,
        reason: req.reason,
        createdAt: req.created_at
      })),
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
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
      .eq('id', requestId)
      .single();

    if (error || !data) {
      throw new AppError('Request not found', 404);
    }

    return {
      id: data.id,
      employeeId: data.employee_id,
      employeeName: data.employees.users.name,
      type: data.request_type,
      startDate: data.start_date,
      endDate: data.end_date,
      status: data.status,
      reason: data.reason,
      approvedBy: data.approved_by,
      approvalDate: data.approval_date,
      rejectionReason: data.rejection_reason,
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
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent(updatedBy, 'REQUEST_UPDATED', {
      request_id: requestId,
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
        approval_date: new Date()
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent(approvedBy, 'REQUEST_APPROVED', {
      request_id: requestId
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
        rejection_reason: rejectionReason,
        approved_by: rejectedBy,
        approval_date: new Date()
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent(rejectedBy, 'REQUEST_REJECTED', {
      request_id: requestId,
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
    const { error } = await supabase
      .from('requests')
      .delete()
      .eq('id', requestId);

    if (error) throw error;

    await logAuditEvent(deletedBy, 'REQUEST_DELETED', {
      request_id: requestId
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
