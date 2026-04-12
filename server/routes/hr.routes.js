/**
 * HR Routes
 * HR Dashboard, QR management, employee management, attendance reports
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { hrService, adminService, attendanceService } = require('../services');



// QR Management
router.get('/qr/current', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  // Get the current global active QR session (for HR dashboard display)
  const session = await hrService.getCurrentQRSession();
  if (!session) {
    return res.status(404).json({ success: false, message: 'No active QR session' });
  }
  res.json({ success: true, data: session });
}));

router.get('/qr/status', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { qrSessionId } = req.query;
  if (!qrSessionId) throw new AppError('QR Session ID required', 400);
  const status = await hrService.getQRSessionStatus(qrSessionId);
  res.json({ success: true, data: status });
}));

router.get('/qr/history', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { employeeId, startDate, endDate, has_scans, status, _page = 1, _limit = 20 } = req.query;
  const filters = { employeeId, startDate, endDate };

  // Add has_scans filter if provided
  if (has_scans === 'true') {
    filters.hasScans = true;
  } else if (has_scans === 'false') {
    filters.hasScans = false;
  }

  // Add status filter if provided (active, paused, expired)
  if (status) {
    filters.status = status;
  }

  const result = await hrService.getQRHistory(filters, parseInt(_page), parseInt(_limit));
  // Set X-Total-Count header for pagination
  res.set('X-Total-Count', result.pagination.total.toString());
  res.json({ success: true, ...result });
}));

/**
 * Display QR endpoints
 */
router.get('/display/qr', requireAuth(['display']), catchAsync(async (req, res) => {
  const session = await hrService.getCurrentQRSession();
  if (!session) {
    throw new AppError('No active QR session', 404);
  }
  res.json({ success: true, data: session });
}));

router.get('/display/qr/public', catchAsync(async (req, res) => {
  const session = await hrService.getCurrentQRSession();
  if (!session) {
    throw new AppError('No active QR session', 404);
  }
  res.json(session);
}));

// Departments
router.get('/departments', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const departments = await hrService.getDepartments();
  res.json({ success: true, data: departments });
}));

// Employee Management
router.get('/employees', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, search, excludeRoles, _page = 1, _limit = 20 } = req.query;
  const filters = { departmentId, search };
  if (excludeRoles) {
    filters.excludeRoles = Array.isArray(excludeRoles) ? excludeRoles : excludeRoles.split(',');
  }
  const result = await hrService.listEmployees(filters, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

router.get('/employees/:id', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const employee = await hrService.getEmployee(req.params.id);
  res.json({ success: true, data: employee });
}));

router.put('/employees/:id', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const updated = await hrService.updateEmployee(req.params.id, req.body, req.auth.id);
  res.json({ success: true, data: updated });
}));

router.delete('/employees/:id', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const result = await hrService.updateEmployee(req.params.id, { status: 'inactive' }, req.auth.id);
  res.json({ success: true, message: 'Employee deleted' });
}));

// Attendance Management
router.get('/attendance', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, startDate, endDate, status, _page = 1, _limit = 20 } = req.query;
  const filters = { departmentId, startDate, endDate, status };
  const result = await hrService.getAttendanceReport(filters, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

router.post('/attendance/override', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { attendanceId, newStatus, reason } = req.body;
  if (!attendanceId || !newStatus) throw new AppError('Missing required fields', 400);
  const result = await hrService.overrideAttendance(attendanceId, newStatus, reason, req.auth.id);
  res.json(result);
}));

// Verify attendance status (mark as verified)
router.patch('/attendance/:id/verify', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { status, verified_by } = req.body;
  if (!status) throw new AppError('Status is required', 400);
  const result = await hrService.verifyAttendance(req.params.id, status, verified_by || req.auth.id);
  res.json({ success: true, data: result });
}));

router.get('/adjustments/history', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { startDate, endDate, _page = 1, _limit = 20 } = req.query;
  const filters = { startDate, endDate };
  const result = await hrService.getAdjustmentHistory(filters, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

// Hourly Rounds Verification - Subject-Based
router.get('/rounds/daily', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  const rounds = await attendanceService.getHourlyRoundsWithSchedules(targetDate);
  res.json({ success: true, data: rounds });
}));

// Verify subject-based round (not hourly blocks anymore)
router.post('/rounds/verify', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { attendanceId, subjectCode, templateId, employeeId, date, status } = req.body;
  if (!subjectCode || !templateId || !employeeId || !date || !status) {
    throw new AppError('Missing required fields: subjectCode, templateId, employeeId, date, status', 400);
  }

  // Use subject info as verification key (status is stored as VALUE, not in key)
  const verifyKey = `${subjectCode}_${templateId}`;
  const result = await attendanceService.verifyHour(attendanceId, verifyKey, req.auth.id, employeeId, date, status);
  res.json({ success: true, data: result });
}));

/**
 * GET /api/hr/attendance-with-subjects
 * Get attendance records enriched with subject/schedule data (all departments)
 * Mirrors dept-head endpoint but without department scoping
 */
router.get('/attendance-with-subjects', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { date_from, date_to, department_id, employee_id } = req.query;
  const { supabase } = require('../conn-supabase');

  if (!date_from || !date_to) {
    throw new AppError('date_from and date_to are required (YYYY-MM-DD format)', 400);
  }

  try {
    // Get employees (optionally filtered by department or employee)
    const filters = department_id ? { departmentId: department_id } : {};
    const { data: employees } = await hrService.listEmployees(filters, 1, 10000);
    if (!employees || employees.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const filteredEmployees = employee_id
      ? employees.filter(emp => String(emp.employee_id || emp.id) === String(employee_id))
      : employees;

    if (!filteredEmployees || filteredEmployees.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const employeeIds = filteredEmployees.map(emp => emp.employee_id || emp.id);

    // Get attendance records for date range
    const { data: attendanceRecords } = await supabase
      .from('attendance')
      .select('*')
      .in('employee_id', employeeIds)
      .gte('date', date_from)
      .lte('date', date_to)
      .order('date', { ascending: false })
      .order('employee_id', { ascending: true });

    if (!attendanceRecords || attendanceRecords.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Enrich with subject data via getHourlyRoundsWithSchedules
    const uniqueDates = [...new Set(attendanceRecords.map(r => r.date))];
    const subjectsByDateAndEmployee = {};

    for (const date of uniqueDates) {
      const hourlyRounds = await attendanceService.getHourlyRoundsWithSchedules(date);
      hourlyRounds.forEach(round => {
        const key = `${date}_${round.employee_id}`;
        subjectsByDateAndEmployee[key] = round.subjects || [];
      });
    }

    // Build employee lookup for names/departments
    const empMap = {};
    filteredEmployees.forEach(emp => { empMap[emp.employee_id || emp.id] = emp; });

    const enrichedData = attendanceRecords.map(record => {
      const key = `${record.date}_${record.employee_id}`;
      const emp = empMap[record.employee_id] || {};
      return {
        ...record,
        subjects: subjectsByDateAndEmployee[key] || [],
        employee: {
          first_name: emp.first_name || '',
          last_name: emp.last_name || '',
          employee_id: record.employee_id,
          department: emp.department || ''
        }
      };
    });

    res.json({ success: true, data: enrichedData });
  } catch (error) {
    console.error('[hr] Error fetching attendance with subjects:', error);
    throw new AppError('Error fetching attendance with subjects', 500);
  }
}));

/**
 * GET /api/hr/monitoring-stats
 * Aggregates attendance statistics for the monitoring dashboard
 * Incorporates both gate check-ins (record level) and hourly rounds (subject level)
 */
router.get('/monitoring-stats', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { date = new Date().toISOString().split('T')[0], department_id } = req.query;
  const { supabase } = require('../conn-supabase');
  const { attendanceService } = require('../services');

  try {
    // 1. Get employees (filtered by department if requested)
    const filters = department_id ? { departmentId: department_id } : {};
    // Assume we want to exclude high-level roles from monitoring
    filters.excludeRoles = ['superadmin', 'head_dept'];

    const { data: employees } = await hrService.listEmployees(filters, 1, 10000);
    if (!employees || employees.length === 0) {
      return res.json({ success: true, data: { teamSize: 0, presentCampus: 0, absentCampus: 0, lateCampus: 0, totalClasses: 0, classesPresent: 0, classesAbsent: 0, uncheckedClasses: 0, conflicts: [], missingTimeOuts: [] } });
    }

    const employeeIds = employees.map(emp => emp.employee_id || emp.id);

    // 2. Get attendance records for the date
    const { data: attendanceRecords } = await supabase
      .from('attendance')
      .select('*')
      .in('employee_id', employeeIds)
      .eq('attendance_type', 'in_person')
      .eq('date', date);

    // 3. Get subject schedules & hourly rounds for the date
    const hourlyRounds = await attendanceService.getHourlyRoundsWithSchedules(date);

    // Create lookup maps
    const empMap = {};
    employees.forEach(emp => { empMap[emp.employee_id || emp.id] = emp; });

    const attMap = {};
    (attendanceRecords || []).forEach(record => {
      attMap[record.employee_id] = record;
    });

    // --- Aggregations ---
    let presentCampus = 0;
    let lateCampus = 0;

    // Gate counts: late is treated as present for campus summaries
    employeeIds.forEach(id => {
      const rec = attMap[id];
      if (rec) {
        const status = (rec.status || '').toLowerCase();
        if (status === 'present' || status === 'late') presentCampus++;
      }
    });

    const teamSize = employees.length;
    const absentCampus = teamSize - presentCampus;

    let totalClasses = 0;
    let classesPresent = 0;
    let classesAbsent = 0;
    let uncheckedClasses = 0;
    const conflicts = [];
    const unverifiedSubjectsMap = {};

    // Subject counts & Conflicts
    hourlyRounds.forEach(round => {
      // Must be an employee in our filtered list
      if (!empMap[round.employee_id]) return;

      const empName = empMap[round.employee_id].first_name + ' ' + empMap[round.employee_id].last_name;
      const deptName = empMap[round.employee_id].department || empMap[round.employee_id].dept_name || 'N/A';
      const attRecord = attMap[round.employee_id];
      const hasTimeIn = attRecord && attRecord.time_in;

      (round.subjects || []).forEach(sub => {
        totalClasses++;
        const vs = (sub.verified_status || '').toLowerCase();

        if (vs === 'present' || vs === 'verified' || vs === 'late') {
          classesPresent++;

          // Conflict: Verified in Class, but no Time In at the gate for the day
          if (!hasTimeIn) {
            conflicts.push({
              employeeName: empName,
              department: deptName,
              subjectCode: sub.subject_code,
              timeIn: 'Missing Input',
              schedule: `${sub.start_time} - ${sub.end_time}`,
              issue: 'Class Verified but NO Gate Tap-in'
            });
          }
        } else if (vs === 'absent') {
          classesAbsent++;

          // Conflict: Time In exists, but marked absent in class
          if (hasTimeIn) {
            conflicts.push({
              employeeName: empName,
              department: deptName,
              subjectCode: sub.subject_code,
              timeIn: attRecord.time_in,
              schedule: `${sub.start_time} - ${sub.end_time}`,
              issue: 'Campus Present but Class Absent'
            });
          }
        } else {
          uncheckedClasses++;

          // Track Breakdown of Unverified Classes
          const subjectKey = sub.subject_code || 'Unknown Subject';
          unverifiedSubjectsMap[subjectKey] = (unverifiedSubjectsMap[subjectKey] || 0) + 1;
        }
      });
    });

    // Format the Breakdown for chart
    const unverifiedBreakdown = Object.keys(unverifiedSubjectsMap)
      .map(subject => ({ subject, count: unverifiedSubjectsMap[subject] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 unverified subjects to keep chart clean

    // 4. Missing Timeouts (from yesterday) - High Priority Conflict
    const yesterday = new Date(new Date(date).getTime() - 86400000).toISOString().split('T')[0];
    const { data: yesterdaysRecords } = await supabase
      .from('attendance')
      .select('*')
      .in('employee_id', employeeIds)
      .eq('date', yesterday)
      .not('time_in', 'is', null)
      .is('time_out', null);

    const missingTimeOuts = (yesterdaysRecords || []).map(r => {
      const emp = empMap[r.employee_id] || {};
      return {
        employeeName: emp.first_name + ' ' + emp.last_name,
        department: emp.department || emp.dept_name || 'N/A',
        timeIn: r.time_in,
        date: r.date,
        issue: `No Time Out from ${yesterday}`
      };
    });

    res.json({
      success: true,
      data: {
        teamSize,
        presentCampus,
        absentCampus,
        lateCampus,
        totalClasses,
        classesPresent,
        classesAbsent,
        uncheckedClasses,
        unverifiedBreakdown,
        conflicts,
        missingTimeOuts,
        departmentsStats: []
      }
    });

  } catch (error) {
    console.error('[hr] Error fetching monitoring stats:', error);
    throw new AppError('Error fetching monitoring stats', 500);
  }
}));

/**
 * GET /api/hr/monitoring-reports
 * Fetches historical data for the monitoring dashboard (days-based or explicit date ranges)
 */
router.get('/monitoring-reports', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { days = 30, start_date, end_date } = req.query;
  const { supabase } = require('../conn-supabase');

  try {
    const buildDateKeys = (startKey, endKey) => {
      const keys = [];
      const cursor = new Date(`${startKey}T00:00:00Z`);
      const finalDate = new Date(`${endKey}T00:00:00Z`);

      while (cursor <= finalDate) {
        keys.push(cursor.toISOString().split('T')[0]);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      return keys;
    };

    let startDate;
    let endDate;
    let trendDates = [];

    if (start_date || end_date) {
      if (!start_date || !end_date) {
        throw new AppError('start_date and end_date are required together (YYYY-MM-DD format)', 400);
      }

      const start = new Date(`${start_date}T00:00:00Z`);
      const end = new Date(`${end_date}T00:00:00Z`);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new AppError('start_date and end_date must be valid YYYY-MM-DD values', 400);
      }

      if (start.toISOString().split('T')[0] !== start_date || end.toISOString().split('T')[0] !== end_date) {
        throw new AppError('start_date and end_date must be valid YYYY-MM-DD values', 400);
      }

      if (start > end) {
        throw new AppError('start_date cannot be after end_date', 400);
      }

      startDate = start_date;
      endDate = end_date;
      trendDates = buildDateKeys(startDate, endDate);
    } else {
      const dayCount = Math.max(Number.parseInt(days, 10) || 30, 1);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const start = new Date(today.getTime() - ((dayCount - 1) * 86400000));

      startDate = start.toISOString().split('T')[0];
      endDate = today.toISOString().split('T')[0];
      trendDates = buildDateKeys(startDate, endDate);
    }

    // 1. Get employees
    const { data: employees } = await hrService.listEmployees({ excludeRoles: ['superadmin', 'head_dept'] }, 1, 10000);
    if (!employees || employees.length === 0) {
      return res.json({ success: true, data: { trend: [], departmentStats: [], topOffenders: [] } });
    }

    const employeeIds = employees.map(emp => emp.employee_id || emp.id);
    const empMap = {};
    employees.forEach(emp => { empMap[emp.employee_id || emp.id] = emp; });

    // 2. Get attendance records for the window
    const { data: attendanceRecords } = await supabase
      .from('attendance')
      .select('date, employee_id, status')
      .in('employee_id', employeeIds)
      .eq('attendance_type', 'in_person')
      .gte('date', startDate)
      .lte('date', endDate);

    // Group records by date internally
    const recordsByDate = {};
    (attendanceRecords || []).forEach(r => {
      if (!recordsByDate[r.date]) recordsByDate[r.date] = [];
      recordsByDate[r.date].push(r);
    });

    // 3. For trends, we just count the campus attendance for each day since getting all hourly rounds for 30 days is extremely heavy
    // We build a present vs absent trend. Late is folded into present for campus reporting.
    const trend = trendDates.map((d) => {
      const recs = recordsByDate[d] || [];
      let present = 0;

      recs.forEach(r => {
        const status = (r.status || '').toLowerCase();
        if (status === 'present' || status === 'late') present++;
      });

      return {
        date: d,
        present,
        absent: employees.length - present
      };
    });

    // 4. Department Attendance (Campus level for this heavy endpoint)
    const deptStats = {};
    const windowDays = Math.max(trendDates.length, 1);
    employees.forEach(emp => {
      const dept = emp.department || emp.dept_name || 'N/A';
      if (!deptStats[dept]) deptStats[dept] = { totalExpected: 0, present: 0 };
      deptStats[dept].totalExpected += windowDays; // Rough estimate.
    });

    (attendanceRecords || []).forEach(r => {
      const emp = empMap[r.employee_id];
      if (emp) {
        const dept = emp.department || emp.dept_name || 'N/A';
        const status = (r.status || '').toLowerCase();
        if (status === 'present' || status === 'late') {
          deptStats[dept].present++;
        }
      }
    });

    const departmentStats = Object.keys(deptStats).map(dept => {
      return {
        department: dept,
        rate: deptStats[dept].totalExpected > 0 ? Math.round((deptStats[dept].present / deptStats[dept].totalExpected) * 100) : 0
      };
    });

    res.json({
      success: true,
      data: {
        trend,
        departmentStats,
        topOffenders: [] // This would require querying hourly rounds metadata for 30 days which is very heavy unless we optimize the schema to track missed classes.
      }
    });

  } catch (error) {
    console.error('[hr] Error fetching monitoring reports:', error);
    throw new AppError('Error fetching monitoring reports', 500);
  }
}));

/**
 * GET /api/hr/live-dashboard
 * Fetches real-time operational data for the Monitoring Command Center
 */
router.get('/live-dashboard', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { supabase } = require('../conn-supabase');
  const { attendanceService } = require('../services');

  // Use Manila time consistently for live dashboard logic
  const now = new Date();
  const phtString = now.toLocaleString("en-US", { timeZone: "Asia/Manila" });
  const phtDate = new Date(phtString);

  // Format YYYY-MM-DD in PHT
  const year = phtDate.getFullYear();
  const month = String(phtDate.getMonth() + 1).padStart(2, '0');
  const day = String(phtDate.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  // Helper to parse HH:MM:00 into minutes from midnight for easy comparison
  const timeToMins = (timeStr) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + m;
  };

  const currentMins = (phtDate.getHours() * 60) + phtDate.getMinutes();

  try {
    // 1. Get employees (exclude admins)
    const { data: employees } = await hrService.listEmployees({ excludeRoles: ['superadmin', 'head_dept'] }, 1, 10000);
    const employeeIds = (employees || []).map(emp => emp.employee_id || emp.id);
    const empMap = {};
    (employees || []).forEach(emp => { empMap[emp.employee_id || emp.id] = emp; });

    // 2. Gate Data: In-person attendance only
    const { data: todayAttendance } = await supabase
      .from('attendance')
      .select('*')
      .in('employee_id', employeeIds)
      .eq('date', todayStr)
      .eq('attendance_type', 'in_person')
      .not('time_in', 'is', null)
      .order('time_in', { ascending: false }); // Sort newest first for recent scans

    // 3. Current occupancy
    let onCampusNow = 0;
    let classesHappeningNow = 0;
    let pendingVerificationsThisHour = 0;

    // Use Maps instead of Arrays so we can seamlessly merge same-room same-time sections
    const pendingRoomsMap = new Map();
    const liveAlertsMap = new Map();
    const recentGateScans = [];
    const attMap = {}; // Map by employee_id for easy lookup

    (todayAttendance || []).forEach(record => {
      attMap[record.employee_id] = record;

      // If time_in exists and time_out is null, they are physically here
      if (record.time_in && !record.time_out) {
        onCampusNow++;
      }

      // Grab the 10 most recent scans
      if (recentGateScans.length < 10) {
        const emp = empMap[record.employee_id] || {};
        recentGateScans.push({
          name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
          department: emp.department || emp.dept_name || 'N/A',
          time_in: record.time_in,
          status: record.status // 'present' or 'late'
        });
      }
    });

    // 4. Class Data: What is happening RIGHT NOW?
    const hourlyRounds = await attendanceService.getHourlyRoundsWithSchedules(todayStr);

    hourlyRounds.forEach(round => {
      if (!empMap[round.employee_id]) return; // Skip if alien

      const empName = `${empMap[round.employee_id].first_name} ${empMap[round.employee_id].last_name}`;
      const attRecord = attMap[round.employee_id];
      const hasTappedIn = attRecord && attRecord.time_in;

      (round.subjects || []).forEach(sub => {
        const startMins = timeToMins(sub.start_time);
        const endMins = timeToMins(sub.end_time);

        // Is this class happening RIGHT NOW? (Current time is within the schedule)
        const isHappeningNow = currentMins >= startMins && currentMins <= endMins;

        // Grouping key: Same Room + Same Teacher + Same Time = One Class to check
        const instanceKey = `${sub.room_name || 'TBA'}_${empName}_${sub.start_time}`;

        if (isHappeningNow) {
          classesHappeningNow++;
          const vs = (sub.verified_status || '').toLowerCase();

          if (vs !== 'present' && vs !== 'verified' && vs !== 'late' && vs !== 'absent') {
            // It is unchecked AND happening right now! Action required.
            pendingVerificationsThisHour++;

            if (!pendingRoomsMap.has(instanceKey)) {
              pendingRoomsMap.set(instanceKey, {
                room: sub.room_name || 'TBA',
                building: sub.building || 'TBA',
                subject: sub.subject_code,
                professor: empName,
                schedule: `${sub.start_time} - ${sub.end_time}`
              });
            } else {
              // Combine subject codes for the same class block
              const existing = pendingRoomsMap.get(instanceKey);
              if (!existing.subject.includes(sub.subject_code)) {
                existing.subject += `, ${sub.subject_code}`;
              }
            }

            // Generate Alerts for unchecked active classes
            // Alert 1: Class started 10+ mins ago, but teacher NEVER tapped gate today!
            if ((currentMins > startMins + 10) && !hasTappedIn) {
              const alertKey = `no_tap_${instanceKey}`;
              if (!liveAlertsMap.has(alertKey)) {
                liveAlertsMap.set(alertKey, {
                  type: 'critical',
                  title: 'Teacher Not on Campus!',
                  desc: `${empName} is scheduled in ${sub.room_name || 'TBA'} now, but has NO gate tap-in.`
                });
              }
            }
          }

          if (vs === 'absent') {
            // Alert 2: Monitor just checked this room and found it vacant!
            const alertKey = `vacant_${instanceKey}`;
            if (!liveAlertsMap.has(alertKey)) {
              liveAlertsMap.set(alertKey, {
                type: 'warning',
                title: 'Vacant Room Found',
                desc: `${empName}'s class in ${sub.room_name || 'TBA'} was marked empty by monitor.`
              });
            }
          }
        }
      });
    });

    // Convert maps back to arrays for frontend
    const pendingRoomsToVisit = Array.from(pendingRoomsMap.values());
    const liveAlerts = Array.from(liveAlertsMap.values());

    // Sort pending rooms by building/room for walking efficiency
    pendingRoomsToVisit.sort((a, b) => {
      if (a.building === b.building) return (a.room || '').localeCompare(b.room || '');
      return (a.building || '').localeCompare(b.building || '');
    });

    res.json({
      success: true,
      data: {
        onCampusNow,
        classesHappeningNow,
        pendingVerificationsThisHour,
        pendingRoomsToVisit,
        liveAlerts,
        recentGateScans
      }
    });

  } catch (error) {
    console.error('[hr] Error fetching live dashboard data:', error);
    throw new AppError('Error fetching live dashboard data', 500);
  }
}));

/**
 * GET /api/hr/hourly-rounds-reports
 * Fetches historical hourly-round verification data for the monitoring dashboard
 */
router.get('/hourly-rounds-reports', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { days = 30 } = req.query;
  const { attendanceService } = require('../services');

  try {
    const trendDays = Math.max(1, Math.min(90, parseInt(days, 10) || 30));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const trend = [];

    for (let i = trendDays - 1; i >= 0; i--) {
      const date = new Date(today.getTime() - (i * 86400000)).toISOString().split('T')[0];
      const hourlyRounds = await attendanceService.getHourlyRoundsWithSchedules(date);

      let verified = 0;
      let unchecked = 0;
      let vacant = 0;
      let late = 0;

      (hourlyRounds || []).forEach(round => {
        (round.subjects || []).forEach(subject => {
          const status = (subject.verified_status || '').toLowerCase();

          if (status === 'present' || status === 'verified') {
            verified++;
          } else if (status === 'late') {
            late++;
          } else if (status === 'absent') {
            vacant++;
          } else {
            unchecked++;
          }
        });
      });

      trend.push({
        date,
        verified,
        unchecked,
        vacant,
        late
      });
    }

    res.json({
      success: true,
      data: {
        trend
      }
    });

  } catch (error) {
    console.error('[hr] Error fetching hourly rounds trend:', error);
    throw new AppError('Error fetching hourly rounds trend', 500);
  }
}));

module.exports = router;
