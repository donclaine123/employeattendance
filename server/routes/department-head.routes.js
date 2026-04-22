/**
 * Department Head Routes
 * Handles department head specific operations
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../conn-supabase');
const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { hrService, curriculumService } = require('../services');

router.use(requireAuth(['head_dept', 'superadmin']));

async function resolveDepartmentId(req, departmentIdFromQuery = null) {
  if (req.auth?.role === 'head_dept') {
    const employeeId = req.auth.employee_id || req.auth.id || req.auth.user_id;
    const employee = await hrService.getEmployee(employeeId);
    return employee.dept_id || employee.department?.dept_id || null;
  }

  if (departmentIdFromQuery == null || departmentIdFromQuery === '') {
    return null;
  }

  const deptId = Number(departmentIdFromQuery);
  return Number.isFinite(deptId) && deptId > 0 ? deptId : null;
}

// GET /api/department-head/professors - Get all professors/faculty in a department
router.get('/professors', catchAsync(async (req, res) => {
  const deptId = await resolveDepartmentId(req, req.query.dept_id);

  if (!deptId) {
    throw new AppError('dept_id is required', 400);
  }

  // Fetch all active employees in the department
  // Filter to those who are faculty/teaching staff
  const { data, error } = await supabase
    .from('employees')
    .select('employee_id, full_name, email, position')
    .eq('dept_id', deptId)
    .eq('status', 'active')
    .order('full_name', { ascending: true });

  if (error) throw error;

  // Format response - use employee_id as the identifier for professors
  const formattedData = (data || []).map(emp => ({
    user_id: emp.employee_id,
    full_name: emp.full_name || 'Unknown',
    email: emp.email || '',
    position: emp.position || ''
  }));

  res.json({ status: 'success', data: formattedData });
}));

// GET /api/department-head/professors/:professorId/schedule - Get a professor's assigned schedule
router.get('/professors/:professorId/schedule', catchAsync(async (req, res) => {
  const professorId = Number(req.params.professorId);
  if (!Number.isFinite(professorId) || professorId <= 0) {
    throw new AppError('professorId is required', 400);
  }

  const deptId = await resolveDepartmentId(req, req.query.dept_id);
  if (!deptId) {
    throw new AppError('dept_id is required', 400);
  }

  const professor = await hrService.getEmployee(professorId);
  const professorDeptId = Number(professor?.dept_id || professor?.department?.dept_id || 0);
  if (professorDeptId && professorDeptId !== Number(deptId)) {
    throw new AppError('Professor not found in this department', 404);
  }

  const data = await curriculumService.getProfessorSchedule(professorId, deptId);
  res.json({ status: 'success', data });
}));

module.exports = router;
