/**
 * Curriculum Routes
 * Handles Section Schedule operations
 */

const express = require('express');
const router = express.Router();
const curriculumService = require('../services/curriculumService');
const { catchAsync } = require('../middleware/errorHandler');
// const { protect, restrictTo } = require('../middleware/auth'); // Add back auth later

// GET /api/curriculum - List schedules
router.get('/', async (req, res, next) => {
  try {
    const filters = {
      dept_id: req.query.dept_id,
      school_year: req.query.school_year,
      term: req.query.term,
      year_level: req.query.year_level
    };
    
    console.log('[curriculum GET] Filters received:', filters);
    
    const schedules = await curriculumService.getSectionSchedules(filters);
    
    console.log('[curriculum GET] Found schedules:', schedules.length);
    
    res.json({ status: 'success', data: schedules });
  } catch (err) {
    next(err);
  }
});

// POST /api/curriculum - Create new schedule
router.post('/', async (req, res, next) => {
  try {
    const schedule = await curriculumService.createSectionSchedule({
      ...req.body,
      created_by: req.user?.id || null // Fallback for dev
    });
    res.status(201).json({ status: 'success', data: schedule });
  } catch (err) {
    next(err);
  }
});

// PUT /api/curriculum/:id - Update schedule (e.g. assign professors)
router.put('/:id', async (req, res, next) => {
  try {
    const schedule = await curriculumService.updateSectionSchedule(req.params.id, req.body);
    res.json({ status: 'success', data: schedule });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/curriculum/:id - Soft delete
router.delete('/:id', async (req, res, next) => {
  try {
    await curriculumService.deleteSectionSchedule(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/curriculum/:id/assign-professor - Assign single professor
router.post('/:id/assign-professor', async (req, res, next) => {
  try {
    const { subject_index, professor_id } = req.body;
    const schedule = await curriculumService.assignProfessorToSubject(req.params.id, subject_index, professor_id);
    res.json({ status: 'success', data: schedule });
  } catch (err) {
    next(err);
  }
});

// POST /api/curriculum/assign-professors-bulk - Assign multiple professors across templates
router.post('/assign-professors-bulk', async (req, res, next) => {
  try {
    const { assignments } = req.body;
    const result = await curriculumService.assignProfessorsAcrossTemplates(assignments);
    res.json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/curriculum/:id/clone - Clone single schedule
router.post('/:id/clone', async (req, res, next) => {
  try {
    const { school_year, term } = req.body;
    const cloned = await curriculumService.cloneSingleSchedule(req.params.id, {
      school_year,
      term,
      created_by: req.user?.id || null
    });
    res.status(201).json({ status: 'success', data: cloned });
  } catch (err) {
    next(err);
  }
});

// POST /api/curriculum/clone - Clone term
router.post('/clone', async (req, res, next) => {
  try {
    const { from_school_year, from_term, to_school_year, to_term } = req.body;
    const result = await curriculumService.cloneTermSchedules({
      from_school_year, from_term, to_school_year, to_term,
      created_by: req.user?.id || null
    });
    res.status(201).json({ status: 'success', count: result.length, message: `Cloned ${result.length} schedules.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
