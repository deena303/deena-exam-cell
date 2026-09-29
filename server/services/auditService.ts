/**
 * Audit Service
 *
 * Single writer for the `audit_logs` table so every subsystem (auth, paper
 * sets, principal workflow, exam patterns, downloads) produces consistent
 * entries (Spec §19).
 *
 * Never throws — auditing must not break the user-facing operation.
 */
import { getSupabaseClient, isSupabaseConfigured } from './supabaseQuestionBankService';

export type AuditStatus = 'SUCCESS' | 'FAILURE';

export interface AuditEvent {
  userId?: string | null;
  userEmail: string;
  userName?: string | null;
  role: string;
  action: string;
  status: AuditStatus | string;
  /**
   * Structured context. Every event carries academic year, department,
   * subject, exam type and set where applicable (Spec §19).
   */
  metadata?: Record<string, any> | null;
}

export async function writeAuditLog(event: AuditEvent): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const client = getSupabaseClient();
    const metadata = event.metadata ? sanitizeMetadata(event.metadata) : null;
    const { error } = await client.from('audit_logs').insert({
      user_id: event.userId || null,
      user_email: String(event.userEmail || 'system').toLowerCase().trim(),
      user_name: event.userName || null,
      role: String(event.role || 'SYSTEM').toUpperCase(),
      action: String(event.action || 'UNKNOWN').toUpperCase().replace(/\s+/g, '_'),
      status: String(event.status || 'SUCCESS').toUpperCase(),
      metadata,
      created_at: new Date().toISOString()
    });
    if (error) console.warn('[audit] insert failed:', error.message);
  } catch (err: any) {
    console.warn('[audit] insert error:', err?.message);
  }
}

/** Removes undefined/null/function values so the JSONB column stays clean. */
function sanitizeMetadata(input: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'function') continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      out[key] = sanitizeMetadata(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

// ------------------------------------------------------------------
// Canonical action names (Spec §19) — documented in migration 010
// ------------------------------------------------------------------
export const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  IAT_SET_GENERATED: 'IAT_SET_{LETTER}_GENERATED',
  END_SEM_SET_GENERATED: 'END_SEM_SET_{LETTER}_GENERATED',
  ADDITIONAL_PAPER_REQUEST_CREATED: 'ADDITIONAL_PAPER_REQUEST_CREATED',
  PRINCIPAL_APPROVED_REQUEST: 'PRINCIPAL_APPROVED_REQUEST',
  PRINCIPAL_REJECTED_REQUEST: 'PRINCIPAL_REJECTED_REQUEST',
  ADDITIONAL_PAPER_GENERATED: 'ADDITIONAL_PAPER_GENERATED',
  EXAM_PATTERN_EDITED: 'EXAM_PATTERN_EDITED',
  PAPER_DOWNLOADED: 'PAPER_DOWNLOADED',
  PAPER_FINALIZED: 'PAPER_FINALIZED',

  // ---- IAT Question Bank Generator (Spec §27) ----
  /** Original question bank uploaded / approved into the Question Bank. */
  QUESTION_BANK_UPLOADED: 'QUESTION_BANK_UPLOADED',
  /** A reduction run was started (preview requested). */
  IAT_BANK_GENERATION_STARTED: 'IAT_BANK_GENERATION_STARTED',
  /** The reduced bank record was created. */
  IAT_BANK_CREATED: 'IAT_BANK_CREATED',
  /** A new selection was re-rolled from the same source bank. */
  IAT_BANK_REGENERATED: 'IAT_BANK_REGENERATED',
  /** The reduced bank + its questions were persisted. */
  IAT_BANK_SAVED: 'IAT_BANK_SAVED',
  IAT_BANK_ARCHIVED: 'IAT_BANK_ARCHIVED',
  IAT_BANK_RESTORED: 'IAT_BANK_RESTORED',
  IAT_BANK_DELETED: 'IAT_BANK_DELETED',
  /** A generated IAT bank was chosen as the source of an IAT paper. */
  IAT_BANK_SELECTED_FOR_PAPER: 'IAT_BANK_SELECTED_FOR_PAPER'
} as const;
