/**
 * Department Head Routes
 * Department-specific operations and reporting
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { hrService, requestService } = require('../services');

/**
 * GET /api/departmenthead/dashboard
 * Get team attendance statistics
 */
router.get('/dashboard', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, date = new Date().toISOString().split('T')[0] } = req.query;

  let targetDeptId = departmentId;

  if (req.auth.role === 'head_dept') {
    try {
      const employee = await hrService.getEmployee(req.auth.employee_id);
      if (employee.dept_id) {
        targetDeptId = employee.dept_id;
      }
    } catch (error) {
      console.error('Error fetching department for dashboard:', error);
    }
  }

  // Get department employees
  const { data: employees } = await hrService.listEmployees({ departmentId: targetDeptId }, 1, 1000);

  // Get today's attendance for department employees
  const { supabase } = require('../conn-supabase');
  let totalPresent = 0;
  let totalLate = 0;
  let totalAbsent = 0;

  if (employees && employees.length > 0) {
    const employeeIds = employees.map(emp => emp.employee_id || emp.id);

    const { data: attendanceRecords } = await supabase
      .from('attendance')
      .select('status')
      .in('employee_id', employeeIds)
      .eq('date', date);

    if (attendanceRecords && attendanceRecords.length > 0) {
      attendanceRecords.forEach(record => {
        const status = (record.status || '').toLowerCase();
        if (status === 'present') {
          totalPresent++;
        } else if (status === 'late') {
          totalLate++;
        } else if (status === 'absent') {
          totalAbsent++;
        }
      });
    }
  }

  res.json({
    success: true,
    teamSize: employees.length,
    totalPresent,
    totalLate,
    totalAbsent,
  });
}));

/**
 * GET /api/departmenthead/employees
 * Get all employees in department
 */
router.get('/employees', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  let { departmentId, _page = 1, _limit = 20 } = req.query;

  // For Department Head, enforce their department and exclude privileged roles
  let excludeRoles = [];
  if (req.auth.role === 'head_dept') {
    try {
      // Get the department head's employee record to find their department
      const employee = await hrService.getEmployee(req.auth.employee_id);

      // Use dept_id from the employee record (or department_id/department?.dept_id if mapped differently)
      // Based on schema, it is dept_id.
      if (employee.dept_id) {
        departmentId = employee.dept_id;
      } else if (employee.department && employee.department.dept_id) {
        departmentId = employee.department.dept_id;
      } else {
        // Fallback or error if no department found
        console.warn(`Department Head ${req.auth.email} has no department assigned.`);
        return res.json({ success: true, data: [], pagination: { total: 0 } });
      }

      // Exclude high-level roles from their view
      // They shouldn't see Superadmins, HRs, or other Department Heads (even though they shouldn't be in this dept anyway, this is a safety check)
      excludeRoles = ['superadmin', 'hr', 'head_dept'];

    } catch (error) {
      console.error('Error fetching department info for head:', error);
      throw new AppError('Could not verify department permissions', 500);
    }
  }

  const result = await hrService.listEmployees({ departmentId, excludeRoles }, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

/**
 * GET /api/departmenthead/recent-activity
 * Get recent requests in department
 */
router.get('/recent-activity', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, _page = 1, _limit = 20 } = req.query;
  let targetDeptId = departmentId;

  if (req.auth.role === 'head_dept') {
    try {
      const employee = await hrService.getEmployee(req.auth.employee_id);
      if (employee.dept_id) {
        targetDeptId = employee.dept_id;
      }
    } catch (error) {
      console.error('Error fetching department for activity:', error);
    }
  }

  const result = await requestService.getRequests({ departmentId: targetDeptId, status: 'pending' }, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

module.exports = router;
