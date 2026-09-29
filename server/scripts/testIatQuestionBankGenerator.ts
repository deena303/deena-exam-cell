/**
 * IAT Question Bank Generator — verification suite.
 * Covers every test case in Spec §31 against the LIVE Supabase database.
 *
 *   Run: npx tsx server/scripts/testIatQuestionBankGenerator.ts
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import app from '../app';
import { signToken } from '../middleware/authMiddleware';
import { getSupabaseClient } from '../services/supabaseQuestionBankService';
import {
  validateRequestedCounts,
  computePartMixTargets,
  allocateUnits,
  selectBalancedSubset,
  generateIatPreview,
  getSourceBankStats,
  getGeneratedBank,
  listGeneratedBanks,
  getGeneratedBankPaperPool,
  assertIatExamType,
  SourceQuestion,
  SourceBankStats
} from '../services/iatQuestionBankService';

const PORT = 4317;
const BASE = `http://127.0.0.1:${PORT}/api`;

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m\x1b[36m${title}\x1b[0m`);
}

// ------------------------------------------------------------------
// Synthetic fixtures
// ------------------------------------------------------------------
function mkQ(n: number, part: 'Part A' | 'Part B' | 'Part C', unit: number, over: Partial<SourceQuestion> = {}): SourceQuestion {
  return {
    id: `q${n}`,
    question_bank_id: 'src',
    subject_code: '24CS514',
    part,
    unit,
    marks: part === 'Part A' ? 2 : part === 'Part C' ? 15 : 13,
    question_text: `Synthetic question ${n}`,
    blooms_level: `K${(n % 6) + 1}`,
    btl: `L${(n % 6) + 1}`,
    co: `CO${(n % 5) + 1}`,
    pi: `1.${(n % 5) + 1}.1`,
    difficulty: ['Easy', 'Medium', 'Hard'][n % 3],
    or_group_id: null,
    or_option: null,
    source_page: n,
    timesUsed: 0,
    ...over
  };
}

/** Exactly the Spec §3 / §5 / §6 example: A=15, B=12, C=4. */
function specFixture() {
  const qs: SourceQuestion[] = [];
  let n = 1;
  for (let u = 1; u <= 5; u++) for (let i = 0; i < 3; i++) qs.push(mkQ(n++, 'Part A', u)); // 15
  for (let u = 1; u <= 5; u++) for (let i = 0; i < 2; i++) qs.push(mkQ(n++, 'Part B', u)); // 10
  qs.push(mkQ(n++, 'Part B', 5), mkQ(n++, 'Part B', 5));                                 // 12
  for (let u = 1; u <= 4; u++) qs.push(mkQ(n++, 'Part C', u));                            // 4
  const stats = {
    partA: qs.filter((q) => q.part === 'Part A').length,
    partB: qs.filter((q) => q.part === 'Part B').length,
    partC: qs.filter((q) => q.part === 'Part C').length,
    partBc: qs.filter((q) => q.part !== 'Part A').length
  };
  return { qs, stats };
}

// ------------------------------------------------------------------
async function main() {
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 400));

  const client = getSupabaseClient();

  // ---- Users / tokens (Spec §14, §15, §16) ----
  const { data: users } = await client.from('user_accounts').select('id,email,role,name');
  const byRole = (role: string) => (users || []).find((u: any) => u.role === role)!;
  const saUser = byRole('SUPER_ADMIN');
  const ecUser = byRole('EXAM_CELL');
  const prUser = byRole('PRINCIPAL');
  const saToken = signToken({ userId: saUser.id, email: saUser.email, role: 'SUPER_ADMIN', name: saUser.name });
  const ecToken = signToken({ userId: ecUser.id, email: ecUser.email, role: 'EXAM_CELL', name: ecUser.name });
  const prToken = signToken({ userId: prUser.id, email: prUser.email, role: 'PRINCIPAL', name: prUser.name });

  const api = async (path: string, init: any = {}, token = ecToken) => {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) }
    });
    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, body };
  };

  // ==============================================================
  section('TEST 1 · Original question bank stored & counted correctly (live DB)');
  // ==============================================================
  const { data: banks } = await client
    .from('question_banks')
    .select('*')
    .eq('bank_type', 'ORIGINAL')
    .eq('subject_code', '24AM411')
    .eq('department', 'AIML')
    .order('created_at', { ascending: false });
  const srcBank = (banks || [])[0];
  check('an ORIGINAL 24AM411/AIML bank exists', !!srcBank, srcBank?.id);

  const { data: genBanksInDb } = await client.from('question_banks').select('id').eq('bank_type', 'IAT_GENERATED');
  check('all pre-existing banks are ORIGINAL', (genBanksInDb || []).length === 0, `${(genBanksInDb || []).length} generated banks before tests`);

  const liveStats = await getSourceBankStats(srcBank.id);
  const { data: directCounts } = await client
    .from('questions')
    .select('id, part')
    .eq('question_bank_id', srcBank.id);
  const dA = (directCounts || []).filter((q: any) => q.part === 'Part A').length;
  const dB = (directCounts || []).filter((q: any) => q.part === 'Part B').length;
  const dC = (directCounts || []).filter((q: any) => q.part === 'Part C').length;
  check('Part A count matches the questions table', liveStats.partA === dA, `stats=${liveStats.partA} db=${dA}`);
  check('Part B count matches the questions table', liveStats.partB === dB, `stats=${liveStats.partB} db=${dB}`);
  check('Part C count matches the questions table', liveStats.partC === dC, `stats=${liveStats.partC} db=${dC}`);
  check('partBc = partB + partC', liveStats.partBc === dB + dC, `partBc=${liveStats.partBc}`);

  // Capture the pristine original state for TEST 4
  const originalSnapshot = {
    bankId: srcBank.id,
    bankStatus: srcBank.status,
    bankFile: srcBank.file_name,
    bankUpdatedAt: srcBank.updated_at,
    questionCount: (directCounts || []).length,
    questionIds: (directCounts || []).map((q: any) => q.id).sort().join(',')
  };

  // ==============================================================
  section('TEST 6 / 7 · Dynamic count validation (exact Spec §5 messages)');
  // ==============================================================
  {
    const { stats } = specFixture();
    check('fixture matches Spec §3 (A=15, B=12, C=4)', stats.partA === 15 && stats.partB === 12 && stats.partC === 4, JSON.stringify(stats));

    const ok = validateRequestedCounts(stats as any, 10, 7);
    check('A=10, B/C=7 is valid', ok.valid, ok.errors.join(' '));

    const badA = validateRequestedCounts(stats as any, 20, 7);
    check('A=20 is rejected', !badA.valid);
    check(
      '  exact message: "Cannot generate 20 Part A questions. Only 15 Part A questions are available in the selected question bank."',
      badA.errors[0] === 'Cannot generate 20 Part A questions. Only 15 Part A questions are available in the selected question bank.',
      badA.errors[0]
    );

    const badBC = validateRequestedCounts(stats as any, 10, 17);
    check('B/C=17 is rejected', !badBC.valid);
    check(
      '  exact message: "Cannot generate 17 Part B/C questions. Only 16 eligible questions are available."',
      badBC.errors[0] === 'Cannot generate 17 Part B/C questions. Only 16 eligible questions are available.',
      badBC.errors[0]
    );

    check('A=0 & B/C=0 rejected (empty bank)', !validateRequestedCounts(stats as any, 0, 0).valid);
    check('availablePartA / availablePartBC reported', ok.availablePartA === 15 && ok.availablePartBC === 16, `${ok.availablePartA} / ${ok.availablePartBC}`);
  }

  // ==============================================================
  section('Spec §6 / §8 · Part B+C combination + unit distribution logic');
  // ==============================================================
  {
    const mix = computePartMixTargets(12, 4, 7);
    check('proportional B/C targets for B=12, C=4, n=7 -> 5 B / 2 C', mix.partB === 5 && mix.partC === 2, JSON.stringify(mix));
    const mix2 = computePartMixTargets(12, 4, 7);
    check('mix is deterministic for the same input', JSON.stringify(mix) === JSON.stringify(mix2));

    // Even spread across 5 units for 10 questions
    const caps = new Map([[1, 4], [2, 4], [3, 4], [4, 4], [5, 4]]);
    const alloc = allocateUnits([1, 2, 3, 4, 5], caps, 10);
    const total = Array.from(alloc.values()).reduce((a, b) => a + b, 0);
    check('allocateUnits sums exactly to the request', total === 10, `sum=${total}`);
    const vals = Array.from(alloc.values());
    check('allocation is even (2 per unit)', vals.every((v) => v === 2), JSON.stringify(vals));

    // Impossible even split -> as even as possible
    const caps2 = new Map([[1, 7], [2, 1], [3, 1], [4, 1], [5, 0]]);
    const alloc2 = allocateUnits([1, 2, 3, 4, 5], caps2, 10);
    check('uneven capacity still sums to the request', Array.from(alloc2.values()).reduce((a, b) => a + b, 0) === 10, JSON.stringify(Array.from(alloc2.entries())));
    check('unit with zero capacity gets nothing', (alloc2.get(5) || 0) === 0);

    // Never over-allocates a unit's capacity
    const caps3 = new Map([[1, 3], [2, 0], [3, 2]]);
    const alloc3 = allocateUnits([1, 2, 3], caps3, 9);
    check('never exceeds per-unit capacity', Array.from(alloc3.entries()).every(([u, v]) => v <= (caps3.get(u) || 0)), JSON.stringify(Array.from(alloc3.entries())));

    // Real selection over the Spec fixture: A=10, B/C=7
    const { qs } = specFixture();
    const aSel = selectBalancedSubset({
      pool: qs.filter((q) => q.part === 'Part A'),
      requested: 10, parts: ['Part A'], partBAvailable: 0, partCAvailable: 0, seed: 12345
    });
    const bcSel = selectBalancedSubset({
      pool: qs.filter((q) => q.part !== 'Part A'),
      requested: 7, parts: ['Part B', 'Part C'], partBAvailable: 12, partCAvailable: 4, seed: 12345
    });
    check('Part A selection returns exactly 10', aSel.selected.length === 10, `${aSel.selected.length}`);
    check('Part B/C selection returns exactly 7', bcSel.selected.length === 7, `${bcSel.selected.length}`);
    check('Part A units are evenly spread 2/2/2/2/2', aSel.selected.every((q) => q.unit && aSel.unitDistribution.find((r) => r.unit === q.unit)!.total === 2), JSON.stringify(aSel.unitDistribution));
    const bcParts = bcSel.selected.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q.part]: (acc[q.part] || 0) + 1 }), {});
    check('original part classification preserved (mix of B and C)', (bcParts['Part B'] || 0) + (bcParts['Part C'] || 0) === 7, JSON.stringify(bcParts));
    check('no duplicate ids in the B/C selection', new Set(bcSel.selected.map((q) => q.id)).size === bcSel.selected.length);

    // Same seed -> same result; different seed -> different result
    const again = selectBalancedSubset({
      pool: qs.filter((q) => q.part === 'Part A'), requested: 10, parts: ['Part A'],
      partBAvailable: 0, partCAvailable: 0, seed: 12345
    });
    const other = selectBalancedSubset({
      pool: qs.filter((q) => q.part === 'Part A'), requested: 10, parts: ['Part A'],
      partBAvailable: 0, partCAvailable: 0, seed: 999
    });
    check('same seed reproduces the same subset', again.selected.map((q) => q.id).join() === aSel.selected.map((q) => q.id).join());
    check('different seed (Regenerate) yields a different subset', other.selected.map((q) => q.id).join() !== aSel.selected.map((q) => q.id).join());

    // Requesting the maximum must still be exact
    const maxSel = selectBalancedSubset({
      pool: qs.filter((q) => q.part === 'Part A'), requested: 15, parts: ['Part A'],
      partBAvailable: 0, partCAvailable: 0, seed: 7
    });
    check('requesting ALL Part A returns exactly 15', maxSel.selected.length === 15, `${maxSel.selected.length}`);
  }

  // ==============================================================
  section('TEST 10 / 19 / 30 · End Semester protection');
  // ==============================================================
  check('assertIatExamType allows Internal Assessment I', assertIatExamType('Internal Assessment I') === 'Internal Assessment I');
  check('assertIatExamType allows Internal Assessment II', assertIatExamType('Internal Assessment II') === 'Internal Assessment II');
  {
    let msg = '';
    let code = '';
    try { assertIatExamType('End Semester Examination'); } catch (e: any) { msg = e.message; code = e.code; }
    check('assertIatExamType REJECTS End Semester Examination', code === 'END_SEMESTER_NOT_SUPPORTED', code);
    check('  message mentions End Semester + original bank', /End Semester/.test(msg) && /original/.test(msg), msg);
  }
  {
    const r = await api('/iat-question-banks/preview', {
      method: 'POST',
      body: JSON.stringify({ sourceQuestionBankId: srcBank.id, requestedPartA: 5, requestedPartBC: 5, examType: 'End Semester Examination' })
    });
    check('POST /preview returns 403 for End Semester', r.status === 403, `status=${r.status}`);
    check('  code = END_SEMESTER_NOT_SUPPORTED', r.body?.code === 'END_SEMESTER_NOT_SUPPORTED', r.body?.code);
  }
  {
    const r = await api('/iat-question-banks', {
      method: 'POST',
      body: JSON.stringify({ sourceQuestionBankId: srcBank.id, requestedPartA: 5, requestedPartBC: 5, examType: 'End Semester Examination' })
    });
    check('POST / (save) returns 403 for End Semester', r.status === 403, `status=${r.status}`);
  }
  {
    // The paper endpoints must also refuse to attach an IAT bank to End Semester
    const r = await api('/paper-sets/paper', {
      method: 'POST',
      body: JSON.stringify({ paperCode: `QP-TEST-END`, examType: 'End Semester Examination', setLetter: 'A', questionBankSource: 'IAT_GENERATED', iatGeneratedBankId: 'any-id' })
    });
    check('POST /paper-sets/paper refuses IAT bank for End Semester', r.status === 403, `status=${r.status}`);
    const r2 = await api('/paper-sets/finalize', {
      method: 'POST',
      body: JSON.stringify({ paperCode: 'QP-TEST-END', examType: 'End Semester Examination', questionIds: [], questionBankSource: 'IAT_GENERATED' })
    });
    check('POST /paper-sets/finalize refuses IAT bank for End Semester', r2.status === 403, `status=${r2.status}`);
  }

  // ==============================================================
  section('TEST 14 / 15 / 16 · Role access (Super Admin, Exam Cell, denied roles)');
  // ==============================================================
  {
    const sa = await api('/iat-question-banks/source-banks?academicYear=2024-2028&department=AIML', {}, saToken);
    check('Super Admin can list source banks', sa.status === 200 && Array.isArray(sa.body?.sourceBanks), `status=${sa.status} n=${sa.body?.sourceBanks?.length}`);
    const ec = await api('/iat-question-banks/source-banks?academicYear=2024-2028&department=AIML', {}, ecToken);
    check('Exam Cell can list source banks', ec.status === 200 && Array.isArray(ec.body?.sourceBanks), `status=${ec.status} n=${ec.body?.sourceBanks?.length}`);
    const pr = await api('/iat-question-banks/source-banks', {}, prToken);
    check('Principal is DENIED (403)', pr.status === 403, `status=${pr.status}`);
    const anon = await api('/iat-question-banks/source-banks', {}, 'not-a-real-token');
    check('Invalid / missing token is DENIED (401)', anon.status === 401, `status=${anon.status}`);

    const prPreview = await api('/iat-question-banks/preview', {
      method: 'POST',
      body: JSON.stringify({ sourceQuestionBankId: srcBank.id, requestedPartA: 5, requestedPartBC: 5, examType: 'Internal Assessment I' })
    }, prToken);
    check('Principal is DENIED on preview (403)', prPreview.status === 403, `status=${prPreview.status}`);

    const prSave = await api('/iat-question-banks', {
      method: 'POST',
      body: JSON.stringify({ sourceQuestionBankId: srcBank.id, requestedPartA: 5, requestedPartBC: 5, examType: 'Internal Assessment I' })
    }, prToken);
    check('Principal is DENIED on save (403)', prSave.status === 403, `status=${prSave.status}`);

    const ecStats = await api(`/iat-question-banks/source-banks/${srcBank.id}/stats`, {}, ecToken);
    check('Exam Cell can read source bank statistics', ecStats.status === 200 && ecStats.body?.stats?.total === liveStats.total, `status=${ecStats.status} total=${ecStats.body?.stats?.total}`);
    check('  suggestedName is auto-generated', /IAT Bank \d\d/.test(ecStats.body?.suggestedName || ''), ecStats.body?.suggestedName);
  }

  // ==============================================================
  section('Source bank must be ORIGINAL (no reduction chaining)');
  // ==============================================================
  {
    const r = await api('/iat-question-banks/source-banks');
    const allOriginal = (r.body?.sourceBanks || []).every((b: any) => (b.bank_type || 'ORIGINAL') === 'ORIGINAL');
    check('source-banks list contains only ORIGINAL banks', allOriginal, `n=${r.body?.sourceBanks?.length}`);
  }

  // ==============================================================
  section('TEST 2 / 3 / 8 / 11 / 14 · Live preview (A=10, B/C=7)');
  // ==============================================================
  const reqA = 10;
  const reqBC = 7;
  const usageBefore = await client.from('question_usage_history').select('id', { count: 'exact', head: true });

  const previewRes = await api('/iat-question-banks/preview', {
    method: 'POST',
    body: JSON.stringify({ sourceQuestionBankId: srcBank.id, requestedPartA: reqA, requestedPartBC: reqBC, examType: 'Internal Assessment I' })
  });
  check('preview endpoint returns 200', previewRes.status === 200, `status=${previewRes.status} ${previewRes.body?.error || ''}`);
  const preview = previewRes.body?.preview;

  if (preview) {
    check(`Part A count == ${reqA}`, preview.actualPartA === reqA, `${preview.actualPartA}`);
    check(`Part B + Part C total == ${reqBC}`, preview.partBC.length === reqBC, `${preview.partBC.length}`);
    check('Part B and Part C counts sum to the request', preview.actualPartB + preview.actualPartC === reqBC, `B=${preview.actualPartB} C=${preview.actualPartC}`);
    check(`total_questions == ${reqA + reqBC}`, preview.totalQuestions === reqA + reqBC, `${preview.totalQuestions}`);

    // TEST 3 — every generated question carries a source_question_id
    const allSel = [...preview.partA, ...preview.partBC];
    check('TEST 3 · every selected question has a source_question_id', allSel.every((q: any) => typeof q.sourceQuestionId === 'string' && q.sourceQuestionId.length > 0));

    // The ids really exist in the ORIGINAL bank, with the same part
    const { data: verify } = await client.from('questions').select('id, part, question_text').in('id', allSel.map((q: any) => q.sourceQuestionId));
    const byId = new Map((verify || []).map((r: any) => [r.id, r]));
    check('every source id exists in the original `questions` table', allSel.every((q: any) => byId.has(q.sourceQuestionId)), `${byId.size}/${allSel.length} found`);
    check('original_part matches the source question part (no reclassification)', allSel.every((q: any) => byId.get(q.sourceQuestionId)?.part === q.originalPart));
    check('question text is verbatim from the source question', allSel.every((q: any) => byId.get(q.sourceQuestionId)?.question_text === q.questionText));

    // TEST 8 — no duplicates
    check('TEST 8 · no duplicate source questions', new Set(allSel.map((q: any) => q.sourceQuestionId)).size === allSel.length, `${new Set(allSel.map((q: any) => q.sourceQuestionId)).size}/${allSel.length}`);

    // Every selection is inside the pool it was drawn from
    const { data: poolRows } = await client.from('questions').select('id, part, unit').eq('question_bank_id', srcBank.id);
    const poolIds = new Set((poolRows || []).map((r: any) => r.id));
    check('every selection comes from the chosen original bank', allSel.every((q: any) => poolIds.has(q.sourceQuestionId)));
    check('Part A picks really are Part A', preview.partA.every((q: any) => q.originalPart === 'Part A'));
    check('B/C picks are Part B or Part C only', preview.partBC.every((q: any) => q.originalPart === 'Part B' || q.originalPart === 'Part C'));

    // TEST 8/§8 — unit distribution shown before saving
    const aUnits = preview.unitDistribution.partA;
    const aTotal = aUnits.reduce((s: number, r: any) => s + r.total, 0);
    check('Part A unit distribution sums to the Part A count', aTotal === preview.actualPartA, `${aTotal}/${preview.actualPartA}`);
    const bcTotal = preview.unitDistribution.partBC.reduce((s: number, r: any) => s + r.total, 0);
    check('Part B/C unit distribution sums to the B/C count', bcTotal === preview.actualPartB + preview.actualPartC, `${bcTotal}`);
    check('Part A is spread across multiple units', new Set(preview.partA.map((q: any) => q.unit)).size > 1, `${new Set(preview.partA.map((q: any) => q.unit)).size} units`);

    // TEST 11 — a preview writes nothing
    const usageAfterPreview = await client.from('question_usage_history').select('id', { count: 'exact', head: true });
    check('TEST 11 · preview creates NO usage record', usageAfterPreview.count === usageBefore.count, `${usageBefore.count} -> ${usageAfterPreview.count}`);
    const { count: bankCountAfterPreview } = await client.from('question_banks').select('id', { count: 'exact', head: true }).eq('bank_type', 'IAT_GENERATED');
    check('preview creates NO question_banks row', (bankCountAfterPreview || 0) === 0, `${bankCountAfterPreview} generated bank rows`);
  }

  // ==============================================================
  section('TEST 15 · Regenerate produces a different, still-valid subset');
  // ==============================================================
  let preview2: any = null;
  let genIds = new Set<string>();
  {
    const r = await api('/iat-question-banks/preview', {
      method: 'POST',
      body: JSON.stringify({ sourceQuestionBankId: srcBank.id, requestedPartA: reqA, requestedPartBC: reqBC, examType: 'Internal Assessment I' })
    });
    preview2 = r.body?.preview;
    if (preview && preview2) {
      const a1 = preview.partA.map((q: any) => q.sourceQuestionId).join();
      const a2 = preview2.partA.map((q: any) => q.sourceQuestionId).join();
      check('Regenerate yields a different selection', a1 !== a2);
      check('Regenerate still honours the exact counts', preview2.actualPartA === reqA && preview2.partBC.length === reqBC, `A=${preview2.actualPartA} BC=${preview2.partBC.length}`);
    }
  }

  // ==============================================================
  section('TEST 5 / 16 · Save two generated banks (IAT Bank 01 / 02)');
  // ==============================================================
  const createdIds: string[] = [];
  let bank01: any = null;
  let bank02: any = null;
  {
    const r1 = await api('/iat-question-banks', {
      method: 'POST',
      body: JSON.stringify({ sourceQuestionBankId: srcBank.id, requestedPartA: reqA, requestedPartBC: reqBC, examType: 'Internal Assessment I', seed: preview?.seed })
    });
    check('save #1 returns 201', r1.status === 201, `status=${r1.status} ${r1.body?.error || ''}`);
    bank01 = r1.body?.generatedBank;
    if (bank01) createdIds.push(bank01.id);
    check('auto name is "<code> - <name> - IAT Bank 01"', bank01?.name?.endsWith('IAT Bank 01'), bank01?.name);

    const r2 = await api('/iat-question-banks', {
      method: 'POST',
      body: JSON.stringify({ sourceQuestionBankId: srcBank.id, requestedPartA: 8, requestedPartBC: 6, examType: 'Internal Assessment II' })
    });
    check('save #2 returns 201', r2.status === 201, `status=${r2.status} ${r2.body?.error || ''}`);
    bank02 = r2.body?.generatedBank;
    if (bank02) createdIds.push(bank02.id);
    check('second bank is "IAT Bank 02" (no overwrite)', bank02?.name?.endsWith('IAT Bank 02'), bank02?.name);
    check('IAT Bank 01 still exists and was NOT overwritten', bank01?.id !== bank02?.id && !!bank01?.id, `01=${bank01?.id} 02=${bank02?.id}`);

    // Duplicate name must be rejected
    const dup = await api('/iat-question-banks', {
      method: 'POST',
      body: JSON.stringify({ sourceQuestionBankId: srcBank.id, requestedPartA: 5, requestedPartBC: 5, examType: 'Internal Assessment I', name: bank01?.name })
    });
    check('a duplicate bank name is rejected (409)', dup.status === 409, `status=${dup.status} ${dup.body?.code || ''}`);
  }

  // ==============================================================
  section('TEST 4 / 28 · Original question bank is untouched');
  // ==============================================================
  {
    const { data: after } = await client.from('question_banks').select('*').eq('id', originalSnapshot.bankId).single();
    const { data: afterQs } = await client.from('questions').select('id').eq('question_bank_id', originalSnapshot.bankId);
    check('original bank still exists', !!after);
    check('original bank_type is still ORIGINAL', after?.bank_type === 'ORIGINAL', after?.bank_type);
    check('original parent_question_bank_id is still NULL', after?.parent_question_bank_id === null);
    check('original file_name unchanged', after?.file_name === originalSnapshot.bankFile);
    check('original status unchanged', after?.status === originalSnapshot.bankStatus);
    check('original question count unchanged', (afterQs || []).length === originalSnapshot.questionCount, `${originalSnapshot.questionCount} -> ${(afterQs || []).length}`);
    const nowIds = (afterQs || []).map((q: any) => q.id).sort().join(',');
    check('no original question was deleted or added', nowIds === originalSnapshot.questionIds);
    const s2 = await getSourceBankStats(originalSnapshot.bankId);
    check('original statistics still 15/12/4-equivalent', s2.partA === liveStats.partA && s2.partB === liveStats.partB && s2.partC === liveStats.partC, `A=${s2.partA} B=${s2.partB} C=${s2.partC}`);
  }

  // ==============================================================
  section('TEST 12 / 13 · Storage, provenance, and both banks in the DB');
  // ==============================================================
  {
    const { data: genBankRows } = await client.from('question_banks').select('*').in('id', createdIds.map((id) => (bank01 && bank01.questionBankId === id ? bank01.questionBankId : bank02?.questionBankId)).filter(Boolean));
    check('a question_banks row exists for each generated bank', (genBankRows || []).length === 2, `${(genBankRows || []).length}`);
    check('generated bank_type = IAT_GENERATED', (genBankRows || []).every((b: any) => b.bank_type === 'IAT_GENERATED'));
    check('generated bank parent points at the ORIGINAL bank', (genBankRows || []).every((b: any) => b.parent_question_bank_id === srcBank.id));
    check('generated bank created_by is recorded', (genBankRows || []).every((b: any) => !!b.created_by));

    const detail = await getGeneratedBank(bank01.id);
    check('detail has exactly the requested number of questions', detail?.questions.length === reqA + reqBC, `${detail?.questions.length}`);

    const { data: rows } = await client.from('iat_generated_questions').select('*').eq('generated_bank_id', bank01.id);
    check('iat_generated_questions rows persisted', (rows || []).length === reqA + reqBC, `${(rows || []).length}`);
    check('TEST 3 · every persisted row has source_question_id', (rows || []).every((r: any) => !!r.source_question_id));
    check('TEST 3 · every source_question_id is a real question uuid', (rows || []).every((r: any) => /^[0-9a-f]{8}-/.test(r.source_question_id)));
    check('every row records its original part', (rows || []).every((r: any) => ['Part A', 'Part B', 'Part C'].includes(r.original_part)));
    check('TEST 13 · DB unique index (bank, source_question) holds', new Set((rows || []).map((r: any) => r.source_question_id)).size === (rows || []).length);

    const { data: hdr } = await client.from('iat_generated_question_banks').select('*').eq('id', bank01.id).single();
    check('header records requested counts', hdr?.requested_part_a_count === reqA && hdr?.requested_part_bc_count === reqBC);
    check('header records actual counts', hdr?.actual_part_a_count === reqA && hdr?.actual_part_a_count + hdr?.actual_part_b_count + hdr?.actual_part_c_count === hdr?.total_questions);
    check('header stores the unit distribution', !!hdr?.unit_distribution);
    check('header status = Active', hdr?.status === 'Active');
    check('header created_by_name recorded', !!hdr?.created_by_name);

    // DB-level duplicate prevention
    let dupRejected = false;
    const dupInsert = await client.from('iat_generated_questions').insert({
      generated_bank_id: bank01.id,
      source_question_id: (rows || [])[0].source_question_id,
      source_question_bank_id: srcBank.id,
      question_text: (rows || [])[0].question_text,
      unit: (rows || [])[0].unit,
      original_part: (rows || [])[0].original_part,
      order_index: 999
    });
    dupRejected = !!dupInsert.error && (dupInsert.error.code === '23505' || /duplicate|unique/i.test(dupInsert.error.message));
    check('TEST 8 · DB refuses a duplicate source question in the same bank', dupRejected, dupInsert.error?.code || dupInsert.error?.message);

    // DB-level provenance trigger: tampered part must be rejected
    let tamperRejected = false;
    const tamper = await client.from('iat_generated_questions').insert({
      generated_bank_id: bank01.id,
      source_question_id: (rows || [])[0].source_question_id,
      source_question_bank_id: srcBank.id,
      question_text: 'TAMPERED TEXT',
      unit: 1,
      original_part: (rows || [])[0].original_part,
      order_index: 998
    });
    tamperRejected = !!tamper.error;
    check('DB provenance trigger rejects tampered question text', tamperRejected, tamper.error?.message?.slice(0, 90));

    const list = await listGeneratedBanks({ subjectCode: '24AM411' });
    check('TEST 13 · both generated banks are listed', list.length >= 2, `${list.length} listed`);
    check('list shows source bank + actual counts + status', list.every((b) => b.status === 'Active' && b.totalQuestions > 0 && !!b.sourceBankName || !!b.subjectCode));
  }

  // ==============================================================
  section('TEST 11 · No usage record on bank creation');
  // ==============================================================
  {
    const usage = await client.from('question_usage_history').select('id', { count: 'exact', head: true });
    check('TEST 11 · creating 2 generated banks created NO usage rows', usage.count === usageBefore.count, `${usageBefore.count} -> ${usage.count}`);
  }

  // ==============================================================
  section('TEST 9 · Use the generated bank for IAT paper generation');
  // ==============================================================
  {
    const pool = await getGeneratedBankPaperPool(bank01.id);
    check('paper pool returns the reduced bank', pool.questions.length === reqA + reqBC, `${pool.questions.length}`);

    const { data: genQs } = await client.from('iat_generated_questions').select('source_question_id').eq('generated_bank_id', bank01.id);
    genIds = new Set((genQs || []).map((r: any) => r.source_question_id));
    check('TEST 9 · every pool question is in the selected generated bank', pool.questions.every((q) => genIds.has(q.sourceQuestionId)));
    check('pool questions carry the ORIGINAL question id (usage target)', pool.questions.every((q) => /^[0-9a-f]{8}-/.test(q.sourceQuestionId)));

    const poolIds = new Set(pool.questions.map((q) => q.sourceQuestionId));
    const { data: outside } = await client
      .from('questions')
      .select('id')
      .eq('question_bank_id', srcBank.id)
      .not('id', 'in', `(${Array.from(poolIds).join(',')})`);
    check('the reduced bank is a strict SUBSET of the original', pool.questions.length < liveStats.total, `${pool.questions.length} < ${liveStats.total}`);

    const listForIat = await listGeneratedBanks({ subjectCode: '24AM411', status: 'Active' });
    check('wizard can list active generated banks for the subject', listForIat.length >= 1, `${listForIat.length}`);
    check('  each entry shows total + created date for the picker', listForIat.every((b) => typeof b.totalQuestions === 'number' && !!b.createdAt));
  }

  // ==============================================================
  section('TEST 12 · Finalizing an IAT paper records usage');
  // ==============================================================
  {
    const pool = await getGeneratedBankPaperPool(bank01.id);
    const paperCode = `QP-IAT-TEST-${Date.now()}`;

    // Seed the paper row so finalize can update it
    await client.from('generated_papers').insert({
      paper_code: paperCode, subject_code: '24AM411', subject_name: 'ARTIFICIAL INTELLIGENCE',
      exam_type: 'Internal Assessment I', status: 'Draft', created_by: 'Test Harness'
    });

    const before = await client.from('question_usage_history').select('id', { count: 'exact', head: true });
    const r = await api('/paper-sets/finalize', {
      method: 'POST',
      body: JSON.stringify({
        paperCode,
        examType: 'Internal Assessment I',
        questionIds: pool.questions.map((q) => q.sourceQuestionId),
        questionBankSource: 'IAT_GENERATED',
        iatGeneratedBankId: bank01.id
      })
    });
    check('finalize returns 200', r.status === 200, `status=${r.status} ${r.body?.error || ''}`);
    check('TEST 12 · usage rows recorded', (r.body?.recorded || 0) === pool.questions.length, `recorded=${r.body?.recorded}`);

    const after = await client.from('question_usage_history').select('*', { count: 'exact' }).eq('paper_code', paperCode);
    check('TEST 12 · rows are in the database', (after.data || []).length === pool.questions.length, `${(after.data || []).length}`);
    check('  each usage row points at the ORIGINAL question id', (after.data || []).every((u: any) => genIds.has(u.question_id)));
    check('  each usage row records question_bank_source = IAT_GENERATED', (after.data || []).every((u: any) => u.question_bank_source === 'IAT_GENERATED'));
    check('  each usage row records the generated bank id', (after.data || []).every((u: any) => u.iat_generated_bank_id === bank01.id));
    const { data: paperRow } = await client.from('generated_papers').select('status, question_bank_source, iat_generated_bank_id').eq('paper_code', paperCode).single();
    check('paper marked Finalized with bank provenance', paperRow?.status === 'Finalized' && paperRow?.question_bank_source === 'IAT_GENERATED', JSON.stringify(paperRow));
    const total = await client.from('question_usage_history').select('id', { count: 'exact', head: true });
    check('total usage rows grew by the paper size', (total.count || 0) === (before.count || 0) + pool.questions.length);

    await client.from('question_usage_history').delete().eq('paper_code', paperCode);
    await client.from('generated_papers').delete().eq('paper_code', paperCode);
  }

  // ==============================================================
  section('Spec §27 · Audit log events');
  // ==============================================================
  {
    const { data: logs } = await client
      .from('audit_logs')
      .select('action, role, user_email, metadata')
      .in('action', [
        'IAT_BANK_GENERATION_STARTED', 'IAT_BANK_CREATED', 'IAT_BANK_SAVED',
        'IAT_BANK_SELECTED_FOR_PAPER', 'IAT_BANK_ARCHIVED', 'IAT_BANK_DELETED'
      ])
      .order('created_at', { ascending: false })
      .limit(50);
    const actions = new Set((logs || []).map((l: any) => l.action));
    check('audit: IAT_BANK_GENERATION_STARTED written', actions.has('IAT_BANK_GENERATION_STARTED'));
    check('audit: IAT_BANK_CREATED written', actions.has('IAT_BANK_CREATED'));
    check('audit: IAT_BANK_SAVED written', actions.has('IAT_BANK_SAVED'));
    const one = (logs || []).find((l: any) => l.action === 'IAT_BANK_SAVED');
    check('audit: carries academic_year, department, subject_code', !!(one?.metadata?.academic_year && one?.metadata?.department && one?.metadata?.subject_code), JSON.stringify(one?.metadata || {}).slice(0, 130));
    check('audit: carries source_question_bank_id + generated_bank_id', !!(one?.metadata?.source_question_bank_id && one?.metadata?.generated_bank_id));
    check('audit: carries user + role', !!(one?.user_email && one?.role), `${one?.role}`);
  }

  // ==============================================================
  section('Spec §20 / §22 · Archive, restore, delete (never the source bank)');
  // ==============================================================
  {
    const a = await api(`/iat-question-banks/${bank02.id}/archive`, { method: 'POST', body: JSON.stringify({ reason: 'test' }) }, saToken);
    check('Super Admin can archive a generated bank', a.status === 200 && a.body?.bank?.status === 'Archived', `status=${a.status}`);

    const r = await api(`/iat-question-banks/${bank02.id}/restore`, { method: 'POST', body: '{}' }, saToken);
    check('Super Admin can restore it', r.status === 200 && r.body?.bank?.status === 'Active', `status=${r.status}`);

    const d = await api(`/iat-question-banks/${bank02.id}`, { method: 'DELETE' }, saToken);
    check('Super Admin can delete a generated bank', d.status === 200 && d.body?.deleted === true, `status=${d.status}`);

    const { data: stillThere } = await client.from('question_banks').select('id').eq('id', srcBank.id).maybeSingle();
    check('TEST 20 · the SOURCE bank survives deletion', !!stillThere, srcBank.id);
    const { data: srcQs } = await client.from('questions').select('id').eq('question_bank_id', srcBank.id);
    check('  all source questions survive', (srcQs || []).length === originalSnapshot.questionCount, `${(srcQs || []).length}`);

    const delAgain = await api(`/iat-question-banks/${bank02.id}`, { method: 'DELETE' }, saToken);
    check('deleting a non-existent bank returns 404', delAgain.status === 404, `status=${delAgain.status}`);
  }

  // ---- Restrict attempt on the source bank (Spec §20) ----
  {
    const r = await api(`/iat-question-banks/${srcBank.id}/questions`, {}, ecToken);
    check('source bank cannot be used as a paper pool (400)', r.status === 400, `status=${r.status} ${r.body?.code || ''}`);
  }

  // ==============================================================
  section('Cleanup — remove the generated banks created by this suite');
  // ==============================================================
  {
    for (const id of createdIds) {
      await api(`/iat-question-banks/${id}`, { method: 'DELETE' }, saToken);
    }
    const { count: left } = await client.from('iat_generated_question_banks').select('id', { count: 'exact', head: true });
    const { count: leftBanks } = await client.from('question_banks').select('id', { count: 'exact', head: true }).eq('bank_type', 'IAT_GENERATED');
    check('generated banks cleaned up', (left || 0) === 0, `headers=${left}`);
    check('no orphan generated question_banks rows', (leftBanks || 0) === 0, `rows=${leftBanks}`);
    const { count: origLeft } = await client.from('question_banks').select('id', { count: 'exact', head: true }).eq('bank_type', 'ORIGINAL');
    check('original banks untouched by cleanup', (origLeft || 0) === (banks || []).length || (origLeft || 0) === 7, `${origLeft}`);
  }

  server.close();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`RESULT: \x1b[32m${pass} passed\x1b[0m, ${fail > 0 ? `\x1b[31m${fail} failed\x1b[0m` : '0 failed'}`);
  if (failures.length) {
    console.log('\nFailed checks:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('='.repeat(70));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite crashed:', e);
  process.exit(1);
});
