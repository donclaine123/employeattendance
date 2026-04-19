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

const SUPERADMIN_SECTION_STORAGE_KEY = 'superadmin_active_section';
const SUPERADMIN_ACCESS_VIEW_STORAGE_KEY = 'superadmin_access_view';
const SUPERADMIN_SYSTEM_VIEW_STORAGE_KEY = 'superadmin_system_view';

function readSuperadminStorage(key, fallback) {
  try {
    return sessionStorage.getItem(key) || fallback;
  } catch (error) {
    return fallback;
  }
}

function writeSuperadminStorage(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch (error) {
    // Ignore storage failures and keep the UI usable.
  }
}

// --- Tab Navigation ---

function initializeTabNavigation() {
  const tabs = document.querySelectorAll('.hr-tabs .tab');
  if (!tabs.length) {
    return;
  }

  const sections = {
    'People Management': document.getElementById('user-management-section'),
    'System Settings': document.getElementById('section-settings'),
    'Backup & Restore': document.getElementById('section-settings'),
    'Audit Logs': document.getElementById('audit-logs-section')
  };

  // Dashboard overview section (main card) is only visible on People Management
  const dashboardOverview = document.getElementById('dashboard-overview-section');
  // Departments section should only be visible under People Management
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

    if ((sectionName === 'System Settings' || sectionName === 'Backup & Restore') && typeof window.switchSuperadminSystemView === 'function') {
      window.switchSuperadminSystemView(sectionName === 'Backup & Restore' ? 'backup' : 'settings');
    }

    // Show departments only for People Management
    if (sectionName === 'People Management') {
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

  // Show People Management by default (includes dashboard overview)
  showSection('People Management');
}

// --- Section Navigation ---
function setupSectionNavigation() {
  const navItems = document.querySelectorAll('.top-nav [data-section], .mobile-bottom-nav [data-section], .sidebar-nav .nav-item[data-section]');
  const pageTitle = document.getElementById('pageTitle');
  const mobileDropdown = document.querySelector('.mobile-nav-dropdown');

  const sectionTitles = {
    'dashboard': 'Dashboard',
    'users': 'People Management',
    'departments': 'Departments',
    'settings': 'System',
    'backup': 'Backup & Recovery',
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
    const requestedSection = section === 'invite' ? 'users' : section;
    const resolvedSection = requestedSection === 'backup' ? 'settings' : (requestedSection === 'departments' ? 'users' : requestedSection);
    const systemView = requestedSection === 'backup' ? 'backup' : 'settings';
    const accessView = requestedSection === 'departments'
      ? 'departments'
      : (section === 'invite' ? 'invite' : (readSuperadminStorage(SUPERADMIN_ACCESS_VIEW_STORAGE_KEY, 'users') === 'departments' ? 'departments' : 'users'));
    const activeSection = requestedSection === 'departments' ? 'departments' : resolvedSection;

    writeSuperadminStorage(SUPERADMIN_SECTION_STORAGE_KEY, requestedSection);

    // Hide all content sections
    document.querySelectorAll('.content-section').forEach(sec => {
      sec.classList.remove('active');
    });

    // Show selected section
    const targetSection = document.getElementById(`section-${resolvedSection}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }

    setActiveNavigation(activeSection);

    // Update page title
    const titleKey = sectionTitles[requestedSection] ? requestedSection : resolvedSection;
    if (pageTitle && sectionTitles[titleKey]) {
      pageTitle.textContent = sectionTitles[titleKey];
    }

    if (resolvedSection === 'users' && typeof window.switchSuperadminAccessView === 'function') {
      window.switchSuperadminAccessView(accessView);
    }

    if (resolvedSection === 'settings' && typeof window.switchSuperadminSystemView === 'function') {
      window.switchSuperadminSystemView(systemView);
    }

    // Reload data based on section
    if (resolvedSection === 'dashboard') loadDashboardStats();
    if (requestedSection === 'departments') initializeDepartments();
    if (resolvedSection === 'attendance') loadAndRenderAttendanceSuperadmin();
  }

  window.navigateSuperadminSection = openSection;

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const section = item.getAttribute('data-section');
      if (!section) return;

      openSection(section);
    });
  });

  const storedSection = readSuperadminStorage(SUPERADMIN_SECTION_STORAGE_KEY, '');
  const initialSection = document.querySelector('.top-nav .nav-link.active, .mobile-bottom-nav .mobile-nav-item.active, .sidebar-nav .nav-item.active');
  if (storedSection) {
    openSection(storedSection);
  } else if (initialSection && initialSection.getAttribute('data-section')) {
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
