const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent } = require('../utils/audit');

/**
 * Get notifications for user
 * @param {string} userId - User ID
 * @param {Object} filters - Filter criteria {read, type}
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 */
async function getNotifications(userId, filters = {}, page = 1, limit = 20) {
  try {
    let query = supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    if (filters.read !== undefined) {
      query = query.eq('is_read', filters.read);
    }

    if (filters.type) {
      query = query.eq('notification_type', filters.type);
    }

    const offset = (page - 1) * limit;
    query = query
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) throw error;

    return {
      data: data.map(notif => ({
        id: notif.id,
        title: notif.title,
        message: notif.message,
        type: notif.notification_type,
        isRead: notif.is_read,
        createdAt: notif.created_at,
        readAt: notif.read_at
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
    throw new AppError('Error fetching notifications', 500);
  }
}

/**
 * Mark notification as read
 * @param {string} notificationId - Notification ID
 */
async function markAsRead(notificationId) {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date()
      })
      .eq('id', notificationId);

    if (error) throw error;

    return { success: true, message: 'Notification marked as read' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error marking notification as read', 500);
  }
}

/**
 * Mark all notifications as read for user
 * @param {string} userId - User ID
 */
async function markAllAsRead(userId) {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date()
      })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) throw error;

    return { success: true, message: 'All notifications marked as read' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error marking notifications as read', 500);
  }
}

/**
 * Create notification for user
 * @param {string} userId - User ID
 * @param {Object} notificationData - {title, message, type}
 */
async function createNotification(userId, notificationData) {
  const { title, message, type } = notificationData;

  if (!title || !message || !type) {
    throw new AppError('Missing required fields', 400);
  }

  try {
    const { data: newNotification, error } = await supabase
      .from('notifications')
      .insert([{
        user_id: userId,
        title,
        message,
        notification_type: type,
        is_read: false,
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) throw error;

    return {
      id: newNotification.id,
      title,
      message,
      type,
      isRead: false,
      createdAt: newNotification.created_at
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error creating notification', 500);
  }
}

/**
 * Delete notification
 * @param {string} notificationId - Notification ID
 */
async function deleteNotification(notificationId) {
  try {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId);

    if (error) throw error;

    return { success: true, message: 'Notification deleted' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error deleting notification', 500);
  }
}

/**
 * Get unread notification count for user
 * @param {string} userId - User ID
 */
async function getUnreadCount(userId) {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) throw error;

    return { unreadCount: count || 0 };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching unread count', 500);
  }
}

/**
 * Clear all notifications for user
 * @param {string} userId - User ID
 */
async function clearAll(userId) {
  try {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;

    return { success: true, message: 'All notifications cleared' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error clearing notifications', 500);
  }
}

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  createNotification,
  deleteNotification,
  getUnreadCount,
  clearAll
};
