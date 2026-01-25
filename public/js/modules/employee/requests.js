
import { showStatus } from './utils.js';

export function initRequests() {
  // New request management listeners
  const newReqBtn = document.getElementById('newRequestBtn');
  const closeBtn = document.getElementById('requestModalClose');
  const cancelBtn = document.getElementById('requestModalCancel');
  const typeSelect = document.getElementById('requestType');
  const submitBtn = document.getElementById('requestModalSubmit');

  if (newReqBtn) newReqBtn.addEventListener('click', openRequestModal);
  if (closeBtn) closeBtn.addEventListener('click', closeRequestModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeRequestModal);
  if (typeSelect) typeSelect.addEventListener('change', renderRequestFormFields);
  if (submitBtn) submitBtn.addEventListener('click', handleSubmitRequest);

  // Initial fetch if needed, but dashboard usually lazy loads or loads on click
  fetchAndDisplayRequests();

  window.refreshRequestsSection = fetchAndDisplayRequests;
}

function openRequestModal() {
  const backdrop = document.getElementById('requestModalBackdrop');
  const modal = document.getElementById('requestModal');
  if (backdrop) backdrop.style.display = 'block';
  if (modal) modal.style.display = 'block';
  renderRequestFormFields();
}

function closeRequestModal() {
  const backdrop = document.getElementById('requestModalBackdrop');
  const modal = document.getElementById('requestModal');
  if (backdrop) backdrop.style.display = 'none';
  if (modal) modal.style.display = 'none';
}

function renderRequestFormFields() {
  const requestType = document.getElementById('requestType').value;
  const container = document.getElementById('request-form-fields');
  if (!container) return;

  let html = '';

  switch (requestType) {
    case 'leave':
      html = `
                <div class="form-group">
                    <label for="leaveStartDate">Start Date</label>
                    <input type="date" id="leaveStartDate" class="form-input" required>
                </div>
                <div class="form-group">
                    <label for="leaveEndDate">End Date</label>
                    <input type="date" id="leaveEndDate" class="form-input" required>
                </div>
                <div class="form-group">
                    <label for="leaveReason">Reason</label>
                    <textarea id="leaveReason" class="form-input" rows="3" placeholder="e.g., Vacation, Sick leave"></textarea>
                </div>
            `;
      break;
    case 'overtime':
      html = `
                <div class="form-group">
                    <label for="overtimeDate">Date</label>
                    <input type="date" id="overtimeDate" class="form-input" required>
                </div>
                <div class="form-group">
                    <label for="overtimeHours">Hours</label>
                    <input type="number" id="overtimeHours" class="form-input" min="0.5" step="0.5" placeholder="e.g., 2.5" required>
                </div>
                <div class="form-group">
                    <label for="overtimeReason">Reason</label>
                    <textarea id="overtimeReason" class="form-input" rows="3" placeholder="e.g., Project deadline"></textarea>
                </div>
            `;
      break;
    case 'correction':
      html = `
                <div class="form-group">
                    <label for="correctionDate">Date of Missed Log</label>
                    <input type="date" id="correctionDate" class="form-input" required>
                </div>
                <div class="form-group">
                    <label for="correctionType">Log Type</label>
                    <select id="correctionType" class="form-input">
                        <option value="time_in">Time-in</option>
                        <option value="time_out">Time-out</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="correctionTime">Actual Time</label>
                    <input type="time" id="correctionTime" class="form-input" required>
                </div>
                <div class="form-group">
                    <label for="correctionReason">Reason</label>
                    <textarea id="correctionReason" class="form-input" rows="3" placeholder="e.g., Forgot to scan QR code"></textarea>
                </div>
            `;
      break;
  }
  container.innerHTML = html;

  // Make entire date input fields clickable for date picker
  const dateInputs = container.querySelectorAll('input[type="date"]');
  dateInputs.forEach(input => {
    input.addEventListener('click', function () {
      if (this.showPicker) this.showPicker();
    });
  });
}

async function handleSubmitRequest() {
  const requestType = document.getElementById('requestType').value;
  let details = {};
  let isValid = true;
  let errorMsg = '';

  try {
    if (!requestType) {
      showStatus('Please select a request type.', true);
      return;
    }

    switch (requestType) {
      case 'leave':
        const leaveStartDate = document.getElementById('leaveStartDate');
        const leaveEndDate = document.getElementById('leaveEndDate');
        const leaveReason = document.getElementById('leaveReason');

        if (!leaveStartDate || !leaveEndDate || !leaveReason) {
          errorMsg = 'Form fields missing'; isValid = false; break;
        }
        details = { startDate: leaveStartDate.value, endDate: leaveEndDate.value, reason: leaveReason.value };
        if (!details.startDate || !details.endDate || !details.reason) { errorMsg = 'Please fill all fields'; isValid = false; }
        break;

      case 'overtime':
        const overtimeDate = document.getElementById('overtimeDate');
        const overtimeHours = document.getElementById('overtimeHours');
        const overtimeReason = document.getElementById('overtimeReason');
        if (!overtimeDate || !overtimeHours || !overtimeReason) { errorMsg = 'Form fields missing'; isValid = false; break; }

        const h = parseFloat(overtimeHours.value);
        details = { date: overtimeDate.value, hours: h, reason: overtimeReason.value };
        if (!details.date || isNaN(details.hours) || details.hours <= 0 || !details.reason) { errorMsg = 'Invalid input'; isValid = false; }
        break;

      case 'correction':
        const correctionDate = document.getElementById('correctionDate');
        const correctionType = document.getElementById('correctionType');
        const correctionTime = document.getElementById('correctionTime');
        const correctionReason = document.getElementById('correctionReason');
        if (!correctionDate || !correctionType || !correctionTime || !correctionReason) { errorMsg = 'Form fields missing'; isValid = false; break; }

        details = { date: correctionDate.value, type: correctionType.value, time: correctionTime.value, reason: correctionReason.value };
        if (!details.date || !details.type || !details.time || !details.reason) { errorMsg = 'Please fill all fields'; isValid = false; }
        break;

      default:
        errorMsg = 'Invalid type'; isValid = false;
    }

    if (!isValid) {
      showStatus(errorMsg, true);
      return;
    }

    // Show loading
    const submitBtn = document.querySelector('.request-modal button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : 'Submit';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }

    try {
      const result = await window.AppApi.createRequest({ request_type: requestType, details });
      showStatus('✓ Request submitted successfully!', false, 5000);

      setTimeout(() => {
        closeRequestModal();
        // Reset form
        document.querySelectorAll('.request-modal input, .request-modal textarea').forEach(el => el.value = '');
        fetchAndDisplayRequests();
      }, 500);

    } catch (apiError) {
      let msg = apiError.message || 'Submission failed';
      showStatus(msg, true, 6000);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
    }

  } catch (e) {
    showStatus(`Error: ${e.message}`, true);
    const submitBtn = document.querySelector('.request-modal button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
  }
}


// Update dashboard request stats
function updateRequestStats(requests) {
  if (!requests) return;

  const pending = requests.filter(r => r.status === 'pending').length;
  const approved = requests.filter(r => r.status === 'approved').length;

  // specific IDs from HTML
  const statPending = document.getElementById('statPendingRequests');
  const statPending2 = document.getElementById('statPendingRequests2');
  const statApproved = document.getElementById('statApprovedRequests');

  if (statPending) statPending.textContent = pending;
  if (statPending2) statPending2.textContent = pending;
  if (statApproved) statApproved.textContent = approved;
}

// Populate Quick Requests List (Dashboard)
function updateQuickRequestsList(requests) {
  const list = document.getElementById('quickRequestsList');
  if (!list) return;

  list.innerHTML = '';
  const recent = requests.slice(0, 3);

  recent.forEach(req => {
    const type = req.request_type || req.type || 'Request';
    const displayType = type.charAt(0).toUpperCase() + type.slice(1);

    let dateRange = '—';
    const d = req.details || {};
    if (d.startDate && d.endDate) dateRange = `${new Date(d.startDate).toLocaleDateString(undefined, { month: 'short', day: '2-digit' })}-${new Date(d.endDate).toLocaleDateString(undefined, { month: 'short', day: '2-digit' })}`;
    else if (d.date) dateRange = new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });

    const item = document.createElement('div');
    item.className = 'quick-item';
    item.innerHTML = `
            <div class="quick-type">${displayType}</div>
            <div class="quick-date">${dateRange}</div>
            <span class="status-badge ${req.status || 'pending'}">${req.status || 'Pending'}</span>
        `;
    list.appendChild(item);
  });
}

async function fetchAndDisplayRequests() {
  const tbody = document.querySelector('.request-table tbody');

  // Show loading
  if (tbody) tbody.innerHTML = '<tr><td colspan="5">Loading requests...</td></tr>';

  try {
    const response = await window.AppApi.getRequests();
    const requests = Array.isArray(response) ? response : (response.data || []);

    // Update stats and quick view
    updateRequestStats(requests);
    updateQuickRequestsList(requests);

    if (tbody) {
      tbody.innerHTML = '';

      if (requests && requests.length > 0) {
        // Hide empty state div
        const emptyState = document.getElementById('requests-empty-state');
        if (emptyState) emptyState.style.display = 'none';

        requests.forEach(req => {
          const tr = document.createElement('tr');
          let detailsHtml = '';
          const d = req.details || {};

          if (d.startDate) detailsHtml += `<strong>Start:</strong> ${new Date(d.startDate).toLocaleDateString()}<br>`;
          if (d.endDate) detailsHtml += `<strong>End:</strong> ${new Date(d.endDate).toLocaleDateString()}<br>`;
          if (d.reason) detailsHtml += `<strong>Reason:</strong> ${d.reason}`;
          // Fallback for other structures
          if (!detailsHtml && d.date) detailsHtml += `<strong>Date:</strong> ${new Date(d.date).toLocaleDateString()}<br>`;
          if (!detailsHtml && (d.reason || d.remarks)) detailsHtml += `<strong>Reason:</strong> ${d.reason || d.remarks}`;

          tr.innerHTML = `
                        <td>${req.id}</td>
                        <td>${req.type || req.request_type}</td>
                        <td>${new Date(req.createdAt || req.created_at).toLocaleDateString()}</td>
                        <td><span class="status-badge status-${req.status}">${req.status}</span></td>
                        <td>${detailsHtml || 'N/A'}</td>
                    `;
          tbody.prepend(tr);
        });
      } else {
        const emptyRowTemplate = document.getElementById('requests-empty-row');
        if (emptyRowTemplate) {
          const clone = emptyRowTemplate.cloneNode(true);
          clone.style.display = '';
          tbody.appendChild(clone);
        } else {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No requests found.</td></tr>';
        }
      }
    }
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="error">Failed to load: ${e.message}</td></tr>`;
  }
}
