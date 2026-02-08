/**
 * Employee Routes
 * Employee-specific operations
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { attendanceService, hrService, curriculumService } = require('../services');

/**
 * GET /api/employee/by-email
 * Get employee info by email
 */
router.get('/by-email', catchAsync(async (req, res) => {
  const { email } = req.query;

  if (!email) {
    throw new AppError('Email is required', 400);
  }

  const data = await attendanceService.getEmployeeByEmail(email);
  res.json({ success: true, data });
}));

/**
 * GET /api/employee/schedule
 * Get professor's assigned schedule across all sections
 * Returns all curriculum templates where professor has subject assignments
 * IMPORTANT: This route must come BEFORE the /:id route to avoid conflicts
 */
router.get('/schedule', requireAuth(['employee', 'hr', 'superadmin']), catchAsync(async (req, res) => {
  // The auth middleware already provides employee_id in req.auth
  const employeeId = req.auth.employee_id;

  if (!employeeId) {
    throw new AppError('Employee ID not found in auth token', 400);
  }

  const schedule = await curriculumService.getProfessorSchedule(employeeId);
  res.json({ success: true, data: schedule });
}));

/**
 * GET /api/employee/:id
 * Get employee details
 */
router.get('/:id', requireAuth(['employee', 'hr', 'superadmin', 'head_dept']), catchAsync(async (req, res) => {
  const employee = await hrService.getEmployee(req.params.id);
  res.json({ success: true, data: employee });
}));

/**
 * GET /api/employee/:id/schedules
 * Get employee's scheduled classes for a specific date
 */
router.get('/:id/schedules', requireAuth(['employee', 'hr', 'superadmin', 'head_dept']), catchAsync(async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;
  
  if (!date) {
    throw new AppError('Date is required', 400);
  }

  // Get professor's schedule templates
  const schedule = await curriculumService.getProfessorSchedule(id);
  
  // Parse the date (format: M/D/YYYY or YYYY-MM-DD)
  let targetDate;
  if (date.includes('/')) {
    // M/D/YYYY format
    const [m, d, y] = date.split('/');
    targetDate = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  } else {
    // YYYY-MM-DD format
    targetDate = new Date(date);
  }
  
  // Get day of week abbreviations
  const dayOfWeekNames = ['Sun', 'M', 'T', 'W', 'TH', 'F', 'Sat'];
  const targetDayOfWeek = dayOfWeekNames[targetDate.getDay()];
  
  // Filter schedules to only include those matching the target day
  const filteredSchedules = [];
  
  if (Array.isArray(schedule)) {
    schedule.forEach((template, templateIndex) => {
      if (template.subjects && Array.isArray(template.subjects)) {
        template.subjects.forEach((subject, subjectIndex) => {
          const daysOfWeek = subject.days_of_week || [];
          
          // Check if this subject is scheduled for the target day
          if (Array.isArray(daysOfWeek) && daysOfWeek.includes(targetDayOfWeek)) {
            filteredSchedules.push({
              subject_code: subject.subject_code,
              subject_name: subject.subject_name,
              start_time: subject.start_time,
              end_time: subject.end_time,
              room: subject.room_name || 'TBA',
              day: targetDayOfWeek,
              days_of_week: daysOfWeek
            });
          }
        });
      }
    });
  }
  
  res.json({ success: true, data: filteredSchedules });
}));

module.exports = router;
