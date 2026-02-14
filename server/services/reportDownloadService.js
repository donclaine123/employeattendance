/**
 * Report Download Service
 * Handles logging and retrieving report generation history
 */

const { supabase } = require('../supabase');
const { AppError } = require('../middleware/errorHandler');

/**
 * Record a report download/generation
 */
async function recordReportDownload({
  userId,
  deptId,
  reportType,        // 'attendance' or 'curriculum_audit'
  fileFormat,        // 'pdf' or 'excel'
  reportTimeline,    // 'daily', 'weekly', 'monthly', or 'custom'
  dateFrom,
  dateTo,
  fileSizeBytes,
  fileName,
  metadata = {}
}) {
  try {
    // Validate inputs
    if (!userId || !deptId || !reportType || !fileFormat || !reportTimeline || !dateFrom || !dateTo) {
      throw new AppError('Missing required fields for report download record', 400);
    }

    const { data, error } = await supabase
      .from('report_downloads')
      .insert([{
        user_id: userId,
        dept_id: deptId,
        report_type: reportType,
        file_format: fileFormat,
        report_timeline: reportTimeline,
        date_from: dateFrom,
        date_to: dateTo,
        file_size_bytes: fileSizeBytes,
        file_name: fileName,
        metadata: metadata,
        generated_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      }])
      .select();

    if (error) throw error;
    
    console.log('[ReportService] Recorded download:', {
      reportType,
      fileFormat,
      reportTimeline,
      dateRange: `${dateFrom} to ${dateTo}`
    });
    
    return data[0];
  } catch (error) {
    console.error('[ReportService] Error recording report download:', error);
    // Don't throw - report generation should not fail due to logging error
    return null;
  }
}

/**
 * Get user's report download history
 */
async function getUserReportHistory(userId, limit = 20, offset = 0) {
  try {
    if (!userId) {
      throw new AppError('User ID required', 400);
    }

    const { data, count, error } = await supabase
      .from('report_downloads')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('generated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return {
      data: data || [],
      pagination: {
        total: count || 0,
        limit,
        offset,
        pages: Math.ceil((count || 0) / limit)
      }
    };
  } catch (error) {
    console.error('[ReportService] Error fetching user report history:', error);
    throw error;
  }
}

/**
 * Get department report statistics
 */
async function getDepartmentReportStats(deptId, daysBack = 30) {
  try {
    if (!deptId) {
      throw new AppError('Department ID required', 400);
    }

    const cutoffDate = new Date(Date.now() - daysBack * 86400000).toISOString();

    const { data, error } = await supabase
      .from('report_downloads')
      .select('report_type, file_format')
      .eq('dept_id', deptId)
      .gte('generated_at', cutoffDate);

    if (error) throw error;

    // Process stats client-side
    const stats = {
      totalReports: data.length,
      byType: {},
      byFormat: {},
      combinations: {}
    };

    data.forEach(record => {
      // Count by type
      stats.byType[record.report_type] = (stats.byType[record.report_type] || 0) + 1;

      // Count by format
      stats.byFormat[record.file_format] = (stats.byFormat[record.file_format] || 0) + 1;

      // Count combinations
      const combo = `${record.report_type}/${record.file_format}`;
      stats.combinations[combo] = (stats.combinations[combo] || 0) + 1;
    });

    return stats;
  } catch (error) {
    console.error('[ReportService] Error fetching department report stats:', error);
    throw error;
  }
}

/**
 * Get all department reports (for admin audit)
 */
async function getDepartmentReportHistory(deptId, limit = 50, offset = 0) {
  try {
    if (!deptId) {
      throw new AppError('Department ID required', 400);
    }

    const { data, count, error } = await supabase
      .from('report_downloads')
      .select(`
        *,
        user:user_id(user_id, username, first_name, last_name)
      `, { count: 'exact' })
      .eq('dept_id', deptId)
      .order('generated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return {
      data: data || [],
      pagination: {
        total: count || 0,
        limit,
        offset,
        pages: Math.ceil((count || 0) / limit)
      }
    };
  } catch (error) {
    console.error('[ReportService] Error fetching department report history:', error);
    throw error;
  }
}

module.exports = {
  recordReportDownload,
  getUserReportHistory,
  getDepartmentReportStats,
  getDepartmentReportHistory
};
