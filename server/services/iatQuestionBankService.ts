/**
 * IAT Question Bank Generator — service layer (Spec §1–§30)
 *
 * Core invariants enforced here:
 *   §2  The generated bank is a SUBSET of an already-uploaded original bank.
 *       No question text is ever generated, rewritten or invented.
 *   §6  Part B and Part C are treated as ONE combined selection pool, but the
 *       ORIGINAL part of every selected question is preserved.
 *   §8  Unit coverage is balanced; the exact final distribution is returned
 *       so it can be shown before saving.
 *   §9  The original bank is NEVER modified. This service only ever INSERTs
 *       into `question_banks` (a new IAT_GENERATED row), `iat_generated_
 *       question_banks` and `iat_generated_questions`.
 *   §13 A generated bank can never contain the same source question twice
 *       (also enforced by a unique index + a provenance trigger in the DB).
 *   §17 Creating a generated bank writes NOTHING to `question_usage_history`.
 *       Usage is only recorded when an IAT paper is finalized.
 *   §19/§30 This module is IAT-only. `assertIatExamType` rejects
 *       "End Semester Examination" outright.
 */
import { v4 as uuidv4 } from 'uuid';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseQuestionBankService';
import { writeAuditLog, AUDIT_ACTIONS } from './auditService';

// ====================================================================
// Exam-type gate (Spec §19, §30)
// ====================================================================

export const END_SEMESTER_EXAM_TYPE = 'End Semester Examination';
export const IAT_EXAM_TYPES = ['Internal Assessment I', 'Internal Assessment II'] as const;

export type IatExamType = (typeof IAT_EXAM_TYPES)[number];

export function isIatExamType(examType: unknown): boolean {
  return typeof examType === 'string' && (IAT_EXAM_TYPES as readonly string[]).includes(examType);
}

/** Throws with a 403-worthy message when a non-IAT exam type is supplied. */
export function assertIatExamType(examType: unknown): IatExamType {
  if (typeof examType !== 'string' || !examType.trim()) {
    throw new IatFeatureError('examType is required. The IAT Question Bank Generator only supports Internal Assessment I and Internal Assessment II.', 400, 'EXAM_TYPE_REQUIRED');
  }
  if (examType === END_SEMESTER_EXAM_TYPE) {
    throw new IatFeatureError(
      'The IAT Question Bank Generator is not available for End Semester Examination. End Semester papers always use the original, full question bank.',
      403,
      'END_SEMESTER_NOT_SUPPORTED'
    );
  }
  if (!isIatExamType(examType)) {
    throw new IatFeatureError(
      `Unsupported exam type "${examType}". Only Internal Assessment I and Internal Assessment II are supported.`,
      400,
      'EXAM_TYPE_NOT_SUPPORTED'
    );
  }
  return examType as IatExamType;
}

export class IatFeatureError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'IAT_FEATURE_ERROR') {
    super(message);
    this.name = 'IatFeatureError';
    this.status = status;
    this.code = code;
  }
}

function db(): ReturnType<typeof getSupabaseClient> {
  if (!isSupabaseConfigured()) {
    throw new IatFeatureError('Database is not configured on the server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).', 503, 'DATABASE_NOT_CONFIGURED');
  }
  return getSupabaseClient();
}

// ====================================================================
// Types
// ====================================================================

export type QuestionPart = 'Part A' | 'Part B' | 'Part C';

/**
 * The literal source discriminator (Spec §3).
 *
 *   "original" — the complete question bank uploaded by the user.
 *   "reduced"  — a controlled subset created from an original bank.
 *
 * `question_banks.bank_type` ('ORIGINAL' | 'IAT_GENERATED') is the legacy
 * spelling and is still the storage format; these two helpers are the only
 * place that translation happens.
 */
export type QuestionBankSourceType = 'original' | 'reduced';

export const ORIGINAL_BANK_TYPE: QuestionBankSourceType = 'original';
export const REDUCED_BANK_TYPE: QuestionBankSourceType = 'reduced';

/** Accepts either spelling from the client and returns the canonical value. */
export function normalizeQuestionBankType(value: unknown): QuestionBankSourceType | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'original') return 'original';
  if (v === 'reduced' || v === 'screened' || v === 'iat_generated' || v === 'iat-generated') return 'reduced';
  return null;
}

/** Canonical type -> the legacy `question_banks.bank_type` value. */
export function toLegacyBankType(type: QuestionBankSourceType): 'ORIGINAL' | 'IAT_GENERATED' {
  return type === 'reduced' ? 'IAT_GENERATED' : 'ORIGINAL';
}

/** Reads the canonical type off a bank row, tolerating a pre-013 database. */
export function readQuestionBankType(bank: Record<string, any> | null | undefined): QuestionBankSourceType {
  if (!bank) return 'original';
  return normalizeQuestionBankType(bank.question_bank_type) ?? (bank.bank_type === 'IAT_GENERATED' ? 'reduced' : 'original');
}

/** A question as read from the ORIGINAL `questions` table. */
export interface SourceQuestion {
  id: string;
  question_bank_id: string;
  subject_code: string;
  part: QuestionPart;
  unit: number | null;
  marks: number | null;
  question_text: string;
  blooms_level: string | null;
  btl: string | null;
  co: string | null;
  pi: string | null;
  difficulty: string | null;
  or_group_id: string | null;
  or_option: string | null;
  source_page: number | null;
  /** Number of times this question has already been used in a finalized paper. */
  timesUsed: number;
}

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
  /** Part B + Part C combined selection pool (Spec §25) */
  partBc: number;
  total: number;
  /** Available questions per unit, per part group. */
  units: Array<{ unit: number; partA: number; partB: number; partC: number; total: number }>;
}

export interface SelectedQuestion {
  sourceQuestionId: string;
  /**
   * The ORIGINAL `questions.id` this was selected from (Spec §12).
   * Always identical to `sourceQuestionId` — exposed under the spec's name so
   * the UI can render "Source: Original Question #<id>".
   */
  originalQuestionId: string;
  sourceQuestionNumber: string;
  questionText: string;
  /** ALWAYS the original part of the source question (Spec §6) */
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
  /** 1-based position inside the reduced bank. */
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
  partA: SelectedQuestion[];
  partBC: SelectedQuestion[];
  unitDistribution: { partA: UnitDistributionRow[]; partBC: UnitDistributionRow[] };
  /** Stable seed so "Regenerate" can re-roll deterministically from a new one. */
  seed: number;
  selectionMethod: 'deterministic' | 'gemini';
  /** Suggested non-colliding name (Spec §26). */
  suggestedName: string;
  generatedAt: string;
}

export interface GeneratedBankSummary {
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
  status: 'Active' | 'Archived';
  selectionMethod: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
}

export interface GeneratedBankDetail extends GeneratedBankSummary {
  unitDistribution: { partA: UnitDistributionRow[]; partBC: UnitDistributionRow[] } | null;
  questions: SelectedQuestion[];
}

// ====================================================================
// Seeded PRNG — makes "Regenerate Selection" reproducible per seed while
// still producing a genuinely different subset each time.
// ====================================================================

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ====================================================================
// Source bank loading
// ====================================================================

/** Columns needed to build a balanced selection. */
const QUESTION_SELECT = [
  'id', 'question_bank_id', 'subject_code', 'part', 'unit', 'marks', 'question_text',
  'blooms_level', 'btl_raw', 'co', 'pi', 'difficulty', 'or_group_id', 'or_option', 'source_page'
].join(', ');

interface RawQuestionRow {
  id: string;
  question_bank_id: string;
  subject_code: string;
  part: string | null;
  unit: number | null;
  marks: number | null;
  question_text: string;
  blooms_level: string | null;
  btl_raw: string | null;
  co: string | null;
  pi: string | null;
  difficulty: string | null;
  or_group_id: string | null;
  or_option: string | null;
  source_page: number | null;
}

function normalizePart(raw: string | null): QuestionPart {
  if (!raw) return 'Part B';
  const v = raw.trim().toUpperCase();
  if (v === 'PART A' || v === 'A') return 'Part A';
  if (v === 'PART C' || v === 'C') return 'Part C';
  return 'Part B';
}

/**
 * Lists ORIGINAL question banks only. `bank_type = 'IAT_GENERATED'` rows are
 * excluded so a generated bank can never itself be used as a source (which
 * would chain reductions and lose provenance) and so the existing Question
 * Bank screen is unchanged.
 */
export async function getOriginalQuestionBanks(filters?: {
  academicYear?: string | null;
  department?: string | null;
  subjectCode?: string | null;
  search?: string | null;
}): Promise<Array<Record<string, any>>> {
  const client = db();
  let q = client.from('question_banks').select('*').eq('bank_type', 'ORIGINAL');

  if (filters?.academicYear) q = q.eq('academic_year', filters.academicYear);
  if (filters?.department) q = q.eq('department', filters.department);
  if (filters?.subjectCode) q = q.eq('subject_code', filters.subjectCode);
  if (filters?.search) q = q.ilike('subject_name', `%${filters.search}%`);

  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) {
    if (isMissingIatSchema(error)) throw new IatFeatureError(MISSING_SCHEMA_MESSAGE, 503, 'IAT_SCHEMA_MISSING');
    throw new IatFeatureError(`Failed to load question banks: ${error.message}`, 500, 'SOURCE_BANKS_LOAD_FAILED');
  }
  return data || [];
}

/** True when the error is "column/table from migration 012 is missing". */
function isMissingIatSchema(error: any): boolean {
  const msg = String(error?.message || '');
  return error?.code === '42703' || error?.code === '42P01' || /does not exist|column/i.test(msg);
}

export const MISSING_SCHEMA_MESSAGE =
  'The IAT Question Bank Generator database tables are not installed. Run supabase/migrations/012_iat_question_bank_generator.sql in the Supabase SQL Editor.';

/** Loads the original bank header. Rejects IAT_GENERATED banks. */
export async function getSourceBankHeader(bankId: string): Promise<Record<string, any>> {
  if (!bankId) throw new IatFeatureError('sourceQuestionBankId is required.', 400, 'SOURCE_BANK_REQUIRED');
  const client = db();
  const { data, error } = await client.from('question_banks').select('*').eq('id', bankId).maybeSingle();
  if (error) {
    if (isMissingIatSchema(error)) throw new IatFeatureError(MISSING_SCHEMA_MESSAGE, 503, 'IAT_SCHEMA_MISSING');
    throw new IatFeatureError(`Failed to load the source question bank: ${error.message}`, 500, 'SOURCE_BANK_LOAD_FAILED');
  }
  if (!data) throw new IatFeatureError('The selected question bank no longer exists.', 404, 'SOURCE_BANK_NOT_FOUND');
  if ((data.bank_type || 'ORIGINAL') !== 'ORIGINAL') {
    throw new IatFeatureError(
      'A generated IAT question bank cannot be used as a source. Only the original uploaded question bank can be reduced.',
      400,
      'SOURCE_BANK_NOT_ORIGINAL'
    );
  }
  return data;
}

/** Loads every question of a bank, annotated with previous-usage counts. */
export async function loadSourceQuestions(bankId: string): Promise<SourceQuestion[]> {
  const client = db();
  const { data, error } = await client
    .from('questions')
    .select(QUESTION_SELECT)
    .eq('question_bank_id', bankId)
    .order('part', { ascending: true })
    .order('unit', { ascending: true });
  if (error) throw new IatFeatureError(`Failed to load source questions: ${error.message}`, 500, 'SOURCE_QUESTIONS_LOAD_FAILED');

  const rows = (data || []) as unknown as RawQuestionRow[];
  const usage = await loadUsageCounts(rows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    question_bank_id: r.question_bank_id,
    subject_code: r.subject_code,
    part: normalizePart(r.part),
    unit: typeof r.unit === 'number' ? r.unit : null,
    marks: typeof r.marks === 'number' ? r.marks : null,
    question_text: r.question_text || '',
    blooms_level: r.blooms_level ?? null,
    btl: r.btl_raw ?? null,
    co: r.co ?? null,
    pi: r.pi ?? null,
    difficulty: r.difficulty ?? null,
    or_group_id: r.or_group_id ?? null,
    or_option: r.or_option ?? null,
    source_page: typeof r.source_page === 'number' ? r.source_page : null,
    timesUsed: usage.get(r.id) || 0
  }));
}

async function loadUsageCounts(questionIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (questionIds.length === 0) return map;
  try {
    const client = db();
    const { data, error } = await client
      .from('question_usage_history')
      .select('question_id')
      .in('question_id', questionIds);
    if (error) return map;
    for (const row of data || []) {
      if (row.question_id) map.set(row.question_id, (map.get(row.question_id) || 0) + 1);
    }
  } catch {
    // Usage counts are a soft balancing input only — never a hard failure.
  }
  return map;
}

// ====================================================================
// Statistics (Spec §4, §25)
// ====================================================================

export function computeSourceStats(
  bank: Record<string, any>,
  questions: SourceQuestion[]
): SourceBankStats {
  const byUnit = new Map<number, { partA: number; partB: number; partC: number; total: number }>();
  let partA = 0, partB = 0, partC = 0;

  for (const q of questions) {
    if (q.part === 'Part A') partA++;
    else if (q.part === 'Part C') partC++;
    else partB++;

    const unit = typeof q.unit === 'number' && q.unit >= 1 && q.unit <= 5 ? q.unit : 0;
    const bucket = byUnit.get(unit) || { partA: 0, partB: 0, partC: 0, total: 0 };
    if (q.part === 'Part A') bucket.partA++;
    else if (q.part === 'Part C') bucket.partC++;
    else bucket.partB++;
    bucket.total++;
    byUnit.set(unit, bucket);
  }

  const units = Array.from(byUnit.entries())
    .map(([unit, v]) => ({ unit, ...v }))
    .sort((a, b) => a.unit - b.unit);

  return {
    questionBankId: bank.id,
    subjectCode: bank.subject_code,
    subjectName: bank.subject_name ?? null,
    academicYear: bank.academic_year ?? null,
    department: bank.department ?? null,
    fileName: bank.file_name,
    partA,
    partB,
    partC,
    partBc: partB + partC,
    total: questions.length,
    units
  };
}

export async function getSourceBankStats(bankId: string): Promise<SourceBankStats> {
  const bank = await getSourceBankHeader(bankId);
  const questions = await loadSourceQuestions(bankId);
  return computeSourceStats(bank, questions);
}

// ====================================================================
// Validation (Spec §5, §7, §25)
// ====================================================================

export interface CountValidation {
  valid: boolean;
  errors: string[];
  availablePartA: number;
  availablePartBC: number;
}

// ====================================================================
// Unit-wise request types (Spec §5, §6)
// ====================================================================

/**
 * Raw per-unit request as submitted by the client.
 *
 * The Exam Cell may specify Part A, Part B and Part C independently
 * (Spec §5, e.g. Part A -> 10, Part B -> 5, Part C -> 2). `partBC` is the
 * legacy combined form and is still accepted; when `partB` / `partC` are
 * supplied they win and `partBC` is derived from them.
 */
export interface UnitRequestInput {
  unit: number;
  partA?: number | string | null;
  partB?: number | string | null;
  partC?: number | string | null;
  partBC?: number | string | null;
}

/** Normalised per-unit request: every part has an explicit, exact count. */
export interface UnitRequest {
  unit: number;   // 1–5
  partA: number;  // requested Part A questions from this unit
  partB: number;  // requested Part B questions from this unit
  partC: number;  // requested Part C questions from this unit
  /** Part B + Part C combined. Always equal to partB + partC after normalising. */
  partBC: number;
}

function toCount(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return Number.NaN;
  return n;
}

/**
 * Turns raw client input into exact per-part counts. Returns `null` when a
 * value is not a non-negative whole number so the caller can reject it with
 * a precise message instead of silently coercing it.
 */
export function normalizeUnitRequests(input: UnitRequestInput[]): UnitRequest[] | null {
  const out: UnitRequest[] = [];
  for (const raw of input) {
    const unit = Number(raw.unit);
    if (!Number.isInteger(unit) || unit < 1 || unit > 5) return null;

    const partA = toCount(raw.partA);
    const hasSplit = raw.partB !== null && raw.partB !== undefined && raw.partB !== '';
    const hasPartB = hasSplit || (raw.partC !== null && raw.partC !== undefined && raw.partC !== '');
    const partB = toCount(hasPartB ? raw.partB : null);
    const partC = toCount(hasPartB ? raw.partC : null);
    const partBC = hasPartB ? partB + partC : toCount(raw.partBC);

    if (Number.isNaN(partA) || Number.isNaN(partB) || Number.isNaN(partC) || Number.isNaN(partBC)) {
      return null;
    }
    out.push({ unit, partA, partB, partC, partBC });
  }
  return out;
}

/** Validation result for a single unit's request. */
export interface UnitValidationResult {
  unit: number;
  valid: boolean;
  errors: string[];
  availablePartA: number;
  availablePartB: number;
  availablePartC: number;
  availablePartBC: number;
}

/**
 * Validates per-unit requested counts against what is actually available in
 * the source bank for that unit. A unit that requests more Part B questions
 * than it holds is a hard error — the system never silently reduces the
 * requested quantity (Spec §6, §16).
 */
export function validateUnitRequests(
  questions: SourceQuestion[],
  unitRequests: UnitRequest[]
): UnitValidationResult[] {
  const byUnit = new Map<number, { partA: number; partB: number; partC: number }>();
  for (const q of questions) {
    const u = typeof q.unit === 'number' && q.unit >= 1 && q.unit <= 5 ? q.unit : 0;
    const b = byUnit.get(u) || { partA: 0, partB: 0, partC: 0 };
    if (q.part === 'Part A') b.partA++;
    else if (q.part === 'Part C') b.partC++;
    else b.partB++;
    byUnit.set(u, b);
  }

  return unitRequests.map((req) => {
    const avail = byUnit.get(req.unit) || { partA: 0, partB: 0, partC: 0 };
    const errors: string[] = [];

    // Safely coerce fields — undefined/null/NaN become 0 so missing fields
    // (e.g. when client sends only partBC) never produce spurious errors.
    const reqPartA  = Number.isFinite(req.partA)  && Number.isInteger(req.partA)  ? req.partA  : (Number(req.partA  ?? 0) || 0);
    const reqPartB  = Number.isFinite(req.partB)  && Number.isInteger(req.partB)  ? req.partB  : (Number(req.partB  ?? 0) || 0);
    const reqPartC  = Number.isFinite(req.partC)  && Number.isInteger(req.partC)  ? req.partC  : (Number(req.partC  ?? 0) || 0);

    if (!Number.isInteger(reqPartA) || reqPartA < 0)
      errors.push(`Unit ${req.unit}: Part A count must be a non-negative integer.`);
    else if (reqPartA > avail.partA)
      errors.push(`Unit ${req.unit}: Requested ${reqPartA} Part A questions but only ${avail.partA} available.`);
    if (!Number.isInteger(reqPartB) || reqPartB < 0)
      errors.push(`Unit ${req.unit}: Part B count must be a non-negative integer.`);
    else if (reqPartB > avail.partB)
      errors.push(`Unit ${req.unit}: Requested ${reqPartB} Part B questions but only ${avail.partB} available.`);
    if (!Number.isInteger(reqPartC) || reqPartC < 0)
      errors.push(`Unit ${req.unit}: Part C count must be a non-negative integer.`);
    else if (reqPartC > avail.partC)
      errors.push(`Unit ${req.unit}: Requested ${reqPartC} Part C questions but only ${avail.partC} available.`);
    return {
      unit: req.unit,
      valid: errors.length === 0,
      errors,
      availablePartA: avail.partA,
      availablePartB: avail.partB,
      availablePartC: avail.partC,
      availablePartBC: avail.partB + avail.partC
    };
  });
}

/**
 * Balanced default distribution across the five units (Spec §6).
 *
 * Used when the Exam Cell does not specify unit-wise quantities. The result
 * is always returned to the UI so the distribution can be shown BEFORE
 * saving — it is never applied silently behind the user's back.
 */
export function proposeBalancedUnitDistribution(
  questions: SourceQuestion[],
  requested: { partA: number; partB: number; partC: number }
): UnitRequest[] {
  const byUnit = new Map<number, { partA: number; partB: number; partC: number }>();
  for (const q of questions) {
    const u = typeof q.unit === 'number' && q.unit >= 1 && q.unit <= 5 ? q.unit : 0;
    const b = byUnit.get(u) || { partA: 0, partB: 0, partC: 0 };
    if (q.part === 'Part A') b.partA++;
    else if (q.part === 'Part C') b.partC++;
    else b.partB++;
    byUnit.set(u, b);
  }
  const units = [1, 2, 3, 4, 5];
  const capFor = (part: 'partA' | 'partB' | 'partC') =>
    new Map<number, number>(units.map((u) => [u, byUnit.get(u)?.[part] ?? 0]));

  const distA = allocateUnits(units, capFor('partA'), requested.partA);
  const distB = allocateUnits(units, capFor('partB'), requested.partB);
  const distC = allocateUnits(units, capFor('partC'), requested.partC);

  return units.map((unit) => {
    const partA = distA.get(unit) || 0;
    const partB = distB.get(unit) || 0;
    const partC = distC.get(unit) || 0;
    return { unit, partA, partB, partC, partBC: partB + partC };
  });
}

export function validateRequestedCounts(
  stats: Pick<SourceBankStats, 'partA' | 'partB' | 'partC' | 'partBc'>,
  requestedPartA: unknown,
  requestedPartBC: unknown
): CountValidation {
  const errors: string[] = [];
  const availablePartA = stats.partA;
  const availablePartBC = stats.partBc;

  const a = parseCountInput(requestedPartA);
  const bc = parseCountInput(requestedPartBC);

  if (a === null) {
    errors.push('Part A Questions must be a whole number between 0 and ' + availablePartA + '.');
  } else if (a > availablePartA) {
    // Exact wording required by Spec §5
    errors.push(`Cannot generate ${a} Part A questions. Only ${availablePartA} Part A questions are available in the selected question bank.`);
  }

  if (bc === null) {
    errors.push('Part B + Part C Questions must be a whole number between 0 and ' + availablePartBC + '.');
  } else if (bc > availablePartBC) {
    // Exact wording required by Spec §5
    errors.push(`Cannot generate ${bc} Part B/C questions. Only ${availablePartBC} eligible questions are available.`);
  }

  if (a === 0 && bc === 0) {
    errors.push('Enter at least one question to generate. A reduced IAT question bank cannot be empty.');
  }

  return { valid: errors.length === 0, errors, availablePartA, availablePartBC };
}

function parseCountInput(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

// ====================================================================
// Unit distribution (Spec §8)
// ====================================================================

/**
 * Largest-remainder allocation of `total` across `units`, respecting each
 * unit's capacity. Deficits from units that cannot fill their share spill over
 * to units that still have headroom, so the sum always equals `total`
 * whenever the pool is large enough.
 */
export function allocateUnits(
  units: number[],
  capacities: Map<number, number>,
  total: number
): Map<number, number> {
  const quota = new Map<number, number>();
  const active = units.filter((u) => (capacities.get(u) || 0) > 0);
  active.forEach((u) => quota.set(u, 0));
  if (active.length === 0) return quota;

  const capacitySum = active.reduce((s, u) => s + (capacities.get(u) || 0), 0);
  let remaining = Math.min(total, capacitySum);

  const base = Math.floor(remaining / active.length);
  let remainder = remaining % active.length;
  // Units with the most questions absorb the extra slot first.
  const ordered = [...active].sort((a, b) => (capacities.get(b) || 0) - (capacities.get(a) || 0));
  ordered.forEach((u) => quota.set(u, Math.min(base, capacities.get(u) || 0)));

  // Distribute the remainder. A single pass is not enough when the smallest
  // units have already hit their capacity, so keep cycling until the
  // remainder is exhausted or no unit has headroom left.
  let guardRemainder = 0;
  while (remainder > 0 && guardRemainder++ < active.length * 4) {
    let placed = 0;
    for (const u of ordered) {
      if (remainder <= 0) break;
      const cap = capacities.get(u) || 0;
      if ((quota.get(u) || 0) < cap) {
        quota.set(u, (quota.get(u) || 0) + 1);
        remainder--;
        placed++;
      }
    }
    if (placed === 0) break;
  }

  // Spill deficits from oversubscribed units to units with spare capacity.
  let guard = 0;
  let changed = true;
  while (changed && guard++ < 64) {
    changed = false;
    for (const u of active) {
      const cap = capacities.get(u) || 0;
      const q = quota.get(u) || 0;
      if (q > cap) {
        quota.set(u, cap);
        const deficit = q - cap;
        const hosts = active.filter((x) => (quota.get(x) || 0) < (capacities.get(x) || 0));
        if (hosts.length === 0) break;
        const per = Math.max(1, Math.ceil(deficit / hosts.length));
        let left = deficit;
        for (const h of hosts) {
          const headroom = (capacities.get(h) || 0) - (quota.get(h) || 0);
          const add = Math.min(per, headroom, left);
          if (add > 0) {
            quota.set(h, (quota.get(h) || 0) + add);
            left -= add;
          }
          if (left <= 0) break;
        }
        changed = true;
      }
    }
  }

  // Final guarantee: the allocation must sum to `total` whenever the pool has
  // enough questions. The caller relies on this (Spec §7 — never silently
  // return fewer questions than requested).
  const target = Math.min(total, capacitySum);
  let placed = 0;
  while (Array.from(quota.values()).reduce((a, b) => a + b, 0) < target) {
    const host = active
      .filter((u) => (quota.get(u) || 0) < (capacities.get(u) || 0))
      .sort((a, b) => (capacities.get(b) || 0) - (capacities.get(a) || 0))[0];
    if (!host) break;
    quota.set(host, (quota.get(host) || 0) + 1);
    placed++;
    if (placed > target + active.length) break; // safety valve
  }

  return quota;
}

// ====================================================================
// Balanced selection
// ====================================================================

/**
 * Greedy balance-aware pick inside a pool.
 *
 * Cost model (lower is better):
 *   - previously used questions are pushed back (Spec §7 "previous usage")
 *   - the two members of one OR group are not both taken
 *   - repeats of an already-selected BTL / CO / difficulty are penalised so
 *     the subset spans the cognitive levels instead of clustering
 *   - a seeded jitter makes "Regenerate Selection" produce a different subset
 */
function pickBalanced(
  pool: SourceQuestion[],
  count: number,
  rand: () => number
): SourceQuestion[] {
  const selected: SourceQuestion[] = [];
  const remaining = [...pool];
  const usedOrGroups = new Set<string>();
  const btlSeen = new Map<string, number>();
  const coSeen = new Map<string, number>();
  const diffSeen = new Map<string, number>();

  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);

  while (selected.length < count && remaining.length > 0) {
    let bestIdx = 0;
    let bestCost = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const btlKey = c.btl || c.blooms_level || 'n/a';
      let cost = c.timesUsed * 12;
      if (c.or_group_id && usedOrGroups.has(c.or_group_id)) cost += 30;
      cost += (btlSeen.get(btlKey) || 0) * 5;
      cost += (coSeen.get(c.co || 'n/a') || 0) * 2;
      cost += (diffSeen.get(c.difficulty || 'n/a') || 0) * 1.5;
      cost += rand() * 4;
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    selected.push(chosen);
    if (chosen.or_group_id) usedOrGroups.add(chosen.or_group_id);
    bump(btlSeen, chosen.btl || chosen.blooms_level || 'n/a');
    bump(coSeen, chosen.co || 'n/a');
    bump(diffSeen, chosen.difficulty || 'n/a');
  }
  return selected;
}

/**
 * Swaps selected / unselected questions INSIDE the same unit so the
 * Part B vs Part C mix approaches the proportional target without disturbing
 * the unit distribution or the total count. Never changes the total.
 */
function correctPartMix(
  pool: SourceQuestion[],
  selected: SourceQuestion[],
  targetPartB: number,
  targetPartC: number
): SourceQuestion[] {
  const result = [...selected];
  let guard = 0;

  const countOf = (list: SourceQuestion[], part: QuestionPart) =>
    list.filter((q) => q.part === part).length;

  while (guard++ < 200) {
    const haveB = countOf(result, 'Part B');
    const haveC = countOf(result, 'Part C');
    const needB = targetPartB - haveB;
    const needC = targetPartC - haveC;
    if (needB === 0 && needC === 0) break;

    const overPart: QuestionPart = needB < 0 ? 'Part B' : 'Part C';
    const underPart: QuestionPart = overPart === 'Part B' ? 'Part C' : 'Part B';
    const selectedIdx = result.findIndex((q) => q.part === overPart);
    if (selectedIdx === -1) break;

    const outQ = result[selectedIdx];
    // Prefer a same-unit replacement so unit totals are preserved exactly.
    const usedIds = new Set(result.map((q) => q.id));
    const inUnit = pool.find(
      (q) => q.part === underPart && !usedIds.has(q.id) && q.unit === outQ.unit
    );
    const inAny = pool.find((q) => q.part === underPart && !usedIds.has(q.id));
    const replacement = inUnit || inAny;
    if (!replacement) break;

    result[selectedIdx] = replacement;
  }
  return result;
}

/** Proportional Part B / Part C targets for a combined pool (Spec §6). */
export function computePartMixTargets(
  partBAvailable: number,
  partCAvailable: number,
  requested: number
): { partB: number; partC: number } {
  const total = partBAvailable + partCAvailable;
  if (total === 0) return { partB: 0, partC: 0 };
  let partB = Math.round((requested * partBAvailable) / total);
  partB = Math.max(0, Math.min(requested, partB));
  // Keep the target reachable with the availability of each part.
  partB = Math.max(Math.max(0, requested - partCAvailable), Math.min(partBAvailable, partB));
  const partC = requested - partB;
  return { partB, partC };
}

function capacitiesFor(questions: SourceQuestion[], parts: QuestionPart[]): Map<number, number> {
  const caps = new Map<number, number>();
  for (const q of questions) {
    if (!parts.includes(q.part)) continue;
    const u = typeof q.unit === 'number' ? q.unit : 0;
    caps.set(u, (caps.get(u) || 0) + 1);
  }
  return caps;
}

/**
 * Deterministic, balance-aware subset selection.
 *
 * @param pool          candidate questions (already filtered to the right parts)
 * @param requested     exact number of questions to return
 * @param parts         which parts the pool contains
 * @param seed          PRNG seed — change it to "regenerate"
 */
export function selectBalancedSubset(params: {
  pool: SourceQuestion[];
  requested: number;
  parts: QuestionPart[];
  partBAvailable: number;
  partCAvailable: number;
  seed: number;
}): { selected: SourceQuestion[]; unitDistribution: UnitDistributionRow[] } {
  const { pool, requested, parts, partBAvailable, partCAvailable, seed } = params;
  const rand = mulberry32(seed);
  const partOf = (q: SourceQuestion) => q.part;
  const partBC = parts.filter((p) => p !== 'Part A');

  // --- unit capacities and allocation ---------------------------------
  const caps = capacitiesFor(pool, parts);
  const units = Array.from(caps.keys()).sort((a, b) => a - b);
  const quota = allocateUnits(units, caps, requested);

  // --- pick per unit --------------------------------------------------
  let selected: SourceQuestion[] = [];
  for (const u of units) {
    const want = quota.get(u) || 0;
    if (want <= 0) continue;
    const unitPool = pool.filter((q) => (typeof q.unit === 'number' ? q.unit : 0) === u);
    selected.push(...pickBalanced(unitPool, want, rand));
  }

  // --- part mix correction for a combined B/C pool --------------------
  if (partBC.length > 1) {
    const targets = computePartMixTargets(partBAvailable, partCAvailable, selected.length);
    selected = correctPartMix(pool, selected, targets.partB, targets.partC);
  }

  // --- hard guarantees (Spec §7: never silently change the count) -----
  if (selected.length < requested) {
    const usedIds = new Set(selected.map((q) => q.id));
    const topUp = pool.filter((q) => !usedIds.has(q.id));
    selected = [...selected, ...pickBalanced(topUp, requested - selected.length, rand)];
  }
  if (selected.length > requested) selected = selected.slice(0, requested);

  // Dedupe defensively (Spec §13) — the DB unique index is the real guard.
  const seen = new Set<string>();
  selected = selected.filter((q) => {
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });

  return { selected, unitDistribution: buildUnitDistribution(selected) };
}

export function buildUnitDistribution(selected: SourceQuestion[]): UnitDistributionRow[] {
  const map = new Map<number, UnitDistributionRow>();
  for (const q of selected) {
    const u = typeof q.unit === 'number' ? q.unit : 0;
    const row = map.get(u) || { unit: u, partA: 0, partB: 0, partC: 0, total: 0 };
    if (q.part === 'Part A') row.partA++;
    else if (q.part === 'Part C') row.partC++;
    else row.partB++;
    row.total++;
    map.set(u, row);
  }
  return Array.from(map.values()).sort((a, b) => a.unit - b.unit);
}

function toSelected(
  q: SourceQuestion,
  orderIndex: number,
  ordinal: number
): SelectedQuestion {
  return {
    sourceQuestionId: q.id,
    originalQuestionId: q.id,
    sourceQuestionNumber: `${ordinal + 1}.`,
    questionText: q.question_text,
    originalPart: q.part,
    unit: q.unit,
    marks: q.marks,
    btl: q.btl,
    bloomsLevel: q.blooms_level,
    co: q.co,
    pi: q.pi,
    difficulty: q.difficulty,
    orGroupId: q.or_group_id,
    orOption: q.or_option,
    sourcePage: q.source_page,
    subjectCode: q.subject_code,
    orderIndex,
    timesUsed: q.timesUsed
  };
}

// ====================================================================
// Naming (Spec §26)
// ====================================================================

/** "24CS514 - Computer Networks - IAT Bank 01" */
export function formatGeneratedBankName(subjectCode: string, subjectName: string, seq: number): string {
  const padded = String(seq).padStart(2, '0');
  return `${subjectCode} - ${subjectName} - IAT Bank ${padded}`;
}

/** Finds the lowest free sequence number for the given subject. */
export async function nextGeneratedBankSequence(subjectCode: string, subjectName: string): Promise<{ sequence: number; name: string }> {
  const client = db();
  const { data, error } = await client
    .from('iat_generated_question_banks')
    .select('name')
    .eq('subject_code', subjectCode)
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingIatSchema(error)) throw new IatFeatureError(MISSING_SCHEMA_MESSAGE, 503, 'IAT_SCHEMA_MISSING');
    throw new IatFeatureError(`Failed to determine the next IAT bank number: ${error.message}`, 500, 'IAT_BANK_NAMING_FAILED');
  }
  const taken = new Set((data || []).map((r: any) => String(r.name || '')));
  for (let seq = 1; seq < 1000; seq++) {
    const name = formatGeneratedBankName(subjectCode, subjectName, seq);
    if (!taken.has(name)) return { sequence: seq, name };
  }
  // Exhausted — fall back to a timestamped name that cannot collide.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return { sequence: 0, name: `${formatGeneratedBankName(subjectCode, subjectName, 0)} ${stamp}` };
}

async function assertNameAvailable(name: string): Promise<void> {
  const client = db();
  const { data, error } = await client
    .from('iat_generated_question_banks')
    .select('id, name')
    .eq('name', name)
    .maybeSingle();
  if (error) {
    if (isMissingIatSchema(error)) throw new IatFeatureError(MISSING_SCHEMA_MESSAGE, 503, 'IAT_SCHEMA_MISSING');
    throw new IatFeatureError(`Failed to validate the IAT bank name: ${error.message}`, 500, 'IAT_BANK_NAMING_FAILED');
  }
  if (data) {
    throw new IatFeatureError(
      `An IAT question bank named "${name}" already exists. Choose a different name — an existing generated bank is never overwritten.`,
      409,
      'IAT_BANK_NAME_TAKEN'
    );
  }
}

// ====================================================================
// Preview generation (Spec §4, §8, §14, §15)
// ====================================================================

export interface GeneratePreviewParams {
  sourceQuestionBankId: string;
  requestedPartA: number;
  requestedPartBC: number;
  examType: string;
  seed?: number;
  /** Optional Gemini-assisted pick. Falls back deterministically on any failure. */
  useGemini?: boolean;
  /** Unit-wise requests — if provided, unit-wise logic is used instead of global counts. */
  unitRequests?: UnitRequest[];
}

export async function generateIatPreview(params: GeneratePreviewParams): Promise<IatPreview> {
  const examType = assertIatExamType(params.examType);
  const requestedPartA = parseCountInput(params.requestedPartA) ?? 0;
  const requestedPartBC = parseCountInput(params.requestedPartBC) ?? 0;
  const seed = Number.isFinite(params.seed as number) ? (params.seed as number) : Math.floor(Math.random() * 2 ** 31);

  const bank = await getSourceBankHeader(params.sourceQuestionBankId);
  const questions = await loadSourceQuestions(params.sourceQuestionBankId);
  const stats = computeSourceStats(bank, questions);

  const validation = validateRequestedCounts(stats, requestedPartA, requestedPartBC);
  if (!validation.valid) {
    throw new IatFeatureError(validation.errors.join(' '), 400, 'INVALID_REQUESTED_COUNTS');
  }

  const subjectCode = String(bank.subject_code);
  const subjectName = String(bank.subject_name || subjectCode);

  // ---- Part A --------------------------------------------------------
  const partAPool = questions.filter((q) => q.part === 'Part A');
  const partASelection = selectBalancedSubset({
    pool: partAPool,
    requested: requestedPartA,
    parts: ['Part A'],
    partBAvailable: 0,
    partCAvailable: 0,
    seed: seed ^ 0x9e3779b9
  });

  // ---- Part B + Part C as ONE combined pool (Spec §6) ----------------
  const partBCPool = questions.filter((q) => q.part === 'Part B' || q.part === 'Part C');
  const partBSelection = selectBalancedSubset({
    pool: partBCPool,
    requested: requestedPartBC,
    parts: ['Part B', 'Part C'],
    partBAvailable: stats.partB,
    partCAvailable: stats.partC,
    seed: seed
  });

  // Never the same source question in both pools — the DB enforces this too.
  const partAIds = new Set(partASelection.selected.map((q) => q.id));
  let partBCSelected = partBSelection.selected.filter((q) => !partAIds.has(q.id));
  if (partBCSelected.length < requestedPartBC) {
    const usedIds = new Set([...partAIds, ...partBCSelected.map((q) => q.id)]);
    const topUp = partBCPool.filter((q) => !usedIds.has(q.id));
    partBCSelected = [...partBCSelected, ...pickBalanced(topUp, requestedPartBC - partBCSelected.length, mulberry32(seed ^ 0x5bf03635))];
  }

  // ---- Optional Gemini assist (Spec §24) ------------------------------
  let selectionMethod: 'deterministic' | 'gemini' = 'deterministic';
  if (params.useGemini) {
    const { tryGeminiSelection } = await import('./iatSelectionGeminiService');
    const aiPicks = await tryGeminiSelection({
      partA: partASelection.selected,
      partBC: partBCSelected,
      requestedPartA,
      requestedPartBC,
      partBAvailable: stats.partB,
      partCAvailable: stats.partC
    });
    if (aiPicks) {
      partAIds.clear();
      aiPicks.partA.forEach((q) => partAIds.add(q.id));
      partBCSelected = aiPicks.partBC;
      selectionMethod = 'gemini';
    }
  }

  // ---- Final safety: exact counts, no duplicates ----------------------
  const seen = new Set<string>();
  const finalPartA = partASelection.selected.filter((q) => !seen.has(q.id) && (seen.add(q.id), true));
  const finalPartBC = partBCSelected.filter((q) => !seen.has(q.id) && (seen.add(q.id), true));

  if (finalPartA.length !== requestedPartA || finalPartBC.length !== requestedPartBC) {
    throw new IatFeatureError(
      `Cannot satisfy the requested counts. Part A: ${finalPartA.length}/${requestedPartA}, Part B/C: ${finalPartBC.length}/${requestedPartBC}. ` +
      `Available: Part A ${stats.partA}, Part B/C ${stats.partBc}.`,
      400,
      'COUNTS_NOT_SATISFIED'
    );
  }

  const partAOut = finalPartA.map((q, i) => toSelected(q, i, i));
  const partBCOut = finalPartBC.map((q, i) => toSelected(q, finalPartA.length + i, finalPartA.length + i));

  const actualPartB = finalPartBC.filter((q) => q.part === 'Part B').length;
  const actualPartC = finalPartBC.filter((q) => q.part === 'Part C').length;
  const { name } = await nextGeneratedBankSequence(subjectCode, subjectName);

  return {
    sourceBankId: bank.id,
    sourceBankName: String(bank.file_name || subjectName),
    academicYear: bank.academic_year ?? null,
    department: bank.department ?? null,
    subjectCode,
    subjectName,
    examType,
    requestedPartA,
    requestedPartBC,
    actualPartA: partAOut.length,
    actualPartB,
    actualPartC,
    totalQuestions: partAOut.length + partBCOut.length,
    partA: partAOut,
    partBC: partBCOut,
    unitDistribution: {
      partA: buildUnitDistribution(finalPartA),
      partBC: buildUnitDistribution(finalPartBC)
    },
    seed,
    selectionMethod,
    suggestedName: name,
    generatedAt: new Date().toISOString()
  };
}

// ====================================================================
// Unit-wise Preview Generation (new spec: per-unit independent selection)
// ====================================================================

export interface UnitWisePreview extends IatPreview {
  /** The original per-unit requests that produced this preview. */
  unitRequests: UnitRequest[];
  /** Per-unit validation results for display in the UI. */
  unitValidation: UnitValidationResult[];
}

/**
 * Generates an IAT preview where each unit's Part A and Part B/C questions
 * are selected independently, so the user has precise per-unit control.
 *
 * Invariants preserved:
 *  - §2: only selects from the ORIGINAL bank, never rewrites text
 *  - §6: Part B and Part C are a combined pool within each unit
 *  - §9: original bank is never modified
 *  - §13: no source question selected twice
 *  - By default requires all 5 units (units with 0 for both counts are skipped)
 */
export async function generateIatPreviewUnitWise(
  params: GeneratePreviewParams & { unitRequests: UnitRequest[] }
): Promise<UnitWisePreview> {
  const examType = assertIatExamType(params.examType);
  const seed = Number.isFinite(params.seed as number)
    ? (params.seed as number)
    : Math.floor(Math.random() * 2 ** 31);

  const bank = await getSourceBankHeader(params.sourceQuestionBankId);
  const allQuestions = await loadSourceQuestions(params.sourceQuestionBankId);

  // Validate each unit's requests
  const unitValidation = validateUnitRequests(allQuestions, params.unitRequests);
  const allErrors = unitValidation.flatMap((v) => v.errors);

  // Global sanity check — at least one question requested in total
  const totalA = params.unitRequests.reduce((s, r) => s + r.partA, 0);
  const totalBC = params.unitRequests.reduce((s, r) => s + r.partBC, 0);
  if (totalA === 0 && totalBC === 0) {
    allErrors.push('A reduced IAT question bank cannot be empty — request at least one question across all units.');
  }

  if (allErrors.length > 0) {
    throw new IatFeatureError(allErrors.join(' | '), 400, 'UNIT_WISE_VALIDATION_FAILED');
  }

  const subjectCode = String(bank.subject_code);
  const subjectName = String(bank.subject_name || subjectCode);

  const rand = mulberry32(seed);
  const globalSeen = new Set<string>(); // §13: no duplicates across units

  const finalPartA: SourceQuestion[] = [];
  const finalPartBC: SourceQuestion[] = [];

  // Process each unit independently
  for (const req of params.unitRequests) {
    const unitNum = req.unit;
    // Exclude already-selected questions (cross-unit dedup, §13)
    const unitQs = allQuestions.filter(
      (q) => (typeof q.unit === 'number' ? q.unit : 0) === unitNum && !globalSeen.has(q.id)
    );

    if (req.partA > 0) {
      const partAPool = unitQs.filter((q) => q.part === 'Part A');
      const picked = pickBalanced(partAPool, req.partA, rand);
      picked.forEach((q) => { globalSeen.add(q.id); finalPartA.push(q); });
    }

    if (req.partBC > 0) {
      const partBCPool = unitQs.filter(
        (q) => (q.part === 'Part B' || q.part === 'Part C') && !globalSeen.has(q.id)
      );
      // Proportional Part B/Part C mix within this unit
      const partBAvailable = partBCPool.filter((q) => q.part === 'Part B').length;
      const partCAvailable = partBCPool.filter((q) => q.part === 'Part C').length;
      const targets = computePartMixTargets(partBAvailable, partCAvailable, req.partBC);

      let picked = pickBalanced(partBCPool, req.partBC, rand);
      picked = correctPartMix(partBCPool, picked, targets.partB, targets.partC);
      picked.forEach((q) => { globalSeen.add(q.id); finalPartBC.push(q); });
    }
  }

  // Build the preview output
  const partAOut = finalPartA.map((q, i) => toSelected(q, i, i));
  const partBCOut = finalPartBC.map((q, i) => toSelected(q, finalPartA.length + i, finalPartA.length + i));

  const actualPartA = partAOut.length;
  const actualPartB = finalPartBC.filter((q) => q.part === 'Part B').length;
  const actualPartC = finalPartBC.filter((q) => q.part === 'Part C').length;
  const { name } = await nextGeneratedBankSequence(subjectCode, subjectName);

  // Aggregate global counts (for backward compat fields)
  const requestedPartA = params.unitRequests.reduce((s, r) => s + r.partA, 0);
  const requestedPartBC = params.unitRequests.reduce((s, r) => s + r.partBC, 0);

  return {
    sourceBankId: bank.id,
    sourceBankName: String(bank.file_name || subjectName),
    academicYear: bank.academic_year ?? null,
    department: bank.department ?? null,
    subjectCode,
    subjectName,
    examType,
    requestedPartA,
    requestedPartBC,
    actualPartA,
    actualPartB,
    actualPartC,
    totalQuestions: actualPartA + actualPartB + actualPartC,
    partA: partAOut,
    partBC: partBCOut,
    unitDistribution: {
      partA: buildUnitDistribution(finalPartA),
      partBC: buildUnitDistribution(finalPartBC)
    },
    seed,
    selectionMethod: 'deterministic',
    suggestedName: name,
    generatedAt: new Date().toISOString(),
    unitRequests: params.unitRequests,
    unitValidation
  };
}

// ====================================================================
// Persistence (Spec §10, §11, §12, §16)
// ====================================================================

export interface SaveGeneratedBankParams {
  sourceQuestionBankId: string;
  requestedPartA: number;
  requestedPartBC: number;
  examType: string;
  name?: string;
  /** When supplied the exact preview is stored; otherwise a fresh subset is selected. */
  seed?: number;
  user: { userId: string; email: string; name: string; role: string };
  /** If unit-wise mode was used, pass the original unit requests so the same
   *  generation path is re-used during save (ensures exact reproducibility). */
  unitRequests?: UnitRequest[];
}

export interface SaveGeneratedBankResult {
  generatedBank: GeneratedBankSummary;
  preview: IatPreview;
}

export async function saveGeneratedBank(
  params: SaveGeneratedBankParams
): Promise<SaveGeneratedBankResult> {
  const examType = assertIatExamType(params.examType);
  const client = db();

  // Audit: generation started (Spec §27)
  await writeAuditLog({
    userId: params.user.userId,
    userEmail: params.user.email,
    userName: params.user.name,
    role: params.user.role,
    action: AUDIT_ACTIONS.IAT_BANK_GENERATION_STARTED,
    status: 'SUCCESS',
    metadata: {
      academic_year: params.sourceQuestionBankId,
      source_question_bank_id: params.sourceQuestionBankId,
      requested_part_a: params.requestedPartA,
      requested_part_bc: params.requestedPartBC,
      exam_type: examType
    }
  });

  // Rebuild (or reuse) the exact selection that was previewed.
  // Use unit-wise path when the original request carried unit breakdown.
  const preview = params.unitRequests && params.unitRequests.length > 0
    ? await generateIatPreviewUnitWise({
        sourceQuestionBankId: params.sourceQuestionBankId,
        requestedPartA: params.requestedPartA,
        requestedPartBC: params.requestedPartBC,
        examType,
        seed: params.seed,
        unitRequests: params.unitRequests
      })
    : await generateIatPreview({
        sourceQuestionBankId: params.sourceQuestionBankId,
        requestedPartA: params.requestedPartA,
        requestedPartBC: params.requestedPartBC,
        examType,
        seed: params.seed
      });

  const sourceBank = await getSourceBankHeader(params.sourceQuestionBankId);
  const name = (params.name || '').trim() || preview.suggestedName;
  await assertNameAvailable(name);

  const generatedBankId = uuidv4();
  const questionBankId = uuidv4();
  const now = new Date().toISOString();
  const subjectCode = preview.subjectCode;
  const subjectName = preview.subjectName;

  // 1) A real `question_banks` row so the reduced bank is a first-class bank
  //    that existing bank queries can see. bank_type + parent link record the
  //    permanent relationship with its source (Spec §7 / §10).
  const bankInsert = await client.from('question_banks').insert({
    id: questionBankId,
    subject_code: subjectCode,
    subject_name: subjectName,
    file_name: name,
    file_size_bytes: null,
    total_pages: null,
    total_units: sourceBank.total_units ?? null,
    regulation: sourceBank.regulation ?? null,
    storage_path: null,
    uploaded_by: params.user.name,
    status: 'approved',
    created_at: now,
    updated_at: now,
    academic_year: preview.academicYear,
    department: preview.department,
    bank_type: 'IAT_GENERATED',
    parent_question_bank_id: params.sourceQuestionBankId,
    created_by: params.user.userId,
    created_by_name: params.user.name
  });

  if (bankInsert.error) {
    if (isMissingIatSchema(bankInsert.error)) throw new IatFeatureError(MISSING_SCHEMA_MESSAGE, 503, 'IAT_SCHEMA_MISSING');
    throw new IatFeatureError(`Failed to create the reduced IAT question bank: ${bankInsert.error.message}`, 500, 'IAT_BANK_CREATE_FAILED');
  }

  // 2) The reduction header with requested vs actual counts (Spec §11)
  const headerInsert = await client.from('iat_generated_question_banks').insert({
    id: generatedBankId,
    question_bank_id: questionBankId,
    source_question_bank_id: params.sourceQuestionBankId,
    academic_year: preview.academicYear,
    department: preview.department,
    subject_code: subjectCode,
    subject_name: subjectName,
    name,
    requested_part_a_count: preview.requestedPartA,
    requested_part_bc_count: preview.requestedPartBC,
    actual_part_a_count: preview.actualPartA,
    actual_part_b_count: preview.actualPartB,
    actual_part_c_count: preview.actualPartC,
    total_questions: preview.totalQuestions,
    unit_distribution: preview.unitDistribution,
    selection_method: preview.selectionMethod,
    status: 'Active',
    created_by: params.user.userId,
    created_by_name: params.user.name,
    created_at: now,
    updated_at: now
  });

  if (headerInsert.error) {
    // Roll back the orphan bank row so nothing is left half-created.
    await client.from('question_banks').delete().eq('id', questionBankId);
    if (headerInsert.error.code === '23505') {
      throw new IatFeatureError(
        `An IAT question bank named "${name}" already exists. Existing generated banks are never overwritten.`,
        409,
        'IAT_BANK_NAME_TAKEN'
      );
    }
    if (isMissingIatSchema(headerInsert.error)) throw new IatFeatureError(MISSING_SCHEMA_MESSAGE, 503, 'IAT_SCHEMA_MISSING');
    throw new IatFeatureError(`Failed to save the IAT question bank: ${headerInsert.error.message}`, 500, 'IAT_BANK_SAVE_FAILED');
  }

  // 3) Every selected question, linked to its ORIGINAL question (Spec §12)
  const rows = [...preview.partA, ...preview.partBC].map((q) => ({
    generated_bank_id: generatedBankId,
    source_question_id: q.sourceQuestionId,
    source_question_bank_id: params.sourceQuestionBankId,
    question_text: q.questionText,
    unit: q.unit,
    original_part: q.originalPart,
    marks: q.marks,
    btl: q.btl,
    co: q.co,
    pi: q.pi,
    difficulty: q.difficulty,
    source_question_number: q.sourceQuestionNumber,
    blooms_level: q.bloomsLevel,
    or_group_id: q.orGroupId,
    or_option: q.orOption,
    subject_code: q.subjectCode,
    source_page: q.sourcePage,
    order_index: q.orderIndex,
    created_at: now
  }));

  const questionsInsert = await client.from('iat_generated_questions').insert(rows);

  if (questionsInsert.error) {
    // Roll back both rows — a partially created bank is worse than none.
    await client.from('iat_generated_question_banks').delete().eq('id', generatedBankId);
    await client.from('question_banks').delete().eq('id', questionBankId);
    if (questionsInsert.error.code === '23505') {
      throw new IatFeatureError(
        'The selection contained a duplicate source question. The generated bank was not saved.',
        409,
        'DUPLICATE_SOURCE_QUESTION'
      );
    }
    throw new IatFeatureError(
      `Failed to save the selected questions: ${questionsInsert.error.message}`,
      500,
      'IAT_QUESTIONS_SAVE_FAILED'
    );
  }

  // Audit: created + saved (Spec §27)
  for (const action of [AUDIT_ACTIONS.IAT_BANK_CREATED, AUDIT_ACTIONS.IAT_BANK_SAVED]) {
    await writeAuditLog({
      userId: params.user.userId,
      userEmail: params.user.email,
      userName: params.user.name,
      role: params.user.role,
      action,
      status: 'SUCCESS',
      metadata: {
        academic_year: preview.academicYear,
        department: preview.department,
        subject_code: subjectCode,
        source_question_bank_id: params.sourceQuestionBankId,
        generated_bank_id: generatedBankId,
        name,
        requested_part_a: preview.requestedPartA,
        requested_part_bc: preview.requestedPartBC,
        actual_part_a: preview.actualPartA,
        actual_part_b: preview.actualPartB,
        actual_part_c: preview.actualPartC,
        total_questions: preview.totalQuestions,
        selection_method: preview.selectionMethod,
        exam_type: examType
      }
    });
  }

  const generatedBank = await getGeneratedBank(generatedBankId);
  return { generatedBank: generatedBank!, preview };
}

// ====================================================================
// Listing / detail / archive / delete (Spec §20, §22, §23)
// ====================================================================

export async function listGeneratedBanks(filters?: {
  academicYear?: string | null;
  department?: string | null;
  subjectCode?: string | null;
  sourceQuestionBankId?: string | null;
  status?: 'Active' | 'Archived' | null;
  includeArchived?: boolean;
}): Promise<GeneratedBankSummary[]> {
  const client = db();
  let q = client.from('iat_generated_question_banks').select('*');

  if (filters?.academicYear) q = q.eq('academic_year', filters.academicYear);
  if (filters?.department) q = q.eq('department', filters.department);
  if (filters?.subjectCode) q = q.eq('subject_code', filters.subjectCode);
  if (filters?.sourceQuestionBankId) q = q.eq('source_question_bank_id', filters.sourceQuestionBankId);
  if (filters?.status) q = q.eq('status', filters.status);
  else if (!filters?.includeArchived) q = q.eq('status', 'Active');

  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) {
    if (isMissingIatSchema(error)) throw new IatFeatureError(MISSING_SCHEMA_MESSAGE, 503, 'IAT_SCHEMA_MISSING');
    throw new IatFeatureError(`Failed to list IAT question banks: ${error.message}`, 500, 'IAT_BANK_LIST_FAILED');
  }

  const names = await sourceBankNames((data || []).map((r: any) => r.source_question_bank_id));
  return (data || []).map((r: any) => mapBankRow(r, names));
}

/** Resolves source-bank display names in one round trip. */
async function sourceBankNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter(Boolean))) as string[];
  if (unique.length === 0) return map;
  try {
    const client = db();
    const { data } = await client.from('question_banks').select('id, file_name, subject_name').in('id', unique);
    for (const row of data || []) {
      map.set(row.id, String(row.file_name || row.subject_name || ''));
    }
  } catch {
    // Display-name enrichment is cosmetic — never fail a list request over it.
  }
  return map;
}

function mapBankRow(r: any, sourceNames?: Map<string, string>): GeneratedBankSummary {
  return {
    id: r.id,
    questionBankId: r.question_bank_id,
    sourceQuestionBankId: r.source_question_bank_id,
    sourceBankName: sourceNames?.get(r.source_question_bank_id) ?? null,
    academicYear: r.academic_year ?? null,
    department: r.department ?? null,
    subjectCode: r.subject_code,
    subjectName: r.subject_name ?? null,
    name: r.name,
    requestedPartACount: r.requested_part_a_count,
    requestedPartBcCount: r.requested_part_bc_count,
    actualPartACount: r.actual_part_a_count,
    actualPartBCount: r.actual_part_b_count,
    actualPartCCount: r.actual_part_c_count,
    totalQuestions: r.total_questions,
    status: r.status,
    selectionMethod: r.selection_method,
    createdBy: r.created_by ?? null,
    createdByName: r.created_by_name ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? null,
    archivedAt: r.archived_at ?? null,
    archiveReason: r.archive_reason ?? null
  };
}

export async function getGeneratedBank(id: string): Promise<GeneratedBankDetail | null> {
  const client = db();
  const { data, error } = await client
    .from('iat_generated_question_banks')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingIatSchema(error)) throw new IatFeatureError(MISSING_SCHEMA_MESSAGE, 503, 'IAT_SCHEMA_MISSING');
    throw new IatFeatureError(`Failed to load the IAT question bank: ${error.message}`, 500, 'IAT_BANK_LOAD_FAILED');
  }
  if (!data) return null;

  const names = await sourceBankNames([data.source_question_bank_id]);

  const { data: rows, error: qErr } = await client
    .from('iat_generated_questions')
    .select('*')
    .eq('generated_bank_id', id)
    .order('order_index', { ascending: true });
  if (qErr) throw new IatFeatureError(`Failed to load the selected questions: ${qErr.message}`, 500, 'IAT_QUESTIONS_LOAD_FAILED');

  const questions: SelectedQuestion[] = (rows || []).map((r: any) => ({
    sourceQuestionId: r.source_question_id,
    originalQuestionId: r.source_question_id,
    sourceQuestionNumber: r.source_question_number || '',
    questionText: r.question_text,
    originalPart: normalizePart(r.original_part),
    unit: r.unit ?? null,
    marks: r.marks ?? null,
    btl: r.btl ?? null,
    bloomsLevel: r.blooms_level ?? null,
    co: r.co ?? null,
    pi: r.pi ?? null,
    difficulty: r.difficulty ?? null,
    orGroupId: r.or_group_id ?? null,
    orOption: r.or_option ?? null,
    sourcePage: r.source_page ?? null,
    subjectCode: r.subject_code || '',
    orderIndex: r.order_index ?? 0,
    timesUsed: 0
  }));

  return {
    ...mapBankRow(data, names),
    unitDistribution: (data.unit_distribution as any) ?? null,
    questions
  };
}

export async function archiveGeneratedBank(
  id: string,
  reason: string | null,
  user: { userId: string; email: string; name: string; role: string }
): Promise<GeneratedBankDetail> {
  const client = db();
  const { data, error } = await client
    .from('iat_generated_question_banks')
    .update({
      status: 'Archived',
      archived_at: new Date().toISOString(),
      archived_by: user.userId,
      archived_by_name: user.name,
      archive_reason: reason || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    if (isMissingIatSchema(error)) throw new IatFeatureError(MISSING_SCHEMA_MESSAGE, 503, 'IAT_SCHEMA_MISSING');
    throw new IatFeatureError(`Failed to archive the IAT question bank: ${error.message}`, 500, 'IAT_BANK_ARCHIVE_FAILED');
  }
  if (!data) throw new IatFeatureError('The IAT question bank was not found.', 404, 'IAT_BANK_NOT_FOUND');

  // Mirror the status onto the `question_banks` row so the bank lists agree.
  await client.from('question_banks').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', data.question_bank_id);

  await writeAuditLog({
    userId: user.userId,
    userEmail: user.email,
    userName: user.name,
    role: user.role,
    action: AUDIT_ACTIONS.IAT_BANK_ARCHIVED,
    status: 'SUCCESS',
    metadata: {
      academic_year: data.academic_year,
      department: data.department,
      subject_code: data.subject_code,
      source_question_bank_id: data.source_question_bank_id,
      generated_bank_id: id,
      reason: reason || null
    }
  });

  const detail = await getGeneratedBank(id);
  return detail!;
}

export async function restoreGeneratedBank(
  id: string,
  user: { userId: string; email: string; name: string; role: string }
): Promise<GeneratedBankDetail> {
  const client = db();
  const { data, error } = await client
    .from('iat_generated_question_banks')
    .update({ status: 'Active', archived_at: null, archived_by: null, archived_by_name: null, archive_reason: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw new IatFeatureError(`Failed to restore the IAT question bank: ${error.message}`, 500, 'IAT_BANK_RESTORE_FAILED');
  if (!data) throw new IatFeatureError('The IAT question bank was not found.', 404, 'IAT_BANK_NOT_FOUND');

  await writeAuditLog({
    userId: user.userId,
    userEmail: user.email,
    userName: user.name,
    role: user.role,
    action: AUDIT_ACTIONS.IAT_BANK_RESTORED,
    status: 'SUCCESS',
    metadata: {
      academic_year: data.academic_year,
      department: data.department,
      subject_code: data.subject_code,
      source_question_bank_id: data.source_question_bank_id,
      generated_bank_id: id
    }
  });
  const detail = await getGeneratedBank(id);
  return detail!;
}

/**
 * Deletes a generated IAT bank ONLY. The source/original bank is protected by
 * the ON DELETE RESTRICT foreign key in the database and is never touched
 * here (Spec §20).
 */
export async function deleteGeneratedBank(
  id: string,
  user: { userId: string; email: string; name: string; role: string }
): Promise<{ deleted: boolean; sourceQuestionBankId: string | null }> {
  const client = db();
  const { data: header, error: headErr } = await client
    .from('iat_generated_question_banks')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (headErr) {
    if (isMissingIatSchema(headErr)) throw new IatFeatureError(MISSING_SCHEMA_MESSAGE, 503, 'IAT_SCHEMA_MISSING');
    throw new IatFeatureError(`Failed to load the IAT question bank: ${headErr.message}`, 500, 'IAT_BANK_LOAD_FAILED');
  }
  if (!header) throw new IatFeatureError('The IAT question bank was not found.', 404, 'IAT_BANK_NOT_FOUND');

  const { error } = await client.from('iat_generated_question_banks').delete().eq('id', id);
  if (error) throw new IatFeatureError(`Failed to delete the IAT question bank: ${error.message}`, 500, 'IAT_BANK_DELETE_FAILED');

  // Removing the header cascades to iat_generated_questions; the
  // `question_banks` row for the reduced bank is removed explicitly. The
  // SOURCE bank (parent_question_bank_id) is never referenced here.
  await client.from('question_banks').delete().eq('id', header.question_bank_id);

  await writeAuditLog({
    userId: user.userId,
    userEmail: user.email,
    userName: user.name,
    role: user.role,
    action: AUDIT_ACTIONS.IAT_BANK_DELETED,
    status: 'SUCCESS',
    metadata: {
      academic_year: header.academic_year,
      department: header.department,
      subject_code: header.subject_code,
      source_question_bank_id: header.source_question_bank_id,
      generated_bank_id: id,
      name: header.name
    }
  });

  return { deleted: true, sourceQuestionBankId: header.source_question_bank_id };
}

// ====================================================================
// Paper-generation integration (Spec §18, §29)
// ====================================================================

export interface PaperPoolQuestion {
  /** The ORIGINAL `questions.id` — this is what usage is recorded against. */
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

export interface PaperPool {
  generatedBankId: string;
  name: string;
  totalQuestions: number;
  questions: PaperPoolQuestion[];
}

/**
 * Returns the reduced bank as a question pool for IAT paper generation.
 * The text always comes from the stored snapshot of the ORIGINAL question —
 * the AI is never trusted to produce question text (Spec §24).
 */
export async function getGeneratedBankPaperPool(generatedBankId: string): Promise<PaperPool> {
  const client = db();
  const { data: header, error } = await client
    .from('iat_generated_question_banks')
    .select('id, name, subject_code, total_questions, status, source_question_bank_id')
    .eq('id', generatedBankId)
    .maybeSingle();
  if (error) {
    if (isMissingIatSchema(error)) throw new IatFeatureError(MISSING_SCHEMA_MESSAGE, 503, 'IAT_SCHEMA_MISSING');
    throw new IatFeatureError(`Failed to load the IAT question bank: ${error.message}`, 500, 'IAT_BANK_LOAD_FAILED');
  }
  if (!header) throw new IatFeatureError('The selected IAT question bank no longer exists.', 404, 'IAT_BANK_NOT_FOUND');
  if (header.status !== 'Active') {
    throw new IatFeatureError(
      `"${header.name}" is archived and cannot be used for paper generation. Restore it first.`,
      400,
      'IAT_BANK_ARCHIVED'
    );
  }

  const { data: rows, error: qErr } = await client
    .from('iat_generated_questions')
    .select('source_question_id, question_text, original_part, unit, marks, btl, blooms_level, co, pi, difficulty, subject_code, order_index')
    .eq('generated_bank_id', generatedBankId)
    .order('order_index', { ascending: true });
  if (qErr) throw new IatFeatureError(`Failed to load the selected questions: ${qErr.message}`, 500, 'IAT_QUESTIONS_LOAD_FAILED');

  const questions: PaperPoolQuestion[] = (rows || []).map((r: any) => ({
    sourceQuestionId: r.source_question_id,
    questionText: r.question_text,
    originalPart: normalizePart(r.original_part),
    unit: r.unit ?? null,
    marks: r.marks ?? null,
    btl: r.btl ?? null,
    bloomsLevel: r.blooms_level ?? null,
    co: r.co ?? null,
    pi: r.pi ?? null,
    difficulty: r.difficulty ?? null,
    subjectCode: r.subject_code || header.subject_code
  }));

  return {
    generatedBankId: header.id,
    name: header.name,
    totalQuestions: questions.length,
    questions
  };
}

/** Audit hook fired when a generated IAT bank is chosen for a paper (Spec §27). */
export async function auditGeneratedBankUsedForPaper(params: {
  generatedBankId: string;
  examType: string;
  academicYear?: string | null;
  department?: string | null;
  subjectCode?: string | null;
  paperCode?: string | null;
  user: { userId: string; email: string; name: string; role: string };
}): Promise<void> {
  const examType = assertIatExamType(params.examType);
  await writeAuditLog({
    userId: params.user.userId,
    userEmail: params.user.email,
    userName: params.user.name,
    role: params.user.role,
    action: AUDIT_ACTIONS.IAT_BANK_SELECTED_FOR_PAPER,
    status: 'SUCCESS',
    metadata: {
      academic_year: params.academicYear,
      department: params.department,
      subject_code: params.subjectCode,
      generated_bank_id: params.generatedBankId,
      exam_type: examType,
      paper_code: params.paperCode
    }
  });
}
