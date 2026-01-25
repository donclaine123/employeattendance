/**
 * profile.js
 * HR Profile Management (wraps shared window.ProfileModal)
 */

// import { AuthGuard } from '../../auth-guard.js'; // AuthGuard is global

export async function initProfile() {
  console.log('[HR] Initializing Profile...');

  const profileBtn = document.getElementById('profileBtn');
  if (profileBtn) {
    // Clone to remove old listeners
    const newBtn = profileBtn.cloneNode(true);
    profileBtn.parentNode.replaceChild(newBtn, profileBtn);

    newBtn.addEventListener('click', async () => {
      try {
        const user = await AuthGuard.getCurrentUser();
        if (window.ProfileModal) {
          // Initialize modal with user data
          const modal = window.ProfileModal.open('hr', user);

          // Override save handler if needed, or rely on default
          // window.ProfileModal handles the API call to /api/employee/profile (or similar)
          // We might need to ensure it hits the right endpoint for HR if different
        } else {
          console.error('ProfileModal not loaded');
        }
      } catch (error) {
        console.error('Error opening profile:', error);
      }
    });
  }
}
