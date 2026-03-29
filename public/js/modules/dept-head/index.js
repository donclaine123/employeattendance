
import { fetchHeadInfo } from './utils.js';
// import { loadApprovalRequests, initApprovals } from './approvals.js';
import { loadDepartmentAttendance, initAttendance } from './attendance.js';
import { loadDashboardStats, loadRecentActivity, loadTeamAttendanceStats, updateChips } from './stats.js';
import { initializeAnalytics, setupExportButton } from './analytics.js';
import { initializePerformanceForecast } from './performance-forecast.js';
import { initializeReports, handleAttendanceReportGeneration } from './reports.js';
import { initializeCurriculumAudit, generateCurriculumAuditPDF, generateCurriculumAuditExcel } from './curriculum-audit.js';
import { initializeRecentDownloads, refreshRecentDownloads } from './recent-downloads.js';

import { initEmployeesSection, observeEmployeesSection } from './employees.js';
import { initResponsiveLayout } from './ui.js';
import { initCurriculum } from './curriculum.js';
import { initProfile } from './profile.js';

// Global exports for curriculum audit (for onclick handlers)
window.generateCurriculumAuditPDF = generateCurriculumAuditPDF;
window.generateCurriculumAuditExcel = generateCurriculumAuditExcel;

// Global exports for recent downloads refresh
window.refreshRecentDownloads = refreshRecentDownloads;

// Global exports for reports
window.handleAttendanceReportGeneration = handleAttendanceReportGeneration;

// Global exports for potential legacy calls (if any inline scripts remains)
window.loadDashboardStats = loadDashboardStats;
window.loadRecentActivity = loadRecentActivity;
window.loadTeamAttendanceStats = loadTeamAttendanceStats;
window.loadDepartmentAttendance = loadDepartmentAttendance;
// window.loadApprovalRequests = loadApprovalRequests;
window.updateDepartmentChips = updateChips;

document.addEventListener('DOMContentLoaded', async function () {
  // CRITICAL: Clear profile cache first to ensure we get fresh department data
  if (window.clearProfileCache) {
    window.clearProfileCache();
    console.log('[departmenthead] CLEARED PROFILE CACHE on initial page load');
  }

  // Initialize responsive layout (updated for new top-nav structure)
  // The old initResponsiveLayout was designed for sidebar - now handled by CSS media queries
  // Note: This function call is kept for compatibility with other modules
  if (typeof initResponsiveLayout === 'function') {
    initResponsiveLayout();
  }

  // Initialize module event listeners
  initAttendance();
  // initApprovals();

  observeEmployeesSection();
  initCurriculum();
  
  // Initialize Profile Section
  initProfile();
  
  // Initialize Curriculum Audit
  initializeCurriculumAudit();
  
  // Setup export button for analytics
  setupExportButton();

  // Initialize Performance & Forecast Analytics
  initializePerformanceForecast();

  // Initialize Reports Module
  initializeReports();

  // Initialize Recent Downloads
  initializeRecentDownloads();

  // Initial Data Load
  loadDashboardStats();
  loadRecentActivity();
  // Pre-load other data so it's ready, or just let navigation handle it?
  // Original code loaded these immediately:
  loadDepartmentAttendance();
  // loadApprovalRequests();
  updateChips();

  // Setup Profile/Department Info in Sidebar - REMOVED
  // const info = await fetchHeadInfo();
  // if (info) {
  //   const deptEl = document.getElementById('userDepartment');
  //   if (deptEl) deptEl.textContent = info.department || 'Unknown';
  // }

  // Initialize System Status and Date - REMOVED
  // updateCurrentDate();
  // checkSystemStatus();

  // Initialize Avatar Display
  async function initializeAvatar() {
    try {
      const avatarEl = document.getElementById('sidebarAvatar');
      const userNameEl = document.getElementById('userName');
      
      if (!avatarEl) return;

      let user = null;
      if (window.AuthGuard && window.AuthGuard.getCurrentUser) {
        user = await window.AuthGuard.getCurrentUser();
      } else if (window.fetchUserProfile) {
        user = await window.fetchUserProfile();
      }

      if (!user) {
        avatarEl.textContent = 'DH';
        if (userNameEl) userNameEl.textContent = 'Department Head';
        return;
      }

      // Get user's first and last names
      const firstName = user.first_name || user.username?.split('@')[0] || 'Department';
      const lastName = user.last_name || 'Head';
      const initials = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
      const displayName = `${firstName} ${lastName}`;

      // Generate deterministic gradient based on name
      function generateAvatarGradient(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
          hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const h1 = Math.abs(hash % 360);
        const h2 = (h1 + 40) % 360;
        const c1 = `hsl(${h1}, 70%, 60%)`;
        const c2 = `hsl(${h2}, 70%, 60%)`;
        return `linear-gradient(135deg, ${c1}, ${c2})`;
      }

      const gradient = generateAvatarGradient(displayName);

      // Update Avatar
      avatarEl.textContent = initials;
      avatarEl.style.background = gradient;
      avatarEl.style.color = '#FFFFFF';
      avatarEl.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';

      // Update User Name Display
      if (userNameEl) {
        userNameEl.textContent = displayName;
      }
    } catch (error) {
      console.error('Error initializing avatar:', error);
      const avatarEl = document.getElementById('sidebarAvatar');
      if (avatarEl) {
        avatarEl.textContent = 'DH';
        avatarEl.style.background = 'linear-gradient(135deg, #3b82f6, #1e40af)';
        avatarEl.style.color = '#FFFFFF';
      }
      const userNameEl = document.getElementById('userName');
      if (userNameEl) userNameEl.textContent = 'Department Head';
    }
  }

  // Initialize avatar immediately
  initializeAvatar();

  // Initialize Back and Logout Buttons
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', function () {
      window.location.href = '../index.html';
    });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      if (window.AuthGuard) {
        window.AuthGuard.logout();
      } else {
        console.error('AuthGuard not found for logout');
        window.location.href = '../index.html';
      }
    });
  }


  // Initialize Sidebar Profile Button (Mobile)
  const sidebarProfileBtn = document.getElementById('sidebarProfileBtn');
  if (sidebarProfileBtn) {
    sidebarProfileBtn.addEventListener('click', async function () {
      // Close sidebar
      const sidebar = document.querySelector('.sidebar');
      const overlay = document.getElementById('menuOverlay');
      if (sidebar) sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('visible');

      // Profile Logic
      try {
        let user = null;
        if (window.AuthGuard && window.AuthGuard.getCurrentUser) {
          user = await window.AuthGuard.getCurrentUser();
        } else if (window.fetchUserProfile) {
          user = await window.fetchUserProfile();
        }

        if (user) {
          if (window.ProfileModal) window.ProfileModal.open('head_dept', user);
        } else {
          if (window.ProfileModal) window.ProfileModal.open('head_dept', { role: 'head_dept' });
        }
      } catch (error) {
        console.error('Error opening profile:', error);
        if (window.ProfileModal) window.ProfileModal.open('head_dept', { role: 'head_dept' });
      }
    });
  }

  // Initialize Sidebar Logout Button (Mobile)
  const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
  if (sidebarLogoutBtn) {
    sidebarLogoutBtn.addEventListener('click', function () {
      if (window.AuthGuard) {
        window.AuthGuard.logout();
      } else {
        console.error('AuthGuard not found for logout');
        window.location.href = '../index.html';
      }
    });
  }

  // Initialize Navigation
  initNavigation();

  // Initialize dropdown menu toggle
  const navDropdown = document.querySelector('.nav-dropdown');
  const navDropdownToggle = document.querySelector('.nav-dropdown-toggle');
  const navDropdownMenu = document.querySelector('.nav-dropdown-menu');

  if (navDropdownToggle && navDropdown) {
    navDropdownToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navDropdown.classList.toggle('open');
      
      // Position the dropdown menu under the More button
      if (navDropdown.classList.contains('open')) {
        const toggleRect = navDropdownToggle.getBoundingClientRect();
        navDropdownMenu.style.left = (toggleRect.left + toggleRect.width / 2 - navDropdownMenu.clientWidth / 2) + 'px';
        navDropdownMenu.style.top = (64 + 8) + 'px';
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!navDropdown.contains(e.target)) {
        navDropdown.classList.remove('open');
      }
    });

    // Close dropdown when a dropdown item is clicked
    const dropdownItems = document.querySelectorAll('.nav-dropdown-item');
    dropdownItems.forEach(item => {
      item.addEventListener('click', () => {
        navDropdown.classList.remove('open');
      });
    });
  }

  // Initialize hide-on-scroll behavior for header
  initializeHeaderHideOnScroll();
});

function initializeHeaderHideOnScroll() {
  const topNav = document.querySelector('.top-nav');
  const header = document.querySelector('.header');
  
  if (!topNav && !header) return;
  
  let lastScrollTop = 0;
  let ticking = false;
  
  // Function to check if we're on mobile/tablet (screen width <= 1024px)
  function isMobileOrTablet() {
    return window.innerWidth <= 1024;
  }
  
  function updateHeaderVisiblity() {
    // Only apply hide-on-scroll for mobile/tablet, desktop header stays visible
    if (!isMobileOrTablet()) {
      // On desktop: always show header
      if (topNav) topNav.classList.remove('hide-on-scroll');
      if (header) header.classList.remove('hide-on-scroll');
      return;
    }
    
    // Mobile/tablet: hide on scroll down
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    
    if (scrollTop > lastScrollTop && scrollTop > 50) {
      // Scrolling DOWN - hide headers on mobile/tablet
      if (topNav) topNav.classList.add('hide-on-scroll');
      if (header) header.classList.add('hide-on-scroll');
    } else {
      // Scrolling UP or near top - show headers
      if (topNav) topNav.classList.remove('hide-on-scroll');
      if (header) header.classList.remove('hide-on-scroll');
    }
    
    lastScrollTop = scrollTop;
    ticking = false;
  }
  
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(updateHeaderVisiblity);
      ticking = true;
    }
  }, false);
  
  // Also check on resize to handle responsive changes
  window.addEventListener('resize', () => {
    if (isMobileOrTablet()) {
      // Switched to mobile/tablet - allow hide-on-scroll
      return;
    } else {
      // Switched to desktop - ensure header is always visible
      if (topNav) topNav.classList.remove('hide-on-scroll');
      if (header) header.classList.remove('hide-on-scroll');
    }
  });
}

// function updateCurrentDate() - REMOVED
// async function checkSystemStatus() - REMOVED

function initNavigation() {
  const sections = document.querySelectorAll('.content-section');
  // Updated selector to work with new top-nav structure
  const navItems = document.querySelectorAll('.nav-link[data-section], .nav-dropdown-item[data-section]');
  const sectionTitle = document.getElementById('section-title');
  // const actionCards = document.querySelectorAll('[data-section-nav]');

  const sectionTitles = {
    'dashboard': 'Dashboard',
    'attendance': 'Team Attendance',
    'approvals': 'Approvals',
    'reports': 'Reports',
    'analytics': 'Analytics',
    'employees': 'Employees',
    'curriculum': 'Assign Professors'
  };

  function showSection(sectionId) {
    // Hide all sections
    sections.forEach(section => section.classList.remove('active'));

    // Remove active from all nav items
    navItems.forEach(item => item.classList.remove('active'));

    // Show selected section
    const targetSection = document.getElementById(`section-${sectionId}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }

    // Update active nav items (both main nav and dropdown)
    const activeNavs = document.querySelectorAll(`[data-section="${sectionId}"]`);
    activeNavs.forEach(nav => nav.classList.add('active'));

    // Update section title
    if (sectionTitle && sectionTitles[sectionId]) {
      sectionTitle.textContent = sectionTitles[sectionId];
    }

    // Load section-specific data
    if (sectionId === 'attendance') {
      loadTeamAttendanceStats();
      loadDepartmentAttendance();
    }

    // if (sectionId === 'approvals') {
    //   loadApprovalRequests();
    // }

    if (sectionId === 'analytics') {
      initializeAnalytics();
    }

    if (sectionId === 'employees') {
      initEmployeesSection();
    }

    if (sectionId === 'curriculum') {
      initCurriculum();
    }

    // Store current section in sessionStorage for persistence
    try {
      sessionStorage.setItem('depthead_active_section', sectionId);
    } catch (e) {
      console.debug('Could not save section to sessionStorage:', e);
    }
  }

  // Nav item click handlers
  navItems.forEach(item => {
    item.addEventListener('click', function () {
      const section = this.getAttribute('data-section');
      showSection(section);
      
      // Close dropdown if open
      const dropdown = document.querySelector('.nav-dropdown');
      if (dropdown) {
        dropdown.classList.remove('open');
      }
    });
  });

  // Action card click handlers - REMOVED
  // actionCards.forEach(card => {
  //   card.addEventListener('click', function () {
  //     const section = this.getAttribute('data-section-nav');
  //     showSection(section);
  //   });
  // });

  // Restore last active section or default to dashboard
  try {
    const lastSection = sessionStorage.getItem('depthead_active_section') || 'dashboard';
    showSection(lastSection);
  } catch (e) {
    showSection('dashboard');
  }
}
