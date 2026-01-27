/**
 * Curriculum Service
 * Manages Section-based Schedules (Curriculum Templates)
 */

const { supabase } = require('../supabase');
const { AppError } = require('../middleware/errorHandler');

/**
 * Create a new Section Schedule
 */
async function createSectionSchedule(data) {
  const { dept_id, year_level, section_name, school_year, term, subjects, created_by } = data;

  const { data: schedule, error } = await supabase
    .from('curriculum_templates')
    .insert([{
      dept_id,
      year_level,
      section_name,
      school_year,
      term,
      subjects,
      created_by
    }])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') { // Unique violation
      throw new AppError('A schedule for this section and term already exists.', 409);
    }
    throw error;
  }

  return schedule;
}

/**
 * Get Section Schedules with Filters
 */
async function getSectionSchedules(filters) {
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

  if (filters.dept_id) query = query.eq('dept_id', filters.dept_id);
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
async function updateSectionSchedule(id, updates) {
  // Prevent updating critical fields that define the unique constraint directly via simple update if needed, 
  // but generally updates are allowed.

  const { data, error } = await supabase
    .from('curriculum_templates')
    .update(updates)
    .eq('template_id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete (Hard Delete) a Section Schedule
 */
async function deleteSectionSchedule(id) {
  const { data, error } = await supabase
    .from('curriculum_templates')
    .delete()
    .eq('template_id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}


/**
 * Clone a Single Schedule
 */
async function cloneSingleSchedule(id, { school_year, term, created_by }) {
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

  return inserted;
}

/**
 * Clone Schedules from one Term to another
 */
async function cloneTermSchedules({ from_school_year, from_term, to_school_year, to_term, created_by }) {
  // 1. Fetch source templates
  const { data: sources, error: fetchError } = await supabase
    .from('curriculum_templates')
    .select('*')
    .eq('school_year', from_school_year)
    .eq('term', from_term)
    .eq('is_active', true);

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

  return inserted;
}

/**
 * Assign a professor to a subject in a schedule
 */
async function assignProfessorToSubject(templateId, subjectIndex, professorId) {
  // Get current schedule
  const { data: schedule, error: fetchError } = await supabase
    .from('curriculum_templates')
    .select('*')
    .eq('template_id', templateId)
    .single();

  if (fetchError) throw fetchError;
  if (!schedule) throw new AppError('Schedule not found', 404);

  // Update subject at specified index
  const subjects = schedule.subjects || [];
  if (subjectIndex < 0 || subjectIndex >= subjects.length) {
    throw new AppError('Invalid subject index', 400);
  }

  subjects[subjectIndex].assigned_professor_id = professorId;

  // Update schedule
  const { data: updated, error: updateError } = await supabase
    .from('curriculum_templates')
    .update({ subjects })
    .eq('template_id', templateId)
    .select()
    .single();

  if (updateError) throw updateError;
  return updated;
}

/**
 * Assign multiple professors to subjects in a schedule
 */
async function assignMultipleProfessors(templateId, assignments) {
  // Get current schedule
  const { data: schedule, error: fetchError } = await supabase
    .from('curriculum_templates')
    .select('*')
    .eq('template_id', templateId)
    .single();

  if (fetchError) throw fetchError;
  if (!schedule) throw new AppError('Schedule not found', 404);

  // Apply all assignments
  const subjects = schedule.subjects || [];
  assignments.forEach(({ subject_index, professor_id }) => {
    if (subject_index >= 0 && subject_index < subjects.length) {
      subjects[subject_index].assigned_professor_id = professor_id;
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
  return updated;
}

/**
 * Get Professor's Schedule
 * Fetches all curriculum templates where the professor has subject assignments
 */
async function getProfessorSchedule(professorId) {
  // Fetch all active curriculum templates
  // We'll filter for professor assignments in JavaScript
  const { data, error } = await supabase
    .from('curriculum_templates')
    .select(`
      template_id,
      section_name,
      school_year,
      term,
      year_level,
      subjects,
      department:departments(dept_id, dept_name)
    `)
    .eq('is_active', true)
    .order('school_year', { ascending: false })
    .order('term', { ascending: true })
    .order('year_level', { ascending: true })
    .order('section_name', { ascending: true });

  if (error) throw error;

  if (!data || data.length === 0) {
    return [];
  }

  // Filter templates: only include those where professor has at least one subject assigned
  // Filter subjects: only include those assigned to this professor
  const scheduleWithFilteredSubjects = data
    .map(template => ({
      ...template,
      subjects: Array.isArray(template.subjects)
        ? template.subjects.filter(
          subject => subject.assigned_professor_id === professorId
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
  getProfessorSchedule
};
