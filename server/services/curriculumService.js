/**
 * Curriculum Service
 * Manages Section-based Schedules (Curriculum Templates)
 */

const { supabase } = require('../supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent } = require('../utils/audit');
const { AUDIT_ACTIONS } = require('../utils/constants');

function countAssignedSubjects(subjects = []) {
  return subjects.filter(subject => subject && subject.assigned_professor_id != null).length;
}

function buildScheduleSnapshot(schedule = {}) {
  const subjects = Array.isArray(schedule.subjects) ? schedule.subjects : [];

  return {
    template_id: schedule.template_id ?? null,
    dept_id: schedule.dept_id ?? null,
    year_level: schedule.year_level ?? null,
    section_name: schedule.section_name ?? null,
    school_year: schedule.school_year ?? null,
    term: schedule.term ?? null,
    subject_count: subjects.length,
    assigned_count: countAssignedSubjects(subjects)
  };
}

function buildScheduleChangeSummary(beforeSchedule = {}, afterSchedule = {}) {
  const trackedFields = ['dept_id', 'year_level', 'section_name', 'school_year', 'term'];
  const changes = {};

  trackedFields.forEach(field => {
    if (afterSchedule[field] === undefined) {
      return;
    }

    const beforeValue = beforeSchedule[field] ?? null;
    const afterValue = afterSchedule[field] ?? null;

    if (String(beforeValue) !== String(afterValue)) {
      changes[field] = { from: beforeValue, to: afterValue };
    }
  });

  const beforeSubjects = Array.isArray(beforeSchedule.subjects) ? beforeSchedule.subjects : [];
  const afterSubjects = Array.isArray(afterSchedule.subjects) ? afterSchedule.subjects : [];
  if (JSON.stringify(beforeSubjects) !== JSON.stringify(afterSubjects)) {
    changes.subjects = {
      from_count: beforeSubjects.length,
      to_count: afterSubjects.length,
      from_assigned_count: countAssignedSubjects(beforeSubjects),
      to_assigned_count: countAssignedSubjects(afterSubjects)
    };
  }

  return changes;
}

async function logScheduleAuditEvent(actorId, actionType, details = {}) {
  if (!actorId) {
    return;
  }

  await logAuditEvent(actorId, actionType, details);
}

function assertDepartmentAccess(scheduleDeptId, scopeDeptId) {
  if (scopeDeptId == null) {
    return;
  }

  const scheduleDepartmentId = Number(scheduleDeptId);
  const allowedDepartmentId = Number(scopeDeptId);

  if (!Number.isInteger(scheduleDepartmentId) || scheduleDepartmentId !== allowedDepartmentId) {
    throw new AppError('You do not have access to this schedule.', 403);
  }
}

/**
 * Create a new Section Schedule
 */
async function createSectionSchedule(data, actorId = null, scopeDeptId = null) {
  const { dept_id, year_level, section_name, school_year, term, subjects, created_by } = data;
  const creatorId = Number(created_by);
  const scheduleDeptId = scopeDeptId != null ? Number(scopeDeptId) : Number(dept_id);

  if (!Number.isInteger(creatorId)) {
    throw new AppError('created_by is required when creating a schedule.', 400);
  }

  if (!Number.isInteger(scheduleDeptId)) {
    throw new AppError('dept_id is required when creating a schedule.', 400);
  }

  const { data: schedule, error } = await supabase
    .from('curriculum_templates')
    .insert([{
      dept_id: scheduleDeptId,
      year_level,
      section_name,
      school_year,
      term,
      subjects,
      created_by: creatorId
    }])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') { // Unique violation
      throw new AppError('A schedule for this section and term already exists.', 409);
    }
    throw error;
  }

  await logScheduleAuditEvent(actorId || created_by, AUDIT_ACTIONS.SCHEDULE_CREATED, {
    schedule: buildScheduleSnapshot(schedule),
    subject_codes: Array.isArray(subjects) ? subjects.map(subject => subject?.subject_code).filter(Boolean) : [],
    source: 'curriculum.create'
  });

  return schedule;
}

/**
 * Get Section Schedules with Filters
 */
async function getSectionSchedules(filters, scopeDeptId = null) {
  let query = supabase
    .from('curriculum_templates')
    .select(`
      *,
      department:departments(dept_name)
    `)
    .eq('is_active', true)
    .order('school_year', { ascending: false })
    .order('term', { ascending: true })
    .order('year_level', { ascending: true })
    .order('section_name', { ascending: true });

  if (scopeDeptId != null) {
    query = query.eq('dept_id', scopeDeptId);
  } else if (filters.dept_id) query = query.eq('dept_id', filters.dept_id);
  if (filters.school_year) query = query.eq('school_year', filters.school_year);
  if (filters.term) query = query.eq('term', filters.term);
  if (filters.year_level) query = query.eq('year_level', filters.year_level);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Update a Section Schedule (e.g. assigning professors)
 */
async function updateSectionSchedule(id, updates, actorId = null, scopeDeptId = null) {
  // Prevent updating critical fields that define the unique constraint directly via simple update if needed, 
  // but generally updates are allowed.

  const { data: existingSchedule, error: fetchError } = await supabase
    .from('curriculum_templates')
    .select('*')
    .eq('template_id', id)
    .single();

  if (fetchError) throw fetchError;
  if (!existingSchedule) throw new AppError('Schedule not found', 404);

  assertDepartmentAccess(existingSchedule.dept_id, scopeDeptId);

  const sanitizedUpdates = scopeDeptId == null
    ? updates
    : {
      ...updates,
      dept_id: existingSchedule.dept_id
    };

  const { data, error } = await supabase
    .from('curriculum_templates')
    .update(sanitizedUpdates)
    .eq('template_id', id)
    .select()
    .single();

  if (error) throw error;

  await logScheduleAuditEvent(actorId, AUDIT_ACTIONS.SCHEDULE_UPDATED, {
    schedule: buildScheduleSnapshot(data),
    changes: buildScheduleChangeSummary(existingSchedule, data),
    source: 'curriculum.update'
  });

  return data;
}

/**
 * Delete (Hard Delete) a Section Schedule
 */
async function deleteSectionSchedule(id, actorId = null, scopeDeptId = null) {
  const { data: existingSchedule, error: fetchError } = await supabase
    .from('curriculum_templates')
    .select('*')
    .eq('template_id', id)
    .single();

  if (fetchError) throw fetchError;
  if (!existingSchedule) throw new AppError('Schedule not found', 404);

  assertDepartmentAccess(existingSchedule.dept_id, scopeDeptId);

  const { data, error } = await supabase
    .from('curriculum_templates')
    .delete()
    .eq('template_id', id)
    .select()
    .single();

  if (error) throw error;

  await logScheduleAuditEvent(actorId, AUDIT_ACTIONS.SCHEDULE_DELETED, {
    schedule: buildScheduleSnapshot(existingSchedule),
    source: 'curriculum.delete'
  });

  return data;
}


/**
 * Clone a Single Schedule
 */
async function cloneSingleSchedule(id, { school_year, term, created_by }, actorId = null, scopeDeptId = null) {
  // 1. Fetch source template
  const { data: source, error: fetchError } = await supabase
    .from('curriculum_templates')
    .select('*')
    .eq('template_id', id)
    .eq('is_active', true)
    .single();

  if (fetchError || !source) {
    throw new AppError('Schedule not found.', 404);
  }

  assertDepartmentAccess(source.dept_id, scopeDeptId);

  // 2. Clean subjects: remove professor assignments
  const cleanSubjects = (source.subjects || []).map(sub => ({
    ...sub,
    assigned_professor_id: null
  }));

  // 3. Create new template with optional updated year/term
  const newTemplate = {
    dept_id: source.dept_id,
    year_level: source.year_level,
    section_name: source.section_name,
    school_year: school_year || source.school_year,
    term: term || source.term,
    subjects: cleanSubjects,
    created_by: created_by,
    cloned_from: source.template_id,
    is_active: true
  };

  // 4. Insert new template
  const { data: inserted, error: insertError } = await supabase
    .from('curriculum_templates')
    .insert([newTemplate])
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      throw new AppError('A schedule with this configuration already exists.', 409);
    }
    throw insertError;
  }

  await logScheduleAuditEvent(actorId || created_by, AUDIT_ACTIONS.SCHEDULE_CREATED, {
    clone_type: 'single',
    source_template_id: source.template_id,
    source_schedule: buildScheduleSnapshot(source),
    cloned_schedule: buildScheduleSnapshot(inserted),
    source: 'curriculum.clone-single'
  });

  return inserted;
}

/**
 * Clone Schedules from one Term to another
 */
async function cloneTermSchedules({ from_school_year, from_term, to_school_year, to_term, created_by }, actorId = null, scopeDeptId = null) {
  // 1. Fetch source templates
  let sourceQuery = supabase
    .from('curriculum_templates')
    .select('*')
    .eq('school_year', from_school_year)
    .eq('term', from_term)
    .eq('is_active', true);

  if (scopeDeptId != null) {
    sourceQuery = sourceQuery.eq('dept_id', scopeDeptId);
  }

  const { data: sources, error: fetchError } = await sourceQuery;

  if (fetchError) throw fetchError;
  if (!sources || sources.length === 0) {
    throw new AppError('No schedules found in the source term to clone.', 404);
  }

  // 2. Prepare new templates
  const newTemplates = sources.map(source => {
    // Clean subjects: remove professor assignments
    const cleanSubjects = (source.subjects || []).map(sub => ({
      ...sub,
      assigned_professor_id: null // Clear professor
    }));

    return {
      dept_id: source.dept_id,
      year_level: source.year_level,
      section_name: source.section_name,
      school_year: to_school_year,
      term: to_term,
      subjects: cleanSubjects,
      created_by: created_by,
      cloned_from: source.template_id,
      is_active: true
    };
  });

  // 3. Insert new templates
  // Note: This might fail if duplicates exist. We can ignore duplicates or throw.
  // Using upsert with onConflict might be safer, but insert is fine for "Bulk Clone"
  const { data: inserted, error: insertError } = await supabase
    .from('curriculum_templates')
    .insert(newTemplates)
    .select();

  if (insertError) {
    if (insertError.code === '23505') {
      throw new AppError('Some schedules for the target term already exist. Cannot clone.', 409);
    }
    throw insertError;
  }

  await logScheduleAuditEvent(actorId || created_by, AUDIT_ACTIONS.SCHEDULE_CREATED, {
    clone_type: 'term',
    source_school_year: from_school_year,
    source_term: from_term,
    target_school_year: to_school_year,
    target_term: to_term,
    cloned_count: inserted.length,
    source_template_ids: sources.map(source => source.template_id),
    cloned_templates: inserted.map(schedule => buildScheduleSnapshot(schedule)),
    source: 'curriculum.clone-term'
  });

  return inserted;
}

/**
 * Assign a professor to a subject in a schedule
 */
async function assignProfessorToSubject(templateId, subjectIndex, professorId, actorId = null, scopeDeptId = null) {
  // Get current schedule
  const { data: schedule, error: fetchError } = await supabase
    .from('curriculum_templates')
    .select('*')
    .eq('template_id', templateId)
    .single();

  if (fetchError) throw fetchError;
  if (!schedule) throw new AppError('Schedule not found', 404);

  assertDepartmentAccess(schedule.dept_id, scopeDeptId);

  // Update subject at specified index
  const subjects = Array.isArray(schedule.subjects) ? schedule.subjects.map(subject => ({ ...subject })) : [];
  if (subjectIndex < 0 || subjectIndex >= subjects.length) {
    throw new AppError('Invalid subject index', 400);
  }

  const previousProfessorId = subjects[subjectIndex].assigned_professor_id ?? null;
  const subjectSnapshot = {
    subject_code: subjects[subjectIndex].subject_code || null,
    subject_name: subjects[subjectIndex].subject_name || null,
    room_name: subjects[subjectIndex].room_name || null,
    days_of_week: subjects[subjectIndex].days_of_week || null,
    start_time: subjects[subjectIndex].start_time || null,
    end_time: subjects[subjectIndex].end_time || null
  };

  subjects[subjectIndex].assigned_professor_id = professorId;

  // Update schedule
  const { data: updated, error: updateError } = await supabase
    .from('curriculum_templates')
    .update({ subjects })
    .eq('template_id', templateId)
    .select()
    .single();

  if (updateError) throw updateError;

  await logScheduleAuditEvent(actorId, AUDIT_ACTIONS.SCHEDULE_UPDATED, {
    update_type: professorId ? 'single_assignment' : 'single_unassignment',
    template_id: schedule.template_id,
    section_name: schedule.section_name,
    dept_id: schedule.dept_id,
    year_level: schedule.year_level,
    school_year: schedule.school_year,
    term: schedule.term,
    subject_index: subjectIndex,
    previous_professor_id: previousProfessorId,
    new_professor_id: professorId ?? null,
    subject: subjectSnapshot,
    source: 'curriculum.assign-single'
  });

  return updated;
}

/**
 * Assign professors across multiple templates
 * Accepts assignments with template_id included in each one
 */
async function assignProfessorsAcrossTemplates(assignments, actorId = null, scopeDeptId = null) {
  // Group assignments by template_id
  const byTemplate = {};
  assignments.forEach(({ template_id, subject_index, professor_id }) => {
    if (!byTemplate[template_id]) {
      byTemplate[template_id] = [];
    }
    byTemplate[template_id].push({ subject_index, professor_id });
  });

  // Apply assignments to each template
  const results = [];
  for (const [templateId, templateAssignments] of Object.entries(byTemplate)) {
    const result = await assignMultipleProfessors(templateId, templateAssignments, actorId, scopeDeptId);
    results.push(result);
  }

  return results;
}

/**
 * Assign multiple professors to subjects in a schedule
 */
async function assignMultipleProfessors(templateId, assignments, actorId = null, scopeDeptId = null) {
  // Get current schedule
  const { data: schedule, error: fetchError } = await supabase
    .from('curriculum_templates')
    .select('*')
    .eq('template_id', templateId)
    .single();

  if (fetchError) throw fetchError;
  if (!schedule) throw new AppError('Schedule not found', 404);

  assertDepartmentAccess(schedule.dept_id, scopeDeptId);

  // Apply all assignments
  const subjects = Array.isArray(schedule.subjects) ? schedule.subjects.map(subject => ({ ...subject })) : [];
  const assignmentSnapshots = [];
  
  assignments.forEach(({ subject_index, professor_id }) => {
    if (subject_index >= 0 && subject_index < subjects.length) {
      const currentSubject = subjects[subject_index];
      assignmentSnapshots.push({
        subject_index,
        subject_code: currentSubject.subject_code || null,
        subject_name: currentSubject.subject_name || null,
        previous_professor_id: currentSubject.assigned_professor_id ?? null,
        new_professor_id: professor_id || null
      });

      // Allow null/undefined for unassignment
      subjects[subject_index].assigned_professor_id = professor_id || null;
    }
  });

  // Update schedule
  const { data: updated, error: updateError } = await supabase
    .from('curriculum_templates')
    .update({ subjects })
    .eq('template_id', templateId)
    .select()
    .single();

  if (updateError) throw updateError;

  await logScheduleAuditEvent(actorId, AUDIT_ACTIONS.SCHEDULE_UPDATED, {
    update_type: 'bulk_assignment',
    template_id: schedule.template_id,
    section_name: schedule.section_name,
    dept_id: schedule.dept_id,
    year_level: schedule.year_level,
    school_year: schedule.school_year,
    term: schedule.term,
    assignment_count: assignmentSnapshots.length,
    assignments: assignmentSnapshots,
    source: 'curriculum.assign-bulk'
  });
  
  return updated;
}

/**
 * Get Professor's Schedule
 * Fetches all curriculum templates where the professor has subject assignments
 */
async function getProfessorSchedule(professorId, departmentId = null) {
  // Fetch all active curriculum templates
  // We'll filter for professor assignments in JavaScript
  let query = supabase
    .from('curriculum_templates')
    .select(`
      template_id,
      section_name,
      school_year,
      term,
      year_level,
      dept_id,
      subjects,
      department:departments(dept_id, dept_name)
    `)
    .eq('is_active', true)
    .order('school_year', { ascending: false })
    .order('term', { ascending: true })
    .order('year_level', { ascending: true })
    .order('section_name', { ascending: true });

  if (departmentId != null) {
    query = query.eq('dept_id', Number(departmentId));
  }

  const { data, error } = await query;

  if (error) throw error;

  if (!data || data.length === 0) {
    return [];
  }

  // Convert professorId to number for comparison
  const professorIdNum = parseInt(professorId, 10);

  // Filter templates: only include those where professor has at least one subject assigned
  // Filter subjects: only include those assigned to this professor
  const scheduleWithFilteredSubjects = data
    .map(template => ({
      ...template,
      subjects: Array.isArray(template.subjects)
        ? template.subjects.filter(
          subject => subject.assigned_professor_id === professorIdNum
        )
        : []
    }))
    .filter(template => template.subjects.length > 0); // Only include templates with assigned subjects

  return scheduleWithFilteredSubjects;
}

module.exports = {
  createSectionSchedule,
  getSectionSchedules,
  updateSectionSchedule,
  deleteSectionSchedule,
  cloneSingleSchedule,
  cloneTermSchedules,
  assignProfessorToSubject,
  assignMultipleProfessors,
  assignProfessorsAcrossTemplates,
  getProfessorSchedule
};
