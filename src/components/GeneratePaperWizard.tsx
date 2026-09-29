import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  RotateCw,
  ShieldCheck,
  FileCheck2,
  Check,
  AlertCircle,
  Tag,
  Send,
  Lock,
  Loader2,
  RefreshCw,
  Info,
  Database
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Department, DepartmentScope, ExamType, GeneratedPaper, PaperSetStatus } from '../types';
import { PaperPreview } from './PaperPreview';
import { AddQuestionBankModal } from './AddQuestionBankModal';
import {
  fetchPaperSetStatus,
  trackPaperSet,
  saveGeneratedPaperRecord,
  submitPaperRequest,
  fetchSubjectQuestionCounts
} from '../services/authApi';
import { computePatternTotals } from '../utils/examPatternMapper';
import { Question, QuestionBankSource } from '../types';
import {
  fetchIatGeneratedBanks,
  fetchIatBankPaperPool,
  markIatBankUsedForPaper,
  IatGeneratedBank
} from '../services/iatQuestionBankApi';

const SET_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Spec §19 / §30 — the Generated IAT Question Bank option exists ONLY for
 * Internal Assessment I and Internal Assessment II. An End Semester
 * Examination always falls back to the original question bank.
 */
const isIatExam = (t: ExamType) =>
  t === 'Internal Assessment I' || t === 'Internal Assessment II';

/**
 * Converts a reduced IAT bank into the local `Question` shape used by the
 * paper engine. `id` is the ORIGINAL `questions.id`, so usage is recorded
 * against the original question (Spec §12, §17, §29).
 */
function iatPoolToQuestions(
  pool: Awaited<ReturnType<typeof fetchIatBankPaperPool>>,
  subjectCode: string
): Question[] {
  return pool.questions.map((q, idx) => ({
    id: q.sourceQuestionId,
    sourceQuestionId: q.sourceQuestionId,
    subjectCode: q.subjectCode || subjectCode,
    unit: typeof q.unit === 'number' && q.unit >= 1 && q.unit <= 5 ? (q.unit as any) : (1 as any),
    topic: '',
    part: q.originalPart,
    marks: q.marks ?? (q.originalPart === 'Part A' ? 2 : q.originalPart === 'Part C' ? 15 : 13),
    questionText: q.questionText,
    bloomsLevel: (q.bloomsLevel || q.btl || 'K2') as any,
    bl: (q.bloomsLevel || q.btl) as any,
    co: q.co || '',
    pi: q.pi || '',
    difficulty: (q.difficulty || 'Medium') as any,
    allowedFor: { internal1: true, internal2: true, endSem: true },
    usageHistory: { internal1: false, internal2: false, endSem: false, timesUsed: 0 },
    status: 'Approved' as const,
    createdBy: 'IAT Question Bank Generator',
    createdDate: new Date().toISOString().split('T')[0],
    questionBankId: pool.generatedBankId,
    academicYear: undefined,
    department: undefined
  }));
}

export const GeneratePaperWizard: React.FC = () => {
  const {
    subjects,
    dbSubjects,
    activeDepartmentsList,
    academicYearsList,
    activeAcademicYearsList,
    departments,
    academicYears,
    generatePaper,
    activePaper,
    setActivePaper,
    currentUser,
    authSession,
    setSelectedSubjectCode,
    examPatterns,
    generatedPapers: generatedPapersForReview,
    selectedDeptScope: ctxDeptScope,
    setSelectedDeptScope: setCtxDeptScope,
    selectedCommonDepts: ctxCommonDepts,
    setSelectedCommonDepts: setCtxCommonDepts,
    showToast,
    removePaper,
    paperToReviewId,
    setPaperToReviewId
  } = useApp();

  // Spec §2 — entering "Generate Paper" ALWAYS starts at STEP 1 (Academic Year).
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [uploadModalOpen, setUploadModalOpen] = useState<boolean>(false);

  // Form selections (order: Year -> Dept -> Subject -> ExamType)
  // Spec §2 — the academic year is NOT auto-selected; the Exam Cell must choose.
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>('');
  const [selectedDeptScope, setSelectedDeptScope] = useState<DepartmentScope>(ctxDeptScope || 'SPECIFIC');
  const [selectedDept, setSelectedDept] = useState<Department | ''>('');
  const [selectedCommonDepts, setSelectedCommonDepts] = useState<string[]>(ctxCommonDepts || []);
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [selectedExamType, setSelectedExamType] = useState<ExamType>('Internal Assessment I');

  // ------------------------------------------------------------------
  // Question Bank Source (Spec §18, §19, §30)
  // Available ONLY for Internal Assessment I / II. Selecting a generated
  // IAT bank restricts the paper to exactly those questions.
  // ------------------------------------------------------------------
  const [questionBankSource, setQuestionBankSource] = useState<QuestionBankSource>('ORIGINAL');
  const [iatBanks, setIatBanks] = useState<IatGeneratedBank[]>([]);
  const [iatBanksLoading, setIatBanksLoading] = useState(false);
  const [iatBanksError, setIatBanksError] = useState<string | null>(null);
  const [selectedIatBankId, setSelectedIatBankId] = useState<string>('');
  const [iatPool, setIatPool] = useState<Question[] | null>(null);
  const [iatPoolLoading, setIatPoolLoading] = useState(false);
  const [iatPoolError, setIatPoolError] = useState<string | null>(null);

  // Set status / permission (Spec §3, §14, §15)
  const [setStatus, setSetStatus] = useState<PaperSetStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  // Reason the last generation attempt was rejected by the server
  const [generationBlock, setGenerationBlock] = useState<{ message: string; code: string | null } | null>(null);

  // Request Additional Set modal (Spec §9)
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestReason, setRequestReason] = useState('');
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  // Real question counts from the database, scoped to Academic Year +
  // Department + Subject Code (Spec §9–§13).
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({});
  const [questionCountsLoading, setQuestionCountsLoading] = useState(false);
  const [questionCountsError, setQuestionCountsError] = useState<string | null>(null);
  const [questionCountsLoaded, setQuestionCountsLoaded] = useState(false);

  // Keep context in sync
  useEffect(() => {
    setCtxDeptScope(selectedDeptScope);
  }, [selectedDeptScope, setCtxDeptScope]);

  useEffect(() => {
    setCtxCommonDepts(selectedCommonDepts);
  }, [selectedCommonDepts, setCtxCommonDepts]);

  // Generator simulation states
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStepsDone, setGenerationStepsDone] = useState<number>(0);

  const generationCheckpoints = [
    'Checking syllabus coverage & unit definitions',
    'Filtering eligible questions matching exam flag',
    'Auditing historical question reuse & times used',
    'Selecting Part A balanced items',
    'Selecting Part B analytical & descriptive items',
    'Verifying Bloom\'s Taxonomy & Course Outcomes',
    'Assigning academic year & set identifier',
    'Assembling MSAJCE autonomous paper preview'
  ];

  // Map DB subjects to Subject shape.
  // `totalQuestions` is NEVER hardcoded — it comes from the database via
  // `questionCounts` below (Spec §9, §18). Subjects from Super Admin's
  // Master Subjects table are the single source of the list.
  const dbSubjectsMapped = React.useMemo(() => {
    if (!dbSubjects || dbSubjects.length === 0) return [];
    return dbSubjects.map(s => {
      const deptCode = s.departments?.department_code || activeDepartmentsList.find(d => d.id === s.department_id)?.department_code || '';
      const yearLabel = s.academic_years?.year_label || academicYearsList.find(y => y.id === s.academic_year_id)?.year_label || '';
      return {
        id: s.id,
        code: s.subject_code,
        name: s.subject_name,
        department: deptCode as any,
        semester: s.semester ? parseInt(s.semester) || 1 : 1,
        regulation: s.regulation || 'Regulation 2024',
        totalQuestions: questionCounts[s.subject_code] ?? 0,
        status: (s.status === 'active' ? 'Active' : 'Archived') as 'Active' | 'Archived',
        units: [],
        academicYear: yearLabel
      };
    });
  }, [dbSubjects, activeDepartmentsList, academicYearsList, questionCounts]);

  // Combined pool preferring DB subjects as the single source of truth when available.
  const allSubjectsPool = React.useMemo(() => {
    if (dbSubjectsMapped.length > 0) {
      return dbSubjectsMapped;
    }
    return subjects;
  }, [dbSubjectsMapped, subjects]);

  // Subject filtering: always scoped by the selected Academic Year
  const deptSubjects = React.useMemo(() => {
    if (!selectedAcademicYear) return [];
    if (selectedDeptScope === 'COMMON') {
      const filtered = allSubjectsPool.filter(s => {
        const matchesDept = selectedCommonDepts.includes(s.department);
        const matchesYear = (s as any).academicYear ? (s as any).academicYear === selectedAcademicYear : true;
        return matchesDept && matchesYear;
      });
      const seen = new Set<string>();
      return filtered.filter(s => {
        if (seen.has(s.code)) return false;
        seen.add(s.code);
        return true;
      });
    }
    if (!selectedDept) return [];
    return allSubjectsPool.filter(s => {
      const matchesDept = s.department === selectedDept;
      const matchesYear = (s as any).academicYear ? (s as any).academicYear === selectedAcademicYear : true;
      return matchesDept && matchesYear;
    });
  }, [selectedDeptScope, selectedCommonDepts, selectedDept, selectedAcademicYear, allSubjectsPool]);

  // Auto-sync selected subject if current selection is not in filtered list
  useEffect(() => {
    if (deptSubjects.length > 0 && !deptSubjects.some(s => s.code === selectedSubject)) {
      setSelectedSubject(deptSubjects[0].code);
      setSelectedSubjectCode(deptSubjects[0].code);
    }
    if (deptSubjects.length === 0) {
      setSelectedSubject('');
    }
  }, [deptSubjects, selectedSubject, setSelectedSubjectCode]);

  const currentSubjectObj = deptSubjects.find(s => s.code === selectedSubject) || allSubjectsPool.find(s => s.code === selectedSubject);

  // ------------------------------------------------------------------
  // Resolve database IDs for the selected combination
  // ------------------------------------------------------------------
  const dbIds = useMemo(() => {
    const subjectRow = dbSubjects?.find(s => s.subject_code === selectedSubject);
    // Prefer the subject row that matches the chosen department + year
    const exact = dbSubjects?.find(s =>
      s.subject_code === selectedSubject &&
      s.academic_year_id === academicYearsList.find(y => y.year_label === selectedAcademicYear)?.id &&
      (selectedDeptScope === 'COMMON'
        ? true
        : s.department_id === activeDepartmentsList.find(d => d.department_code === selectedDept)?.id)
    );
    const row = exact || subjectRow;
    return {
      subjectId: row?.id || null,
      academicYearId: academicYearsList.find(y => y.year_label === selectedAcademicYear)?.id || null,
      departmentId: selectedDeptScope === 'COMMON'
        ? null
        : activeDepartmentsList.find(d => d.department_code === selectedDept)?.id || null
    };
  }, [dbSubjects, selectedSubject, selectedAcademicYear, academicYearsList, selectedDept, selectedDeptScope, activeDepartmentsList]);

  // ------------------------------------------------------------------
  // Spec §19 / §30 — End Semester NEVER offers the IAT reduced bank.
  // Switching to End Semester hard-resets the source to the original bank.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!isIatExam(selectedExamType)) {
      if (questionBankSource !== 'ORIGINAL') setQuestionBankSource('ORIGINAL');
      setSelectedIatBankId('');
      setIatPool(null);
      setIatBanks([]);
    }
  }, [selectedExamType, questionBankSource]);

  // Load the generated IAT banks for the selected year / department / subject
  useEffect(() => {
    if (!isIatExam(selectedExamType) || !authSession?.token || !selectedAcademicYear) {
      setIatBanks([]);
      return;
    }
    let cancelled = false;
    setIatBanksLoading(true);
    setIatBanksError(null);
    fetchIatGeneratedBanks(authSession.token, {
      academicYear: selectedAcademicYear,
      department: selectedDeptScope === 'COMMON' ? undefined : (selectedDept as string) || undefined,
      subjectCode: selectedSubject || undefined,
      status: 'Active'
    })
      .then((rows) => {
        if (cancelled) return;
        setIatBanks(rows);
        if (rows.length > 0 && !rows.some((b) => b.id === selectedIatBankId)) {
          setSelectedIatBankId(rows[0].id);
        }
        if (rows.length === 0) setSelectedIatBankId('');
      })
      .catch((err: any) => {
        if (cancelled) return;
        setIatBanks([]);
        setSelectedIatBankId('');
        setIatBanksError(err?.message || 'Unable to load generated IAT question banks.');
      })
      .finally(() => !cancelled && setIatBanksLoading(false));
    return () => { cancelled = true; };
  }, [authSession?.token, selectedExamType, selectedAcademicYear, selectedDept, selectedDeptScope, selectedSubject, selectedIatBankId]);

  // Load the actual question pool of the chosen generated IAT bank
  useEffect(() => {
    if (questionBankSource !== 'IAT_GENERATED' || !selectedIatBankId || !authSession?.token) {
      setIatPool(null);
      setIatPoolError(null);
      return;
    }
    let cancelled = false;
    setIatPoolLoading(true);
    setIatPoolError(null);
    fetchIatBankPaperPool(authSession.token, selectedIatBankId)
      .then((pool) => {
        if (cancelled) return;
        setIatPool(iatPoolToQuestions(pool, selectedSubject));
      })
      .catch((err: any) => {
        if (cancelled) return;
        setIatPool(null);
        setIatPoolError(err?.message || 'Unable to load the questions from the generated IAT question bank.');
      })
      .finally(() => !cancelled && setIatPoolLoading(false));
    return () => { cancelled = true; };
  }, [questionBankSource, selectedIatBankId, authSession?.token, selectedSubject]);

  const selectedIatBank = iatBanks.find(b => b.id === selectedIatBankId) || null;
  const iatSourceSelected = questionBankSource === 'IAT_GENERATED' && !!iatPool && !!selectedIatBank;
  const iatSourceBlocked = questionBankSource === 'IAT_GENERATED' && !iatSourceSelected;

  // ------------------------------------------------------------------
  // Real question counts (Spec §9–§15, §17)
  // Reloaded whenever the Academic Year or Department changes, so stale
  // counts from a previous selection are never shown.
  // ------------------------------------------------------------------
  const countsDepartmentId = useMemo(() => {
    if (selectedDeptScope === 'COMMON') {
      // COMMON spans several departments — scope by the subject's own department
      return null;
    }
    return activeDepartmentsList.find(d => d.department_code === selectedDept)?.id || null;
  }, [selectedDeptScope, selectedDept, activeDepartmentsList]);

  const countsScopeKey = `${dbIds.academicYearId || ''}|${countsDepartmentId || ''}|${selectedDeptScope}`;

  useEffect(() => {
    let cancelled = false;

    if (!dbIds.academicYearId) {
      setQuestionCounts({});
      setQuestionCountsError(null);
      setQuestionCountsLoaded(false);
      return;
    }

    setQuestionCountsLoading(true);
    setQuestionCountsError(null);

    fetchSubjectQuestionCounts({
      academicYearId: dbIds.academicYearId,
      departmentId: countsDepartmentId,
      token: authSession?.token
    })
      .then((res) => {
        if (cancelled) return;
        setQuestionCounts(res.counts || {});
        setQuestionCountsLoaded(true);
        setQuestionCountsError(null);
      })
      .catch((err: any) => {
        if (cancelled) return;
        // Spec §15 — an error must NOT become a misleading 0
        setQuestionCounts({});
        setQuestionCountsLoaded(false);
        setQuestionCountsError(err?.message || 'Unable to load question count.');
      })
      .finally(() => {
        if (!cancelled) setQuestionCountsLoading(false);
      });

    return () => { cancelled = true; };
  }, [countsScopeKey, dbIds.academicYearId, countsDepartmentId, authSession?.token]);

  // ------------------------------------------------------------------
  // Load authoritative set status from the backend (Spec §3, §15)
  // ------------------------------------------------------------------
  const loadSetStatus = useCallback(async () => {
    if (!dbIds.subjectId || !dbIds.academicYearId || !dbIds.departmentId) {
      setSetStatus(null);
      setStatusError(null);
      return;
    }
    setStatusLoading(true);
    setStatusError(null);
    try {
      const status = await fetchPaperSetStatus({
        subjectId: dbIds.subjectId,
        academicYearId: dbIds.academicYearId,
        departmentId: dbIds.departmentId,
        examType: selectedExamType
      }, authSession?.token || undefined);
      if (status) {
        setSetStatus(status);
      } else {
        setSetStatus(null);
        setStatusError('Unable to verify set status from the server. Generation is blocked to protect the set limit.');
      }
    } catch {
      setSetStatus(null);
      setStatusError('Unable to verify set status from the server. Generation is blocked to protect the set limit.');
    } finally {
      setStatusLoading(false);
    }
  }, [dbIds.subjectId, dbIds.academicYearId, dbIds.departmentId, selectedExamType, authSession?.token]);

  // Database mis-configuration warning (e.g. migration 010 not applied) so a
  // missing approval is never silently indistinguishable from a real limit.
  const dbDiagnosticWarning = (setStatus as any)?.diagnostics?.warning as string | null;
  // Spec §7 — the UI renders the backend's authorization object, it never
  // computes permission from local state.
  const authorization = (setStatus as any)?.authorization as {
    allowed: boolean;
    set: string | null;
    reason: string;
    code: string;
    approvalId: string | null;
    approvalStatus: string | null;
    approvalRequestNumber: string | null;
    requiresApproval: boolean;
  } | null;
  useEffect(() => {
    if (dbDiagnosticWarning) {
      console.warn('[GeneratePaper]', dbDiagnosticWarning);
    }
  }, [dbDiagnosticWarning]);

  // Refresh the status whenever Step 5 is reached or the exam type changes
  useEffect(() => {
    if (currentStep === 5 && !isGenerating) {
      loadSetStatus();
    }
  }, [currentStep, loadSetStatus, isGenerating]);

  // Clear status when the identity changes
  useEffect(() => {
    setSetStatus(null);
  }, [selectedSubject, selectedAcademicYear, selectedDept, selectedDeptScope]);

  const pattern = examPatterns.find(p => p.examType === selectedExamType) || null;
  const patternTotals = pattern ? computePatternTotals(pattern) : null;

  // The set that will be generated — always server-driven
  const nextSetLetter = setStatus?.nextSetName || null;
  const canGenerate = Boolean(setStatus?.canGenerate && nextSetLetter);
  // Spec §12 — the approval is bound to exactly one request; never use a
  // merely-pending request as the authorisation.
  const approvalRequestId = setStatus?.hasValidApproval ? (setStatus?.approvalRequest?.id || null) : null;
  const isIat = selectedExamType === 'Internal Assessment I' || selectedExamType === 'Internal Assessment II';
  const limitMessage = isIat
    ? 'Standard IAT limit reached. Additional paper generation requires Principal approval.'
    : 'Standard End Semester set limit reached. Additional paper generation requires Principal approval.';

  // The set the Exam Cell should request when blocked
  const requestedSetLetter = (() => {
    if (!setStatus) return null;
    const existing = new Set(setStatus.generatedSetNames || []);
    return SET_LETTERS.find(l => !existing.has(l)) || null;
  })();

  const handleDeptSelect = (dept: Department) => {
    setSelectedDeptScope('SPECIFIC');
    setSelectedDept(dept);
    setSelectedCommonDepts([]);
    const sub = allSubjectsPool.find(s => s.department === dept && ((s as any).academicYear ? (s as any).academicYear === selectedAcademicYear : true));
    if (sub) {
      setSelectedSubject(sub.code);
      setSelectedSubjectCode(sub.code);
    }
  };

  const handleCommonSelect = () => {
    setSelectedDeptScope('COMMON');
  };

  const handleToggleCommonDept = (code: string) => {
    setSelectedCommonDepts(prev => {
      const next = prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code];
      if (next.length > 0) {
        const sub = allSubjectsPool.find(s => next.includes(s.department) && ((s as any).academicYear ? (s as any).academicYear === selectedAcademicYear : true));
        if (sub) {
          setSelectedSubject(sub.code);
          setSelectedSubjectCode(sub.code);
        }
      }
      return next;
    });
  };

  const handleSubjectSelect = (code: string) => {
    setSelectedSubject(code);
    setSelectedSubjectCode(code);
  };

  // ------------------------------------------------------------------
  // Request Additional Set (Spec §9)
  // ------------------------------------------------------------------
  const handleSubmitRequest = async () => {
    if (!requestReason.trim()) {
      setRequestError('A reason for the additional paper is required.');
      return;
    }
    if (!dbIds.subjectId || !dbIds.academicYearId || !dbIds.departmentId || !requestedSetLetter) {
      setRequestError('Unable to identify the subject combination. Please go back and re-select Academic Year, Department and Subject.');
      return;
    }
    setRequestSubmitting(true);
    setRequestError(null);
    try {
      await submitPaperRequest({
        academicYearId: dbIds.academicYearId,
        departmentId: dbIds.departmentId,
        subjectId: dbIds.subjectId,
        examType: selectedExamType,
        existingSetCount: setStatus?.generatedSetNames?.length || 0,
        existingSetNames: setStatus?.generatedSetNames || [],
        requestedSetCount: 1,
        requestedSetNames: [requestedSetLetter],
        reason: requestReason.trim()
      }, authSession?.token || '');
      showToast(`Request for Set ${requestedSetLetter} submitted to the Principal.`);
      setRequestModalOpen(false);
      setRequestReason('');
      loadSetStatus();
    } catch (err: any) {
      setRequestError(err?.message || 'Failed to submit the request.');
    } finally {
      setRequestSubmitting(false);
    }
  };

  // ------------------------------------------------------------------
  // Generation (Spec §4, §14, §15)
  // ------------------------------------------------------------------
  const handleStartGeneration = () => {
    if (!canGenerate || !nextSetLetter || !currentSubjectObj) return;
    // Spec §19 / §30 — a reduced IAT bank must be fully loaded before it can
    // be used, and never for End Semester.
    if (iatSourceBlocked) return;
    if (questionBankSource === 'IAT_GENERATED' && !isIatExam(selectedExamType)) return;
    setIsGenerating(true);
    setGenerationStepsDone(0);

    let step = 0;
    const interval = setInterval(async () => {
      step++;
      setGenerationStepsDone(step);
      if (step >= generationCheckpoints.length) {
        clearInterval(interval);

        // 1) Generate locally (question selection + layout)
        const newPaper = generatePaper({
          department: selectedDeptScope === 'COMMON' ? 'COMMON' : (selectedDept as string),
          scope: selectedDeptScope,
          commonDepartments: selectedDeptScope === 'COMMON' ? selectedCommonDepts : undefined,
          subjectCode: selectedSubject,
          academicYear: selectedAcademicYear,
          examType: selectedExamType,
          examDate: new Date().toISOString().split('T')[0],
          semester: String((currentSubjectObj as any).semester ?? ''),
          regulation: (currentSubjectObj as any).regulation,
          duration: pattern?.duration || (selectedExamType === 'End Semester Examination' ? '3 Hours' : '2 Hours'),
          setLetter: nextSetLetter,
          setDisplayName: `${(currentSubjectObj as any).name} – Set ${nextSetLetter}`,
          maxMarks: pattern?.totalMarks,
          principalRequestId: setStatus?.hasValidApproval ? approvalRequestId : null,
          // Spec §16 — same DB source as the Step 3 card
          availableQuestionCount: questionCounts[selectedSubject],
          // Spec §18 — restrict the paper to the chosen reduced IAT bank
          questionPool: iatSourceSelected ? iatPool ?? undefined : undefined,
          questionBankSource: iatSourceSelected ? 'IAT_GENERATED' : 'ORIGINAL',
          iatGeneratedBankId: iatSourceSelected ? selectedIatBankId : null,
          iatGeneratedBankName: iatSourceSelected ? (selectedIatBank?.name ?? null) : null
        });

        // Spec §27 — audit that this generated IAT bank was chosen as the
        // source of an IAT paper. Never fires for End Semester.
        if (iatSourceSelected && authSession?.token) {
          markIatBankUsedForPaper(authSession.token, selectedIatBankId, {
            examType: selectedExamType,
            academicYear: selectedAcademicYear,
            department: selectedDeptScope === 'COMMON' ? 'COMMON' : (selectedDept as string),
            subjectCode: selectedSubject,
            paperCode: newPaper.paperCode
          }).catch(() => {});
        }

        // 2) Record the set in the database — server-side enforcement happens here.
        //    If the server rejects (duplicate set / limit reached / bad approval),
        //    the paper is rolled back so no invalid paper is left behind.
        const isAdditional = Boolean(setStatus?.hasValidApproval);
        const tracked = await trackPaperSet({
          subjectId: dbIds.subjectId!,
          academicYearId: dbIds.academicYearId!,
          departmentId: dbIds.departmentId!,
          examType: selectedExamType,
          setName: nextSetLetter,
          setDisplayName: `${(currentSubjectObj as any).name} – Set ${nextSetLetter}`,
          paperCode: newPaper.paperCode,
          localPaperId: newPaper.id,
          additionalSetRequestId: isAdditional ? approvalRequestId : null
        }, authSession?.token || '');

        if (!tracked.success) {
          // The paper was created locally before the server could validate the
          // set — remove it so no invalid/ghost paper is left behind.
          removePaper(newPaper.id);
          setIsGenerating(false);
          setCurrentStep(5);
          // Spec §25 — show the ACTUAL backend reason, never a generic message
          setGenerationBlock({
            message: tracked.error || 'Generation blocked by the server.',
            code: tracked.code || null
          });
          showToast(tracked.error || 'Generation blocked by the server.');
          loadSetStatus();
          return;
        }

        // 3) Persist the generated_papers record (Spec §6, §18)
        saveGeneratedPaperRecord({
          paperCode: newPaper.paperCode,
          subjectId: dbIds.subjectId,
          subjectCode: newPaper.subjectCode,
          subjectName: newPaper.subjectName,
          departmentId: dbIds.departmentId,
          academicYearId: dbIds.academicYearId,
          examType: selectedExamType,
          setLetter: nextSetLetter,
          setDisplayName: newPaper.setDisplayName,
          examDate: newPaper.examDate,
          duration: newPaper.duration,
          maxMarks: newPaper.maxMarks,
          semester: newPaper.semester,
          regulation: newPaper.regulation,
          principalRequestId: isAdditional ? approvalRequestId : null,
          localPaperId: newPaper.id,
          questionBankSource: iatSourceSelected ? 'IAT_GENERATED' : 'ORIGINAL',
          iatGeneratedBankId: iatSourceSelected ? selectedIatBankId : null,
          iatGeneratedBankName: iatSourceSelected ? (selectedIatBank?.name ?? null) : null
        }, authSession?.token || '').catch(() => {});

        setIsGenerating(false);
        setActivePaper(newPaper);
        setCurrentStep(6);
      }
    }, 350);
  };

  // ------------------------------------------------------------------
  // Preview (rendered after a paper has been generated, or when the
  // Exam Cell clicks "View / Print" on the Generated Papers page)
  // ------------------------------------------------------------------
  const reviewPaper = useMemo(() => {
    if (!paperToReviewId) return null;
    return generatedPapersForReview.find(p => p.id === paperToReviewId) || null;
  }, [paperToReviewId, generatedPapersForReview]);

  useEffect(() => {
    if (reviewPaper) {
      setActivePaper(reviewPaper);
      setCurrentStep(6);
    }
  }, [reviewPaper, setActivePaper]);

  if (activePaper && currentStep === 6) {
    return (
      <PaperPreview
        paper={activePaper}
        onBack={() => {
          setActivePaper(null);
          setPaperToReviewId(null);
          // Spec §2 — returning to the wizard always restarts at STEP 1
          setCurrentStep(1);
        }}
      />
    );
  }

  return (
    <div className="space-y-6 pb-16">
      {/* Wizard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#D71945]">
            Exam Paper Studio
          </span>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            Generate Question Paper
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Automated syllabus-compliant question paper generation with controlled question selection and autonomous Set naming.
          </p>
        </div>

        {activePaper && (
          <button
            onClick={() => setCurrentStep(6)}
            className="flex items-center gap-2 rounded-xl border border-[#1976D2] bg-[#EAF3FF] px-4 py-2.5 text-xs font-bold text-[#1976D2] hover:bg-[#1976D2] hover:text-white transition-all self-start sm:self-auto cursor-pointer"
          >
            <FileCheck2 className="h-4 w-4" />
            <span>Return to Active Paper ({activePaper.paperCode})</span>
          </button>
        )}
      </div>

      {/* Progress Steps Indicator (5 Steps) */}
      <div className="rounded-3xl border border-[#E5E7EB] bg-white p-5 sm:p-6 shadow-xs">
        <div className="flex items-center justify-between overflow-x-auto gap-4">
          {[
            { step: 1, title: 'Academic Year' },
            { step: 2, title: 'Department' },
            { step: 3, title: 'Subject' },
            { step: 4, title: 'Exam Type' },
            { step: 5, title: 'Confirmation & Set' },
          ].map((item, idx) => {
            const isPassed = currentStep > item.step;
            const isCurrent = currentStep === item.step;
            return (
              <div key={item.step} className="flex items-center gap-3 shrink-0">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-black transition-all ${
                    isPassed
                      ? 'bg-emerald-600 text-white'
                      : isCurrent
                      ? 'bg-[#D71945] text-white shadow-md shadow-[#D71945]/30 ring-4 ring-[#D71945]/10'
                      : 'bg-[#F1F5F9] text-[#64748B]'
                  }`}
                >
                  {isPassed ? <Check className="h-4 w-4" /> : item.step}
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">
                    Step {item.step}
                  </div>
                  <div className={`text-xs font-extrabold ${isCurrent ? 'text-[#111827]' : 'text-[#64748B]'}`}>
                    {item.title}
                  </div>
                </div>
                {idx < 4 && <div className="hidden lg:block h-0.5 w-10 bg-[#E5E7EB] mx-1" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* STEP 1: SELECT ACADEMIC YEAR */}
      {currentStep === 1 && (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-xs space-y-6">
          <div>
            <span className="text-xs font-extrabold uppercase tracking-wider text-[#D71945]">
              Step 1 of 5
            </span>
            <h2 className="mt-1 text-xl font-extrabold text-[#111827]">
              Select Academic Year
            </h2>
            <p className="text-xs text-[#64748B]">
              Choose the target academic year session for this examination question paper. The selected year is carried through
              department, subject, exam type, question selection and the generated paper record.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(activeAcademicYearsList.length > 0 ? activeAcademicYearsList.map(y => y.year_label) : academicYears).map((yr) => {
              const isSelected = selectedAcademicYear === yr;
              return (
                <div
                  key={yr}
                  onClick={() => setSelectedAcademicYear(yr)}
                  className={`rounded-2xl border p-5 cursor-pointer transition-all ${
                    isSelected
                      ? 'border-[#D71945] bg-[#FFF0F3] shadow-md shadow-[#D71945]/10 ring-2 ring-[#D71945]'
                      : 'border-[#E5E7EB] bg-white hover:border-slate-400 hover:bg-[#F7F8FA]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="rounded-lg bg-white px-2 py-0.5 font-mono text-xs font-bold text-[#111827] border border-[#E5E7EB]">
                      Session
                    </span>
                    {isSelected && <CheckCircle2 className="h-5 w-5 text-[#D71945]" />}
                  </div>
                  <h3 className="mt-3 font-black text-lg text-[#111827]">
                    {yr}
                  </h3>
                  <div className="mt-2 text-xs text-[#64748B]">
                    {yr === activeAcademicYearsList[0]?.year_label ? 'Current Active Academic Year' : 'Academic Year Session'}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end pt-4 border-t border-[#E5E7EB]">
            <button
              disabled={!selectedAcademicYear}
              onClick={() => setCurrentStep(2)}
              className={`flex items-center gap-2 rounded-xl px-6 py-2.5 text-xs font-extrabold shadow-md transition-all ${
                selectedAcademicYear
                  ? 'bg-[#D71945] text-white shadow-[#D71945]/25 hover:bg-[#c0153c] cursor-pointer'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
              }`}
            >
              <span>Continue to Department</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: SELECT DEPARTMENT */}
      {currentStep === 2 && (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-xs space-y-6">
          <div>
            <span className="text-xs font-extrabold uppercase tracking-wider text-[#D71945]">
              Step 2 of 5
            </span>
            <h2 className="mt-1 text-xl font-extrabold text-[#111827]">
              Select Academic Department
            </h2>
            <p className="text-xs text-[#64748B]">
              Choose the designated engineering branch for this question paper (Academic Year: <strong>{selectedAcademicYear}</strong>).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(departments || []).map((dept) => {
              const isSelected = selectedDeptScope === 'SPECIFIC' && selectedDept === dept.code;
              return (
                <div
                  key={dept.code}
                  onClick={() => handleDeptSelect(dept.code)}
                  className={`rounded-2xl border p-5 cursor-pointer transition-all ${
                    isSelected
                      ? 'border-[#D71945] bg-[#FFF0F3] shadow-md shadow-[#D71945]/10 ring-2 ring-[#D71945]'
                      : 'border-[#E5E7EB] bg-white hover:border-slate-400 hover:bg-[#F7F8FA]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="rounded-lg bg-white px-2 py-0.5 font-mono text-xs font-bold text-[#111827] border border-[#E5E7EB]">
                      {dept.code}
                    </span>
                    {isSelected && <CheckCircle2 className="h-5 w-5 text-[#D71945]" />}
                  </div>
                  <h3 className="mt-3 font-extrabold text-sm text-[#111827]">
                    {dept.name}
                  </h3>
                  <div className="mt-2 text-xs text-[#64748B]">
                    HOD: {dept.hod || '—'}
                  </div>
                </div>
              );
            })}

            {/* COMMON CARD — Special system option */}
            {(() => {
              const isCommonSelected = selectedDeptScope === 'COMMON';
              return (
                <div
                  onClick={handleCommonSelect}
                  className={`rounded-2xl border p-5 cursor-pointer transition-all ${
                    isCommonSelected
                      ? 'border-[#D71945] bg-[#FFF0F3] shadow-md shadow-[#D71945]/10 ring-2 ring-[#D71945]'
                      : 'border-[#E5E7EB] bg-white hover:border-slate-400 hover:bg-[#F7F8FA]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="rounded-lg bg-white px-2 py-0.5 font-mono text-xs font-bold text-[#111827] border border-[#E5E7EB]">
                      COMMON
                    </span>
                    {isCommonSelected && <CheckCircle2 className="h-5 w-5 text-[#D71945]" />}
                  </div>
                  <h3 className="mt-3 font-extrabold text-sm text-[#111827]">
                    Common Questions
                  </h3>
                  <div className="mt-2 text-xs text-[#64748B]">
                    Questions applicable to multiple departments
                  </div>
                </div>
              );
            })()}
          </div>

          {/* COMMON MULTI-DEPARTMENT SELECTION SECTION */}
          {selectedDeptScope === 'COMMON' && (
            <div className="rounded-2xl border border-rose-200 bg-[#FFF8F9] p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-rose-100 pb-3">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#D71945]">
                    COMMON QUESTION
                  </span>
                  <h4 className="text-base font-extrabold text-[#111827]">
                    Select the departments this question applies to:
                  </h4>
                  <p className="text-xs text-[#64748B]">
                    Choose 2 or more active academic departments for this common paper / question set.
                  </p>
                </div>
                <div className="text-xs font-bold text-[#D71945] shrink-0">
                  {selectedCommonDepts.length} selected (min. 2)
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {(departments || []).map((dept) => {
                  const isChecked = selectedCommonDepts.includes(dept.code);
                  return (
                    <div
                      key={dept.code}
                      onClick={() => handleToggleCommonDept(dept.code)}
                      className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer select-none transition-all ${
                        isChecked
                          ? 'border-[#D71945] bg-white shadow-xs text-[#111827]'
                          : 'border-[#E5E7EB] bg-white/70 hover:bg-white text-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="h-4 w-4 rounded border-gray-300 text-[#D71945] focus:ring-[#D71945] cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-xs font-extrabold text-[#111827] block">
                          {dept.code}
                        </span>
                        <span className="text-[11px] text-[#64748B] truncate block">
                          {dept.name}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className="text-xs font-bold text-[#64748B]">Selected Departments:</span>
                {selectedCommonDepts.length === 0 ? (
                  <span className="text-xs italic text-[#94A3B8]">None selected</span>
                ) : (
                  selectedCommonDepts.map((code) => (
                    <span
                      key={code}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-100 border border-rose-200 px-2.5 py-1 text-xs font-mono font-extrabold text-[#D71945]"
                    >
                      [{code}]
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleCommonDept(code);
                        }}
                        className="hover:text-rose-900 cursor-pointer font-bold"
                        title={`Remove ${code}`}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>

              {selectedCommonDepts.length < 2 && (
                <div className="flex items-center gap-2 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>Select at least 2 departments for a common question.</span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-4 border-t border-[#E5E7EB]">
            <button
              onClick={() => setCurrentStep(1)}
              className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-xs font-bold text-[#64748B] hover:bg-[#F7F8FA] cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </button>
            {(() => {
              const isContinueDisabled =
                selectedDeptScope === 'COMMON'
                  ? selectedCommonDepts.length < 2
                  : !selectedDept;
              return (
                <button
                  disabled={isContinueDisabled}
                  onClick={() => setCurrentStep(3)}
                  className={`flex items-center gap-2 rounded-xl px-6 py-2.5 text-xs font-extrabold shadow-md transition-all ${
                    isContinueDisabled
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                      : 'bg-[#D71945] text-white shadow-[#D71945]/25 hover:bg-[#c0153c] cursor-pointer'
                  }`}
                >
                  <span>Continue to Subject</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              );
            })()}
          </div>
        </div>
      )}

      {/* STEP 3: SELECT SUBJECT */}
      {currentStep === 3 && (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-xs space-y-6">
          <div>
            <span className="text-xs font-extrabold uppercase tracking-wider text-[#D71945]">
              Step 3 of 5
            </span>
            <h2 className="mt-1 text-xl font-extrabold text-[#111827]">
              {selectedDeptScope === 'COMMON'
                ? `Select Subject (COMMON: ${selectedCommonDepts.join(', ')} – ${selectedAcademicYear})`
                : `Select Subject (${selectedDept} – ${selectedAcademicYear})`}
            </h2>
            <p className="text-xs text-[#64748B]">
              {selectedDeptScope === 'COMMON'
                ? `Pick from the accredited course catalogue for common departments (${selectedCommonDepts.join(', ')}).`
                : `Pick from the accredited course catalogue for ${selectedDept}.`}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {deptSubjects.length === 0 ? (
              <div className="col-span-1 sm:col-span-2 rounded-2xl border border-dashed border-gray-300 p-8 text-center bg-gray-50/50">
                <AlertCircle className="h-8 w-8 text-amber-500 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-gray-800">
                  No subjects available for the selected academic year and department.
                </h4>
                <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                  There are no active subjects registered under {selectedDeptScope === 'COMMON' ? 'selected common departments' : selectedDept} for session {selectedAcademicYear}.
                </p>
              </div>
            ) : (
              deptSubjects.map((sub) => {
                const isSelected = selectedSubject === sub.code;
                return (
                  <div
                    key={sub.id}
                    onClick={() => handleSubjectSelect(sub.code)}
                    className={`rounded-2xl border p-5 cursor-pointer transition-all ${
                      isSelected
                        ? 'border-[#1976D2] bg-[#EAF3FF] shadow-md shadow-[#1976D2]/10 ring-2 ring-[#1976D2]'
                        : 'border-[#E5E7EB] bg-white hover:border-slate-400 hover:bg-[#F7F8FA]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="rounded-lg bg-white px-2 py-0.5 font-mono text-xs font-extrabold text-[#1976D2] border border-[#E5E7EB]">
                        {sub.code}
                      </span>
                      {isSelected && <CheckCircle2 className="h-5 w-5 text-[#1976D2]" />}
                    </div>
                    <h3 className="mt-3 font-extrabold text-base text-[#111827]">
                      {sub.name}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[#64748B]">
                      <span>Semester {sub.semester}</span>
                      <span>•</span>
                      <span>{sub.regulation}</span>
                      <span>•</span>
                      {/* Spec §9/§15 — real DB count, with explicit loading and
                          error states. A failure never displays as 0. */}
                      {questionCountsLoading && !questionCountsLoaded ? (
                        <span className="inline-flex items-center gap-1.5 text-[#64748B]">
                          <Loader2 className="h-3 w-3 animate-spin" /> Loading question count…
                        </span>
                      ) : questionCountsError ? (
                        <span
                          className="inline-flex items-center gap-1.5 font-bold text-[#D71945]"
                          title={questionCountsError}
                        >
                          <AlertCircle className="h-3 w-3" /> Unable to load question count
                        </span>
                      ) : (
                        <span className="font-bold text-[#111827]">
                          {sub.totalQuestions} {sub.totalQuestions === 1 ? 'Question' : 'Questions'} in Bank
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex justify-between pt-4 border-t border-[#E5E7EB]">
            <button
              onClick={() => setCurrentStep(2)}
              className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-xs font-bold text-[#64748B] hover:bg-[#F7F8FA] cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </button>
            <button
              disabled={deptSubjects.length === 0}
              onClick={() => setCurrentStep(4)}
              className={`flex items-center gap-2 rounded-xl px-6 py-2.5 text-xs font-extrabold shadow-md transition-all ${
                deptSubjects.length === 0
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                  : 'bg-[#D71945] text-white shadow-[#D71945]/25 hover:bg-[#c0153c] cursor-pointer'
              }`}
            >
              <span>Continue to Exam Type</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: SELECT EXAM TYPE */}
      {currentStep === 4 && (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-xs space-y-6">
          <div>
            <span className="text-xs font-extrabold uppercase tracking-wider text-[#D71945]">
              Step 4 of 5
            </span>
            <h2 className="mt-1 text-xl font-extrabold text-[#111827]">
              Select Examination Type
            </h2>
            <p className="text-xs text-[#64748B]">
              Subject: <strong>{currentSubjectObj?.name || '—'} ({selectedSubject || '—'})</strong> · Academic Year: <strong>{selectedAcademicYear}</strong>
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {([
              { type: 'Internal Assessment I' as ExamType, tag: 'Continuous Assessment', desc: 'Covers Unit 1, Unit 2, and the first half of Unit 3.', units: 'Units 1, 2 & 3 (Half)', accent: 'rose' },
              { type: 'Internal Assessment II' as ExamType, tag: 'Continuous Assessment', desc: 'Covers remaining half of Unit 3, Unit 4, and Unit 5.', units: 'Units 3 (Half), 4 & 5', accent: 'rose' },
              { type: 'End Semester Examination' as ExamType, tag: 'Degree Examination', desc: 'Comprehensive examination covering all 5 syllabus units.', units: 'Units 1 through 5 (100%)', accent: 'blue' }
            ]).map(card => {
              const p = examPatterns.find(x => x.examType === card.type);
              const t = p ? computePatternTotals(p) : null;
              const isSelected = selectedExamType === card.type;
              const isBlue = card.accent === 'blue';
              return (
                <div
                  key={card.type}
                  onClick={() => setSelectedExamType(card.type)}
                  className={`rounded-3xl border p-6 cursor-pointer transition-all flex flex-col justify-between ${
                    isSelected
                      ? isBlue
                        ? 'border-[#1976D2] bg-[#EAF3FF] shadow-md ring-2 ring-[#1976D2]'
                        : 'border-[#D71945] bg-[#FFF0F3] shadow-md ring-2 ring-[#D71945]'
                      : 'border-[#E5E7EB] bg-white hover:border-slate-400'
                  }`}
                >
                  <div>
                    <span className={`rounded-full bg-white px-2.5 py-1 text-[10px] font-extrabold uppercase border ${isBlue ? 'text-[#1976D2] border-blue-200' : 'text-[#D71945] border-red-200'}`}>
                      {card.tag}
                    </span>
                    <h3 className="mt-4 text-xl font-black text-[#111827]">{card.type}</h3>
                    <p className="mt-2 text-xs text-[#64748B] leading-relaxed">{card.desc}</p>
                    <div className="mt-4 space-y-1.5 text-xs text-[#111827]">
                      <div className="font-bold">{p?.totalMarks ?? (isBlue ? 100 : 60)} Maximum Marks</div>
                      <div className="text-[#64748B]">Duration: {p?.duration || (isBlue ? '3 Hours' : '2 Hours')}</div>
                      {t && (
                        <>
                          <div className="text-[#64748B]">Part A: {p?.partA.totalQuestions} × {p?.partA.marksPerQuestion} = {t.partA}M</div>
                          <div className="text-[#64748B]">Part B: {t.partB}M</div>
                          {t.partC > 0 && <div className="text-[#64748B]">Part C: {t.partC}M</div>}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="mt-6 pt-4 border-t border-[#E5E7EB]">
                    <span className={`text-xs font-extrabold ${isBlue ? 'text-[#1976D2]' : 'text-[#D71945]'}`}>
                      {card.units}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ============================================================
              Spec §18 — Question Bank Source.
              Rendered ONLY for Internal Assessment I / II. For an End
              Semester Examination the reduced-bank option does not exist
              and the original, full question bank is always used.
              ============================================================ */}
          {isIatExam(selectedExamType) && (
            <div className="space-y-4 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] p-5">
              <div>
                <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[#64748B]">
                  <Database className="h-4 w-4" />
                  Question Bank Source
                </h3>
                <p className="mt-1 text-[11px] text-[#94A3B8]">
                  Choose the original uploaded question bank, or one of the reduced IAT question banks generated by
                  the IAT Question Bank Generator.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {([
                  {
                    value: 'ORIGINAL' as QuestionBankSource,
                    title: 'Original Question Bank',
                    desc: 'Use every question in the complete uploaded question bank.',
                    meta: `${questionCounts[selectedSubject] ?? 0} questions in the database`
                  },
                  {
                    value: 'IAT_GENERATED' as QuestionBankSource,
                    title: 'Generated IAT Question Bank',
                    desc: 'Use a reduced question bank selected from the original bank.',
                    meta: `${iatBanks.length} generated bank${iatBanks.length === 1 ? '' : 's'} available`
                  }
                ]).map(opt => {
                  const isSelected = questionBankSource === opt.value;
                  const isDisabled = opt.value === 'IAT_GENERATED' && iatBanks.length === 0;
                  return (
                    <div
                      key={opt.value}
                      onClick={() => {
                        if (isDisabled) return;
                        setQuestionBankSource(opt.value);
                      }}
                      className={`rounded-2xl border p-4 transition-all ${
                        isDisabled
                          ? 'cursor-not-allowed border-[#E5E7EB] bg-[#F7F8FA] opacity-60'
                          : isSelected
                            ? 'cursor-pointer border-[#D71945] bg-[#FFF0F3] shadow-md ring-2 ring-[#D71945]'
                            : 'cursor-pointer border-[#E5E7EB] bg-white hover:border-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-extrabold text-[#111827]">{opt.title}</h4>
                        {isSelected && <CheckCircle2 className="h-4 w-4 text-[#D71945]" />}
                      </div>
                      <p className="mt-1 text-[11px] text-[#64748B]">{opt.desc}</p>
                      <p className="mt-1.5 text-[10px] font-bold text-[#94A3B8]">{opt.meta}</p>
                    </div>
                  );
                })}
              </div>

              {/* Generated bank picker */}
              {questionBankSource === 'IAT_GENERATED' && (
                <div className="space-y-3">
                  {iatBanksLoading ? (
                    <div className="flex items-center gap-2 text-[11px] text-[#64748B]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading generated IAT question banks…
                    </div>
                  ) : iatBanksError ? (
                    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[11px] font-semibold text-red-800">
                      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>{iatBanksError}</span>
                    </div>
                  ) : iatBanks.length === 0 ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
                      No generated IAT question bank exists for this Academic Year, Department and Subject. Create
                      one from <strong>IAT Question Bank Generator</strong> in the sidebar, then return here.
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {iatBanks.map(b => {
                          const isSel = selectedIatBankId === b.id;
                          return (
                            <div
                              key={b.id}
                              onClick={() => setSelectedIatBankId(b.id)}
                              className={`rounded-2xl border p-4 cursor-pointer transition-all ${
                                isSel
                                  ? 'border-[#D71945] bg-[#FFF0F3] shadow-md ring-2 ring-[#D71945]'
                                  : 'border-[#E5E7EB] bg-white hover:border-slate-400'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <h4 className="text-xs font-extrabold text-[#111827]">{b.name}</h4>
                                {isSel && <CheckCircle2 className="h-4 w-4 shrink-0 text-[#D71945]" />}
                              </div>
                              <p className="mt-1.5 text-[10px] text-[#64748B]">
                                <strong>{b.totalQuestions}</strong> questions · Part A {b.actualPartACount} · Part B{' '}
                                {b.actualPartBCount} · Part C {b.actualPartCCount}
                              </p>
                              <p className="mt-0.5 text-[10px] text-[#94A3B8]">
                                Source: {b.sourceBankName || '—'} · Created:{' '}
                                {b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '—'}
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      {iatPoolLoading && (
                        <div className="flex items-center gap-2 text-[11px] text-[#64748B]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading questions from the generated
                          bank…
                        </div>
                      )}
                      {iatPoolError && (
                        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[11px] font-semibold text-red-800">
                          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                          <span>{iatPoolError}</span>
                        </div>
                      )}
                      {iatSourceSelected && (
                        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                          <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <p className="text-[11px] leading-relaxed text-emerald-800">
                            This paper will be built only from{' '}
                            <strong>{iatPool?.length} questions</strong> in{' '}
                            <strong>{selectedIatBank?.name}</strong>. Every question is linked to the original
                            question bank it was selected from. No question-usage record is created until the
                            paper is finalized.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* End Semester notice (Spec §19, §30) */}
              {!isIatExam(selectedExamType) && (
                <p className="text-[11px] text-[#94A3B8]">
                  A reduced IAT question bank cannot be used for an End Semester Examination.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-between pt-4 border-t border-[#E5E7EB]">
            <button
              onClick={() => setCurrentStep(3)}
              className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-xs font-bold text-[#64748B] hover:bg-[#F7F8FA] cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </button>
            <button
              onClick={() => setCurrentStep(5)}
              disabled={iatSourceBlocked}
              className={`flex items-center gap-2 rounded-xl px-6 py-2.5 text-xs font-extrabold text-white shadow-md ${
                iatSourceBlocked
                  ? 'cursor-not-allowed bg-gray-300 text-gray-500 shadow-none'
                  : 'bg-[#D71945] shadow-[#D71945]/25 hover:bg-[#c0153c] cursor-pointer'
              }`}
            >
              <span>Continue to Confirmation & Set</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: CONFIRMATION & SET ALLOCATION */}
      {currentStep === 5 && !isGenerating && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-xs space-y-6">
            <div>
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#D71945]">
                Step 5 of 5
              </span>
              <h2 className="mt-1 text-xl font-extrabold text-[#111827]">
                Confirm Generation Blueprint & Set Assignment
              </h2>
              <p className="text-xs text-[#64748B]">
                Review the finalized parameters, the exam pattern and the generation permission before generating.
              </p>
            </div>

            {/* Parameter Details Grid — Spec §14 */}
            <div className="rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 border-b border-[#E5E7EB] pb-4">
                <div>
                  <span className="text-[10px] font-bold uppercase text-[#64748B]">Academic Year</span>
                  <div className="font-black text-sm text-[#111827]">{selectedAcademicYear || '—'}</div>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-[#64748B]">Department</span>
                  <div className="font-black text-sm text-[#111827]">
                    {selectedDeptScope === 'COMMON' ? (
                      <span className="inline-flex items-center gap-1.5 flex-wrap">
                        <span className="rounded bg-rose-100 border border-rose-200 px-2 py-0.5 font-black text-xs text-[#D71945]">
                          COMMON
                        </span>
                        <span className="text-xs font-bold text-[#64748B]">({selectedCommonDepts.join(', ')})</span>
                      </span>
                    ) : (
                      (selectedDept || '—')
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-[#64748B]">Subject Code</span>
                  <div className="font-mono font-black text-sm text-[#1976D2]">{selectedSubject || '—'}</div>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-[#64748B]">Subject Name</span>
                  <div className="font-black text-sm text-[#111827]">{currentSubjectObj?.name || '—'}</div>
                </div>
                <div className="sm:col-span-4">
                  <span className="text-[10px] font-bold uppercase text-[#64748B]">Exam Type</span>
                  <div className="font-black text-sm text-[#D71945]">{selectedExamType}</div>
                </div>
              </div>

              {/* Exam Pattern summary */}
              <div>
                <span className="text-[10px] font-bold uppercase text-[#64748B]">Exam Pattern</span>
                {pattern ? (
                  <div className="mt-2 rounded-xl border border-[#E5E7EB] bg-white p-4 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#111827]">{pattern.examName || selectedExamType}</span>
                      <span className="font-black text-[#D71945]">{pattern.totalMarks} Marks · {pattern.duration}</span>
                    </div>
                    <div className="text-[#64748B]">
                      Part A: {pattern.partA.totalQuestions} × {pattern.partA.marksPerQuestion} = {patternTotals?.partA} Marks
                      {pattern.partA.instruction ? ` — ${pattern.partA.instruction}` : ''}
                    </div>
                    <div className="text-[#64748B]">
                      {pattern.partB.format === 'sections' && pattern.partB.sections
                        ? pattern.partB.sections.map(s => `${s.name}: Answer ${s.answer_count} of ${s.display_questions} (${pattern.partB.marksPerQuestion}M)`).join(' | ')
                        : `Part B: ${pattern.partB.orQuestionsCount} × ${pattern.partB.marksPerQuestion} (OR)`}
                      {' '}= {patternTotals?.partB} Marks
                    </div>
                    {pattern.partC?.enabled && (
                      <div className="text-[#64748B]">
                        Part C: {pattern.partC.orQuestionsCount} × {pattern.partC.marksPerQuestion} (OR) = {patternTotals?.partC} Marks
                      </div>
                    )}
                    <div className="pt-1.5 border-t border-[#F1F5F9] font-bold text-[#111827]">
                      Total: {patternTotals?.breakdown} = {patternTotals?.total} Marks
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[#94A3B8] mt-1">No pattern configured for {selectedExamType}.</p>
                )}
              </div>

              {/* Existing Sets / Next Available Set / Generation Permission — Spec §14 */}
              <div className="pt-3 border-t border-[#E5E7EB] space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Existing Sets */}
                  <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
                    <div className="text-[10px] font-bold uppercase text-[#64748B]">Existing Sets</div>
                    {statusLoading ? (
                      <div className="mt-2 h-5 w-24 rounded bg-[#F1F5F9] animate-pulse" />
                    ) : setStatus ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(setStatus.standardSetNames || []).map(letter => {
                          const exists = (setStatus.generatedSetNames || []).includes(letter);
                          return (
                            <span
                              key={letter}
                              className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-black ${
                                exists ? 'bg-emerald-100 text-emerald-800' : 'bg-[#F1F5F9] text-slate-400'
                              }`}
                            >
                              {exists && <Check className="h-3 w-3" />} Set {letter}
                            </span>
                          );
                        })}
                        {(setStatus.generatedSetNames || [])
                          .filter(l => !(setStatus.standardSetNames || []).includes(l))
                          .map(letter => (
                            <span key={letter} className="inline-flex items-center gap-1 rounded-lg bg-purple-100 text-purple-800 px-2 py-0.5 text-[11px] font-black">
                              <Check className="h-3 w-3" /> Set {letter} (Approved)
                            </span>
                          ))}
                        {(setStatus.generatedSetNames || []).length === 0 && (
                          <span className="text-[11px] italic text-slate-400">None generated yet</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[11px] italic text-slate-400">Unavailable</span>
                    )}
                    {setStatus && (
                      <div className="mt-1.5 text-[10px] text-[#94A3B8]">
                        {setStatus.count} of {setStatus.limit} standard sets generated
                      </div>
                    )}
                  </div>

                  {/* Next Available Set */}
                  <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
                    <div className="text-[10px] font-bold uppercase text-[#64748B]">Next Available Set</div>
                    {statusLoading ? (
                      <div className="mt-2 h-6 w-16 rounded bg-[#F1F5F9] animate-pulse" />
                    ) : nextSetLetter ? (
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-[#D71945] text-white font-black text-sm shadow-xs">
                          {nextSetLetter}
                        </span>
                        <span className="text-xs font-black text-[#111827]">Set {nextSetLetter}</span>
                      </div>
                    ) : (
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-slate-300 text-white font-black text-sm">
                          ?
                        </span>
                        <span className="text-xs font-bold text-slate-500">Awaiting approval</span>
                      </div>
                    )}
                  </div>

                  {/* Generation Permission — rendered from the backend's
                      `authorization` object verbatim (Spec §7). The UI never
                      computes permission itself. */}
                  <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
                    <div className="text-[10px] font-bold uppercase text-[#64748B]">Generation Permission</div>
                    {statusLoading ? (
                      <div className="mt-2 h-5 w-28 rounded bg-[#F1F5F9] animate-pulse" />
                    ) : statusError ? (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-[#D71945]">
                        <Lock className="h-3.5 w-3.5" /> Blocked — server unavailable
                      </div>
                    ) : authorization ? (
                      <>
                        <div className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-bold ${
                          authorization.allowed ? 'text-emerald-700' : 'text-amber-700'
                        }`}>
                          {authorization.allowed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                          {authorization.allowed
                            ? (authorization.code === 'APPROVED' ? 'Approved by Principal' : 'Standard set available')
                            : (authorization.code === 'APPROVAL_REJECTED' ? 'Request rejected by Principal' : 'Principal approval required')}
                        </div>
                        {/* The exact reason returned by the server (Spec §25) */}
                        <p className="mt-1 text-[10px] leading-snug text-[#64748B]">{authorization.reason}</p>
                        {authorization.approvalRequestNumber && (
                          <p className="mt-0.5 text-[10px] font-mono text-[#94A3B8]">
                            {authorization.approvalRequestNumber}
                            {authorization.approvalStatus ? ` · ${authorization.approvalStatus}` : ''}
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="mt-1.5 text-[11px] italic text-slate-400">Awaiting server response</div>
                    )}
                  </div>
                </div>

                {/* Standard set limit message — Spec §3 */}
                {setStatus?.limitReached && !canGenerate && (
                  <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <div className="font-extrabold text-amber-900">{limitMessage}</div>
                      <p className="mt-1 text-amber-800">
                        The Exam Cell may generate only {isIat ? 'Set A and Set B' : 'Set A, B, C and D'} for this Academic Year,
                        Department, Subject and Exam Type. Any further set must be approved by the Principal.
                      </p>
                      {setStatus.pendingRequest && (
                        <p className="mt-1 font-bold text-amber-900">
                          Request {setStatus.pendingRequest.request_number} is pending the Principal's decision.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {statusError && (
                  <div className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                    <AlertCircle className="h-5 w-5 text-[#D71945] shrink-0 mt-0.5" />
                    <p className="text-xs font-bold text-rose-800">{statusError}</p>
                  </div>
                )}

                {dbDiagnosticWarning && (
                  <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-900">
                      <div className="font-extrabold">Database configuration warning</div>
                      <p className="mt-1">{dbDiagnosticWarning}</p>
                    </div>
                  </div>
                )}

                {generationBlock && (
                  <div className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                    <Lock className="h-5 w-5 text-[#D71945] shrink-0 mt-0.5" />
                    <div className="text-xs text-rose-900">
                      <div className="font-extrabold">Generation was blocked by the server</div>
                      <p className="mt-1">{generationBlock.message}</p>
                      {generationBlock.code && (
                        <p className="mt-1 font-mono text-[10px] text-rose-700">Reason code: {generationBlock.code}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {canGenerate && (
              <div className="rounded-2xl border border-emerald-100 bg-[#ECFDF3] p-4 flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-xs text-emerald-900 leading-relaxed">
                  <strong>Quality Assurance:</strong> Questions will only be drawn from {currentSubjectObj?.name} ({selectedSubject}).
                  The engine balances Bloom&apos;s levels and verifies CO/PI mappings for NBA accreditation.
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-[#E5E7EB]">
              <button
                onClick={() => setCurrentStep(4)}
                className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-xs font-bold text-[#64748B] hover:bg-[#F7F8FA] cursor-pointer self-start"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back</span>
              </button>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  onClick={loadSetStatus}
                  disabled={statusLoading}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-xs font-bold text-[#64748B] hover:bg-[#F7F8FA] disabled:opacity-50 cursor-pointer"
                  title="Re-check set status on the server"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${statusLoading ? 'animate-spin' : ''}`} />
                  <span>Re-check</span>
                </button>

                {canGenerate ? (
                  <button
                    onClick={handleStartGeneration}
                    className="flex items-center gap-2 rounded-xl bg-[#D71945] px-6 py-3 text-xs font-extrabold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c] active:scale-[0.98] transition-all cursor-pointer"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>Generate Examination Paper (Set {nextSetLetter})</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setRequestError(null);
                      setRequestModalOpen(true);
                    }}
                    disabled={!setStatus || statusLoading || !requestedSetLetter}
                    className="flex items-center gap-2 rounded-xl bg-amber-600 px-6 py-3 text-xs font-extrabold text-white shadow-md shadow-amber-600/25 hover:bg-amber-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Send className="h-4 w-4" />
                    <span>Request Additional Set</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 5 SIMULATION: AUTOMATIC SELECTION PROCESSING */}
      {currentStep === 5 && isGenerating && (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-8 sm:p-12 shadow-xs max-w-xl mx-auto text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-[#FFF0F3] text-[#D71945] animate-pulse">
            <RotateCw className="h-8 w-8 animate-spin" />
          </div>

          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#D71945]">
              Autonomous Question Selection Engine
            </span>
            <h2 className="mt-1 text-2xl font-black text-[#111827]">
              Composing Question Paper – Set {nextSetLetter}
            </h2>
            <p className="mt-1 text-xs text-[#64748B]">
              Selecting verified questions for {currentSubjectObj?.name} ({selectedAcademicYear})...
            </p>
          </div>

          <div className="space-y-2.5 text-left text-xs bg-[#F7F8FA] p-5 rounded-2xl border border-[#E5E7EB]">
            {generationCheckpoints.map((label, idx) => {
              const isDone = generationStepsDone > idx;
              const isCurrent = generationStepsDone === idx;
              return (
                <div
                  key={idx}
                  className={`flex items-center gap-3 transition-opacity ${
                    isDone ? 'text-[#111827] font-semibold' : isCurrent ? 'text-[#D71945] font-bold' : 'text-[#94A3B8] opacity-50'
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  ) : isCurrent ? (
                    <div className="h-4 w-4 rounded-full border-2 border-[#D71945] border-t-transparent animate-spin shrink-0" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border border-[#CBD5E1] shrink-0" />
                  )}
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Request Additional Set Modal — Spec §9 */}
      {requestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-xl rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-7 shadow-2xl my-8 max-h-[90vh] overflow-y-auto space-y-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#D71945]">
                Additional Paper Request
              </span>
              <h3 className="mt-1 text-lg font-extrabold text-[#111827]">Request Additional Set</h3>
              <p className="mt-1 text-xs text-[#64748B]">
                The standard set limit has been reached. The Principal must approve the additional set before it can be generated.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs">
              <div className="font-extrabold text-amber-900 mb-2">{limitMessage}</div>
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div>
                  <div className="text-amber-700">Academic Year</div>
                  <div className="font-bold text-amber-900">{selectedAcademicYear}</div>
                </div>
                <div>
                  <div className="text-amber-700">Department</div>
                  <div className="font-bold text-amber-900">
                    {selectedDeptScope === 'COMMON' ? `COMMON (${selectedCommonDepts.join(', ')})` : selectedDept}
                  </div>
                </div>
                <div>
                  <div className="text-amber-700">Subject Code</div>
                  <div className="font-bold font-mono text-amber-900">{selectedSubject}</div>
                </div>
                <div>
                  <div className="text-amber-700">Subject Name</div>
                  <div className="font-bold text-amber-900">{currentSubjectObj?.name}</div>
                </div>
                <div>
                  <div className="text-amber-700">Exam Type</div>
                  <div className="font-bold text-amber-900">{selectedExamType}</div>
                </div>
                <div>
                  <div className="text-amber-700">Existing Sets</div>
                  <div className="font-bold text-amber-900">
                    {(setStatus?.generatedSetNames || []).join(', ') || 'None'}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-amber-700">Requested Set</div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-amber-600 text-white font-black text-xs">
                      {requestedSetLetter}
                    </span>
                    <span className="font-bold text-amber-900">Set {requestedSetLetter}</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#111827] mb-1">
                Reason for Additional Paper <span className="text-[#D71945]">(Required)</span>
              </label>
              <textarea
                rows={4}
                value={requestReason}
                onChange={e => setRequestReason(e.target.value)}
                placeholder="e.g. Additional section required due to increased student strength / re-sit candidates / lost paper…"
                className="w-full rounded-xl border border-[#E5E7EB] p-3 text-xs focus:border-[#D71945] focus:outline-none"
              />
            </div>

            {requestError && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{requestError}</span>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] p-3 text-[11px] text-[#64748B]">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Each additional set requires its own Principal approval. An approval is bound to Set {requestedSetLetter} for this
                exact Academic Year, Department, Subject and Exam Type, and is consumed once the paper is generated.
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setRequestModalOpen(false)}
                disabled={requestSubmitting}
                className="rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-xs font-bold text-[#64748B] hover:bg-[#F7F8FA] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitRequest}
                disabled={requestSubmitting || !requestReason.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#D71945] px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-[#c0153c] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {requestSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {requestSubmitting ? 'Submitting…' : 'Submit Request to Principal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Question Bank Modal */}
      <AddQuestionBankModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        defaultSubjectCode={selectedSubject}
      />
    </div>
  );
};
