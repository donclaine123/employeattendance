/**
 * Socket.IO Configuration
 * Centralized WebSocket setup
 */

const { Server: SocketIOServer } = require('socket.io');
const { socketCorsOptions } = require('./cors');

/**
 * Initialize Socket.IO server
 */
function initializeSocketIO(httpServer) {
  const io = new SocketIOServer(httpServer, {
    cors: socketCorsOptions,
  });

  // Handle Socket.IO connections
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    // Join display room for QR updates
    socket.on('join-display', () => {
      socket.join('displays');
      console.log(`[Socket.IO] Client ${socket.id} joined displays room`);
    });

    // Join notifications room
    socket.on('join-notifications', (userId) => {
      socket.join(`user-${userId}`);
      console.log(`[Socket.IO] Client ${socket.id} joined notifications room for user ${userId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

/**
 * Broadcast QR update to all displays
 */
function broadcastQRUpdate(io, qrData) {
  if (io) {
    io.to('displays').emit('qr-update', qrData);
  }
}

/**
 * Send notification to specific user
 */
function sendUserNotification(io, userId, notification) {
  if (io) {
    io.to(`user-${userId}`).emit('notification', notification);
  }
}

/**
 * Broadcast attendance update
 */
function broadcastAttendanceUpdate(io, attendanceData) {
  if (io) {
    io.emit('attendance-update', attendanceData);
  }
}

module.exports = {
  initializeSocketIO,
  broadcastQRUpdate,
  sendUserNotification,
  broadcastAttendanceUpdate,
};
