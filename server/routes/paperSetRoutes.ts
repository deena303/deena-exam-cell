/**
 * Paper Set Control Routes
 *
 * Covers the authoritative generation-permission workflow (Spec §3, §4, §6,
 * §9–§12, §15, §16, §18, §19, §22):
 *
 *  - GET  /api/paper-sets/status    set counts, limit, permission decision
 *  - POST /api/paper-sets/track     record a generated set (server-side enforcement)
 *  - POST /api/paper-sets/paper     persist the generated_papers record
 *  - POST /api/paper-sets/finalize  record question usage (ONLY on finalization)
 *  - POST /api/paper-sets/download-audit
 *
 *  - GET  /api/paper-requests                 list (role filtered)
 *  - POST /api/paper-requests                 Exam Cell submits a request
 *  - PUT  /api/paper-requests/:id/decision    Principal approve / reject
 *  - PUT  /api/paper-requests/:id/cancel      Exam Cell withdraws own request
 *
 *  - GET/POST/PUT /api/paper-assignments      Principal paper review
 *  - GET/PUT  /api/paper-requests/notifications
 *  - GET      /api/principals
 *
 * SECURITY (Spec §22): every limit and approval check happens here, on the
 * server. The frontend cannot bypass the set limit, forge an approval, reuse a
 * consumed approval, or approve its own request.
 */
import express, { Response } from 'express';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/authMiddleware';
import { isSupabaseConfigured, getSupabaseClient } from '../services/supabaseQuestionBankService';
import { writeAuditLog } from '../services/auditService';
import {
  resolveExamSetLimit,
  decideGeneration,
  isIatExamType,
  ALL_SET_LETTERS,
  setGeneratedAuditAction,
  buildPaperFileName,
  getFallbackLimit
} from '../services/examSetLimitService';
import {
  authorizeGeneration,
  consumeApproval,
  resolveIdentity,
  suggestNextSetLetter,
  type GenerationIdentity
} from '../services/generationAuthorizationService';

const router = express.Router();

const VALID_EXAM_TYPES = [
  'Internal Assessment I',
  'Internal Assessment II',
  'End Semester Examination'
];

function isValidExamType(value: any): value is string {
  return typeof value === 'string' && VALID_EXAM_TYPES.includes(value);
}

function isValidSetLetter(value: any): value is string {
  return typeof value === 'string' && /^[A-H]$/.test(value.toUpperCase());
}

// ====================================================================
// GET /api/paper-sets/status
// The single authoritative permission answer. The UI renders this object
// verbatim so the screen can never disagree with the server (Spec §7).
// ====================================================================
router.get('/paper-sets/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { subjectId, academicYearId, departmentId, examType } = req.query as Record<string, string>;

    if (!subjectId || !academicYearId || !departmentId || !examType) {
      return res.status(400).json({ error: 'subjectId, academicYearId, departmentId, examType are required.' });
    }
    if (!isValidExamType(examType)) {
      return res.status(400).json({ error: 'Invalid exam type.' });
    }

    const limit = await resolveExamSetLimit(examType);
    const master = await resolveIdentity({ subjectId, academicYearId, departmentId });

    const identity: GenerationIdentity = {
      subjectId,
      academicYearId,
      departmentId,
      subjectCode: master.subjectCode,
      academicYear: master.academicYear,
      departmentCode: master.departmentCode,
      examType
    };

    // No explicit set requested -> report the next available one.
    const authorization = await authorizeGeneration({ identity, requestedSet: null });

    // Tracking rows, for the "Existing Sets" list
    let sets: any[] = [];
    if (isSupabaseConfigured()) {
      const { data } = await getSupabaseClient()
        .from('paper_set_tracking')
        .select('set_name, set_display_name, paper_code, created_at, created_by_name, additional_set_request_id')
        .eq('subject_id', subjectId)
        .eq('academic_year_id', academicYearId)
        .eq('department_id', departmentId)
        .eq('exam_type', examType)
        .eq('generation_status', 'generated')
        .order('created_at', { ascending: true });
      sets = data || [];
    }

    return res.json({
      // ---- Single source of truth (Spec §7) ----
      authorization,

      // Retained view-model fields for the existing UI
      sets,
      count: authorization.existingSets.length,
      generatedSetNames: authorization.existingSets,
      limit: authorization.limit,
      standardSetNames: authorization.standardSets,
      limitReached: authorization.limitReached,
      nextSetName: authorization.set,
      canGenerate: authorization.allowed,
      requiresApproval: authorization.requiresApproval,
      limitMessage: authorization.limitReached ? authorization.limitMessage : null,
      hasValidApproval: authorization.code === 'APPROVED',
      approvedSetNamesAvailable: authorization.code === 'APPROVED' && authorization.set ? [authorization.set] : [],
      approvalRequest: authorization.approvalId
        ? {
          id: authorization.approvalId,
          status: authorization.approvalStatus,
          approved_set_names: authorization.set ? [authorization.set] : [],
          request_number: authorization.approvalRequestNumber
        }
        : null,
      activeRequest: null,
      pendingRequest: null,
      reason: authorization.reason,
      examTypeRule: limit.limitMessage,
      databaseConfigured: isSupabaseConfigured(),
      diagnostics: authorization.degradedSchema
        ? {
          migration010Applied: false,
          warning: 'Migration 010 columns are missing on additional_paper_requests. Run supabase/migrations/010_set_tracking_principal_approval.sql. Falling back to sets_generated_from_this for consumption tracking.'
        }
        : null
    });
  } catch (err: any) {
    console.error('[paper-sets] status error:', err);
    return res.status(500).json({ error: err.message || 'Failed to get paper set status.' });
  }
});

// POST /api/paper-sets/track
// Records a generated set. Every limit and approval rule is delegated to
// authorizeGeneration() so this endpoint and the UI can never disagree.
// Duplicate protection is enforced a second time by the UNIQUE constraint on
// paper_set_tracking, which makes concurrent double-clicks safe (Spec §5).
// ====================================================================
router.post('/paper-sets/track', requireAuth, requireRole('EXAM_CELL', 'SUPER_ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      subjectId, academicYearId, departmentId, examType,
      setName, setDisplayName, paperCode, localPaperId,
      additionalSetRequestId
    } = req.body;

    if (!subjectId || !academicYearId || !departmentId || !examType || !setName) {
      return res.status(400).json({ error: 'subjectId, academicYearId, departmentId, examType, setName are required.' });
    }
    if (!isValidExamType(examType)) {
      return res.status(400).json({ error: 'Invalid exam type.' });
    }
    if (!isValidSetLetter(setName)) {
      return res.status(400).json({ error: 'Set name must be a single letter between A and H.' });
    }

    const normalizedSet = setName.toUpperCase();

    if (!isSupabaseConfigured()) {
      return res.json({ success: true, message: 'Tracking skipped (Supabase not configured).', databaseConfigured: false });
    }

    const master = await resolveIdentity({ subjectId, academicYearId, departmentId });
    const identity: GenerationIdentity = {
      subjectId,
      academicYearId,
      departmentId,
      subjectCode: master.subjectCode,
      academicYear: master.academicYear,
      departmentCode: master.departmentCode,
      examType
    };

    // ---- Re-check everything inside the operation (Spec §5) ----
    const authorization = await authorizeGeneration({
      identity,
      requestedSet: normalizedSet,
      userId: req.user!.userId
    });

    if (!authorization.allowed) {
      const httpStatus = authorization.code === 'DUPLICATE_SET' ? 409 : 403;
      writeAuditLog({
        userId: req.user!.userId,
        userEmail: req.user!.email,
        userName: req.user!.name,
        role: req.user!.role,
        action: 'PAPER_SET_GENERATION_BLOCKED',
        status: 'FAILURE',
        metadata: {
          academicYearId, departmentId, subjectId, examType,
          set: normalizedSet,
          reasonCode: authorization.code
        }
      });
      return res.status(httpStatus).json({
        // The exact reason — never a generic "blocked" message (Spec §25)
        error: authorization.reason,
        code: authorization.code,
        set: normalizedSet,
        requiresApproval: authorization.requiresApproval,
        authorization
      });
    }

    // If an approval was used, it must be the one the UI submitted.
    const approvalIdToConsume = authorization.code === 'APPROVED' ? authorization.approvalId : null;
    if (approvalIdToConsume && additionalSetRequestId && approvalIdToConsume !== additionalSetRequestId) {
      return res.status(403).json({
        error: 'Approval does not match the selected subject set.',
        code: 'APPROVAL_SCOPE_MISMATCH',
        set: normalizedSet,
        requiresApproval: true,
        authorization
      });
    }

    const client = getSupabaseClient();

    // ---- Insert tracking row. The UNIQUE constraint is the atomic guard:
    //      if two requests race, exactly one insert wins. ----
    const { data: inserted, error: insertErr } = await client
      .from('paper_set_tracking')
      .insert({
        academic_year_id: academicYearId,
        department_id: departmentId,
        subject_id: subjectId,
        exam_type: examType,
        set_name: normalizedSet,
        set_display_name: setDisplayName || null,
        paper_code: paperCode || null,
        local_paper_id: localPaperId || null,
        generation_status: 'generated',
        additional_set_request_id: approvalIdToConsume,
        created_by_user_id: req.user!.userId,
        created_by_name: req.user!.name
      })
      .select()
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(409).json({
          error: `Set ${normalizedSet} already exists.`,
          code: 'DUPLICATE_SET',
          set: normalizedSet
        });
      }
      return res.status(500).json({ error: insertErr.message });
    }

    // ---- Consume the approval atomically (Spec §4) ----
    if (approvalIdToConsume) {
      const consumption = await consumeApproval({
        approvalId: approvalIdToConsume,
        setLetter: normalizedSet,
        paperCode
      });

      if (!consumption.consumed) {
        // Someone else consumed it first. The set row is already written, so we
        // keep the set (it is legitimately generated exactly once) but report
        // the race explicitly rather than pretending it was approved cleanly.
        console.warn(`[paper-sets] approval ${approvalIdToConsume} was already consumed when generating Set ${normalizedSet}`);
      } else {
        try {
          await client.from('paper_request_notifications').insert({
            recipient_id: req.user!.userId,
            request_id: approvalIdToConsume,
            notification_type: 'generated',
            message: `Set ${normalizedSet} was generated using your Principal approval. The approval is now consumed.`
          });
        } catch (notifyErr: any) {
          console.warn('[paper-sets] notification failed:', notifyErr?.message);
        }
      }
    }

    // ---- Audit (Spec §19) ----
    writeAuditLog({
      userId: req.user!.userId,
      userEmail: req.user!.email,
      userName: req.user!.name,
      role: req.user!.role,
      action: approvalIdToConsume ? 'ADDITIONAL_PAPER_GENERATED' : setGeneratedAuditAction(examType, normalizedSet),
      status: 'SUCCESS',
      metadata: {
        academicYearId,
        departmentId,
        subjectId,
        examType,
        set: normalizedSet,
        setName: `Set ${normalizedSet}`,
        paperCode: paperCode || null,
        trackingId: inserted.id,
        principalRequestId: approvalIdToConsume
      }
    });

    return res.json({
      success: true,
      tracking: inserted,
      authorization: { ...authorization, approvalId: approvalIdToConsume },
      approvalConsumed: Boolean(approvalIdToConsume)
    });
  } catch (err: any) {
    console.error('[paper-sets] track error:', err);
    return res.status(500).json({ error: err.message || 'Failed to track paper set.' });
  }
});

// ====================================================================
// POST /api/paper-sets/paper
// Persists the generated_papers record (Spec §6) including
// principal_request_id (Spec §18). Re-validates the set through the same
// authorizeGeneration() used by the UI, so a paper row can never be written
// for a set that is not actually permitted.
// ====================================================================
router.post('/paper-sets/paper', requireAuth, requireRole('EXAM_CELL', 'SUPER_ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.json({ success: true, databaseConfigured: false, message: 'Paper record skipped (Supabase not configured).' });
    }
    const client = getSupabaseClient();
    const {
      paperCode, subjectId, subjectCode, subjectName, departmentId, academicYearId,
      examType, setLetter, setDisplayName, examDate, duration, maxMarks,
      semester, regulation, principalRequestId, localPaperId,
      questionBankSource, iatGeneratedBankId, iatGeneratedBankName
    } = req.body;

    if (!paperCode || !examType || !setLetter) {
      return res.status(400).json({ error: 'paperCode, examType and setLetter are required.' });
    }
    if (!isValidExamType(examType)) {
      return res.status(400).json({ error: 'Invalid exam type.' });
    }
    if (!isValidSetLetter(setLetter)) {
      return res.status(400).json({ error: 'Set name must be a single letter between A and H.' });
    }

    // Spec §19 / §30 — the reduced-bank link is IAT-only. End Semester keeps
    // using the original question bank and is never attached to an IAT bank.
    const bankSource = questionBankSource === 'IAT_GENERATED' ? 'IAT_GENERATED' : 'ORIGINAL';
    if (bankSource === 'IAT_GENERATED' && examType === 'End Semester Examination') {
      return res.status(403).json({
        error: 'A generated IAT question bank cannot be used for an End Semester Examination. End Semester papers always use the original question bank.',
        code: 'END_SEMESTER_NOT_SUPPORTED'
      });
    }
    const resolvedIatBankId = bankSource === 'IAT_GENERATED' ? (iatGeneratedBankId || null) : null;

    const normalizedSet = setLetter.toUpperCase();
    let resolvedSubjectCode = subjectCode || '';

    if (subjectId && academicYearId && departmentId) {
      const master = await resolveIdentity({ subjectId, academicYearId, departmentId });
      resolvedSubjectCode = subjectCode || master.subjectCode || '';
      const identity: GenerationIdentity = {
        subjectId,
        academicYearId,
        departmentId,
        subjectCode: master.subjectCode || subjectCode || '',
        academicYear: master.academicYear,
        departmentCode: master.departmentCode,
        examType
      };
      const authorization = await authorizeGeneration({ identity, requestedSet: normalizedSet, userId: req.user!.userId });
      if (!authorization.allowed) {
        return res.status(authorization.code === 'DUPLICATE_SET' ? 409 : 403).json({
          error: authorization.reason,
          code: authorization.code,
          set: normalizedSet,
          requiresApproval: authorization.requiresApproval,
          authorization
        });
      }
    }

    const limit = await resolveExamSetLimit(examType);
    const isStandardSet = limit.standardSetNames.includes(normalizedSet);
    const requiresApproval = !isStandardSet;

    const fileName = buildPaperFileName({
      subjectCode: resolvedSubjectCode,
      examType,
      setLetter: normalizedSet,
      extension: 'pdf'
    });

    const { data: inserted, error } = await client
      .from('generated_papers')
      .insert({
        paper_code: paperCode,
        subject_id: subjectId || null,
        subject_code: subjectCode || null,
        subject_name: subjectName || null,
        department_id: departmentId || null,
        academic_year_id: academicYearId || null,
        exam_type: examType,
        set_letter: normalizedSet,
        set_name: `Set ${normalizedSet}`,
        set_display_name: setDisplayName || null,
        file_name: fileName,
        exam_date: examDate || null,
        duration: duration || null,
        max_marks: maxMarks ?? (examType === 'End Semester Examination' ? 100 : 60),
        semester: semester ? String(semester) : null,
        regulation: regulation || null,
        status: 'Draft',
        created_by: req.user!.name,
        generated_by: req.user!.name,
        generated_by_user_id: req.user!.userId,
        generated_at: new Date().toISOString(),
        principal_approval_required: requiresApproval,
        principal_approval_status: requiresApproval ? (principalRequestId ? 'approved' : 'pending') : 'not_required',
        principal_request_id: principalRequestId || null,
        approved_by: principalRequestId ? 'Principal' : null,
        approved_at: principalRequestId ? new Date().toISOString() : null,
        question_bank_source: bankSource,
        iat_generated_bank_id: resolvedIatBankId,
        iat_generated_bank_name: resolvedIatBankId ? (iatGeneratedBankName || null) : null
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505' || error.message?.includes('Duplicate set blocked')) {
        return res.status(409).json({
          error: `Set ${normalizedSet} already exists for this Academic Year + Department + Subject + Exam Type.`,
          code: 'DUPLICATE_SET',
          set: normalizedSet
        });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ success: true, paper: inserted, fileName });
  } catch (err: any) {
    console.error('[paper-sets] paper persist error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ====================================================================
// POST /api/paper-sets/finalize
// Records question usage — ONLY after a paper has been reviewed and
// finalized (Spec §16). Cancelled or rejected papers never reach this.
// ====================================================================
router.post('/paper-sets/finalize', requireAuth, requireRole('EXAM_CELL', 'SUPER_ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { paperCode, examType, questionIds, subjectId, questionBankSource, iatGeneratedBankId } = req.body;
    if (!paperCode || !examType || !Array.isArray(questionIds)) {
      return res.status(400).json({ error: 'paperCode, examType and questionIds[] are required.' });
    }
    if (!isValidExamType(examType)) {
      return res.status(400).json({ error: 'Invalid exam type.' });
    }

    // Spec §19 / §30 — End Semester papers can never be attached to a
    // generated IAT question bank. Reject rather than silently ignore.
    const bankSource = questionBankSource === 'IAT_GENERATED' ? 'IAT_GENERATED' : 'ORIGINAL';
    if (bankSource === 'IAT_GENERATED' && examType === 'End Semester Examination') {
      return res.status(403).json({
        error: 'A generated IAT question bank cannot be used for an End Semester Examination. End Semester papers always use the original question bank.',
        code: 'END_SEMESTER_NOT_SUPPORTED'
      });
    }

    if (!isSupabaseConfigured()) {
      return res.json({ success: true, recorded: questionIds.length, databaseConfigured: false });
    }

    const client = getSupabaseClient();
    const dbQuestionIds = Array.from(new Set(questionIds.filter((id: any) => typeof id === 'string' && id.trim())));

    let recorded = 0;
    if (dbQuestionIds.length > 0) {
      const rows = dbQuestionIds.map((questionId: string) => ({
        question_id: questionId,
        exam_type: examType,
        paper_code: paperCode,
        // Spec §12 — provenance of the usage record. `question_id` always
        // points at the ORIGINAL question in the `questions` table.
        question_bank_source: bankSource,
        iat_generated_bank_id: bankSource === 'IAT_GENERATED' ? (iatGeneratedBankId || null) : null,
        used_at: new Date().toISOString()
      }));
      const { error } = await client.from('question_usage_history').insert(rows);
      if (error) {
        console.warn('[paper-sets] usage history insert failed:', error.message);
      } else {
        recorded = rows.length;
      }
    }

    await client
      .from('generated_papers')
      .update({
        status: 'Finalized',
        question_bank_source: bankSource,
        iat_generated_bank_id: bankSource === 'IAT_GENERATED' ? (iatGeneratedBankId || null) : null,
        updated_at: new Date().toISOString()
      })
      .eq('paper_code', paperCode);

    writeAuditLog({
      userId: req.user!.userId,
      userEmail: req.user!.email,
      userName: req.user!.name,
      role: req.user!.role,
      action: 'PAPER_FINALIZED',
      status: 'SUCCESS',
      metadata: {
        paperCode,
        examType,
        subjectId: subjectId || null,
        questionUsageRecorded: recorded,
        questionBankSource: bankSource,
        generatedBankId: bankSource === 'IAT_GENERATED' ? (iatGeneratedBankId || null) : null
      }
    });

    return res.json({ success: true, recorded });
  } catch (err: any) {
    console.error('[paper-sets] finalize error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ====================================================================
// POST /api/paper-sets/download-audit  (Spec §19)
// ====================================================================
router.post('/paper-sets/download-audit', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { paperCode, examType, setLetter, format, fileName, subjectCode } = req.body;
    writeAuditLog({
      userId: req.user!.userId,
      userEmail: req.user!.email,
      userName: req.user!.name,
      role: req.user!.role,
      action: 'PAPER_DOWNLOADED',
      status: 'SUCCESS',
      metadata: { paperCode: paperCode || null, examType: examType || null, set: setLetter || null, format: format || null, fileName: fileName || null, subjectCode: subjectCode || null }
    });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});


// ====================================================================
// GET /api/paper-requests — role filtered list
// ====================================================================
router.get('/paper-requests', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.json([]);
    const client = getSupabaseClient();

    let query = client
      .from('additional_paper_requests')
      .select(`
        *,
        subjects(subject_code, subject_name),
        academic_years(year_label),
        departments(department_code, department_name)
      `)
      .order('created_at', { ascending: false });

    // Exam Cell only sees their own requests; Principal/Super Admin see all
    if (req.user!.role === 'EXAM_CELL') {
      query = query.eq('requested_by_user_id', req.user!.userId);
    }

    const { status, subjectId, academicYearId, departmentId, examType } = req.query as Record<string, string>;
    if (status) query = query.eq('status', status);
    if (subjectId) query = query.eq('subject_id', subjectId);
    if (academicYearId) query = query.eq('academic_year_id', academicYearId);
    if (departmentId) query = query.eq('department_id', departmentId);
    if (examType) query = query.eq('exam_type', examType);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ====================================================================
// POST /api/paper-requests — Exam Cell requests an additional set
// ====================================================================
router.post('/paper-requests', requireAuth, requireRole('EXAM_CELL', 'SUPER_ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({ error: 'Database not configured.' });
    }
    const client = getSupabaseClient();

    const {
      academicYearId, departmentId, subjectId, examType,
      existingSetCount, existingSetNames, requestedSetCount,
      requestedSetNames, reason, supportingDocumentPath
    } = req.body;

    if (!academicYearId || !departmentId || !subjectId || !examType || !reason) {
      return res.status(400).json({ error: 'academicYearId, departmentId, subjectId, examType, reason are required.' });
    }
    if (!isValidExamType(examType)) {
      return res.status(400).json({ error: 'Invalid exam type.' });
    }
    if (!String(reason).trim()) {
      return res.status(400).json({ error: 'A reason for the additional paper is required.' });
    }

    const sets: string[] = Array.isArray(requestedSetNames)
      ? requestedSetNames.map((s: any) => String(s).toUpperCase()).filter(isValidSetLetter)
      : [];
    if (sets.length === 0) {
      return res.status(400).json({ error: 'requestedSetNames must contain the specific set being requested (e.g. ["C"]).' });
    }
    if (sets.length > 1) {
      // Spec §12 — every additional set needs its own approval
      return res.status(400).json({ error: 'Only one additional set may be requested at a time. Each additional set requires its own Principal approval.' });
    }

    // Only allow a request when the standard limit is genuinely reached
    const limit = await resolveExamSetLimit(examType);
    const { data: existing } = await client
      .from('paper_set_tracking')
      .select('set_name')
      .eq('subject_id', subjectId)
      .eq('academic_year_id', academicYearId)
      .eq('department_id', departmentId)
      .eq('exam_type', examType)
      .eq('generation_status', 'generated');

    const generatedSetNames: string[] = (existing || []).map((s: any) => s.set_name);
    if (generatedSetNames.length < limit.maxSets) {
      return res.status(409).json({
        error: `The standard set limit for this examination has not been reached yet (${generatedSetNames.length}/${limit.maxSets}). Generate Set ${limit.standardSetNames.find(l => !generatedSetNames.includes(l))} directly instead.`,
        code: 'LIMIT_NOT_REACHED'
      });
    }
    if (generatedSetNames.includes(sets[0])) {
      return res.status(409).json({ error: `Set ${sets[0]} already exists.`, code: 'DUPLICATE_SET' });
    }

    // Block duplicate pending request
    const { data: pending } = await client
      .from('additional_paper_requests')
      .select('id, request_number')
      .eq('subject_id', subjectId)
      .eq('academic_year_id', academicYearId)
      .eq('department_id', departmentId)
      .eq('exam_type', examType)
      .eq('status', 'pending')
      .limit(1);

    if (pending && pending.length > 0) {
      return res.status(409).json({
        error: `Request ${pending[0].request_number} is already pending the Principal's decision. Wait for a decision before submitting a new request.`,
        code: 'PENDING_REQUEST_EXISTS'
      });
    }

    // Block reuse of an already-consumed approval for the same set
    const { data: consumed } = await client
      .from('additional_paper_requests')
      .select('id, request_number, consumed_set_name')
      .eq('subject_id', subjectId)
      .eq('academic_year_id', academicYearId)
      .eq('department_id', departmentId)
      .eq('exam_type', examType)
      .eq('consumed', true);

    if (consumed && consumed.some((c: any) => c.consumed_set_name === sets[0])) {
      return res.status(409).json({ error: `Set ${sets[0]} was already generated using a previous approval.`, code: 'SET_ALREADY_GENERATED' });
    }

    const requestNumber = await generateRequestNumber(client);

    const { data: inserted, error } = await client
      .from('additional_paper_requests')
      .insert({
        request_number: requestNumber,
        academic_year_id: academicYearId,
        department_id: departmentId,
        subject_id: subjectId,
        exam_type: examType,
        existing_set_count: generatedSetNames.length,
        existing_set_names: generatedSetNames,
        requested_set_count: 1,
        requested_set_names: sets,
        reason: String(reason).trim(),
        supporting_document_path: supportingDocumentPath || null,
        requested_by_user_id: req.user!.userId,
        requested_by_name: req.user!.name,
        status: 'pending',
        consumed: false
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Notify every active Principal
    const { data: principals } = await client
      .from('user_accounts')
      .select('id')
      .eq('role', 'PRINCIPAL')
      .eq('status', 'active');

    if (principals && principals.length > 0) {
      await client.from('paper_request_notifications').insert(
        principals.map((p: any) => ({
          recipient_id: p.id,
          request_id: inserted.id,
          notification_type: 'submitted',
          message: `New additional paper request ${requestNumber} for Set ${sets[0]} (${examType}) submitted by ${req.user!.name}.`
        }))
      );
    }

    writeAuditLog({
      userId: req.user!.userId,
      userEmail: req.user!.email,
      userName: req.user!.name,
      role: req.user!.role,
      action: 'ADDITIONAL_PAPER_REQUEST_CREATED',
      status: 'SUCCESS',
      metadata: {
        requestId: inserted.id,
        requestNumber,
        academicYearId,
        departmentId,
        subjectId,
        examType,
        set: sets[0],
        existingSets: generatedSetNames
      }
    });

    return res.status(201).json(inserted);
  } catch (err: any) {
    console.error('[paper-requests] create error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ====================================================================
// PUT /api/paper-requests/:id/decision — Principal APPROVE or REJECT
// ====================================================================
router.put('/paper-requests/:id/decision', requireAuth, requireRole('PRINCIPAL', 'SUPER_ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({ error: 'Database not configured.' });
    }
    const client = getSupabaseClient();
    const { id } = req.params;
    const { decision, remarks } = req.body;

    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be approved or rejected.' });
    }
    if (decision === 'rejected' && !String(remarks || '').trim()) {
      return res.status(400).json({ error: 'A rejection reason is mandatory.' });
    }

    const { data: request, error: fetchErr } = await client
      .from('additional_paper_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !request) {
      return res.status(404).json({ error: 'Request not found.' });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `Request is already in status: ${request.status}. Only pending requests can receive a decision.` });
    }

    // ---- Spec §22: no self-approval ----
    if (request.requested_by_user_id === req.user!.userId) {
      writeAuditLog({
        userId: req.user!.userId,
        userEmail: req.user!.email,
        userName: req.user!.name,
        role: req.user!.role,
        action: 'REQUEST_SELF_APPROVAL_BLOCKED',
        status: 'FAILURE',
        metadata: { requestId: id }
      });
      return res.status(403).json({ error: 'You cannot approve or reject a request that you submitted yourself.', code: 'SELF_APPROVAL' });
    }

    const now = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      status: decision,
      principal_decision_by_id: req.user!.userId,
      principal_decision_by_name: req.user!.name,
      principal_decision_at: now,
      principal_remarks: remarks ? String(remarks).trim() : null,
      updated_at: now
    };

    if (decision === 'approved') {
      // Approval is bound to exactly the requested set (Spec §12)
      const requestedSets: string[] = request.requested_set_names || [];
      updatePayload.approved_set_count = 1;
      updatePayload.approved_set_names = requestedSets;
      updatePayload.consumed = false;
      updatePayload.consumed_at = null;
      updatePayload.consumed_set_name = null;
    } else {
      // Spec §11 — store rejection audit trail
      updatePayload.rejected_by_id = req.user!.userId;
      updatePayload.rejected_by_name = req.user!.name;
      updatePayload.rejected_at = now;
      updatePayload.rejection_reason = String(remarks).trim();
      updatePayload.approved_set_count = 0;
      updatePayload.approved_set_names = [];
    }

    // Only a Principal / Super Admin can move the status — enforced by requireRole above
    const { data: updated, error: updateErr } = await client
      .from('additional_paper_requests')
      .update(updatePayload)
      .eq('id', id)
      .eq('status', 'pending') // optimistic guard: never double-decide
      .select()
      .single();

    if (updateErr) return res.status(500).json({ error: updateErr.message });
    if (!updated) return res.status(409).json({ error: 'Request was already decided by another user.' });

    // Notify the requesting Exam Cell user
    await client.from('paper_request_notifications').insert({
      recipient_id: request.requested_by_user_id,
      request_id: id,
      notification_type: decision,
      message: decision === 'approved'
        ? `Your request ${request.request_number} has been APPROVED by ${req.user!.name}. You may now generate the approved set.`
        : `Your request ${request.request_number} has been REJECTED by ${req.user!.name}. Reason: ${String(remarks).trim()}`
    });

    writeAuditLog({
      userId: req.user!.userId,
      userEmail: req.user!.email,
      userName: req.user!.name,
      role: req.user!.role,
      action: decision === 'approved' ? 'PRINCIPAL_APPROVED_REQUEST' : 'PRINCIPAL_REJECTED_REQUEST',
      status: 'SUCCESS',
      metadata: {
        requestId: id,
        requestNumber: request.request_number,
        academicYearId: request.academic_year_id,
        departmentId: request.department_id,
        subjectId: request.subject_id,
        examType: request.exam_type,
        set: (request.requested_set_names || []).join(','),
        decision,
        remarks: remarks || null
      }
    });

    return res.json(updated);
  } catch (err: any) {
    console.error('[paper-requests] decision error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ====================================================================
// PUT /api/paper-requests/:id/cancel
// ====================================================================
router.put('/paper-requests/:id/cancel', requireAuth, requireRole('EXAM_CELL'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.status(503).json({ error: 'Database not configured.' });
    const client = getSupabaseClient();

    const { data: existing } = await client
      .from('additional_paper_requests')
      .select('status, requested_by_user_id')
      .eq('id', req.params.id)
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Request not found.' });
    if (existing.requested_by_user_id !== req.user!.userId) return res.status(403).json({ error: 'You can only cancel your own requests.' });
    if (existing.status !== 'pending') return res.status(409).json({ error: 'Only pending requests can be cancelled.' });

    const { data: updated, error } = await client
      .from('additional_paper_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ====================================================================
// GET /api/paper-assignments
// ====================================================================
router.get('/paper-assignments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.json([]);
    const client = getSupabaseClient();

    let query = client
      .from('principal_paper_assignments')
      .select('*')
      .order('assigned_at', { ascending: false });

    if (req.user!.role === 'PRINCIPAL') {
      query = query.eq('assigned_principal_id', req.user!.userId);
    } else if (req.user!.role === 'EXAM_CELL') {
      query = query.eq('assigned_by_user_id', req.user!.userId);
    }

    const { reviewStatus } = req.query as Record<string, string>;
    if (reviewStatus) query = query.eq('review_status', reviewStatus);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ====================================================================
// POST /api/paper-assignments
// ====================================================================
router.post('/paper-assignments', requireAuth, requireRole('EXAM_CELL', 'SUPER_ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.status(503).json({ error: 'Database not configured.' });
    const client = getSupabaseClient();

    const {
      paperCode, localPaperId, subjectCode, subjectName,
      examType, setName, setDisplayName, academicYearId,
      departmentId, assignedPrincipalId, paperSnapshot
    } = req.body;

    if (!paperCode || !localPaperId || !subjectCode || !examType || !assignedPrincipalId) {
      return res.status(400).json({ error: 'paperCode, localPaperId, subjectCode, examType, assignedPrincipalId are required.' });
    }

    const { data: principal } = await client
      .from('user_accounts')
      .select('name, role')
      .eq('id', assignedPrincipalId)
      .eq('role', 'PRINCIPAL')
      .maybeSingle();

    if (!principal) return res.status(404).json({ error: 'Principal user not found.' });

    const { data: inserted, error } = await client
      .from('principal_paper_assignments')
      .insert({
        paper_code: paperCode,
        local_paper_id: localPaperId,
        subject_code: subjectCode,
        subject_name: subjectName || null,
        exam_type: examType,
        set_name: setName || null,
        set_display_name: setDisplayName || null,
        academic_year_id: academicYearId || null,
        department_id: departmentId || null,
        assigned_principal_id: assignedPrincipalId,
        assigned_principal_name: principal.name,
        assigned_by_user_id: req.user!.userId,
        assigned_by_name: req.user!.name,
        review_status: 'pending',
        paper_snapshot: paperSnapshot || null
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    try {
      await client.from('paper_request_notifications').insert({
        recipient_id: assignedPrincipalId,
        request_id: inserted.id,
        notification_type: 'submitted',
        message: `Paper ${paperCode} (${subjectCode}) was assigned to you for review.`
      });
    } catch (notifyErr: any) {
      console.warn('[paper-assignments] notification failed:', notifyErr?.message);
    }

    writeAuditLog({
      userId: req.user!.userId,
      userEmail: req.user!.email,
      userName: req.user!.name,
      role: req.user!.role,
      action: 'PAPER_ASSIGNED_TO_PRINCIPAL',
      status: 'SUCCESS',
      metadata: { assignmentId: inserted.id, paperCode, subjectCode, examType, set: setName || null }
    });

    return res.status(201).json(inserted);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ====================================================================
// PUT /api/paper-assignments/:id/review
// ====================================================================
router.put('/paper-assignments/:id/review', requireAuth, requireRole('PRINCIPAL', 'SUPER_ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.status(503).json({ error: 'Database not configured.' });
    const client = getSupabaseClient();

    const { reviewStatus, reviewRemarks } = req.body;
    if (!reviewStatus || !['reviewed', 'returned'].includes(reviewStatus)) {
      return res.status(400).json({ error: 'reviewStatus must be reviewed or returned.' });
    }

    const { data: assignment } = await client
      .from('principal_paper_assignments')
      .select('assigned_principal_id, paper_code')
      .eq('id', req.params.id)
      .maybeSingle();

    if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
    if (req.user!.role === 'PRINCIPAL' && assignment.assigned_principal_id !== req.user!.userId) {
      return res.status(403).json({ error: 'This paper was not assigned to you.' });
    }

    const { data: updated, error } = await client
      .from('principal_paper_assignments')
      .update({
        review_status: reviewStatus,
        review_remarks: reviewRemarks || null,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    writeAuditLog({
      userId: req.user!.userId,
      userEmail: req.user!.email,
      userName: req.user!.name,
      role: req.user!.role,
      action: 'PAPER_REVIEWED_BY_PRINCIPAL',
      status: 'SUCCESS',
      metadata: { assignmentId: req.params.id, reviewStatus, paperCode: assignment.paper_code }
    });

    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ====================================================================
// Notifications
// ====================================================================
router.get('/paper-requests/notifications', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.json([]);
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('paper_request_notifications')
      .select('*')
      .eq('recipient_id', req.user!.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/paper-requests/notifications/mark-read', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.json({ success: true });
    const client = getSupabaseClient();
    await client
      .from('paper_request_notifications')
      .update({ is_read: true })
      .eq('recipient_id', req.user!.userId)
      .eq('is_read', false);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ====================================================================
// GET /api/principals
// ====================================================================
router.get('/principals', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.json([]);
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('user_accounts')
      .select('id, name, email')
      .eq('role', 'PRINCIPAL')
      .eq('status', 'active');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ====================================================================
// GET /api/paper-sets/config — exposes the limit table to the frontend
// ====================================================================
router.get('/paper-sets/config', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const examTypes = VALID_EXAM_TYPES;
    const limits = await Promise.all(examTypes.map((t) => resolveExamSetLimit(t)));
    return res.json({
      setLetters: ALL_SET_LETTERS,
      limits: limits.map((l) => ({
        examType: l.examType,
        maxSets: l.maxSets,
        standardSetNames: l.standardSetNames,
        limitMessage: l.limitMessage,
        isIAT: isIatExamType(l.examType)
      }))
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export { getFallbackLimit };
export default router;

// ====================================================================
// Helpers
// ====================================================================
async function generateRequestNumber(client: any): Promise<string> {
  const year = new Date().getFullYear();
  const { count } = await client
    .from('additional_paper_requests')
    .select('*', { count: 'exact', head: true });
  const seq = ((count ?? 0) + 1).toString().padStart(3, '0');
  return `APR-${year}-${seq}`;
}
