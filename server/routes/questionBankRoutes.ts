import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { extractQuestionsWithGemini, mapToOcrFormat } from '../services/geminiQuestionBankService';
import {
  isSupabaseConfigured,
  getSupabaseClient,
  uploadPdfToStorage,
  createQuestionBank,
  insertExtractedQuestions,
  saveApprovedQuestions,
  updateQuestionBankStatus,
  verifySupabaseTables,
  getQuestionBankCount,
  getQuestionBanks
} from '../services/supabaseQuestionBankService';
import { checkGeminiConfig } from '../services/geminiConfig';
import { writeAuditLog, AUDIT_ACTIONS } from '../services/auditService';

const router = express.Router();

// Use memory storage — buffer is passed directly to Gemini and Supabase
// PDF only — images and other formats are not accepted
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50 MB max
  },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are supported. Please upload a .pdf question bank.'));
    }
  }
});

/**
 * GET /api/health
 * Liveness probe — confirms backend is running and shared env vars are loaded.
 */
router.get('/health', async (_req: Request, res: Response) => {
  const supabaseOk = isSupabaseConfigured();
  const gemini = checkGeminiConfig();
  let tablesOk = false;
  let missingTables: string[] = [];

  if (supabaseOk) {
    try {
      const check = await verifySupabaseTables();
      tablesOk = check.ok;
      missingTables = check.missingTables;
    } catch {
      tablesOk = false;
    }
  }

  res.json({
    status: gemini.configured ? 'ok' : 'configuration_error',
    geminiConfigured: gemini.configured,
    geminiStatus: gemini.status,
    geminiMessage: gemini.message,
    supabaseConfigured: supabaseOk,
    supabaseTablesReady: tablesOk,
    missingTables: missingTables.length > 0 ? missingTables : undefined,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/question-banks/count
 * Returns total count of question banks stored in Supabase
 */
router.get('/question-banks/count', async (_req: Request, res: Response) => {
  try {
    const count = await getQuestionBankCount();
    res.json({ count });
  } catch {
    res.json({ count: 0 });
  }
});

/**
 * GET /api/question-banks
 * Returns question banks with optional academicYear, department, subjectCode filters
 */
router.get('/question-banks', async (req: Request, res: Response) => {
  try {
    const { academicYear, department, subjectCode } = req.query as {
      academicYear?: string;
      department?: string;
      subjectCode?: string;
    };
    const banks = await getQuestionBanks({ academicYear, department, subjectCode });
    res.json({ success: true, questionBanks: banks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch question banks' });
  }
});

/**
 * Normalizes subject codes for comparison (removes dashes, spaces, case insensitive)
 */
function normalizeCode(code: string): string {
  return (code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * POST /api/question-banks/extract
 * Extraction flow:
 *   PDF upload
 *   ↓
 *   Gemini extraction
 *   ↓
 *   Validate structured questions & Subject Code Mismatch check
 *   ↓
 *   Create question_bank record in Supabase (with document-derived subject code)
 *   ↓
 *   Store all extracted questions in Supabase (with document-derived subject code)
 *   ↓
 *   Return extracted questions to frontend with mismatch details if present
 */
router.post(
  '/question-banks/extract',
  upload.single('file'),
  async (req: Request, res: Response, _next: NextFunction) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded. Include a PDF as "file" in FormData.' });
      }

      const selectedSubjectCode = (req.body.subjectCode || '').trim();
      const academicYear = (req.body.academicYear || '').trim();
      const department = (req.body.department || '').trim();
      const uploadedBy = (req.body.uploadedBy || 'Exam Cell').trim();
      const fileName = req.file.originalname;

      if (!selectedSubjectCode) {
        return res.status(400).json({ error: 'subjectCode is required in the request body.' });
      }

      const gemini = checkGeminiConfig();
      if (!gemini.configured) {
        return res.status(503).json({
          success: false,
          error: gemini.message,
          configurationError: true,
          service: 'gemini'
        });
      }

      console.log(`[Extract] Processing: "${fileName}" for subject: ${selectedSubjectCode} (Year: ${academicYear}, Dept: ${department})`);

      // Step 1: Gemini extraction
      const geminiResult = await extractQuestionsWithGemini(req.file.buffer, fileName);

      // Step 2: Validate Document Subject vs Frontend Selected Subject
      const docSubjectCode = (geminiResult.document.subjectCode || '').trim();
      const docSubjectName = (geminiResult.document.subjectName || '').trim();

      const isMismatch = !!(
        docSubjectCode &&
        selectedSubjectCode &&
        normalizeCode(selectedSubjectCode) !== normalizeCode(docSubjectCode)
      );

      if (isMismatch) {
        console.warn(`[Subject Validation] Mismatch detected:`);
        console.warn(`  Selected Subject: ${selectedSubjectCode}`);
        console.warn(`  Document Subject: ${docSubjectCode}`);
        console.warn(`  Document Name:    ${docSubjectName}`);
        console.warn(`[Subject Validation] Using teacher-selected subject "${selectedSubjectCode}" as source of truth.`);
      } else {
        console.log(`[Subject Validation] Subject code verified: ${selectedSubjectCode || docSubjectCode}`);
      }

      // Teacher's UI selection is the source of truth — document-derived code is fallback only
      const effectiveSubjectCode = selectedSubjectCode || docSubjectCode;
      const effectiveSubjectName = (req.body.subjectName || '').trim() || docSubjectName || selectedSubjectCode || 'Unknown Subject';

      // Step 3: Validate and map structured questions
      const { metadata, questions } = mapToOcrFormat(geminiResult, effectiveSubjectCode, fileName);

      let questionBankId: string | null = null;
      let storagePath: string | null = null;
      let persistedQuestionCount = 0;
      let persistenceError: string | null = null;

      // Step 4: Supabase persistence (non-fatal — questions are always returned to frontend)
      if (isSupabaseConfigured()) {
        console.log('[Supabase] Configured');
        questionBankId = uuidv4();

        try {
          // 4a. Storage upload (PDF file) — path: {subjectCode}/{questionBankId}/{safeFileName}
          const uploadResult = await uploadPdfToStorage(
            req.file.buffer,
            fileName,
            effectiveSubjectCode,
            questionBankId
          );
          storagePath = uploadResult.path;
        } catch (storageErr: any) {
          console.warn('[Supabase] PDF storage upload failed (non-fatal):', storageErr?.message || storageErr);
        }

        try {
          // 4b. Create question_bank record in Supabase
          await createQuestionBank({
            id: questionBankId,
            subject_code: effectiveSubjectCode,
            subject_name: effectiveSubjectName,
            file_name: fileName,
            file_size_bytes: req.file.size,
            total_pages: metadata.totalPages,
            total_units: metadata.totalUnitsDetected,
            regulation: metadata.regulation,
            storage_path: storagePath,
            uploaded_by: uploadedBy,
            status: 'pending_review',
            academic_year: academicYear || null,
            department: department || null
          });

          // 4c. Store all extracted questions in Supabase (with status 'Draft')
          persistedQuestionCount = await insertExtractedQuestions(
            questionBankId,
            effectiveSubjectCode,
            questions
          );
        } catch (dbErr: any) {
          persistenceError = dbErr?.message || String(dbErr);
          console.warn('[Supabase] Database persistence failed (non-fatal):', persistenceError);
          console.warn('[Supabase] Extracted questions will still be returned to the frontend.');
          console.warn('[Supabase] To fix RLS (42501): Use the secret service_role key (starts with "eyJ") from Supabase Dashboard > Project Settings > API.');
          // Keep questionBankId so frontend can still reference it locally
        }

        // Spec §27 — audit the ORIGINAL question bank upload. This is the
        // source bank that IAT reductions are later generated from.
        await writeAuditLog({
          userEmail: uploadedBy.toLowerCase().includes('@') ? uploadedBy : 'exam-cell@msajce-edu.in',
          userName: uploadedBy,
          role: 'EXAM_CELL',
          action: AUDIT_ACTIONS.QUESTION_BANK_UPLOADED,
          status: persistenceError ? 'FAILURE' : 'SUCCESS',
          metadata: {
            academic_year: academicYear || null,
            department: department || null,
            subject_code: effectiveSubjectCode,
            subject_name: effectiveSubjectName,
            source_question_bank_id: questionBankId,
            file_name: fileName,
            total_questions: questions.length,
            persisted_questions: persistedQuestionCount,
            bank_type: 'ORIGINAL',
            storage_path: storagePath,
            error: persistenceError
          }
        });
      } else {
        console.log('[Extract] Supabase not configured in .env — skipping database persistence.');
      }

      // Step 5: Return extracted questions to frontend
      return res.json({
        success: true,
        questionBankId,
        subjectMismatch: isMismatch ? {
          isMismatch: true,
          selectedSubjectCode,
          documentSubjectCode: docSubjectCode,
          documentSubjectName: effectiveSubjectName,
          message: `Selected Subject: ${selectedSubjectCode}\nDocument Subject: ${docSubjectCode}\nDocument Name: ${effectiveSubjectName}`
        } : null,
        metadata: {
          ...metadata,
          subjectCode: effectiveSubjectCode,
          subjectName: effectiveSubjectName,
          selectedSubjectCode,
          documentSubjectCode: docSubjectCode,
          documentSubjectName: effectiveSubjectName,
          isSubjectMismatch: isMismatch,
          questionBankId: questionBankId || undefined,
          storagePath: storagePath || undefined,
          storageArchived: !!storagePath
        },
        questions,
        stats: {
          total: questions.length,
          partA: questions.filter((q: any) => q.part === 'A').length,
          partB: questions.filter((q: any) => q.part === 'B').length,
          partC: questions.filter((q: any) => q.part === 'C').length,
          approved: questions.filter((q: any) => q.status === 'Approved').length,
          needsReview: questions.filter((q: any) => q.status === 'Needs Review').length,
          lowConfidence: questions.filter((q: any) => q.status === 'Low Confidence').length
        }
      });
    } catch (err: any) {
      console.error('[Extract] Fatal error:', err?.message || err);
      return res.status(500).json({
        error: err?.message || 'Extraction failed. Check server logs.',
        success: false
      });
    }
  }
);

/**
 * POST /api/question-banks/:id/approve
 * Called when teacher clicks "Add to Question Bank".
 * Updates the questions in Supabase to status 'Approved' and sets bank status to 'approved'.
 *
 * Body: { subjectCode: string, questions: OcrExtractedQuestion[] }
 */
router.post('/question-banks/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id: bankId } = req.params;
    const { subjectCode, questions } = req.body;

    if (!bankId || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'bankId and questions[] are required.' });
    }

    if (!isSupabaseConfigured()) {
      return res.json({
        success: true,
        message: 'Supabase not configured — questions saved to local state only.',
        savedCount: questions.length
      });
    }

    let targetSubjectCode = (subjectCode || '').trim();
    if (!targetSubjectCode) {
      const client = getSupabaseClient();
      const { data: bank } = await client.from('question_banks').select('subject_code').eq('id', bankId).single();
      if (bank?.subject_code) {
        targetSubjectCode = bank.subject_code;
      }
    }

    const savedCount = await saveApprovedQuestions(bankId, targetSubjectCode, questions);

    return res.json({
      success: true,
      message: `${savedCount} questions approved and saved to database successfully.`,
      savedCount,
      bankId
    });
  } catch (err: any) {
    console.error('[Approve] Error:', err?.message || err);
    return res.status(500).json({
      error: err?.message || 'Failed to save approved questions.',
      success: false
    });
  }
});

export default router;
