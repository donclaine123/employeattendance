/**
 * profile.js
 * HR Profile Management (full-page section based on Department Head pattern)
 */

let currentUser = null;

export async function initProfile() {
  console.log('[HR] Initializing Profile...');

  try {
    // Load user profile data using the same method as Department Head
    currentUser = await window.fetchUserProfile();
    
    if (!currentUser) {
      try {
        currentUser = await AuthGuard.getCurrentUser();
      } catch (e) {
        console.error('[HR Profile] Could not get user:', e);
        return;
      }
    }

    const controllerFactory = window.ProfilePageController;
    if (controllerFactory && typeof controllerFactory.createStandardController === 'function') {
      const controller = controllerFactory.createStandardController({
        user: currentUser,
        renderHeader: populateProfileForm,
        notify: showToast,
        logoutSelectors: ['#profileSidebarLogoutBtn', '#profileMobileLogoutBtn'],
      });

      controller.init();
      return currentUser;
    }

  } catch (error) {
    console.error('[HR] Error initializing profile:', error);
  }
}

function populateProfileForm(user) {
  if (!user) return;

  // Populate header info
  document.getElementById('profile-page-initials').textContent = getInitials(user);
  document.getElementById('profile-page-name').textContent = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  document.getElementById('profile-page-email').textContent = user.email || '';

  // Populate My Profile tab inputs
  document.getElementById('profile-first-name').value = user.first_name || '';
  document.getElementById('profile-last-name').value = user.last_name || '';
  document.getElementById('profile-email').value = user.email || '';
  document.getElementById('profile-phone').value = user.phone_number || user.phone || '';
  document.getElementById('profile-address').value = user.address || '';

  // Populate Employment tab inputs
  document.getElementById('profile-position').value = user.position || 'TBA';
  document.getElementById('profile-department').value = user.department_name || user.department || '';
  document.getElementById('profile-hire-date').value = user.hire_date ? user.hire_date.split('T')[0] : '';
  document.getElementById('profile-status').value = user.status || '';
  document.getElementById('profile-employee-id').value = user.employee_id || '';
  document.getElementById('profile-role').value = user.role || '';
}

function getInitials(user) {
  if (!user) return '--';
  const first = (user.first_name || 'U')[0].toUpperCase();
  const last = (user.last_name || 'S')[0].toUpperCase();
  return `${first}${last}`;
}

function showToast(message, type = 'info') {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  
  // Style toast
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 14px;
    z-index: 10000;
    animation: slideInUp 0.3s ease-out;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  `;
  
  document.body.appendChild(toast);
  
  // Auto remove
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

