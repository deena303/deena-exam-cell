// ============================================================
// Role types — new backend-aligned roles
// ============================================================
export type UserRole = 'Exam Cell' | 'Super Admin' | 'Principal'; // Legacy UI label
export type AuthRole = 'EXAM_CELL' | 'SUPER_ADMIN' | 'PRINCIPAL'; // Backend JWT role

export type Department = 'CSE' | 'AIDS' | 'AIML' | 'IT' | 'ECE' | 'MECH' | 'CIVIL' | string;
export type DepartmentScope = 'SPECIFIC' | 'COMMON';

export interface DepartmentInfo {
  code: string;
  name: string;
  hod?: string;
}

export type ExamType = 'Internal Assessment I' | 'Internal Assessment II' | 'End Semester Examination';

export type QuestionPart = 'Part A' | 'Part B' | 'Part C';

export type BloomsLevel = 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6';

// ============================================================
// IAT Question Bank Generator (Spec §1–§30)
// ============================================================

/** The generator is IAT-only. End Semester is never included (Spec §19, §30). */
export type IatExamType = 'Internal Assessment I' | 'Internal Assessment II';

export const IAT_EXAM_TYPES: IatExamType[] = ['Internal Assessment I', 'Internal Assessment II'];

/** Which bank a paper is built from (Spec §18). */
export type QuestionBankSource = 'ORIGINAL' | 'IAT_GENERATED';

export type IatGeneratedBankStatus = 'Active' | 'Archived';

/** `question_banks.bank_type` — ORIGINAL rows are uploaded banks. */
export type QuestionBankType = 'ORIGINAL' | 'IAT_GENERATED';

export interface SourceBankUnitStat {
  unit: number;
  partA: number;
  partB: number;
  partC: number;
  total: number;
}

/** Original Question Bank Statistics (Spec §4, §25). */
export interface SourceBankStats {
  questionBankId: string;
  subjectCode: string;
  subjectName: string | null;
  academicYear: string | null;
  department: string | null;
  fileName: string;
  partA: number;
  partB: number;
  partC: number;
  /** Part B + Part C combined pool (Spec §6, §25) */
  partBc: number;
  total: number;
  units: SourceBankUnitStat[];
}

export interface SelectedIatQuestion {
  /** The ORIGINAL `questions.id` this was selected from (Spec §12). */
  sourceQuestionId: string;
  sourceQuestionNumber: string;
  questionText: string;
  /** Always the ORIGINAL part of the source question — never reclassified. */
  originalPart: QuestionPart;
  unit: number | null;
  marks: number | null;
  btl: string | null;
  bloomsLevel: string | null;
  co: string | null;
  pi: string | null;
  difficulty: string | null;
  orGroupId: string | null;
  orOption: string | null;
  sourcePage: number | null;
  subjectCode: string;
  orderIndex: number;
  timesUsed: number;
}

export interface UnitDistributionRow {
  unit: number;
  partA: number;
  partB: number;
  partC: number;
  total: number;
}

/** Result of the "Generate IAT Question Bank" preview (Spec §14). */
export interface IatPreview {
  sourceBankId: string;
  sourceBankName: string;
  academicYear: string | null;
  department: string | null;
  subjectCode: string;
  subjectName: string;
  examType: IatExamType;
  requestedPartA: number;
  requestedPartBC: number;
  actualPartA: number;
  actualPartB: number;
  actualPartC: number;
  totalQuestions: number;
  partA: SelectedIatQuestion[];
  partBC: SelectedIatQuestion[];
  unitDistribution: { partA: UnitDistributionRow[]; partBC: UnitDistributionRow[] };
  seed: number;
  selectionMethod: 'deterministic' | 'gemini';
  suggestedName: string;
  generatedAt: string;
}

export interface IatGeneratedBank {
  id: string;
  questionBankId: string;
  sourceQuestionBankId: string;
  sourceBankName: string | null;
  academicYear: string | null;
  department: string | null;
  subjectCode: string;
  subjectName: string | null;
  name: string;
  requestedPartACount: number;
  requestedPartBcCount: number;
  actualPartACount: number;
  actualPartBCount: number;
  actualPartCCount: number;
  totalQuestions: number;
  status: IatGeneratedBankStatus;
  selectionMethod: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
}

export interface IatGeneratedBankDetail extends IatGeneratedBank {
  unitDistribution: { partA: UnitDistributionRow[]; partBC: UnitDistributionRow[] } | null;
  questions: SelectedIatQuestion[];
}

/** A generated bank expressed as an IAT paper-generation pool (Spec §18). */
export interface IatPaperPoolQuestion {
  sourceQuestionId: string;
  questionText: string;
  originalPart: QuestionPart;
  unit: number | null;
  marks: number | null;
  btl: string | null;
  bloomsLevel: string | null;
  co: string | null;
  pi: string | null;
  difficulty: string | null;
  subjectCode: string;
}

export interface IatPaperPool {
  generatedBankId: string;
  name: string;
  totalQuestions: number;
  questions: IatPaperPoolQuestion[];
}

export type PaperStatus = 'Draft' | 'Faculty Reviewed' | 'HOD Review' | 'Approved' | 'Finalized' | 'Rejected';

/** Available academic years — now loaded from Supabase, this is a fallback */
export const ACADEMIC_YEARS = [
  '2024-2028',
  '2025-2029',
  '2026-2030',
  '2023-2027',
  '2022-2026'
] as const;

export type AcademicYear = typeof ACADEMIC_YEARS[number];

export interface User {
  id: string;
  name: string;
  staffId: string;
  email: string;
  department: string;
  role: UserRole;
  status: 'Active' | 'Inactive';
  lastLogin: string;
  avatar?: string;
}

// ============================================================
// Authenticated session (from JWT)
// ============================================================
export interface AuthSession {
  userId: string;
  email: string;
  role: AuthRole;
  name: string;
  token: string;
}

// ============================================================
// Master data records (from Supabase via backend)
// ============================================================
export interface AcademicYearRecord {
  id: string;
  year_label: string;
  status: 'active' | 'inactive';
  is_active?: boolean;
  start_year?: number | null;
  end_year?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface DepartmentRecord {
  id: string;
  department_code: string;
  department_name: string;
  short_name?: string | null;
  hod_name?: string | null;
  is_common?: boolean;
  is_active?: boolean;
  status: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
}

export interface SubjectRecord {
  id: string;
  subject_code: string;
  subject_name: string;
  department_id: string;
  academic_year_id: string;
  semester: string | null;
  regulation: string | null;
  status: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
  departments?: DepartmentRecord;
  academic_years?: AcademicYearRecord;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  department: string;
  semester: string;
  regulation: string;
  totalQuestions: number;
  status: 'Active' | 'Inactive';
  academicYear?: string;
  units: {
    unitNumber: number;
    unitTitle: string;
  }[];
}

export interface QuestionUsageHistory {
  internal1: boolean;
  internal2: boolean;
  endSem: boolean;
  lastUsedDate?: string;
  lastUsedPaperCode?: string;
  timesUsed: number;
}

export interface Question {
  id: string;
  subjectCode: string;
  unit: number;
  topic: string;
  part: QuestionPart;
  marks: number;
  questionText: string;
  bloomsLevel: BloomsLevel;
  co: string;
  pi: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  allowedFor: {
    internal1: boolean;
    internal2: boolean;
    endSem: boolean;
  };
  usageHistory: QuestionUsageHistory;
  status: 'Draft' | 'Approved' | 'Pending';
  createdBy: string;
  createdDate: string;
  questionNumber?: string;
  orGroupId?: string;
  orOption?: 'A' | 'B' | 'C';
  subQuestions?: string[];
  ocrConfidence?: number;
  sourceDocument?: string;
  sourcePage?: number;
  updatedAt?: string;
  bl?: BloomsLevel | null;
  questionBankId?: string;
  academicYear?: string;
  department?: string;
  scope?: DepartmentScope;
  departmentScope?: DepartmentScope;
  departmentIds?: string[];
  commonDepartments?: string[];
  /**
   * When this question came from a generated IAT bank, this is the ORIGINAL
   * `questions.id` it was selected from (Spec §12). Usage is recorded
   * against this id, never against the generated bank.
   */
  sourceQuestionId?: string;
}

export type OcrStatus = 'Approved' | 'Needs Review' | 'Low Confidence' | 'Rejected' | 'Possible Duplicate';

export interface OcrExtractedQuestion {
  id: string;
  subjectCode: string;
  unit: number | 'Unknown';
  part: 'A' | 'B' | 'C' | 'Unknown';
  questionNumber?: string;
  questionText: string;
  marks: number | null;
  bl: BloomsLevel | null;
  co: string | null;
  pi: string | null;
  topic: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  orGroupId?: string;
  orOption?: 'A' | 'B' | 'C';
  subQuestions?: string[];
  ocrConfidence: number;
  sourceDocument: string;
  sourcePage: number;
  status: OcrStatus;
  duplicateWithId?: string;
  duplicateText?: string;
  duplicateSimilarity?: number;
  questionableText?: string;
  isEdited?: boolean;
  markBreakdown?: string | null;
  btl?: string | null;
  unitTitle?: string;
  sourcePageEnd?: number | null;
  isOrQuestion?: boolean;
  needsReview?: boolean;
  duplicateCandidate?: boolean;
}

export interface OcrDocumentMetadata {
  subjectName?: string;
  subjectCode?: string;
  department?: Department;
  regulation?: string;
  semester?: string;
  totalUnitsDetected: number;
  totalPages: number;
  fileName: string;
  fileSize: string;
  isScannedImageOnly: boolean;
  questionBankId?: string;
}

export interface ExamPatternSection {
  name: string;                 // 'Section A' | 'Section B'
  display_questions: number;    // how many questions are shown (e.g. 3)
  answer_count: number;         // how many the student must answer (e.g. 2)
  unit_pool: number[];          // which units to draw from
  instruction: string;          // e.g. 'Answer any two Questions'
}

export interface ExamPattern {
  id: string;
  examType: ExamType;
  examName?: string;            // Full display name on paper header
  totalMarks: number;
  duration: string;
  description: string;
  regulation?: string;
  showBlCoPI?: boolean;         // true for IAT, false for End Sem
  showCourseObjectives?: boolean;
  instructions?: string;        // Overall instruction e.g. 'Answer ALL Questions'
  partA: {
    totalQuestions: number;
    marksPerQuestion: number;
    choiceNote: string;
    instruction?: string;       // e.g. 'Answer all Questions'
    questionStart?: number;     // Starting question number (default 1)
    unitDistribution?: string;
    bloomsNote?: string;
    unitsPerQuestion?: number;  // For End Sem: 2 questions per unit
  };
  partB: {
    format: 'sections' | 'or_choice';
    // For IAT (sections format):
    sections?: ExamPatternSection[];
    sectionA?: {
      totalQuestions: number;
      answerCount: number;
      marksPerQuestion: number;
    };
    sectionB?: {
      totalQuestions: number;
      answerCount: number;
      marksPerQuestion: number;
    };
    // For End Sem (or_choice format):
    orQuestionsCount?: number;  // number of main questions (5 for End Sem)
    marksPerQuestion?: number;
    questionStart?: number;     // Starting question number (5 for IAT, 11 for End Sem)
    unitMap?: Record<string, number>; // e.g. {"11": 1, "12": 2, ...}
    unitDistribution?: string;
    bloomsNote?: string;
  };
  partC?: {
    enabled: boolean;
    orQuestionsCount: number;
    marksPerQuestion: number;
    questionStart?: number;     // e.g. 16
    unitDistribution?: string;
    bloomsNote?: string;
  };
}

export interface UnitSyllabusConfig {
  unitNumber: number;
  unitTitle: string;
  coverage: number;
  portionLabel: '100%' | 'First Half' | 'Remaining Half' | 'Not Included';
}

export interface PaperQuestionItem {
  questionId: string;
  questionNumber: string;
  question: Question;
  choiceGroup?: string;
  isOrOptionB?: boolean;
}

export interface GeneratedPaper {
  id: string;
  paperCode: string;
  subjectCode: string;
  subjectName: string;
  department: string;
  departmentName?: string;          // Full department name e.g. 'Computer Science Engineering'
  semester: string;
  regulation: string;
  examType: ExamType;
  examDate: string;
  examMonth?: string;               // e.g. 'DECEMBER 2024' — for End Sem header
  duration: string;
  maxMarks: number;
  academicYear: string;
  status: PaperStatus;
  createdBy: string;
  createdDate: string;
  reviewedBy?: string;
  approvedBy?: string;
  rejectionReason?: string;
  // Header metadata matching reference PDFs
  commonToLabel?: string;           // e.g. '(Common to CSE, AIDS, AIML)'
  courseObjectives?: string[];       // Bullet list shown in IAT header
  courseOutcomes?: { code: string; description: string }[]; // CO1–CO5 table
  yearOfStudy?: string;             // e.g. '3rd Year'
  partAQuestions: PaperQuestionItem[];
  partBQuestions: PaperQuestionItem[];
  partCQuestions?: PaperQuestionItem[];
  validationPassed: boolean;
  validationIssues: string[];
  setLetter?: string;
  setName?: string;
  setDisplayName?: string;
  /** Canonical download filename, e.g. 24CS514_IAT_Set_A.pdf (Spec §5) */
  fileName?: string;
  /** Spec §18 — set when the paper used a Principal approval */
  principalRequestId?: string | null;
  principalApprovalRequired?: boolean;
  principalApprovalStatus?: 'not_required' | 'pending' | 'approved' | 'rejected' | 'consumed';
  generatedBy?: string;
  generatedAt?: string;
  scope?: DepartmentScope;
  departmentScope?: DepartmentScope;
  departmentIds?: string[];
  commonDepartments?: string[];
  tableOfSpecification?: TableOfSpecification;
  /**
   * Which question bank the paper was built from (Spec §18).
   * End Semester papers are always 'ORIGINAL' — the IAT generator is
   * never reachable from the End Semester workflow (Spec §19, §30).
   */
  questionBankSource?: QuestionBankSource;
  /** Set only when questionBankSource === 'IAT_GENERATED'. */
  iatGeneratedBankId?: string | null;
  iatGeneratedBankName?: string | null;
}

export interface TosRow {
  division: string;
  level: BloomsLevel;
  partA: number;
  partB: number;
  partC: number;
  total: number;
  percentage: number;
}

export interface TableOfSpecification {
  rows: TosRow[];
  totalPartA: number;
  totalPartB: number;
  totalPartC: number;
  grandTotal: number;
}


export interface ValidationItem {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface QuestionBankRecord {
  id: string;
  academicYear: string;
  department: string;
  subjectCode: string;
  subjectName: string;
  fileName: string;
  fileSize?: string;
  storagePath?: string;
  totalPages: number;
  totalQuestions: number;
  uploadDate: string;
  uploadedBy?: string;
  status: 'Active' | 'Processing' | 'Error';
}

// ============================================================
// Paper Set Tracking
// ============================================================
export interface PaperSetTrackingEntry {
  set_name: string;
  set_display_name: string | null;
  paper_code: string | null;
  created_at: string;
  created_by_name: string | null;
  additional_set_request_id?: string | null;
}

/** Authoritative set-limit configuration (Spec §3, §15) */
export interface ExamSetLimitConfig {
  examType: ExamType;
  maxSets: number;
  standardSetNames: string[];
  limitMessage: string;
  isIAT: boolean;
}

export interface PaperSetStatus {
  sets: PaperSetTrackingEntry[];
  count: number;
  generatedSetNames: string[];
  limit: number;
  standardSetNames: string[];
  limitReached: boolean;
  nextSetName: string | null;
  canGenerate: boolean;
  requiresApproval: boolean;
  limitMessage: string | null;
  hasValidApproval: boolean;
  approvedSetNamesAvailable: string[];
  /** The request that actually grants the approved set (Spec §12) */
  approvalRequest: AdditionalPaperRequest | null;
  activeRequest: AdditionalPaperRequest | null;
  pendingRequest: AdditionalPaperRequest | null;
  reason?: string;
  examTypeRule: string;
  databaseConfigured?: boolean;
}

// ============================================================
// Additional Paper Requests
// ============================================================
export type AdditionalPaperRequestStatus = 'pending' | 'approved' | 'partially_approved' | 'rejected' | 'cancelled';

export interface AdditionalPaperRequest {
  id: string;
  request_number: string;
  academic_year_id: string;
  department_id: string;
  subject_id: string;
  exam_type: string;
  existing_set_count: number;
  existing_set_names: string[];
  requested_set_count: number;
  requested_set_names: string[];
  reason: string;
  supporting_document_path: string | null;
  requested_by_user_id: string;
  requested_by_name: string;
  status: AdditionalPaperRequestStatus;
  principal_decision_by_id: string | null;
  principal_decision_by_name: string | null;
  principal_decision_at: string | null;
  principal_remarks: string | null;
  approved_set_count: number | null;
  approved_set_names: string[] | null;
  sets_generated_from_this: number;
  // Spec §11 — rejection trail
  rejected_by_id?: string | null;
  rejected_by_name?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  // Spec §12 — approval consumption
  consumed?: boolean;
  consumed_at?: string | null;
  consumed_set_name?: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  subjects?: { subject_code: string; subject_name: string };
  academic_years?: { year_label: string };
  departments?: { department_code: string; department_name: string };
}

// ============================================================
// Principal Paper Assignments
// ============================================================
export type AssignmentReviewStatus = 'pending' | 'reviewed' | 'returned';

export interface PrincipalPaperAssignment {
  id: string;
  paper_code: string;
  local_paper_id: string;
  subject_code: string;
  subject_name: string | null;
  exam_type: string;
  set_name: string | null;
  set_display_name: string | null;
  academic_year_id: string | null;
  department_id: string | null;
  assigned_principal_id: string;
  assigned_principal_name: string;
  assigned_by_user_id: string;
  assigned_by_name: string;
  assigned_at: string;
  review_status: AssignmentReviewStatus;
  review_remarks: string | null;
  reviewed_at: string | null;
  paper_snapshot: GeneratedPaper | null;
  created_at: string;
  updated_at: string;
}

export interface PrincipalUser {
  id: string;
  name: string;
  email: string;
}

export interface PaperRequestNotification {
  id: string;
  recipient_id: string;
  request_id: string;
  notification_type: 'approved' | 'partially_approved' | 'rejected' | 'submitted' | 'generated';
  message: string;
  is_read: boolean;
  created_at: string;
}
