/**
 * Notification Routes
 * User notifications
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { notificationService } = require('../services');

/**
 * GET /api/notifications
 * Get user notifications
 */
router.get('/', requireAuth([]), catchAsync(async (req, res) => {
  const { read, type, _page = 1, _limit = 20 } = req.query;
  const filters = { read: read === 'true' ? true : read === 'false' ? false : undefined, type };
  const result = await notificationService.getNotifications(
    req.auth.id,
    filters,
    parseInt(_page),
    parseInt(_limit)
  );
  res.json({ success: true, ...result });
}));

/**
 * GET /api/notifications/unread-count
 * Get unread notification count
 */
router.get('/unread-count', requireAuth([]), catchAsync(async (req, res) => {
  const data = await notificationService.getUnreadCount(req.auth.id);
  res.json({ success: true, ...data });
}));

/**
 * PUT /api/notifications/:id/read
 * Mark single notification as read
 */
router.put('/:id/read', requireAuth([]), catchAsync(async (req, res) => {
  const result = await notificationService.markAsRead(req.params.id);
  res.json(result);
}));

/**
 * PUT /api/notifications/mark-all-read
 * Mark all notifications as read
 */
router.put('/mark-all-read', requireAuth([]), catchAsync(async (req, res) => {
  const result = await notificationService.markAllAsRead(req.auth.id);
  res.json(result);
}));

/**
 * DELETE /api/notifications/:id
 * Delete notification
 */
router.delete('/:id', requireAuth([]), catchAsync(async (req, res) => {
  const result = await notificationService.deleteNotification(req.params.id);
  res.json(result);
}));

/**
 * DELETE /api/notifications/clear-all
 * Clear all notifications
 */
router.delete('/clear-all', requireAuth([]), catchAsync(async (req, res) => {
  const result = await notificationService.clearAll(req.auth.id);
  res.json(result);
}));

module.exports = router;
