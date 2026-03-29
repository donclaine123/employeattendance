/**
 * SUPERADMIN MODULE - Main Entry Point
 */

import { initUI } from './ui.js';
import { updateOverview, loadDashboardStats } from './dashboard.js';
import { initializeDepartments } from './departments.js';
import { setupUserManagementListeners, refreshUserList } from './users.js';
import { fetchAndRenderSettings } from './settings.js';
import { initializeAudit } from './audit.js';
import { loadAndRenderAttendanceSuperadmin } from './attendance.js';
import { initializeHealthDashboard } from './system-health.js';
import { initializeBackupManagement } from './backup.js';
import { safeAdd, showConfirmDialog, showToast } from './utils.js';

// Expose modern UI helpers to non-module shared scripts
window.showConfirmDialog = showConfirmDialog;
window.showToast = showToast;
window.initializeDepartments = initializeDepartments;

// --- Tab Navigation ---

function initializeTabNavigation() {
  const tabs = document.querySelectorAll('.hr-tabs .tab');
  const sections = {
    'User Management': document.getElementById('user-management-section'),
    'System Settings': document.getElementById('system-settings-section'),
    'Backup & Restore': document.getElementById('backup-restore-section'),
    'Audit Logs': document.getElementById('audit-logs-section')
  };

  // Dashboard overview section (main card) is only visible on User Management
  const dashboardOverview = document.getElementById('dashboard-overview-section');
  // Departments section should only be visible under User Management
  const departmentsSection = document.getElementById('departments-section');

  function showSection(sectionName) {
    // Hide all sections
    Object.values(sections).forEach(section => {
      if (section) section.style.display = 'none';
    });
    // Also hide departments by default (it is not part of the sections mapping)
    if (departmentsSection) departmentsSection.style.display = 'none';

    // Hide dashboard overview by default
    if (dashboardOverview) dashboardOverview.style.display = 'none';

    // Show the selected section
    const targetSection = sections[sectionName];
    if (targetSection) {
      targetSection.style.display = 'block';
    }

    // Show departments only for User Management
    if (sectionName === 'User Management') {
      if (departmentsSection) departmentsSection.style.display = 'block';
      if (dashboardOverview) dashboardOverview.style.display = 'block';
    }

    // Update tab active states
    tabs.forEach(tab => {
      tab.classList.remove('active');
      if (tab.textContent.trim() === sectionName) {
        tab.classList.add('active');
      }
    });
  }

  // Add click listeners to tabs
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.textContent.trim();
      showSection(tabName);
    });
  });

  // Show User Management by default (includes dashboard overview)
  showSection('User Management');
}

// --- Section Navigation ---
function setupSectionNavigation() {
  const navItems = document.querySelectorAll('.top-nav [data-section], .mobile-bottom-nav [data-section], .sidebar-nav .nav-item[data-section]');
  const pageTitle = document.getElementById('pageTitle');
  const mobileDropdown = document.querySelector('.mobile-nav-dropdown');

  const sectionTitles = {
    'dashboard': 'Dashboard',
    'users': 'User Management',
    'departments': 'Departments',
    'settings': 'System Settings',
    'backup': 'Backup Management',
    'audit': 'Audit Logs',
    'invitations': 'Employee Registration',
    'attendance': 'Attendance'
  };

  function setActiveNavigation(section) {
    navItems.forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-section') === section);
    });

    if (mobileDropdown) {
      mobileDropdown.classList.remove('open');
    }
  }

  function openSection(section) {
    // Hide all content sections
    document.querySelectorAll('.content-section').forEach(sec => {
      sec.classList.remove('active');
    });

    // Show selected section
    const targetSection = document.getElementById(`section-${section}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }

    setActiveNavigation(section);

    // Update page title
    if (pageTitle && sectionTitles[section]) {
      pageTitle.textContent = sectionTitles[section];
    }

    // Reload data based on section
    if (section === 'dashboard') loadDashboardStats();
    if (section === 'departments') initializeDepartments();
    if (section === 'attendance') loadAndRenderAttendanceSuperadmin();
  }

  window.navigateSuperadminSection = openSection;

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const section = item.getAttribute('data-section');
      if (!section) return;

      openSection(section);
    });
  });

  const initialSection = document.querySelector('.top-nav .nav-link.active, .mobile-bottom-nav .mobile-nav-item.active, .sidebar-nav .nav-item.active');
  if (initialSection && initialSection.getAttribute('data-section')) {
    openSection(initialSection.getAttribute('data-section'));
  } else {
    openSection('dashboard');
  }
}

// --- Initialization ---

async function initialize() {
  console.log('[Superadmin] Initializing modules...');

  // Initialize unified invitation manager for superadmin context
  window.invitationManager = new InvitationManager('superadmin');

  // Core Layout
  initUI(); // Initialize Mobile Menu & Responsiveness
  setupSectionNavigation();
  initializeTabNavigation();

  // Feature Modules
  await updateOverview();         // Profile & Basic Info
  await loadDashboardStats();     // Counters
  await initializeHealthDashboard(); // System Health Monitoring
  await initializeBackupManagement(); // Backup Management

  setupUserManagementListeners();
  await refreshUserList();

  fetchAndRenderSettings();
  initializeAudit();
  await initializeDepartments();
  loadAndRenderAttendanceSuperadmin();

  console.log('[Superadmin] Initialization complete.');
}

document.addEventListener('DOMContentLoaded', initialize);
