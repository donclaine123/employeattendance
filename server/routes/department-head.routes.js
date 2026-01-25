/**
 * Department Head Routes
 * Handles department head specific operations
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../conn-supabase');

// GET /api/department-head/professors - Get all professors/faculty in a department
router.get('/professors', async (req, res, next) => {
  try {
    const { dept_id } = req.query;
    
    if (!dept_id) {
      return res.status(400).json({ status: 'error', message: 'dept_id is required' });
    }
    
    // Fetch all active employees in the department
    // Filter to those who are faculty/teaching staff
    const { data, error } = await supabase
      .from('employees')
      .select('employee_id, full_name, email, position')
      .eq('dept_id', dept_id)
      .eq('status', 'active')
      .order('full_name', { ascending: true });
    
    if (error) throw error;
    
    // Format response - use employee_id as the identifier for professors
    const formattedData = (data || [])
      .map(emp => ({
        user_id: emp.employee_id,  // Use employee_id as the unique identifier
        full_name: emp.full_name || 'Unknown',
        email: emp.email || '',
        position: emp.position || ''
      }));
    
    res.json({ status: 'success', data: formattedData });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
