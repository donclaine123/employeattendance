/**
 * Request Routes
 * Leave requests, absence requests, etc.
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { requestService } = require('../services');

/**
 * GET /api/requests/pending
 * Get pending requests (for approvers)
 * MUST come before /:id route to avoid being matched as :id='pending'
 */
router.get('/pending', requireAuth(['head_dept', 'hr', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, _page = 1, _limit = 20 } = req.query;
  const result = await requestService.getPendingRequests({ departmentId }, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

/**
 * GET /api/requests
 * Get user's requests
 */
router.get('/', requireAuth(['employee', 'head_dept', 'hr', 'superadmin']), catchAsync(async (req, res) => {
  const { status, type, _page = 1, _limit = 20 } = req.query;
  const employeeId = req.auth.employee_id;
  const userRole = req.auth.role;
  
  // Build filters based on user role
  const filters = { status, type };
  
  // Employees can only see their own requests
  if (userRole === 'employee') {
    filters.employeeId = employeeId;
  }
  
  const result = await requestService.getRequests(filters, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

/**
 * POST /api/requests
 * Create new request
 */
router.post('/', requireAuth(['employee']), catchAsync(async (req, res) => {
  const { request_type, details } = req.body;
  
  // Map frontend data structure to service expectations
  const requestData = {
    employeeId: req.auth.employee_id,
    type: request_type,
    details: details
  };

  const request = await requestService.createRequest(requestData, req.auth.id);
  res.json({ success: true, data: request });
}));

/**
 * GET /api/requests/:id
 * Get request details
 */
router.get('/:id', requireAuth(['employee', 'head_dept', 'hr', 'superadmin']), catchAsync(async (req, res) => {
  const request = await requestService.getRequest(req.params.id);
  res.json({ success: true, data: request });
}));

/**
 * PUT /api/requests/:id
 * Update request (before approval)
 */
router.put('/:id', requireAuth(['employee']), catchAsync(async (req, res) => {
  const updated = await requestService.updateRequest(req.params.id, req.body, req.auth.id);
  res.json({ success: true, data: updated });
}));

/**
 * POST /api/requests/:id/approve
 * Approve request
 */
router.post('/:id/approve', requireAuth(['head_dept', 'hr', 'superadmin']), catchAsync(async (req, res) => {
  const result = await requestService.approveRequest(req.params.id, req.auth.id);
  res.json(result);
}));

/**
 * POST /api/requests/:id/reject
 * Reject request
 */
router.post('/:id/reject', requireAuth(['head_dept', 'hr', 'superadmin']), catchAsync(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw new AppError('Rejection reason required', 400);
  const result = await requestService.rejectRequest(req.params.id, reason, req.auth.id);
  res.json(result);
}));

/**
 * DELETE /api/requests/:id
 * Delete request
 */
router.delete('/:id', requireAuth(['employee', 'superadmin']), catchAsync(async (req, res) => {
  const result = await requestService.deleteRequest(req.params.id, req.auth.id);
  res.json(result);
}));

module.exports = router;
