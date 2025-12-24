/**
 * Sync Routes
 * Data synchronization between local and cloud
 */

const express = require('express');
const router = express.Router();

const { catchAsync } = require('../middleware/errorHandler');
const syncService = require('../utils/syncService');

/**
 * GET /api/sync/status
 * Get current sync service status
 */
router.get('/status', catchAsync(async (req, res) => {
  const status = syncService.getSyncStatus();
  
  res.json({
    success: true,
    status: 'ok',
    sync: status,
  });
}));

/**
 * POST /api/sync/trigger
 * Trigger manual synchronization between databases
 */
router.post('/trigger', catchAsync(async (req, res) => {
  const result = await syncService.sync();
  res.json({
    success: true,
    message: 'Synchronization completed',
    result,
  });
}));

module.exports = router;
