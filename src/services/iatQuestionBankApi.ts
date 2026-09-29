/**
 * IAT Question Bank Generator — frontend API client.
 *
 * Every call carries the JWT bearer token. End Semester is never a valid
 * exam type here: the endpoints reject it server-side and the client blocks
 * it before the request is made (Spec §19, §30).
 */
import type {
  IatExamType,
  IatGeneratedBank as IatGeneratedBankRecord,
  IatGeneratedBankDetail,
  IatPaperPool,
  IatPreview,
  SourceBankStats
} from '../types';

export type IatGeneratedBank = IatGeneratedBankRecord;

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || '/api';

export const END_SEMESTER_EXAM_TYPE = 'End Semester Examination';

export class IatApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'IatApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(
  path: string,
  token: string,
  init: RequestInit & { desc?: string } = {}
): Promise<T> {
  const { desc, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...(rest.headers || {})
    }
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const raw = await res.text();
    throw new IatApiError(
      `Backend routing error (HTTP ${res.status}) on ${desc || path}: the server returned a non-JSON response.`,
      'NON_JSON_RESPONSE',
      res.status
    );
  }

  const data: any = await res.json();
  if (!res.ok || data.success === false) {
    throw new IatApiError(
      data.error || data.message || `Request failed (HTTP ${res.status}).`,
      data.code || 'REQUEST_FAILED',
      res.status
    );
  }
  return data as T;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Client-side mirror of the server gate (Spec §30). */
export function assertIatExamTypeLocal(examType: string): IatExamType {
  if (examType === END_SEMESTER_EXAM_TYPE) {
    throw new IatApiError(
      'The IAT Question Bank Generator is not available for End Semester Examination. End Semester papers always use the original, full question bank.',
      'END_SEMESTER_NOT_SUPPORTED',
      403
    );
  }
  if (examType !== 'Internal Assessment I' && examType !== 'Internal Assessment II') {
    throw new IatApiError('Only Internal Assessment I and II support the IAT Question Bank Generator.', 'EXAM_TYPE_NOT_SUPPORTED', 400);
  }
  return examType;
}

export interface IatFeatureHealth {
  databaseConfigured: boolean;
  schemaReady: boolean;
  geminiConfigured: boolean;
  iatExamTypes: string[];
  endSemesterSupported: boolean;
}

export async function fetchIatFeatureHealth(token: string): Promise<IatFeatureHealth> {
  const data = await request<{ success: true } & IatFeatureHealth>(
    '/iat-question-banks/health',
    token,
    { desc: 'GET /iat-question-banks/health' }
  );
  return data;
}

export interface SourceBankOption {
  id: string;
  subject_code: string;
  subject_name: string | null;
  file_name: string;
  academic_year: string | null;
  department: string | null;
  total_units: number | null;
  regulation: string | null;
  status: string;
  created_at: string;
}

export async function fetchSourceQuestionBanks(
  token: string,
  filters: { academicYear?: string; department?: string; subjectCode?: string; search?: string } = {}
): Promise<SourceBankOption[]> {
  const data = await request<{ success: true; sourceBanks: SourceBankOption[] }>(
    `/iat-question-banks/source-banks${qs(filters)}`,
    token,
    { desc: 'GET /iat-question-banks/source-banks' }
  );
  return data.sourceBanks || [];
}

export async function fetchSourceBankStats(
  token: string,
  bankId: string
): Promise<{ stats: SourceBankStats; suggestedName: string }> {
  return request<{ success: true; stats: SourceBankStats; suggestedName: string }>(
    `/iat-question-banks/source-banks/${bankId}/stats`,
    token,
    { desc: 'GET /iat-question-banks/source-banks/:id/stats' }
  );
}

/** Per-unit requested counts for unit-wise IAT generation. */
export interface UnitRequest {
  unit: number;
  partA: number;
  partBC: number;
}

export interface PreviewRequest {
  sourceQuestionBankId: string;
  /** Required for global mode. Ignored (set to 0) when unitRequests is provided. */
  requestedPartA: number;
  requestedPartBC: number;
  examType: string;
  seed?: number;
  useGemini?: boolean;
  /** Unit-wise mode: when provided, the global counts are derived from these. */
  unitRequests?: UnitRequest[];
}

/** Validates counts and builds a subset. Nothing is persisted (Spec §14). */
export async function generateIatPreview(
  token: string,
  payload: PreviewRequest
): Promise<IatPreview> {
  assertIatExamTypeLocal(payload.examType);
  const data = await request<{ success: true; preview: IatPreview }>(
    '/iat-question-banks/preview',
    token,
    { method: 'POST', body: JSON.stringify(payload), desc: 'POST /iat-question-banks/preview' }
  );
  return data.preview;
}

export interface SaveRequest {
  sourceQuestionBankId: string;
  requestedPartA: number;
  requestedPartBC: number;
  examType: string;
  name?: string;
  seed?: number;
  /** Pass through from the unit-wise preview so the save re-uses the same path. */
  unitRequests?: UnitRequest[];
}

/** Persists the reduced bank + all question-provenance links (Spec §16). */
export async function saveIatGeneratedBank(
  token: string,
  payload: SaveRequest
): Promise<{ generatedBank: IatGeneratedBank; preview: IatPreview }> {
  assertIatExamTypeLocal(payload.examType);
  return request<{ success: true; generatedBank: IatGeneratedBank; preview: IatPreview }>(
    '/iat-question-banks',
    token,
    { method: 'POST', body: JSON.stringify(payload), desc: 'POST /iat-question-banks' }
  );
}

export async function fetchIatGeneratedBanks(
  token: string,
  filters: {
    academicYear?: string;
    department?: string;
    subjectCode?: string;
    sourceQuestionBankId?: string;
    status?: 'Active' | 'Archived';
    includeArchived?: boolean;
  } = {}
): Promise<IatGeneratedBank[]> {
  const data = await request<{ success: true; banks: IatGeneratedBank[] }>(
    `/iat-question-banks${qs({
      academicYear: filters.academicYear,
      department: filters.department,
      subjectCode: filters.subjectCode,
      sourceQuestionBankId: filters.sourceQuestionBankId,
      status: filters.status,
      includeArchived: filters.includeArchived ? 'true' : undefined
    })}`,
    token,
    { desc: 'GET /iat-question-banks' }
  );
  return data.banks || [];
}

export async function fetchIatGeneratedBank(
  token: string,
  id: string
): Promise<IatGeneratedBankDetail> {
  const data = await request<{ success: true; bank: IatGeneratedBankDetail }>(
    `/iat-question-banks/${id}`,
    token,
    { desc: 'GET /iat-question-banks/:id' }
  );
  return data.bank;
}

export async function fetchIatBankPaperPool(
  token: string,
  id: string
): Promise<IatPaperPool> {
  const data = await request<{ success: true; pool: IatPaperPool }>(
    `/iat-question-banks/${id}/questions`,
    token,
    { desc: 'GET /iat-question-banks/:id/questions' }
  );
  return data.pool;
}

export async function archiveIatGeneratedBank(
  token: string,
  id: string,
  reason?: string
): Promise<IatGeneratedBankDetail> {
  const data = await request<{ success: true; bank: IatGeneratedBankDetail }>(
    `/iat-question-banks/${id}/archive`,
    token,
    { method: 'POST', body: JSON.stringify({ reason: reason || null }), desc: 'POST /iat-question-banks/:id/archive' }
  );
  return data.bank;
}

export async function restoreIatGeneratedBank(
  token: string,
  id: string
): Promise<IatGeneratedBankDetail> {
  const data = await request<{ success: true; bank: IatGeneratedBankDetail }>(
    `/iat-question-banks/${id}/restore`,
    token,
    { method: 'POST', body: JSON.stringify({}), desc: 'POST /iat-question-banks/:id/restore' }
  );
  return data.bank;
}

/** Deletes ONLY the generated bank. The source/original bank is untouched. */
export async function deleteIatGeneratedBank(
  token: string,
  id: string
): Promise<{ deleted: boolean; message: string }> {
  return request<{ deleted: boolean; message: string }>(
    `/iat-question-banks/${id}`,
    token,
    { method: 'DELETE', desc: 'DELETE /iat-question-banks/:id' }
  );
}

/** Records that this generated bank was chosen for an IAT paper (Spec §27). */
export async function markIatBankUsedForPaper(
  token: string,
  id: string,
  payload: { examType: string; academicYear?: string; department?: string; subjectCode?: string; paperCode?: string }
): Promise<void> {
  assertIatExamTypeLocal(payload.examType);
  await request(`/iat-question-banks/${id}/use-for-paper`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
    desc: 'POST /iat-question-banks/:id/use-for-paper'
  });
}
