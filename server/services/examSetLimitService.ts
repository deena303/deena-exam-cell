/**
 * Exam Set Limit Service
 *
 * Single source of truth for generation limits (Spec §3, §4, §15).
 *
 * Limits are read from the `exam_set_limits` table (migration 010) so they
 * are data-driven and can be changed without a code deploy. A hardcoded
 * fallback is used only when Supabase is unreachable, so the API degrades
 * gracefully instead of failing.
 *
 * Standard sets:
 *   Internal Assessment I / II  -> A, B      (max 2)
 *   End Semester Examination    -> A, B, C, D (max 4)
 *
 * Anything beyond the standard letters requires a Principal approval that is
 * bound to one specific Academic Year + Department + Subject + Exam Type + Set.
 */
import { getSupabaseClient, isSupabaseConfigured } from './supabaseQuestionBankService';

export const IAT_EXAM_TYPES = ['Internal Assessment I', 'Internal Assessment II'] as const;
export const END_SEM_EXAM_TYPE = 'End Semester Examination';

export const ALL_SET_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

export interface ExamSetLimit {
  examType: string;
  maxSets: number;
  standardSetNames: string[];
  requiresApprovalBeyond: boolean;
  limitMessage: string;
}

/** Hardcoded fallback — mirrors the seeded `exam_set_limits` rows. */
const FALLBACK_LIMITS: Record<string, ExamSetLimit> = {
  'Internal Assessment I': {
    examType: 'Internal Assessment I',
    maxSets: 2,
    standardSetNames: ['A', 'B'],
    requiresApprovalBeyond: true,
    limitMessage: 'Standard IAT limit reached. Additional paper generation requires Principal approval.'
  },
  'Internal Assessment II': {
    examType: 'Internal Assessment II',
    maxSets: 2,
    standardSetNames: ['A', 'B'],
    requiresApprovalBeyond: true,
    limitMessage: 'Standard IAT limit reached. Additional paper generation requires Principal approval.'
  },
  [END_SEM_EXAM_TYPE]: {
    examType: END_SEM_EXAM_TYPE,
    maxSets: 4,
    standardSetNames: ['A', 'B', 'C', 'D'],
    requiresApprovalBeyond: true,
    limitMessage: 'Standard End Semester set limit reached. Additional paper generation requires Principal approval.'
  }
};

const cache = new Map<string, { value: ExamSetLimit; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export function getFallbackLimit(examType: string): ExamSetLimit {
  return (
    FALLBACK_LIMITS[examType] || {
      examType,
      maxSets: 2,
      standardSetNames: ['A', 'B'],
      requiresApprovalBeyond: true,
      limitMessage: 'Standard IAT limit reached. Additional paper generation requires Principal approval.'
    }
  );
}

/** Resolves the limit for an exam type, preferring the database value. */
export async function resolveExamSetLimit(examType: string): Promise<ExamSetLimit> {
  const cached = cache.get(examType);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (!isSupabaseConfigured()) return getFallbackLimit(examType);

  try {
    const { data, error } = await getSupabaseClient()
      .from('exam_set_limits')
      .select('exam_type, max_sets, set_letters, requires_approval_beyond, limit_message')
      .eq('exam_type', examType)
      .maybeSingle();

    if (error || !data) return getFallbackLimit(examType);

    const letters: string[] = Array.isArray(data.set_letters) && data.set_letters.length > 0
      ? data.set_letters.map((l: string) => String(l).toUpperCase())
      : ALL_SET_LETTERS.slice(0, Number(data.max_sets) || 2).map(String);

    const value: ExamSetLimit = {
      examType: data.exam_type,
      maxSets: Number(data.max_sets) || letters.length,
      standardSetNames: letters,
      requiresApprovalBeyond: data.requires_approval_beyond !== false,
      limitMessage: data.limit_message || getFallbackLimit(examType).limitMessage
    };

    cache.set(examType, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch {
    return getFallbackLimit(examType);
  }
}

export function isIatExamType(examType: string): boolean {
  return (IAT_EXAM_TYPES as readonly string[]).includes(examType);
}

/**
 * The exact generation permission decision (Spec §15).
 *
 * IF exam_type = IAT:
 *   Set A missing -> allow A
 *   ELSE Set B missing -> allow B
 *   ELSE -> block, request Principal approval
 *
 * IF exam_type = END_SEMESTER:
 *   Set A missing -> allow A
 *   ELSE Set B missing -> allow B
 *   ELSE Set C missing -> allow C
 *   ELSE Set D missing -> allow D
 *   ELSE -> block, request Principal approval
 *
 * For approved additional sets: only the exact set approved by the Principal.
 */
export interface GenerationDecision {
  /** Next set the system will allocate, or null when blocked. */
  nextSetName: string | null;
  canGenerate: boolean;
  requiresApproval: boolean;
  limitReached: boolean;
  limitMessage: string | null;
  generatedSetNames: string[];
  standardSetNames: string[];
  limit: number;
  /** Set letters covered by a live, unconsumed Principal approval. */
  approvedSetNamesAvailable: string[];
  hasValidApproval: boolean;
  reason: string;
}

export function decideGeneration(params: {
  examType: string;
  limit: ExamSetLimit;
  generatedSetNames: string[];
  approvedSetNamesAvailable: string[];
  rejectedSetNames?: string[];
  hasActivePendingRequest?: boolean;
}): GenerationDecision {
  const { examType, limit, generatedSetNames, approvedSetNamesAvailable } = params;
  const existing = new Set(generatedSetNames);
  const approved = (approvedSetNamesAvailable || []).filter((s) => !existing.has(s));

  const firstMissingStandard = limit.standardSetNames.find((letter) => !existing.has(letter));

  // 1. An unconsumed Principal approval always wins — but only for the exact set.
  if (approved.length > 0) {
    const next = approved[0];
    return {
      nextSetName: next,
      canGenerate: true,
      requiresApproval: true,
      limitReached: existing.size >= limit.maxSets,
      limitMessage: existing.size >= limit.maxSets ? limit.limitMessage : null,
      generatedSetNames,
      standardSetNames: limit.standardSetNames,
      limit: limit.maxSets,
      approvedSetNamesAvailable: approved,
      hasValidApproval: true,
      reason: `Principal approval found for Set ${next}.`
    };
  }

  // 2. A standard set is still free -> allow it (no approval needed).
  if (firstMissingStandard) {
    return {
      nextSetName: firstMissingStandard,
      canGenerate: true,
      requiresApproval: false,
      limitReached: false,
      limitMessage: null,
      generatedSetNames,
      standardSetNames: limit.standardSetNames,
      limit: limit.maxSets,
      approvedSetNamesAvailable: [],
      hasValidApproval: false,
      reason: `Set ${firstMissingStandard} is available.`
    };
  }

  // 3. All standard sets exist -> block and require Principal approval.
  const beyond = ALL_SET_LETTERS.find((letter) => !existing.has(letter)) || 'E';
  return {
    nextSetName: null,
    canGenerate: false,
    requiresApproval: true,
    limitReached: true,
    limitMessage: limit.limitMessage,
    generatedSetNames,
    standardSetNames: limit.standardSetNames,
    limit: limit.maxSets,
    approvedSetNamesAvailable: [],
    hasValidApproval: false,
    reason: params.hasActivePendingRequest
      ? 'Standard set limit reached. A request is already pending Principal approval.'
      : limit.limitMessage
  };
}

/** Canonical audit action name for a generated set (Spec §19). */
export function setGeneratedAuditAction(examType: string, setLetter: string): string {
  if (isIatExamType(examType)) return `IAT_SET_${setLetter}_GENERATED`;
  return `END_SEM_SET_${setLetter}_GENERATED`;
}

/** Human readable exam type for filenames and notifications. */
export function examTypeSlug(examType: string): string {
  if (isIatExamType(examType)) return 'IAT';
  return 'End_Semester';
}

// ====================================================================
/** Canonical download filename (Spec §5): 24CS514_IAT_Set_A.pdf */
export function buildPaperFileName(params: {
  subjectCode: string;
  examType: string;
  setLetter: string;
  extension: 'pdf' | 'docx';
}): string {
  const code = String(params.subjectCode || 'PAPER').replace(/[^A-Za-z0-9]+/g, '_');
  const letter = String(params.setLetter || 'A').toUpperCase();
  return `${code}_${examTypeSlug(params.examType)}_Set_${letter}.${params.extension}`;
}
