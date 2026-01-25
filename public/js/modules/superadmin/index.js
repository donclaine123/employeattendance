/**
 * SUPERADMIN MODULE - Main Entry Point
 */

import { initUI } from './ui.js';
import { updateOverview, loadDashboardStats } from './dashboard.js';
import { initializeDepartments } from './departments.js';
import { setupUserManagementListeners, refreshUserList } from './users.js';
import { fetchAndRenderSettings } from './settings.js';
import { initializeAudit } from './audit.js';
import { initializeActivityMonitor } from './activity.js';
import { loadAndRenderAttendanceSuperadmin } from './attendance.js';
import { safeAdd } from './utils.js';

// --- Tab Navigation ---

function initializeTabNavigation() {
  const tabs = document.querySelectorAll('.hr-tabs .tab');
  const sections = {
    'User Management': document.getElementById('user-management-section'),
    'System Settings': document.getElementById('system-settings-section'),
    'Backup & Restore': document.getElementById('backup-restore-section'),
    'Audit Logs': document.getElementById('audit-logs-section'),
    'Activity Monitor': document.getElementById('activity-monitor-section')
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

// --- Section Navigation (Left Sidebar) ---
function setupSectionNavigation() {
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  const pageTitle = document.getElementById('pageTitle');

  const sectionTitles = {
    'dashboard': 'Dashboard',
    'users': 'User Management',
    'departments': 'Departments',
    'settings': 'System Settings',
    'backup': 'Backup & Restore',
    'audit': 'Audit Logs',
    'activity': 'Activity Monitor',
    'invitations': 'Employee Registration',
    'attendance': 'Attendance'
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const section = item.getAttribute('data-section');
      if (!section) return;

      // Hide all content sections
      document.querySelectorAll('.content-section').forEach(sec => {
        sec.classList.remove('active');
      });

      // Show selected section
      const targetSection = document.getElementById(`section-${section}`);
      if (targetSection) {
        targetSection.classList.add('active');
      }

      // Update active nav item
      navItems.forEach(ni => ni.classList.remove('active'));
      item.classList.add('active');

      // Update page title
      if (pageTitle && sectionTitles[section]) {
        pageTitle.textContent = sectionTitles[section];
      }

      // Reload data based on section
      if (section === 'dashboard') loadDashboardStats();
      if (section === 'departments') initializeDepartments();
      if (section === 'attendance') loadAndRenderAttendanceSuperadmin();
    });
  });
}

// --- File Restore Handler (Backup) ---
function setupBackupRestore() {
  const fileInput = document.getElementById('restore-backup-file');
  const fileLabel = document.querySelector('.file-input-label');
  const fileFeedback = document.getElementById('file-feedback');
  const restoreBtn = document.getElementById('restore-backup-btn');

  if (!fileInput || !fileLabel || !fileFeedback || !restoreBtn) return;

  // Handle file selection
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      fileFeedback.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
      restoreBtn.disabled = false;
    } else {
      fileFeedback.textContent = 'No file selected';
      restoreBtn.disabled = true;
    }
  });

  // Make label clickable to open file picker
  fileLabel.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.click();
  });

  // Drag and drop support
  fileLabel.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileLabel.style.backgroundColor = 'var(--bg-input)';
    fileLabel.style.borderColor = 'var(--accent-primary)';
  });

  fileLabel.addEventListener('dragleave', (e) => {
    e.preventDefault();
    fileLabel.style.backgroundColor = '';
    fileLabel.style.borderColor = '';
  });

  fileLabel.addEventListener('drop', (e) => {
    e.preventDefault();
    fileLabel.style.backgroundColor = '';
    fileLabel.style.borderColor = '';

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      fileInput.files = files;
      const event = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(event);
    }
  });
}

// --- Initialization ---

async function initialize() {
  console.log('[Superadmin] Initializing modules...');

  // Core Layout
  initUI(); // Initialize Mobile Menu & Responsiveness
  setupSectionNavigation();
  initializeTabNavigation();

  // Feature Modules
  await updateOverview();         // Profile & Basic Info
  await loadDashboardStats();     // Counters

  setupUserManagementListeners();
  await refreshUserList();

  fetchAndRenderSettings();
  initializeAudit();
  initializeActivityMonitor();
  await initializeDepartments();
  loadAndRenderAttendanceSuperadmin();

  setupBackupRestore();

  console.log('[Superadmin] Initialization complete.');
}

document.addEventListener('DOMContentLoaded', initialize);
