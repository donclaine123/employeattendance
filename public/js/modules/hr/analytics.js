let instances = {
    roundingChart: null,
    trendChart: null,
    unverifiedChart: null
};

export async function initAnalytics() {
    console.log('[Monitoring Analytics] Initializing...');

    const analyticsSection = document.getElementById('section-analytics');
    const isAnalytics = analyticsSection?.classList.contains('active');

    // Load immediately if active
    if (isAnalytics) {
        setTimeout(loadAnalytics, 100);
    }

    // Attach to tab clicks so it reloads metrics when navigating back to Analytics
    const analyticsBtn = document.querySelector('.nav-item[data-section="analytics"]');
    if (analyticsBtn) {
        analyticsBtn.addEventListener('click', () => {
            // Let the UI transition happen first
            setTimeout(loadAnalytics, 150);
        });
    }

    // Also observe the section itself in case the UI manager swaps it
    if (analyticsSection) {
        const classObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'class' && analyticsSection.classList.contains('active')) {
                    setTimeout(loadAnalytics, 100);
                }
            });
        });
        classObserver.observe(analyticsSection, { attributes: true });
    }

    // Theme toggle observer for ApexCharts
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'data-theme') {
                updateChartThemes();
            }
        });
    });
    observer.observe(document.documentElement, { attributes: true });
}

async function loadAnalytics() {
    try {
        const statsData = await fetchMonitoringStats();
        if (statsData) {
            updateStatCards(statsData);
            renderRoundingProgress(statsData.classesPresent, statsData.classesAbsent, statsData.uncheckedClasses);
            renderUnverifiedClassesChart(statsData.unverifiedBreakdown);
            updateConflictsList(statsData.conflicts, statsData.missingTimeOuts);
        }

        const reportsData = await fetchMonitoringReports(30);
        if (reportsData) {
            renderTrendChart(reportsData.trend);
        }
    } catch (error) {
        console.error('[Monitoring Analytics] Error loading data:', error);
    }
}

async function fetchMonitoringStats() {
    try {
        const response = await window.fetchWithAuth('/api/hr/monitoring-stats');
        const json = await response.json();
        return json.success ? json.data : null;
    } catch (error) {
        console.error('Failed to fetch stats:', error);
        return null;
    }
}

async function fetchMonitoringReports(days = 30) {
    try {
        const response = await window.fetchWithAuth(`/api/hr/monitoring-reports?days=${days}`);
        const json = await response.json();
        return json.success ? json.data : null;
    } catch (error) {
        console.error('Failed to fetch reports:', error);
        return null;
    }
}

function updateStatCards(data) {
    // Gate Stats
    document.getElementById('stat-present-campus').textContent = data.presentCampus;
    document.getElementById('stat-absent-campus').textContent = data.absentCampus;

    // Class Stats
    document.getElementById('stat-classes-present').textContent = data.classesPresent;
    document.getElementById('stat-total-classes').textContent = `/ ${data.totalClasses} Total`;
    document.getElementById('stat-vacant-classes').textContent = data.classesAbsent;
}

function updateConflictsList(conflicts, missingTimeOuts) {
    const list = document.getElementById('conflictsList');
    const badge = document.getElementById('conflictsBadge');

    let html = '';
    const allIssues = [...missingTimeOuts, ...conflicts];

    if (badge) badge.textContent = allIssues.length;

    if (allIssues.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px 0; font-size: 14px;">No discrepancies detected.</div>';
        return;
    }

    allIssues.forEach(issue => {
        html += `
            <div style="background: var(--bg-primary); border: 1px solid var(--border-primary); border-left: 4px solid #ef4444; border-radius: 8px; padding: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
                    <span style="font-weight: 600; color: var(--text-primary); font-size: 14px;">${issue.employeeName}</span>
                    <span style="font-size: 12px; color: #ef4444; font-weight: 600; background: rgba(239, 68, 68, 0.1); padding: 2px 8px; border-radius: 4px;">${issue.issue}</span>
                </div>
                <div style="font-size: 12px; color: var(--text-muted); display: flex; gap: 12px;">
                    <span><i style="opacity: 0.7;">Dept:</i> ${issue.department}</span>
                    ${issue.subjectCode ? `<span><i style="opacity: 0.7;">Subject:</i> ${issue.subjectCode} (${issue.schedule})</span>` : ''}
                    ${issue.date ? `<span><i style="opacity: 0.7;">Date:</i> ${issue.date}</span>` : ''}
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
}

function getChartTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function getChartColors() {
    const isDark = getChartTheme() === 'dark';
    return {
        text: isDark ? '#94a3b8' : '#64748b',
        grid: isDark ? '#334155' : '#e2e8f0',
        present: '#10b981',
        late: '#f59e0b',
        absent: '#ef4444',
        unchecked: '#cbd5e1'
    };
}

function updateChartThemes() {
    if (instances.roundingChart) instances.roundingChart.updateOptions({ theme: { mode: getChartTheme() } });
    if (instances.trendChart) instances.trendChart.updateOptions({ theme: { mode: getChartTheme() } });
    if (instances.unverifiedChart) instances.unverifiedChart.updateOptions({ theme: { mode: getChartTheme() } });
}

function renderRoundingProgress(present, absent, unchecked) {
    const el = document.getElementById('roundingProgressChart');
    if (!el) return;

    // Clear spinner
    el.innerHTML = '';

    const total = present + absent + unchecked;
    if (total === 0) {
        el.innerHTML = '<div style="color: var(--text-muted); font-size: 14px;">No classes scheduled or recorded yet.</div>';
        return;
    }

    const colors = getChartColors();

    const options = {
        series: [present, absent, unchecked],
        labels: ['Verified Present', 'Vacant/Absent', 'Unchecked'],
        chart: {
            type: 'donut',
            height: 250,
            background: 'transparent'
        },
        colors: [colors.present, colors.absent, colors.unchecked],
        stroke: { width: 0 },
        plotOptions: {
            pie: {
                donut: {
                    size: '70%',
                    labels: {
                        show: true,
                        name: { show: true },
                        value: { show: true },
                        total: {
                            show: true,
                            label: 'Total Classes',
                            formatter: () => total
                        }
                    }
                }
            }
        },
        dataLabels: { enabled: false },
        legend: { position: 'bottom' },
        theme: { mode: getChartTheme() }
    };

    if (instances.roundingChart) {
        instances.roundingChart.destroy();
    }

    instances.roundingChart = new ApexCharts(el, options);
    instances.roundingChart.render();
}

function renderTrendChart(trendData) {
    const el = document.getElementById('campusTrendChart');
    if (!el) return;
    el.innerHTML = '';

    if (!trendData || trendData.length === 0) {
        el.innerHTML = '<div style="color: var(--text-muted); font-size: 14px;">No trend data available.</div>';
        return;
    }

    const colors = getChartColors();

    const options = {
        series: [{
            name: 'Present',
            data: trendData.map(d => d.present)
        }, {
            name: 'Late',
            data: trendData.map(d => d.late)
        }, {
            name: 'Absent',
            data: trendData.map(d => d.absent)
        }],
        chart: {
            type: 'bar',
            height: 300,
            stacked: true,
            toolbar: { show: false },
            background: 'transparent'
        },
        colors: [colors.present, colors.late, colors.absent],
        xaxis: {
            categories: trendData.map(d => {
                const date = new Date(d.date);
                return `${date.getMonth() + 1}/${date.getDate()}`;
            }),
            labels: { style: { colors: colors.text } },
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        yaxis: {
            labels: { style: { colors: colors.text } }
        },
        grid: {
            borderColor: colors.grid,
            strokeDashArray: 4,
            yaxis: { lines: { show: true } }
        },
        dataLabels: { enabled: false },
        legend: { position: 'top', horizontalAlign: 'right' },
        theme: { mode: getChartTheme() }
    };

    if (instances.trendChart) {
        instances.trendChart.destroy();
    }
    instances.trendChart = new ApexCharts(el, options);
    instances.trendChart.render();
}

function renderUnverifiedClassesChart(breakdownData) {
    const el = document.getElementById('unverifiedClassesChart');
    if (!el) return;
    el.innerHTML = '';

    if (!breakdownData || breakdownData.length === 0) {
        el.innerHTML = '<div style="color: var(--text-muted); font-size: 14px; text-align: center; padding: 20px;">All classes verified or no data available.</div>';
        return;
    }

    const colors = getChartColors();

    const options = {
        series: [{
            name: 'Pending Classes',
            data: breakdownData.map(d => d.count)
        }],
        chart: {
            type: 'bar',
            height: 250,
            toolbar: { show: false },
            background: 'transparent'
        },
        plotOptions: {
            bar: {
                horizontal: true,
                borderRadius: 4,
                distributed: true // Gives each bar the default alternating colors or a specific color pallete if passed
            }
        },
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'],
        xaxis: {
            categories: breakdownData.map(d => d.subject),
            labels: { style: { colors: colors.text } },
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        yaxis: {
            labels: { style: { colors: colors.text } }
        },
        grid: {
            borderColor: colors.grid,
            strokeDashArray: 4,
            xaxis: { lines: { show: true } },
            yaxis: { lines: { show: false } }
        },
        dataLabels: { enabled: true },
        legend: { show: false },
        theme: { mode: getChartTheme() }
    };

    if (instances.unverifiedChart) {
        instances.unverifiedChart.destroy();
    }
    instances.unverifiedChart = new ApexCharts(el, options);
    instances.unverifiedChart.render();
}
