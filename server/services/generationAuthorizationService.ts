/**
 * Generation Authorization Service
 *
 * ONE authoritative answer to "may this set be generated right now?".
 *
 * Both `GET /api/paper-sets/status` and `POST /api/paper-sets/track` call
 * `authorizeGeneration()`. The UI renders that result verbatim, so the screen
 * can never claim "Approved by Principal" while the server would reject the
 * write (Spec §7).
 *
 * Matching is done on the HUMAN-READABLE identity
 *   academic year + department + subject code + exam type + set letter
 * rather than on UUIDs, so an approval genuinely refers to the paper the
 * Exam Cell is trying to generate (Spec §2).
 *
 * The Principal approval requirement is enforced here and is never bypassed
 * (Spec §8) — a missing, rejected, consumed or mismatched approval resolves to
 * `allowed: false` with a specific reason (Spec §25).
 */
import { getSupabaseClient, isSupabaseConfigured } from './supabaseQuestionBankService';
import {
  resolveExamSetLimit,
  getFallbackLimit,
  ALL_SET_LETTERS,
  isIatExamType,
  type ExamSetLimit
} from './examSetLimitService';

export interface GenerationIdentity {
  subjectId: string;
  academicYearId: string;
  departmentId: string;
  /** e.g. '24CS514' */
  subjectCode: string;
  /** e.g. '2024-2028' */
  academicYear: string;
  /** e.g. 'AIML' */
  departmentCode: string;
  examType: string;
}

export type AuthorizationCode =
  | 'STANDARD_SET_AVAILABLE'
  | 'APPROVED'
  | 'DUPLICATE_SET'
  | 'SET_ORDER_VIOLATION'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_CONSUMED'
  | 'APPROVAL_SCOPE_MISMATCH'
  | 'APPROVAL_NOT_FOUND'
  | 'SELF_APPROVAL'
  | 'DATABASE_UNAVAILABLE';

export interface AuthorizationResult {
  /** The single source of truth — the UI must display exactly this. */
  allowed: boolean;
  /** The set that will be generated (null when blocked). */
  set: string | null;
  /** Human-readable reason from the Spec §25 list. */
  reason: string;
  code: AuthorizationCode;
  approvalId: string | null;
  approvalStatus: string | null;
  approvalRequestNumber: string | null;
  requiresApproval: boolean;
  /** The next unallocated standard set, ignoring approvals. */
  nextStandardSet: string | null;
  /**
   * The set the Exam Cell would ask the Principal for once the standard
   * limit is exhausted (e.g. 'C' for IAT, 'E' for End Semester). This is
   * what the UI shows as "Next Available Set" when generation is blocked.
   */
  nextRequestableSet: string | null;
  existingSets: string[];
  standardSets: string[];
  limit: number;
  limitReached: boolean;
  limitMessage: string;
  identity: {
    academicYear: string;
    department: string;
    subjectCode: string;
    examType: string;
  };
  /** Set when a matching request exists but is rejected (so the UI can say so). */
  rejectedRequestNumber: string | null;
  degradedSchema?: boolean;
}

// ---------------------------------------------------------------------------
// Identity resolution (UUIDs -> codes)
// ---------------------------------------------------------------------------
interface ResolvedMaster {
  subjectCode: string;
  academicYear: string;
  departmentCode: string;
}

const masterCache = new Map<string, { value: ResolvedMaster | null; expiresAt: number }>();
const MASTER_TTL_MS = 30_000;

/**
 * Resolves subject / academic year / department codes for a UUID triple.
 * Returns nulls (empty strings) rather than throwing so a partially
 * configured database degrades to UUID-based matching instead of crashing.
 */
export async function resolveIdentity(params: {
  subjectId: string;
  academicYearId: string;
  departmentId: string;
}): Promise<ResolvedMaster> {
  const key = `${params.subjectId}|${params.academicYearId}|${params.departmentId}`;
  const cached = masterCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value || { subjectCode: '', academicYear: '', departmentCode: '' };
  }

  let value: ResolvedMaster | null = null;
  if (isSupabaseConfigured()) {
    try {
      const client = getSupabaseClient();
      const [subjectRes, yearRes, deptRes] = await Promise.all([
        client.from('subjects').select('subject_code').eq('id', params.subjectId).maybeSingle(),
        client.from('academic_years').select('year_label').eq('id', params.academicYearId).maybeSingle(),
        client.from('departments').select('department_code').eq('id', params.departmentId).maybeSingle()
      ]);
      if (subjectRes.data) {
        value = {
          subjectCode: subjectRes.data.subject_code || '',
          academicYear: yearRes.data?.year_label || '',
          departmentCode: deptRes.data?.department_code || ''
        };
      }
    } catch {
      value = null;
    }
  }

  masterCache.set(key, { value, expiresAt: Date.now() + MASTER_TTL_MS });
  return value || { subjectCode: '', academicYear: '', departmentCode: '' };
}

// ---------------------------------------------------------------------------
// Approval loading (resilient to a missing migration 010)
// ---------------------------------------------------------------------------
/** Columns available since migration 006. Identity columns are REQUIRED. */
const REQUEST_COLUMNS_BASE =
  'id, request_number, status, requested_set_names, requested_set_count, ' +
  'approved_set_names, approved_set_count, sets_generated_from_this, ' +
  'principal_remarks, principal_decision_by_id, principal_decision_by_name, ' +
  'principal_decision_at, ' +
  // identity — these MUST be selected or scope matching silently fails
  'subject_id, academic_year_id, department_id, exam_type, ' +
  'created_at';

/** Columns added by migration 010. */
const REQUEST_COLUMNS_V2 = REQUEST_COLUMNS_BASE + ', consumed, consumed_at, consumed_set_name';

export interface ApprovalRow {
  id: string;
  request_number?: string | null;
  status: string;
  requested_set_names?: string[] | null;
  approved_set_names?: string[] | null;
  sets_generated_from_this?: number | null;
  consumed?: boolean | null;
  consumed_set_name?: string | null;
  principal_remarks?: string | null;
  principal_decision_by_id?: string | null;
  principal_decision_by_name?: string | null;
  principal_decision_at?: string | null;
  subject_id?: string | null;
  academic_year_id?: string | null;
  department_id?: string | null;
  exam_type?: string | null;
  [key: string]: any;
}

export interface ApprovalLoadResult {
  rows: ApprovalRow[];
  degraded: boolean;
  error: string | null;
}

export async function loadApprovalRows(
  client: any,
  filters: { subjectId: string; academicYearId: string; departmentId: string; examType: string; statuses: string[] }
): Promise<ApprovalLoadResult> {
  const build = (columns: string) =>
    client
      .from('additional_paper_requests')
      .select(columns)
      .eq('subject_id', filters.subjectId)
      .eq('academic_year_id', filters.academicYearId)
      .eq('department_id', filters.departmentId)
      .eq('exam_type', filters.examType)
      .in('status', filters.statuses)
      .order('created_at', { ascending: false });

  const first = await build(REQUEST_COLUMNS_V2);
  if (!first.error) {
    return { rows: (first.data || []) as ApprovalRow[], degraded: false, error: null };
  }

  // Migration 010 columns are probably missing — retry with the base set so a
  // real approval is never hidden (this failure would look like "no approval").
  console.warn(
    '[generationAuth] additional_paper_requests select failed; retrying without migration-010 columns. ' +
    'Run supabase/migrations/010_set_tracking_principal_approval.sql. Error:',
    first.error?.message || first.error
  );

  const second = await build(REQUEST_COLUMNS_BASE);
  if (second.error) {
    return { rows: [], degraded: false, error: second.error?.message || String(second.error) };
  }

  const rows: ApprovalRow[] = (second.data || []).map((r: any) => ({
    ...r,
    consumed: Number(r.sets_generated_from_this || 0) > 0
  }));
  return { rows, degraded: true, error: null };
}

// ---------------------------------------------------------------------------
// Core authorization
// ---------------------------------------------------------------------------
const same = (a?: string | null, b?: string | null) => (a || '').trim().toUpperCase() === (b || '').trim().toUpperCase();

/**
 * Does this approval row refer to exactly the generation context?
 * Compares exam type + set letter directly, and the identity by CODE when we
 * could resolve it, falling back to UUID equality otherwise (Spec §2).
 */
export function approvalMatchesContext(
  approval: ApprovalRow,
  identity: { subjectId: string; academicYearId: string; departmentId: string; examType: string; subjectCode: string; academicYear: string; departmentCode: string }
): boolean {
  if (!same(approval.exam_type, identity.examType)) return false;

  const identityComplete = Boolean(identity.subjectCode && identity.academicYear && identity.departmentCode);
  const approvalHasCodes = Boolean(approval.subject_code || approval.academic_year || approval.department);

  if (identityComplete && approvalHasCodes) {
    // Preferred: compare the human-readable identity
    if (!same(approval.subject_code, identity.subjectCode)) return false;
    if (!same(approval.academic_year, identity.academicYear)) return false;
    if (!same(approval.department, identity.departmentCode)) return false;
    return true;
  }

  // Fallback: UUID identity (always present on additional_paper_requests)
  if (approval.subject_id && approval.subject_id !== identity.subjectId) return false;
  if (approval.academic_year_id && approval.academic_year_id !== identity.academicYearId) return false;
  if (approval.department_id && approval.department_id !== identity.departmentId) return false;
  return true;
}

function limitMessageFor(examType: string, limit: ExamSetLimit): string {
  return limit.limitMessage ||
    (isIatExamType(examType)
      ? 'Standard IAT limit reached. Additional paper generation requires Principal approval.'
      : 'Standard End Semester set limit reached. Additional paper generation requires Principal approval.');
}

export interface AuthorizeParams {
  identity: GenerationIdentity;
  /** The set the caller intends to generate. Omit to only compute the next set. */
  requestedSet?: string | null;
  /** The authenticated user id, used for the self-approval guard. */
  userId?: string | null;
}

/**
 * Decides whether a set may be generated. Pure with respect to the database
 * reads it performs — it NEVER mutates. Consumption is a separate, atomic step
 * performed by `consumeApproval()` after the tracking row is inserted.
 */
export async function authorizeGeneration(params: AuthorizeParams): Promise<AuthorizationResult> {
  const { identity, requestedSet, userId } = params;
  const limit = await resolveExamSetLimit(identity.examType);

  const base = {
    set: null as string | null,
    approvalId: null as string | null,
    approvalStatus: null as string | null,
    approvalRequestNumber: null as string | null,
    nextStandardSet: null as string | null,
    nextRequestableSet: null as string | null,
    existingSets: [] as string[],
    standardSets: limit.standardSetNames,
    limit: limit.maxSets,
    limitReached: false,
    limitMessage: limitMessageFor(identity.examType, limit),
    identity: {
      academicYear: identity.academicYear,
      department: identity.departmentCode,
      subjectCode: identity.subjectCode,
      examType: identity.examType
    },
    rejectedRequestNumber: null as string | null
  };

  if (!isSupabaseConfigured()) {
    return {
      ...base,
      allowed: true,
      set: requestedSet || limit.standardSetNames[0] || 'A',
      nextStandardSet: limit.standardSetNames[0] || 'A',
      nextRequestableSet: limit.standardSetNames[0] || 'A',
      reason: 'Standard set available.',
      code: 'STANDARD_SET_AVAILABLE',
      requiresApproval: false
    };
  }

  const client = getSupabaseClient();

  // ---- 1. Existing sets (authoritative) ----
  const { data: existingRows, error: setErr } = await client
    .from('paper_set_tracking')
    .select('set_name')
    .eq('subject_id', identity.subjectId)
    .eq('academic_year_id', identity.academicYearId)
    .eq('department_id', identity.departmentId)
    .eq('exam_type', identity.examType)
    .eq('generation_status', 'generated');

  if (setErr) {
    return {
      ...base,
      allowed: false,
      reason: 'Unable to verify existing sets. Please try again.',
      code: 'DATABASE_UNAVAILABLE',
      requiresApproval: false
    };
  }

  const existingSets: string[] = (existingRows || []).map((r: any) => r.set_name);
  const firstMissingStandard = limit.standardSetNames.find(l => !existingSets.includes(l)) || null;
  // The set the Exam Cell would need to request: the first standard set that
  // is still free, otherwise the first unallocated letter beyond the limit.
  const firstUnallocated = ALL_SET_LETTERS.find(l => !existingSets.includes(l)) || null;
  const nextRequestableSet = firstMissingStandard || firstUnallocated;
  const baseWithSets = { ...base, existingSets, nextStandardSet: firstMissingStandard, nextRequestableSet };

  // ---- 2. Load every request that could authorise this context ----
  const approvals = await loadApprovalRows(client, {
    subjectId: identity.subjectId,
    academicYearId: identity.academicYearId,
    departmentId: identity.departmentId,
    examType: identity.examType,
    statuses: ['pending', 'approved', 'partially_approved', 'rejected']
  });

  const matching = (approvals.rows || []).filter((r) => approvalMatchesContext(r, identity));
  const rejected = matching.find((r) => r.status === 'rejected');

  // ---- 3. A standard set is still free -> allow, no approval needed ----
  if (firstMissingStandard && !requestedSet) {
    return {
      ...baseWithSets,
      allowed: true,
      set: firstMissingStandard,
      reason: `Set ${firstMissingStandard} is available.`,
      code: 'STANDARD_SET_AVAILABLE',
      requiresApproval: false
    };
  }

  const targetSet = (requestedSet || '').toUpperCase();

  // ---- 4. Explicitly requested set: validate it from scratch ----
  if (targetSet) {
    // 4a. Already generated?
    if (existingSets.includes(targetSet)) {
      return {
        ...baseWithSets,
        allowed: false,
        set: targetSet,
        reason: `Set ${targetSet} already exists.`,
        code: 'DUPLICATE_SET',
        requiresApproval: false
      };
    }

    // 4b. A standard set that is still within the limit is fine.
    const isStandard = limit.standardSetNames.includes(targetSet);
    if (isStandard && existingSets.length < limit.maxSets) {
      return {
        ...baseWithSets,
        allowed: true,
        set: targetSet,
        reason: `Set ${targetSet} is a standard set within the ${limit.maxSets}-set limit.`,
        code: 'STANDARD_SET_AVAILABLE',
        requiresApproval: false
      };
    }

    // 4c. Standard letter, but the limit is full and this letter is skipped
    //     in order (e.g. asking for C when only A and B exist on End Sem).
    if (isStandard && existingSets.length >= limit.maxSets) {
      return {
        ...baseWithSets,
        allowed: false,
        set: targetSet,
        reason: `Standard sets ${limit.standardSetNames.join(', ')} must be generated in order before Set ${targetSet}.`,
        code: 'SET_ORDER_VIOLATION',
        requiresApproval: false
      };
    }

    // 4d. Beyond the standard limit -> an approval is mandatory (Spec §8)
    const usable = matching.filter(
      (r) => (r.status === 'approved' || r.status === 'partially_approved') && !r.consumed
    );
    // An approval that was granted but already used up (Spec §4)
    const consumedApprovals = matching.filter(
      (r) => (r.status === 'approved' || r.status === 'partially_approved') && r.consumed
    );

    if (usable.length === 0) {
      // A rejection for THIS exact set is the most specific answer (Spec §25).
      if (rejected && setsInRequest(rejected).includes(targetSet)) {
        return {
          ...baseWithSets,
          allowed: false,
          set: targetSet,
          reason: 'Principal approval was rejected.',
          code: 'APPROVAL_REJECTED',
          approvalStatus: 'rejected',
          approvalRequestNumber: rejected.request_number || null,
          rejectedRequestNumber: rejected.request_number || null,
          requiresApproval: true
        };
      }
      // An approval for this context exists but has already been spent (Spec §4).
      // Reported after a same-set rejection so the most specific reason wins.
      if (consumedApprovals.length > 0) {
        const consumedForSet = consumedApprovals.find(r => setsInRequest(r).includes(targetSet)) || consumedApprovals[0];
        return {
          ...baseWithSets,
          allowed: false,
          set: targetSet,
          reason: `Principal approval has already been consumed (used for Set ${consumedForSet.consumed_set_name || 'an earlier set'}). Request a new approval.`,
          code: 'APPROVAL_CONSUMED',
          approvalStatus: 'approved',
          approvalId: consumedForSet.id,
          approvalRequestNumber: consumedForSet.request_number || null,
          requiresApproval: true
        };
      }
      // An approval exists for a DIFFERENT set -> scope mismatch.
      const approvedOtherSet = matching.find(
        (r) => (r.status === 'approved' || r.status === 'partially_approved') && !setsInRequest(r).includes(targetSet)
      );
      if (approvedOtherSet) {
        return {
          ...baseWithSets,
          allowed: false,
          set: targetSet,
          reason: `Approval does not match the selected subject set. The approved set is ${setsInRequest(approvedOtherSet).join(', ')}.`,
          code: 'APPROVAL_SCOPE_MISMATCH',
          approvalStatus: approvedOtherSet.status,
          approvalId: approvedOtherSet.id,
          approvalRequestNumber: approvedOtherSet.request_number || null,
          requiresApproval: true
        };
      }

      return {
        ...baseWithSets,
        allowed: false,
        set: targetSet,
        reason: isIatExamType(identity.examType)
          ? 'Principal approval required. Standard IAT limit reached (Set A and Set B already generated).'
          : 'Principal approval required. Standard End Semester set limit reached (Sets A–D already generated).',
        code: 'APPROVAL_REQUIRED',
        requiresApproval: true
      };
    }

    // 4e. Usable approval(s) exist — the requested set must be exactly one of them.
    const exact = usable.find((r) => setsInRequest(r).includes(targetSet));
    if (!exact) {
      return {
        ...baseWithSets,
        allowed: false,
        set: targetSet,
        reason: `Approval does not match the selected subject set. The approved set is ${setsInRequest(usable[0]).join(', ')}.`,
        code: 'APPROVAL_SCOPE_MISMATCH',
        approvalStatus: usable[0].status,
        approvalId: usable[0].id,
        approvalRequestNumber: usable[0].request_number || null,
        requiresApproval: true
      };
    }

    // 4f. The requester must not consume their own approval (Spec §22)
    if (userId && exact.principal_decision_by_id && exact.principal_decision_by_id === userId) {
      return {
        ...baseWithSets,
        allowed: false,
        set: targetSet,
        reason: 'You cannot use a Principal approval that you granted yourself.',
        code: 'SELF_APPROVAL',
        approvalId: exact.id,
        approvalStatus: exact.status,
        approvalRequestNumber: exact.request_number || null,
        requiresApproval: true
      };
    }

    return {
      ...baseWithSets,
      allowed: true,
      set: targetSet,
      reason: `Principal approval found for Set ${targetSet}.`,
      code: 'APPROVED',
      approvalId: exact.id,
      approvalStatus: exact.status,
      approvalRequestNumber: exact.request_number || null,
      requiresApproval: true
    };
  }

  // ---- 5. No explicit set requested: report the next available one ----
  if (firstMissingStandard) {
    return {
      ...baseWithSets,
      allowed: true,
      set: firstMissingStandard,
      reason: `Set ${firstMissingStandard} is available.`,
      code: 'STANDARD_SET_AVAILABLE',
      requiresApproval: false
    };
  }

  // All standard sets used. An unused approval unlocks exactly one set.
  const usable = matching.filter((r) => (r.status === 'approved' || r.status === 'partially_approved') && !r.consumed);
  const usableSet = usable.length > 0 ? setsInRequest(usable[0]).find(s => !existingSets.includes(s)) : null;

  if (usable && usableSet) {
    return {
      ...baseWithSets,
      allowed: true,
      set: usableSet,
      reason: `Principal approval found for Set ${usableSet}.`,
      code: 'APPROVED',
      approvalId: usable[0].id,
      approvalStatus: usable[0].status,
      approvalRequestNumber: usable[0].request_number || null,
      requiresApproval: true,
      limitReached: true,
      degradedSchema: approvals.degraded || undefined
    };
  }

  if (usable.length > 0 && !usableSet) {
    return {
      ...baseWithSets,
      allowed: false,
      reason: 'Principal approval has already been consumed. Request a new approval.',
      code: 'APPROVAL_CONSUMED',
      approvalId: usable[0].id,
      approvalStatus: usable[0].status,
      approvalRequestNumber: usable[0].request_number || null,
      requiresApproval: true,
      limitReached: true
    };
  }

  if (rejected) {
    return {
      ...baseWithSets,
      allowed: false,
      reason: 'Principal approval was rejected.',
      code: 'APPROVAL_REJECTED',
      approvalStatus: 'rejected',
      approvalRequestNumber: rejected.request_number || null,
      rejectedRequestNumber: rejected.request_number || null,
      requiresApproval: true,
      limitReached: true
    };
  }

  return {
    ...baseWithSets,
    allowed: false,
    reason: baseWithSets.limitMessage,
    code: 'APPROVAL_REQUIRED',
    requiresApproval: true,
    limitReached: true,
    limitMessage: baseWithSets.limitMessage,
    degradedSchema: approvals.degraded || undefined
  };
}

function setsInRequest(row: ApprovalRow): string[] {
  const raw = (row.approved_set_names && row.approved_set_names.length > 0)
    ? row.approved_set_names
    : (row.requested_set_names || []);
  return (raw || []).map((s: any) => String(s).toUpperCase());
}

/**
 * Atomically consumes an approval (Spec §4, §5).
 *
 * Uses a conditional UPDATE (`WHERE consumed = false`) so that if two requests
 * race, exactly one row is updated and the other sees zero rows affected.
 * Returns true only for the winner.
 */
export async function consumeApproval(params: {
  approvalId: string;
  setLetter: string;
  paperCode?: string | null;
}): Promise<{ consumed: boolean; error: string | null; degraded: boolean }> {
  if (!isSupabaseConfigured()) return { consumed: false, error: null, degraded: false };
  const client = getSupabaseClient();
  const now = new Date().toISOString();

  const attempt = await client
    .from('additional_paper_requests')
    .update({
      consumed: true,
      consumed_at: now,
      consumed_set_name: params.setLetter.toUpperCase(),
      sets_generated_from_this: 1
    })
    .eq('id', params.approvalId)
    .eq('consumed', false)
    .select('id')
    .maybeSingle();

  if (!attempt.error && attempt.data) {
    return { consumed: true, error: null, degraded: false };
  }

  // Migration 010 columns missing — fall back to a guarded update using the
  // migration-006 field, still conditional so it stays race-safe.
  if (attempt.error) {
    console.warn('[generationAuth] consume with migration-010 columns failed, retrying with sets_generated_from_this:', attempt.error.message);
    const fallback = await client
      .from('additional_paper_requests')
      .update({ sets_generated_from_this: 1 })
      .eq('id', params.approvalId)
      .eq('sets_generated_from_this', 0)
      .select('id')
      .maybeSingle();

    if (!fallback.error && fallback.data) {
      return { consumed: true, error: null, degraded: true };
    }
    if (!fallback.error && !fallback.data) {
      return { consumed: false, error: 'approval_already_consumed', degraded: true };
    }
    return { consumed: false, error: fallback.error?.message || 'consume_failed', degraded: true };
  }

  // No error but no row -> the conditional guard did not match (already consumed)
  return { consumed: false, error: 'approval_already_consumed', degraded: false };
}

/** Next unallocated set letter, used by the request form. */
export function suggestNextSetLetter(existingSets: string[]): string {
  return ALL_SET_LETTERS.find((l) => !existingSets.includes(l)) || 'E';
}
