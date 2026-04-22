/**
 * Curriculum Coverage Audit
 * Department Head Dashboard - Reports Section
 * Analyzes subject assignments and identifies coverage gaps
 */

import { showReportLoadingState, showReportErrorState, getReportHeader, fetchCurrentSchoolInfo } from './reports.js';

function initializeCurriculumAudit() {
  const auditButton = document.getElementById('curriculumAuditModal');
  if (!auditButton) return;

  // Add event listeners to audit buttons
  const pdfBtn = auditButton.closest('.report-card')?.querySelector('button.btn-secondary:nth-child(1)');
  const excelBtn = auditButton.closest('.report-card')?.querySelector('button.btn-secondary:nth-child(2)');

  if (pdfBtn) pdfBtn.addEventListener('click', () => generateCurriculumAuditPDF());
  if (excelBtn) excelBtn.addEventListener('click', () => generateCurriculumAuditExcel());
}

/**
 * Fetch curriculum data for the department
 */
async function fetchCurriculumData() {
  try {
    const apiBase = window.API_URL || '/api';
    const response = await window.fetchWithAuth(`${apiBase}/curriculum?_limit=1000`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || data || [];
  } catch (error) {
    console.error('[CurriculumAudit] Error fetching curriculum:', error);
    return [];
  }
}

/**
 * Fetch all department professors
 */
async function fetchAuditProfessors() {
  try {
    const apiBase = window.API_URL || '/api';
    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/employees?_limit=1000`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || data || [];
  } catch (error) {
    console.error('[CurriculumAudit] Error fetching professors:', error);
    return [];
  }
}

/**
 * Analyze curriculum data to identify assignments and gaps
 */
function analyzeCurriculumCoverage(templates, professors) {
  const professorMap = {};
  professors.forEach(prof => {
    professorMap[prof.user_id || prof.id] = prof;
  });

  const analysis = {
    totalSubjects: 0,
    assignedSubjects: 0,
    unassignedSubjects: 0,
    assignmentsByProfessor: {},
    subjectsWithoutProfessor: [],
    allAssignments: []
  };

  // Process each template (section schedule)
  templates.forEach(template => {
    if (!Array.isArray(template.subjects)) return;

    template.subjects.forEach((subject, idx) => {
      analysis.totalSubjects++;

      const subjectData = {
        subject_code: subject.subject_code,
        subject_name: subject.subject_name,
        section: template.section_name,
        year_level: template.year_level,
        school_year: template.school_year,
        term: template.term,
        time: `${subject.start_time} - ${subject.end_time}`,
        days: Array.isArray(subject.days_of_week) ? subject.days_of_week.join(', ') : subject.days_of_week,
        room: subject.room_name || 'TBD',
        professor_id: subject.assigned_professor_id,
        professor_name: ''
      };

      if (subject.assigned_professor_id) {
        analysis.assignedSubjects++;
        const prof = professorMap[subject.assigned_professor_id];
        subjectData.professor_name = prof ? `${prof.first_name || ''} ${prof.last_name || ''}`.trim() : 'Unknown';

        // Track assignments by professor
        if (!analysis.assignmentsByProfessor[subjectData.professor_name]) {
          analysis.assignmentsByProfessor[subjectData.professor_name] = [];
        }
        analysis.assignmentsByProfessor[subjectData.professor_name].push(subjectData);
      } else {
        analysis.unassignedSubjects++;
        subjectData.professor_name = 'UNASSIGNED';
        analysis.subjectsWithoutProfessor.push(subjectData);
      }

      analysis.allAssignments.push(subjectData);
    });
  });

  return analysis;
}

/**
 * Generate Curriculum Audit PDF Report
 */
async function generateCurriculumAuditPDF() {
  try {
    showReportLoadingState(true);

    // Check if pdfMake is available
    if (typeof pdfMake === 'undefined') {
      showReportErrorState('PDF library not available, switching to Excel');
      generateCurriculumAuditExcel();
      return;
    }

    // Fetch data
    const [templates, professors, schoolInfo] = await Promise.all([
      fetchCurriculumData(),
      fetchAuditProfessors(),
      fetchCurrentSchoolInfo()
    ]);

    const analysis = analyzeCurriculumCoverage(templates, professors);

    if (analysis.totalSubjects === 0) {
      showReportErrorState('No curriculum data found');
      showReportLoadingState(false);
      return;
    }

    // Build PDF content
    const docDefinition = {
      content: [
        // Standard Header
        ...getReportHeader(schoolInfo),

        // Report Title
        {
          text: 'Curriculum Coverage Audit',
          style: 'title',
          margin: [0, 0, 0, 5]
        },

        // Metadata
        {
          columns: [
            { text: '', width: '*' },
            {
              width: 'auto',
              stack: [
                { text: `Generated: ${new Date().toLocaleString()}`, style: 'info', alignment: 'right' }
              ]
            }
          ],
          margin: [0, 0, 0, 20]
        },

        // Summary Statistics (Minimalist Box Design)
        {
          table: {
            widths: ['25%', '25%', '25%', '25%'],
            body: [
              [
                { text: 'TOTAL CLASSES', style: 'summaryHeader' },
                { text: 'ASSIGNED', style: 'summaryHeader' },
                { text: 'UNASSIGNED', style: 'summaryHeader' },
                { text: 'COVERAGE', style: 'summaryHeader' }
              ],
              [
                { text: analysis.totalSubjects.toString(), style: 'summaryValue', color: '#333333' },
                { text: analysis.assignedSubjects.toString(), style: 'summaryValue', color: '#2E7D32' }, // Green
                { text: analysis.unassignedSubjects.toString(), style: 'summaryValue', color: '#C62828' }, // Red
                {
                  text: `${((analysis.assignedSubjects / analysis.totalSubjects) * 100).toFixed(1)}%`,
                  style: 'summaryValue',
                  color: '#1F2937'
                }
              ]
            ]
          },
          layout: {
            hLineWidth: function (i, node) { return (i === 1) ? 1 : 0; },
            vLineWidth: function (i, node) { return (i > 0 && i < 4) ? 1 : 0; },
            hLineColor: '#E5E7EB',
            vLineColor: '#E5E7EB',
            paddingTop: function (i) { return 10; },
            paddingBottom: function (i) { return 10; }
          },
          margin: [0, 0, 0, 25]
        },

        // Assignments by Professor
        {
          text: 'Assigned Professors',
          style: 'sectionHeader',
          pageBreak: 'before'
        }
      ],
      styles: {
        title: {
          fontSize: 14,
          bold: true,
          color: '#333333',
          margin: [0, 0, 0, 5]
        },
        info: {
          fontSize: 9,
          color: '#666666'
        },
        sectionHeader: {
          fontSize: 12,
          bold: true,
          color: '#1B5E20', // Dark Green
          marginTop: 15,
          marginBottom: 10,
          borderBottom: '1px solid #4CAF50'
        },
        summaryHeader: {
          fontSize: 8,
          bold: true,
          color: '#9E9E9E',
          alignment: 'center',
          margin: [0, 0, 0, 5]
        },
        summaryValue: {
          fontSize: 16,
          bold: true,
          alignment: 'center'
        },
        tableHeader: {
          fontSize: 8,
          bold: true,
          color: '#9E9E9E',
          margin: [0, 0, 0, 4]
        },
        tableCell: {
          fontSize: 9,
          color: '#333333'
        }
      },
      defaultStyle: {
        fontSize: 9,
        font: 'Roboto'
      },
      pageOrientation: 'portrait',
      pageMargins: [30, 30, 30, 30]
    };

    // Add professor assignments
    const sortedProfessors = Object.entries(analysis.assignmentsByProfessor).sort();

    sortedProfessors.forEach(([profName, subjects], idx) => {
      // Sort subjects: Day -> Time (Earliest to Latest)
      subjects.sort((a, b) => { // Ascending
        const getDayRank = (d) => {
          const days = (d || '').toUpperCase();
          if (days.startsWith('M')) return 1;
          if (days.startsWith('T') && !days.startsWith('TH')) return 2;
          if (days.startsWith('W')) return 3;
          if (days.startsWith('TH')) return 4;
          if (days.startsWith('F')) return 5;
          if (days.startsWith('S')) return 6;
          return 7;
        };

        const rankA = getDayRank(a.days);
        const rankB = getDayRank(b.days);

        if (rankA !== rankB) return rankA - rankB;
        return (a.time || '').localeCompare(b.time || '');
      });

      // Professor Header
      docDefinition.content.push({
        text: `${profName}`,
        fontSize: 11,
        bold: true,
        color: '#333333',
        margin: [0, idx === 0 ? 0 : 20, 0, 5]
      });

      docDefinition.content.push({
        text: `${subjects.length} Subject${subjects.length !== 1 ? 's' : ''} Assigned`,
        fontSize: 9,
        color: '#6B7280',
        margin: [0, 0, 0, 8]
      });

      const tableBody = [
        [
          { text: 'SECTION', style: 'tableHeader' },
          { text: 'DAYS', style: 'tableHeader' },
          { text: 'TIME', style: 'tableHeader' },
          { text: 'CODE', style: 'tableHeader' },
          { text: 'SUBJECT NAME', style: 'tableHeader' },
          { text: 'ROOM', style: 'tableHeader' }
        ]
      ];

      subjects.forEach(subj => {
        tableBody.push([
          { text: `${subj.section}`, style: 'tableCell', bold: true },
          { text: subj.days, style: 'tableCell' },
          { text: subj.time.split(' - ')[0] + '-' + subj.time.split(' - ')[1], style: 'tableCell', fontSize: 8 },
          { text: subj.subject_code, style: 'tableCell', bold: true },
          { text: subj.subject_name, style: 'tableCell' },
          { text: subj.room, style: 'tableCell' }
        ]);
      });

      docDefinition.content.push({
        table: {
          headerRows: 1,
          widths: ['10%', '10%', '15%', '15%', '35%', '15%'],
          body: tableBody
        },
        layout: {
          hLineWidth: function (i, node) {
            return (i === 1) ? 1 : 1;
          },
          vLineWidth: function (i, node) {
            return 0;
          },
          hLineColor: function (i, node) {
            return (i === 1) ? '#CCCCCC' : '#EEEEEE';
          },
          paddingLeft: function (i) { return 0; },
          paddingRight: function (i) { return 0; },
          paddingTop: function (i) { return 8; },
          paddingBottom: function (i) { return 8; }
        }
      });
    });

    // Coverage Gaps Section
    if (analysis.unassignedSubjects > 0) {
      docDefinition.content.push(
        {
          text: 'Coverage Gaps (No Subjects Professor yet)',
          style: 'sectionHeader',
          color: '#C62828', // Red for emphasis on gaps
          pageBreak: 'before'
        }
      );

      const headerRow = [
        { text: 'SECTION', style: 'tableHeader' },
        { text: 'DAYS', style: 'tableHeader' },
        { text: 'TIME', style: 'tableHeader' },
        { text: 'COURSE CODE', style: 'tableHeader' },
        { text: 'COURSE DESCRIPTION', style: 'tableHeader' },
        { text: 'ROOM', style: 'tableHeader' }
      ];

      const gapTableBody = [JSON.parse(JSON.stringify(headerRow))];

      // Sort by Section, then by Day/Time
      const sortedGaps = analysis.subjectsWithoutProfessor.sort((a, b) => {
        if (a.section !== b.section) return a.section.localeCompare(b.section);

        // Sorting by Day
        const getDayRank = (d) => {
          const days = (d || '').toUpperCase();
          if (days.startsWith('M')) return 1;
          if (days.startsWith('T') && !days.startsWith('TH')) return 2;
          if (days.startsWith('W')) return 3;
          if (days.startsWith('TH')) return 4;
          if (days.startsWith('F')) return 5;
          if (days.startsWith('S')) return 6;
          return 7;
        };

        const rankA = getDayRank(a.days);
        const rankB = getDayRank(b.days);

        if (rankA !== rankB) return rankA - rankB;
        return (a.time || '').localeCompare(b.time || '');
      });

      // Process for rowSpan
      let currentSection = null;
      let sectionStartIndex = 0;

      sortedGaps.forEach((subj, index) => {
        const isNewSection = subj.section !== currentSection;
        let sectionCell = {};

        if (isNewSection) {
          // If not the first section, insert a header row
          if (currentSection !== null) {
            gapTableBody.push(JSON.parse(JSON.stringify(headerRow)));
          }

          currentSection = subj.section;
          sectionStartIndex = index;

          // Calculate rowSpan
          let span = 1;
          for (let i = index + 1; i < sortedGaps.length; i++) {
            if (sortedGaps[i].section === currentSection) span++;
            else break;
          }

          sectionCell = {
            text: subj.section,
            style: 'tableCell',
            bold: true,
            rowSpan: span,
            alignment: 'center',
            margin: [0, (span * 8) / 2, 0, 0]
          };
          // Actually, pdfMake uses alignment: 'center' (horizontal) and we can use margin or just let it be. 
          // For vertical centering in rowSpan, pdfMake doesn't inherently center across the span unless we use a nested table or specific layout hacks. 
          // However, simplified approach: just rowSpan. 
        } else {
          sectionCell = { text: '', style: 'tableCell' }; // Empty cell for spanned rows
        }

        // Add row
        gapTableBody.push([
          { ...sectionCell, alignment: 'center', verticalAlignment: 'middle' }, // Attempt vertical center
          { text: subj.days, style: 'tableCell' },
          { text: subj.time.split(' - ')[0] + '-' + subj.time.split(' - ')[1], style: 'tableCell', fontSize: 8 },
          { text: subj.subject_code, style: 'tableCell', bold: true, color: '#C62828' },
          { text: subj.subject_name, style: 'tableCell' },
          { text: subj.room, style: 'tableCell' }
        ]);
      });

      docDefinition.content.push({
        table: {
          headerRows: 1,
          widths: ['15%', '10%', '15%', '15%', '30%', '15%'],
          body: gapTableBody
        },
        layout: {
          hLineWidth: function (i, node) {
            // Draw lines for header
            if (i === 1) return 1;
            // Draw lines between SECTIONS (skip lines inside a rowSpan group?)
            // We can check if the row index corresponds to a new section start?
            // node.table.body[i] is the row.
            // But we don't have easy access to data here.
            // Standard lines are fine.
            return 1;
          },
          vLineWidth: function (i, node) {
            return 0;
          },
          hLineColor: function (i, node) {
            // Header line darker
            if (i === 1) return '#CCCCCC';
            // Inner lines lighter
            return '#EEEEEE';
          },
          paddingLeft: function (i) { return 4; },
          paddingRight: function (i) { return 4; },
          paddingTop: function (i) { return 8; },
          paddingBottom: function (i) { return 8; }
        }
      });
    }

    // Generate and download
    const filename = `curriculum_audit_${new Date().getTime()}.pdf`;
    pdfMake.createPdf(docDefinition).download(filename);

    // Log the download (curriculum audit uses 'daily' timeline, no date range filtering)
    const today = new Date().toISOString().split('T')[0];
    logReportDownload('curriculum_audit', 'pdf', 'custom', today, today);

    console.log('[CurriculumAudit] PDF generated');
  } catch (error) {
    console.error('[CurriculumAudit] PDF generation error:', error);
    showReportErrorState('Error generating PDF');
  } finally {
    showReportLoadingState(false);
  }
}

/**
 * Generate Curriculum Audit Excel Report
 */
async function generateCurriculumAuditExcel() {
  try {
    showReportLoadingState(true);

    // Check if ExcelJS is available
    if (typeof ExcelJS === 'undefined') {
      showReportErrorState('Excel library not available');
      showReportLoadingState(false);
      return;
    }

    // Fetch data
    const [templates, professors, schoolInfo] = await Promise.all([
      fetchCurriculumData(),
      fetchAuditProfessors(),
      fetchCurrentSchoolInfo()
    ]);

    const analysis = analyzeCurriculumCoverage(templates, professors);

    if (analysis.totalSubjects === 0) {
      showReportErrorState('No curriculum data found');
      showReportLoadingState(false);
      return;
    }

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const schoolYear = schoolInfo.school_year || '2025-2026';
    const term = schoolInfo.term || 'Second Semester';

    // Helper: Add Standard Header to a sheet
    const addSheetHeader = (sheet, title, colSpan = 6) => {
      // College Info
      const headerRows = [
        sheet.addRow(['St. Clare College']),
        sheet.addRow(['Caloocan City, NCR']),
        sheet.addRow(['Philippines']),
        sheet.addRow(['BACHELOR OF SCIENCE IN COMPUTER SCIENCE']),
        sheet.addRow([`SY. ${schoolYear} | ${term.toUpperCase()}`])
      ];

      headerRows[0].font = { bold: true, size: 12, name: 'Arial' };
      headerRows[1].font = { size: 10, name: 'Arial', color: { argb: 'FF666666' } };
      headerRows[2].font = { size: 10, name: 'Arial', color: { argb: 'FF666666' } };
      headerRows[3].font = { bold: true, size: 11, name: 'Arial', color: { argb: 'FF1B5E20' } };
      headerRows[4].font = { size: 10, name: 'Arial', color: { argb: 'FF333333' } };

      // Merge and Center Header Rows (Cols 1 to colSpan)
      headerRows.forEach(row => {
        sheet.mergeCells(row.number, 1, row.number, colSpan);
        row.getCell(1).alignment = { horizontal: 'center' };
      });

      sheet.addRow([]); // Spacer

      // Report Title
      const titleRow = sheet.addRow([title]);
      titleRow.font = { bold: true, size: 14, color: { argb: 'FF333333' } };
      sheet.mergeCells(titleRow.number, 1, titleRow.number, colSpan);
      titleRow.getCell(1).alignment = { horizontal: 'center' };

      const timeRow = sheet.addRow([`Generated: ${new Date().toLocaleString()}`]);
      timeRow.font = { size: 9, color: { argb: 'FF666666' } };
      sheet.mergeCells(timeRow.number, 1, timeRow.number, colSpan);
      timeRow.getCell(1).alignment = { horizontal: 'center' }; // or right aligned? Reference image cuts off but usually center or right. Let's center for consistency or right aligns better? 
      // PDF has info right aligned.
      // But standard St. Clare header usually centers everything.
      // I'll stick to center to match the header block style.

      sheet.addRow([]); // Spacer
    };

    // --- SHEET 1: Summary ---
    const summarySheet = workbook.addWorksheet('Summary');
    addSheetHeader(summarySheet, 'Curriculum Coverage Audit', 4);

    // Summary Statistics Box
    const summaryHeaderRow = summarySheet.addRow(['TOTAL CLASSES', 'ASSIGNED', 'UNASSIGNED', 'COVERAGE']);
    summaryHeaderRow.font = { bold: true, size: 9, color: { argb: 'FF9E9E9E' } };
    summaryHeaderRow.alignment = { horizontal: 'center' };

    const summaryValueRow = summarySheet.addRow([
      analysis.totalSubjects,
      analysis.assignedSubjects,
      analysis.unassignedSubjects,
      `${((analysis.assignedSubjects / analysis.totalSubjects) * 100).toFixed(1)}%`
    ]);
    summaryValueRow.font = { bold: true, size: 14 };
    summaryValueRow.alignment = { horizontal: 'center' };

    // Apply colors to values
    summaryValueRow.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF333333' } };
    summaryValueRow.getCell(2).font = { bold: true, size: 14, color: { argb: 'FF2E7D32' } }; // Green
    summaryValueRow.getCell(3).font = { bold: true, size: 14, color: { argb: 'FFC62828' } }; // Red
    summaryValueRow.getCell(4).font = { bold: true, size: 14, color: { argb: 'FF1F2937' } };

    // Borders for summary
    [summaryHeaderRow, summaryValueRow].forEach(row => {
      for (let i = 1; i <= 4; i++) {
        row.getCell(i).border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
      }
    });

    summarySheet.columns = [{ width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }];


    // --- SHEET 2: Assigned Professors ---
    const assignmentSheet = workbook.addWorksheet('Assigned Professors');
    addSheetHeader(assignmentSheet, 'Assigned Professors', 6);

    const sortedProfessors = Object.entries(analysis.assignmentsByProfessor).sort();

    // Headers
    const assignHeader = ['SECTION', 'DAYS', 'TIME', 'CODE', 'SUBJECT NAME', 'ROOM'];

    sortedProfessors.forEach(([profName, subjects]) => {
      // Professor Name Header
      const profRow = assignmentSheet.addRow([profName]);
      profRow.font = { bold: true, size: 12, color: { argb: 'FF333333' } };
      assignmentSheet.addRow([`${subjects.length} Subject${subjects.length !== 1 ? 's' : ''} Assigned`]).font = { size: 9, color: { argb: 'FF6B7280' } };

      // Table Header
      const tblHeaderRow = assignmentSheet.addRow(assignHeader);
      tblHeaderRow.font = { bold: true, size: 9, color: { argb: 'FF9E9E9E' } };
      tblHeaderRow.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };

      // Sort subjects: Day -> Time
      subjects.sort((a, b) => {
        const getDayRank = (d) => {
          const days = (d || '').toUpperCase();
          if (days.startsWith('M')) return 1;
          if (days.startsWith('T') && !days.startsWith('TH')) return 2;
          if (days.startsWith('W')) return 3;
          if (days.startsWith('TH')) return 4;
          if (days.startsWith('F')) return 5;
          if (days.startsWith('S')) return 6;
          return 7;
        };
        const rankA = getDayRank(a.days);
        const rankB = getDayRank(b.days);
        if (rankA !== rankB) return rankA - rankB;
        return (a.time || '').localeCompare(b.time || '');
      });

      // Data Rows
      subjects.forEach(subj => {
        const row = assignmentSheet.addRow([
          subj.section,
          subj.days,
          subj.time.split(' - ')[0] + '-' + subj.time.split(' - ')[1],
          subj.subject_code,
          subj.subject_name,
          subj.room
        ]);
        row.font = { size: 10, color: { argb: 'FF333333' } };
        row.getCell(1).font = { bold: true, size: 10 }; // Section bold
        row.getCell(4).font = { bold: true, size: 10 }; // Code bold
        row.border = { bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } } };
      });

      assignmentSheet.addRow([]); // Spacer
    });

    assignmentSheet.columns = [
      { width: 12 }, { width: 10 }, { width: 15 }, { width: 15 }, { width: 35 }, { width: 15 }
    ];


    // --- SHEET 3: Coverage Gaps ---
    if (analysis.unassignedSubjects > 0) {
      const gapSheet = workbook.addWorksheet('Coverage Gaps');
      addSheetHeader(gapSheet, 'Coverage Gaps (No Subjects Professor yet)', 6);

      // Sort Gaps: Section -> Day -> Time
      const sortedGaps = analysis.subjectsWithoutProfessor.sort((a, b) => {
        if (a.section !== b.section) return a.section.localeCompare(b.section);

        const getDayRank = (d) => {
          const days = (d || '').toUpperCase();
          if (days.startsWith('M')) return 1;
          if (days.startsWith('T') && !days.startsWith('TH')) return 2;
          if (days.startsWith('W')) return 3;
          if (days.startsWith('TH')) return 4;
          if (days.startsWith('F')) return 5;
          if (days.startsWith('S')) return 6;
          return 7;
        };
        const rankA = getDayRank(a.days);
        const rankB = getDayRank(b.days);
        if (rankA !== rankB) return rankA - rankB;
        return (a.time || '').localeCompare(b.time || '');
      });

      let currentSection = null;
      let sectionStartRow = 0;

      const gapHeader = ['SECTION', 'DAYS', 'TIME', 'COURSE CODE', 'COURSE DESCRIPTION', 'ROOM'];

      sortedGaps.forEach((subj, index) => {
        const isNewSection = subj.section !== currentSection;

        if (isNewSection) {
          // Merge previous section cells if needed
          if (currentSection && sectionStartRow > 0) {
            const currentRow = gapSheet.rowCount;
            // If multiple rows in the previous group, merge the Section column
            if (currentRow > sectionStartRow + 1) { // +1 because we might have just added rows
              // Actually tricky to track row numbers with inserted headers.
              // Better strategy: We merge as we go or after finding the range.
              // Let's use simpler logic: Insert header, then rows. 
              // We will merge Section cells at the end of the loop or track indices carefully.
            }
          }

          // Insert Header Row for New Section (Repeated Header)
          if (currentSection !== null) {
            // Add spacer
            // gapSheet.addRow([]); // User logic implies continuous or spaced? PDF has space implied by header.
          }

          // Header Row
          const headerRow = gapSheet.addRow(gapHeader);
          headerRow.font = { bold: true, size: 9, color: { argb: 'FF9E9E9E' } };
          headerRow.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
          // If previous was a header, this line might be redundant? No repeats per section.

          currentSection = subj.section;
          sectionStartRow = gapSheet.rowCount + 1; // The next row is data
        }

        const row = gapSheet.addRow([
          subj.section,
          subj.days,
          subj.time.split(' - ')[0] + '-' + subj.time.split(' - ')[1],
          subj.subject_code,
          subj.subject_name,
          subj.room
        ]);

        row.font = { size: 10, color: { argb: 'FF333333' } };
        row.getCell(1).font = { bold: true, size: 10 };
        row.getCell(4).font = { bold: true, size: 10, color: { argb: 'FFC62828' } }; // Red code
        row.border = { bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } } };
      });

      // Post-processing to merge Section cells
      // We iterate through rows and merge based on Section value
      // Skip header rows (roughly checking value)
      let mergeStart = -1;
      let mergeValue = null;

      gapSheet.eachRow((row, rowNumber) => {
        // Skip top headers (approx first 8 rows)
        if (rowNumber < 9) return;

        const sectionCell = row.getCell(1);
        const sectionVal = sectionCell.value;

        // Check if this is a header row
        if (sectionVal === 'SECTION') {
          // End previous merge
          if (mergeStart !== -1 && rowNumber - 1 > mergeStart) {
            gapSheet.mergeCells(mergeStart, 1, rowNumber - 1, 1);
            gapSheet.getCell(mergeStart, 1).alignment = { vertical: 'middle', horizontal: 'center' };
          }
          mergeStart = -1;
          mergeValue = null;
          return;
        }

        if (sectionVal && sectionVal !== mergeValue) {
          // New section value found
          if (mergeStart !== -1 && rowNumber - 1 > mergeStart) {
            gapSheet.mergeCells(mergeStart, 1, rowNumber - 1, 1);
            gapSheet.getCell(mergeStart, 1).alignment = { vertical: 'middle', horizontal: 'center' };
          }
          mergeStart = rowNumber;
          mergeValue = sectionVal;
        } else if (sectionVal === mergeValue) {
          // Same section, clear text to simulate merge visually if merge fails, but we will merge later.
          // Actually Excel merge retains top-left value.
        }
      });
      // Merge last group
      if (mergeStart !== -1 && gapSheet.rowCount > mergeStart) {
        gapSheet.mergeCells(mergeStart, 1, gapSheet.rowCount, 1);
        gapSheet.getCell(mergeStart, 1).alignment = { vertical: 'middle', horizontal: 'center' };
      }

      gapSheet.columns = [
        { width: 12 }, { width: 10 }, { width: 15 }, { width: 15 }, { width: 35 }, { width: 15 }
      ];
    }

    // Generate and download
    const filename = `curriculum_audit_${new Date().getTime()}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();

    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);

    // Log the download
    const today = new Date().toISOString().split('T')[0];
    logReportDownload('curriculum_audit', 'excel', 'custom', today, today, blob.size, filename);

    console.log('[CurriculumAudit] Excel generated');
  } catch (error) {
    console.error('[CurriculumAudit] Excel generation error:', error);
    showReportErrorState('Error generating Excel');
  } finally {
    showReportLoadingState(false);
  }
}

/**
 * Log report download to backend
 */
async function logReportDownload(reportType, fileFormat, reportTimeline, dateFrom, dateTo, fileSizeBytes = null, fileName = null) {
  try {
    const apiBase = window.API_URL || '/api';

    // Ensure dates are in YYYY-MM-DD format
    const dateFromFormatted = dateFrom.split('T')[0];
    const dateToFormatted = dateTo.split('T')[0];

    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/log-report-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportType,
        fileFormat,
        reportTimeline,
        dateFrom: dateFromFormatted,
        dateTo: dateToFormatted,
        fileSizeBytes,
        fileName
      })
    });

    if (!response.ok) {
      console.warn('[CurriculumAudit] Failed to log download:', await response.text());
      return false;
    }

    console.log('[CurriculumAudit] Download logged successfully');
    return true;
  } catch (error) {
    console.error('[CurriculumAudit] Error logging download:', error);
    // Don't throw - logging failure shouldn't affect user experience
    return false;
  }
}

// Export for use in main module
export { initializeCurriculumAudit, generateCurriculumAuditPDF, generateCurriculumAuditExcel };
