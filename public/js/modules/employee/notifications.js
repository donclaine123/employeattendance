
import { getTimeAgo, showStatus } from './utils.js';

export function initNotifications() {
  const notificationsBtn = document.getElementById('notificationsBtn');
  const markAllReadBtn = document.getElementById('markAllReadBtn');

  if (notificationsBtn) notificationsBtn.addEventListener('click', toggleNotifications);
  if (markAllReadBtn) markAllReadBtn.addEventListener('click', handleMarkAllRead);

  // Initial fetch
  fetchAndDisplayNotifications();

  // Close dropdown logic
  document.addEventListener('click', function (event) {
    const dropdown = document.getElementById('notificationsDropdown');
    const button = document.getElementById('notificationsBtn');
    if (dropdown && button && !dropdown.contains(event.target) && !button.contains(event.target)) {
      dropdown.style.display = 'none';
    }
  });
}

function toggleNotifications() {
  const dropdown = document.getElementById('notificationsDropdown');
  if (!dropdown) return;

  const isVisible = dropdown.style.display === 'block';
  dropdown.style.display = isVisible ? 'none' : 'block';

  // Close dropdown when clicking outside logic is handled by global listener in init
}

async function fetchAndDisplayNotifications() {
  const list = document.getElementById('notificationsList');
  const badge = document.getElementById('notificationBadge');

  if (!list) return;

  // Show loading state
  list.innerHTML = '<div class="empty-state">Loading...</div>';

  try {
    const notifications = await window.AppApi.getNotifications();

    if (notifications && notifications.length > 0) {
      list.innerHTML = ''; // Clear loading state
      let unreadCount = 0;

      notifications.forEach(n => {
        const item = document.createElement('div');
        item.className = `notification-item ${n.read ? '' : 'unread'}`;
        if (!n.read) unreadCount++;

        item.dataset.id = n.notif_id;

        // Enhanced notification display
        const timeAgo = getTimeAgo(new Date(n.created_at));

        item.innerHTML = `
                    <div class="title">${n.title || 'Notification'}</div>
                    <div class="message">${n.message}</div>
                    <div class="time">${timeAgo}</div>
                `;

        // Mark as read when clicked
        item.addEventListener('click', () => markNotificationAsRead(n.notif_id, item));

        list.appendChild(item);
      });

      // Update badge
      if (unreadCount > 0) {
        if (badge) {
          badge.textContent = unreadCount;
          badge.style.display = 'block';
        }
      } else {
        if (badge) badge.style.display = 'none';
      }
    } else {
      list.innerHTML = '<div class="empty-state">You have no new notifications.</div>';
      if (badge) badge.style.display = 'none';
    }
  } catch (e) {
    // If API fails, show sample notifications for demo
    console.warn('API not available, showing sample notifications');

    // Show sample notifications (already in HTML)
    const sampleItems = list.querySelectorAll('.notification-item');
    if (sampleItems.length > 0) {
      const unreadItems = list.querySelectorAll('.notification-item.unread');
      if (badge) {
        if (unreadItems.length > 0) {
          badge.textContent = unreadItems.length;
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      }

      // Add click handlers to sample notifications
      sampleItems.forEach(item => {
        item.addEventListener('click', () => {
          item.classList.remove('unread');
          updateBadgeCount();
        });
      });
    } else {
      list.innerHTML = '<div class="empty-state">You have no new notifications.</div>';
      if (badge) badge.style.display = 'none';
    }
  }
}

async function markNotificationAsRead(notifId, itemElement) {
  try {
    if (window.AppApi && window.AppApi.markNotificationRead) {
      await window.AppApi.markNotificationRead(notifId);
    }
    itemElement.classList.remove('unread');
    updateBadgeCount();
  } catch (e) {
    console.warn('Failed to mark notification as read:', e);
    // Still update UI for better UX
    itemElement.classList.remove('unread');
    updateBadgeCount();
  }
}

function updateBadgeCount() {
  const badge = document.getElementById('notificationBadge');
  const unreadItems = document.querySelectorAll('.notification-item.unread');

  if (badge) {
    if (unreadItems.length > 0) {
      badge.textContent = unreadItems.length;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }
}

async function handleMarkAllRead() {
  try {
    // Mark all notifications as read on server
    if (window.AppApi && window.AppApi.markNotificationsRead) {
      await window.AppApi.markNotificationsRead();
    }

    // Update UI immediately
    const unreadItems = document.querySelectorAll('.notification-item.unread');
    unreadItems.forEach(item => item.classList.remove('unread'));
    updateBadgeCount();

    showStatus('All notifications marked as read.', false);

    setTimeout(() => {
      const dropdown = document.getElementById('notificationsDropdown');
      if (dropdown) dropdown.style.display = 'none';
    }, 800);
  } catch (e) {
    showStatus(`Error: ${e.message}`, true);
  }
}
