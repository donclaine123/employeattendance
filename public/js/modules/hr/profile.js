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

    populateProfileForm(currentUser);

    // Setup tab navigation
    setupProfileTabs();

    // Setup form handlers (MUST use ep-editing class like Department Head)
    setupProfileFormHandlers();

    // Setup sign-out buttons
    setupSignOutHandlers();
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

function setupProfileTabs() {
  const tabs = document.querySelectorAll('.ep-tab-item');
  const panels = document.querySelectorAll('.ep-tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const section = tab.dataset.section;

      // Remove active class from all tabs and panels
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      // Add active class to clicked tab and corresponding panel
      tab.classList.add('active');
      const panel = document.getElementById(`${section}-section`);
      if (panel) panel.classList.add('active');
    });
  });
}

function setupProfileFormHandlers() {
  const profileSection = document.getElementById('section-profile');
  if (!profileSection) return;

  // My Profile Edit Button - ADD ep-editing CLASS
  const profileEditBtn = profileSection.querySelector('[data-panel="profile-section"]');
  if (profileEditBtn) {
    profileEditBtn.addEventListener('click', () => {
      const panel = profileSection.querySelector('#profile-section');
      if (panel) {
        panel.classList.add('ep-editing');
        profileEditBtn.style.display = 'none';
      }
    });
  }

  // My Profile Cancel Button - REMOVE ep-editing CLASS
  const profileCancelBtn = profileSection.querySelector('#profile-section .btn-profile-cancel');
  if (profileCancelBtn) {
    profileCancelBtn.addEventListener('click', () => {
      const panel = profileSection.querySelector('#profile-section');
      if (panel) {
        panel.classList.remove('ep-editing');
        const editBtn = panel.querySelector('.ep-btn-edit');
        if (editBtn) editBtn.style.display = '';
      }
      // Reload to reset form
      populateProfileForm(currentUser);
    });
  }

  // My Profile Save Button
  const profileSaveBtn = profileSection.querySelector('#profile-section .btn-profile-save');
  if (profileSaveBtn) {
    profileSaveBtn.addEventListener('click', async () => {
      await handleProfileSave();
      const panel = profileSection.querySelector('#profile-section');
      if (panel) {
        panel.classList.remove('ep-editing');
        const editBtn = panel.querySelector('.ep-btn-edit');
        if (editBtn) editBtn.style.display = '';
      }
    });
  }

  // Settings (Password) Edit Button - ADD ep-editing CLASS
  const settingsEditBtn = profileSection.querySelector('[data-panel="settings-section"]');
  if (settingsEditBtn) {
    settingsEditBtn.addEventListener('click', () => {
      const panel = profileSection.querySelector('#settings-section');
      if (panel) {
        panel.classList.add('ep-editing');
        settingsEditBtn.style.display = 'none';
      }
    });
  }

  // Settings Cancel Button - REMOVE ep-editing CLASS
  const settingsCancelBtn = profileSection.querySelector('#settings-section .btn-profile-cancel');
  if (settingsCancelBtn) {
    settingsCancelBtn.addEventListener('click', () => {
      const panel = profileSection.querySelector('#settings-section');
      if (panel) {
        panel.classList.remove('ep-editing');
        const editBtn = panel.querySelector('.ep-btn-edit');
        if (editBtn) editBtn.style.display = '';
      }
      // Clear password fields
      const passwordInputs = profileSection.querySelectorAll('#settings-section input[type="password"]');
      passwordInputs.forEach(input => input.value = '');
    });
  }

  // Settings Save Button
  const settingsSaveBtn = profileSection.querySelector('#settings-section .btn-profile-save');
  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', async () => {
      await handlePasswordSave();
      const panel = profileSection.querySelector('#settings-section');
      if (panel) {
        panel.classList.remove('ep-editing');
        const editBtn = panel.querySelector('.ep-btn-edit');
        if (editBtn) editBtn.style.display = '';
      }
    });
  }
}

async function handleProfileSave() {
  try {
    const firstName = document.getElementById('profile-first-name').value;
    const lastName = document.getElementById('profile-last-name').value;
    const phone = document.getElementById('profile-phone').value;
    const address = document.getElementById('profile-address').value;

    const profileData = {
      first_name: firstName,
      last_name: lastName,
      phone: phone,
      address: address,
      updated_at: new Date().toISOString()
    };

    const apiBase = window.API_URL || '/api';
    const response = await window.fetchWithAuth(`${apiBase}/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileData),
    });

    const result = await response.json();

    if (response.ok) {
      showToast('Profile updated successfully!', 'success');
      
      // Update currentUser with response or sent data
      if (result.profile) {
        Object.assign(currentUser, result.profile);
      } else {
        Object.assign(currentUser, profileData);
      }
      
      populateProfileForm(currentUser);
    } else {
      showToast('Failed to save changes: ' + (result.message || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error saving profile:', error);
    showToast('Error updating profile: ' + error.message, 'error');
  }
}

async function handlePasswordSave() {
  const currentPwd = document.getElementById('profile-current-password').value;
  const newPwd = document.getElementById('profile-new-password').value;
  const confirmPwd = document.getElementById('profile-confirm-password').value;

  if (!currentPwd) {
    showToast('Please enter your current password', 'error');
    return;
  }

  if (newPwd !== confirmPwd) {
    showToast('New passwords do not match', 'error');
    return;
  }

  if (newPwd.length < 6) {
    showToast('New password must be at least 6 characters', 'error');
    return;
  }

  try {
    const apiBase = window.API_URL || '/api';
    const response = await window.fetchWithAuth(`${apiBase}/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: currentPwd,
        newPassword: newPwd,
        updated_at: new Date().toISOString()
      }),
    });

    const result = await response.json();

    if (response.ok) {
      showToast('Password updated successfully!', 'success');
      // Clear fields
      document.getElementById('profile-current-password').value = '';
      document.getElementById('profile-new-password').value = '';
      document.getElementById('profile-confirm-password').value = '';
    } else {
      showToast('Failed to update password: ' + (result.message || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error updating password:', error);
    showToast('Error updating password: ' + error.message, 'error');
  }
}

function setupSignOutHandlers() {
  const signOutButtons = [
    document.getElementById('profileSidebarLogoutBtn'),
    document.getElementById('profileMobileLogoutBtn'),
  ];

  signOutButtons.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', async () => {
        try {
          await window.fetchWithAuth('/api/auth/logout', { method: 'POST' });
          window.location.href = '../index.html';
        } catch (error) {
          console.error('Error logging out:', error);
          window.location.href = '../index.html';
        }
      });
    }
  });
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
