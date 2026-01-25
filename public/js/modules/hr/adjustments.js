/**
 * adjustments.js
 * Manual Attendance Adjustments Logic for HR Dashboard
 */

import { fetchWithAuth, escapeHtml } from './utils.js';

export class AttendanceAdjustments {
  constructor() {
    this.adjustmentHistory = [];
    this.elements = {
      form: document.getElementById('adjustmentForm'),
      employee: document.getElementById('adjustmentEmployee'),
      status: document.getElementById('adjustmentStatus'),
      time: document.getElementById('adjustmentTime'),
      reason: document.getElementById('adjustmentReason'),
      auditLog: document.getElementById('adjustmentAuditLog'),
      saveBtn: document.querySelector('.btn-save-adjustment')
    };

    this.init();
  }

  init() {
    console.log('[HR] Initializing Attendance Adjustments...');
    if (this.elements.form) {
      this.elements.form.addEventListener('submit', (e) => this.handleSubmit(e));
    }
    this.loadAuditHistory();
  }

  async handleSubmit(e) {
    e.preventDefault();

    const formData = {
      employee: this.elements.employee.value.trim(),
      status: this.elements.status.value,
      time: this.elements.time.value || null,
      reason: this.elements.reason.value.trim()
    };

    if (!formData.employee || !formData.status || !formData.reason) {
      alert('Please fill in all required fields');
      return;
    }

    if (this.elements.saveBtn) {
      this.elements.saveBtn.disabled = true;
      this.elements.saveBtn.textContent = 'Saving...';
    }

    try {
      // Call API to save adjustment
      const response = await fetchWithAuth('/hr/adjustments', {
        method: 'POST',
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to save adjustment');
      }

      // Add to audit history locally (or re-fetch)
      this.addAuditEntry({
        time: new Date().toLocaleTimeString(),
        action: `Override: ${formData.employee} set ${formData.status}`,
        by: 'Current User',
        employee: formData.employee,
        status: formData.status,
        reason: formData.reason
      });

      // Show success message
      this.showNotification('Adjustment saved successfully', 'success');
      this.elements.form.reset();

    } catch (error) {
      console.error('Error saving adjustment:', error);
      this.showNotification(error.message || 'Failed to save adjustment', 'error');
    } finally {
      if (this.elements.saveBtn) {
        this.elements.saveBtn.disabled = false;
        this.elements.saveBtn.textContent = 'Save Adjustment';
      }
    }
  }

  addAuditEntry(entry) {
    this.adjustmentHistory.unshift(entry);
    this.renderAuditLog();
  }

  async loadAuditHistory() {
    try {
      const response = await fetchWithAuth('/hr/adjustments/history?limit=10');
      if (response.ok) {
        const resData = await response.json();
        const history = resData.data || resData;
        if (Array.isArray(history)) {
          this.adjustmentHistory = history;
          this.renderAuditLog();
        }
      }
    } catch (error) {
      console.error('Error loading audit history:', error);
    }
  }

  renderAuditLog() {
    if (!this.elements.auditLog) return;

    if (this.adjustmentHistory.length === 0) {
      this.elements.auditLog.innerHTML = `
                <div class="audit-log-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                    <p>No adjustments recorded yet</p>
                </div>
            `;
      return;
    }

    this.elements.auditLog.innerHTML = this.adjustmentHistory.map(entry => {
      const iconClass = this.getIconClass(entry.status);
      const svgIcon = this.getSvgIcon(entry.status);

      // Handle potentially different data structures if fetched vs created locally
      const timeVal = entry.created_at ? new Date(entry.created_at).toLocaleTimeString() : (entry.time || '');
      const actionVal = entry.action || `Override: ${entry.employee_name || entry.employee} set ${entry.status}`;
      const byVal = entry.performed_by || entry.by || 'System';
      const reasonVal = entry.reason || '';

      return `
                <div class="audit-log-entry">
                    <div class="audit-entry-icon ${iconClass}">
                        ${svgIcon}
                    </div>
                    <div class="audit-entry-content">
                        <div class="audit-entry-time">${escapeHtml(timeVal)}</div>
                        <div class="audit-entry-action">${escapeHtml(actionVal)}</div>
                        <div class="audit-entry-by">By: ${escapeHtml(byVal)}</div>
                        ${reasonVal ? `<div class="audit-entry-reason" style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Reason: ${escapeHtml(reasonVal)}</div>` : ''}
                    </div>
                </div>
            `;
    }).join('');
  }

  getIconClass(status) {
    const statusMap = {
      'present': 'override-present',
      'late': 'override-late',
      'absent': 'override-absent',
      'on-leave': 'override-absent',
      'revoke': 'revoke'
    };
    return statusMap[status] || 'override-present';
  }

  getSvgIcon(status) {
    const icons = {
      'present': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
      'late': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
      'absent': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
      'on-leave': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26H22L17.5 12.26L19.59 18.5L12 14.5L4.41 18.5L6.5 12.26L2 8.26H9.09L12 2Z"></path></svg>',
      'revoke': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6L18 18"></path></svg>'
    };
    return icons[status] || icons['present'];
  }

  showNotification(message, type) {
    const notification = document.createElement('div');
    notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 14px 20px;
            background-color: ${type === 'success' ? '#22c55e' : '#ef4444'};
            color: var(--bg-primary);
            border-radius: 6px;
            font-weight: 500;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 3000);
  }
}

export function initAdjustments() {
  window.attendanceAdjustments = new AttendanceAdjustments();
}
