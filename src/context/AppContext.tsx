import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  User,
  Subject,
  Question,
  ExamPattern,
  GeneratedPaper,
  UnitSyllabusConfig,
  ExamType,
  PaperStatus,
  BloomsLevel,
  UserRole,
  AuthRole,
  AuthSession,
  AcademicYearRecord,
  DepartmentRecord,
  SubjectRecord,
  DepartmentScope,
  QuestionBankSource,
  ACADEMIC_YEARS
} from '../types';
import {
  INITIAL_USERS,
  INITIAL_SUBJECTS,
  INITIAL_QUESTIONS,
  INITIAL_EXAM_PATTERNS,
  INITIAL_IA1_SYLLABUS,
  INITIAL_IA2_SYLLABUS,
  INITIAL_PAPERS,
  INITIAL_DEPARTMENTS
} from '../data/initialData';
import { synthesizeSubjectQuestions } from '../utils/questionExtractor';
import {
  loginApi,
  logoutApi,
  fetchAcademicYears,
  fetchDepartments,
  fetchSubjects,
  fetchExamPatterns,
  updateExamPatternConfig,
  finalizePaperUsage,
  ExamPatternConfigRecord
} from '../services/authApi';
import { dbConfigToExamPattern, examPatternToDbPayload } from '../utils/examPatternMapper';
import { buildPaperFileName } from '../utils/paperFileName';

interface AppContextType {
  // ---- Auth ----
  currentUser: User;
  setCurrentUser: (user: User) => void;
  isAuthenticated: boolean;
  isLoggedIn: boolean;
  authSession: AuthSession | null;
  userRole: AuthRole | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isSuperAdminPortal: boolean; // kept for backward compat — derived from userRole
  isPrincipalPortal: boolean;  // NEW — derived from userRole === 'PRINCIPAL'
  navigateToPortal: (portal: 'examcell' | 'superadmin') => void; // kept for backward compat

  // ---- Navigation ----
  activeTab: string;
  setActiveTab: (tab: string) => void;

  // ---- Master data (from Supabase via backend) ----
  academicYears: string[];   // derived from DB for backward compat
  academicYearsList: AcademicYearRecord[];
  activeAcademicYearsList: AcademicYearRecord[];
  departmentsList: DepartmentRecord[];
  activeDepartmentsList: DepartmentRecord[];
  subjectsList: SubjectRecord[];       // all subjects from DB (used by Super Admin views)
  dbSubjects: SubjectRecord[];         // alias — same as subjectsList, for Exam Cell components
  departments: Array<{ code: string; name: string; hod?: string }>;
  selectedDeptScope: DepartmentScope;
  setSelectedDeptScope: (scope: DepartmentScope) => void;
  selectedCommonDepts: string[];
  setSelectedCommonDepts: (depts: string[]) => void;
  masterDataLoading: boolean;
  refreshMasterData: () => Promise<void>;

  // ---- Auth token (for Super Admin API calls) ----
  authToken: string | null;

  // ---- Subjects (local state — kept for paper gen compat) ----
  subjects: Subject[];
  addSubject: (subject: Omit<Subject, 'id' | 'totalQuestions'>) => void;
  updateSubject: (id: string, updates: Partial<Subject>) => void;
  deleteSubject: (id: string) => void;

  // ---- Questions ----
  questions: Question[];
  selectedSubjectCode: string;
  setSelectedSubjectCode: (code: string) => void;
  addQuestion: (question: Omit<Question, 'id' | 'usageHistory' | 'createdDate'>) => void;
  addQuestions: (questions: Array<Omit<Question, 'id' | 'usageHistory' | 'createdDate'>>) => Question[];
  updateQuestion: (id: string, updates: Partial<Question>) => void;
  deleteQuestion: (id: string) => void;

  // ---- Exam patterns ----
  examPatterns: ExamPattern[];
  updateExamPattern: (id: string, updates: Partial<ExamPattern>) => Promise<void>;
  examPatternConfigs: ExamPatternConfigRecord[];
  examPatternsLoading: boolean;
  examPatternsLoaded: boolean;
  refreshExamPatterns: () => Promise<void>;
  ia1Syllabus: UnitSyllabusConfig[];
  setIa1Syllabus: React.Dispatch<React.SetStateAction<UnitSyllabusConfig[]>>;
  ia2Syllabus: UnitSyllabusConfig[];
  setIa2Syllabus: React.Dispatch<React.SetStateAction<UnitSyllabusConfig[]>>;

  // ---- Paper generation ----
  generatedPapers: GeneratedPaper[];
  activePaper: GeneratedPaper | null;
  setActivePaper: (paper: GeneratedPaper | null) => void;
  /** Set by "View / Print" on the Generated Papers page so the wizard opens the preview (Spec §17) */
  paperToReviewId: string | null;
  setPaperToReviewId: (id: string | null) => void;
  generatePaper: (params: {
    subjectCode: string;
    examType: ExamType;
    examDate?: string;
    semester?: string;
    regulation?: string;
    duration?: string;
    department?: string;
    academicYear?: string;
    scope?: DepartmentScope;
    commonDepartments?: string[];
    departmentIds?: string[];
    /** Server-assigned set letter from GET /api/paper-sets/status (Spec §4) */
    setLetter?: string;
    /** Set name/title override */
    setDisplayName?: string;
    /** Spec §18 — approval that permitted an additional set */
    principalRequestId?: string | null;
    maxMarks?: number;
    /** DB-backed question count for the selected year/department/subject (Spec \u00a716) */
    availableQuestionCount?: number;
    /**
     * Spec §18 — when a Generated IAT Question Bank is chosen, the paper is
     * built ONLY from this pool. IAT-only: ignored for End Semester.
     */
    questionPool?: Question[];
    questionBankSource?: QuestionBankSource;
    iatGeneratedBankId?: string | null;
    iatGeneratedBankName?: string | null;
  }) => GeneratedPaper;
  replaceQuestionInPaper: (paperId: string, targetQuestionId: string, newQuestion: Question) => void;
  /** Removes a paper that was rolled back after a failed set registration (Spec §4) */
  removePaper: (paperId: string) => void;
  regeneratePaper: (paperId: string) => GeneratedPaper | null;
  updatePaperStatus: (paperId: string, newStatus: PaperStatus, reason?: string) => void;
  deletePaper: (paperId: string) => void;
  getNextSetLetter: (subjectCode: string, academicYear: string, examType: ExamType) => string;

  // ---- Users (legacy) ----
  users: User[];
  addUser: (user: Omit<User, 'id' | 'lastLogin'>) => void;
  updateUser: (id: string, updates: Partial<User>) => void;
  deleteUser: (id: string) => void;
  switchUserRole: (role: UserRole) => void;

  // ---- Misc ----
  resetQuestionUsage: (questionId: string) => void;
  toastMessage: string | null;
  showToast: (msg: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEYS = {
  SUBJECTS: 'msajce_subjects',
  QUESTIONS: 'msajce_questions',
  PAPERS: 'msajce_papers',
  PATTERNS: 'msajce_patterns',
  IA1_SYLLABUS: 'msajce_ia1_syllabus',
  IA2_SYLLABUS: 'msajce_ia2_syllabus',
  USERS: 'msajce_users',
  // Note: auth session is stored in memory ONLY — not localStorage
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // ============================================================
  // Auth state — session in memory only, never localStorage
  // ============================================================
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  const userRole: AuthRole | null = authSession?.role ?? null;
  const isSuperAdminPortal = userRole === 'SUPER_ADMIN';
  const isPrincipalPortal = userRole === 'PRINCIPAL';

  // ============================================================
  // Master data (Academic Years, Departments, Subjects from Supabase)
  // ============================================================
  const [academicYearsList, setAcademicYearsList] = useState<AcademicYearRecord[]>([]);
  const [departmentsList, setDepartmentsList] = useState<DepartmentRecord[]>([]);
  const [subjectsList, setSubjectsList] = useState<SubjectRecord[]>([]);
  const [masterDataLoading, setMasterDataLoading] = useState(false);

  const loadMasterData = useCallback(async () => {
    setMasterDataLoading(true);
    try {
      const [years, depts, subs] = await Promise.all([
        fetchAcademicYears(false),
        fetchDepartments(false),
        fetchSubjects({ activeOnly: false })
      ]);
      setAcademicYearsList(years);
      setDepartmentsList(depts);
      setSubjectsList(subs);
    } catch (err) {
      console.warn('[AppContext] Failed to load master data:', err);
    } finally {
      setMasterDataLoading(false);
    }
  }, []);

  // Load master data once on mount and whenever auth changes
  useEffect(() => {
    loadMasterData();
  }, [loadMasterData]);

  // ============================================================
  // Active-only lists for selector use
  const activeAcademicYearsList = academicYearsList.filter(y => y.status === 'active');
  const activeDepartmentsList = departmentsList.filter(d => (d.status === 'active' || d.is_active !== false) && !d.is_common);

  // Derive legacy departments from activeDepartmentsList (fallback to INITIAL_DEPARTMENTS if loading/empty)
  const departments = (activeDepartmentsList.length > 0 || departmentsList.length > 0)
    ? activeDepartmentsList.map(d => ({
        code: d.department_code,
        name: d.department_name,
        hod: d.hod_name || undefined
      }))
    : INITIAL_DEPARTMENTS;

  // Selected department scope & common departments state
  const [selectedDeptScope, setSelectedDeptScope] = useState<DepartmentScope>('SPECIFIC');
  const [selectedCommonDepts, setSelectedCommonDepts] = useState<string[]>([]);

  // Legacy academicYears array (string[]) for backward compat — derived from DB
  const academicYearsFromDb = academicYearsList.map(y => y.year_label) as string[];

  // ============================================================
  // Legacy user state (for paper generation compat)
  // ============================================================
  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.USERS);
      const parsed = saved ? JSON.parse(saved) : null;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
    return INITIAL_USERS;
  });

  // currentUser is derived from authSession when logged in
  const [_localCurrentUser, setLocalCurrentUser] = useState<User>(INITIAL_USERS[0]);
  const currentUser: User = authSession
    ? {
        id: authSession.userId,
        name: authSession.name,
        staffId: authSession.role === 'SUPER_ADMIN' ? 'SAD-0001' : authSession.role === 'PRINCIPAL' ? 'PRI-0001' : 'EXC-0018',
        email: authSession.email,
        department: 'AIML',
        role: authSession.role === 'SUPER_ADMIN' ? 'Super Admin' : authSession.role === 'PRINCIPAL' ? 'Principal' : 'Exam Cell',
        status: 'Active',
        lastLogin: 'Just now'
      }
    : _localCurrentUser;

  const setCurrentUser = (user: User) => setLocalCurrentUser(user);

  // ============================================================
  // Navigation
  // ============================================================
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [previousTab, setPreviousTab] = useState<string>('dashboard');

  const setActiveTabWithHistory = (tab: string) => {
    setPreviousTab(activeTab);
    setActiveTab(tab);
  };

  // ============================================================
  // Local state (subjects, questions, papers, patterns)
  // ============================================================
  const [selectedSubjectCode, setSelectedSubjectCode] = useState<string>('24AM411');

  const [subjects, setSubjects] = useState<Subject[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SUBJECTS);
      const parsed = saved ? JSON.parse(saved) : null;
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_SUBJECTS;
    } catch {
      return INITIAL_SUBJECTS;
    }
  });

  const [questions, setQuestions] = useState<Question[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.QUESTIONS);
      const parsed = saved ? JSON.parse(saved) : null;
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_QUESTIONS;
    } catch {
      return INITIAL_QUESTIONS;
    }
  });

  const dbSubjectsAsLegacySubjects = useMemo<Subject[]>(() => {
    return subjectsList
      .filter(s => s.status === 'active')
      .map(s => ({
        id: s.id,
        code: s.subject_code,
        name: s.subject_name,
        department: s.departments?.department_code || departmentsList.find(d => d.id === s.department_id)?.department_code || '',
        semester: s.semester || '',
        regulation: s.regulation || 'Regulation 2024',
        totalQuestions: questions.filter(q => q.subjectCode === s.subject_code).length,
        status: 'Active' as const,
        academicYear: s.academic_years?.year_label || academicYearsList.find(y => y.id === s.academic_year_id)?.year_label || '',
        units: []
      }));
  }, [subjectsList, departmentsList, academicYearsList, questions]);

  const effectiveSubjects = useMemo<Subject[]>(() => {
    if (dbSubjectsAsLegacySubjects.length === 0) return subjects;
    const merged = new Map<string, Subject>();
    subjects.forEach(s => merged.set(`${s.code}|${s.department}|${s.academicYear || ''}`, s));
    dbSubjectsAsLegacySubjects.forEach(s => merged.set(`${s.code}|${s.department}|${s.academicYear || ''}`, s));
    return Array.from(merged.values());
  }, [dbSubjectsAsLegacySubjects, subjects]);

  const [examPatterns, setExamPatterns] = useState<ExamPattern[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PATTERNS);
      const parsed = saved ? JSON.parse(saved) : null;
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_EXAM_PATTERNS;
    } catch {
      return INITIAL_EXAM_PATTERNS;
    }
  });

  const [ia1Syllabus, setIa1Syllabus] = useState<UnitSyllabusConfig[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.IA1_SYLLABUS);
      const parsed = saved ? JSON.parse(saved) : null;
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_IA1_SYLLABUS;
    } catch {
      return INITIAL_IA1_SYLLABUS;
    }
  });

  const [ia2Syllabus, setIa2Syllabus] = useState<UnitSyllabusConfig[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.IA2_SYLLABUS);
      const parsed = saved ? JSON.parse(saved) : null;
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_IA2_SYLLABUS;
    } catch {
      return INITIAL_IA2_SYLLABUS;
    }
  });

  const [generatedPapers, setGeneratedPapers] = useState<GeneratedPaper[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PAPERS);
      const parsed = saved ? JSON.parse(saved) : null;
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_PAPERS;
    } catch {
      return INITIAL_PAPERS;
    }
  });

  const [activePaper, setActivePaper] = useState<GeneratedPaper | null>(() => INITIAL_PAPERS[0] || null);
  const [paperToReviewId, setPaperToReviewId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ============================================================
  // Persist local state to localStorage
  // ============================================================
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify(subjects)); }, [subjects]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(questions)); }, [questions]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.PAPERS, JSON.stringify(generatedPapers)); }, [generatedPapers]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.PATTERNS, JSON.stringify(examPatterns)); }, [examPatterns]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.IA1_SYLLABUS, JSON.stringify(ia1Syllabus)); }, [ia1Syllabus]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.IA2_SYLLABUS, JSON.stringify(ia2Syllabus)); }, [ia2Syllabus]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users)); }, [users]);

  // ============================================================
  // Toast
  // ============================================================
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // ============================================================
  // Auth — real backend login
  // ============================================================
  const login = async (email: string, password: string): Promise<void> => {
    try {
      const result = await loginApi(email, password);
      const session: AuthSession = {
        userId: result.user.id,
        email: result.user.email,
        role: result.user.role,
        name: result.user.name,
        token: result.token
      };
      setAuthSession(session);
      setIsAuthenticated(true);

      // Spec §7 — route to the correct portal based on the authenticated role.
      // The portal itself is derived from userRole; each role lands on its
      // own home tab. Every privileged action is re-verified server-side.
      switch (result.user.role) {
        case 'SUPER_ADMIN':
          setActiveTab('dashboard');
          break;
        case 'PRINCIPAL':
          setActiveTab('dashboard');
          break;
        default:
          setActiveTab('dashboard');
      }

      showToast(`Welcome back, ${result.user.name}!`);
    } catch (err: any) {
      throw new Error(err?.message || 'Login failed.');
    }
  };

  const logout = () => {
    // Fire-and-forget logout audit — never blocks the UI
    if (authSession?.token) {
      logoutApi(authSession.token).catch(() => {});
    }
    setAuthSession(null);
    setIsAuthenticated(false);
    setActiveTab('dashboard');
    showToast('Logged out successfully.');
  };

  // Backward-compat stubs
  const navigateToPortal = (_portal: 'examcell' | 'superadmin') => {};

  // ============================================================
  // Subjects Management (local state)
  // ============================================================
  const addSubject = (newSub: Omit<Subject, 'id' | 'totalQuestions'>) => {
    const subject: Subject = { ...newSub, id: `sub-${Date.now()}`, totalQuestions: 0 };
    setSubjects(prev => [subject, ...prev]);
    showToast(`Subject "${subject.code} - ${subject.name}" added successfully.`);
  };

  const updateSubject = (id: string, updates: Partial<Subject>) => {
    setSubjects(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    showToast('Subject updated successfully.');
  };

  const deleteSubject = (id: string) => {
    setSubjects(prev => prev.filter(s => s.id !== id));
    showToast('Subject removed.');
  };

  // ============================================================
  // Questions Management
  // ============================================================
  const addQuestion = (newQ: Omit<Question, 'id' | 'usageHistory' | 'createdDate'>) => {
    const question: Question = {
      ...newQ,
      id: `${newQ.subjectCode.substring(0, 3)}-U${newQ.unit}-${newQ.part.replace('Part ', '')}-${Math.floor(100 + Math.random() * 900)}`,
      usageHistory: { internal1: false, internal2: false, endSem: false, timesUsed: 0 },
      createdDate: new Date().toISOString().split('T')[0]
    };
    setQuestions(prev => [question, ...prev]);
    setSubjects(prev => prev.map(s => s.code === question.subjectCode ? { ...s, totalQuestions: s.totalQuestions + 1 } : s));
    showToast(`Question [${question.id}] added to question bank.`);
  };

  const addQuestions = (newQs: Array<Omit<Question, 'id' | 'usageHistory' | 'createdDate'>>): Question[] => {
    const createdDate = new Date().toISOString().split('T')[0];
    const created: Question[] = newQs.map((q, idx) => ({
      ...q,
      id: `${q.subjectCode.substring(0, 3)}-U${q.unit}-${q.part.replace('Part ', '')}-${Math.floor(100 + Math.random() * 900)}${idx}`,
      usageHistory: { internal1: false, internal2: false, endSem: false, timesUsed: 0 },
      createdDate
    }));
    setQuestions(prev => [...created, ...prev]);
    const subjectCounts: Record<string, number> = {};
    created.forEach(q => { subjectCounts[q.subjectCode] = (subjectCounts[q.subjectCode] || 0) + 1; });
    setSubjects(prev => prev.map(s => {
      const added = subjectCounts[s.code] || 0;
      return added > 0 ? { ...s, totalQuestions: s.totalQuestions + added } : s;
    }));
    showToast(`${created.length} questions successfully imported into question bank.`);
    return created;
  };

  const updateQuestion = (id: string, updates: Partial<Question>) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, ...updates } : q));
    showToast('Question details updated.');
  };

  const deleteQuestion = (id: string) => {
    const target = questions.find(q => q.id === id);
    if (target) {
      setSubjects(prev => prev.map(s => s.code === target.subjectCode ? { ...s, totalQuestions: Math.max(0, s.totalQuestions - 1) } : s));
    }
    setQuestions(prev => prev.filter(q => q.id !== id));
    showToast('Question removed from bank.');
  };

  // ============================================================
  // Exam Patterns — loaded from Supabase `exam_pattern_configs` (Spec §1)
  // Falls back to the bundled defaults when the API is unreachable so the
  // generator keeps working offline.
  // ============================================================
  const [examPatternConfigs, setExamPatternConfigs] = useState<ExamPatternConfigRecord[]>([]);
  const [examPatternsLoading, setExamPatternsLoading] = useState(false);
  const [examPatternsLoaded, setExamPatternsLoaded] = useState(false);

  const refreshExamPatterns = useCallback(async () => {
    setExamPatternsLoading(true);
    try {
      const rows = await fetchExamPatterns();
      if (rows.length > 0) {
        setExamPatternConfigs(rows);
        // Keep local state in sync for the paper generator
        setExamPatterns(prev => {
          const byType = new Map(rows.map(r => [r.exam_type, r]));
          const next = prev.map(p => {
            const row = byType.get(p.examType);
            return row ? dbConfigToExamPattern(row) : p;
          });
          // Add any exam types that exist in the DB but not in local state
          rows.forEach(r => {
            if (!next.some(p => p.examType === r.exam_type)) {
              next.push(dbConfigToExamPattern(r));
            }
          });
          return next;
        });
        setExamPatternsLoaded(true);
      }
    } catch (err) {
      console.warn('[AppContext] Failed to load exam patterns:', err);
    } finally {
      setExamPatternsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshExamPatterns();
  }, [refreshExamPatterns]);

  /**
   * Persists an edited pattern to the database (source of truth) and mirrors
   * it into local state. The backend re-validates the total marks and rejects
   * the save when Part A + Part B (+ Part C) does not equal Total Marks.
   */
  const updateExamPattern = async (id: string, updates: Partial<ExamPattern>) => {
    const target = examPatterns.find(p => p.id === id);
    if (!target) {
      showToast('Exam pattern not found.');
      return;
    }
    const merged: ExamPattern = { ...target, ...updates };
    const row = examPatternConfigs.find(r => r.exam_type === merged.examType);

    if (!row) {
      // No database row — keep the in-memory update (offline mode)
      setExamPatterns(prev => prev.map(p => (p.id === id ? merged : p)));
      showToast('Exam pattern updated locally (pattern row not found in database).');
      return;
    }

    if (!authSession?.token) {
      setExamPatterns(prev => prev.map(p => (p.id === id ? merged : p)));
      showToast('Exam pattern updated locally. Sign in to save it to the database.');
      return;
    }

    setExamPatternsLoading(true);
    try {
      const payload = examPatternToDbPayload(merged, row);
      const saved = await updateExamPatternConfig(row.id, payload, authSession.token);
      setExamPatternConfigs(prev => prev.map(r => (r.id === saved.id ? saved : r)));
      setExamPatterns(prev => prev.map(p => (p.id === id ? dbConfigToExamPattern(saved) : p)));
      showToast(`${merged.examType} pattern saved successfully.`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to save exam pattern.');
    } finally {
      setExamPatternsLoading(false);
    }
  };

  // ============================================================
  // Set Letter Logic
  // ============================================================
  const getNextSetLetter = (subjectCode: string, academicYear: string, examType: ExamType): string => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const existing = generatedPapers
      .filter(p => p.subjectCode === subjectCode && p.academicYear === academicYear && p.examType === examType && p.setLetter)
      .map(p => p.setLetter as string);
    for (const letter of alphabet) {
      if (!existing.includes(letter)) return letter;
    }
    return 'A';
  };

  // ============================================================
  // Paper Generation (unchanged logic)
  // ============================================================

  /**
   * Selected Generated IAT Question Bank pools, keyed by generated bank id.
   * Spec §29 — "IAT Bank 01" is NOT "Set A". Re-rolling a paper (regeneratePaper)
   * must keep drawing from the SAME reduced bank, otherwise a re-roll would
   * silently fall back to the full original bank.
   */
  const iatBankPoolsRef = useRef<Map<string, Question[]>>(new Map());

  const generatePaper = ({
    subjectCode, examType, examDate, semester, regulation, duration, department, academicYear,
    scope, commonDepartments, departmentIds, setLetter: setLetterOverride,
    setDisplayName: setDisplayNameOverride, principalRequestId, maxMarks: maxMarksOverride,
    availableQuestionCount,
    questionPool, questionBankSource, iatGeneratedBankId, iatGeneratedBankName
  }: {
    subjectCode: string; examType: ExamType; examDate?: string; semester?: string;
    regulation?: string; duration?: string; department?: string; academicYear?: string;
    scope?: DepartmentScope; commonDepartments?: string[]; departmentIds?: string[];
    setLetter?: string; setDisplayName?: string; principalRequestId?: string | null; maxMarks?: number;
    availableQuestionCount?: number;
    questionPool?: Question[];
    questionBankSource?: QuestionBankSource;
    iatGeneratedBankId?: string | null;
    iatGeneratedBankName?: string | null;
  }): GeneratedPaper => {
    let subject = subjects.find(s => s.code === subjectCode);
    if (!subject) {
      if (department) {
        subject = subjects.find(s => s.department === department) || subjects[0];
      } else {
        subject = subjects[0];
      }
    }

    const isIA1 = examType === 'Internal Assessment I';
    const isIA2 = examType === 'Internal Assessment II';
    const isEndSem = examType === 'End Semester Examination';

    const allowedUnits = isIA1 ? [1, 2, 3] : isIA2 ? [3, 4, 5] : [1, 2, 3, 4, 5];
    let currentQuestions = [...questions];

    // ---------------------------------------------------------------
    // Spec §18 / §19 / §30 — Generated IAT Question Bank source.
    //   * IAT I / IAT II may be restricted to a reduced IAT bank.
    //   * End Semester NEVER uses a reduced bank; the original, full
    //     question-bank logic is used unchanged.
    // ---------------------------------------------------------------
    const useIatBank = !isEndSem && Array.isArray(questionPool) && questionPool.length > 0;
    const effectiveBankSource: QuestionBankSource = useIatBank ? 'IAT_GENERATED' : 'ORIGINAL';
    const effectiveIatBankId = useIatBank ? (iatGeneratedBankId ?? null) : null;
    const effectiveIatBankName = useIatBank ? (iatGeneratedBankName ?? null) : null;

    let poolForSubject: Question[] = useIatBank
      ? (questionPool as Question[]).slice()
      : currentQuestions.filter(q => q.subjectCode === subject!.code);

    if (useIatBank && effectiveIatBankId) {
      iatBankPoolsRef.current.set(effectiveIatBankId, poolForSubject.slice());
    }

    const minRequiredCount = isEndSem ? 22 : 12;
    let validationIssues: string[] = [];
    let validationPassed = true;

    // Spec §16 — the availability check must use the SAME source the Step 3
    // card shows. `availableQuestionCount` comes from
    // GET /api/subjects/question-counts (database). When it is provided it is
    // authoritative; otherwise we fall back to the locally cached pool.
    // A selected IAT generated bank IS the authoritative pool, so the check
    // is done against it directly.
    const dbAvailable = useIatBank
      ? poolForSubject.length
      : (typeof availableQuestionCount === 'number' ? availableQuestionCount : null);

    // Authoritative availability = database count, enriched by any questions
    // already synced locally for this subject.
    const effectiveAvailable = dbAvailable !== null
      ? Math.max(dbAvailable, poolForSubject.length)
      : poolForSubject.length;

    if (effectiveAvailable < minRequiredCount) {
      validationPassed = false;
      validationIssues.push(
        dbAvailable !== null
          ? `Question bank contains insufficient questions for ${subject.code}: ${effectiveAvailable} available in the database (minimum required for ${examType}: ${minRequiredCount}).`
          : `Question Bank has only ${poolForSubject.length} questions for ${subject.code} (minimum required for ${examType}: ${minRequiredCount}). Additional questions were automatically synthesized for blueprint preview.`
      );
    }

    // Synthesised filler is only acceptable when we have no database count
    // to trust. With a database count we report the shortfall instead of
    // silently padding the paper with invented questions.
    // A selected Generated IAT Question Bank is NEVER padded — its question
    // set is exactly what the user asked for (Spec §2, §7).
    if (validationPassed === false && dbAvailable === null && !useIatBank) {
      const synthesized = synthesizeSubjectQuestions(subject);
      const existingTexts = new Set(poolForSubject.map(q => q.questionText.trim().toLowerCase()));
      const toAdd = synthesized.filter(q => !existingTexts.has(q.questionText.trim().toLowerCase()));
      if (toAdd.length > 0) {
        currentQuestions = [...toAdd, ...currentQuestions];
        setQuestions(currentQuestions);
        setSubjects(prev => prev.map(s => s.code === subject!.code ? { ...s, totalQuestions: s.totalQuestions + toAdd.length } : s));
        poolForSubject = [...toAdd, ...poolForSubject];
        validationPassed = true;
        validationIssues = validationIssues.filter(i => !i.includes('synthesized'));
      }
    }

    let subjectQuestions = poolForSubject.filter(q => {
      if (!allowedUnits.includes(q.unit)) return false;
      if (isIA1 && !q.allowedFor.internal1) return false;
      if (isIA2 && !q.allowedFor.internal2) return false;
      if (isEndSem && !q.allowedFor.endSem) return false;
      return true;
    });

    if (subjectQuestions.length < (isEndSem ? 15 : 8)) {
      subjectQuestions = poolForSubject.filter(q => allowedUnits.includes(q.unit));
    }
    if (subjectQuestions.length === 0) subjectQuestions = poolForSubject;

    const pickQuestions = (pool: Question[], count: number, usedIds: Set<string>, unitFilter?: number): Question[] => {
      let filtered = pool.filter(q => !usedIds.has(q.id));
      if (unitFilter !== undefined) {
        const byUnit = filtered.filter(q => q.unit === unitFilter);
        if (byUnit.length > 0) filtered = byUnit;
      }
      if (filtered.length < count) {
        const fallback = pool.filter(q => unitFilter === undefined || q.unit === unitFilter);
        if (fallback.length >= count) filtered = fallback;
        else if (pool.length > 0) filtered = pool;
      }
      const sorted = [...filtered].sort((a, b) => {
        const aUsed = isIA1 ? a.usageHistory.internal1 : isIA2 ? a.usageHistory.internal2 : a.usageHistory.endSem;
        const bUsed = isIA1 ? b.usageHistory.internal1 : isIA2 ? b.usageHistory.internal2 : b.usageHistory.endSem;
        if (aUsed !== bUsed) return aUsed ? 1 : -1;
        return a.usageHistory.timesUsed - b.usageHistory.timesUsed;
      });
      const shuffled = [...sorted].sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, count);
      selected.forEach(q => usedIds.add(q.id));
      return selected;
    };

    const usedIds = new Set<string>();
    const paperCode = `QP-${new Date().getFullYear()}-${isIA1 ? 'IA1' : isIA2 ? 'IA2' : 'END'}-${Math.floor(10 + Math.random() * 90)}`;

    let partAItems: GeneratedPaper['partAQuestions'] = [];
    let partBItems: GeneratedPaper['partBQuestions'] = [];
    let partCItems: GeneratedPaper['partCQuestions'] = [];

    const partAPool = subjectQuestions.filter(q => q.part === 'Part A');
    const partBPool = subjectQuestions.filter(q => q.part === 'Part B');
    const partCPool = subjectQuestions.filter(q => q.part === 'Part C');

    if (isIA1 || isIA2) {
      const selectedPartA = pickQuestions(partAPool.length >= 4 ? partAPool : subjectQuestions, 4, usedIds);
      partAItems = selectedPartA.map((q, idx) => ({ questionId: q.id, questionNumber: String(idx + 1), question: q }));

      const uPoolA = isIA1 ? [1, 2] : [3, 4];
      const uPoolB = isIA1 ? [2, 3] : [4, 5];
      const secAPool = partBPool.filter(q => uPoolA.includes(q.unit));
      const secBPool = partBPool.filter(q => uPoolB.includes(q.unit));
      const sectionAQuestions = pickQuestions(secAPool.length >= 3 ? secAPool : partBPool, 3, usedIds);
      const sectionBQuestions = pickQuestions(secBPool.length >= 3 ? secBPool : partBPool, 3, usedIds);
      while (sectionAQuestions.length < 3 && partBPool.length > 0) sectionAQuestions.push(partBPool[sectionAQuestions.length % partBPool.length]);
      while (sectionBQuestions.length < 3 && partBPool.length > 0) sectionBQuestions.push(partBPool[(sectionAQuestions.length + sectionBQuestions.length) % partBPool.length]);

      partBItems = [
        ...sectionAQuestions.slice(0, 3).map((q, idx) => ({ questionId: q.id, questionNumber: String(5 + idx), question: q, choiceGroup: 'Section A' })),
        ...sectionBQuestions.slice(0, 3).map((q, idx) => ({ questionId: q.id, questionNumber: String(8 + idx), question: q, choiceGroup: 'Section B' }))
      ];
    } else {
      const selectedPartA: Question[] = [];
      for (let u = 1; u <= 5; u++) {
        const uPool = partAPool.filter(q => q.unit === u);
        const picked = pickQuestions(uPool.length >= 2 ? uPool : partAPool, 2, usedIds, u);
        selectedPartA.push(...picked);
      }
      while (selectedPartA.length < 10 && partAPool.length > 0) {
        const extra = pickQuestions(partAPool, 10 - selectedPartA.length, usedIds);
        if (extra.length === 0) selectedPartA.push(partAPool[selectedPartA.length % partAPool.length]);
        else selectedPartA.push(...extra);
      }
      partAItems = selectedPartA.slice(0, 10).map((q, idx) => ({ questionId: q.id, questionNumber: String(idx + 1), question: q }));

      const bItems: GeneratedPaper['partBQuestions'] = [];
      for (let u = 1; u <= 5; u++) {
        const qNum = 10 + u;
        const uPool = partBPool.filter(q => q.unit === u);
        let pair = pickQuestions(uPool.length >= 2 ? uPool : partBPool, 2, usedIds, u);
        if (pair.length < 2) {
          const fallbackPair = partBPool.filter(q => !pair.some(p => p.id === q.id));
          if (fallbackPair.length > 0) pair = [...pair, fallbackPair[0]];
          else if (partBPool.length > 0) pair = [...pair, partBPool[0]];
        }
        if (pair.length >= 2) {
          bItems.push(
            { questionId: pair[0].id, questionNumber: `${qNum}. a`, question: pair[0], choiceGroup: `Q${qNum}`, isOrOptionB: false },
            { questionId: pair[1].id, questionNumber: `${qNum}. b`, question: pair[1], choiceGroup: `Q${qNum}`, isOrOptionB: true }
          );
        } else if (pair.length === 1) {
          bItems.push(
            { questionId: pair[0].id, questionNumber: `${qNum}. a`, question: pair[0], choiceGroup: `Q${qNum}`, isOrOptionB: false },
            { questionId: pair[0].id, questionNumber: `${qNum}. b`, question: pair[0], choiceGroup: `Q${qNum}`, isOrOptionB: true }
          );
        }
      }
      partBItems = bItems;

      const candidateCPool = partCPool.length >= 2 ? partCPool : partBPool;
      let cPair = pickQuestions(candidateCPool, 2, usedIds);
      if (cPair.length < 2) {
        const fallback = candidateCPool.filter(q => !cPair.some(p => p.id === q.id));
        if (fallback.length > 0) cPair = [...cPair, fallback[0]];
        else if (candidateCPool.length > 0) cPair = [...cPair, candidateCPool[0]];
      }
      if (cPair.length >= 2) {
        partCItems = [
          { questionId: cPair[0].id, questionNumber: '16. a', question: cPair[0], choiceGroup: 'Q16', isOrOptionB: false },
          { questionId: cPair[1].id, questionNumber: '16. b', question: cPair[1], choiceGroup: 'Q16', isOrOptionB: true }
        ];
      }
    }

    const resolvedAcademicYear = academicYear || subject.academicYear || '2024-2025';
    // Spec §4 — the set letter is allocated by the backend from the database.
    // The local fallback only applies when the API is unreachable.
    const setLetter = setLetterOverride || getNextSetLetter(subject.code, resolvedAcademicYear, examType);
    const setDisplayName = setDisplayNameOverride || `${subject.name} \u2013 Set ${setLetter}`;

    const resolvedDept = scope === 'COMMON' ? 'COMMON' : (department || subject.department);
    const deptRecord = activeDepartmentsList.find(d => d.department_code === resolvedDept);
    const departmentName = deptRecord ? deptRecord.department_name : (resolvedDept === 'COMMON' ? 'Common Engineering Departments' : resolvedDept);

    const commonToLabel = (commonDepartments && commonDepartments.length > 0)
      ? `(Common to ${commonDepartments.join(', ')})`
      : undefined;

    const examDateVal = examDate || new Date().toISOString().split('T')[0];
    const examDateObj = new Date(examDateVal);
    const monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    const examMonth = `${monthNames[examDateObj.getMonth()]} ${examDateObj.getFullYear()}`;

    const courseObjectives = [
      'To understand the fundamental concepts and principles of the subject.',
      'To analyze real-world problem statements and select optimal algorithmic or domain solutions.',
      'To design and implement robust engineering solutions complying with modern academic standards.',
      'To evaluate performance, efficiency, and ethical implications in engineering applications.'
    ];

    const courseOutcomes = [
      { code: 'CO1', description: 'Understand and recall the core theoretical principles.' },
      { code: 'CO2', description: 'Apply concepts to solve structured domain problems.' },
      { code: 'CO3', description: 'Analyze systems and interpret experimental or analytical data.' },
      { code: 'CO4', description: 'Design components or processes meeting specified requirements.' },
      { code: 'CO5', description: 'Evaluate engineering solutions and propose optimized alternatives.' }
    ];

    // Determine year of study e.g. '3rd Year'
    const semNum = parseInt(semester || subject.semester || '5', 10);
    const yearOfStudy = semNum <= 2 ? '1st Year' : semNum <= 4 ? '2nd Year' : semNum <= 6 ? '3rd Year' : '4th Year';

    const newPaper: GeneratedPaper = {
      id: `paper-${Date.now()}`,
      paperCode,
      subjectCode: subject.code,
      subjectName: subject.name,
      department: resolvedDept,
      departmentName,
      scope: scope || (department === 'COMMON' ? 'COMMON' : 'SPECIFIC'),
      commonDepartments: commonDepartments || [],
      departmentIds: departmentIds || [],
      commonToLabel,
      semester: semester || subject.semester,
      regulation: regulation || subject.regulation,
      examType,
      examDate: examDateVal,
      examMonth,
      duration: duration || (isEndSem ? '3 Hours' : '2 Hours'),
      maxMarks: maxMarksOverride || (isEndSem ? 100 : 60),
      academicYear: resolvedAcademicYear,
      status: 'Draft',
      createdBy: currentUser.name,
      createdDate: new Date().toISOString().split('T')[0],
      courseObjectives,
      courseOutcomes,
      yearOfStudy,
      partAQuestions: partAItems,
      partBQuestions: partBItems,
      partCQuestions: partCItems,
      validationPassed,
      validationIssues,
      setLetter,
      setName: `Set ${setLetter}`,
      setDisplayName,
      fileName: buildPaperFileName({ subjectCode: subject.code, examType, setLetter, extension: 'pdf' }),
      principalRequestId: principalRequestId || null,
      principalApprovalRequired: Boolean(principalRequestId),
      principalApprovalStatus: principalRequestId ? 'approved' : 'not_required',
      generatedBy: currentUser.name,
      generatedAt: new Date().toISOString(),
      // Spec §18 / §19 / §29 — records which question bank the paper came
      // from. End Semester is always 'ORIGINAL'.
      questionBankSource: effectiveBankSource,
      iatGeneratedBankId: effectiveIatBankId,
      iatGeneratedBankName: effectiveIatBankName
    };

    setGeneratedPapers(prev => [newPaper, ...prev]);
    setActivePaper(newPaper);
    showToast(`Paper [${paperCode}] generated successfully for ${subject.code}.`);
    return newPaper;
  };

  // ============================================================
  // Paper Management
  // ============================================================
  const replaceQuestionInPaper = (paperId: string, targetQuestionId: string, newQuestion: Question) => {
    setGeneratedPapers(prev => prev.map(paper => {
      if (paper.id !== paperId) return paper;
      const replaceInList = (list: GeneratedPaper['partAQuestions']) =>
        list.map(item => item.questionId === targetQuestionId ? { ...item, questionId: newQuestion.id, question: newQuestion } : item);
      return {
        ...paper,
        partAQuestions: replaceInList(paper.partAQuestions),
        partBQuestions: replaceInList(paper.partBQuestions),
        partCQuestions: paper.partCQuestions ? replaceInList(paper.partCQuestions) : undefined
      };
    }));
    if (activePaper && activePaper.id === paperId) {
      const replaceInList = (list: GeneratedPaper['partAQuestions']) =>
        list.map(item => item.questionId === targetQuestionId ? { ...item, questionId: newQuestion.id, question: newQuestion } : item);
      setActivePaper(prev => prev ? ({
        ...prev,
        partAQuestions: replaceInList(prev.partAQuestions),
        partBQuestions: replaceInList(prev.partBQuestions),
        partCQuestions: prev.partCQuestions ? replaceInList(prev.partCQuestions) : undefined
      }) : null);
    }
    showToast(`Question replaced with [${newQuestion.id}].`);
  };

  /**
   * Re-rolls the question selection for an EXISTING paper.
   * This is NOT a new set — it keeps the same Academic Year / Department /
   * Subject / Exam Type / Set identity, so it never consumes a set slot and
   * cannot be used to bypass the generation limit.
   */
  const regeneratePaper = (paperId: string): GeneratedPaper | null => {
    const target = generatedPapers.find(p => p.id === paperId) || activePaper;
    if (!target) return null;
    // Spec §29 — a re-roll of a paper built from a Generated IAT Question Bank
    // must keep using that same reduced bank, never the full original bank.
    const cachedPool = target.iatGeneratedBankId
      ? iatBankPoolsRef.current.get(target.iatGeneratedBankId)
      : undefined;
    const fresh = generatePaper({
      subjectCode: target.subjectCode,
      examType: target.examType,
      examDate: target.examDate,
      semester: target.semester,
      regulation: target.regulation,
      duration: target.duration,
      department: target.department,
      academicYear: target.academicYear,
      scope: target.scope,
      commonDepartments: target.commonDepartments,
      departmentIds: target.departmentIds,
      setLetter: target.setLetter,
      setDisplayName: target.setDisplayName,
      maxMarks: target.maxMarks,
      questionPool: cachedPool,
      questionBankSource: target.questionBankSource,
      iatGeneratedBankId: target.iatGeneratedBankId,
      iatGeneratedBankName: target.iatGeneratedBankName
    });
    setGeneratedPapers(prev => [fresh, ...prev.filter(p => p.id !== paperId && p.id !== fresh.id)]);
    setActivePaper(fresh);
    showToast(`New question combination generated for Set ${target.setLetter || 'A'}.`);
    return fresh;
  };

  const updatePaperStatus = (paperId: string, newStatus: PaperStatus, reason?: string) => {
    setGeneratedPapers(prev => prev.map(paper => {
      if (paper.id !== paperId) return paper;
      const updated = { ...paper, status: newStatus, rejectionReason: reason };
      if (newStatus === 'Faculty Reviewed') updated.reviewedBy = currentUser.name;
      else if (newStatus === 'Approved') updated.approvedBy = currentUser.name;
      else if (newStatus === 'Finalized') {
        // Spec §16 — question usage is recorded ONLY here: after the paper has
        // been generated, reviewed and finalized. Cancelled or rejected
        // papers never reach this branch, so no usage is recorded for them.
        //
        // Spec §12 / §29 — when the paper was built from a Generated IAT
        // Question Bank, usage is recorded against the ORIGINAL source
        // question id, not against the reduced bank. The reduced bank itself
        // is a selection, not a new question.
        const allItems = [
          ...paper.partAQuestions,
          ...paper.partBQuestions,
          ...(paper.partCQuestions || [])
        ];
        const sourceIdOf = (questionId: string, fallback: Question | undefined) =>
          fallback?.sourceQuestionId || questionId;
        const questionById = new Map<string, Question | undefined>();
        questions.forEach((q) => questionById.set(q.id, q));

        const allPaperQIds = allItems.map((item) => sourceIdOf(item.questionId, questionById.get(item.questionId)));
        const isIA1 = paper.examType === 'Internal Assessment I';
        const isIA2 = paper.examType === 'Internal Assessment II';
        const isEnd = paper.examType === 'End Semester Examination';
        setQuestions(qList => qList.map(q => {
          if (!allPaperQIds.includes(q.id)) return q;
          return {
            ...q,
            usageHistory: {
              ...q.usageHistory,
              internal1: isIA1 ? true : q.usageHistory.internal1,
              internal2: isIA2 ? true : q.usageHistory.internal2,
              endSem: isEnd ? true : q.usageHistory.endSem,
              lastUsedDate: new Date().toISOString().split('T')[0],
              lastUsedPaperCode: paper.paperCode,
              timesUsed: q.usageHistory.timesUsed + 1
            }
          };
        }));

        // Persist usage + mark the paper Finalized in the database
        if (authSession?.token) {
          finalizePaperUsage({
            paperCode: paper.paperCode,
            examType: paper.examType,
            questionIds: Array.from(new Set(allPaperQIds)),
            questionBankSource: paper.questionBankSource || 'ORIGINAL',
            iatGeneratedBankId: paper.iatGeneratedBankId || null
          }, authSession.token).catch(() => {});
        }
      }
      return updated;
    }));
    if (activePaper && activePaper.id === paperId) {
      setActivePaper(prev => prev ? ({ ...prev, status: newStatus, rejectionReason: reason }) : null);
    }
    showToast(`Paper status updated to: ${newStatus}`);
  };

  const deletePaper = (paperId: string) => {
    setGeneratedPapers(prev => prev.filter(p => p.id !== paperId));
    if (activePaper && activePaper.id === paperId) setActivePaper(null);
    showToast('Paper deleted.');
  };

  /**
   * Removes a paper that was created locally but then rejected by the server
   * (duplicate set / limit reached / invalid approval). Without this a failed
   * registration would leave a ghost paper in the list that was never
   * legitimately generated.
   */
  const removePaper = (paperId: string) => {
    setGeneratedPapers(prev => prev.filter(p => p.id !== paperId));
    if (activePaper && activePaper.id === paperId) setActivePaper(null);
  };

  // ============================================================
  // Legacy Users Management
  // ============================================================
  const addUser = (newUser: Omit<User, 'id' | 'lastLogin'>) => {
    const user: User = { ...newUser, id: `usr-${Date.now()}`, lastLogin: 'Never' };
    setUsers(prev => [user, ...prev]);
    showToast(`User ${user.name} created.`);
  };
  const updateUser = (id: string, updates: Partial<User>) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
    showToast('User profile updated.');
  };
  const deleteUser = (id: string) => {
    setUsers(prev => prev.filter(u => u.id !== id));
    showToast('User deleted.');
  };
  const switchUserRole = (_role: UserRole) => {};

  const resetQuestionUsage = (questionId: string) => {
    setQuestions(prev => prev.map(q =>
      q.id === questionId
        ? { ...q, usageHistory: { internal1: false, internal2: false, endSem: false, timesUsed: 0, lastUsedDate: undefined, lastUsedPaperCode: undefined } }
        : q
    ));
    showToast('Question usage history reset.');
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        isAuthenticated,
        isLoggedIn: isAuthenticated,
        authSession,
        userRole,
        login,
        logout,
        isSuperAdminPortal,
        isPrincipalPortal,
        navigateToPortal,
        activeTab,
        setActiveTab: setActiveTabWithHistory,
        academicYears: academicYearsFromDb.length > 0 ? academicYearsFromDb : [...ACADEMIC_YEARS],
        academicYearsList,
        activeAcademicYearsList,
        departmentsList,
        activeDepartmentsList,
        subjectsList,
        dbSubjects: subjectsList,
        departments,
        selectedDeptScope,
        setSelectedDeptScope,
        selectedCommonDepts,
        setSelectedCommonDepts,
        masterDataLoading,
        refreshMasterData: loadMasterData,
        authToken: authSession?.token ?? null,
        subjects: effectiveSubjects,
        addSubject,
        updateSubject,
        deleteSubject,
        questions,
        selectedSubjectCode,
        setSelectedSubjectCode,
        addQuestion,
        addQuestions,
        updateQuestion,
        deleteQuestion,
        resetQuestionUsage,
        examPatterns,
        updateExamPattern,
        examPatternConfigs,
        examPatternsLoading,
        examPatternsLoaded,
        refreshExamPatterns,
        ia1Syllabus,
        setIa1Syllabus,
        ia2Syllabus,
        setIa2Syllabus,
        generatedPapers,
        activePaper,
        setActivePaper,
        paperToReviewId,
        setPaperToReviewId,
        generatePaper,
        replaceQuestionInPaper,
        regeneratePaper,
        removePaper,
        updatePaperStatus,
        deletePaper,
        getNextSetLetter,
        users,
        addUser,
        updateUser,
        deleteUser,
        switchUserRole,
        toastMessage,
        showToast
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
