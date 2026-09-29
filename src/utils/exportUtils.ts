import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { GeneratedPaper, PaperQuestionItem, IatGeneratedBankDetail, SelectedIatQuestion } from '../types';
import { computeTableOfSpecification, generateTosHtml, normalizeBloomsLevel } from './tosUtils';
import { buildPaperFileName, paperFileName } from './paperFileName';

const INTERNAL_EXAM_WATERMARK_SRC = '/msajce_internal_exam_watermark.png';

/**
 * Escape HTML special characters for safe inclusion in templates.
 */
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate clean HTML representation of the question paper for standalone printing,
 * iframe printing, or download. Matches the official Mohamed Sathak A.J. College of Engineering
 * reference documents:
 * - End Semester: EE3251 exam.docx & Question paper format (1).docx
 * - Internal Assessment Test: IAT QUESTION.doc
 */
export function generatePrintablePaperHtml(paper: GeneratedPaper): string {
  const isEndSem = paper.examType === 'End Semester Examination';
  const isIA2 = paper.examType === 'Internal Assessment II';
  const iatTestNum = isIA2 ? 'II' : 'I';

  const partA = paper.partAQuestions || [];
  const partB = paper.partBQuestions || [];
  const partC = paper.partCQuestions || [];

  const commonToText = paper.commonToLabel
    ? paper.commonToLabel
    : (paper.commonDepartments && paper.commonDepartments.length > 0)
      ? `(Common to ${paper.commonDepartments.join(', ')})`
      : '';

  // 12 registration number boxes HTML
  const regBoxesHtml = Array(12)
    .fill('<span class="reg-box"></span>')
    .join('');

  if (isEndSem) {
    // ═══════════════════════════════════════════════════════════════
    // END SEMESTER EXAMINATION TEMPLATE (EE3251 exam.docx)
    // ═══════════════════════════════════════════════════════════════
    const sessionString = paper.examMonth || 'NOV/DEC 2026';
    const tos = computeTableOfSpecification(paper);
    const tosHtml = generateTosHtml(tos);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(paper.subjectCode)} - ${escapeHtml(paper.paperCode)} - End Semester Examination</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 15mm 12mm 15mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 10pt;
      line-height: 1.35;
      color: #000;
      background-color: #fff;
      margin: 0;
      padding: 0;
    }
    .print-bar {
      position: sticky;
      top: 0;
      background: #1e293b;
      color: #fff;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      z-index: 9999;
      box-shadow: 0 2px 10px rgba(0,0,0,0.25);
    }
    .print-bar button {
      background: #D71945;
      color: white;
      border: none;
      padding: 8px 16px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }
    .print-bar button:hover {
      background: #b9153a;
    }
    .paper-container {
      max-width: 820px;
      margin: 20px auto;
      padding: 24px 32px;
      background: #fff;
    }
    .top-meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .reg-area {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10pt;
      font-weight: bold;
    }
    .reg-boxes {
      display: flex;
    }
    .reg-box {
      width: 17px;
      height: 20px;
      border: 1px solid #000;
      margin-right: -1px;
      display: inline-block;
    }
    .college-header {
      text-align: center;
      margin-bottom: 6px;
    }
    .college-name {
      font-size: 13pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin-bottom: 1px;
    }
    .autonomous-tag {
      font-size: 9.5pt;
      margin-bottom: 2px;
    }
    .coe-tag {
      font-size: 10pt;
      font-weight: bold;
      margin-bottom: 4px;
    }
    .exam-title {
      font-size: 10.5pt;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 3px;
    }
    .semester-line {
      font-size: 10pt;
      font-weight: bold;
      margin-bottom: 2px;
    }
    .department-line {
      font-size: 10pt;
      font-weight: bold;
      margin-bottom: 2px;
    }
    .subject-line {
      font-size: 10.5pt;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .common-to {
      font-size: 9pt;
      font-style: italic;
      margin-bottom: 2px;
    }
    .regulation {
      font-size: 9.5pt;
      font-weight: bold;
      margin-bottom: 6px;
    }
    .time-marks-row {
      display: flex;
      justify-content: space-between;
      font-size: 10pt;
      font-weight: bold;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 3px 6px;
      margin-bottom: 8px;
    }
    .rbt-key-box {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      padding: 3px 8px;
      margin-bottom: 10px;
      font-size: 8.5pt;
      font-weight: bold;
    }
    .instructions-notice {
      font-size: 8.5pt;
      font-style: italic;
      margin-bottom: 8px;
      color: #334155;
    }
    /* Official End Sem Table */
    table.endsem-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    table.endsem-table th, table.endsem-table td {
      border: 1px solid #000;
      padding: 5px 6px;
      vertical-align: top;
    }
    table.endsem-table th {
      background-color: #f1f5f9;
      font-weight: bold;
      font-size: 9pt;
      text-align: center;
    }
    .col-qno { width: 44px; text-align: center; font-weight: bold; }
    .col-qtext { text-align: left; }
    .col-m { width: 38px; text-align: center; font-weight: bold; }
    .col-rbt { width: 42px; text-align: center; font-weight: bold; }
    .col-co { width: 44px; text-align: center; font-weight: bold; }
    .part-banner-th {
      text-align: center !important;
      font-weight: bold !important;
      font-size: 10pt !important;
      padding: 4px !important;
    }
    .or-separator-row {
      text-align: center;
      font-weight: bold;
      font-size: 9.5pt;
      background-color: #fafafa;
      padding: 3px !important;
    }
    @media print {
      .print-bar { display: none !important; }
      .paper-container {
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
      }
    }
  </style>
</head>
<body>
  <div class="print-bar">
    <div><strong>MSAJCE Examination System</strong> &bull; ${escapeHtml(paper.subjectCode)} (${escapeHtml(paper.paperCode)})</div>
    <div style="display: flex; gap: 8px;">
      <button onclick="window.print()">🖨️ Print / Save as PDF</button>
      <button style="background: #374151;" onclick="window.close()">Close Window</button>
    </div>
  </div>

  <div class="paper-container">
    <!-- Top Metadata: Question Paper Code & Reg No -->
    <div class="top-meta-row">
      <div style="font-weight: bold; font-size: 9.5pt; border: 1px solid #000; padding: 2px 8px;">
        QP Code: ${escapeHtml(paper.paperCode)}
      </div>
      <div class="reg-area">
        <span>Reg. No.:</span>
        <div class="reg-boxes">${regBoxesHtml}</div>
      </div>
    </div>

    <!-- College Header (EE3251 exam.docx format) -->
    <div class="college-header">
      <div class="college-name">Mohamed Sathak A J College of Engineering, Chennai - 603103</div>
      <div class="autonomous-tag">(An Autonomous Institution)</div>
      <div class="coe-tag">Office of the Controller of Examinations</div>
      <div class="exam-title">B.E. / B.Tech / M.E. DEGREE EXAMINATIONS, ${escapeHtml(sessionString)}</div>
      <div class="semester-line">${escapeHtml(paper.semester ? paper.semester + ' Semester' : '')}</div>
      <div class="department-line">${escapeHtml(paper.departmentName || paper.department)}</div>
      <div class="subject-line">${escapeHtml(paper.subjectCode)} - ${escapeHtml(paper.subjectName)}</div>
      ${commonToText ? `<div class="common-to">${escapeHtml(commonToText)}</div>` : ''}
      <div class="regulation">(${escapeHtml(paper.regulation || 'Regulations 2021 / 2024')})</div>
    </div>

    <!-- Time & Marks Row -->
    <div class="time-marks-row">
      <span>Time: ${escapeHtml(paper.duration || 'Three Hours')}</span>
      <span>Maximum: 100 marks</span>
    </div>

    <!-- Revised Bloom's Taxonomy Reference Key -->
    <div class="rbt-key-box">
      <span><strong>Revised Bloom’s Level (RBT):</strong></span>
      <span>K1-Remember</span> &bull;
      <span>K2-Understand</span> &bull;
      <span>K3-Apply</span> &bull;
      <span>K4-Analyze</span> &bull;
      <span>K5-Evaluate</span> &bull;
      <span>K6-Create</span>
    </div>

    <div class="instructions-notice">
      Instructions: (Mention instructions for the supply of permitted Code Book, Data Books, Charts, Tables, Drawing and Graph Sheets if any)
    </div>

    <!-- PART A TABLE -->
    <table class="endsem-table">
      <thead>
        <tr>
          <th class="col-qno">Q. no.</th>
          <th class="col-qtext">
            PART &ndash; A (10 &times; 2 = 20 Marks)<br>
            <span style="font-weight: normal; font-size: 8.5pt;">Answer All Questions</span>
          </th>
          <th class="col-m">M</th>
          <th class="col-rbt">RBT</th>
          <th class="col-co">CO</th>
        </tr>
      </thead>
      <tbody>
        ${partA.map(item => `
          <tr>
            <td class="col-qno">${escapeHtml(item.questionNumber)}</td>
            <td class="col-qtext">${escapeHtml(item.question.questionText)}</td>
            <td class="col-m">2</td>
            <td class="col-rbt">${escapeHtml(normalizeBloomsLevel(item.question.bloomsLevel))}</td>
            <td class="col-co">${escapeHtml(item.question.co || 'CO' + item.question.unit)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- PART B TABLE -->
    <table class="endsem-table">
      <thead>
        <tr>
          <th class="col-qno">Q.No</th>
          <th class="col-qtext">
            PART &ndash; B (5 &times; 13 = 65 Marks)<br>
            <span style="font-weight: normal; font-size: 8.5pt;">Answer All Questions</span>
          </th>
          <th class="col-m">M</th>
          <th class="col-rbt">RBT</th>
          <th class="col-co">CO</th>
        </tr>
      </thead>
      <tbody>
        ${renderEndSemPartBRows(partB)}
      </tbody>
    </table>

    <!-- PART C TABLE -->
    ${partC.length > 0 ? `
      <table class="endsem-table">
        <thead>
          <tr>
            <th class="col-qno">Q. No.</th>
            <th class="col-qtext">
              PART &ndash; C (1 &times; 15 = 15 Marks)<br>
              <span style="font-weight: normal; font-size: 8.5pt;">Answer All Questions (Compulsory Question derived from any of the Unit)</span>
            </th>
            <th class="col-m">M</th>
            <th class="col-rbt">RBT</th>
            <th class="col-co">CO</th>
          </tr>
        </thead>
        <tbody>
          ${renderEndSemPartCRows(partC)}
        </tbody>
      </table>
    ` : ''}

    <!-- DYNAMIC TABLE OF SPECIFICATION (TOS) -->
    ${tosHtml}

    <div style="text-align: center; font-weight: bold; margin-top: 24px; letter-spacing: 1px;">
      &bull; &bull; &bull; END OF QUESTION PAPER &bull; &bull; &bull;
    </div>
  </div>
</body>
</html>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // INTERNAL ASSESSMENT TEST (IAT) TEMPLATE (IAT QUESTION.doc)
  // ═══════════════════════════════════════════════════════════════
  const courseObjHtml = (paper.courseObjectives && paper.courseObjectives.length > 0)
    ? `<div class="iat-co-block">
        <strong>Course Objectives:</strong>
        <ul style="margin: 4px 0 8px 20px; padding: 0;">
          ${paper.courseObjectives.map(obj => `<li>${escapeHtml(obj)}</li>`).join('')}
        </ul>
      </div>`
    : '';

  const courseOutHtml = (paper.courseOutcomes && paper.courseOutcomes.length > 0)
    ? `<div class="iat-co-block">
        <strong>Course Outcomes:</strong> On completion of the course, the student is expected to be able to
        <table class="iat-co-table">
          ${paper.courseOutcomes.map(co => `
            <tr>
              <td style="width: 48px; font-weight: bold;">${escapeHtml(co.code)}</td>
              <td style="width: 12px;">:</td>
              <td>${escapeHtml(co.description)}</td>
            </tr>
          `).join('')}
        </table>
      </div>`
    : '';

  const bloomsRowHtml = `
    <div class="blooms-row">
      <span>K1-Remember</span> &bull;
      <span>K2-Understand</span> &bull;
      <span>K3-Apply</span> &bull;
      <span>K4-Analyze</span> &bull;
      <span>K5-Evaluate</span> &bull;
      <span>K6-Create</span>
    </div>
  `;

  // Split Part B into Section A (first 3) and Section B (next 3)
  const secAQuestions = partB.filter(q => q.choiceGroup === 'Section A').length > 0
    ? partB.filter(q => q.choiceGroup === 'Section A')
    : partB.slice(0, 3);
  const secBQuestions = partB.filter(q => q.choiceGroup === 'Section B').length > 0
    ? partB.filter(q => q.choiceGroup === 'Section B')
    : partB.slice(3, 6);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(paper.subjectCode)} - ${escapeHtml(paper.paperCode)} - Internal Assessment Test ${iatTestNum}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 14mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 10pt;
      line-height: 1.35;
      color: #000;
      background-color: #fff;
      margin: 0;
      padding: 0;
    }
    .print-bar {
      position: sticky;
      top: 0;
      background: #1e293b;
      color: #fff;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      z-index: 9999;
      box-shadow: 0 2px 10px rgba(0,0,0,0.25);
    }
    .print-bar button {
      background: #D71945;
      color: white;
      border: none;
      padding: 8px 16px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }
    .print-bar button:hover {
      background: #b9153a;
    }
    .paper-container {
      max-width: 820px;
      margin: 20px auto;
      padding: 24px 32px;
      background: #fff;
    }
    .top-reg-row {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      margin-bottom: 8px;
      font-size: 9.5pt;
      font-weight: bold;
    }
    .reg-boxes {
      display: flex;
      margin-left: 8px;
    }
    .reg-box {
      width: 17px;
      height: 20px;
      border: 1px solid #000;
      margin-right: -1px;
      display: inline-block;
    }
    .college-header {
      text-align: center;
      margin-bottom: 12px;
    }
    .college-name {
      font-size: 13.5pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin-bottom: 2px;
    }
    .autonomous-tag {
      font-size: 9.5pt;
      font-weight: bold;
      font-style: italic;
      margin-bottom: 4px;
    }
    .exam-title {
      font-size: 11pt;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 3px;
    }
    .semester-dept {
      font-size: 10pt;
      font-weight: bold;
      margin-bottom: 3px;
    }
    .subject-line {
      font-size: 10.5pt;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .common-to {
      font-size: 9pt;
      font-style: italic;
      margin-bottom: 2px;
    }
    .regulation {
      font-size: 9.5pt;
      font-weight: bold;
      margin-bottom: 8px;
    }
    .time-marks-row {
      display: flex;
      justify-content: space-between;
      font-size: 10pt;
      font-weight: bold;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 4px 6px;
      margin-bottom: 10px;
    }
    .iat-co-block {
      font-size: 9pt;
      margin-bottom: 8px;
      line-height: 1.35;
    }
    .iat-co-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 3px;
      font-size: 8.5pt;
    }
    .iat-co-table td {
      padding: 1px 4px;
      vertical-align: top;
    }
    .blooms-row {
      text-align: center;
      font-size: 8pt;
      font-weight: bold;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      padding: 3px 6px;
      margin-bottom: 12px;
      letter-spacing: 0.2px;
    }
    .part-header {
      text-align: center;
      font-size: 10.5pt;
      font-weight: bold;
      text-transform: uppercase;
      margin: 12px 0 2px 0;
    }
    .part-sub-instruction {
      text-align: center;
      font-size: 9pt;
      font-style: italic;
      margin-bottom: 8px;
    }
    .section-title {
      text-align: center;
      font-size: 10pt;
      font-weight: bold;
      margin: 10px 0 2px 0;
    }
    /* Table for IAT with BL, CO, PI */
    table.iat-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    table.iat-table th, table.iat-table td {
      border: 1px solid #000;
      padding: 6px 8px;
      vertical-align: top;
    }
    table.iat-table th {
      background-color: #f1f5f9;
      font-weight: bold;
      font-size: 9pt;
      text-align: center;
    }
    .col-qno { width: 44px; text-align: center; font-weight: bold; }
    .col-qtext { text-align: left; }
    .col-bl { width: 46px; text-align: center; font-family: monospace; font-size: 9pt; }
    .col-co { width: 46px; text-align: center; font-family: monospace; font-size: 9pt; }
    .col-pi { width: 50px; text-align: center; font-family: monospace; font-size: 8.5pt; color: #334155; }
    .col-marks { width: 48px; text-align: right; font-weight: bold; }
    .iat-or-row {
      text-align: center;
      font-weight: bold;
      font-size: 9.5pt;
      background: #fafafa;
      padding: 4px !important;
    }
    /* Signatures: Subject Handler | HOD | Principal */
    .signatures-block {
      margin-top: 36px;
      padding-top: 12px;
      page-break-inside: avoid;
    }
    .sig-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      text-align: center;
      font-size: 9.5pt;
      font-weight: bold;
      margin-top: 36px;
    }
    /* Official MSAJCE Watermark (IAT Papers Only) */
    .iat-watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 72%;
      max-width: 580px;
      opacity: 0.09;
      pointer-events: none;
      z-index: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .paper-container {
      position: relative;
      z-index: 1;
    }
    @media print {
      .print-bar { display: none !important; }
      .paper-container {
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .iat-watermark {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 72%;
        max-width: 580px;
        opacity: 0.09;
        pointer-events: none;
        z-index: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <img class="iat-watermark" src="${INTERNAL_EXAM_WATERMARK_SRC}" alt="" />
  <div class="print-bar">
    <div><strong>MSAJCE Examination System</strong> &bull; ${escapeHtml(paper.subjectCode)} (${escapeHtml(paper.paperCode)})</div>
    <div style="display: flex; gap: 8px;">
      <button onclick="window.print()">🖨️ Print / Save as PDF</button>
      <button style="background: #374151;" onclick="window.close()">Close Window</button>
    </div>
  </div>

  <div class="paper-container">
    <!-- Top Reg No -->
    <div class="top-reg-row">
      <span>Reg. No.:</span>
      <div class="reg-boxes">${regBoxesHtml}</div>
    </div>

    <!-- Header (IAT QUESTION.doc format) -->
    <div class="college-header">
      <div class="college-name">Mohamed Sathak A J College of Engineering</div>
      <div class="autonomous-tag">(An Autonomous Institution)</div>
      <div class="exam-title">B.E. / B.Tech DEGREE INTERNAL ASSESSMENT TEST-${iatTestNum}</div>
      <div class="semester-dept">
        ${escapeHtml(paper.semester ? paper.semester + ' Semester' : '')} &bull; Department of ${escapeHtml(paper.departmentName || paper.department)}
      </div>
      <div class="subject-line">${escapeHtml(paper.subjectCode)} &ndash; ${escapeHtml(paper.subjectName.toUpperCase())}</div>
      ${commonToText ? `<div class="common-to">${escapeHtml(commonToText)}</div>` : ''}
      <div class="regulation">(${escapeHtml(paper.regulation || 'Regulations 2021 / Regulation 2024')})</div>
    </div>

    <!-- Time & Marks Bar -->
    <div class="time-marks-row">
      <span>Time: ${escapeHtml(paper.duration || '2 Hrs')}</span>
      <span>Maximum: 60 marks</span>
      <span>${paper.examDate ? 'Date: ' + escapeHtml(paper.examDate) : ''}</span>
    </div>

    ${courseObjHtml}
    ${courseOutHtml}
    ${bloomsRowHtml}

    <!-- PART A -->
    <div class="part-header">PART A &ndash; (4 &times; 2 = 8 Marks)</div>
    <div class="part-sub-instruction">(Answer all the Questions)</div>
    <table class="iat-table">
      <thead>
        <tr>
          <th class="col-qno">Q.No</th>
          <th class="col-qtext">Question</th>
          <th class="col-bl">BL</th>
          <th class="col-co">CO</th>
          <th class="col-pi">PI</th>
          <th class="col-marks">Marks</th>
        </tr>
      </thead>
      <tbody>
        ${partA.map(item => `
          <tr>
            <td class="col-qno">${escapeHtml(item.questionNumber)}.</td>
            <td class="col-qtext">${escapeHtml(item.question.questionText)}</td>
            <td class="col-bl">${escapeHtml(item.question.bloomsLevel || '')}</td>
            <td class="col-co">${escapeHtml(item.question.co || 'CO' + item.question.unit)}</td>
            <td class="col-pi">${escapeHtml(item.question.pi || '')}</td>
            <td class="col-marks">2</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- PART B -->
    <div class="part-header">PART B &ndash; (4 &times; 13 = 52 Marks)</div>

    <!-- Section A -->
    <div class="section-title">(Section A)</div>
    <div class="part-sub-instruction">(Answer any two Questions)</div>
    <table class="iat-table">
      <thead>
        <tr>
          <th class="col-qno">Q.No</th>
          <th class="col-qtext">Question</th>
          <th class="col-bl">BL</th>
          <th class="col-co">CO</th>
          <th class="col-pi">PI</th>
          <th class="col-marks">Marks</th>
        </tr>
      </thead>
      <tbody>
        ${secAQuestions.map(item => renderIatQuestionRow(item, 13)).join('')}
      </tbody>
    </table>

    <!-- Section B -->
    <div class="section-title">(Section B)</div>
    <div class="part-sub-instruction">(Answer any two Questions)</div>
    <table class="iat-table">
      <thead>
        <tr>
          <th class="col-qno">Q.No</th>
          <th class="col-qtext">Question</th>
          <th class="col-bl">BL</th>
          <th class="col-co">CO</th>
          <th class="col-pi">PI</th>
          <th class="col-marks">Marks</th>
        </tr>
      </thead>
      <tbody>
        ${secBQuestions.map(item => renderIatQuestionRow(item, 13)).join('')}
      </tbody>
    </table>

    <div style="text-align: center; font-weight: bold; margin-top: 24px; letter-spacing: 1px;">
      &bull; &bull; &bull; END OF QUESTION PAPER &bull; &bull; &bull;
    </div>

    <!-- Signatures matching official IAT QUESTION.doc -->
    <div class="signatures-block">
      <div class="sig-grid">
        <div>
          <div style="border-top: 1px solid #000; width: 75%; margin: 0 auto 6px auto;"></div>
          Subject Handler
        </div>
        <div>
          <div style="border-top: 1px solid #000; width: 75%; margin: 0 auto 6px auto;"></div>
          HOD
        </div>
        <div>
          <div style="border-top: 1px solid #000; width: 75%; margin: 0 auto 6px auto;"></div>
          Principal
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Helper to render an IAT question row (supports subquestions and OR rows)
 */
function renderIatQuestionRow(item: PaperQuestionItem, defaultMarks: number): string {
  const q = item.question;
  const subQs = q.subQuestions && q.subQuestions.length > 0 ? q.subQuestions : [];
  
  const orRow = item.isOrOptionB
    ? `<tr><td colspan="6" class="iat-or-row">OR</td></tr>`
    : '';

  let bodyHtml = escapeHtml(q.questionText);
  if (subQs.length > 0) {
    bodyHtml = subQs.map((sq, idx) => {
      const label = ['a)', 'b)', 'c)', 'd)'][idx] || `(${idx + 1})`;
      return `<div style="margin-top: 3px;"><span style="font-weight:bold; margin-right: 6px;">${label}</span>${escapeHtml(sq)}</div>`;
    }).join('');
  }

  return `
    ${orRow}
    <tr>
      <td class="col-qno">${escapeHtml(item.questionNumber)}.</td>
      <td class="col-qtext">${bodyHtml}</td>
      <td class="col-bl">${escapeHtml(q.bloomsLevel || '')}</td>
      <td class="col-co">${escapeHtml(q.co || 'CO' + q.unit)}</td>
      <td class="col-pi">${escapeHtml(q.pi || '')}</td>
      <td class="col-marks">${defaultMarks}</td>
    </tr>
  `;
}

/**
 * Helper to render Part B rows for End Semester Examination (Q11 to Q15, 13 marks each with (OR), M, RBT, CO)
 */
function renderEndSemPartBRows(partB: PaperQuestionItem[]): string {
  const groups: { [key: string]: PaperQuestionItem[] } = {};

  partB.forEach(item => {
    const match = item.questionNumber.match(/^(\d+)/);
    const key = match ? match[1] : item.choiceGroup || item.questionNumber;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  return Object.keys(groups).map(key => {
    const items = groups[key];
    const qA = items[0];
    const qB = items.length > 1 ? items[1] : null;

    let aRows = '';
    const qASubs = qA.question.subQuestions || [];
    if (qASubs.length > 0) {
      aRows = `
        <tr>
          <td class="col-qno" rowspan="${qASubs.length}">${escapeHtml(key)} a)</td>
          <td class="col-qtext">
            <div><span style="font-weight:bold; margin-right:4px;">i.</span>${escapeHtml(qASubs[0])}</div>
          </td>
          <td class="col-m">${Math.ceil(13 / qASubs.length)}</td>
          <td class="col-rbt">${escapeHtml(normalizeBloomsLevel(qA.question.bloomsLevel))}</td>
          <td class="col-co">${escapeHtml(qA.question.co || 'CO' + qA.question.unit)}</td>
        </tr>
      `;
      for (let s = 1; s < qASubs.length; s++) {
        aRows += `
          <tr>
            <td class="col-qtext">
              <div><span style="font-weight:bold; margin-right:4px;">ii.</span>${escapeHtml(qASubs[s])}</div>
            </td>
            <td class="col-m">${13 - Math.ceil(13 / qASubs.length)}</td>
            <td class="col-rbt">${escapeHtml(normalizeBloomsLevel(qA.question.bloomsLevel))}</td>
            <td class="col-co">${escapeHtml(qA.question.co || 'CO' + qA.question.unit)}</td>
          </tr>
        `;
      }
    } else {
      aRows = `
        <tr>
          <td class="col-qno">${escapeHtml(key)} a)</td>
          <td class="col-qtext">${escapeHtml(qA.question.questionText)}</td>
          <td class="col-m">13</td>
          <td class="col-rbt">${escapeHtml(normalizeBloomsLevel(qA.question.bloomsLevel))}</td>
          <td class="col-co">${escapeHtml(qA.question.co || 'CO' + qA.question.unit)}</td>
        </tr>
      `;
    }

    let bRows = '';
    if (qB) {
      const qBSubs = qB.question.subQuestions || [];
      if (qBSubs.length > 0) {
        bRows = `
          <tr>
            <td class="col-qno" rowspan="${qBSubs.length}">b)</td>
            <td class="col-qtext">
              <div><span style="font-weight:bold; margin-right:4px;">i.</span>${escapeHtml(qBSubs[0])}</div>
            </td>
            <td class="col-m">${Math.ceil(13 / qBSubs.length)}</td>
            <td class="col-rbt">${escapeHtml(normalizeBloomsLevel(qB.question.bloomsLevel))}</td>
            <td class="col-co">${escapeHtml(qB.question.co || 'CO' + qB.question.unit)}</td>
          </tr>
        `;
        for (let s = 1; s < qBSubs.length; s++) {
          bRows += `
            <tr>
              <td class="col-qtext">
                <div><span style="font-weight:bold; margin-right:4px;">ii.</span>${escapeHtml(qBSubs[s])}</div>
              </td>
              <td class="col-m">${13 - Math.ceil(13 / qBSubs.length)}</td>
              <td class="col-rbt">${escapeHtml(normalizeBloomsLevel(qB.question.bloomsLevel))}</td>
              <td class="col-co">${escapeHtml(qB.question.co || 'CO' + qB.question.unit)}</td>
            </tr>
          `;
        }
      } else {
        bRows = `
          <tr>
            <td class="col-qno">b)</td>
            <td class="col-qtext">${escapeHtml(qB.question.questionText)}</td>
            <td class="col-m">13</td>
            <td class="col-rbt">${escapeHtml(normalizeBloomsLevel(qB.question.bloomsLevel))}</td>
            <td class="col-co">${escapeHtml(qB.question.co || 'CO' + qB.question.unit)}</td>
          </tr>
        `;
      }
    }

    return `
      ${aRows}
      ${qB ? `<tr><td colspan="5" class="or-separator-row">(OR)</td></tr>` : ''}
      ${bRows}
    `;
  }).join('');
}

/**
 * Helper to render Part C rows for End Semester Examination (Q16, 15 marks with (OR), M, RBT, CO)
 */
function renderEndSemPartCRows(partC: PaperQuestionItem[]): string {
  const qA = partC[0];
  const qB = partC.length > 1 ? partC[1] : null;

  return `
    <tr>
      <td class="col-qno">16 a)</td>
      <td class="col-qtext">${qA ? escapeHtml(qA.question.questionText) : ''}</td>
      <td class="col-m">15</td>
      <td class="col-rbt">${qA ? escapeHtml(normalizeBloomsLevel(qA.question.bloomsLevel)) : 'K3'}</td>
      <td class="col-co">${qA ? escapeHtml(qA.question.co || 'CO5') : 'CO5'}</td>
    </tr>
    ${qB ? `
      <tr><td colspan="5" class="or-separator-row">(OR)</td></tr>
      <tr>
        <td class="col-qno">b)</td>
        <td class="col-qtext">${escapeHtml(qB.question.questionText)}</td>
        <td class="col-m">15</td>
        <td class="col-rbt">${escapeHtml(normalizeBloomsLevel(qB.question.bloomsLevel))}</td>
        <td class="col-co">${escapeHtml(qB.question.co || 'CO5')}</td>
      </tr>
    ` : ''}
  `;
}

/**
 * Export Question Paper as a genuine Microsoft Word (.doc) document.
 */
export function exportToWordDocument(paper: GeneratedPaper): void {
  const htmlContent = generatePrintablePaperHtml(paper);
  const wordHtml = `
  <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(paper.subjectCode)} - ${escapeHtml(paper.paperCode)}</title>
    <!--[if gte mso 9]>
    <xml>
      <w:WordDocument>
        <w:View>Print</w:View>
        <w:Zoom>100</w:Zoom>
        <w:DoNotOptimizeForBrowser/>
      </w:WordDocument>
    </xml>
    <![endif]-->
  </head>
  <body>
    ${htmlContent}
  </body>
  </html>`;

  const blob = new Blob(['\ufeff', wordHtml], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  // Spec §5 — 24CS514_IAT_Set_A.docx / 24AM411_End_Semester_Set_A.docx
  const safeFilename = paperFileName(paper, 'docx');
  link.download = safeFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export standalone printable HTML file.
 * File name follows the canonical convention (Spec §5).
 */
export function exportToHtmlFile(paper: GeneratedPaper): void {
  const htmlContent = generatePrintablePaperHtml(paper);
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${buildPaperFileName({ subjectCode: paper.subjectCode, examType: paper.examType, setLetter: paper.setLetter, extension: 'pdf' }).replace(/\.pdf$/, '')}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export Question Paper as JSON metadata and blueprint.
 */
export function exportToJsonFile(paper: GeneratedPaper): void {
  const jsonString = JSON.stringify(paper, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${buildPaperFileName({ subjectCode: paper.subjectCode, examType: paper.examType, setLetter: paper.setLetter, extension: 'pdf' }).replace(/\.pdf$/, '')}_blueprint.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * High quality direct PDF generation using html2canvas and jsPDF.
 */
export async function exportToPdfDirect(
  paper: GeneratedPaper,
  sheetContainerIds: string[],
  onProgress?: (step: string) => void
): Promise<void> {
  onProgress?.('Preparing PDF document...');
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  const pdfWidth = 210;
  const pdfHeight = 297;

  for (let i = 0; i < sheetContainerIds.length; i++) {
    const id = sheetContainerIds[i];
    const element = document.getElementById(id);
    if (!element) continue;

    onProgress?.(`Rendering Sheet ${i + 1} of ${sheetContainerIds.length}...`);

    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      ignoreElements: (el) => el.classList.contains('no-print'),
      onclone: (_clonedDoc, clonedElement) => {
        const noPrints = clonedElement.querySelectorAll('.no-print');
        noPrints.forEach((np) => np.remove());
      }
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    if (i > 0) {
      pdf.addPage('a4', 'portrait');
    }

    const canvasRatio = canvas.height / canvas.width;
    const pageRatio = pdfHeight / pdfWidth;
    let renderWidth = pdfWidth;
    let renderHeight = pdfHeight;
    let posX = 0;
    let posY = 0;

    if (canvasRatio > pageRatio) {
      renderWidth = pdfHeight / canvasRatio;
      posX = (pdfWidth - renderWidth) / 2;
    } else {
      renderHeight = pdfWidth * canvasRatio;
    }

    pdf.addImage(imgData, 'JPEG', posX, posY, renderWidth, renderHeight, undefined, 'FAST');
  }

  onProgress?.('Finalizing and downloading PDF...');
  // Spec §5 — Subject Code is the main identifier:
  //   24CS514_IAT_Set_A.pdf / 24AM411_End_Semester_Set_A.pdf
  const filename = paperFileName(paper, 'pdf');
  pdf.save(filename);
}

/**
 * Execute native print with fallback detection.
 */
export function executeNativePrint(
  _paper: GeneratedPaper,
  onBlockedOrFailed: () => void
): void {
  try {
    window.print();
  } catch (err) {
    console.warn('Direct window.print failed:', err);
    onBlockedOrFailed();
  }
}

// ============================================================
// IAT Generated Question Bank Exports (unit-wise)
// ============================================================

/**
 * Derives a safe filename from the bank name.
 * "24AM411 – Artificial Intelligence – IAT Bank 01" → "24AM411_IAT_Bank_01"
 */
function iatBankFileName(bank: IatGeneratedBankDetail, ext: 'pdf' | 'docx'): string {
  // Try to extract subject code and sequence from the name
  const name = bank.name || '';
  // e.g. "24AM411 – Artificial Intelligence – IAT Bank 01"
  const parts = name.split(/\s*[–\-—]\s*/);
  const subjectCode = (parts[0] || bank.subjectCode || 'BANK').trim().replace(/\s+/g, '_');
  const lastPart = (parts[parts.length - 1] || '').trim().replace(/\s+/g, '_');
  const base = lastPart ? `${subjectCode}_${lastPart}` : subjectCode;
  return `${base}.${ext}`;
}

/** Groups and sorts questions unit-wise, then by part. */
function groupIatQuestionsByUnit(questions: SelectedIatQuestion[]): Map<number, {
  partA: SelectedIatQuestion[];
  partB: SelectedIatQuestion[];
  partC: SelectedIatQuestion[];
}> {
  const map = new Map<number, { partA: SelectedIatQuestion[]; partB: SelectedIatQuestion[]; partC: SelectedIatQuestion[] }>();

  for (const q of questions) {
    const unit = typeof q.unit === 'number' && q.unit >= 1 && q.unit <= 5 ? q.unit : 0;
    if (!map.has(unit)) map.set(unit, { partA: [], partB: [], partC: [] });
    const bucket = map.get(unit)!;
    if (q.originalPart === 'Part A') bucket.partA.push(q);
    else if (q.originalPart === 'Part C') bucket.partC.push(q);
    else bucket.partB.push(q);
  }

  // Sort units ascending
  return new Map([...map.entries()].sort((a, b) => a[0] - b[0]));
}

const UNIT_ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** Build full HTML document for the IAT question bank, organized unit-wise. */
export function generateIatBankHtml(bank: IatGeneratedBankDetail): string {
  const unitGroups = groupIatQuestionsByUnit(bank.questions);
  const esc = (t: string | null | undefined) =>
    (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Compute unit-wise distribution for summary table
  const unitSummaryRows = Array.from(unitGroups.entries())
    .filter(([u]) => u >= 1 && u <= 5)
    .map(([u, g]) => {
      const partACount = g.partA.length;
      const partBCount = g.partB.length;
      const partCCount = g.partC.length;
      return `
        <tr>
          <td style="padding:6px 12px; font-weight:bold; text-align:center;">UNIT ${UNIT_ROMAN[u] || u}</td>
          <td style="padding:6px 12px; text-align:center;">${partACount}</td>
          <td style="padding:6px 12px; text-align:center;">${partBCount}</td>
          <td style="padding:6px 12px; text-align:center;">${partCCount || '–'}</td>
          <td style="padding:6px 12px; text-align:center; font-weight:bold;">${partACount + partBCount + partCCount}</td>
        </tr>`;
    }).join('');

  // Build unit sections
  const unitSections = Array.from(unitGroups.entries())
    .filter(([u]) => u >= 1 && u <= 5)
    .map(([u, g]) => {
      const roman = UNIT_ROMAN[u] || String(u);

      const renderPart = (label: string, sublabel: string, qs: SelectedIatQuestion[]) => {
        if (qs.length === 0) return '';
        const rows = qs.map((q, i) => `
          <tr>
            <td style="padding:6px 8px; vertical-align:top; font-weight:bold; white-space:nowrap; color:#64748B; width:28px;">${i + 1}.</td>
            <td style="padding:6px 8px; vertical-align:top; line-height:1.6;">${esc(q.questionText)}</td>
            <td style="padding:6px 8px; vertical-align:top; text-align:center; white-space:nowrap; color:#374151;">${q.marks ?? '–'}</td>
            <td style="padding:6px 8px; vertical-align:top; text-align:center; white-space:nowrap; font-family:monospace; color:#374151;">${esc(q.btl || q.bloomsLevel || '–')}</td>
            <td style="padding:6px 8px; vertical-align:top; text-align:center; white-space:nowrap; font-family:monospace; color:#374151;">${esc(q.co || '–')}</td>
            <td style="padding:6px 8px; vertical-align:top; text-align:center; white-space:nowrap; font-size:10px; color:#94A3B8;">${esc(q.sourceQuestionNumber || '–')}</td>
          </tr>`).join('');

        return `
          <div style="margin-bottom:18px;">
            <div style="font-weight:800; font-size:12.5pt; letter-spacing:0.04em; text-transform:uppercase; color:#1E293B; margin-bottom:4px;">${label}</div>
            <div style="font-size:9.5pt; color:#64748B; margin-bottom:10px; font-style:italic;">${sublabel}</div>
            <table style="width:100%; border-collapse:collapse; font-size:10pt;">
              <thead>
                <tr style="background:#F7F8FA; border-bottom:1px solid #E5E7EB;">
                  <th style="padding:5px 8px; text-align:center; font-size:9px; color:#94A3B8; text-transform:uppercase; width:28px;">#</th>
                  <th style="padding:5px 8px; text-align:left; font-size:9px; color:#94A3B8; text-transform:uppercase;">Question</th>
                  <th style="padding:5px 8px; text-align:center; font-size:9px; color:#94A3B8; text-transform:uppercase; width:50px;">Marks</th>
                  <th style="padding:5px 8px; text-align:center; font-size:9px; color:#94A3B8; text-transform:uppercase; width:50px;">BTL</th>
                  <th style="padding:5px 8px; text-align:center; font-size:9px; color:#94A3B8; text-transform:uppercase; width:50px;">CO</th>
                  <th style="padding:5px 8px; text-align:center; font-size:9px; color:#94A3B8; text-transform:uppercase; width:60px;">Source</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      };

      const partAHtml = renderPart('PART A', 'Short Answer Questions', g.partA);
      const partBHtml = renderPart('PART B', 'Long Answer Questions', g.partB);
      const partCHtml = g.partC.length > 0 ? renderPart('PART C', 'Application / Case Study Questions', g.partC) : '';

      return `
        <div style="page-break-before:${u > 1 ? 'always' : 'auto'}; margin-bottom:32px;">
          <div style="background:#1E293B; color:#fff; padding:10px 16px; border-radius:6px; margin-bottom:20px;">
            <div style="font-size:14pt; font-weight:900; letter-spacing:0.08em; text-transform:uppercase;">
              UNIT – ${roman}
            </div>
          </div>
          ${partAHtml}
          ${partBHtml}
          ${partCHtml}
        </div>`;
    }).join('');

  const totalPartA = bank.actualPartACount;
  const totalPartB = bank.actualPartBCount;
  const totalPartC = bank.actualPartCCount;
  const academicYear = esc(bank.academicYear || '');
  const department = esc(bank.department || '');
  const subjectCode = esc(bank.subjectCode);
  const subjectName = esc(bank.subjectName || '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${subjectCode} – IAT Generated Question Bank</title>
  <style>
    @page { size: A4 portrait; margin: 15mm 18mm 15mm 18mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 10.5pt;
      line-height: 1.5;
      color: #111827;
      background: #fff;
      margin: 0;
      padding: 0;
    }
    .print-bar {
      position: sticky; top: 0; background: #1e293b; color: #fff;
      padding: 10px 20px; display: flex; align-items: center;
      justify-content: space-between; font-family: system-ui, sans-serif;
      font-size: 13px; z-index: 9999; box-shadow: 0 2px 10px rgba(0,0,0,.25);
    }
    .print-bar button {
      background: #D71945; color: white; border: none; padding: 8px 16px;
      font-weight: 600; border-radius: 6px; cursor: pointer; font-size: 13px; margin-left: 8px;
    }
    .print-bar button:hover { background: #b9153a; }
    .print-bar button.sec { background: #374151; }
    .print-bar button.sec:hover { background: #1f2937; }
    .paper-container { max-width: 820px; margin: 20px auto; padding: 24px 32px; background: #fff; }
    .college-header { text-align: center; border-bottom: 2.5px double #1E293B; padding-bottom: 14px; margin-bottom: 18px; }
    .college-name { font-size: 15pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
    .college-sub { font-size: 9.5pt; color: #374151; margin-bottom: 6px; }
    .doc-title { font-size: 13pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; margin: 10px 0 4px; }
    .bank-name { font-size: 11pt; font-weight: 700; color: #1976D2; margin-top: 4px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; margin: 14px 0 18px; border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px 16px; background: #F9FAFB; font-size: 9.5pt; }
    .meta-grid .k { font-weight: 700; color: #374151; }
    .meta-grid .v { color: #111827; }
    .summary-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 9.5pt; }
    .summary-table th, .summary-table td { border: 1px solid #E5E7EB; }
    .summary-table th { background: #F1F5F9; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 10px; color: #475569; }
    .divider { border: none; border-top: 2px dashed #CBD5E1; margin: 28px 0; }
    @media print {
      .print-bar { display: none !important; }
      .paper-container { margin: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="print-bar">
    <span style="font-weight:700;">IAT Question Bank — ${subjectCode}</span>
    <div>
      <button class="sec" onclick="window.close()">✕ Close</button>
      <button onclick="window.print()">🖨 Print / Save PDF</button>
    </div>
  </div>

  <div class="paper-container">
    <div class="college-header">
      <div class="college-name">Mohamed Sathak A.J. College of Engineering</div>
      <div class="college-sub">Affiliated to Anna University | Approved by AICTE | NBA Accredited</div>
      <div class="doc-title">IAT Question Bank</div>
      <div class="bank-name">${esc(bank.name)}</div>
    </div>

    <div class="meta-grid">
      <div><span class="k">Academic Year:</span></div><div><span class="v">${academicYear || '–'}</span></div>
      <div><span class="k">Department:</span></div><div><span class="v">${department || '–'}</span></div>
      <div><span class="k">Subject Code:</span></div><div><span class="v">${subjectCode}</span></div>
      <div><span class="k">Subject Name:</span></div><div><span class="v">${subjectName || '–'}</span></div>
      <div><span class="k">Regulation:</span></div><div><span class="v">Regulation 2024</span></div>
      <div><span class="k">Status:</span></div><div><span class="v">${esc(bank.status)}</span></div>
    </div>

    <table class="summary-table">
      <thead>
        <tr>
          <th>Unit</th>
          <th>Part A</th>
          <th>Part B</th>
          <th>Part C</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${unitSummaryRows}
        <tr style="background:#F1F5F9; font-weight:900;">
          <td style="padding:6px 12px; text-align:center;">TOTAL</td>
          <td style="padding:6px 12px; text-align:center;">${totalPartA}</td>
          <td style="padding:6px 12px; text-align:center;">${totalPartB}</td>
          <td style="padding:6px 12px; text-align:center;">${totalPartC || '–'}</td>
          <td style="padding:6px 12px; text-align:center;">${bank.totalQuestions}</td>
        </tr>
      </tbody>
    </table>

    <hr class="divider">

    ${unitSections}
  </div>
</body>
</html>`;
}

/**
 * Export IAT Generated Question Bank as PDF.
 * Opens a print window — user saves via browser Print → Save as PDF.
 * Read-only: does NOT modify any database records.
 */
export function exportIatBankPdf(bank: IatGeneratedBankDetail): void {
  if (!bank || !bank.questions || bank.questions.length === 0) {
    throw new Error('No questions found in this generated bank.');
  }
  const html = generateIatBankHtml(bank);
  const win = window.open('', '_blank');
  if (!win) throw new Error('Pop-up blocked. Please allow pop-ups and try again.');
  win.document.write(html);
  win.document.close();
  win.focus();
  // Trigger print after images/fonts load
  win.addEventListener('load', () => win.print());
}

/**
 * Export IAT Generated Question Bank as a Word (.docx) document.
 * Uses the same HTML→Word approach as the paper exporter — no new library needed.
 * Read-only: does NOT modify any database records.
 */
export function exportIatBankWord(bank: IatGeneratedBankDetail): void {
  if (!bank || !bank.questions || bank.questions.length === 0) {
    throw new Error('No questions found in this generated bank.');
  }
  const htmlContent = generateIatBankHtml(bank);
  const wordHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset="utf-8">
  <title>${(bank.subjectCode || 'IAT').replace(/[<>"]/g, '')} - ${(bank.name || 'IAT Bank').replace(/[<>"]/g, '')}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
</head>
<body>
  ${htmlContent}
</body>
</html>`;

  const blob = new Blob(['\ufeff', wordHtml], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = iatBankFileName(bank, 'docx');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

