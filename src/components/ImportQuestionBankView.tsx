import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  UploadCloud,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  FileCheck2,
  Trash2,
  Edit3,
  Eye,
  Sliders,
  ArrowRight,
  Filter,
  Check,
  X,
  Layers,
  BookOpen,
  Info,
  RefreshCw,
  Copy,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Clock,
  ScanLine,
  Database,
  Wifi,
  WifiOff,
  Zap
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  BloomsLevel,
  OcrExtractedQuestion,
  OcrDocumentMetadata,
  OcrStatus,
  Question,
  QuestionPart
} from '../types';
import {
  SAMPLE_OCR_BANKS,
  OcrProcessingResult,
  processQuestionBankOcr
} from '../utils/ocrEngine';
import {
  extractQuestionBank,
  approveQuestionBank,
  checkBackendHealth,
  geminiStatusMessage
} from '../services/questionBankApi';
import { SideBySideReviewModal } from './SideBySideReviewModal';

export const ImportQuestionBankView: React.FC = () => {
  const {
    subjects,            // legacy local state — still needed for OCR engine subject context
    dbSubjects,          // DB-backed SubjectRecord[] — source of truth for selectors
    activeDepartmentsList,
    academicYearsList,
    activeAcademicYearsList,
    selectedSubjectCode,
    setSelectedSubjectCode,
    questions: existingQuestions,
    addQuestions,
    currentUser,
    setActiveTab,
    showToast
  } = useApp();

  // Academic Year selection — use the first active DB year as default
  const defaultYear = activeAcademicYearsList[0]?.id || '';
  const [selectedAcademicYearId, setSelectedAcademicYearId] = useState<string>(defaultYear);

  // Sync default year when list loads
  useEffect(() => {
    if (!selectedAcademicYearId && activeAcademicYearsList.length > 0) {
      setSelectedAcademicYearId(activeAcademicYearsList[0].id);
    }
  }, [activeAcademicYearsList, selectedAcademicYearId]);

  // Keep legacy selectedAcademicYear string in sync (for backward compat with upload logic)
  const selectedAcademicYear = academicYearsList.find(y => y.id === selectedAcademicYearId)?.year_label || '';

  // Department selection — use the first active DB department as default
  const defaultDept = activeDepartmentsList[0]?.id || '';
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>(defaultDept);

  // Sync default department when list loads
  useEffect(() => {
    if (!selectedDepartmentId && activeDepartmentsList.length > 0) {
      setSelectedDepartmentId(activeDepartmentsList[0].id);
    }
  }, [activeDepartmentsList, selectedDepartmentId]);

  // Legacy selectedDepartment string (department code) for backward compat
  const selectedDepartment = selectedDepartmentId === 'COMMON'
    ? 'COMMON'
    : activeDepartmentsList.find(d => d.id === selectedDepartmentId)?.department_code || '';

  const [commonDepts, setCommonDepts] = useState<string[]>([]);

  // Filter DB subjects by selected academic year ID + department ID (or common multi-select)
  const filteredSubjects = useMemo(() => {
    if (!dbSubjects || dbSubjects.length === 0) return [];
    if (selectedDepartmentId === 'COMMON') {
      // For COMMON scope, filter by selected common department codes
      if (commonDepts.length === 0) return dbSubjects.filter(s => s.academic_year_id === selectedAcademicYearId && s.status === 'active');
      const seen = new Set<string>();
      return dbSubjects.filter(s => {
        if (s.academic_year_id !== selectedAcademicYearId) return false;
        if (s.status !== 'active') return false;
        const deptCode = s.departments?.department_code || '';
        if (!commonDepts.includes(deptCode)) return false;
        if (seen.has(s.subject_code)) return false;
        seen.add(s.subject_code);
        return true;
      });
    }
    return dbSubjects.filter(s =>
      s.academic_year_id === selectedAcademicYearId &&
      s.department_id === selectedDepartmentId &&
      s.status === 'active'
    );
  }, [dbSubjects, selectedAcademicYearId, selectedDepartmentId, commonDepts]);

  // Sync selectedSubjectCode if not in filtered list
  useEffect(() => {
    if (filteredSubjects.length > 0 && !filteredSubjects.some(s => s.subject_code === selectedSubjectCode)) {
      setSelectedSubjectCode(filteredSubjects[0].subject_code);
    }
  }, [filteredSubjects, selectedSubjectCode, setSelectedSubjectCode]);

  // Current Subject (from DB)
  const currentDbSubject = dbSubjects.find(s => s.subject_code === selectedSubjectCode) || filteredSubjects[0];
  // Legacy currentSubject shape for backward compat with upload/OCR logic
  const currentSubject = subjects.find(s => s.code === selectedSubjectCode) || (currentDbSubject ? { id: currentDbSubject.id, code: currentDbSubject.subject_code, name: currentDbSubject.subject_name, department: currentDbSubject.departments?.department_code || '', semester: currentDbSubject.semester || '', regulation: currentDbSubject.regulation || '', totalQuestions: 0, status: 'Active' as const, units: [] } : null);

  // Upload & File State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInfo, setFileInfo] = useState<{
    name: string;
    size: string;
    pages: number;
    status: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing & Pipeline State
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressState, setProgressState] = useState<{
    stage: string;
    message: string;
    percent: number;
    currentPage?: number;
    totalPages?: number;
  }>({
    stage: 'idle',
    message: '',
    percent: 0
  });

  // Extraction Result State
  const [extractedMetadata, setExtractedMetadata] = useState<OcrDocumentMetadata | null>(null);
  const [extractedQuestions, setExtractedQuestions] = useState<OcrExtractedQuestion[]>([]);
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  const [errorPages, setErrorPages] = useState<number[]>([]);

  // Backend health state
  const [backendStatus, setBackendStatus] = useState<{
    checked: boolean;
    running: boolean;
    geminiConfigured: boolean;
    geminiAuthenticated: boolean;
    geminiModelAvailable: boolean;
    geminiStatus?: string;
    geminiMessage?: string;
  }>({
    checked: false,
    running: false,
    geminiConfigured: false,
    geminiAuthenticated: false,
    geminiModelAvailable: false
  });

  // Subject mismatch state
  const [subjectMismatch, setSubjectMismatch] = useState<string | null>(null);

  // Current question bank ID from Supabase (if available)
  const [currentBankId, setCurrentBankId] = useState<string | null>(null);

  // Check backend health on mount
  useEffect(() => {
    checkBackendHealth().then(status => {
      setBackendStatus({
        checked: true,
        running: status.running,
        geminiConfigured: status.geminiConfigured,
        geminiAuthenticated: status.geminiAuthenticated,
        geminiModelAvailable: status.geminiModelAvailable,
        geminiStatus: status.geminiStatus,
        geminiMessage: status.geminiMessage
      });
    });
  }, []);

  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());
  const [filterUnit, setFilterUnit] = useState<string>('all');
  const [filterPart, setFilterPart] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Inline Editing & Side-by-Side Modal State
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [inlineEditText, setInlineEditText] = useState('');
  const [sideBySideQuestion, setSideBySideQuestion] = useState<OcrExtractedQuestion | null>(null);

  // Sample Loader
  const [selectedSampleId, setSelectedSampleId] = useState<string>('');

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Only PDF files are supported. Please upload a .pdf question bank.');
      return;
    }
    setSelectedFile(file);
    const sizeStr = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
    setFileInfo({
      name: file.name,
      size: sizeStr,
      pages: 1, // Will be updated during extraction
      status: 'Ready for extraction'
    });
  };

  // Run Gemini Extraction Pipeline
  const handleRunOcrExtraction = async () => {
    if (!selectedAcademicYear) {
      showToast('Please select an Academic Year.');
      return;
    }
    if (!selectedDepartment) {
      showToast('Please select a Department.');
      return;
    }
    if (!currentSubject?.code) {
      showToast('Please select a Subject.');
      return;
    }
    if (!selectedFile) {
      showToast('Please select a Question Bank PDF file first.');
      return;
    }

    setIsProcessing(true);
    setSubjectMismatch(null);
    setCurrentBankId(null);
    setProgressState({
      stage: 'loading',
      message: 'Uploading question bank to extraction server...',
      percent: 5
    });

    try {
      const result = await extractQuestionBank(
        selectedFile,
        currentSubject.code,
        currentUser.name,
        (stage, percent) => {
          setProgressState({
            stage: 'loading',
            message: stage,
            percent
          });
        },
        selectedAcademicYear,
        selectedDepartment
      );

      // Selected UI values are the source of truth for the curriculum
      const metadata: OcrDocumentMetadata = {
        subjectName: currentSubject.name,
        subjectCode: currentSubject.code,
        department: selectedDepartment as any,
        regulation: result.metadata.regulation || currentSubject.regulation || 'Regulation 2024',
        semester: currentSubject.semester || result.metadata.semester,
        totalUnitsDetected: result.metadata.totalUnitsDetected || 5,
        totalPages: result.metadata.totalPages || 1,
        fileName: selectedFile.name,
        fileSize: (selectedFile.size / (1024 * 1024)).toFixed(2) + ' MB',
        isScannedImageOnly: result.metadata.isScannedImageOnly || false,
        questionBankId: result.questionBankId || undefined
      };

      setExtractedMetadata(metadata);
      setExtractedQuestions(result.questions as OcrExtractedQuestion[]);
      setPageImages({});
      setErrorPages([]);

      if (result.questionBankId) {
        setCurrentBankId(result.questionBankId);
      }

      // Check for subject mismatch — use backend-derived mismatch data for accuracy
      if (result.metadata.isSubjectMismatch && result.metadata.documentSubjectCode) {
        setSubjectMismatch(
          `Selected Subject: ${result.metadata.selectedSubjectCode || currentSubject.code}\n` +
          `Document Subject: ${result.metadata.documentSubjectCode}\n` +
          `Document Name: ${result.metadata.documentSubjectName || result.metadata.subjectName}\n\n` +
          `Questions have been stored under the document-derived subject "${result.metadata.documentSubjectCode}". ` +
          `Please confirm this is correct before approving.`
        );
      } else if (
        !result.metadata.isSubjectMismatch &&
        result.metadata.documentSubjectCode &&
        result.metadata.documentSubjectCode.trim().toUpperCase() !== currentSubject.code.toUpperCase()
      ) {
        // Fallback: local mismatch detection
        setSubjectMismatch(
          `Document subject "${result.metadata.documentSubjectCode}" differs from selected "${currentSubject.code}". Please verify.`
        );
      }

      // Pre-select approved items
      const initialSelected = new Set(
        result.questions
          .filter((q: any) => q.status === 'Approved')
          .map((q: any) => q.id)
      );
      setSelectedQuestionIds(initialSelected);

      setFileInfo(prev => prev ? {
        ...prev,
        pages: metadata.totalPages,
        status: `Extracted ${result.questions.length} questions with Gemini AI`
      } : null);

      setProgressState({ stage: 'complete', message: 'Extraction complete!', percent: 100 });

      showToast(`Gemini extracted ${result.questions.length} questions from "${selectedFile.name}"!`);
    } catch (err: any) {
      console.warn('Gemini extraction failed, attempting fallback to local OCR engine:', err);
      const errMsg = String(err?.message || err || '');
      const isAuthOrConfig =
        errMsg.includes('GEMINI_API_KEY') ||
        errMsg.includes('authentication') ||
        errMsg.includes('API key') ||
        errMsg.includes('400') ||
        errMsg.includes('401') ||
        errMsg.includes('403') ||
        errMsg.includes('Cannot reach the extraction server');

      if (isAuthOrConfig) {
        try {
          showToast('Gemini API key is not ready. Running local OCR extraction engine...');
          setProgressState({
            stage: 'loading',
            message: 'Running built-in local OCR engine (no API key needed)...',
            percent: 15
          });

          const localSubjects = dbSubjects.length > 0
            ? dbSubjects.map(s => ({
                code: s.subject_code,
                name: s.subject_name,
                department: (s.departments?.department_code as any) || ''
              }))
            : subjects.map(s => ({ code: s.code, name: s.name, department: s.department }));

          const localResult = await processQuestionBankOcr(
            selectedFile,
            localSubjects,
            existingQuestions,
            progress => setProgressState(progress)
          );

          setExtractedMetadata(localResult.metadata);
          setExtractedQuestions(localResult.questions);
          setPageImages(localResult.pageImages);
          setErrorPages(localResult.errorPages);

          const initialSelected = new Set(
            localResult.questions
              .filter(q => q.status === 'Approved')
              .map(q => q.id)
          );
          setSelectedQuestionIds(initialSelected);

          setFileInfo(prev =>
            prev
              ? {
                  ...prev,
                  pages: localResult.metadata.totalPages,
                  status: `Extracted ${localResult.questions.length} questions using local OCR`
                }
              : null
          );

          setProgressState({ stage: 'complete', message: 'Local OCR extraction complete!', percent: 100 });
          showToast(`Successfully extracted ${localResult.questions.length} questions via local OCR.`);
          return;
        } catch (localErr: any) {
          console.error('Local OCR fallback error:', localErr);
        }
      }

      setProgressState({ stage: 'error', message: err?.message || 'Extraction failed', percent: 0 });
      showToast(`Extraction failed: ${err?.message || 'Check that the backend server is running (npm run server)'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 1-Click Load Sample Question Bank
  const handleLoadSample = async (sampleId: string) => {
    const sample = SAMPLE_OCR_BANKS.find(s => s.id === sampleId);
    if (!sample) return;

    // Create a virtual text/pdf file object
    const blob = new Blob([sample.rawText], { type: 'text/plain' });
    const file = new File([blob], sample.fileName, { type: 'text/plain' });

    setSelectedFile(file);
    setSelectedSubjectCode(sample.subjectCode);
    setFileInfo({
      name: sample.fileName,
      size: (blob.size / 1024).toFixed(1) + ' KB',
      pages: 8,
      status: 'Ready for extraction'
    });

    // Run extraction automatically for seamless demo
    setIsProcessing(true);
    setProgressState({
      stage: 'loading',
      message: `Loading accredited OBE sample bank for ${sample.subjectCode}...`,
      percent: 15
    });

    try {
      const result = await processQuestionBankOcr(
        file,
        // Pass subjects list: prefer DB subjects, fall back to local for OCR context
        (dbSubjects.length > 0 ? dbSubjects.map(s => ({ code: s.subject_code, name: s.subject_name, department: s.departments?.department_code || '' })) : subjects.map(s => ({ code: s.code, name: s.name, department: s.department }))),
        existingQuestions,
        progress => setProgressState(progress)
      );

      setExtractedMetadata(result.metadata);
      setExtractedQuestions(result.questions);
      setPageImages(result.pageImages);
      setErrorPages(result.errorPages);

      const initialSelected = new Set(
        result.questions.filter(q => q.status === 'Approved').map(q => q.id)
      );
      setSelectedQuestionIds(initialSelected);

      showToast(`Loaded 5-unit accredited question bank for ${sample.subjectCode}!`);
    } catch (err) {
      console.error('Failed to load sample:', err);
      showToast('Error parsing sample question bank.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Row Actions: Approve, Delete, Edit
  const handleApproveSingle = (id: string) => {
    setExtractedQuestions(prev =>
      prev.map(q => (q.id === id ? { ...q, status: 'Approved' } : q))
    );
    setSelectedQuestionIds(prev => new Set([...prev, id]));
    showToast('Question marked as Approved.');
  };

  const handleDeleteSingle = (id: string) => {
    setExtractedQuestions(prev => prev.filter(q => q.id !== id));
    setSelectedQuestionIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (sideBySideQuestion?.id === id) {
      setSideBySideQuestion(null);
    }
    showToast('Question removed from extraction batch.');
  };

  const handleSaveInlineEdit = (id: string) => {
    if (!inlineEditText.trim()) return;
    setExtractedQuestions(prev =>
      prev.map(q =>
        q.id === id
          ? { ...q, questionText: inlineEditText.trim(), isEdited: true, status: 'Approved' }
          : q
      )
    );
    setInlineEditingId(null);
    showToast('Question text updated.');
  };

  // Section 17: Teacher options for Duplicates (Keep, Merge, Delete)
  const handleKeepDuplicate = (id: string) => {
    setExtractedQuestions(prev =>
      prev.map(q =>
        q.id === id
          ? {
              ...q,
              status: 'Approved',
              duplicateText: undefined,
              duplicateSimilarity: undefined
            }
          : q
      )
    );
    showToast('Duplicate question retained as Approved.');
  };

  const handleMergeDuplicate = (id: string) => {
    setExtractedQuestions(prev =>
      prev.map(q => {
        if (q.id !== id) return q;
        const mergedNotes = q.duplicateText ? ` [Variant: ${q.duplicateText}]` : '';
        return {
          ...q,
          questionText: `${q.questionText}${mergedNotes}`,
          status: 'Approved',
          duplicateText: undefined,
          duplicateSimilarity: undefined,
          isEdited: true
        };
      })
    );
    showToast('Question merged with duplicate variant and approved.');
  };

  const handleDeleteDuplicate = (id: string) => {
    setExtractedQuestions(prev => prev.filter(q => q.id !== id));
    setSelectedQuestionIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    showToast('Duplicate question deleted.');
  };

  const handleSkipErrorPages = () => {
    setErrorPages([]);
    showToast('Skipped problematic pages.');
  };

  // Bulk Actions
  const handleSelectAll = () => {
    if (selectedQuestionIds.size === filteredQuestions.length) {
      setSelectedQuestionIds(new Set());
    } else {
      setSelectedQuestionIds(new Set(filteredQuestions.map(q => q.id)));
    }
  };

  const handleBulkApprove = () => {
    const lowConfidenceSelected = extractedQuestions.filter(
      q => selectedQuestionIds.has(q.id) && q.ocrConfidence < 70
    );

    if (lowConfidenceSelected.length > 0) {
      const proceed = window.confirm(
        `${lowConfidenceSelected.length} selected questions have low OCR confidence (<70%). We recommend reviewing them side-by-side first. Do you still want to approve them?`
      );
      if (!proceed) return;
    }

    setExtractedQuestions(prev =>
      prev.map(q => (selectedQuestionIds.has(q.id) ? { ...q, status: 'Approved' } : q))
    );
    showToast(`Approved ${selectedQuestionIds.size} selected questions.`);
  };

  const handleBulkReject = () => {
    setExtractedQuestions(prev =>
      prev.map(q => (selectedQuestionIds.has(q.id) ? { ...q, status: 'Rejected' } : q))
    );
    showToast(`Marked ${selectedQuestionIds.size} selected questions as Rejected.`);
  };

  // Save Approved Questions to App Database (AppContext & Supabase)
  const handleCommitToDatabase = async () => {
    const approvedToCommit = extractedQuestions.filter(
      q => q.status === 'Approved' && selectedQuestionIds.has(q.id)
    );

    if (approvedToCommit.length === 0) {
      showToast('Please approve and select at least one question to add.');
      return;
    }

    // Convert OcrExtractedQuestion to Question format for AppContext
    const dbFormattedQuestions = approvedToCommit.map(q => {
      const unitNum = typeof q.unit === 'number' ? q.unit : 1;
      const partType: QuestionPart =
        q.part === 'A' ? 'Part A' : q.part === 'C' ? 'Part C' : 'Part B';
      const marksVal = q.marks ?? (partType === 'Part A' ? 2 : partType === 'Part C' ? 15 : 13);
      const bloomsVal: BloomsLevel = q.bl || 'K2';

      return {
        subjectCode: currentSubject.code,
        academicYear: selectedAcademicYear,
        department: selectedDepartment as any,
        scope: selectedDepartment === 'COMMON' ? 'COMMON' : 'SPECIFIC',
        departmentScope: selectedDepartment === 'COMMON' ? 'COMMON' : 'SPECIFIC',
        commonDepartments: selectedDepartment === 'COMMON' ? commonDepts : undefined,
        departmentIds: selectedDepartment === 'COMMON' ? commonDepts : [selectedDepartment],
        unit: unitNum,
        topic: q.topic || `Unit ${unitNum} Concept`,
        part: partType,
        marks: marksVal,
        questionText: q.questionText,
        bloomsLevel: bloomsVal,
        co: q.co || `CO${unitNum}`,
        pi: q.pi || `${unitNum}.1.1`,
        difficulty: q.difficulty,
        allowedFor: {
          internal1: unitNum <= 3,
          internal2: unitNum >= 3,
          endSem: true
        },
        status: 'Approved' as const,
        createdBy: currentUser.name || 'Exam Cell OCR Engine',
        questionNumber: q.questionNumber,
        orGroupId: q.orGroupId,
        orOption: q.orOption,
        subQuestions: q.subQuestions,
        ocrConfidence: q.ocrConfidence,
        sourceDocument: q.sourceDocument,
        sourcePage: q.sourcePage,
        updatedAt: new Date().toISOString()
      };
    });

    // Primary: Save to AppContext (local state)
    addQuestions(dbFormattedQuestions);

    // Secondary: Save to Supabase via backend (if bank ID available, non-fatal)
    if (currentBankId) {
      try {
        const saveResult = await approveQuestionBank(
          currentBankId,
          currentSubject.code,
          approvedToCommit
        );
        if (saveResult.success) {
          console.log(`[QuestionBank] Saved ${saveResult.savedCount} questions to Supabase.`);
        }
      } catch (err) {
        // Non-fatal: local save already succeeded
        console.warn('[QuestionBank] Supabase save skipped:', err);
      }
    }

    showToast(
      `Successfully added ${approvedToCommit.length} questions into ${currentSubject.code} Question Bank!`
    );

    // Navigate to Question Bank view
    setActiveTab('question-bank');
  };

  // Filtered Questions for Table
  const filteredQuestions = useMemo(() => {
    return extractedQuestions.filter(q => {
      if (filterUnit !== 'all') {
        if (filterUnit === 'Unknown' && q.unit !== 'Unknown') return false;
        if (filterUnit !== 'Unknown' && q.unit !== Number(filterUnit)) return false;
      }
      if (filterPart !== 'all' && q.part !== filterPart) return false;
      if (filterStatus !== 'all' && q.status !== filterStatus) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const textMatch = q.questionText.toLowerCase().includes(query);
        const topicMatch = q.topic.toLowerCase().includes(query);
        const numMatch = q.questionNumber?.toLowerCase().includes(query);
        if (!textMatch && !topicMatch && !numMatch) return false;
      }
      return true;
    });
  }, [extractedQuestions, filterUnit, filterPart, filterStatus, searchQuery]);

  // Statistics Summary Counts
  const totalCount = extractedQuestions.length;
  const partACount = extractedQuestions.filter(q => q.part === 'A').length;
  const partBCount = extractedQuestions.filter(q => q.part === 'B').length;
  const partCCount = extractedQuestions.filter(q => q.part === 'C').length;
  const needsReviewCount = extractedQuestions.filter(q => q.status === 'Needs Review').length;
  const lowConfidenceCount = extractedQuestions.filter(q => q.status === 'Low Confidence').length;
  const duplicateCount = extractedQuestions.filter(q => q.status === 'Possible Duplicate').length;
  const approvedCount = extractedQuestions.filter(q => q.status === 'Approved').length;

  return (
    <div className="space-y-6 pb-16">
      {/* Page Title & Badges */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#D71945]">
              Gemini AI Engine
            </span>
            <span className="rounded-md bg-rose-100 px-2 py-0.5 text-xs font-bold text-[#D71945]">
              OBE Calibrated
            </span>
            <span className="rounded-md bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-700 flex items-center gap-1">
              <Zap className="h-2.5 w-2.5" />
              gemini-2.0-flash
            </span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            Import Question Bank
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Select curriculum parameters and upload a 5-unit question bank PDF. Gemini AI reads the document natively and extracts structured questions with Bloom's taxonomy, CO, PI mappings, and OR groupings.
          </p>
        </div>
      </div>

      {/* Backend Status Banner — shown when backend is not running */}
      {backendStatus.checked && !backendStatus.running && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <WifiOff className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-black text-amber-900">Backend Server Not Running</p>
            <p className="text-xs text-amber-800 mt-0.5">
              The Gemini extraction backend is not reachable. Start it in a separate terminal:
            </p>
            <code className="inline-block mt-1.5 rounded-lg bg-amber-100 border border-amber-300 px-3 py-1 text-xs font-mono text-amber-900 font-bold">
              npm run server
            </code>
            <p className="text-[11px] text-amber-700 mt-1">
              The backend runs on port 4000 and handles all Gemini API calls server-side.
            </p>
          </div>
        </div>
      )}

      {backendStatus.checked && backendStatus.running && !backendStatus.geminiConfigured && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-black text-rose-900">Gemini Backend Configuration Error</p>
            <p className="text-xs text-rose-800 mt-0.5">
              {backendStatus.geminiMessage || 'The backend is running but GEMINI_API_KEY is not correctly configured.'} Set a valid server-side <code className="font-mono bg-rose-100 px-1 rounded">GEMINI_API_KEY</code> in the backend environment and restart or redeploy the backend.
            </p>
          </div>
        </div>
      )}

      {backendStatus.checked && backendStatus.running && backendStatus.geminiConfigured && !backendStatus.geminiModelAvailable && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-black text-rose-900">
              Gemini Unavailable ({backendStatus.geminiStatus || 'unknown'})
            </p>
            <p className="text-xs text-rose-800 mt-0.5">
              {geminiStatusMessage(backendStatus.geminiStatus) || backendStatus.geminiMessage || 'Gemini extraction is not ready on the server.'}
            </p>
          </div>
        </div>
      )}

      {backendStatus.checked && backendStatus.running && backendStatus.geminiConfigured && backendStatus.geminiModelAvailable && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2">
          <Wifi className="h-4 w-4 text-emerald-600 shrink-0" />
          <p className="text-xs font-bold text-emerald-800">
            Gemini AI extraction server is running, authenticated and ready.
          </p>
        </div>
      )}

      {/* Subject Mismatch Warning */}
      {subjectMismatch && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs font-black text-amber-900">⚠️ Subject Code Mismatch Detected</p>
            <p className="text-xs text-amber-800 mt-1 whitespace-pre-line">{subjectMismatch}</p>
          </div>
          <button type="button" onClick={() => setSubjectMismatch(null)} className="text-amber-500 hover:text-amber-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* REQUIRED SCOPE SELECTION (Academic Year -> Department -> Subject) */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="h-4 w-4 text-[#D71945]" />
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900">
            1. Target Curriculum Scope
          </h2>
          <span className="text-xs text-slate-400 font-medium">
            (Select in order before uploading)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 1. Academic Year */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-[#D71945] text-[11px] font-black">1</span>
              Academic Year <span className="text-rose-600">*</span>
            </label>
            <select
              id="qb-academic-year-select"
              value={selectedAcademicYearId}
              onChange={(e) => setSelectedAcademicYearId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-900 shadow-xs focus:border-[#D71945] focus:outline-hidden"
            >
              {activeAcademicYearsList.length === 0 ? (
                <option value="">Loading academic years...</option>
              ) : (
                activeAcademicYearsList.map(yr => (
                  <option key={yr.id} value={yr.id}>
                    {yr.year_label}
                  </option>
                ))
              )}
            </select>
            {!selectedAcademicYear && (
              <p className="text-[11px] text-rose-600 mt-1">Academic year is required</p>
            )}
          </div>

          {/* 2. Department */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-[#D71945] text-[11px] font-black">2</span>
              Department <span className="text-rose-600">*</span>
            </label>
            <select
              id="qb-department-select"
              value={selectedDepartmentId}
              onChange={(e) => setSelectedDepartmentId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-900 shadow-xs focus:border-[#D71945] focus:outline-hidden"
            >
              {activeDepartmentsList.map(dept => (
                <option key={dept.id} value={dept.id}>
                  {dept.department_code} – {dept.department_name}
                </option>
              ))}
              <option value="COMMON">COMMON – Common Questions</option>
            </select>
            {!selectedDepartment && (
              <p className="text-[11px] text-rose-600 mt-1">Department is required</p>
            )}
          </div>

          {/* 3. Subject (Filtered by Dept) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-[#D71945] text-[11px] font-black">3</span>
              Subject <span className="text-rose-600">*</span>
            </label>
            <select
              id="qb-subject-select"
              value={selectedSubjectCode}
              onChange={(e) => setSelectedSubjectCode(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-900 shadow-xs focus:border-[#D71945] focus:outline-hidden"
            >
              {filteredSubjects.length === 0 ? (
                <option value="">
                  {selectedAcademicYearId && selectedDepartmentId
                    ? 'No subjects available for the selected academic year and department.'
                    : 'Select academic year and department first'}
                </option>
              ) : (
                filteredSubjects.map(s => (
                  <option key={s.id} value={s.subject_code}>
                    {s.subject_code} – {s.subject_name}
                  </option>
                ))
              )}
            </select>
            {!currentSubject && (
              <p className="text-[11px] text-rose-600 mt-1">Subject is required</p>
            )}
          </div>
        </div>

        {selectedDepartment === 'COMMON' && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-[#FFF8F9] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase text-[#D71945]">Common Curriculum</span>
                <p className="text-xs font-bold text-slate-800">Select departments this common question bank applies to:</p>
              </div>
              <span className="text-xs font-extrabold text-[#D71945]">{commonDepts.length} selected</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {activeDepartmentsList.map(d => {
                const isChecked = commonDepts.includes(d.department_code);
                return (
                  <label
                    key={d.id}
                    className={`flex items-center gap-2 rounded-xl border p-2 text-xs font-bold cursor-pointer transition-all ${
                      isChecked ? 'border-[#D71945] bg-white text-[#D71945]' : 'border-slate-200 bg-white/60 text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        setCommonDepts(prev =>
                          prev.includes(d.department_code) ? prev.filter(c => c !== d.department_code) : [...prev, d.department_code]
                        );
                      }}
                      className="h-3.5 w-3.5 rounded text-[#D71945] focus:ring-[#D71945]"
                    />
                    <span>{d.department_code}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* SECTION 1: TEACHER UPLOAD AREA */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Upload Dropzone (PDF Only) */}
        <div className="lg:col-span-2 space-y-4">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 sm:p-10 text-center transition-all ${
              dragOver
                ? 'border-[#D71945] bg-rose-50/50 scale-[1.01]'
                : 'border-slate-300 bg-white hover:border-[#D71945]/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              className="hidden"
              id="qb-file-input"
            />

            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-[#D71945] shadow-sm mb-4">
              <UploadCloud className="h-8 w-8" />
            </div>

            <h3 className="text-base sm:text-lg font-black text-slate-900">
              Upload Question Bank PDF
            </h3>
            <p className="mt-1 text-xs text-slate-500 max-w-md">
              Drag and drop your 5-unit Question Bank PDF here, or click to browse.
            </p>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px] font-semibold text-slate-400">
              <span className="rounded-md bg-rose-100 px-2.5 py-1 text-xs font-extrabold text-[#D71945]">
                PDF Only
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-600 font-bold">
                Target: {currentSubject ? `${currentSubject.code} (${selectedDepartment})` : 'Select Subject'}
              </span>
            </div>

            {/* Inline validation messages */}
            {(!selectedAcademicYear || !selectedDepartment || !currentSubject) && (
              <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2 text-xs font-semibold text-amber-800">
                Please complete Academic Year, Department, and Subject selection above.
              </div>
            )}

            {!selectedFile && selectedAcademicYear && selectedDepartment && currentSubject && (
              <p className="mt-4 text-xs font-semibold text-slate-400">
                Please choose a PDF file to begin extraction
              </p>
            )}

            {/* Primary Action Buttons */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-50 transition-all cursor-pointer"
              >
                Choose PDF File...
              </button>

              <button
                type="button"
                disabled={!selectedFile || !selectedAcademicYear || !selectedDepartment || !currentSubject?.code || isProcessing}
                onClick={handleRunOcrExtraction}
                className="flex items-center gap-2 rounded-xl bg-[#D71945] px-6 py-2.5 text-xs font-extrabold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#b01438] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ScanLine className="h-4 w-4" />
                <span>{isProcessing ? 'Processing OCR...' : 'Upload & Extract'}</span>
              </button>
            </div>
          </div>

          {/* File Card & Status Display */}
          {fileInfo && (
            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1976D2]/10 text-[#1976D2]">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-900">{fileInfo.name}</h4>
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-500">
                    <span>{fileInfo.size}</span>
                    <span>•</span>
                    <span>{fileInfo.pages} {fileInfo.pages === 1 ? 'Page' : 'Pages'}</span>
                    <span>•</span>
                    <span className="font-semibold text-emerald-700">{fileInfo.status}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  setFileInfo(null);
                }}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors cursor-pointer"
                title="Clear selected file"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Accredited Sample Banks Loader (For Instant Testing) */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-black text-slate-900">
                1-Click Sample Question Banks
              </h3>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Don't have a 5-unit PDF on hand? Test the OCR extraction pipeline instantly with an accredited Anna University OBE question bank template.
            </p>

            <div className="mt-4 space-y-2.5">
              {SAMPLE_OCR_BANKS.map(sample => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => handleLoadSample(sample.id)}
                  disabled={isProcessing}
                  className="w-full text-left rounded-2xl border border-slate-200 bg-slate-50/70 p-3 hover:bg-rose-50/50 hover:border-rose-300 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 group-hover:text-[#D71945]">
                      {sample.title}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#D71945] group-hover:translate-x-0.5 transition-all" />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                    {sample.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span>Simulates optical character recognition on scanned PDFs</span>
          </div>
        </div>

      </div>

      {/* SECTION 18 & 19: PROCESSING CHECKLIST & PROGRESS */}
      {isProcessing && (
        <div className="rounded-3xl border border-[#1976D2]/20 bg-blue-50/50 p-6 sm:p-8 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-3 w-3 animate-ping rounded-full bg-[#1976D2]" />
              <h3 className="text-base font-black text-slate-900">
                Importing Question Bank...
              </h3>
            </div>
            <span className="text-xs font-bold font-mono text-[#1976D2]">
              {progressState.percent}%
            </span>
          </div>

          {/* Progress Bar */}
          <div className="h-2 w-full rounded-full bg-blue-100 overflow-hidden mb-6">
            <div
              className="h-full bg-gradient-to-r from-[#1976D2] to-[#D71945] transition-all duration-300 rounded-full"
              style={{ width: `${progressState.percent}%` }}
            />
          </div>

          {/* Dynamic Processing Checklist — Gemini Stages */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-700">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>PDF uploaded</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <CheckCircle2 className={`h-4 w-4 ${progressState.percent >= 20 ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span>Sent to Gemini</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <CheckCircle2 className={`h-4 w-4 ${progressState.percent >= 40 ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span>Document understood</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <CheckCircle2 className={`h-4 w-4 ${progressState.percent >= 60 ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span>Units detected</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <CheckCircle2 className={`h-4 w-4 ${progressState.percent >= 70 ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span>Questions extracted</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <CheckCircle2 className={`h-4 w-4 ${progressState.percent >= 80 ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span>Metadata detected</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <CheckCircle2 className={`h-4 w-4 ${progressState.percent >= 88 ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span>BL/CO/PI mapped</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <CheckCircle2 className={`h-4 w-4 ${progressState.percent >= 95 ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span>Review ready</span>
            </div>
          </div>
          <p className="mt-4 text-xs font-semibold text-[#1976D2] italic">
            {progressState.message}
          </p>
        </div>
      )}

      {/* ERROR / WARNING BANNERS (Section 19) */}
      {errorPages.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold">
                Page {errorPages.join(', ')} could not be read cleanly.
              </strong>
              <p className="mt-0.5 text-rose-700">
                Low-quality scan detected. Some questions may require manual verification.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRunOcrExtraction}
              className="rounded-xl bg-white border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-100 cursor-pointer shadow-xs"
            >
              Retry OCR
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl bg-rose-100 border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-900 hover:bg-rose-200 cursor-pointer shadow-xs"
            >
              Upload Image
            </button>
            <button
              type="button"
              onClick={handleSkipErrorPages}
              className="rounded-xl bg-white border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer shadow-xs"
            >
              Skip Page
            </button>
          </div>
        </div>
      )}

      {/* SECTION 18: SUMMARY BREAKDOWN BANNER */}
      {extractedQuestions.length > 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-4 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-slate-900">
                  {totalCount} Questions Extracted
                </span>
                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-extrabold text-emerald-800">
                  {approvedCount} Approved
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {extractedMetadata?.subjectName} ({extractedMetadata?.subjectCode}) • {extractedMetadata?.regulation} • {extractedMetadata?.totalPages} Pages Analyzed
              </p>
            </div>

            {/* Primary Action to Database */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCommitToDatabase}
                className="flex items-center gap-2 rounded-xl bg-[#D71945] px-6 py-2.5 text-xs font-black text-white shadow-md shadow-[#D71945]/30 hover:bg-[#b01438] active:scale-[0.98] transition-all cursor-pointer"
              >
                <Database className="h-4 w-4" />
                <span>Add to Question Bank ({selectedQuestionIds.size})</span>
              </button>
            </div>
          </div>

          {/* Metric Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-center">
              <div className="text-xl font-black text-slate-900">{partACount}</div>
              <div className="text-[11px] font-bold text-slate-500">Part A (2M)</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-center">
              <div className="text-xl font-black text-slate-900">{partBCount}</div>
              <div className="text-[11px] font-bold text-slate-500">Part B (13M)</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-center">
              <div className="text-xl font-black text-slate-900">{partCCount}</div>
              <div className="text-[11px] font-bold text-slate-500">Part C (15M)</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-center">
              <div className="text-xl font-black text-amber-800">{needsReviewCount}</div>
              <div className="text-[11px] font-bold text-amber-700">Needs Review</div>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-3 text-center">
              <div className="text-xl font-black text-rose-800">{duplicateCount}</div>
              <div className="text-[11px] font-bold text-rose-700">Duplicates</div>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 text-center">
              <div className="text-xl font-black text-emerald-800">{approvedCount}</div>
              <div className="text-[11px] font-bold text-emerald-700">Approved</div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 12 & 14: TEACHER VERIFICATION TABLE */}
      {extractedQuestions.length > 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          
          {/* Table Toolbar: Filter Controls & Bulk Operations */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200 bg-slate-50/50 p-4 sm:p-5">
            
            {/* Filter Dropdowns */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-slate-500 flex items-center gap-1 mr-1">
                <Filter className="h-3.5 w-3.5" /> Filters:
              </span>

              <select
                value={filterUnit}
                onChange={(e) => setFilterUnit(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-800 focus:border-[#D71945] focus:outline-hidden"
              >
                <option value="all">All Units (I - V)</option>
                <option value="1">Unit I</option>
                <option value="2">Unit II</option>
                <option value="3">Unit III</option>
                <option value="4">Unit IV</option>
                <option value="5">Unit V</option>
                <option value="Unknown">Unit Unknown</option>
              </select>

              <select
                value={filterPart}
                onChange={(e) => setFilterPart(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-800 focus:border-[#D71945] focus:outline-hidden"
              >
                <option value="all">All Parts (A, B, C)</option>
                <option value="A">Part A (2 Marks)</option>
                <option value="B">Part B (13 Marks)</option>
                <option value="C">Part C (15 Marks)</option>
              </select>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-800 focus:border-[#D71945] focus:outline-hidden"
              >
                <option value="all">All Statuses</option>
                <option value="Approved">Approved</option>
                <option value="Needs Review">Needs Review (&lt;85%)</option>
                <option value="Low Confidence">Low Confidence (&lt;70%)</option>
                <option value="Possible Duplicate">Possible Duplicate</option>
              </select>

              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search extracted text..."
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#D71945] focus:outline-hidden"
              />
            </div>

            {/* Bulk Action Buttons (Section 14) */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAll}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                {selectedQuestionIds.size === filteredQuestions.length ? 'Deselect All' : 'Select All'}
              </button>

              <button
                type="button"
                disabled={selectedQuestionIds.size === 0}
                onClick={handleBulkApprove}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Approve Selected ({selectedQuestionIds.size})</span>
              </button>

              <button
                type="button"
                disabled={selectedQuestionIds.size === 0}
                onClick={handleBulkReject}
                className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
                <span>Reject Selected</span>
              </button>
            </div>
          </div>

          {/* Extracted Questions Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/70 font-extrabold uppercase tracking-wider text-slate-600">
                  <th className="p-3.5 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={
                        filteredQuestions.length > 0 &&
                        filteredQuestions.every(q => selectedQuestionIds.has(q.id))
                      }
                      onChange={handleSelectAll}
                      className="rounded-sm text-[#D71945] focus:ring-[#D71945]"
                    />
                  </th>
                  <th className="p-3.5 w-14">No</th>
                  <th className="p-3.5 min-w-[320px]">Question Statement</th>
                  <th className="p-3.5 w-20">Unit</th>
                  <th className="p-3.5 w-16">Part</th>
                  <th className="p-3.5 w-16">Marks</th>
                  <th className="p-3.5 w-14">BL</th>
                  <th className="p-3.5 w-16">CO</th>
                  <th className="p-3.5 w-28">Status</th>
                  <th className="p-3.5 w-40 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
                {filteredQuestions.map((q, idx) => {
                  const isSelected = selectedQuestionIds.has(q.id);
                  const isEditingInline = inlineEditingId === q.id;

                  return (
                    <tr
                      key={q.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        isSelected ? 'bg-rose-50/20' : ''
                      }`}
                    >
                      {/* Select Checkbox */}
                      <td className="p-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setSelectedQuestionIds(prev => {
                              const next = new Set(prev);
                              if (next.has(q.id)) next.delete(q.id);
                              else next.add(q.id);
                              return next;
                            });
                          }}
                          className="rounded-sm text-[#D71945] focus:ring-[#D71945]"
                        />
                      </td>

                      {/* Question Number & OR tag */}
                      <td className="p-3.5 font-bold text-slate-700">
                        <div>Q{q.questionNumber || idx + 1}</div>
                        {q.orGroupId && (
                          <span className="inline-block rounded-xs bg-purple-100 text-purple-800 px-1 py-0.2 text-[9px] font-black">
                            {q.orGroupId} ({q.orOption || 'OR'})
                          </span>
                        )}
                      </td>

                      {/* Question Text (with Inline Edit & Highlight) */}
                      <td className="p-3.5">
                        {isEditingInline ? (
                          <div className="flex items-center gap-2">
                            <textarea
                              rows={2}
                              value={inlineEditText}
                              onChange={(e) => setInlineEditText(e.target.value)}
                              className="w-full rounded-xl border border-slate-300 p-2 text-xs font-medium text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveInlineEdit(q.id)}
                              className="rounded-lg bg-emerald-700 p-2 text-white hover:bg-emerald-800"
                              title="Save"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setInlineEditingId(null)}
                              className="rounded-lg bg-slate-200 p-2 text-slate-700 hover:bg-slate-300"
                              title="Cancel"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <div>
                            <p className="text-xs text-slate-900 leading-relaxed font-semibold">
                              {q.questionText}
                            </p>
                            
                            {/* Sub questions if any */}
                            {q.subQuestions && q.subQuestions.length > 0 && (
                              <ul className="mt-1 pl-3 text-[11px] text-slate-600 list-disc space-y-0.5">
                                {q.subQuestions.map((sq, i) => (
                                  <li key={i}>{sq}</li>
                                ))}
                              </ul>
                            )}

                            {/* Duplicate Warning & Teacher Options (Keep, Merge, Delete) */}
                            {q.status === 'Possible Duplicate' && q.duplicateText && (
                              <div className="mt-2 rounded-xl bg-amber-50 p-2.5 text-[11px] text-amber-900 border border-amber-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                <div className="flex items-start gap-1.5">
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                                  <div>
                                    <span className="font-bold">Possible Duplicate ({q.duplicateSimilarity}% match): </span>
                                    <span className="italic">"{q.duplicateText}"</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                                  <button
                                    type="button"
                                    onClick={() => handleKeepDuplicate(q.id)}
                                    className="rounded-lg bg-white border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-900 hover:bg-amber-100 transition-all cursor-pointer shadow-2xs"
                                    title="Keep as separate question"
                                  >
                                    Keep
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMergeDuplicate(q.id)}
                                    className="rounded-lg bg-amber-200/80 border border-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950 hover:bg-amber-300/80 transition-all cursor-pointer shadow-2xs"
                                    title="Merge variant note into question"
                                  >
                                    Merge
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteDuplicate(q.id)}
                                    className="rounded-lg bg-rose-100 border border-rose-300 px-2 py-0.5 text-[10px] font-bold text-rose-800 hover:bg-rose-200 transition-all cursor-pointer shadow-2xs"
                                    title="Delete duplicate question"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Questionable Text Warning */}
                            {q.status === 'Low Confidence' && q.questionableText && (
                              <div className="mt-1 text-[10px] text-rose-700 font-mono bg-rose-50 px-2 py-0.5 rounded-sm border border-rose-200 inline-block">
                                Uncertain characters: {q.questionableText}
                              </div>
                            )}

                            {/* Topic badge */}
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                              <span>Topic: {q.topic}</span>
                              <span>•</span>
                              <span>Source: Page {q.sourcePage}</span>
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Unit */}
                      <td className="p-3.5 font-bold">
                        <span className={`px-2 py-0.5 rounded-md text-[11px] ${
                          q.unit === 'Unknown'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-800'
                        }`}>
                          {q.unit === 'Unknown' ? 'Unknown' : `Unit ${q.unit}`}
                        </span>
                      </td>

                      {/* Part */}
                      <td className="p-3.5 font-bold">
                        <span className="px-2 py-0.5 rounded-md bg-blue-50 text-[#1976D2] text-[11px]">
                          Part {q.part}
                        </span>
                      </td>

                      {/* Marks */}
                      <td className="p-3.5 font-bold">
                        {q.marks !== null ? (
                          <span>{q.marks}M</span>
                        ) : (
                          <span className="text-amber-700 font-bold bg-amber-100 px-1.5 py-0.5 rounded-sm">
                            null
                          </span>
                        )}
                      </td>

                      {/* Bloom's Level */}
                      <td className="p-3.5">
                        <span className="rounded-md bg-purple-50 text-purple-700 px-1.5 py-0.5 font-extrabold">
                          {q.bl || 'K2'}
                        </span>
                      </td>

                      {/* CO */}
                      <td className="p-3.5 font-semibold text-slate-700">
                        {q.co || '-'}
                      </td>

                      {/* Status & Confidence Badge */}
                      <td className="p-3.5">
                        <div className="flex flex-col gap-1">
                          {q.status === 'Approved' && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 w-fit">
                              <Check className="h-3 w-3" /> Approved
                            </span>
                          )}
                          {q.status === 'Needs Review' && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 w-fit">
                              <AlertTriangle className="h-3 w-3" /> Needs Review
                            </span>
                          )}
                          {q.status === 'Low Confidence' && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 w-fit">
                              <AlertTriangle className="h-3 w-3" /> Low Conf.
                            </span>
                          )}
                          {q.status === 'Possible Duplicate' && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 border border-amber-300 w-fit">
                              Duplicate ({q.duplicateSimilarity}%)
                            </span>
                          )}
                          {q.status === 'Rejected' && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700 w-fit">
                              Rejected
                            </span>
                          )}

                          <span className="text-[10px] text-slate-400 font-mono">
                            OCR: {q.ocrConfidence}%
                          </span>
                        </div>
                      </td>

                      {/* Row Action Buttons: Side-by-Side Review, Inline Edit, Approve, Delete */}
                      <td className="p-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Side-by-Side Review Modal Button */}
                          <button
                            type="button"
                            onClick={() => setSideBySideQuestion(q)}
                            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100 hover:border-slate-300 cursor-pointer"
                            title="Side-by-Side OCR Review with original PDF"
                          >
                            <Eye className="h-3.5 w-3.5 text-[#1976D2]" />
                            <span>View Source</span>
                          </button>

                          {/* Inline Edit Toggle */}
                          <button
                            type="button"
                            onClick={() => {
                              setInlineEditingId(q.id);
                              setInlineEditText(q.questionText);
                            }}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
                            title="Inline Edit Question"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>

                          {/* Quick Approve */}
                          {q.status !== 'Approved' && (
                            <button
                              type="button"
                              onClick={() => handleApproveSingle(q.id)}
                              className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 cursor-pointer"
                              title="Approve Question"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {/* Delete */}
                          <button
                            type="button"
                            onClick={() => handleDeleteSingle(q.id)}
                            className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 cursor-pointer"
                            title="Delete Question"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Bottom Table Bar */}
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 p-4 text-xs font-semibold text-slate-600">
            <span>
              Showing {filteredQuestions.length} of {extractedQuestions.length} questions
            </span>
            <div className="flex items-center gap-2">
              <span>{selectedQuestionIds.size} questions selected for database insertion</span>
            </div>
          </div>

        </div>
      )}

      {/* SECTION 13: SIDE-BY-SIDE OCR REVIEW MODAL */}
      <SideBySideReviewModal
        isOpen={!!sideBySideQuestion}
        question={sideBySideQuestion}
        onClose={() => setSideBySideQuestion(null)}
        pageImageMap={pageImages}
        allQuestions={extractedQuestions}
        onSave={(updated) => {
          setExtractedQuestions(prev =>
            prev.map(q => (q.id === updated.id ? updated : q))
          );
          setSideBySideQuestion(updated);
          showToast('Updated question and saved verification.');
        }}
        onApprove={(id) => {
          handleApproveSingle(id);
          // Auto advance to next question
          const idx = extractedQuestions.findIndex(q => q.id === id);
          if (idx < extractedQuestions.length - 1) {
            setSideBySideQuestion(extractedQuestions[idx + 1]);
          } else {
            setSideBySideQuestion(null);
          }
        }}
        onDelete={(id) => {
          handleDeleteSingle(id);
        }}
        onNavigateQuestion={(direction) => {
          if (!sideBySideQuestion) return;
          const idx = extractedQuestions.findIndex(q => q.id === sideBySideQuestion.id);
          if (direction === 'prev' && idx > 0) {
            setSideBySideQuestion(extractedQuestions[idx - 1]);
          } else if (direction === 'next' && idx < extractedQuestions.length - 1) {
            setSideBySideQuestion(extractedQuestions[idx + 1]);
          }
        }}
      />
    </div>
  );
};
