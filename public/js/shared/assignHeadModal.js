/**
 * Assign Department Head Modal - Shared Utility
 * Used by both HR Dashboard and Superadmin pages
 */

// Import from relative paths won't work easily here as this is a shared script usually loaded via script tag
// But we assume the containing page has access to showConfirmDialog and showToast globally 
// or through the module system they are part of.

/**
 * Modern Alert Helper
 * Since this is a shared JS file that might be loaded in pages without the ES6 modules,
 * we try to use the modern functions if available, otherwise fallback to native.
 */
async function safeConfirm(title, message) {
    if (typeof showConfirmDialog === 'function') {
        return await showConfirmDialog(title, message);
    }
    // Fallback to native if modern UI utility is missing
    return confirm(`${title}\n\n${message}`);
}

function safeToast(message, type = 'success') {
    if (typeof showToast === 'function') {
        showToast(message, type);
    } else {
        // Fallback to alert if modern UI utility is missing
        alert(message);
    }
}

// Show assign head modal - uses static HTML modal
async function showAssignHeadModal(deptId, deptName, heads) {
    const modal = document.getElementById('assign-head-modal');
    if (!modal) return;

    // Reset form
    const form = document.getElementById('assign-head-form');
    if (form) form.reset();

    // Set context
    document.getElementById('assign-dept-id').value = deptId;
    document.getElementById('assign-dept-name').textContent = deptName;

    // Fetch current head and eligible employees
    try {
        // Find the row in the table to get current head name quickly
        const row = document.querySelector(`tr[data-dept-id="${deptId}"]`);
        let currentHeadName = 'Not Assigned';

        if (row) {
            const cells = row.querySelectorAll('td');
            let headText = '';

            // Superadmin table: [ID, Name, Head (with status badge), Description, Count, Actions]
            const headCell = cells[2]; // Head column in Superadmin
            
            if (headCell) {
                // The cell contains both a status badge and the name
                // Status badge has class "status-badge" and contains "Active" or "Missing Head"
                const badgeEl = headCell.querySelector('.status-badge');
                const badgeText = badgeEl ? badgeEl.textContent.trim() : '';
                
                // If badge says "Missing Head", then there's no head assigned
                if (badgeText === 'Missing Head') {
                    headText = '';
                } else {
                    // Extract the name text (everything after the badge)
                    let text = headCell.textContent.trim();
                    // Remove the badge text from the extracted text
                    if (badgeText) {
                        text = text.replace(badgeText, '').trim();
                    }
                    headText = text;
                }
            }

            currentHeadName = headText || 'Not Assigned';
        }

        const isAssigned = currentHeadName !== 'Not Assigned' && currentHeadName !== 'Unassigned' && currentHeadName !== '';

        // Render Current Head Card
        const container = document.getElementById('current-head-container');
        if (isAssigned) {
            // Fetch employees to populate dropdown
            const candidatesResp = await fetchWithAuth('/admin/department-heads');
            const responseData = candidatesResp.ok ? await candidatesResp.json() : { data: [] };
            const candidates = responseData.data || responseData || [];
            console.log('[showAssignHeadModal] Candidates fetched:', candidates.length, candidates);

            // Render the "Active Head" card
            const initials = currentHeadName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

            container.innerHTML = `
                <div class="current-head-card" style="background: var(--bg-tertiary); padding: 16px; border-radius: var(--radius-md); border: 1px solid var(--border-primary); display: flex; align-items: center; gap: 12px;">
                    <div class="user-avatar" style="width: 40px; height: 40px; background: var(--accent-primary); color: var(--bg-primary); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">${initials}</div>
                    <div>
                        <div style="font-size: 12px; color: var(--text-secondary);">Current Head</div>
                        <div style="font-weight: 600; color: var(--text-primary); font-size: 15px;">${escapeHtml(currentHeadName)}</div>
                    </div>
                    <button id="remove-current-head-btn" style="margin-left: auto; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; font-weight: 500; display: flex; align-items: center; gap: 4px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                        Remove
                    </button>
                </div>
            `;

            // Add click handler for remove button
            const removeBtn = document.getElementById('remove-current-head-btn');
            if (removeBtn) {
                removeBtn.addEventListener('click', async () => {
                    // Ask for confirmation before removing
                    const confirmed = await safeConfirm(
                        'Remove Department Head',
                        `Are you sure you want to remove ${escapeHtml(currentHeadName)} as department head?\n\nThey will be demoted back to employee role.`
                    );
                    if (!confirmed) return;

                    // Submit the form to remove the head (headId = null/empty)
                    const deptId = document.getElementById('assign-dept-id').value;
                    await window.assignDepartmentHead(deptId, null);
                    // Modal will be closed by assignDepartmentHead after refresh
                });
            }

            // Show Warning
            const warningBox = document.getElementById('assign-warning-box');
            const warningText = document.getElementById('assign-warning-text');
            if (warningBox) {
                warningBox.style.display = 'flex';
                warningText.innerHTML = `<strong>${escapeHtml(currentHeadName)}</strong> will be reassigned to a regular Employee role.`;
            }

            // Populate dropdown with all candidates
            populateNewHeadDropdown(candidates, currentHeadName);

        } else {
            // No Head Assigned
            container.innerHTML = `
                <div class="current-head-card" style="background: var(--bg-tertiary); padding: 16px; border-radius: var(--radius-md); border: 1px dashed var(--border-secondary); display: flex; align-items: center; gap: 12px; justify-content: center; color: var(--text-secondary);">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    <span style="font-size: 14px;">No Head Assigned</span>
                </div>
            `;

            // Hide Warning
            const warningBox = document.getElementById('assign-warning-box');
            if (warningBox) warningBox.style.display = 'none';

            // Fetch candidates
            const candidatesResp = await fetchWithAuth('/admin/department-heads');
            const responseData = candidatesResp.ok ? await candidatesResp.json() : { data: [] };
            const candidates = responseData.data || responseData || [];

            // Populate dropdown with all candidates
            populateNewHeadDropdown(candidates, null);
        }

    } catch (e) {
        console.error('Error preparing assign modal:', e);
        alert('Failed to load employee data.');
        return;
    }

    modal.style.display = 'flex';

    // Internal helper to populate dropdown
    function populateNewHeadDropdown(employees, currentHeadName) {
        const select = document.getElementById('new-head-select');
        select.innerHTML = '<option value="">Select an employee...</option>';

        // Sort alphabetically
        employees.sort((a, b) => {
            const nameA = (a.first_name || a.full_name || '').localeCompare(b.first_name || b.full_name || '');
            return nameA;
        });

        employees.forEach(emp => {
            // Safely construct full name - handle both old and new data structures
            const firstName = emp.first_name || '';
            const lastName = emp.last_name || '';
            const fullName = emp.full_name || emp.name || `${firstName} ${lastName}`.trim();

            // Skip empty names and current head
            if (!fullName) {
                return;
            }
            if (currentHeadName && fullName === currentHeadName) {
                return;
            }

            const option = document.createElement('option');
            // Get the employee ID - try multiple field names
            let empId = emp.id || emp.employee_id || emp.user_id;
            
            // Convert to number if it's a numeric string or already a number
            if (empId) {
                empId = Number(empId);
            }
            
            // Skip if no valid ID found
            if (!empId) {
                console.warn('[assignHeadModal] Employee has no valid ID:', emp);
                return;
            }
            
            option.value = empId;
            const position = emp.position || 'Employee';
            option.textContent = `${fullName} (${position})`;
            select.appendChild(option);
        });

    }
}

// Expose globally so departments.js can call it
window.showAssignHeadModal = showAssignHeadModal;

// Initialize Assign Modal Events
function initAssignModal() {
    const modal = document.getElementById('assign-head-modal');
    const form = document.getElementById('assign-head-form');
    const closeBtn = document.getElementById('assign-head-modal-close');
    const cancelBtn = document.getElementById('assign-head-cancel-btn');

    if (!modal) {
        console.error('[initAssignModal] Modal element not found!');
        return;
    }

    const closeModal = () => {
        modal.style.display = 'none';
    };

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
        });
    }

    // Close on outside click
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const deptId = document.getElementById('assign-dept-id').value;
            const newHeadIdStr = document.getElementById('new-head-select').value;
            const newHeadId = newHeadIdStr ? Number(newHeadIdStr) : null;

            if (!newHeadId || isNaN(newHeadId)) {
                safeToast('Please select an employee to assign.', 'error');
                return;
            }

            // Get selected employee name for confirmation
            const selectElement = document.getElementById('new-head-select');
            const selectedOption = selectElement.options[selectElement.selectedIndex];
            const selectedText = selectedOption.textContent;
            const selectedName = selectedText.split(' (')[0]; // Extract name from "Name (Position)" format
            const deptName = document.getElementById('assign-dept-name').textContent;

            // Ask for confirmation before assigning
            const confirmed = await safeConfirm(
                'Assign Department Head',
                `Assign ${selectedName} as the head of ${deptName}?\n\nThey will be promoted to department head role.`
            );
            if (!confirmed) return;

            await window.assignDepartmentHead(deptId, newHeadId);
            // Modal will be closed by assignDepartmentHead after refresh
        });
    }
}

// Call after DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAssignModal);
} else {
    initAssignModal();
}

// Helper to escape HTML
window.escapeHtml = function (unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

// Assign department head (Logic) - shared function
window.assignDepartmentHead = async function (deptId, headId) {
    try {
        console.log('[assignHeadModal] Assigning department head - deptId:', deptId, 'headId:', headId, 'type:', typeof headId);
        
        // Validate inputs
        if (!deptId) {
            console.error('[assignHeadModal] Invalid deptId:', deptId);
            showToast('Invalid department ID', 'error');
            return;
        }

        const resp = await fetchWithAuth(`/api/admin/departments/${deptId}/head`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: headId || null })
        });

        if (resp && resp.ok) {
            // Refresh departments table
            if (typeof window.initializeDepartments === 'function') {
                await window.initializeDepartments();
            } else if (typeof initializeDepartments === 'function') {
                // Fallback in case it's available locally
                await initializeDepartments();
            }

            // Close modal after refresh
            const modal = document.getElementById('assign-head-modal');
            if (modal) {
                modal.style.display = 'none';
            }

            // Success notification - show after modal closes
            const isRemoving = !headId;
            showToast(isRemoving ? 'Department head removed successfully' : 'Department head assigned successfully', 'success');
        } else {
            const err = resp ? await resp.json().catch(() => ({})) : { error: 'Request failed' };
            showToast(`Failed to ${headId ? 'assign' : 'remove'} department head: ${err.error || 'Unknown error'}`, 'error');
        }
    } catch (err) {
        console.error('Assign department head request failed:', err);
        showToast('Failed to assign department head due to network error.', 'error');
    }
};
