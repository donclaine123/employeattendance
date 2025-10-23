/**
 * Shared Department Head Assignment Utility
 * Used by both HR and SuperAdmin pages
 * Handles all logic for assigning/removing department heads
 */

(function() {
    // Expose globally for both HR and SuperAdmin
    window.AssignHeadUtil = {
        /**
         * Initialize the department head dropdown
         * @param {string} selectElementId - ID of the select element
         * @param {function} fetchAuthFunc - Function to make authenticated requests
         * @param {function} onChangeCallback - Optional callback when selection changes
         */
        async initializeHeadDropdown(selectElementId, fetchAuthFunc, onChangeCallback = null) {
            const select = document.getElementById(selectElementId);
            if (!select) return;

            try {
                // Fetch eligible employees (not current department heads)
                const resp = await fetchAuthFunc('/hr/department-heads');
                if (!resp) return;
                
                const employees = resp.ok ? await resp.json() : [];
                
                // Build dropdown options
                select.innerHTML = '<option value="">-- Select Department Head (optional) --</option>' + 
                    (employees || []).map(emp => {
                        const name = emp.name || emp.full_name || emp.username || 'Unknown';
                        const role = emp.role || 'employee';
                        return `<option value="${emp.employee_id}">${this.escapeHtml(name)} (${this.escapeHtml(role)})</option>`;
                    }).join('');
                
                // Reset change tracking
                select.dataset.changed = false;
                select.dataset.initialValue = '';
                
                // Add change event listener
                select.removeEventListener('change', this._handleSelectChange.bind(this));
                select.addEventListener('change', this._handleSelectChange.bind(this));
                
                if (onChangeCallback) {
                    select.removeEventListener('change', onChangeCallback);
                    select.addEventListener('change', onChangeCallback);
                }
            } catch (e) {
                console.warn('[AssignHeadUtil] Failed to populate department head options:', e);
            }
        },

        /**
         * Track when dropdown selection changes
         * @private
         */
        _handleSelectChange(event) {
            event.target.dataset.changed = true;
            console.log('[AssignHeadUtil] Dropdown changed, new value:', event.target.value);
        },

        /**
         * Assign or remove a department head
         * @param {number} deptId - Department ID
         * @param {number|null} headId - Employee ID to assign as head, or null to remove
         * @param {function} fetchAuthFunc - Function to make authenticated requests
         * @returns {Promise<{success: boolean, error?: string, data?: object}>}
         */
        async assignHead(deptId, headId, fetchAuthFunc) {
            if (!deptId) {
                return { success: false, error: 'Department ID is required' };
            }

            try {
                const resp = await fetchAuthFunc(`/hr/departments/${deptId}/head`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ head_id: headId })
                });

                if (!resp || !resp.ok) {
                    const err = resp ? await resp.json().catch(() => ({})) : { error: 'Request failed' };
                    console.error('[AssignHeadUtil] Failed to assign head:', err);
                    return { 
                        success: false, 
                        error: err.error || err.message || 'Failed to assign department head'
                    };
                }

                const data = await resp.json();
                console.log('[AssignHeadUtil] Successfully assigned head:', data);
                return { success: true, data };
            } catch (err) {
                console.error('[AssignHeadUtil] Error assigning head:', err);
                return { 
                    success: false, 
                    error: err.message || 'Network error while assigning head'
                };
            }
        },

        /**
         * Check if department head has been changed
         * @param {string} selectElementId - ID of the select element
         * @param {string} initialHeadText - Original head name/text from table
         * @returns {boolean}
         */
        hasHeadChanged(selectElementId, initialHeadText) {
            const select = document.getElementById(selectElementId);
            if (!select) return false;

            // Head changed if:
            // 1. User explicitly changed the dropdown (dataset.changed = true), OR
            // 2. Initial head was not "Not Assigned" but now is (removal), OR
            // 3. Initial head was "Not Assigned" but now isn't (assignment)
            const currentValue = select.value ? parseInt(select.value, 10) : null;
            const dataChanged = select.dataset.changed === 'true' || select.dataset.changed === true;
            const initialWasAssigned = initialHeadText && initialHeadText !== 'Not Assigned';
            const currentIsAssigned = currentValue !== null;

            return dataChanged || 
                   (initialWasAssigned && !currentIsAssigned) || 
                   (!initialWasAssigned && currentIsAssigned);
        },

        /**
         * Get the selected head ID from dropdown
         * @param {string} selectElementId - ID of the select element
         * @returns {number|null}
         */
        getSelectedHeadId(selectElementId) {
            const select = document.getElementById(selectElementId);
            if (!select) return null;
            return select.value ? parseInt(select.value, 10) : null;
        },

        /**
         * Reset the dropdown to initial state
         * @param {string} selectElementId - ID of the select element
         */
        resetDropdown(selectElementId) {
            const select = document.getElementById(selectElementId);
            if (!select) return;
            select.value = '';
            select.dataset.changed = false;
        },

        /**
         * Safe HTML escape
         * @private
         */
        escapeHtml(s) {
            return (s || '').toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }
    };
})();
