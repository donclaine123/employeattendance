/**
 * SUPERADMIN UI MODULE
 * Handles responsive layout, sidebar toggles, and mobile menu interactions.
 */

export function initUI() {
  console.log('[Superadmin] Initializing UI controls...');
  setupMobileMenu();
}

/**
 * Mobile Menu & Responsive Layout
 */
function setupMobileMenu() {
  // Initial check
  handleResponsiveLayout();

  // Elements
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('menuOverlay');
  const sidebarMobileBtns = document.querySelectorAll('.sidebar-mobile-actions .nav-item');

  // Toggle Menu
  if (menuToggleBtn && sidebar) {
    menuToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
      if (overlay) overlay.classList.toggle('visible');
    });
  }

  // Close on Overlay Click
  if (overlay) {
    overlay.addEventListener('click', () => {
      closeSidebar();
    });
  }

  // Mobile Sidebar Actions (Profile, Logout)
  // Theme Toggle is handled by global ThemeManager and doesn't need explicit logic here.

  const sidebarProfileBtn = document.getElementById('sidebarProfileBtn');
  if (sidebarProfileBtn) {
    sidebarProfileBtn.addEventListener('click', () => {
      const profileBtn = document.getElementById('profileBtn');
      if (profileBtn) profileBtn.click(); // Trigger desktop profile logic
      closeSidebar();
    });
  }

  const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
  if (sidebarLogoutBtn) {
    sidebarLogoutBtn.addEventListener('click', () => {
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) logoutBtn.click(); // Trigger desktop logout logic
      closeSidebar();
    });
  }

  // Close on Standard Nav Item Click (Mobile)
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 1024) {
        closeSidebar();
      }
    });
  });

  // Close when clicking outside (fallback)
  document.addEventListener('click', (event) => {
    if (window.innerWidth <= 1024 && sidebar && sidebar.classList.contains('open')) {
      if (!sidebar.contains(event.target) && !menuToggleBtn.contains(event.target)) {
        closeSidebar();
      }
    }
  });

  // Handle Resize
  window.addEventListener('resize', handleResponsiveLayout);

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }
}

function handleResponsiveLayout() {
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('menuOverlay');

  if (window.innerWidth <= 1024) {
    // Tablet/Mobile
    if (menuToggleBtn) menuToggleBtn.style.display = 'flex';
  } else {
    // Desktop
    if (menuToggleBtn) menuToggleBtn.style.display = 'none';
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }
}
