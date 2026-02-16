/**
 * index.js
 * Main Entry Point for HR Dashboard
 */

import { initProfile } from './profile.js';
import { initUI } from './ui.js';
import { initWebSocket } from './qr.js';
import { initAttendance } from './attendance.js';
import { initEmployeeManagement } from './employees.js';
import { initHourlyRounds } from './rounds.js';
import { initSchedules } from './schedules.js';
import { initOnlineAttendance } from './online-attendance.js';
import { initReports } from './reports.js';

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[HR] Dashboard initializing...');

  // 1. Check Auth (Optional, if AuthGuard is global and needed here)
  // const user = await AuthGuard.getCurrentUser(); 

  // 2. Initialize components
  try {
    // UI first
    initUI();

    // Core Data
    await initProfile();

    // Features
    initWebSocket();
    initAttendance();
    initEmployeeManagement();
    initHourlyRounds();
    initSchedules();
    initOnlineAttendance();
    initReports();
  } catch (error) {
    console.error('Error initializing HR Dashboard:', error);
  }
});

// Global Error Handling
window.addEventListener('unhandledrejection', event => {
  console.warn('Unhandled promise rejection:', event.reason);
});
