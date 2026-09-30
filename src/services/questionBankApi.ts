/**
 * Frontend API service for Question Bank extraction.
 * All requests go to /api/* which is proxied to the Express backend (port 4000) by Vite.
 * NO API keys or secrets here — everything stays server-side.
 */

export interface SubjectMismatchInfo {
  isMismatch: boolean;
  selectedSubjectCode: string;
  documentSubjectCode: string;
  documentSubjectName: string;
  message: string;
}

export interface ExtractionResponse {
  success: boolean;
  questionBankId: string | null;
  subjectMismatch?: SubjectMismatchInfo | null;
  metadata: {
    subjectName?: string;
    subjectCode?: string;
    department?: string;
    regulation?: string;
    semester?: string;
    totalUnitsDetected: number;
    totalPages: number;
    fileName?: string;
    fileSize?: string;
    isScannedImageOnly: boolean;
    questionBankId?: string;
    // Subject mismatch fields from backend
    selectedSubjectCode?: string;
    documentSubjectCode?: string;
    documentSubjectName?: string;
    isSubjectMismatch?: boolean;
    storagePath?: string;
    storageArchived?: boolean;
  };
  questions: any[]; // OcrExtractedQuestion[] — typed at usage site
  stats: {
    total: number;
    partA: number;
    partB: number;
    partC: number;
    approved: number;
    needsReview: number;
    lowConfidence: number;
  };
  error?: string;
  /** Backend-confirmed Gemini status, used to pick the right user wording. */
  geminiStatus?: string;
  errorCode?: string;
}

export interface ApprovalResponse {
  success: boolean;
  message: string;
  savedCount: number;
  bankId?: string;
  error?: string;
}

/**
 * Maps a backend-confirmed Gemini status to the exact user-facing wording.
 * An "authentication failed" message is only ever shown when the backend
 * actually reports geminiStatus === 'authentication_failed'.
 */
export function geminiStatusMessage(status: string | undefined): string | null {
  switch (status) {
    case 'authentication_failed':
      return 'Gemini authentication failed on the server. Please contact the administrator.';
    case 'permission_denied':
      return 'Gemini access was denied on the server. Please contact the administrator.';
    case 'model_unavailable':
      return 'Gemini model is currently unavailable. Please contact the administrator.';
    case 'rate_limited':
      return 'Gemini API rate limit reached. Please try again later.';
    case 'service_unavailable':
      return 'Gemini service is temporarily unavailable. Please try again later.';
    case 'not_configured':
      return 'Gemini extraction is not configured on the server. Please contact the administrator.';
    default:
      return null;
  }
}

/**
 * Sends a PDF/image file to the backend for Gemini extraction.
 * Returns the extracted questions and document metadata.
 *
 * @param file - The PDF or image file to extract from
 * @param subjectCode - The target subject code (e.g. "24AM411")
 * @param uploadedBy - Name of the uploader (optional)
 * @param onProgress - Optional callback for progress updates (0–100)
 */
export async function extractQuestionBank(
  file: File,
  subjectCode: string,
  uploadedBy?: string,
  onProgress?: (stage: string, percent: number) => void,
  academicYear?: string,
  department?: string
): Promise<ExtractionResponse> {
  onProgress?.('Uploading question bank to server...', 10);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('subjectCode', subjectCode);
  if (uploadedBy) formData.append('uploadedBy', uploadedBy);
  if (academicYear) formData.append('academicYear', academicYear);
  if (department) formData.append('department', department);

  onProgress?.('Sending document to Gemini AI...', 25);

  let response: Response;
  try {
    response = await fetch('/api/question-banks/extract', {
      method: 'POST',
      body: formData
      // Do NOT set Content-Type header — browser sets it with boundary for multipart
    });
  } catch (networkErr: any) {
    throw new Error(
      `Cannot reach the extraction server. Please ensure the backend is running:\n  npm run server\n\nError: ${networkErr?.message}`
    );
  }

  onProgress?.('Processing Gemini AI response...', 75);

  let result: ExtractionResponse;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Server returned an unexpected response (HTTP ${response.status}). Check backend logs.`);
  }

  if (!response.ok || !result.success) {
    // Prefer the status-derived wording so the message always matches what the
    // backend actually confirmed, and never leak a raw Google API error.
    const mapped = geminiStatusMessage(result.geminiStatus);
    throw new Error(
      mapped || result.error || `Extraction failed (HTTP ${response.status})`
    );
  }

  onProgress?.('Preparing teacher review interface...', 95);

  return result;
}

/**
 * Saves the teacher-approved questions to Supabase via the backend.
 * Called when the teacher clicks "Add to Question Bank".
 * Falls back gracefully if Supabase is not configured.
 *
 * @param bankId - The questionBankId returned from extractQuestionBank()
 * @param subjectCode - The subject code
 * @param questions - The approved OcrExtractedQuestion objects
 */
export async function approveQuestionBank(
  bankId: string,
  subjectCode: string,
  questions: any[]
): Promise<ApprovalResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/question-banks/${bankId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectCode, questions })
    });
  } catch (networkErr: any) {
    // Non-fatal — AppContext.addQuestions() is the primary save mechanism
    console.warn('[QuestionBankApi] Supabase save failed (non-fatal):', networkErr?.message);
    return {
      success: false,
      message: 'Backend unavailable — questions saved to local state only.',
      savedCount: 0
    };
  }

  try {
    const result: ApprovalResponse = await response.json();
    return result;
  } catch {
    return {
      success: false,
      message: 'Unexpected server response during approval.',
      savedCount: 0
    };
  }
}

/**
 * Checks if the backend is running and configured.
 *
 * `geminiConfigured` only means the key exists in the server environment.
 * `geminiAuthenticated` means a real Gemini API request succeeded.
 */
export async function checkBackendHealth(): Promise<{
  running: boolean;
  geminiConfigured: boolean;
  geminiAuthenticated: boolean;
  geminiModelAvailable: boolean;
  geminiStatus?: string;
  geminiMessage?: string;
  supabaseConfigured: boolean;
}> {
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      return {
        running: false,
        geminiConfigured: false,
        geminiAuthenticated: false,
        geminiModelAvailable: false,
        supabaseConfigured: false
      };
    }
    const data = await response.json();
    return {
      // "degraded" still means the API is up and answering.
      running: data.status === 'ok' || data.status === 'degraded' || data.status === 'configuration_error',
      geminiConfigured: !!data.geminiConfigured,
      geminiAuthenticated: !!data.geminiAuthenticated,
      geminiModelAvailable: !!data.geminiModelAvailable,
      geminiStatus: data.geminiStatus,
      geminiMessage: data.geminiMessage,
      supabaseConfigured: !!data.supabaseConfigured
    };
  } catch {
    return {
      running: false,
      geminiConfigured: false,
      geminiAuthenticated: false,
      geminiModelAvailable: false,
      supabaseConfigured: false
    };
  }
}
