/**
 * Question Count Service (Spec §9–§13)
 *
 * Provides the REAL number of imported questions available for a subject,
 * scoped to the generation context:
 *
 *   Academic Year + Department + Subject Code
 *
 * Schema reality (inspected, not assumed):
 *   - `questions` rows carry `subject_code` and `question_bank_id`, but
 *     mapQuestionToRow() does NOT write `academic_year` / `department`.
 *   - `question_banks` DOES carry `academic_year` and `department` (migration
 *     002), and may additionally carry `subject_id` (migration 003).
 *   - `subjects` is the master table: subject_code + department_id +
 *     academic_year_id.
 *
 * So the count is computed through the `question_banks` relationship, and
 * questions belonging to banks with no year/department attribution are only
 * counted when the subject code maps to exactly ONE subject row for the
 * target year+department. That prevents counting another academic year or
 * another department's questions (Spec §13).
 *
 * A failure is reported as an error — never silently turned into 0 (Spec §15).
 */
import { getSupabaseClient, isSupabaseConfigured } from './supabaseQuestionBankService';

export interface SubjectQuestionCount {
  subjectCode: string;
  questionCount: number;
  /** Questions whose bank is explicitly tagged with this year + department. */
  attributedCount: number;
  /** Questions from untagged banks attributed unambiguously by subject code. */
  inheritedCount: number;
  bankCount: number;
}

export interface QuestionCountResult {
  counts: Record<string, number>;
  detail: Record<string, SubjectQuestionCount>;
  /** Null means success. Never coerced to zero. */
  error: string | null;
  databaseConfigured: boolean;
}

const emptyResult = (databaseConfigured: boolean): QuestionCountResult => ({
  counts: {},
  detail: {},
  error: null,
  databaseConfigured
});

/**
 * Counts questions for a set of subject codes within one
 * (academic year label, department code) scope.
 */
export async function countQuestionsForSubjects(params: {
  subjectCodes: string[];
  academicYear?: string | null;
  departmentCode?: string | null;
}): Promise<QuestionCountResult> {
  const { subjectCodes, academicYear, departmentCode } = params;

  if (!isSupabaseConfigured()) return emptyResult(false);
  if (!subjectCodes || subjectCodes.length === 0) return emptyResult(true);

  const client = getSupabaseClient();
  const codes = Array.from(new Set(subjectCodes.filter(Boolean)));

  // Which of these subject codes are unambiguous for this year+department?
  // Used to safely attribute untagged banks without cross-contaminating.
  let unambiguousCodes = new Set<string>();
  try {
    let sq = client.from('subjects').select('subject_code, department_id, academic_year_id');
    if (academicYear) {
      const { data: years } = await client.from('academic_years').select('id').eq('year_label', academicYear).maybeSingle();
      if (years?.id) sq = sq.eq('academic_year_id', years.id);
    }
    if (departmentCode) {
      const { data: depts } = await client.from('departments').select('id').eq('department_code', departmentCode).maybeSingle();
      if (depts?.id) sq = sq.eq('department_id', depts.id);
    }
    const { data: subjects } = await sq;
    const seen = new Map<string, number>();
    (subjects || []).forEach((s: any) => seen.set(s.subject_code, (seen.get(s.subject_code) || 0) + 1));
    unambiguousCodes = new Set(
      (subjects || [])
        .filter((s: any) => (seen.get(s.subject_code) || 0) === 1)
        .map((s: any) => s.subject_code)
    );
  } catch (err: any) {
    // Could not establish unambiguity — be conservative and do NOT inherit
    // untagged banks rather than risk counting the wrong year's questions.
    console.warn('[questionCount] subject resolution failed:', err?.message);
    unambiguousCodes = new Set();
  }

  // ---- Pass 1: banks explicitly tagged with this year + department ----
  const attributed: Record<string, number> = {};
  const bankCounts: Record<string, number> = {};

  try {
    let q = client
      .from('questions')
      .select('id, subject_code, question_banks!inner(id, academic_year, department)', { count: 'exact' })
      .in('subject_code', codes);

    if (academicYear) q = q.eq('question_banks.academic_year', academicYear);
    if (departmentCode) q = q.eq('question_banks.department', departmentCode);

    const { data, error } = await q;
    if (error) throw error;

    (data || []).forEach((row: any) => {
      const code = row.subject_code;
      if (!code) return;
      attributed[code] = (attributed[code] || 0) + 1;
      const bankId = row.question_banks?.id;
      if (bankId) {
        bankCounts[`${code}|${bankId}`] = (bankCounts[`${code}|${bankId}`] || 0) + 1;
      }
    });
  } catch (err: any) {
    return {
      counts: {},
      detail: {},
      error: err?.message || 'Failed to count questions.',
      databaseConfigured: true
    };
  }

  // ---- Pass 2: untagged banks, only for unambiguous subject codes ----
  const inherited: Record<string, number> = {};
  const inheritable = codes.filter(c => unambiguousCodes.has(c));
  if (inheritable.length > 0) {
    try {
      let q = client
        .from('questions')
        .select('id, subject_code, question_banks!inner(id, academic_year)', { count: 'exact' })
        .in('subject_code', inheritable)
        .is('question_banks.academic_year', null);

      const { data, error } = await q;
      if (error) throw error;

      (data || []).forEach((row: any) => {
        const code = row.subject_code;
        if (!code) return;
        inherited[code] = (inherited[code] || 0) + 1;
        const bankId = row.question_banks?.id;
        if (bankId) {
          bankCounts[`${code}|${bankId}`] = (bankCounts[`${code}|${bankId}`] || 0) + 1;
        }
      });
    } catch (err: any) {
      // Non-fatal: pass-1 counts are still valid, we just under-count untagged banks.
      console.warn('[questionCount] untagged-bank pass failed:', err?.message);
    }
  }

  const counts: Record<string, number> = {};
  const detail: Record<string, SubjectQuestionCount> = {};
  codes.forEach((code) => {
    const a = attributed[code] || 0;
    const i = inherited[code] || 0;
    counts[code] = a + i;
    const bankCount = Object.keys(bankCounts)
      .filter(k => k.startsWith(`${code}|`))
      .length;
    detail[code] = {
      subjectCode: code,
      questionCount: a + i,
      attributedCount: a,
      inheritedCount: i,
      bankCount
    };
  });

  return { counts, detail, error: null, databaseConfigured: true };
}
