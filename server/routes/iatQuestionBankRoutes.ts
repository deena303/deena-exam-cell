/**
 * IAT Question Bank Generator — HTTP routes (Spec §1, §18–§23, §30)
 *
 * Access: SUPER_ADMIN and EXAM_CELL only (Spec §20, §21).
 * Principal is denied — Spec §16: "Verify unauthorized roles cannot access
 * the feature."
 *
 * End Semester protection (Spec §19, §30): every mutating endpoint calls
 * `assertIatExamType`, which rejects "End Semester Examination" with 403
 * before any database work happens.
 */
import express, { Response } from 'express';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/authMiddleware';
import {
  IatFeatureError,
  assertIatExamType,
  isIatExamType,
  getOriginalQuestionBanks,
  getSourceBankStats,
  generateIatPreview,
  generateIatPreviewUnitWise,
  saveGeneratedBank,
  listGeneratedBanks,
  getGeneratedBank,
  archiveGeneratedBank,
  restoreGeneratedBank,
  deleteGeneratedBank,
  getGeneratedBankPaperPool,
  auditGeneratedBankUsedForPaper,
  nextGeneratedBankSequence
} from '../services/iatQuestionBankService';
import { checkGeminiConfig } from '../services/geminiConfig';
import { isSupabaseConfigured, getSupabaseClient } from '../services/supabaseQuestionBankService';
import { writeAuditLog, AUDIT_ACTIONS } from '../services/auditService';

const router = express.Router();

// Every route in this file requires an authenticated SUPER_ADMIN / EXAM_CELL.
const iatAccess = [requireAuth, requireRole('SUPER_ADMIN', 'EXAM_CELL')] as const;

function actor(req: AuthenticatedRequest) {
  return {
    userId: req.user!.userId,
    userEmail: req.user!.email,
    userName: req.user!.name,
    role: req.user!.role
  };
}

function fail(res: Response, err: any) {
  if (err instanceof IatFeatureError) {
    return res.status(err.status).json({ success: false, error: err.message, code: err.code });
  }
  console.error('[iat-question-banks]', err?.message || err);
  return res.status(500).json({
    success: false,
    error: err?.message || 'Unexpected error while processing the IAT question bank request.',
    code: 'IAT_INTERNAL_ERROR'
  });
}

function str(v: unknown): string | null {
  const s = (v ?? '').toString().trim();
  return s ? s : null;
}

// ====================================================================
// GET /api/iat-question-banks/health
// Cheap readiness probe so the UI can explain a missing-migration state
// instead of failing with a generic error.
// ====================================================================
router.get('/iat-question-banks/health', ...iatAccess, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.json({ success: true, databaseConfigured: false, schemaReady: false, geminiConfigured: checkGeminiConfig().configured });
    }
    const client = getSupabaseClient();
    const { error } = await client.from('iat_generated_question_banks').select('id').limit(1);
    const schemaReady = !error;
    return res.json({
      success: true,
      databaseConfigured: true,
      schemaReady,
      geminiConfigured: checkGeminiConfig().configured,
      iatExamTypes: ['Internal Assessment I', 'Internal Assessment II'],
      endSemesterSupported: false
    });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ====================================================================
// GET /api/iat-question-banks/source-banks
// Original (uploaded) question banks available as a reduction source.
// Spec §23 — all data comes from the database, nothing is hardcoded.
// ====================================================================
router.get('/iat-question-banks/source-banks', ...iatAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { academicYear, department, subjectCode, search } = req.query as Record<string, string | undefined>;
    const banks = await getOriginalQuestionBanks({
      academicYear: str(academicYear),
      department: str(department),
      subjectCode: str(subjectCode),
      search: str(search)
    });
    return res.json({ success: true, sourceBanks: banks });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ====================================================================
// GET /api/iat-question-banks/source-banks/:bankId/stats
// Original Question Bank Statistics shown in Step 4 of the form (Spec §4, §25)
// ====================================================================
router.get('/iat-question-banks/source-banks/:bankId/stats', ...iatAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await getSourceBankStats(req.params.bankId);
    const { name } = await nextGeneratedBankSequence(stats.subjectCode, stats.subjectName || stats.subjectCode);
    return res.json({ success: true, stats, suggestedName: name });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ====================================================================
// POST /api/iat-question-banks/preview
// Validates the requested counts, builds a balanced subset and returns a
// PREVIEW ONLY. Nothing is written to the database (Spec §14, §15, §16).
// ====================================================================
router.post('/iat-question-banks/preview', ...iatAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sourceQuestionBankId, requestedPartA, requestedPartBC, examType, seed, useGemini, unitRequests } = req.body || {};

    // Spec §19 / §30 — hard block for End Semester, before any DB access.
    const resolvedExamType = assertIatExamType(examType);

    if (!str(sourceQuestionBankId)) {
      throw new IatFeatureError('Select an original question bank first.', 400, 'SOURCE_BANK_REQUIRED');
    }

    // Determine generation mode
    const isUnitWise = Array.isArray(unitRequests) && unitRequests.length > 0;

    await writeAuditLog({
      ...actor(req),
      action: AUDIT_ACTIONS.IAT_BANK_GENERATION_STARTED,
      status: 'SUCCESS',
      metadata: {
        source_question_bank_id: sourceQuestionBankId,
        requested_part_a: isUnitWise ? undefined : requestedPartA,
        requested_part_bc: isUnitWise ? undefined : requestedPartBC,
        unit_requests: isUnitWise ? unitRequests : undefined,
        exam_type: resolvedExamType,
        mode: isUnitWise ? 'unit_wise' : 'global',
        phase: 'preview'
      }
    });

    let preview;
    if (isUnitWise) {
      preview = await generateIatPreviewUnitWise({
        sourceQuestionBankId: String(sourceQuestionBankId),
        requestedPartA: 0,
        requestedPartBC: 0,
        examType: resolvedExamType,
        seed: seed === undefined || seed === null ? undefined : Number(seed),
        unitRequests: unitRequests.map((r: any) => ({
          unit: Number(r.unit),
          partA: Number(r.partA),
          partBC: Number(r.partBC)
        }))
      });
    } else {
      preview = await generateIatPreview({
        sourceQuestionBankId: String(sourceQuestionBankId),
        requestedPartA: Number(requestedPartA),
        requestedPartBC: Number(requestedPartBC),
        examType: resolvedExamType,
        seed: seed === undefined || seed === null ? undefined : Number(seed),
        useGemini: Boolean(useGemini)
      });
    }

    return res.json({ success: true, preview });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ====================================================================
// POST /api/iat-question-banks
// Persists the reduced bank (Spec §16). This is the ONLY endpoint that
// writes anything, and it never writes a question-usage record (Spec §17).
// ====================================================================
router.post('/iat-question-banks', ...iatAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sourceQuestionBankId, requestedPartA, requestedPartBC, examType, name, seed, unitRequests } = req.body || {};
    const resolvedExamType = assertIatExamType(examType);

    if (!str(sourceQuestionBankId)) {
      throw new IatFeatureError('Select an original question bank first.', 400, 'SOURCE_BANK_REQUIRED');
    }

    const isUnitWise = Array.isArray(unitRequests) && unitRequests.length > 0;
    const parsedUnitRequests = isUnitWise
      ? unitRequests.map((r: any) => ({
          unit: Number(r.unit),
          partA: Number(r.partA),
          partBC: Number(r.partBC)
        }))
      : undefined;

    const totalA = isUnitWise ? parsedUnitRequests!.reduce((s: number, r: any) => s + r.partA, 0) : Number(requestedPartA);
    const totalBC = isUnitWise ? parsedUnitRequests!.reduce((s: number, r: any) => s + r.partBC, 0) : Number(requestedPartBC);

    const { generatedBank, preview } = await saveGeneratedBank({
      sourceQuestionBankId: String(sourceQuestionBankId),
      requestedPartA: totalA,
      requestedPartBC: totalBC,
      examType: resolvedExamType,
      name: str(name) || undefined,
      seed: seed === undefined || seed === null ? undefined : Number(seed),
      unitRequests: parsedUnitRequests,
      user: {
        userId: req.user!.userId,
        email: req.user!.email,
        name: req.user!.name,
        role: req.user!.role
      }
    });

    return res.status(201).json({ success: true, generatedBank, preview });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ====================================================================
// GET /api/iat-question-banks
// IAT Generated Question Banks list (Spec §22, §23)
// ====================================================================
router.get('/iat-question-banks', ...iatAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { academicYear, department, subjectCode, sourceQuestionBankId, status, includeArchived } = req.query as Record<string, string | undefined>;
    const statusParam = str(status);
    if (statusParam && statusParam !== 'Active' && statusParam !== 'Archived') {
      throw new IatFeatureError('status must be either "Active" or "Archived".', 400, 'INVALID_STATUS_FILTER');
    }
    const banks = await listGeneratedBanks({
      academicYear: str(academicYear),
      department: str(department),
      subjectCode: str(subjectCode),
      sourceQuestionBankId: str(sourceQuestionBankId),
      status: (statusParam as 'Active' | 'Archived' | null) || null,
      includeArchived: includeArchived === 'true'
    });
    return res.json({ success: true, banks });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ====================================================================
// GET /api/iat-question-banks/:id
// Detail + the full list of selected questions with their source links.
// ====================================================================
router.get('/iat-question-banks/:id', ...iatAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const bank = await getGeneratedBank(req.params.id);
    if (!bank) {
      return res.status(404).json({ success: false, error: 'The IAT question bank was not found.', code: 'IAT_BANK_NOT_FOUND' });
    }
    return res.json({ success: true, bank });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ====================================================================
// GET /api/iat-question-banks/:id/questions
// The reduced bank expressed as an IAT paper-generation question pool.
// The question text comes from the stored snapshot of the ORIGINAL question.
// ====================================================================
router.get('/iat-question-banks/:id/questions', ...iatAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = await getGeneratedBankPaperPool(req.params.id);
    return res.json({ success: true, pool });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ====================================================================
// POST /api/iat-question-banks/:id/archive
// ====================================================================
router.post('/iat-question-banks/:id/archive', ...iatAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const a = actor(req);
    const bank = await archiveGeneratedBank(req.params.id, str(req.body?.reason), {
      userId: a.userId, email: a.userEmail, name: a.userName, role: a.role
    });
    return res.json({ success: true, bank });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ====================================================================
// POST /api/iat-question-banks/:id/restore
// ====================================================================
router.post('/iat-question-banks/:id/restore', ...iatAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const a = actor(req);
    const bank = await restoreGeneratedBank(req.params.id, {
      userId: a.userId, email: a.userEmail, name: a.userName, role: a.role
    });
    return res.json({ success: true, bank });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ====================================================================
// DELETE /api/iat-question-banks/:id
// Removes ONLY the generated bank. The source/original bank is protected by
// an ON DELETE RESTRICT foreign key and is never deleted (Spec §20, §28).
// ====================================================================
router.delete('/iat-question-banks/:id', ...iatAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const a = actor(req);
    const result = await deleteGeneratedBank(req.params.id, {
      userId: a.userId, email: a.userEmail, name: a.userName, role: a.role
    });
    return res.json({
      success: true,
      ...result,
      message: 'The generated IAT question bank was deleted. The source question bank was not modified.'
    });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ====================================================================
// POST /api/iat-question-banks/:id/use-for-paper
// Records that a generated IAT bank was chosen as the source for an IAT
// paper (Spec §18, §27). Rejects End Semester explicitly (Spec §30).
// ====================================================================
router.post('/iat-question-banks/:id/use-for-paper', ...iatAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const examType = assertIatExamType(req.body?.examType);
    if (!isIatExamType(examType)) {
      throw new IatFeatureError('Only Internal Assessment I and II papers can use a generated IAT question bank.', 403, 'END_SEMESTER_NOT_SUPPORTED');
    }
    await auditGeneratedBankUsedForPaper({
      generatedBankId: req.params.id,
      examType,
      academicYear: str(req.body?.academicYear),
      department: str(req.body?.department),
      subjectCode: str(req.body?.subjectCode),
      paperCode: str(req.body?.paperCode),
      user: (() => {
        const a = actor(req);
        return { userId: a.userId, email: a.userEmail, name: a.userName, role: a.role };
      })()
    });
    return res.json({ success: true });
  } catch (err: any) {
    return fail(res, err);
  }
});

export default router;
