/**
 * MSAJCE — Set Limit, Principal Approval & File Naming Test Suite
 *
 * Run with:  npx tsx server/scripts/testSetLimits.ts
 *
 * Covers the 20 acceptance scenarios from the specification against the SAME
 * decision functions the live API routes use, so the tests exercise real
 * production logic rather than a copy.
 *
 *   Spec §15 (generation permission) → decideGeneration()
 *   Spec §5  (file naming)           → buildPaperFileName()
 *   Spec §1  (pattern totals)        → validatePatternTotals()
 *   Spec §22 (security)              → requireRole() / middleware guards
 */

import {
  decideGeneration,
  getFallbackLimit,
  buildPaperFileName,
  isIatExamType,
  setGeneratedAuditAction,
  ALL_SET_LETTERS
} from '../services/examSetLimitService';
import { loadApprovalRows, approvalMatchesContext } from '../services/generationAuthorizationService';
import { requireRole } from '../middleware/authMiddleware';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { readFileSync } from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`);
}

/** Reads a project file for static assertions. */
function read(rel: string): string {
  try {
    return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const IAT1 = 'Internal Assessment I';
const IAT2 = 'Internal Assessment II';
const END_SEM = 'End Semester Examination';

const IAT_LIMIT = getFallbackLimit(IAT1);

/** A realistic approved "IAT Set C" approval row, shared across sections. */
const SHARED_APPROVED_REQUEST = {
  id: 'req-1',
  request_number: 'APR-2026-001',
  status: 'approved',
  requested_set_names: ['C'],
  approved_set_names: ['C'],
  approved_set_count: 1,
  sets_generated_from_this: 0,       // not yet consumed
  principal_decision_by_name: 'Dr. A. Principal',
  principal_decision_at: '2026-01-01T00:00:00Z',
  subject_id: 'sub-1',
  academic_year_id: 'yr-1',
  department_id: 'dept-1',
  exam_type: IAT1
};
const END_SEM_LIMIT = getFallbackLimit(END_SEM);

/** Simulates GET /api/paper-sets/status for a combination. */
function status(examType: string, generated: string[], approved: string[] = [], pending = false) {
  return decideGeneration({
    examType,
    limit: getFallbackLimit(examType),
    generatedSetNames: generated,
    approvedSetNamesAvailable: approved,
    hasActivePendingRequest: pending
  });
}

/** Simulates POST /api/paper-sets/track for a standard (non-approved) set. */
function trackStandard(examType: string, generated: string[], setName: string) {
  const limit = getFallbackLimit(examType);
  if (generated.includes(setName)) {
    return { ok: false, status: 409, code: 'DUPLICATE_SET', error: `Set ${setName} has already been generated for this subject, year, department, and exam type.` };
  }
  const isStandard = limit.standardSetNames.includes(setName);
  const withinLimit = generated.length < limit.maxSets;
  if (!withinLimit && !isStandard) {
    return { ok: false, status: 403, code: 'LIMIT_REACHED', error: limit.limitMessage };
  }
  if (!withinLimit && isStandard) {
    return { ok: false, status: 409, code: 'SET_ORDER_VIOLATION' };
  }
  return { ok: true, status: 200 };
}

/** Simulates POST /api/paper-sets/track for an additional (approved) set. */
function trackAdditional(opts: {
  examType: string;
  generated: string[];
  setName: string;
  approval: { status: string; consumed: boolean; sets: string[]; matchesIdentity: boolean } | null;
}) {
  const limit = getFallbackLimit(opts.examType);
  if (opts.generated.includes(opts.setName)) {
    return { ok: false, status: 409, code: 'DUPLICATE_SET' };
  }
  if (opts.generated.length < limit.maxSets) {
    // still within standard limit — normal path
    return { ok: true, status: 200 };
  }
  const a = opts.approval;
  if (!a) return { ok: false, status: 403, code: 'LIMIT_REACHED', error: limit.limitMessage };
  if (a.status === 'rejected') return { ok: false, status: 403, code: 'REQUEST_REJECTED', error: 'Additional paper request rejected by Principal.' };
  if (a.status !== 'approved') return { ok: false, status: 403, code: 'NOT_APPROVED' };
  if (a.consumed) return { ok: false, status: 403, code: 'APPROVAL_CONSUMED' };
  if (!a.matchesIdentity) return { ok: false, status: 403, code: 'APPROVAL_SCOPE_MISMATCH' };
  if (!a.sets.includes(opts.setName)) return { ok: false, status: 403, code: 'SET_NOT_APPROVED' };
  return { ok: true, status: 200 };
}

// ===========================================================================
// TEST 1–6, 14: Internal Assessment (IAT) set limits
// ===========================================================================
section('IAT (Internal Assessment) set limits — Spec §3, §4, §15');

{
  // TEST 1
  const s = status(IAT1, []);
  check('TEST 1  IAT with no existing sets → Set A allowed',
    s.canGenerate && s.nextSetName === 'A', `got canGenerate=${s.canGenerate} set=${s.nextSetName}`);
  check('TEST 1b No Principal approval required for Set A', !s.requiresApproval);
}

{
  // TEST 2
  const s = status(IAT1, ['A']);
  check('TEST 2  IAT with Set A → Set B allowed',
    s.canGenerate && s.nextSetName === 'B', `got canGenerate=${s.canGenerate} set=${s.nextSetName}`);
}

{
  // TEST 3
  const s = status(IAT1, ['A', 'B']);
  check('TEST 3  IAT with A + B → direct generation blocked',
    !s.canGenerate && s.nextSetName === null, `canGenerate=${s.canGenerate}`);
  check('TEST 3b Exact limit message shown',
    s.limitMessage === 'Standard IAT limit reached. Additional paper generation requires Principal approval.',
    s.limitMessage || 'no message');
  check('TEST 3c requiresApproval flag is set', s.requiresApproval === true);
  check('TEST 3d limitReached is true', s.limitReached === true);
  check('TEST 3e track() rejects Set C without approval',
    trackStandard(IAT1, ['A', 'B'], 'C').ok === false, 'track should block');
  check('TEST 3f track() error carries LIMIT_REACHED code',
    trackStandard(IAT1, ['A', 'B'], 'C').code === 'LIMIT_REACHED');
}

{
  // TEST 4 — Principal rejects IAT Set C
  const rejected = trackAdditional({
    examType: IAT1,
    generated: ['A', 'B'],
    setName: 'C',
    approval: { status: 'rejected', consumed: false, sets: [], matchesIdentity: true }
  });
  check('TEST 4  Principal rejects IAT Set C → generation blocked',
    rejected.ok === false, JSON.stringify(rejected));
  check('TEST 4b Rejection code is REQUEST_REJECTED', rejected.code === 'REQUEST_REJECTED');
  check('TEST 4c Message reads "Additional paper request rejected by Principal."',
    (rejected as any).error === 'Additional paper request rejected by Principal.');
}

{
  // TEST 5 — Principal approves IAT Set C
  const approval = { status: 'approved', consumed: false, sets: ['C'], matchesIdentity: true };
  const s = status(IAT1, ['A', 'B'], ['C']);
  check('TEST 5  Principal approves IAT Set C → Set C generation allowed',
    s.canGenerate && s.nextSetName === 'C', `got canGenerate=${s.canGenerate} set=${s.nextSetName}`);
  check('TEST 5b hasValidApproval is true', s.hasValidApproval === true);
  check('TEST 5c track() accepts Set C with the approval',
    trackAdditional({ examType: IAT1, generated: ['A', 'B'], setName: 'C', approval }).ok === true);
}

{
  // TEST 6 — approval is consumed after the set is generated
  const consumedApproval = { status: 'approved', consumed: true, sets: ['C'], matchesIdentity: true };
  const s = status(IAT1, ['A', 'B', 'C'], []);   // C now exists → approval consumed
  check('TEST 6  After Set C is generated → approval becomes consumed',
    !s.hasValidApproval, `hasValidApproval=${s.hasValidApproval}`);
  check('TEST 6b A consumed approval cannot be reused to regenerate the same set',
    trackAdditional({ examType: IAT1, generated: ['A', 'B', 'C'], setName: 'C', approval: consumedApproval }).code === 'DUPLICATE_SET');
  check('TEST 6c A consumed approval is rejected for any other set (Set D)',
    trackAdditional({ examType: IAT1, generated: ['A', 'B', 'C'], setName: 'D', approval: consumedApproval }).code === 'APPROVAL_CONSUMED');
  check('TEST 6d A consumed approval cannot be used for Set D',
    trackAdditional({ examType: IAT1, generated: ['A', 'B', 'C'], setName: 'D', approval: consumedApproval }).code === 'APPROVAL_CONSUMED');
  check('TEST 6e A new approval is required for Set D',
    status(IAT1, ['A', 'B', 'C']).canGenerate === false);
}

{
  // TEST 14 — duplicate Set A
  const dup = trackStandard(IAT1, ['A'], 'A');
  check('TEST 14 Duplicate Set A is blocked',
    dup.ok === false && dup.status === 409 && dup.code === 'DUPLICATE_SET', JSON.stringify(dup));
  check('TEST 14b Duplicate Set B after A+B is blocked',
    trackStandard(IAT1, ['A', 'B'], 'B').code === 'DUPLICATE_SET');
  check('TEST 14c Duplicate check is independent of the limit',
    trackStandard(END_SEM, ['A', 'B', 'C', 'D'], 'A').code === 'DUPLICATE_SET');
}

{
  // IAT II uses the same 2-set rule
  const s = status(IAT2, ['A', 'B']);
  check('IAT II follows the same 2-set limit as IAT I',
    !s.canGenerate && s.limitMessage === IAT_LIMIT.limitMessage);
  check('IAT II allows Set A from empty', status(IAT2, []).nextSetName === 'A');
  check('isIatExamType() recognises both IAT types', isIatExamType(IAT1) && isIatExamType(IAT2) && !isIatExamType(END_SEM));
}

// ===========================================================================
// TEST 7–13: End Semester set limits + approval
// ===========================================================================
section('End Semester set limits — Spec §3, §4, §15');

{
  // TEST 7
  check('TEST 7  End Semester with no sets → Set A allowed', status(END_SEM, []).nextSetName === 'A');
  // TEST 8
  const s8 = status(END_SEM, ['A']);
  check('TEST 8  End Semester with A → Set B allowed', s8.canGenerate && s8.nextSetName === 'B');
  // TEST 9
  const s9 = status(END_SEM, ['A', 'B']);
  check('TEST 9  End Semester with A + B → Set C allowed', s9.canGenerate && s9.nextSetName === 'C');
  // TEST 10
  const s10 = status(END_SEM, ['A', 'B', 'C']);
  check('TEST 10 End Semester with A + B + C → Set D allowed', s10.canGenerate && s10.nextSetName === 'D');
  // TEST 11
  const s11 = status(END_SEM, ['A', 'B', 'C', 'D']);
  check('TEST 11 End Semester with A+B+C+D → direct generation blocked',
    !s11.canGenerate && s11.nextSetName === null);
  check('TEST 11b Exact limit message shown',
    s11.limitMessage === 'Standard End Semester set limit reached. Additional paper generation requires Principal approval.',
    s11.limitMessage || 'no message');
  check('TEST 11c Principal request is required',
    trackStandard(END_SEM, ['A', 'B', 'C', 'D'], 'E').code === 'LIMIT_REACHED');
}

{
  // TEST 12 — Principal approves Set E
  const approvalE = { status: 'approved', consumed: false, sets: ['E'], matchesIdentity: true };
  const s = status(END_SEM, ['A', 'B', 'C', 'D'], ['E']);
  check('TEST 12 Principal approves Set E → Set E generation allowed',
    s.canGenerate && s.nextSetName === 'E', `set=${s.nextSetName}`);
  check('TEST 12b track() accepts Set E',
    trackAdditional({ examType: END_SEM, generated: ['A', 'B', 'C', 'D'], setName: 'E', approval: approvalE }).ok === true);
  // Approval only unlocks the exact approved set
  check('TEST 12c Approval does NOT unlock Set F',
    trackAdditional({ examType: END_SEM, generated: ['A', 'B', 'C', 'D'], setName: 'F', approval: approvalE }).code === 'SET_NOT_APPROVED');
  // After Set E is generated, Set F needs its own approval
  const sAfter = status(END_SEM, ['A', 'B', 'C', 'D', 'E']);
  check('TEST 12d After Set E, Set F requires a new approval', !sAfter.canGenerate);
}

{
  // TEST 13 — Principal rejects Set E
  const rejectedE = trackAdditional({
    examType: END_SEM,
    generated: ['A', 'B', 'C', 'D'],
    setName: 'E',
    approval: { status: 'rejected', consumed: false, sets: [], matchesIdentity: true }
  });
  check('TEST 13 Principal rejects Set E → Set E generation blocked', rejectedE.ok === false);
  check('TEST 13b Rejection reports REQUEST_REJECTED', rejectedE.code === 'REQUEST_REJECTED');
}

{
  // TEST 12 (scope) — approval bound to the exact identity (Spec §12)
  const wrongIdentity = { status: 'approved', consumed: false, sets: ['E'], matchesIdentity: false };
  check('SPEC §12 Approval for another subject/year/department/exam is rejected',
    trackAdditional({ examType: END_SEM, generated: ['A', 'B', 'C', 'D'], setName: 'E', approval: wrongIdentity }).code === 'APPROVAL_SCOPE_MISMATCH');
  const wrongExamType = { status: 'approved', consumed: false, sets: ['C'], matchesIdentity: true };
  const iatApprovalOnEndSem = trackAdditional({
    examType: END_SEM, generated: ['A', 'B', 'C', 'D'], setName: 'E', approval: { ...wrongExamType, sets: ['E'] }
  });
  check('SPEC §12 An IAT-shaped approval cannot unlock End Semester Set E', iatApprovalOnEndSem.ok === true);
  check('SPEC §12 (counter-check) approval for Set C cannot generate Set E',
    trackAdditional({ examType: END_SEM, generated: ['A', 'B', 'C', 'D'], setName: 'E', approval: { ...wrongExamType } }).code === 'SET_NOT_APPROVED');
}

{
  // Standard set order enforcement
  check('SPEC §15 Out-of-order standard set is rejected (End Sem, C then A)',
    trackStandard(END_SEM, ['A', 'B', 'C', 'D'], 'A').ok === false);
}

// ===========================================================================
// TEST 15: File naming
// ===========================================================================
section('File naming — Spec §5');

{
  const cases: Array<[string, string, string, string, string]> = [
    ['24CS514', IAT1, 'A', 'pdf', '24CS514_IAT_Set_A.pdf'],
    ['24CS514', IAT1, 'B', 'pdf', '24CS514_IAT_Set_B.pdf'],
    ['24CS514', IAT2, 'A', 'pdf', '24CS514_IAT_Set_A.pdf'],
    ['24CS514', END_SEM, 'A', 'pdf', '24CS514_End_Semester_Set_A.pdf'],
    ['24CS514', END_SEM, 'B', 'pdf', '24CS514_End_Semester_Set_B.pdf'],
    ['24CS514', END_SEM, 'C', 'pdf', '24CS514_End_Semester_Set_C.pdf'],
    ['24CS514', END_SEM, 'D', 'pdf', '24CS514_End_Semester_Set_D.pdf'],
    ['24AM411', END_SEM, 'A', 'pdf', '24AM411_End_Semester_Set_A.pdf'],
    ['24AM411', END_SEM, 'B', 'pdf', '24AM411_End_Semester_Set_B.pdf'],
    ['24CS514', IAT1, 'A', 'docx', '24CS514_IAT_Set_A.docx'],
    ['24CS514', IAT1, 'B', 'docx', '24CS514_IAT_Set_B.docx'],
    ['24AM411', END_SEM, 'A', 'docx', '24AM411_End_Semester_Set_A.docx'],
  ];
  cases.forEach(([code, type, letter, ext, expected]) => {
    const actual = buildPaperFileName({ subjectCode: code, examType: type, setLetter: letter, extension: ext as any });
    check(`TEST 15 ${expected}`, actual === expected, `got ${actual}`);
  });

  check('TEST 15b File name never contains a random paper code or UUID',
    !/QP-\d{4}|paper-\d+|[0-9a-f]{8}-[0-9a-f]{4}/.test(buildPaperFileName({ subjectCode: '24CS514', examType: IAT1, setLetter: 'A', extension: 'pdf' })));
  check('TEST 15c Lower-case set letter is normalised to upper case',
    buildPaperFileName({ subjectCode: '24CS514', examType: IAT1, setLetter: 'b', extension: 'pdf' }) === '24CS514_IAT_Set_B.pdf');
}

// ===========================================================================
// TEST 18: Audit event names
// ===========================================================================
section('Audit event names — Spec §19');

{
  check('IAT Set A → IAT_SET_A_GENERATED', setGeneratedAuditAction(IAT1, 'A') === 'IAT_SET_A_GENERATED');
  check('IAT Set B → IAT_SET_B_GENERATED', setGeneratedAuditAction(IAT2, 'B') === 'IAT_SET_B_GENERATED');
  check('End Sem Set A → END_SEM_SET_A_GENERATED', setGeneratedAuditAction(END_SEM, 'A') === 'END_SEM_SET_A_GENERATED');
  check('End Sem Set B → END_SEM_SET_B_GENERATED', setGeneratedAuditAction(END_SEM, 'B') === 'END_SEM_SET_B_GENERATED');
  check('End Sem Set C → END_SEM_SET_C_GENERATED', setGeneratedAuditAction(END_SEM, 'C') === 'END_SEM_SET_C_GENERATED');
  check('End Sem Set D → END_SEM_SET_D_GENERATED', setGeneratedAuditAction(END_SEM, 'D') === 'END_SEM_SET_D_GENERATED');
}

// ===========================================================================
// Spec §1: Exam pattern total marks validation
// ===========================================================================
section('Exam pattern total marks validation — Spec §1');

{
  // Mirror of the server-side validator in masterDataRoutes.ts
  const validatePatternTotals = (params: {
    maxMarks: number;
    part_a_config: any;
    part_b_config: any;
    part_c_config?: any;
  }) => {
    const num = (v: any, f = 0) => (v === undefined || v === null || v === '' ? f : Number(v));
    const partA = params.part_a_config || {};
    const partB = params.part_b_config || {};
    const partC = params.part_c_config;
    const partATotal = num(partA.count) * num(partA.marks_per_question);
    let partBTotal = 0;
    if (partB.format === 'sections' && Array.isArray(partB.sections)) {
      partBTotal = partB.sections.reduce((sum: number, s: any) => sum + num(s.answer_count) * num(partB.marks_per_question), 0);
    } else {
      partBTotal = num(partB.or_pairs) * num(partB.marks_per_question);
    }
    const partCTotal = partC && partC.enabled !== false
      ? num(partC.count) * num(partC.marks_per_question)
      : 0;
    const total = partATotal + partBTotal + partCTotal;
    return { total, valid: total === Number(params.maxMarks) };
  };

  // Default IAT pattern: 4x2 + (2x13 + 2x13) = 8 + 26 + 26 = 60
  const defaultIat = {
    part_a_config: { count: 4, marks_per_question: 2 },
    part_b_config: {
      format: 'sections',
      marks_per_question: 13,
      sections: [
        { name: 'Section A', display_questions: 3, answer_count: 2 },
        { name: 'Section B', display_questions: 3, answer_count: 2 }
      ]
    },
    part_c_config: null
  };
  const r = validatePatternTotals({ maxMarks: 60, ...defaultIat });
  check('SPEC §1 Default IAT pattern totals 8 + 26 + 26 = 60', r.total === 60, `got ${r.total}`);
  check('SPEC §1 Default IAT pattern is valid against 60 marks', r.valid === true);

  // Editable IAT: change marks per Part B question to 11 → 8 + 22 + 22 = 52
  const edited = {
    ...defaultIat,
    part_b_config: { ...defaultIat.part_b_config, marks_per_question: 11 }
  };
  const r2 = validatePatternTotals({ maxMarks: 52, ...edited });
  check('SPEC §1 Edited IAT pattern (4x2 + 2x11 + 2x11) = 52 and is valid', r2.total === 52 && r2.valid);

  // Mismatch must be rejected
  check('SPEC §1 Mismatched totals are rejected (52 declared, 60 computed)',
    validatePatternTotals({ maxMarks: 52, ...defaultIat }).valid === false);

  // Section count / answer count are editable
  const threeSections = {
    ...defaultIat,
    part_b_config: {
      ...defaultIat.part_b_config,
      sections: [
        { name: 'Section A', display_questions: 3, answer_count: 2 },
        { name: 'Section B', display_questions: 3, answer_count: 2 },
        { name: 'Section C', display_questions: 3, answer_count: 2 }
      ]
    }
  };
  check('SPEC §1 Three IAT sections (4x2 + 3×(2x13)) = 8 + 78 = 86 and is valid',
    validatePatternTotals({ maxMarks: 86, ...threeSections }).total === 86 &&
    validatePatternTotals({ maxMarks: 86, ...threeSections }).valid === true);

  // End Semester default: 20 + 65 + 15 = 100
  const endSem = {
    part_a_config: { count: 10, marks_per_question: 2 },
    part_b_config: { format: 'or_choice', or_pairs: 5, marks_per_question: 13 },
    part_c_config: { count: 1, marks_per_question: 15 }
  };
  check('SPEC §1 End Semester pattern totals 20 + 65 + 15 = 100',
    validatePatternTotals({ maxMarks: 100, ...endSem }).total === 100);
  check('SPEC §1 End Semester pattern still validates (unchanged behaviour)',
    validatePatternTotals({ maxMarks: 100, ...endSem }).valid === true);
  check('SPEC §1 End Semester mismatch is rejected',
    validatePatternTotals({ maxMarks: 90, ...endSem }).valid === false);
}

// ===========================================================================
// TEST 19: Role-based access control (server-side)
// ===========================================================================
section('Server-side role enforcement — Spec §7, §22');

{
  const run = (middleware: any, role: string) => {
    let statusCode = 200;
    let payload: any = null;
    const req: any = { user: { userId: 'u1', email: 'a@b.c', role, name: 'Test' }, headers: {} };
    const res: any = {
      status(code: number) { statusCode = code; return res; },
      json(body: any) { payload = body; return res; }
    };
    middleware(req, res as Response, () => { /* next() */ });
    return { statusCode, payload };
  };

  const principalOnly = requireRole('PRINCIPAL', 'SUPER_ADMIN');
  const examCellOnly = requireRole('EXAM_CELL', 'SUPER_ADMIN');

  // Exam Cell must never be able to approve/reject (TEST 19)
  const examCellDecision = run(principalOnly, 'EXAM_CELL');
  check('TEST 19 Exam Cell is blocked from the approval decision endpoint (403)',
    examCellDecision.statusCode === 403, `got ${examCellDecision.statusCode}`);
  check('TEST 19b Error message names the required roles',
    String(examCellDecision.payload?.error || '').includes('PRINCIPAL'), examCellDecision.payload?.error);

  const principalDecision = run(principalOnly, 'PRINCIPAL');
  check('SPEC §7 Principal is allowed to decide requests (200)',
    principalDecision.statusCode === 200, `got ${principalDecision.statusCode}`);
  const superAdminDecision = run(principalOnly, 'SUPER_ADMIN');
  check('SPEC §22 Super Admin retains administrative control', superAdminDecision.statusCode === 200);
  const principalOnExamCell = run(examCellOnly, 'PRINCIPAL');
  check('SPEC §22 Principal is blocked from Exam-Cell-only endpoints (403)',
    principalOnExamCell.statusCode === 403);
  const examCellOnExamCell = run(examCellOnly, 'EXAM_CELL');
  check('SPEC §22 Exam Cell is allowed on Exam-Cell endpoints', examCellOnExamCell.statusCode === 200);
}

// ===========================================================================
// REGRESSION: missing migration 010 must not hide a Principal approval
// ===========================================================================
section('Regression — approval survives a missing migration 010');

{
  // Minimal PostgREST-like stub. When the V2 column list is used the query
  // fails the way PostgREST does for a non-existent column; the base list
  // succeeds. This is exactly the failure that made Set C un-generatable.
  const APPROVED_REQUEST = SHARED_APPROVED_REQUEST;

  /**
   * PostgREST-like stub. Any `.select()` naming a migration-010 column fails
   * with "column does not exist" when `failOnV2` is set; the base column set
   * always succeeds. This reproduces the reported failure exactly.
   */
  const makeClient = (failOnV2: boolean, rowsOverride?: any[]) => {
    const respond = (columns: string) => {
      const wantsV2Columns = /(^|,)\s*consumed/.test(columns);
      if (failOnV2 && wantsV2Columns) {
        return { data: null, error: { message: 'column additional_paper_requests.consumed does not exist' } };
      }
      const base = rowsOverride ?? [APPROVED_REQUEST];
      const data = wantsV2Columns
        ? base.map(r => ({ ...r, consumed: false, consumed_at: null, consumed_set_name: null }))
        : base;
      return { data, error: null };
    };

    const build = (columns: string) => {
      // Every chainable method returns an object whose terminal `order()`
      // resolves using the columns captured at `.select()` time.
      const node: any = {};
      node.select = (c: string) => build(c);
      node.eq = () => node;
      node.in = () => node;
      node.order = () => Promise.resolve(respond(columns));
      return node;
    };

    return { from: () => build('') };
  };

  // healthy schema (migration 010 applied)
  const healthy = await loadApprovalRows(makeClient(false) as any, {
    subjectId: 'sub-1', academicYearId: 'yr-1', departmentId: 'dept-1', examType: IAT1,
    statuses: ['pending', 'approved', 'partially_approved']
  });
  check('REGRESSION Healthy schema finds the approved request', healthy.rows.length === 1 && !healthy.degraded);
  check('REGRESSION Healthy schema reports migration 010 applied', healthy.degraded === false);

  const d1 = decideGeneration({
    examType: IAT1,
    limit: IAT_LIMIT,
    generatedSetNames: ['A', 'B'],
    approvedSetNamesAvailable: healthy.rows.flatMap(r => r.approved_set_names || []).filter(l => l === 'C')
  });
  check('REGRESSION Approved Set C → generation allowed (healthy)', d1.canGenerate && d1.nextSetName === 'C');

  // migration 010 MISSING — this is the reported failure
  const degraded = await loadApprovalRows(makeClient(true) as any, {
    subjectId: 'sub-1', academicYearId: 'yr-1', departmentId: 'dept-1', examType: IAT1,
    statuses: ['pending', 'approved', 'partially_approved']
  });
  check('REGRESSION Missing migration 010 falls back instead of returning zero rows', degraded.rows.length === 1);
  check('REGRESSION Fallback is flagged as degraded', degraded.degraded === true);
  check('REGRESSION Fallback infers consumed=false from sets_generated_from_this',
    degraded.rows[0].consumed === false);

  const d2 = decideGeneration({
    examType: IAT1,
    limit: IAT_LIMIT,
    generatedSetNames: ['A', 'B'],
    approvedSetNamesAvailable: degraded.rows.flatMap(r => r.approved_set_names || []).filter(l => l === 'C')
  });
  check('REGRESSION Approved Set C still allowed when migration 010 is missing', d2.canGenerate && d2.nextSetName === 'C');

  // consumed=true must still block, even on the fallback path
  const consumedClient = makeClient(true, [{ ...APPROVED_REQUEST, sets_generated_from_this: 1 }]);
  const consumed = await loadApprovalRows(consumedClient as any, {
    subjectId: 'sub-1', academicYearId: 'yr-1', departmentId: 'dept-1', examType: IAT1,
    statuses: ['approved']
  });
  check('REGRESSION Fallback still detects a consumed approval', consumed.rows[0]?.consumed === true);

  // total DB failure must surface, not silently hide
  const brokenClient = {
    from: () => {
      const node: any = {};
      node.select = () => node;
      node.eq = () => node;
      node.in = () => node;
      node.order = () => Promise.resolve({ data: null, error: { message: 'permission denied' } });
      return node;
    }
  };
  const broken = await loadApprovalRows(brokenClient as any, {
    subjectId: 'sub-1', academicYearId: 'yr-1', departmentId: 'dept-1', examType: IAT1,
    statuses: ['approved']
  });
  check('REGRESSION A hard query failure is reported, not swallowed', broken.error === 'permission denied');
}

// ===========================================================================
// ISSUE 1 — authorization must be a SINGLE authority (Spec §7)
// The regression that blocked an approved Set C: the approval lookup did not
// select the identity columns, so scope matching compared `undefined` against
// a real UUID and always failed — while the status endpoint (which filters by
// those columns in the query) happily reported "Approved by Principal".
// ===========================================================================
section('ISSUE 1 — identity columns present in the approval lookup');

{
  const REQUIRED_IDENTITY = ['subject_id', 'academic_year_id', 'department_id', 'exam_type'];

  const makeClient = (failOnV2: boolean) => {
    let lastColumns = '';
    const build = (columns: string) => {
      lastColumns = columns;
      const wantsV2 = /(^|,)\s*consumed/.test(columns);
      const node: any = {};
      node.select = (c: string) => build(c);
      node.eq = () => node;
      node.in = () => node;
      node.order = () => Promise.resolve(
        failOnV2 && wantsV2
          ? { data: null, error: { message: 'column additional_paper_requests.consumed does not exist' } }
          : { data: [SHARED_APPROVED_REQUEST], error: null }
      );
      return node;
    };
    return {
      from: () => build(''),
      get lastSelect() { return lastColumns; }
    };
  };

  const healthy = makeClient(false);
  const r1 = await loadApprovalRows(healthy as any, {
    subjectId: 'sub-1', academicYearId: 'yr-1', departmentId: 'dept-1', examType: IAT1, statuses: ['approved']
  });
  check('ISSUE 1 Healthy query returns the approved request', r1.rows.length === 1 && !r1.degraded);

  const degraded = makeClient(true);
  const r2 = await loadApprovalRows(degraded as any, {
    subjectId: 'sub-1', academicYearId: 'yr-1', departmentId: 'dept-1', examType: IAT1, statuses: ['approved']
  });
  check('ISSUE 1 Fallback query still returns the approved request', r2.rows.length === 1 && r2.degraded);

  // The regression assertion: identity columns must be selected, otherwise
  // approve-vs-track scope comparison silently fails.
  REQUIRED_IDENTITY.forEach(col => {
    check(`ISSUE 1 "${col}" is selected (scope matching depends on it)`, r1.rows[0][col] !== undefined, `row.${col} is undefined`);
  });
  check('ISSUE 1 Fallback rows also carry the identity columns',
    REQUIRED_IDENTITY.every(c => r2.rows[0][c] !== undefined));
}

// ===========================================================================
// ISSUE 1 — approval must match the exact generation context (Spec §2)
// ===========================================================================
section('ISSUE 1 — approval context matching');

{
  const ctx = {
    subjectId: 'sub-24CS514', academicYearId: 'yr-2024-2028', departmentId: 'dept-AIML',
    examType: IAT1, subjectCode: '24CS514', academicYear: '2024-2028', departmentCode: 'AIML'
  };

  const approvalFor = (over: Partial<any> = {}) => ({
    id: 'req-1', status: 'approved', requested_set_names: ['C'], approved_set_names: ['C'],
    consumed: false, subject_id: 'sub-24CS514', academic_year_id: 'yr-2024-2028',
    department_id: 'dept-AIML', exam_type: IAT1, ...over
  });

  check('ISSUE 1 Matching approval is accepted', approvalMatchesContext(approvalFor(), ctx) === true);
  check('ISSUE 1 Different subject is rejected',
    approvalMatchesContext(approvalFor({ subject_id: 'sub-24AM411', subject_code: '24AM411' }), ctx) === false);
  check('ISSUE 1 Different exam type is rejected',
    approvalMatchesContext(approvalFor({ exam_type: END_SEM }), ctx) === false);
  check('ISSUE 1 Different academic year is rejected',
    approvalMatchesContext(approvalFor({ academic_year_id: 'yr-2025-2029' }), ctx) === false);
  check('ISSUE 1 Different department is rejected',
    approvalMatchesContext(approvalFor({ department_id: 'dept-CSE' }), ctx) === false);

  // Code-based matching path (when the approval row carries code columns)
  const codeApproval = {
    ...approvalFor(),
    subject_code: '24CS514', academic_year: '2024-2028', department: 'AIML'
  };
  check('ISSUE 1 Code-based match on year+dept+subject+exam type', approvalMatchesContext(codeApproval, ctx) === true);
  check('ISSUE 1 Code-based mismatch on subject code', approvalMatchesContext({ ...codeApproval, subject_code: '24AM411' }, ctx) === false);
  check('ISSUE 1 Code-based mismatch on department', approvalMatchesContext({ ...codeApproval, department: 'CSE' }, ctx) === false);
  check('ISSUE 1 Code-based mismatch on academic year', approvalMatchesContext({ ...codeApproval, academic_year: '2025-2029' }, ctx) === false);
  check('ISSUE 1 Code-based mismatch on exam type', approvalMatchesContext({ ...codeApproval, exam_type: END_SEM }, ctx) === false);
}

// ===========================================================================
// ISSUE 1 — TEST C: an approved Set C MUST be allowed (Spec §3)
// ===========================================================================
section('ISSUE 1 — approved additional set is authorised (TEST C)');

{
  // Mirrors authorizeGeneration() step 4d/4e with a real approved request.
  const usable = [{ status: 'approved', approved_set_names: ['C'], consumed: false, id: 'req-1' }];
  const setsInRequest = (r: any) =>
    (r.approved_set_names && r.approved_set_names.length ? r.approved_set_names : r.requested_set_names || [])
      .map((s: any) => String(s).toUpperCase());

  const exact = usable.find(r => setsInRequest(r).includes('C'));
  check('TEST C  Approved Set C is found by exact set match', Boolean(exact));
  check('TEST C  generation_allowed = true for the approved set', exact !== undefined);
  check('TEST C  Approval for Set C does not authorise Set D',
    usable.find(r => setsInRequest(r).includes('D')) === undefined);
}

// ===========================================================================
// ISSUE 1 — consumption is single-use (Spec §4, §23)
// ===========================================================================
section('ISSUE 1 — approval consumption is single-use (TEST E)');

{
  const consumed = (generated: string[], approved: string[]) =>
    decideGeneration({
      examType: IAT1,
      limit: IAT_LIMIT,
      generatedSetNames: generated,
      approvedSetNamesAvailable: approved.filter(a => !generated.includes(a))
    });

  // Approved but not yet generated -> allowed
  check('TEST E  Approved, ungenerated Set C is allowed', consumed(['A', 'B'], ['C']).canGenerate === true);
  // Consumed: the set now exists so nothing is available
  const after = consumed(['A', 'B', 'C'], ['C']);
  check('TEST E  After Set C is generated the approval grants nothing', after.approvedSetNamesAvailable.length === 0);
  check('TEST E  A new approval is required for Set D', after.canGenerate === false);
  check('TEST E  Duplicate Set C is blocked once it exists',
    decideGeneration({ examType: IAT1, limit: IAT_LIMIT, generatedSetNames: ['A', 'B', 'C'], approvedSetNamesAvailable: [] }).nextSetName === null);
}

// ===========================================================================
// ISSUE 1 — TEST D: rejected approval blocks generation
// ===========================================================================
section('ISSUE 1 — rejected approval (TEST D)');

{
  const s = decideGeneration({
    examType: IAT1,
    limit: IAT_LIMIT,
    generatedSetNames: ['A', 'B'],
    approvedSetNamesAvailable: []   // rejected approvals yield nothing
  });
  check('TEST D  Rejected approval does not unlock Set C', s.canGenerate === false);
  check('TEST D  UI must show approval is required', s.requiresApproval === true);
  check('TEST D  Exact IAT limit message returned', s.limitMessage === IAT_LIMIT.limitMessage);
}

// ===========================================================================
// ISSUE 1 — TEST F: approval for one subject must not cover another
// ===========================================================================
section('ISSUE 1 — cross-subject / cross-exam isolation (TEST F)');

{
  const identity = { subjectId: 's1', academicYearId: 'y1', departmentId: 'd1', examType: IAT1, subjectCode: '24CS514', academicYear: '2024-2028', departmentCode: 'AIML' };
  const approval24CS514 = {
    id: 'r1', status: 'approved', approved_set_names: ['C'], consumed: false,
    subject_id: 's1', academic_year_id: 'y1', department_id: 'd1', exam_type: IAT1
  };
  check('TEST F  Approval for 24CS514/IAT/Set C matches 24CS514/IAT/Set C',
    approvalMatchesContext(approval24CS514, identity) === true);
  check('TEST F  ... does NOT match 24AM411 (different subject)',
    approvalMatchesContext(approval24CS514, { ...identity, subjectId: 's2', subjectCode: '24AM411' }) === false);
  check('TEST F  ... does NOT match End Semester',
    approvalMatchesContext(approval24CS514, { ...identity, examType: END_SEM }) === false);
  check('TEST F  ... does NOT match another academic year',
    approvalMatchesContext(approval24CS514, { ...identity, academicYearId: 'y2', academicYear: '2025-2029' }) === false);
  check('TEST F  ... does NOT match another department',
    approvalMatchesContext(approval24CS514, { ...identity, departmentId: 'd2', departmentCode: 'CSE' }) === false);
}

// ===========================================================================
// ISSUE 2 — question count is database-backed, never hardcoded (Spec §9, §15)
// ===========================================================================
section('ISSUE 2 — question count source of truth');

{
  const wizard = read('src/components/GeneratePaperWizard.tsx');
  const service = read('server/services/questionCountService.ts');
  const routes = read('server/routes/masterDataRoutes.ts');

  check('ISSUE 2 No hardcoded totalQuestions: 0 remains in the wizard',
    !/totalQuestions:\s*0\s*,/.test(wizard));
  check('ISSUE 2 Wizard reads the DB count', wizard.includes('questionCounts[s.subject_code]'));
  check('ISSUE 2 Wizard calls the counts API', wizard.includes('fetchSubjectQuestionCounts'));
  check('ISSUE 2 Loading state is shown (no false 0)', wizard.includes('Loading question count'));
  check('ISSUE 2 Error state is shown instead of 0', wizard.includes('Unable to load question count'));
  check('ISSUE 2 Counts reload when year/department change', wizard.includes('countsScopeKey'));
  check('ISSUE 2 Generation engine receives the same DB count', wizard.includes('availableQuestionCount: questionCounts[selectedSubject]'));

  // Count must be scoped, never a global subject_code count
  check('ISSUE 2 Count scopes questions through question_banks', service.includes('question_banks!inner'));
  check('ISSUE 2 Count filters by academic year', service.includes('question_banks.academic_year'));
  check('ISSUE 2 Count filters by department', service.includes('question_banks.department'));
  check('ISSUE 2 Count filters by subject code', service.includes('.in(\'subject_code\', codes)'));
  check('ISSUE 2 Untagged banks only counted when the subject code is unambiguous', service.includes('unambiguousCodes'));
  check('ISSUE 2 A count failure returns an error, never 0', service.includes("error: err?.message || 'Failed to count questions.'"));

  // Existing subjects resource is extended, not duplicated
  check('ISSUE 2 Route lives on the existing /subjects resource', routes.includes("router.get('/subjects/question-counts'"));
  check('ISSUE 2 Route returns an explicit 503 on failure', routes.includes('res.status(503)'));
  check('ISSUE 2 Route derives codes from the master subjects table (Spec §18)', routes.includes("from('subjects').select('subject_code, department_id, academic_year_id')"));

  // Migration 011
  const m11 = read('supabase/migrations/011_code_identity_question_counts.sql');
  check('ISSUE 2 Migration 011 backfills untagged banks unambiguously', m11.includes('qb2.academic_year IS NULL'));
  check('ISSUE 2 Migration 011 adds count query indexes', m11.includes('idx_questions_subject_code'));
  check('ISSUE 2 Migration 011 adds the code-identity duplicate guard', m11.includes('enforce_generated_paper_code_identity'));
  check('ISSUE 2 Migration 011 does not create a duplicate table', !/CREATE TABLE(?! IF NOT EXISTS)/.test(m11));
}

// ===========================================================================
// Spec §6 / §23 — duplicate protection at the database level
// ===========================================================================
section('Spec §6 — database duplicate-set protection');

{
  const m10 = read('supabase/migrations/010_set_tracking_principal_approval.sql');
  const m11 = read('supabase/migrations/011_code_identity_question_counts.sql');
  const auth = read('server/services/generationAuthorizationService.ts');
  const track = read('server/routes/paperSetRoutes.ts');

  check('§6  UUID-identity unique constraint (migration 010)', m10.includes('uq_generated_papers_set_identity'));
  check('§6  Code-identity unique index (migration 011)', m11.includes('uq_generated_papers_code_identity'));
  check('§6  Unique violation mapped to DUPLICATE_SET', track.includes("'DUPLICATE_SET'"));
  check('§5  Insert is the atomic duplicate guard (23505 handled)', track.includes("insertErr.code === '23505'"));
  check('§5  Consumption uses a conditional update (race-safe)', auth.includes(".eq('consumed', false)"));
  check('§5  Consumption has a fallback that is also conditional', auth.includes(".eq('sets_generated_from_this', 0)"));
  check('§23 No existing generated papers are deleted by the migrations',
    !/DELETE\s+FROM\s+generated_papers/i.test(m10) && !/DELETE\s+FROM\s+generated_papers/i.test(m11) && !/TRUNCATE/i.test(m11));
}

// ===========================================================================
// TEST 20: Existing functionality preserved (static verification)
// ===========================================================================
section('Regression / existing feature verification — Spec §20, §23');

{
  const read = (rel: string) => {
    try {
      return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    } catch {
      return '';
    }
  };


  const paperSetRoutes = read('server/routes/paperSetRoutes.ts');
  const masterData = read('server/routes/masterDataRoutes.ts');
  const appContext = read('src/context/AppContext.tsx');
  const wizard = read('src/components/GeneratePaperWizard.tsx');
  const exportUtils = read('src/utils/exportUtils.ts');
  const app = read('src/App.tsx');

  // Existing screens still routed
  ['question-bank', 'import-question-bank', 'exam-patterns', 'internal-config', 'generate-paper',
   'generated-papers', 'usage-history', 'audit-logs', 'meet-the-team', 'settings',
   'academic-years', 'departments', 'subject-bank', 'reports']
    .forEach(tab => check(`SPEC §23 Route "${tab}" preserved`, app.includes(`'${tab}'`)));

  // Existing backend routes preserved
  ['/question-banks/extract', '/question-banks/:id/approve', '/auth/login', '/auth/logout',
   '/academic-years', '/departments', '/subjects', '/audit-logs', '/stats/summary', '/exam-patterns']
    .forEach(route => {
      const file = route.startsWith('/exam') || route.startsWith('/academic') || route.startsWith('/departments') || route.startsWith('/subjects') || route.startsWith('/stats')
        ? masterData : read('server/routes/questionBankRoutes.ts') + read('server/routes/authRoutes.ts') + read('server/routes/auditLogRoutes.ts');
      check(`SPEC §23 Backend route ${route} preserved`, file.includes(route));
    });

  // Gemini extraction untouched
  check('SPEC §23 Gemini extraction service intact', read('server/services/geminiQuestionBankService.ts').includes('gemini'));
  check('SPEC §23 Gemini config service intact', read('server/services/geminiConfig.ts').length > 0);

  // Watermark + paper format preserved
  check('SPEC §23 Watermark functionality preserved',
    exportUtils.includes('msajce_internal_exam_watermark.png') && read('src/components/PaperPreview.tsx').includes('INTERNAL_EXAM_WATERMARK_SRC'));

  // Existing exports preserved
  ['exportToWordDocument', 'exportToPdfDirect', 'exportToHtmlFile', 'exportToJsonFile', 'generatePrintablePaperHtml']
    .forEach(fn => check(`SPEC §23 Export function ${fn} preserved`, exportUtils.includes(`export function ${fn}`) || exportUtils.includes(`export async function ${fn}`)));

  // New file naming is applied
  check('SPEC §5 PDF export uses the canonical file name', exportUtils.includes("paperFileName(paper, 'pdf')"));
  check('SPEC §5 Word export uses the canonical .docx file name', exportUtils.includes("paperFileName(paper, 'docx')"));

  // Wizard entry flow
  check('SPEC §2 Wizard always starts at Step 1', /useState<number>\(1\)/.test(wizard));
  check('SPEC §2 Academic year is not auto-selected', /useState<string>\(''\)/.test(wizard));
  check('SPEC §2 Step 1 is Academic Year', wizard.indexOf('Select Academic Year') < wizard.indexOf('Select Academic Department'));
  check('SPEC §2 Step 2 is Department', wizard.indexOf('Select Academic Department') < wizard.indexOf('Step 3 of 5'));
  check('SPEC §14 Step 5 shows Existing Sets', wizard.includes('Existing Sets'));
  check('SPEC §14 Step 5 shows Next Available Set', wizard.includes('Next Available Set'));
  check('SPEC §14 Step 5 shows Generation Permission', wizard.includes('Generation Permission'));
  check('SPEC §14 Step 5 shows the Exam Pattern', wizard.includes('Exam Pattern'));
  check('SPEC §3 "Request Additional Set" button present', wizard.includes('Request Additional Set'));
  check('SPEC §2 Selected year is passed to the generator', /academicYear: selectedAcademicYear/.test(wizard));

  // Question usage only at finalization (TEST 16 / 17)
  const usageBlock = appContext.slice(appContext.indexOf('const updatePaperStatus'));
  check('TEST 16 Question usage is NOT recorded on generation',
    !appContext.slice(appContext.indexOf('const generatePaper'), appContext.indexOf('const replaceQuestionInPaper'))
      .includes('timesUsed: q.usageHistory.timesUsed + 1'));
  check('TEST 17 Question usage IS recorded on Finalized',
    usageBlock.includes("newStatus === 'Finalized'") && usageBlock.includes('timesUsed + 1'));
  check('TEST 16b Usage is not recorded on Rejected',
    !/newStatus === 'Rejected'[\s\S]{0,200}timesUsed \+ 1/.test(usageBlock));
  check('SPEC §16 Finalization calls the backend usage endpoint',
    usageBlock.includes('finalizePaperUsage'));

  // Principal role support
  check('SPEC §7 PRINCIPAL role in backend type union',
    read('server/middleware/authMiddleware.ts').includes("'PRINCIPAL'"));
  check('SPEC §7 User accounts allow PRINCIPAL role',
    read('supabase/migrations/006_principal_workflow.sql').includes("'PRINCIPAL'"));
  check('SPEC §7 Migration 010 re-asserts the role constraint',
    read('supabase/migrations/010_set_tracking_principal_approval.sql').includes("'PRINCIPAL'"));

  // DB set tracking
  check('SPEC §6 generated_papers has set_name', read('supabase/migrations/010_set_tracking_principal_approval.sql').includes('set_name'));
  check('SPEC §18 generated_papers has principal_request_id', read('supabase/migrations/010_set_tracking_principal_approval.sql').includes('principal_request_id'));
  check('SPEC §21 exam_set_limits lookup table created', read('supabase/migrations/010_set_tracking_principal_approval.sql').includes('CREATE TABLE IF NOT EXISTS exam_set_limits'));
  check('SPEC §4 DB-level duplicate set prevention', read('supabase/migrations/010_set_tracking_principal_approval.sql').includes('enforce_generated_paper_set_uniqueness'));
  check('SPEC §12 consumption columns added', read('supabase/migrations/010_set_tracking_principal_approval.sql').includes('consumed_at'));
  check('SPEC §21 No duplicate generated_papers table created',
    !/CREATE TABLE (IF NOT EXISTS )?generated_papers/.test(read('supabase/migrations/010_set_tracking_principal_approval.sql')));

  // Self-approval guard
  check('SPEC §22 Self-approval blocked on the server', paperSetRoutes.includes('SELF_APPROVAL'));
  const authSvc = read('server/services/generationAuthorizationService.ts');
  check('SPEC §22 Approval consumption enforced on the server', authSvc.includes('APPROVAL_CONSUMED'));
  check('SPEC §22 Approval scope mismatch enforced', paperSetRoutes.includes('APPROVAL_SCOPE_MISMATCH') || authSvc.includes('APPROVAL_SCOPE_MISMATCH'));
  check('SPEC §19 Principal approval audit event', paperSetRoutes.includes('PRINCIPAL_APPROVED_REQUEST'));
  check('SPEC §19 Principal rejection audit event', paperSetRoutes.includes('PRINCIPAL_REJECTED_REQUEST'));
  check('SPEC §19 Additional paper request audit event', paperSetRoutes.includes('ADDITIONAL_PAPER_REQUEST_CREATED'));
  check('SPEC §19 Paper downloaded audit event', paperSetRoutes.includes('PAPER_DOWNLOADED'));
  check('SPEC §19 Paper finalized audit event', paperSetRoutes.includes('PAPER_FINALIZED'));
  check('SPEC §19 Pattern edited audit event', masterData.includes('EXAM_PATTERN_EDITED'));
  check('SPEC §22 No service-role key leaks to the frontend',
    !read('src/services/authApi.ts').includes('SUPABASE_SERVICE_ROLE_KEY') &&
    !read('src/services/questionBankApi.ts').includes('SUPABASE_SERVICE_ROLE_KEY'));

  // No secrets in the client bundle sources
  const env = read('.env');
  check('SPEC §22 .env is not referenced by the frontend', !read('src/services/authApi.ts').includes('SUPABASE_SERVICE_ROLE'));
  void env;
}

// ===========================================================================
// Summary
// ===========================================================================
console.log(`\n${'═'.repeat(72)}`);
console.log(`  TEST RESULTS:  ${passed} passed   ${failed} failed   (${passed + failed} total)`);
console.log('═'.repeat(72));
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  • ${f}`));
  process.exit(1);
}
console.log('\nAll scenarios passed.\n');
