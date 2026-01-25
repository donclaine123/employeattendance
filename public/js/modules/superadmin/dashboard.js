/**
 * dashboard.js
 * Dashboard Overview Statistics
 */

import { fetchWithAuth } from './utils.js';

export async function loadDashboardStats() {
  try {
    // Fetch all users
    const usersResp = await fetchWithAuth('/admin/users?_page=1&_limit=1000', {});
    const usersData = usersResp.ok ? await usersResp.json() : {};
    const users = usersData.data || usersData || [];

    // Fetch all departments
    const deptsResp = await fetchWithAuth('/admin/departments', {});
    const deptsData = deptsResp.ok ? await deptsResp.json() : {};
    const departments = deptsData.data || deptsData || [];

    // Fetch all employees (correct endpoint)
    const empResp = await fetchWithAuth('/hr/employees?_page=1&_limit=1000', {});
    const empData = empResp.ok ? await empResp.json() : {};
    const employees = empData.data || empData || [];

    // Calculate stats
    const totalUsers = Array.isArray(users) ? users.length : 0;
    const activeUsers = Array.isArray(users) ? users.filter(u => u.status && u.status.toLowerCase() === 'active').length : 0;
    const totalDepartments = Array.isArray(departments) ? departments.length : 0;
    const totalEmployees = Array.isArray(employees) ? employees.length : 0;

    // Update dashboard display
    const el = (id) => document.getElementById(id);
    if (el('total-users')) el('total-users').textContent = totalUsers;
    if (el('active-users')) el('active-users').textContent = activeUsers;
    if (el('total-departments')) el('total-departments').textContent = totalDepartments;
    if (el('total-employees')) el('total-employees').textContent = totalEmployees;

    console.log('[dashboard] Stats loaded:', { totalUsers, activeUsers, totalDepartments, totalEmployees });
  } catch (error) {
    console.error('[dashboard] Failed to load stats:', error);
  }
}

export async function updateOverview() {
  try {
    // Fetch authoritative profile from server (do not rely on sessionStorage)
    let currentUser = {};
    try {
      const profileResp = await fetchWithAuth('/auth/profile');
      if (profileResp && (profileResp.ok || profileResp.status === 304)) {
        try {
          currentUser = profileResp.status === 304 ? {} : await profileResp.json();
        } catch (e) {
          currentUser = {};
        }
      }
    } catch (e) {
      console.warn('[superadmin] Failed to fetch profile for overview:', e);
      currentUser = {};
    }

    // Update greeting name
    const greetingStrong = document.querySelector('.greeting strong');
    if (greetingStrong) {
      const displayName = currentUser.full_name || [(currentUser.first_name || ''), (currentUser.last_name || '')].filter(Boolean).join(' ') || (currentUser.username || 'Administrator');
      greetingStrong.textContent = displayName;
    }

    // Update role and last login inside the left employee-card
    const cardRows = document.querySelectorAll('.employee-card .card-row');
    if (cardRows && cardRows.length >= 3) {
      // Role (row 0)
      const roleValue = cardRows[0].querySelector('.value');
      if (roleValue) roleValue.textContent = (currentUser.role || 'Super Admin');

      // Last Login (row 2)
      const lastLoginValue = cardRows[2].querySelector('.value');
      if (lastLoginValue) {
        const last = currentUser.last_login || currentUser.lastLogin || currentUser.last_logged_in;
        lastLoginValue.textContent = last ? new Date(last).toLocaleDateString() + ' ' + new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never';
      }
    }

    // Quick Stats are also updated by loadDashboardStats but updateOverview in legacy handled them too.
    // We can leave the basic stats in loadDashboardStats as it's more comprehensive.

  } catch (e) {
    console.error('updateOverview error:', e);
  }
}
