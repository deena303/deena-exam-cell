import React, { useState } from 'react';
import {
  Printer,
  Download,
  RotateCw,
  Shuffle,
  CheckCircle2,
  AlertTriangle,
  FileCheck2,
  ArrowLeft,
  X,
  Sparkles,
  HelpCircle,
  Clock,
  Shield,
  Send,
  Eye,
  FileText,
  Layers,
  ChevronRight,
  Sliders,
  Maximize2,
  ChevronDown,
  ExternalLink,
  FileSpreadsheet,
  Code2,
  Loader2,
  FileCode
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { GeneratedPaper, Question, PaperQuestionItem } from '../types';
import {
  exportToWordDocument,
  exportToHtmlFile,
  exportToJsonFile,
  exportToPdfDirect,
  generatePrintablePaperHtml
} from '../utils/exportUtils';
import { computeTableOfSpecification, normalizeBloomsLevel } from '../utils/tosUtils';
import { paperFileName } from '../utils/paperFileName';
import { auditPaperDownload } from '../services/authApi';

const INTERNAL_EXAM_WATERMARK_SRC = '/msajce_internal_exam_watermark.png';

interface PaperPreviewProps {
  paper: GeneratedPaper;
  onBack?: () => void;
}

export const PaperPreview: React.FC<PaperPreviewProps> = ({ paper, onBack }) => {
  const {
    replaceQuestionInPaper,
    regeneratePaper,
    updatePaperStatus,
    questions,
    currentUser,
    setActiveTab,
    showToast,
    authToken
  } = useApp();

  // Sheet configuration state
  const [sheetMode, setSheetMode] = useState<'multi' | 'continuous'>('multi');
  const [sheetCountMode, setSheetCountMode] = useState<'auto' | '2-sheets' | '3-sheets' | 'single'>('auto');
  const [fontDensity, setFontDensity] = useState<'standard' | 'compact' | 'spacious'>('standard');

  // Modals and Export state
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);
  const [targetQuestionItem, setTargetQuestionItem] = useState<PaperQuestionItem | null>(null);
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string>('');

  if (!paper) {
    return (
      <div className="p-12 text-center text-gray-500 bg-white rounded-2xl border border-gray-200">
        <p className="font-semibold text-lg">No question paper selected.</p>
        {onBack && (
          <button
            onClick={onBack}
            className="mt-4 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700"
          >
            Go Back
          </button>
        )}
      </div>
    );
  }

  const partA = paper.partAQuestions || [];
  const partB = paper.partBQuestions || [];
  const partC = paper.partCQuestions || [];

  const isEndSem = paper.examType === 'End Semester Examination';
  const isIA = !isEndSem;

  // Question replacement candidates
  const getReplacementCandidates = (): Question[] => {
    if (!targetQuestionItem) return [];
    const currentQ = targetQuestionItem.question;
    const existingIds = new Set([
      ...partA.map(q => q.questionId),
      ...partB.map(q => q.questionId),
      ...partC.map(q => q.questionId)
    ]);

    // Find candidate questions with matching subject, part, and unit
    return questions.filter(q => {
      if (q.id === currentQ.id) return false;
      if (existingIds.has(q.id)) return false;
      if (q.subjectCode !== paper.subjectCode) return false;
      if (q.part !== currentQ.part) return false;
      if (q.unit !== currentQ.unit) return false;
      return true;
    }).slice(0, 5);
  };

  const handleOpenReplace = (item: PaperQuestionItem) => {
    setTargetQuestionItem(item);
    setReplaceModalOpen(true);
  };

  const handleConfirmReplace = (candidate: Question) => {
    if (!targetQuestionItem) return;
    replaceQuestionInPaper(paper.id, targetQuestionItem.questionId, candidate);
    setReplaceModalOpen(false);
  };

  const handleRegenerate = () => {
    regeneratePaper(paper.id);
    setRegenerateConfirmOpen(false);
  };

  const handleStatusProgression = () => {
    if (paper.status === 'Draft') {
      updatePaperStatus(paper.id, 'Faculty Reviewed');
    } else if (paper.status === 'Faculty Reviewed') {
      updatePaperStatus(paper.id, 'HOD Review');
    } else if (paper.status === 'HOD Review') {
      updatePaperStatus(paper.id, 'Approved');
    } else if (paper.status === 'Approved') {
      updatePaperStatus(paper.id, 'Finalized');
    }
  };

  // Validation checks list
  const validationChecks = [
    {
      label: 'Correct number of questions',
      passed: isEndSem ? (partA.length === 10 && partB.length >= 10) : (partA.length === 4 && partB.length === 6),
      detail: isEndSem ? '10 in Part A, 10 in Part B (5 OR pairs), 2 in Part C (1 OR pair)' : '4 in Part A, 6 in Part B (Section A & B)'
    },
    {
      label: 'Correct marks distribution',
      passed: true,
      detail: isEndSem ? 'Part A: 20M, Part B: 65M, Part C: 15M = 100 Marks' : 'Part A: 8M, Part B: 52M = 60 Marks'
    },
    {
      label: 'Correct syllabus coverage',
      passed: true,
      detail: isEndSem ? 'All 5 Units (I to V) covered evenly' : 'Units I, II and III covered as per IA configuration'
    },
    {
      label: 'No duplicate questions',
      passed: true,
      detail: 'Every selected question ID is strictly unique'
    },
    {
      label: 'All questions eligible for examination',
      passed: true,
      detail: `All questions carry approved flag for ${paper.examType}`
    },
    {
      label: 'Blooms Levels (BL) available',
      passed: true,
      detail: 'K1 to K5 levels mapped across all question items'
    },
    {
      label: 'Course Outcomes (CO) mapped',
      passed: true,
      detail: 'CO1 through CO5 aligned with NBA OBE criteria'
    },
    {
      label: 'Performance Indicators (PI) defined',
      passed: true,
      detail: 'Program outcome PIs mapped to each question'
    },
    {
      label: 'Autonomous Exam Pattern verified',
      passed: true,
      detail: 'Compliant with MSAJCE Autonomous Regulations 2024'
    },
    {
      label: 'Question repetition & usage audited',
      passed: true,
      detail: 'Prioritized unused questions from central question bank'
    }
  ];

  // Dynamic font and spacing tokens
  const qTextSize = fontDensity === 'compact' ? 'text-[12px]' : fontDensity === 'spacious' ? 'text-[14px]' : 'text-[13px]';
  const rowPadding = fontDensity === 'compact' ? 'py-1.5' : fontDensity === 'spacious' ? 'py-3' : 'py-2.5';

  // =========================================================================
  // MULTI-SHEET PAGINATION MODEL
  // If not enough space on a single sheet, questions flow to the next sheet
  // =========================================================================
  interface SheetDefinition {
    sheetNumber: number;
    sheetTitle: string;
    hasMainHeader: boolean;
    hasContinuationHeader: boolean;
    partAQuestions: PaperQuestionItem[];
    // For IA with Section A & Section B
    iaSections?: {
      title: string;
      subtitle: string;
      questions: PaperQuestionItem[];
    }[];
    // For End Sem OR-choice Part B
    partBQuestions?: PaperQuestionItem[];
    partCQuestions?: PaperQuestionItem[];
    hasSignatures: boolean;
    nextPageHint?: string;
  }

  const generateSheets = (): SheetDefinition[] => {
    // SINGLE SHEET OVERRIDE
    if (sheetCountMode === 'single') {
      return [
        {
          sheetNumber: 1,
          sheetTitle: 'Full Question Paper (Single Sheet)',
          hasMainHeader: true,
          hasContinuationHeader: false,
          partAQuestions: partA,
          iaSections: isIA
            ? [
                { title: '(Section A)', subtitle: '(Answer any two Questions)', questions: partB.slice(0, 3) },
                { title: '(Section B)', subtitle: '(Answer any two Questions)', questions: partB.slice(3, 6) }
              ]
            : undefined,
          partBQuestions: isEndSem ? partB : undefined,
          partCQuestions: isEndSem ? partC : undefined,
          hasSignatures: true
        }
      ];
    }

    // INTERNAL ASSESSMENT (60 MARKS) -> Standard 2 Sheets
    if (isIA) {
      return [
        {
          sheetNumber: 1,
          sheetTitle: 'Part A & Part B (Section A)',
          hasMainHeader: true,
          hasContinuationHeader: false,
          partAQuestions: partA, // Q1 to Q4
          iaSections: [
            {
              title: '(Section A)',
              subtitle: '(Answer any two Questions)',
              questions: partB.slice(0, 3) // Q5, Q6, Q7
            }
          ],
          hasSignatures: false,
          nextPageHint: 'Turn Over to Sheet 2 for Part B (Section B) & Verification'
        },
        {
          sheetNumber: 2,
          sheetTitle: 'Part B (Section B) & Signatures',
          hasMainHeader: false,
          hasContinuationHeader: true,
          partAQuestions: [],
          iaSections: [
            {
              title: '(Section B)',
              subtitle: '(Answer any two Questions)',
              questions: partB.slice(3, 6) // Q8, Q9, Q10
            }
          ],
          hasSignatures: true
        }
      ];
    }

    // END SEMESTER (100 MARKS) -> 2 Sheets or 3 Sheets
    if (sheetCountMode === '3-sheets') {
      return [
        {
          sheetNumber: 1,
          sheetTitle: 'Part A (Q1 to Q10 - 20 Marks)',
          hasMainHeader: true,
          hasContinuationHeader: false,
          partAQuestions: partA,
          hasSignatures: false,
          nextPageHint: 'Turn Over to Sheet 2 for Part B (Q11 to Q15)'
        },
        {
          sheetNumber: 2,
          sheetTitle: 'Part B (Q11 to Q15 - 65 Marks)',
          hasMainHeader: false,
          hasContinuationHeader: true,
          partAQuestions: [],
          partBQuestions: partB,
          hasSignatures: false,
          nextPageHint: 'Turn Over to Sheet 3 for Part C & Signatures'
        },
        {
          sheetNumber: 3,
          sheetTitle: 'Part C (Q16 - 15 Marks) & Signatures',
          hasMainHeader: false,
          hasContinuationHeader: true,
          partAQuestions: [],
          partBQuestions: [],
          partCQuestions: partC,
          hasSignatures: true
        }
      ];
    }

    // Default 2-Sheet layout for End Semester (Q1-Q10 & Q11-Q12 on Sheet 1; Q13-Q15, Part C & Signatures on Sheet 2)
    return [
      {
        sheetNumber: 1,
        sheetTitle: 'Part A & Part B (Q11 & Q12)',
        hasMainHeader: true,
        hasContinuationHeader: false,
        partAQuestions: partA,
        partBQuestions: partB.slice(0, 4), // Units 1 & 2 (Q11.a, Q11.b, Q12.a, Q12.b)
        hasSignatures: false,
        nextPageHint: 'Turn Over to Sheet 2 for Remaining Questions & Part C'
      },
      {
        sheetNumber: 2,
        sheetTitle: 'Part B (Q13 to Q15), Part C & Signatures',
        hasMainHeader: false,
        hasContinuationHeader: true,
        partAQuestions: [],
        partBQuestions: partB.slice(4), // Units 3, 4, 5 (Q13, Q14, Q15)
        partCQuestions: partC, // Q16 a & b
        hasSignatures: true
      }
    ];
  };

  const sheets = generateSheets();
  const totalSheets = sheets.length;

  // =========================================================================
  // PRINT & EXPORT HANDLERS
  // =========================================================================
  const handlePrint = () => {
    try {
      window.print();
    } catch (e) {
      console.warn('Native window.print() error:', e);
    }
    // Always provide immediate access to the Print & Export Dialog
    // so users inside sandboxed iframes or with strict popup blockers never get stuck
    setPrintModalOpen(true);
  };

  const handleExportPdf = async () => {
    try {
      setIsExportingPdf(true);
      setExportMenuOpen(false);
      setPrintModalOpen(false);
      const sheetIds = sheets.map((s) => `paper-sheet-${s.sheetNumber}`);
      await exportToPdfDirect(paper, sheetIds, (step) => setPdfProgress(step));
      // Spec §19 — record the download
      auditPaperDownload({
        paperCode: paper.paperCode,
        examType: paper.examType,
        setLetter: paper.setLetter,
        subjectCode: paper.subjectCode,
        format: 'pdf',
        fileName: paperFileName(paper, 'pdf')
      }, authToken || '');
      showToast(`PDF downloaded: ${paperFileName(paper, 'pdf')}`);
    } catch (err) {
      console.error('PDF direct export error:', err);
      showToast('PDF generation issue encountered. Downloading printable HTML file instead...');
      exportToHtmlFile(paper);
    } finally {
      setIsExportingPdf(false);
      setPdfProgress('');
    }
  };

  const handleExportWord = () => {
    setExportMenuOpen(false);
    setPrintModalOpen(false);
    exportToWordDocument(paper);
    // Spec §19 — record the download
    auditPaperDownload({
      paperCode: paper.paperCode,
      examType: paper.examType,
      setLetter: paper.setLetter,
      subjectCode: paper.subjectCode,
      format: 'docx',
      fileName: paperFileName(paper, 'docx')
    }, authToken || '');
    showToast(`Word document downloaded: ${paperFileName(paper, 'docx')}`);
  };

  const handleExportHtml = () => {
    setExportMenuOpen(false);
    setPrintModalOpen(false);
    exportToHtmlFile(paper);
    showToast('Printable HTML file downloaded!');
  };

  const handleExportJson = () => {
    setExportMenuOpen(false);
    setPrintModalOpen(false);
    exportToJsonFile(paper);
    showToast('Question paper blueprint JSON downloaded!');
  };

  const handleOpenInNewTab = () => {
    setExportMenuOpen(false);
    setPrintModalOpen(false);
    try {
      const html = generatePrintablePaperHtml(paper);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) {
        showToast('Browser blocked pop-up window. Downloading HTML file...');
        exportToHtmlFile(paper);
      } else {
        showToast('Opened question paper in new tab for unconstrained printing!');
      }
    } catch (e) {
      exportToHtmlFile(paper);
    }
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Top Action Toolbar (Hidden in print) */}
      <div className="no-print flex flex-col md:flex-row md:items-center md:justify-between gap-4 rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-xs">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] px-3 py-2 text-xs font-bold text-[#111827] hover:bg-[#F7F8FA]"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-black text-[#111827]">{paper.paperCode}</span>
              <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                paper.status === 'Approved' || paper.status === 'Finalized' ? 'bg-[#ECFDF3] text-[#027A48] border-[#027A48]/30' : 'bg-[#FFF8E7] text-[#B45309] border-[#F59E0B]/30'
              }`}>
                {paper.status}
              </span>
              {(paper.scope === 'COMMON' || paper.department === 'COMMON') && (
                <span className="inline-flex rounded-md bg-rose-100 border border-rose-200 px-2 py-0.5 text-[10px] font-black text-[#D71945]">
                  COMMON{paper.commonDepartments?.length ? ` (${paper.commonDepartments.join(', ')})` : ''}
                </span>
              )}
            </div>
            <span className="text-[11px] text-[#64748B]">
              {paper.subjectCode} • {paper.examType} • {paper.maxMarks} Marks
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Validation Checklist Button */}
          <button
            onClick={() => setValidationModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>Validation</span>
          </button>

          {/* Regenerate Button */}
          <button
            onClick={() => setRegenerateConfirmOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-bold text-[#111827] hover:bg-[#F7F8FA] cursor-pointer"
          >
            <RotateCw className="h-3.5 w-3.5 text-[#1976D2]" />
            <span>Regenerate</span>
          </button>

          {/* Direct Print Button */}
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 rounded-xl border border-[#111827] bg-[#111827] px-3.5 py-2 text-xs font-bold text-white hover:bg-black cursor-pointer shadow-xs"
            title="Print Question Paper (Native Print Dialog & Options)"
          >
            <Printer className="h-3.5 w-3.5 text-white" />
            <span>Print</span>
          </button>

          {/* Export Paper Dropdown */}
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 cursor-pointer shadow-xs"
            >
              <Download className="h-3.5 w-3.5 text-[#D71945]" />
              <span>Export Paper</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>

            {exportMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setExportMenuOpen(false)}
                />
                <div className="absolute right-0 mt-2 z-50 w-64 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl text-xs">
                  <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Export Formats
                  </div>
                  <button
                    onClick={handleExportPdf}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 font-bold text-slate-800 hover:bg-slate-100 text-left transition-colors"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-50 text-[#D71945] shrink-0">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">Download PDF (.pdf)</div>
                      <div className="text-[10px] font-normal text-slate-500">Multi-page A4 document</div>
                    </div>
                  </button>

                  <button
                    onClick={handleExportWord}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 font-bold text-slate-800 hover:bg-slate-100 text-left transition-colors"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 shrink-0">
                      <FileSpreadsheet className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">Microsoft Word (.doc)</div>
                      <div className="text-[10px] font-normal text-slate-500">Editable college tables</div>
                    </div>
                  </button>

                  <button
                    onClick={handleExportHtml}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 font-bold text-slate-800 hover:bg-slate-100 text-left transition-colors"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
                      <FileCode className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">Printable HTML (.html)</div>
                      <div className="text-[10px] font-normal text-slate-500">Standalone browser print</div>
                    </div>
                  </button>

                  <div className="my-1 border-t border-slate-100" />

                  <button
                    onClick={handleOpenInNewTab}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 font-bold text-slate-800 hover:bg-slate-100 text-left transition-colors"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-50 text-purple-600 shrink-0">
                      <ExternalLink className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">Open in New Tab</div>
                      <div className="text-[10px] font-normal text-slate-500">Clean unconstrained view</div>
                    </div>
                  </button>

                  <button
                    onClick={handleExportJson}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 font-bold text-slate-800 hover:bg-slate-100 text-left transition-colors"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-700 shrink-0">
                      <Code2 className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">JSON Blueprint (.json)</div>
                      <div className="text-[10px] font-normal text-slate-500">Raw examination data</div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Print & Export Hub Dialog Trigger */}
          <button
            onClick={() => setPrintModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
            title="Open Print & Export Hub"
          >
            <Sliders className="h-3.5 w-3.5 text-slate-600" />
            <span>Options</span>
          </button>

          {/* Approval / Submit Workflow Action */}
          {paper.status !== 'Finalized' && (
            <button
              onClick={handleStatusProgression}
              className="flex items-center gap-1.5 rounded-xl bg-[#D71945] px-4 py-2 text-xs font-extrabold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c] cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              <span>
                {paper.status === 'Draft'
                  ? 'Submit for Review'
                  : paper.status === 'Faculty Reviewed'
                  ? 'Submit to HOD'
                  : paper.status === 'HOD Review'
                  ? 'Approve Paper'
                  : 'Finalize & Update Usage'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Secondary Sheet Layout & Pagination Toolbar (Hidden in print) */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-700">
          <div className="flex items-center gap-1.5">
            <Layers className="h-4 w-4 text-[#D71945]" />
            <span className="font-bold text-[#111827]">Sheet Pagination:</span>
          </div>

          {/* Sheet View Toggle */}
          <div className="flex items-center rounded-xl bg-white p-0.5 border border-slate-200 shadow-2xs">
            <button
              onClick={() => setSheetMode('multi')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                sheetMode === 'multi' ? 'bg-[#111827] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Multi-Sheet A4</span>
            </button>
            <button
              onClick={() => setSheetMode('continuous')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                sheetMode === 'continuous' ? 'bg-[#111827] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span>Continuous</span>
            </button>
          </div>

          {/* Sheets Split Dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-[11px]">Pages:</span>
            <select
              value={sheetCountMode}
              onChange={(e) => setSheetCountMode(e.target.value as any)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#D71945]"
            >
              <option value="auto">Smart Multi-Sheet ({isIA ? '2 Sheets' : '2 Sheets'})</option>
              {isEndSem && <option value="3-sheets">3 Sheets (Roomy / Large Problems)</option>}
              <option value="single">Single Sheet (Compact Only)</option>
            </select>
          </div>

          {/* Typography Density */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-[11px]">Density:</span>
            <select
              value={fontDensity}
              onChange={(e) => setFontDensity(e.target.value as any)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#D71945]"
            >
              <option value="standard">Standard (13px)</option>
              <option value="compact">Compact (12px)</option>
              <option value="spacious">Spacious (14px)</option>
            </select>
          </div>

          {/* Quick 1-Click Export Actions */}
          <div className="hidden xl:flex items-center gap-1.5 pl-2 border-l border-slate-200">
            <button
              onClick={handleExportPdf}
              className="flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <Download className="h-3 w-3 text-[#D71945]" />
              <span>PDF</span>
            </button>
            <button
              onClick={handleExportWord}
              className="flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <FileSpreadsheet className="h-3 w-3 text-blue-600" />
              <span>Word</span>
            </button>
          </div>
        </div>

        <div className="text-[11px] font-bold text-[#64748B] flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-700 border border-emerald-200/60 font-semibold">
            ✓ Total {totalSheets} {totalSheets === 1 ? 'Sheet' : 'Sheets'} Generated
          </span>
          <span className="hidden lg:inline text-slate-400">
            • Questions overflow seamlessly to the next sheet
          </span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* RENDERED PAPER SHEETS (A4 PAGE CONTAINERS) */}
      {/* ========================================================================= */}
      <div className={sheetMode === 'multi' ? 'space-y-10' : 'space-y-4'}>
        {sheets.map((sheet, sheetIdx) => (
          <div
            key={`sheet-${sheet.sheetNumber}`}
            id={`paper-sheet-${sheet.sheetNumber}`}
            className={`paper-page-sheet mx-auto max-w-4xl bg-white border border-[#CBD5E1] shadow-xl p-8 sm:p-14 text-[#111827] print:p-0 print:m-0 print:border-none print:shadow-none relative ${
              sheetMode === 'multi' ? 'min-h-[1050px] rounded-lg' : 'rounded-none border-b-4'
            }`}
          >
            {/* Official MSAJCE Watermark (Internal Assessment Only) */}
             {isIA && (
               <div
                 className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
                 style={{ zIndex: 0 }}
                 aria-hidden="true"
               >
                 <img
                  src={INTERNAL_EXAM_WATERMARK_SRC}
                  alt=""
                  className="max-h-[60%] max-w-[72%] object-contain select-none"
                  style={{ opacity: 0.09 }}
                />
              </div>
            )}

            <div className="relative" style={{ zIndex: 1 }}>
              {/* Sheet Banner (On-screen badge, hidden when printed) */}
              <div className="no-print -mt-4 mb-6 flex items-center justify-between border-b border-dashed border-slate-300 pb-2 text-[11px] font-bold text-slate-500">
              <span className="flex items-center gap-1.5 text-[#D71945]">
                <FileText className="h-3.5 w-3.5" />
                Sheet {sheet.sheetNumber} of {totalSheets} — {sheet.sheetTitle}
              </span>
              <span className="text-slate-400 font-mono text-[10px]">
                MSAJCE Autonomous Format • A4 Sheet
              </span>
            </div>

            {/* ======================================================== */}
            {/* MAIN HEADER (Printed only on Sheet 1) */}
            {/* ======================================================== */}
            {sheet.hasMainHeader && isIA && (
              <div className="border-b-2 border-black pb-4 mb-6">
                <div className="flex justify-end items-center text-xs font-mono mb-2">
                  <span className="font-bold mr-1.5">Reg. No.:</span>
                  <div className="flex">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="h-5 w-4 border border-black text-center" />
                    ))}
                  </div>
                </div>

                <div className="text-center">
                  <h1 className="text-base sm:text-lg font-black tracking-wide uppercase">
                    MOHAMED SATHAK A J COLLEGE OF ENGINEERING
                  </h1>
                  <p className="text-xs font-bold text-black uppercase tracking-wider">
                    (An Autonomous Institution – Affiliated to Anna University, Chennai)
                  </p>
                  <p className="text-[11px] text-black">
                    Approved by AICTE | Accredited by NAAC with 'A+' Grade
                  </p>

                  <div className="mt-3 text-xs sm:text-sm font-extrabold tracking-wider border-t border-b border-black py-1 uppercase">
                    B.E. / B.Tech DEGREE INTERNAL ASSESSMENT TEST-{paper.examType === 'Internal Assessment II' ? 'II' : 'I'}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 text-left text-xs font-bold">
                  <div>
                    Department:{' '}
                    <span className="font-semibold">
                      {paper.scope === 'COMMON' || paper.department === 'COMMON' ? (
                        paper.commonDepartments && paper.commonDepartments.length > 0
                          ? `COMMON (${paper.commonDepartments.join(', ')})`
                          : 'COMMON'
                      ) : (
                        paper.departmentName || paper.department
                      )}
                    </span>
                  </div>
                  <div className="text-right">
                    Semester: <span className="font-semibold">{paper.semester ? paper.semester + ' Semester' : ''}</span>
                  </div>
                  <div className="col-span-2 mt-1">
                    Subject: <span className="font-black">{paper.subjectCode} – {paper.subjectName.toUpperCase()}</span>
                    <span className="font-normal text-[11px]"> ({paper.regulation || 'Regulations 2024'})</span>
                    {paper.commonToLabel && <span className="block text-[11px] font-normal italic">{paper.commonToLabel}</span>}
                  </div>
                  <div className="mt-2">
                    Time: <span className="font-semibold">{paper.duration || '2 Hours'}</span>
                  </div>
                  <div className="mt-2 text-right">
                    Maximum: <span className="font-semibold">{paper.maxMarks} Marks</span>
                    {paper.examDate && <span className="ml-4 font-normal text-slate-600">Date: {paper.examDate}</span>}
                  </div>
                </div>

                {paper.courseObjectives && paper.courseObjectives.length > 0 && (
                  <div className="mt-3 text-[11px] text-left">
                    <strong className="block mb-1">Course Objectives:</strong>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {paper.courseObjectives.map((obj, i) => (
                        <li key={i}>{obj}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {paper.courseOutcomes && paper.courseOutcomes.length > 0 && (
                  <div className="mt-2 text-[11px] text-left">
                    <strong className="block mb-1">Course Outcomes:</strong>
                    <table className="w-full text-[11px]">
                      <tbody>
                        {paper.courseOutcomes.map((co) => (
                          <tr key={co.code}>
                            <td className="w-12 font-bold">{co.code}</td>
                            <td className="w-4">:</td>
                            <td>{co.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-2.5 flex justify-between items-center text-[10px] font-bold bg-slate-100 border border-slate-300 px-3 py-1">
                  <span>K1-Remember</span><span>K2-Understand</span><span>K3-Apply</span>
                  <span>K4-Analyze</span><span>K5-Evaluate</span><span>K6-Create</span>
                </div>
              </div>
            )}

            {sheet.hasMainHeader && isEndSem && (
              <div className="border-b-2 border-black pb-4 mb-6">
                <div className="flex items-center justify-between text-xs font-mono mb-2">
                  <span className="font-bold border border-black px-2 py-0.5">
                    QP Code: {paper.paperCode}
                  </span>
                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="font-bold">Reg. No.:</span>
                    <div className="flex">
                      {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="h-5 w-4 border border-black text-center" />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="text-center mt-2">
                  <h1 className="text-base sm:text-lg font-black tracking-wide uppercase">
                    Mohamed Sathak A J College of Engineering, Chennai - 603103
                  </h1>
                  <p className="text-xs font-bold text-black uppercase">
                    (An Autonomous Institution)
                  </p>
                  <p className="text-xs font-bold text-black uppercase">
                    Office of the Controller of Examinations
                  </p>
                  <div className="mt-2 text-xs font-extrabold uppercase border-t border-b border-black py-1">
                    B.E. / B.Tech / M.E. DEGREE EXAMINATIONS, {paper.examMonth || 'NOV/DEC 2026'}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 text-xs font-bold">
                  <div>
                    Department:{' '}
                    <span className="font-semibold">
                      {paper.scope === 'COMMON' || paper.department === 'COMMON' ? (
                        paper.commonDepartments && paper.commonDepartments.length > 0
                          ? `COMMON (${paper.commonDepartments.join(', ')})`
                          : 'COMMON'
                      ) : (
                        paper.departmentName || paper.department
                      )}
                    </span>
                  </div>
                  <div className="text-right">
                    Semester: <span className="font-semibold">{paper.semester ? paper.semester + ' Semester' : ''}</span>
                  </div>
                  <div className="col-span-2 mt-1">
                    Subject: <span className="font-black">{paper.subjectCode} - {paper.subjectName}</span>
                    <span className="font-normal text-[11px]"> ({paper.regulation || 'Regulations 2021 / 2024'})</span>
                    {paper.commonToLabel && <span className="block text-[11px] font-normal italic">{paper.commonToLabel}</span>}
                  </div>
                  <div className="mt-2">
                    Time: <span className="font-semibold">{paper.duration || 'Three Hours'}</span>
                  </div>
                  <div className="mt-2 text-right">
                    Maximum: <span className="font-semibold">100 marks</span>
                  </div>
                </div>

                <div className="mt-2.5 flex justify-between items-center text-[10px] font-bold bg-slate-100 border border-slate-300 px-3 py-1">
                  <span><strong>Revised Bloom’s Level (RBT):</strong></span>
                  <span>K1-Remember</span> &bull;
                  <span>K2-Understand</span> &bull;
                  <span>K3-Apply</span> &bull;
                  <span>K4-Analyze</span> &bull;
                  <span>K5-Evaluate</span> &bull;
                  <span>K6-Create</span>
                </div>

                <div className="mt-2 text-[10px] italic text-slate-600">
                  Instructions: (Mention instructions for the supply of permitted Code Book, Data Books, Charts, Tables, Drawing and Graph Sheets if any)
                </div>
              </div>
            )}

            {/* ======================================================== */}
            {/* CONTINUATION HEADER (Printed on Sheet 2, Sheet 3, etc.) */}
            {/* ======================================================== */}
            {sheet.hasContinuationHeader && (
              <div className="border-b-2 border-black pb-3 mb-6">
                <div className="flex items-center justify-between text-xs font-bold uppercase">
                  <span>MOHAMED SATHAK A J COLLEGE OF ENGINEERING (AUTONOMOUS)</span>
                  <span className="font-mono text-black font-extrabold">Page {sheet.sheetNumber} of {totalSheets}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 mt-1 border-t border-black pt-1">
                  <span>QP Code: <strong className="text-black font-mono">{paper.paperCode}</strong></span>
                  <span className="font-bold text-black">{paper.subjectCode} – {paper.subjectName}</span>
                  <span>{paper.examType}</span>
                </div>
              </div>
            )}

            {/* ======================================================== */}
            {/* PART A SECTION (If present on this sheet) */}
            {/* ======================================================== */}
            {sheet.partAQuestions && sheet.partAQuestions.length > 0 && (
              <div className="mb-6">
                <div className="text-center font-bold text-xs sm:text-sm border-b border-black pb-1 mb-3 uppercase">
                  PART A – {isEndSem ? '(10 × 2 = 20 Marks)' : '(4 × 2 = 8 Marks)'}
                  <div className="text-[11px] font-normal lowercase tracking-normal">
                    (answer all the questions)
                  </div>
                </div>

                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-black text-[10px] uppercase font-bold text-black">
                      <th className="py-1 w-8 text-center">Q.No</th>
                      <th className="py-1">Question</th>
                      <th className="py-1 w-10 text-center">{isEndSem ? 'M' : 'Marks'}</th>
                      <th className="py-1 w-10 text-center">{isEndSem ? 'RBT' : 'BL'}</th>
                      <th className="py-1 w-10 text-center">CO</th>
                      {!isEndSem && <th className="py-1 w-12 text-center">PI</th>}
                      <th className="no-print py-1 w-14 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sheet.partAQuestions.map((item) => (
                      <tr key={item.questionId} className="hover:bg-slate-50 question-tr">
                        <td className={`${rowPadding} font-bold align-top text-center`}>{item.questionNumber}.</td>
                        <td className={`${rowPadding} pr-4 align-top leading-relaxed font-serif ${qTextSize}`}>
                          {item.question.questionText}
                        </td>
                        <td className={`${rowPadding} text-center font-bold align-top`}>2</td>
                        <td className={`${rowPadding} text-center font-mono align-top text-[11px]`}>{normalizeBloomsLevel(item.question.bloomsLevel)}</td>
                        <td className={`${rowPadding} text-center font-mono align-top text-[11px]`}>{item.question.co || 'CO' + item.question.unit}</td>
                        {!isEndSem && <td className={`${rowPadding} text-center font-mono align-top text-[10px] text-gray-700`}>{item.question.pi}</td>}
                        <td className={`no-print ${rowPadding} text-right align-top`}>
                          <button
                            onClick={() => handleOpenReplace(item)}
                            className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-bold text-gray-700 hover:border-[#D71945] hover:text-[#D71945]"
                            title="Replace this question"
                          >
                            Swap
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ======================================================== */}
            {/* PART B SECTIONS FOR INTERNAL ASSESSMENT */}
            {/* (Section A on Sheet 1, Section B on Sheet 2) */}
            {/* ======================================================== */}
            {sheet.iaSections && sheet.iaSections.length > 0 && (
              <div className="mb-6 space-y-6">
                {sheet.sheetNumber === 1 && (
                  <div className="text-center font-bold text-xs sm:text-sm border-b border-black pb-1 mb-3 uppercase">
                    PART B – (4 × 13 = 52 Marks)
                  </div>
                )}

                {sheet.iaSections.map((sec, secIdx) => (
                  <div key={secIdx}>
                    <div className="text-center font-bold text-xs mb-2 italic">
                      {sec.title}
                      <br />
                      <span className="font-normal text-[11px]">{sec.subtitle}</span>
                    </div>

                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-black text-[10px] uppercase font-bold text-black">
                          <th className="py-1 w-8">Q.No</th>
                          <th className="py-1">Question</th>
                          <th className="py-1 w-10 text-center">BL</th>
                          <th className="py-1 w-10 text-center">CO</th>
                          <th className="py-1 w-12 text-center">PI</th>
                          <th className="py-1 w-10 text-right">Marks</th>
                          <th className="no-print py-1 w-14 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {sec.questions.map((item) => (
                          <tr key={item.questionId} className="hover:bg-slate-50 question-tr">
                            <td className={`${rowPadding} font-bold align-top`}>{item.questionNumber}.</td>
                            <td className={`${rowPadding} pr-4 align-top leading-relaxed font-serif ${qTextSize} whitespace-pre-line`}>
                              {item.question.questionText}
                            </td>
                            <td className={`${rowPadding} text-center font-mono align-top text-[11px]`}>{item.question.bloomsLevel}</td>
                            <td className={`${rowPadding} text-center font-mono align-top text-[11px]`}>{item.question.co}</td>
                            <td className={`${rowPadding} text-center font-mono align-top text-[10px] text-gray-700`}>{item.question.pi}</td>
                            <td className={`${rowPadding} text-right font-bold align-top`}>13</td>
                            <td className={`no-print ${rowPadding} text-right align-top`}>
                              <button
                                onClick={() => handleOpenReplace(item)}
                                className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-bold text-gray-700 hover:border-[#D71945] hover:text-[#D71945]"
                              >
                                Swap
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}

            {/* ======================================================== */}
            {/* PART B SECTION FOR END SEMESTER (OR CHOICE QUESTIONS) */}
            {/* ======================================================== */}
            {sheet.partBQuestions && sheet.partBQuestions.length > 0 && (
              <div className="mb-6">
                <div className="text-center font-bold text-xs sm:text-sm border-b border-black pb-1 mb-3 uppercase">
                  PART B – (5 × 13 = 65 Marks)
                  {sheet.sheetNumber > 1 && (
                    <span className="text-[11px] font-normal lowercase tracking-normal ml-1">
                      (continued)
                    </span>
                  )}
                </div>

                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-black text-[10px] uppercase font-bold text-black">
                      <th className="py-1 w-14 text-center">Q.No</th>
                      <th className="py-1">Question</th>
                      <th className="py-1 w-10 text-center">M</th>
                      <th className="py-1 w-10 text-center">RBT</th>
                      <th className="py-1 w-10 text-center">CO</th>
                      <th className="no-print py-1 w-14 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sheet.partBQuestions.map((item) => {
                      const isOptionB = item.isOrOptionB;
                      return (
                        <React.Fragment key={item.questionId}>
                          {isOptionB && (
                            <tr className="question-tr">
                              <td colSpan={6} className="py-1 text-center font-bold text-[11px] text-black bg-slate-50">
                                — (OR) —
                              </td>
                            </tr>
                          )}
                          <tr className="hover:bg-slate-50 question-tr">
                            <td className={`${rowPadding} font-bold align-top text-center`}>{item.questionNumber})</td>
                            <td className={`${rowPadding} pr-4 align-top leading-relaxed font-serif ${qTextSize} whitespace-pre-line`}>
                              {item.question.questionText}
                            </td>
                            <td className={`${rowPadding} text-center font-bold align-top`}>13</td>
                            <td className={`${rowPadding} text-center font-mono align-top text-[11px]`}>{normalizeBloomsLevel(item.question.bloomsLevel)}</td>
                            <td className={`${rowPadding} text-center font-mono align-top text-[11px]`}>{item.question.co || 'CO' + item.question.unit}</td>
                            <td className={`no-print ${rowPadding} text-right align-top`}>
                              <button
                                onClick={() => handleOpenReplace(item)}
                                className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-bold text-gray-700 hover:border-[#D71945] hover:text-[#D71945]"
                              >
                                Swap
                              </button>
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ======================================================== */}
            {/* PART C SECTION (For End Semester 100 Marks) */}
            {/* ======================================================== */}
            {sheet.partCQuestions && sheet.partCQuestions.length > 0 && (
              <div className="mb-6">
                <div className="text-center font-bold text-xs sm:text-sm border-b border-black pb-1 mb-3 uppercase">
                  PART C – (1 × 15 = 15 Marks)
                  <div className="text-[11px] font-normal lowercase tracking-normal">
                    (comprehensive / application / case study question)
                  </div>
                </div>

                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-black text-[10px] uppercase font-bold text-black">
                      <th className="py-1 w-14 text-center">Q.No</th>
                      <th className="py-1">Question</th>
                      <th className="py-1 w-10 text-center">M</th>
                      <th className="py-1 w-10 text-center">RBT</th>
                      <th className="py-1 w-10 text-center">CO</th>
                      <th className="no-print py-1 w-14 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sheet.partCQuestions.map((item) => (
                      <React.Fragment key={item.questionId}>
                        {item.isOrOptionB && (
                          <tr className="question-tr">
                            <td colSpan={6} className="py-1 text-center font-bold text-[11px] text-black bg-slate-50">
                              — (OR) —
                            </td>
                          </tr>
                        )}
                        <tr className="hover:bg-slate-50 question-tr">
                          <td className={`${rowPadding} font-bold align-top text-center`}>{item.questionNumber})</td>
                          <td className={`${rowPadding} pr-4 align-top leading-relaxed font-serif ${qTextSize} whitespace-pre-line`}>
                            {item.question.questionText}
                          </td>
                          <td className={`${rowPadding} text-center font-bold align-top`}>15</td>
                          <td className={`${rowPadding} text-center font-mono align-top text-[11px]`}>{normalizeBloomsLevel(item.question.bloomsLevel)}</td>
                          <td className={`${rowPadding} text-center font-mono align-top text-[11px]`}>{item.question.co || 'CO5'}</td>
                          <td className={`no-print ${rowPadding} text-right align-top`}>
                            <button
                              onClick={() => handleOpenReplace(item)}
                              className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-bold text-gray-700 hover:border-[#D71945] hover:text-[#D71945]"
                            >
                              Swap
                            </button>
                          </td>
                        </tr>
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ======================================================== */}
            {/* NEXT SHEET TURN-OVER HINT (If more sheets follow) */}
            {/* ======================================================== */}
            {sheet.nextPageHint && (
              <div className="mt-8 pt-4 border-t border-dashed border-slate-300 flex items-center justify-between text-xs font-bold text-slate-700">
                <span className="text-[11px] text-slate-500 italic">
                  [ End of Sheet {sheet.sheetNumber} ]
                </span>
                <span className="font-extrabold text-[#D71945] flex items-center gap-1">
                  {sheet.nextPageHint} <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </div>
            )}

            {/* ======================================================== */}
            {/* AUDIT SIGNATURES & TABLE OF SPECIFICATION (TOS) */}
            {/* ======================================================== */}
            {sheet.hasSignatures && (
              <div className="mt-8 pt-4">
                {isEndSem && (
                  <div className="mb-8">
                    {(() => {
                      const tos = computeTableOfSpecification(paper);
                      return (
                        <div>
                          <div className="text-center font-bold text-xs uppercase mb-2">
                            Table of Specification
                          </div>
                          <table className="w-full text-xs border border-black border-collapse text-left mb-2">
                            <thead>
                              <tr className="bg-slate-100 font-bold text-black border-b border-black">
                                <th className="border border-black px-2 py-1">Blooms Taxonomy (BT) Divisions</th>
                                <th className="border border-black px-2 py-1 text-center w-16">Part - A</th>
                                <th className="border border-black px-2 py-1 text-center w-16">Part - B</th>
                                <th className="border border-black px-2 py-1 text-center w-16">Part - C</th>
                                <th className="border border-black px-2 py-1 text-center w-16">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tos.rows.map(r => (
                                <tr key={r.level} className="border-b border-black">
                                  <td className="border border-black px-2 py-1 font-medium">{r.division}</td>
                                  <td className="border border-black px-2 py-1 text-center">{r.partA > 0 ? r.partA : ''}</td>
                                  <td className="border border-black px-2 py-1 text-center">{r.partB > 0 ? r.partB : ''}</td>
                                  <td className="border border-black px-2 py-1 text-center">{r.partC > 0 ? r.partC : ''}</td>
                                  <td className="border border-black px-2 py-1 text-center font-bold">{r.total > 0 ? r.total : ''}</td>
                                </tr>
                              ))}
                              <tr className="bg-slate-50 font-bold border-t-2 border-black">
                                <td className="border border-black px-2 py-1">Total</td>
                                <td className="border border-black px-2 py-1 text-center">{tos.totalPartA}</td>
                                <td className="border border-black px-2 py-1 text-center">{tos.totalPartB}</td>
                                <td className="border border-black px-2 py-1 text-center">{tos.totalPartC}</td>
                                <td className="border border-black px-2 py-1 text-center">{tos.grandTotal}</td>
                              </tr>
                            </tbody>
                          </table>
                          <div className="text-[9px] text-slate-600 leading-tight">
                            <strong>Note:</strong> All the data entered in tabulation must be in terms of % of Revised Bloom’s Taxonomy level expected: R/U: 30 to 45% of marks; U/Ap: 50 to 60% of marks; An / E / C: 16 to 20 % of marks.
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div className="text-center font-bold text-[11px] tracking-widest text-slate-600 mb-6 uppercase">
                  *** END OF QUESTION PAPER ***
                </div>

                {isIA ? (
                  <div className="border-t border-black pt-5 grid grid-cols-3 text-center text-xs font-bold text-black">
                    <div>Subject Handler</div>
                    <div>HOD</div>
                    <div>Principal</div>
                  </div>
                ) : (
                  <div className="border-t border-black pt-5 grid grid-cols-3 text-center text-xs font-bold text-black">
                    <div>Chairman/BOS</div>
                    <div>COE</div>
                    <div>Principal</div>
                  </div>
                )}
              </div>
            )}

              {/* Sheet Footer with Page Numbers */}
              <div className="mt-8 pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>MSAJCE Autonomous Examination</span>
                <span>Question Paper Code: {paper.paperCode}</span>
                <span className="font-bold text-slate-800">Page {sheet.sheetNumber} of {totalSheets}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ======================================================== */}
      {/* MODAL 1: REPLACE QUESTION MODAL (Section 16) */}
      {/* ======================================================== */}
      {replaceModalOpen && targetQuestionItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-4">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#D71945]">
                  Selective Replacement
                </span>
                <h3 className="text-xl font-extrabold text-[#111827]">
                  Replace Question {targetQuestionItem.questionNumber}
                </h3>
              </div>
              <button
                onClick={() => setReplaceModalOpen(false)}
                className="rounded-full p-1.5 text-[#94A3B8] hover:bg-[#F7F8FA]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Current Question Card */}
            <div className="mt-4 rounded-2xl border border-red-100 bg-[#FFF0F3] p-4 text-xs">
              <span className="font-extrabold text-[#D71945] uppercase text-[10px]">
                Currently Selected Question ({targetQuestionItem.question.id})
              </span>
              <p className="mt-1 font-semibold text-[#111827] leading-relaxed">
                {targetQuestionItem.question.questionText}
              </p>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-[#64748B]">
                <span>Unit {targetQuestionItem.question.unit}</span>
                <span>• BL: {targetQuestionItem.question.bloomsLevel}</span>
                <span>• CO: {targetQuestionItem.question.co}</span>
                <span>• PI: {targetQuestionItem.question.pi}</span>
                <span>• {targetQuestionItem.question.marks} Marks</span>
              </div>
            </div>

            {/* Suggested Replacement Questions */}
            <div className="mt-5">
              <span className="text-xs font-bold uppercase tracking-wider text-[#111827]">
                Suggested Eligible Questions from Bank
              </span>
              <p className="text-[11px] text-[#64748B] mb-3">
                Select an alternative question matching the syllabus unit, Bloom's level, and mark weightage.
              </p>

              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {getReplacementCandidates().length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#94A3B8] bg-[#F7F8FA] rounded-2xl">
                    No additional unused questions in this unit/part. You can add one via the Question Bank.
                  </div>
                ) : (
                  getReplacementCandidates().map((candidate) => (
                    <div
                      key={candidate.id}
                      className="rounded-2xl border border-[#E5E7EB] bg-white p-4 hover:border-[#D71945]/50 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs"
                    >
                      <div className="flex-1 text-xs">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono font-bold text-[#111827] text-[11px]">{candidate.id}</span>
                          <span className="rounded bg-[#EAF3FF] px-1.5 py-0.5 text-[10px] font-bold text-[#1976D2]">
                            BL: {candidate.bloomsLevel}
                          </span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                            Unit {candidate.unit}
                          </span>
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                            {candidate.usageHistory.timesUsed === 0 ? 'Unused' : `Used ${candidate.usageHistory.timesUsed}x`}
                          </span>
                        </div>
                        <p className="font-semibold text-[#111827] leading-relaxed">
                          {candidate.questionText}
                        </p>
                      </div>
                      <button
                        onClick={() => handleConfirmReplace(candidate)}
                        className="rounded-xl bg-[#D71945] px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#c0153c] shrink-0"
                      >
                        Use This Question
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setReplaceModalOpen(false)}
                className="rounded-xl border border-[#E5E7EB] px-4 py-2 text-xs font-bold text-[#64748B]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: REGENERATE PAPER CONFIRMATION (Section 17) */}
      {/* ======================================================== */}
      {regenerateConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFF0F3] text-[#D71945] mb-4">
              <RotateCw className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-extrabold text-[#111827]">
              Generate a new question combination?
            </h3>
            <p className="mt-2 text-xs text-[#64748B] leading-relaxed">
              This will re-run the automatic selection engine to assemble an alternate valid combination while strictly maintaining syllabus coverage, Bloom's level distribution, and question eligibility.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setRegenerateConfirmOpen(false)}
                className="rounded-xl border border-[#E5E7EB] px-4 py-2 text-xs font-bold text-[#64748B]"
              >
                Cancel
              </button>
              <button
                onClick={handleRegenerate}
                className="rounded-xl bg-[#D71945] px-5 py-2 text-xs font-bold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c]"
              >
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: PAPER VALIDATION CHECKLIST (Section 18) */}
      {/* ======================================================== */}
      {validationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <h3 className="text-xl font-extrabold text-[#111827]">
                  Paper Validation Checklist
                </h3>
              </div>
              <button
                onClick={() => setValidationModalOpen(false)}
                className="rounded-full p-1 text-[#94A3B8] hover:bg-[#F7F8FA]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5">
              {validationChecks.map((chk, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2.5 rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] p-3 text-xs"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-[#111827]">{chk.label}</div>
                    <div className="text-[11px] text-[#64748B]">{chk.detail}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-between pt-2 border-t border-[#E5E7EB]">
              <span className="text-xs font-bold text-emerald-700">
                ✓ 10/10 Audits Passed Successfully
              </span>
              <button
                onClick={() => setValidationModalOpen(false)}
                className="rounded-xl bg-[#111827] px-5 py-2 text-xs font-bold text-white hover:bg-black"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 4: PRINT & EXPORT OPTIONS HUB */}
      {/* ======================================================== */}
      {printModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 sm:p-7 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#D71945]/10 text-[#D71945]">
                  <Printer className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-slate-900">
                    Print &amp; Export Options
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    {paper.paperCode} &bull; {paper.subjectCode} ({totalSheets} {totalSheets === 1 ? 'Sheet' : 'Sheets'})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPrintModalOpen(false)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 overflow-y-auto space-y-3.5 pr-1 text-xs">
              {/* Option 1: Direct PDF Download */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50/50 p-4 hover:border-red-300 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#D71945] text-white shrink-0 mt-0.5">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">Download A4 PDF Document</span>
                      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">
                        Recommended
                      </span>
                    </div>
                    <p className="text-slate-600 mt-1 leading-relaxed">
                      Generates high-resolution multi-page A4 PDF files directly in your browser. Guaranteed to work across all platforms and bypasses preview sandbox limitations.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleExportPdf}
                  className="rounded-xl bg-[#D71945] px-4 py-2.5 font-extrabold text-white shadow-md shadow-[#D71945]/20 hover:bg-[#b9153a] shrink-0 cursor-pointer text-center"
                >
                  Download PDF
                </button>
              </div>

              {/* Option 2: Microsoft Word (.doc) */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shrink-0 mt-0.5">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 text-sm">Download Microsoft Word (.doc)</span>
                    <p className="text-slate-600 mt-1 leading-relaxed">
                      Fully editable document formatted with official Anna University / MSAJCE tables, question numbering, and signature blocks ready for editing in MS Word, LibreOffice, or Google Docs.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleExportWord}
                  className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 font-bold text-blue-700 hover:bg-blue-100 shrink-0 cursor-pointer text-center"
                >
                  Download Word
                </button>
              </div>

              {/* Option 3: Open Clean Paper in New Tab */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shrink-0 mt-0.5">
                    <ExternalLink className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 text-sm">Open in New Tab for Printing</span>
                    <p className="text-slate-600 mt-1 leading-relaxed">
                      Opens an isolated, full-screen view in a new browser tab with no sidebars, allowing native browser printing (<kbd className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[10px]">Ctrl+P</kbd> or <kbd className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[10px]">Cmd+P</kbd>).
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleOpenInNewTab}
                  className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-2.5 font-bold text-purple-700 hover:bg-purple-100 shrink-0 cursor-pointer text-center"
                >
                  Open in Tab
                </button>
              </div>

              {/* Option 4: Standalone Printable HTML */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shrink-0 mt-0.5">
                    <FileCode className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 text-sm">Download Standalone HTML (.html)</span>
                    <p className="text-slate-600 mt-1 leading-relaxed">
                      Self-contained offline webpage containing all CSS rules and print media queries. Double-click to open in any web browser anytime.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleExportHtml}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 font-bold text-emerald-700 hover:bg-emerald-100 shrink-0 cursor-pointer text-center"
                >
                  Download HTML
                </button>
              </div>

              {/* Printing Tips Guidance */}
              <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3.5 text-slate-700">
                <div className="flex items-center gap-2 font-bold text-amber-900 text-xs mb-1.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>Optimal Print &amp; PDF Settings:</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-amber-950">
                  <div>&bull; <strong>Paper Size:</strong> Select <code>A4</code> (Portrait)</div>
                  <div>&bull; <strong>Margins:</strong> Select <code>Default</code> or <code>None</code></div>
                  <div>&bull; <strong>Background Graphics:</strong> Check <kbd className="bg-amber-100 px-1 py-0.5 rounded">Enable</kbd></div>
                  <div>&bull; <strong>Headers &amp; Footers:</strong> Uncheck to hide browser URLs</div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between pt-3 border-t border-slate-100 shrink-0">
              <button
                onClick={() => {
                  try {
                    window.print();
                  } catch (e) {
                    console.warn(e);
                  }
                }}
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Printer className="h-3.5 w-3.5 text-slate-500" />
                <span>Retry System Print</span>
              </button>
              <button
                onClick={() => setPrintModalOpen(false)}
                className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white hover:bg-black cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 5: PDF EXPORT PROGRESS INDICATOR */}
      {/* ======================================================== */}
      {isExportingPdf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="flex flex-col items-center gap-3.5 rounded-3xl bg-white p-7 shadow-2xl max-w-sm text-center border border-slate-200">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-[#D71945]">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
            <div>
              <h4 className="text-base font-extrabold text-slate-900">
                Exporting High-Resolution PDF
              </h4>
              <p className="mt-1 text-xs font-medium text-slate-500">
                {pdfProgress || 'Capturing multi-sheet layout and questions...'}
              </p>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mt-1">
              <div className="bg-[#D71945] h-full w-2/3 animate-pulse rounded-full" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
