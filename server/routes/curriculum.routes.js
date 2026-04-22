/**
 * Curriculum Routes
 * Handles Section Schedule operations
 */

const express = require('express');
const router = express.Router();
const curriculumService = require('../services/curriculumService');
const { hrService } = require('../services');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth(['head_dept', 'superadmin']));

router.use(async (req, res, next) => {
  try {
    if (req.auth?.role !== 'head_dept') {
      return next();
    }

    if (req.curriculumDepartmentId != null) {
      return next();
    }

    const employeeId = req.auth.employee_id || req.auth.id || req.auth.user_id;
    if (!employeeId) {
      throw new AppError('Unable to resolve the current department.', 403);
    }

    const employee = await hrService.getEmployee(employeeId);
    const deptId = Number(employee?.dept_id || employee?.department?.dept_id || 0);

    if (!Number.isInteger(deptId) || deptId <= 0) {
      throw new AppError('Unable to resolve the current department.', 403);
    }

    req.curriculumDepartmentId = deptId;
    return next();
  } catch (error) {
    return next(error);
  }
});

function getAuditActorId(req) {
  return req.auth?.id || req.auth?.user_id || req.user?.id || req.user?.user_id || null;
}

function getScopeDepartmentId(req) {
  return req.auth?.role === 'head_dept' ? req.curriculumDepartmentId ?? null : null;
}

// GET /api/curriculum/departments - List departments for schedule selection
router.get('/departments', catchAsync(async (req, res) => {
  const departments = await hrService.getDepartments();
  const scopeDeptId = getScopeDepartmentId(req);
  const scopedDepartments = scopeDeptId != null
    ? (departments || []).filter(department => Number(department.dept_id) === Number(scopeDeptId))
    : (departments || []);

  const data = (departments || []).map(department => ({
    dept_id: department.dept_id,
    dept_name: department.dept_name,
  }));

  if (scopeDeptId != null && scopedDepartments.length === 0) {
    throw new AppError('Current department not found.', 404);
  }

  res.json({ status: 'success', data: scopeDeptId != null ? scopedDepartments.map(department => ({
    dept_id: department.dept_id,
    dept_name: department.dept_name,
  })) : data });
}));

// GET /api/curriculum - List schedules
router.get('/', async (req, res, next) => {
  try {
    const scopeDeptId = getScopeDepartmentId(req);
    const filters = {
      dept_id: scopeDeptId != null ? scopeDeptId : req.query.dept_id,
      school_year: req.query.school_year,
      term: req.query.term,
      year_level: req.query.year_level
    };

    if (scopeDeptId != null) {
      filters.dept_id = scopeDeptId;
    }
    
    console.log('[curriculum GET] Filters received:', filters);
    
    const schedules = await curriculumService.getSectionSchedules(filters, scopeDeptId);
    
    console.log('[curriculum GET] Found schedules:', schedules.length);
    
    res.json({ status: 'success', data: schedules });
  } catch (err) {
    next(err);
  }
});

// POST /api/curriculum - Create new schedule
router.post('/', async (req, res, next) => {
  try {
    const actorId = getAuditActorId(req);
    const scopeDeptId = getScopeDepartmentId(req);
    const payload = {
      ...req.body,
      created_by: actorId
    };

    if (scopeDeptId != null) {
      payload.dept_id = scopeDeptId;
    }

    const schedule = await curriculumService.createSectionSchedule({
      ...payload
    }, actorId, scopeDeptId);
    res.status(201).json({ status: 'success', data: schedule });
  } catch (err) {
    next(err);
  }
});

// PUT /api/curriculum/:id - Update schedule (e.g. assign professors)
router.put('/:id', async (req, res, next) => {
  try {
    const actorId = getAuditActorId(req);
    const scopeDeptId = getScopeDepartmentId(req);
    const schedule = await curriculumService.updateSectionSchedule(req.params.id, req.body, actorId, scopeDeptId);
    res.json({ status: 'success', data: schedule });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/curriculum/:id - Soft delete
router.delete('/:id', async (req, res, next) => {
  try {
    const actorId = getAuditActorId(req);
    const scopeDeptId = getScopeDepartmentId(req);
    await curriculumService.deleteSectionSchedule(req.params.id, actorId, scopeDeptId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/curriculum/:id/assign-professor - Assign single professor
router.post('/:id/assign-professor', async (req, res, next) => {
  try {
    const { subject_index, professor_id } = req.body;
    const actorId = getAuditActorId(req);
    const scopeDeptId = getScopeDepartmentId(req);
    const schedule = await curriculumService.assignProfessorToSubject(req.params.id, subject_index, professor_id, actorId, scopeDeptId);
    res.json({ status: 'success', data: schedule });
  } catch (err) {
    next(err);
  }
});

// POST /api/curriculum/assign-professors-bulk - Assign multiple professors across templates
router.post('/assign-professors-bulk', async (req, res, next) => {
  try {
    const { assignments } = req.body;
    const actorId = getAuditActorId(req);
    const scopeDeptId = getScopeDepartmentId(req);
    const result = await curriculumService.assignProfessorsAcrossTemplates(assignments, actorId, scopeDeptId);
    res.json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/curriculum/:id/clone - Clone single schedule
router.post('/:id/clone', async (req, res, next) => {
  try {
    const { school_year, term } = req.body;
    const actorId = getAuditActorId(req);
    const scopeDeptId = getScopeDepartmentId(req);
    const cloned = await curriculumService.cloneSingleSchedule(req.params.id, {
      school_year,
      term,
      created_by: actorId
    }, actorId, scopeDeptId);
    res.status(201).json({ status: 'success', data: cloned });
  } catch (err) {
    next(err);
  }
});

// POST /api/curriculum/clone - Clone term
router.post('/clone', async (req, res, next) => {
  try {
    const { from_school_year, from_term, to_school_year, to_term } = req.body;
    const actorId = getAuditActorId(req);
    const scopeDeptId = getScopeDepartmentId(req);
    const result = await curriculumService.cloneTermSchedules({
      from_school_year, from_term, to_school_year, to_term,
      created_by: actorId
    }, actorId, scopeDeptId);
    res.status(201).json({ status: 'success', count: result.length, message: `Cloned ${result.length} schedules.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
