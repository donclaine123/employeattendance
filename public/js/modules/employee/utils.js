
// Helper: return session user object from API
export async function getSessionUser() {
  try {
    return await window.fetchUserProfile();
  } catch (e) { return null; }
}

// Helper: format time in 12-hour AM/PM format
export function formatTimeAMPM(dateObj) {
  if (!dateObj) return '-';

  let hours, minutes;

  if (typeof dateObj === 'string') {
    const timePart = dateObj.split('.')[0];
    const parts = timePart.split(':');
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1], 10);
  } else {
    const dateToUse = typeof dateObj === 'number' ? new Date(dateObj) : dateObj;
    hours = dateToUse.getHours();
    minutes = dateToUse.getMinutes();
  }

  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

// Helper: show a temporary message in the status-notice area
export function showStatus(msg, isError = false, timeout = 3500) {
  const notice = document.querySelector('.status-notice div p');
  const container = document.querySelector('.status-notice');

  if (notice && container) {
    notice.textContent = msg;
    container.classList.add('show');

    // Add visual styling
    if (isError) {
      notice.style.fontWeight = '500';
      if (container) container.style.backgroundColor = '#ffebee';
      if (container) container.style.borderLeft = '4px solid #b00020';
    } else {
      notice.style.fontWeight = '500';
      if (container) container.style.backgroundColor = '#e8f5e9';
      if (container) container.style.borderLeft = '4px solid #0b6e4f';
    }
  }

  if (container) {
    container.style.color = isError ? '#b00020' : '#0b6e4f';
    container.style.padding = '12px 16px';
    container.style.borderRadius = '4px';
  }

  if (timeout > 0) {
    setTimeout(() => {
      try {
        if (notice) notice.textContent = '';
        if (container) {
          container.classList.remove('show');
          container.style.backgroundColor = 'transparent';
          container.style.borderLeft = 'none';
        }
      } catch (e) { }
    }, timeout);
  }
}

export function getTimeAgo(date) {
  const now = new Date();
  const diffInMs = now - date;
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInHours < 1) {
    const diffInMins = Math.floor(diffInMs / (1000 * 60));
    return diffInMins <= 1 ? 'Just now' : `${diffInMins} minutes ago`;
  } else if (diffInHours < 24) {
    return diffInHours === 1 ? '1 hour ago' : `${diffInHours} hours ago`;
  } else if (diffInDays === 1) {
    return '1 day ago';
  } else if (diffInDays < 7) {
    return `${diffInDays} days ago`;
  } else {
    return date.toLocaleDateString();
  }
}
