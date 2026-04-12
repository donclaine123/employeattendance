/**
 * live-dashboard.js
 * Handles real-time operational data for the Monitoring Command Center (#section-dashboard)
 */

export async function initLiveDashboard() {
    console.log('[Live Dashboard] Initializing Command Center...');

    const dashboardSection = document.getElementById('section-dashboard');
    const isDashboard = dashboardSection?.classList.contains('active');

    // Load immediately if active
    if (isDashboard) {
        setTimeout(loadLiveData, 100);
    }

    // Attach to tab clicks so it reloads metrics when navigating back to Dashboard
    const dashboardBtn = document.querySelector('.nav-item[data-section="dashboard"]');
    if (dashboardBtn) {
        dashboardBtn.addEventListener('click', () => {
            setTimeout(loadLiveData, 150);
        });
    }

    // Also observe the section itself
    if (dashboardSection) {
        const classObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'class' && dashboardSection.classList.contains('active')) {
                    setTimeout(loadLiveData, 100);
                }
            });
        });
        classObserver.observe(dashboardSection, { attributes: true });
    }
}

async function loadLiveData() {
    try {
        const response = await window.fetchWithAuth('/api/hr/live-dashboard');
        const json = await response.json();

        if (json.success && json.data) {
            updateLiveStats(json.data);
            updatePendingRooms(json.data.pendingRoomsToVisit, json.data);
            updateAlerts(json.data.liveAlerts);
            updateGateFeed(json.data.recentGateScans);
        }
    } catch (error) {
        console.error('[Live Dashboard] Error loading live data:', error);
    }
}

function updateLiveStats(data) {
    document.getElementById('live-on-campus').textContent = data.onCampusNow || 0;
    document.getElementById('live-active-classes').textContent = data.classesHappeningNow || 0;
    document.getElementById('live-pending-verifications').textContent = data.pendingVerificationsThisHour || 0;

    // Total employees stat (still in HTML, let's keep it updated if we have it, else leave as is)
    if (data.totalEmployees) {
        document.getElementById('stat-total-employees').textContent = data.totalEmployees;
    }
}

function updatePendingRooms(rooms, liveData = {}) {
    const tbody = document.getElementById('livePendingRoomsList');
    if (!tbody) return;

    if (!rooms || rooms.length === 0) {
        const classesHappeningNow = Number(liveData.classesHappeningNow || 0);
        const message = classesHappeningNow > 0
            ? '✓ All active classes verified! No rooms pending.'
            : 'No pending classes on schedule on this hour.';
        const messageColor = classesHappeningNow > 0 ? '#10b981' : 'var(--text-muted)';

        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 24px; color: ${messageColor}; font-weight: 500;">${message}</td></tr>`;
        return;
    }

    // Helper to format HH:MM:SS to HH:MM AM/PM
    const formatAmPm = (timeStr) => {
        if (!timeStr) return '';
        const [h, m] = timeStr.split(':');
        let hour = parseInt(h);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12;
        hour = hour ? hour : 12; // 0 should be 12
        return `${hour}:${m} ${ampm}`;
    };

    tbody.innerHTML = rooms.map(room => {
        // Schedule is passed as 'HH:MM:SS - HH:MM:SS'
        const [start, end] = room.schedule.split(' - ');
        const scheduleAMPM = `${formatAmPm(start)} - ${formatAmPm(end)}`;

        return `
        <tr style="border-bottom: 1px solid var(--border-primary);">
            <td style="padding: 12px; font-weight: 600; color: var(--text-primary);">${room.room} <span style="font-size: 11px; color: var(--text-muted); font-weight: 400; display: block;">${room.building}</span></td>
            <td style="padding: 12px;">${room.subject}</td>
            <td style="padding: 12px; font-weight: 500;">${room.professor}</td>
            <td style="padding: 12px; color: var(--text-muted); font-size: 13px;">${scheduleAMPM}</td>
        </tr>
    `}).join('');
}

function updateAlerts(alerts) {
    const container = document.getElementById('liveAlertsContainer');
    if (!container) return;

    if (!alerts || alerts.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #10b981; padding: 20px; font-weight: 500;">Clear. No urgent alerts.</div>';
        return;
    }

    container.innerHTML = alerts.map(alert => {
        const isCritical = alert.type === 'critical';
        const bgColor = isCritical ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)';
        const textColor = isCritical ? '#ef4444' : '#f59e0b';

        return `
            <div style="background: ${bgColor}; border-left: 4px solid ${textColor}; padding: 12px; border-radius: 4px;">
                <h4 style="color: ${textColor}; font-weight: 600; margin: 0 0 4px 0; font-size: 14px;">${alert.title}</h4>
                <p style="color: var(--text-primary); margin: 0; font-size: 13px;">${alert.desc}</p>
            </div>
        `;
    }).join('');
}

function updateGateFeed(scans) {
    const container = document.getElementById('liveGateFeedContainer');
    if (!container) return;

    if (!scans || scans.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No gate activity today.</div>';
        return;
    }

    container.innerHTML = scans.map(scan => {
        const timeFormatted = new Date(`1970-01-01T${scan.time_in}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isLate = scan.status === 'late';
        const statusColor = isLate ? '#f59e0b' : '#10b981';

        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--border-primary);">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 600; font-size: 14px; color: var(--text-primary);">${scan.name}</span>
                    <span style="font-size: 12px; color: var(--text-muted);">${scan.department}</span>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end;">
                    <span style="font-weight: bold; color: var(--text-primary);">${timeFormatted}</span>
                    <span style="font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 10px; background: ${statusColor}20; color: ${statusColor}; text-transform: uppercase;">
                        ${scan.status}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}
