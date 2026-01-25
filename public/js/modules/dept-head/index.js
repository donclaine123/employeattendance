
import { fetchHeadInfo } from './utils.js';
// import { loadApprovalRequests, initApprovals } from './approvals.js';
import { loadDepartmentAttendance, initAttendance } from './attendance.js';
import { loadDashboardStats, loadRecentActivity, loadTeamAttendanceStats, updateChips } from './stats.js';

import { initEmployeesSection, observeEmployeesSection } from './employees.js';
import { initResponsiveLayout } from './ui.js';
import { initCurriculum } from './curriculum.js';

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

  // Initialize UI / Responsive Layout
  initResponsiveLayout();

  // Initialize module event listeners
  initAttendance();
  // initApprovals();

  observeEmployeesSection();
  initCurriculum();

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

  // Initialize Profile Button
  const profileBtn = document.getElementById('profileBtn');
  if (profileBtn) {
    profileBtn.addEventListener('click', async function () {
      try {
        // AuthGuard is global from api.js/auth.js? No, likely global. 
        // But wait, where is AuthGuard defined? It's usually in api.js or auth.js.
        // If it's not available, we fallback.
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
});

// function updateCurrentDate() - REMOVED
// async function checkSystemStatus() - REMOVED

function initNavigation() {
  const sections = document.querySelectorAll('.content-section');
  // FIX: Only select nav-items inside the actual navigation container
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  const sectionTitle = document.getElementById('section-title');
  // const actionCards = document.querySelectorAll('[data-section-nav]');

  const sectionTitles = {
    'dashboard': 'Dashboard',
    'attendance': 'Team Attendance',
    'approvals': 'Approvals',
    'reports': 'Reports',
    'analytics': 'Analytics',
    'employees': 'Employees'
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

    // Update active nav item
    const activeNav = document.querySelector(`[data-section="${sectionId}"]`);
    if (activeNav) {
      activeNav.classList.add('active');
    }

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



    if (sectionId === 'employees') {
      initEmployeesSection();
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
