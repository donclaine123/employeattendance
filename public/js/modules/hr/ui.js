/**
 * ui.js
 * UI and Layout Management for HR Dashboard
 */

// import { AuthGuard } from '../../auth-guard.js'; // AuthGuard is global

export function initUI() {
  console.log('[HR] Initializing UI...');

  setupNavigation();
  setupSidebarProfile();
  setupMobileMenu();
}

/**
 * Setup Sidebar Navigation
 */
function setupNavigation() {
  console.log('[HR] Setting up navigation...');
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  const sections = document.querySelectorAll('.content-section');
  const pageTitle = document.getElementById('pageTitle');

  function showSection(sectionId) {
    // Update Nav
    navItems.forEach(item => {
      if (item.dataset.section === sectionId) {
        item.classList.add('active');
        if (pageTitle) pageTitle.textContent = item.querySelector('span').textContent;
      } else {
        item.classList.remove('active');
      }
    });

    // Update Sections
    sections.forEach(section => {
      if (section.id === `section-${sectionId}`) {
        section.classList.add('active');
      } else {
        section.classList.remove('active');
      }
    });

    // Store current section
    try {
      sessionStorage.setItem('hr_active_section', sectionId);
    } catch (e) {
      console.debug('Could not save section to sessionStorage:', e);
    }
  }

  // Add click listeners
  navItems.forEach(item => {
    item.addEventListener('click', function () {
      const sectionId = this.dataset.section;
      showSection(sectionId);

      // Handle QR Module State
      if (sectionId === 'qr') {
        if (window.initializeLiveQR) {
          console.log('[HR UI] Initializing Live QR');
          setTimeout(() => window.initializeLiveQR(), 100);
        }
      } else {
        if (window.stopLiveQR) {
          console.log('[HR UI] Stopping Live QR');
          window.stopLiveQR();
        }
      }
    });
  });

  // Restore last section
  try {
    const lastSection = sessionStorage.getItem('hr_active_section') || 'dashboard';
    showSection(lastSection);

    // Auto-init QR if that's the active section
    if (lastSection === 'qr') {
      setTimeout(() => {
        if (window.initializeLiveQR) window.initializeLiveQR();
      }, 1000);
    }
  } catch (e) {
    showSection('dashboard');
  }
}

/**
 * Setup Sidebar Profile Display
 */
async function setupSidebarProfile() {
  try {
    await new Promise(resolve => setTimeout(resolve, 200));

    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarAvatar = document.querySelector('.user-avatar');
    const sidebarUserRole = document.getElementById('sidebarUserRole');

    const user = await AuthGuard.getCurrentUser();

    let roleDisplayName = 'N/A';
    if (user && user.role) {
      roleDisplayName = getDisplayRoleName(user.role);
    }

    if (sidebarUserRole) sidebarUserRole.textContent = roleDisplayName;

    let nameToDisplay = 'Monitoring';
    if (user && user.first_name && user.last_name) {
      nameToDisplay = `${user.first_name} ${user.last_name}`;
    } else if (user && user.username) {
      nameToDisplay = user.username;
    }

    if (sidebarUserName) sidebarUserName.textContent = nameToDisplay;

    if (sidebarAvatar) {
      const initials = nameToDisplay.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      sidebarAvatar.textContent = initials || 'MO';
    }

    // Profile Click
    const sidebarProfile = document.getElementById('sidebarProfile');
    const profileBtn = document.getElementById('profileBtn');
    if (sidebarProfile && profileBtn) {
      sidebarProfile.addEventListener('click', () => profileBtn.click());
    }

  } catch (e) {
    console.debug('Could not update sidebar profile:', e);
  }

  // Sidebar Profile Button (Mobile Actions)
  const sidebarProfileBtn = document.getElementById('sidebarProfileBtn');
  if (sidebarProfileBtn) {
    sidebarProfileBtn.addEventListener('click', () => {
      const profileBtn = document.getElementById('profileBtn');
      if (profileBtn) profileBtn.click();
      closeSidebar();
    });
  }

  // Sidebar Logout Button (Mobile Actions)
  const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
  if (sidebarLogoutBtn) {
    sidebarLogoutBtn.addEventListener('click', () => {
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) logoutBtn.click();
      closeSidebar();
    });
  }
}

function closeSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('menuOverlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('visible');
}

function getDisplayRoleName(roleCode) {
  switch (roleCode) {
    case 'hr': return 'Monitoring';
    case 'superadmin': return 'Super Administrator';
    case 'head_dept': return 'Department Head';
    case 'employee': return 'Employee';
    case 'display': return 'QR Display';
    default: return roleCode;
  }
}

/**
 * Setup Mobile Menu Toggles (if any)
 */
/**
 * Mobile Menu & Responsive Layout
 */
function setupMobileMenu() {
  handleResponsiveLayout();

  // Elements
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('menuOverlay');

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

  // Close on Nav Item Click (Mobile)
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
