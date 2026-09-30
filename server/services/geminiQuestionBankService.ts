import { EXTRACTION_PROMPT, EXTRACTION_RESPONSE_SCHEMA } from '../schemas/questionBankSchema';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import {
  GeminiServiceError,
  classifyGeminiError,
  getActiveGeminiModel,
  getGeminiClient,
  getGeminiModelCandidates,
  isGeminiAuthError,
  logGeminiFailure,
  requireGeminiApiKey,
  sanitizeForLog
} from './gemini';

interface GeminiExtractedQuestion {
  questionNumber?: string;
  questionText: string;
  unit: number;
  unitTitle?: string;
  part: 'A' | 'B' | 'C' | 'Unknown';
  marks: number;
  markBreakdown?: string;
  btl?: string;
  co?: string;
  pi?: string;
  topic?: string;
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  isOrQuestion?: boolean;
  orGroupId?: string;
  orOption?: 'A' | 'B' | 'C';
  subQuestions?: string[];
  ocrConfidence: number;
  sourcePage: number;
  sourcePageEnd?: number;
}

interface GeminiDocumentMetadata {
  subjectName: string;
  subjectCode: string;
  department?: string;
  regulation?: string;
  semester?: string;
  totalUnitsDetected: number;
  totalPages: number;
  isScannedImageOnly: boolean;
}

export interface GeminiExtractionResult {
  document: GeminiDocumentMetadata;
  questions: GeminiExtractedQuestion[];
}

/**
 * Maps BTL values from Gemini (L1–L6 or K1–K6 or full word) to BloomsLevel enum
 */
function normalizeBloomsLevel(btl: string | undefined | null): string {
  if (!btl) return 'K2';
  const upper = btl.trim().toUpperCase();
  // Already K-format
  if (/^K[1-6]$/.test(upper)) return upper;
  // L-format → K-format
  if (/^L[1-6]$/.test(upper)) return `K${upper[1]}`;
  // Full word mapping
  const wordMap: Record<string, string> = {
    REMEMBER: 'K1', RECALL: 'K1', KNOWLEDGE: 'K1',
    UNDERSTAND: 'K2', COMPREHENSION: 'K2',
    APPLY: 'K3', APPLICATION: 'K3',
    ANALYZE: 'K4', ANALYSIS: 'K4',
    EVALUATE: 'K5', EVALUATION: 'K5',
    CREATE: 'K6', SYNTHESIS: 'K6'
  };
  for (const [word, level] of Object.entries(wordMap)) {
    if (upper.includes(word)) return level;
  }
  return 'K2';
}

/**
 * Normalizes difficulty from Gemini response or derives from BTL level
 */
function normalizeDifficulty(difficulty: string | undefined, btl: string | undefined): 'Easy' | 'Medium' | 'Hard' {
  if (difficulty === 'Easy' || difficulty === 'Medium' || difficulty === 'Hard') {
    return difficulty;
  }
  const bl = normalizeBloomsLevel(btl);
  const level = parseInt(bl[1]);
  if (level <= 2) return 'Easy';
  if (level <= 4) return 'Medium';
  return 'Hard';
}

/**
 * Normalizes marks — ensures Part A = 2, Part B = 13, Part C = 15
 */
function normalizeMarks(marks: number | undefined | null, part: string): number {
  if (marks && marks > 0) return marks;
  if (part === 'A') return 2;
  if (part === 'C') return 15;
  return 13;
}

/**
 * Attempts to recover a truncated JSON response from Gemini.
 * Finds the last fully-closed question object and closes the surrounding structure.
 */
function recoverTruncatedJson(raw: string): GeminiExtractionResult {
  // Find the last complete question object by locating the last "}," or "}" before the array closes
  const questionsStart = raw.indexOf('"questions"');
  if (questionsStart === -1) {
    throw new Error('Gemini returned invalid JSON and recovery failed: missing questions array.');
  }

  // Find the last complete object boundary — look for the last occurrence of "sourcePage"
  // (a required field) followed by a number and then a closing brace
  const lastCompleteMatch = [...raw.matchAll(/"sourcePage"\s*:\s*\d+[^}]*}/g)];
  if (lastCompleteMatch.length === 0) {
    throw new Error('Gemini returned invalid JSON and recovery could not find any complete questions.');
  }

  const lastMatch = lastCompleteMatch[lastCompleteMatch.length - 1];
  const cutPoint = (lastMatch.index ?? 0) + lastMatch[0].length;

  // Reconstruct: keep everything up to and including the last complete question, then close
  const recovered = raw.slice(0, cutPoint) + ']}';

  let result: GeminiExtractionResult;
  try {
    result = JSON.parse(recovered);
  } catch {
    throw new Error('Gemini returned invalid JSON. The PDF may be too large — try splitting it into smaller files.');
  }

  const recoveredCount = result.questions?.length ?? 0;
  console.warn(`[Gemini] Recovery succeeded — extracted ${recoveredCount} complete questions (response was truncated).`);
  return result;
}

/**
 * Main extraction function — calls Gemini with the PDF bytes and returns structured data.
 * All secrets stay server-side. Never called from the browser.
 */
export async function extractQuestionsWithGemini(
  pdfBuffer: Buffer,
  fileName: string
): Promise<GeminiExtractionResult> {
  requireGeminiApiKey();

  // Shared client + model list from the centralized Gemini service — the exact
  // same configuration that /api/health authenticates against.
  const ai = getGeminiClient();
  const base64Pdf = pdfBuffer.toString('base64');
  const activeModel = getActiveGeminiModel();

  console.log(`[Gemini] Extracting questions from "${sanitizeForLog(fileName)}" using model ${activeModel}...`);

  let rawResponse: string = '';

  // Same model list the health probe verified, with the verified model first.
  // When no probe has run yet, getActiveGeminiModel() is the configured model,
  // which is already first in the candidate list — so the original order holds.
  const candidateModels = Array.from(
    new Set([getActiveGeminiModel(), ...getGeminiModelCandidates()].filter(Boolean))
  ) as string[];

  let lastError: any = null;

  for (const modelName of candidateModels) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Gemini] Attempting extraction with model "${modelName}" (attempt ${attempt})...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: base64Pdf
                  }
                },
                {
                  text: EXTRACTION_PROMPT
                }
              ]
            }
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: EXTRACTION_RESPONSE_SCHEMA,
            temperature: 0.1,    // Low temperature for deterministic extraction
            maxOutputTokens: 65536 // Increased to handle large multi-unit question banks
          }
        });

        rawResponse = response.text ?? '';
        if (rawResponse && rawResponse.trim() !== '') {
          console.log(`[Gemini] Model "${modelName}" extraction succeeded.`);
          break; // Success!
        }
      } catch (err: any) {
        lastError = err;
        const category = classifyGeminiError(err);

        if (category === 'MODEL_NOT_FOUND') {
          console.warn(`[Gemini] Model "${modelName}" is unavailable or deprecated. Trying next candidate model...`);
          break; // Try next candidate model
        }

        if (isGeminiAuthError(err)) {
          // Log the category only — never the key, header or credentials.
          logGeminiFailure(`Extraction with model "${modelName}"`, err);
          throw new GeminiServiceError(category, `Gemini rejected the configured API key (${category}) on model ${modelName}.`, modelName);
        }

        console.warn(`[Gemini] Model "${modelName}" attempt ${attempt} failed: [${category}] ${sanitizeForLog(err?.message || err)}`);

        // If it's a 429 (rate limit) or 503 (high demand), pause briefly before retry
        if (
          category === 'RATE_LIMITED' ||
          category === 'QUOTA_EXCEEDED' ||
          category === 'SERVICE_UNAVAILABLE' ||
          category === 'NETWORK_ERROR'
        ) {
          console.log('[Gemini] Waiting 3 seconds before retrying...');
          await new Promise((resolve) => setTimeout(resolve, 3000));
        } else {
          // Non-retryable error for this model, try next model
          break;
        }
      }
    }

    if (rawResponse && rawResponse.trim() !== '') {
      break;
    }
  }

  if (!rawResponse || rawResponse.trim() === '') {
    // Every Gemini failure leaves here as a GeminiServiceError so the route can
    // return the exact status-derived wording (authentication_failed,
    // model_unavailable, rate_limited, service_unavailable, ...) instead of a
    // raw Google error.
    const category = classifyGeminiError(lastError);
    logGeminiFailure('Extraction', lastError);
    throw new GeminiServiceError(
      category,
      `Gemini extraction failed (${category}): ${sanitizeForLog(lastError?.message || 'Empty response')}.`
    );
  }

  if (!rawResponse || rawResponse.trim() === '') {
    throw new Error('Gemini returned an empty response. The PDF may be corrupted or unsupported.');
  }

  let parsed: GeminiExtractionResult;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    // Response was likely truncated mid-token. Attempt to recover by closing open structures.
    console.warn('[Gemini] JSON parse failed — response may be truncated. Attempting recovery...');
    parsed = recoverTruncatedJson(rawResponse);
  }

  if (!parsed.document || !Array.isArray(parsed.questions)) {
    throw new Error('Gemini response is missing required fields (document or questions array).');
  }

  // Normalize and enrich each question
  const normalized: GeminiExtractedQuestion[] = parsed.questions.map((q, idx) => ({
    ...q,
    questionNumber: q.questionNumber || String(idx + 1),
    part: (['A', 'B', 'C'].includes(q.part) ? q.part : 'Unknown') as 'A' | 'B' | 'C' | 'Unknown',
    marks: normalizeMarks(q.marks, q.part),
    difficulty: normalizeDifficulty(q.difficulty, q.btl),
    btl: q.btl || undefined,
    co: q.co || null,
    pi: q.pi || null,
    topic: q.topic || `Unit ${q.unit} Concept`,
    ocrConfidence: typeof q.ocrConfidence === 'number' ? Math.min(100, Math.max(0, q.ocrConfidence)) : 90,
    sourcePage: q.sourcePage || 1,
    orOption: (['A', 'B', 'C'].includes(q.orOption ?? '') ? q.orOption : undefined) as 'A' | 'B' | 'C' | undefined
  }));

  console.log(`[Gemini] Extracted ${normalized.length} questions from "${fileName}"`);
  console.log(`[Gemini] Subject: ${parsed.document.subjectCode} - ${parsed.document.subjectName}`);

  return {
    document: parsed.document,
    questions: normalized
  };
}

/**
 * Converts Gemini's extracted questions to the OcrExtractedQuestion format
 * used by the existing frontend review UI. This keeps the UI completely unchanged.
 */
export function mapToOcrFormat(
  geminiResult: GeminiExtractionResult,
  subjectCode: string,
  fileName: string
): { metadata: any; questions: any[] } {
  const { document: doc, questions } = geminiResult;

  const metadata = {
    subjectName: doc.subjectName || 'Unknown Subject',
    subjectCode: doc.subjectCode || subjectCode,
    department: doc.department || undefined,
    regulation: doc.regulation || 'R2021',
    semester: doc.semester || undefined,
    totalUnitsDetected: doc.totalUnitsDetected || 5,
    totalPages: doc.totalPages || 1,
    fileName,
    fileSize: 'N/A',
    isScannedImageOnly: doc.isScannedImageOnly || false
  };

  const ocrQuestions = questions.map((q, idx) => {
    const bloomsLevel = normalizeBloomsLevel(q.btl);
    let ocrStatus: 'Approved' | 'Needs Review' | 'Low Confidence' | 'Rejected' | 'Possible Duplicate';
    const conf = q.ocrConfidence;
    if (conf >= 90) ocrStatus = 'Approved';
    else if (conf >= 70) ocrStatus = 'Needs Review';
    else ocrStatus = 'Low Confidence';

    return {
      id: `gemini-${Date.now()}-${idx}`,
      subjectCode: subjectCode || doc.subjectCode || 'UNKNOWN',
      unit: q.unit || 1,
      unitTitle: q.unitTitle,
      part: q.part as 'A' | 'B' | 'C' | 'Unknown',
      questionNumber: q.questionNumber || String(idx + 1),
      questionText: q.questionText,
      marks: q.marks,
      markBreakdown: q.markBreakdown || null,
      bl: bloomsLevel,
      btl: q.btl || null,
      co: q.co || null,
      pi: q.pi || null,
      topic: q.topic || `Unit ${q.unit}`,
      difficulty: q.difficulty || 'Medium',
      isOrQuestion: q.isOrQuestion || false,
      orGroupId: q.orGroupId || undefined,
      orOption: (q.orOption || undefined) as 'A' | 'B' | 'C' | undefined,
      subQuestions: q.subQuestions || [],
      ocrConfidence: q.ocrConfidence,
      sourceDocument: fileName,
      sourcePage: q.sourcePage,
      sourcePageEnd: q.sourcePageEnd || null,
      status: ocrStatus,
      isEdited: false
    };
  });

  return { metadata, questions: ocrQuestions };
}
