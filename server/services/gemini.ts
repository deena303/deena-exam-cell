/**
 * ============================================================================
 * CENTRALIZED GEMINI SERVER SERVICE
 * ============================================================================
 *
 * Single source of truth for every Gemini interaction on the server:
 *
 *   GET  /api/health                    -> authenticateGemini()
 *   POST /api/question-banks/extract    -> extractQuestionsWithGemini()
 *   IAT selection                       -> tryGeminiSelection()
 *
 * All three share ONE client, ONE model list and ONE error classifier, so a
 * health check can never report a state that extraction would not reproduce.
 *
 * ---------------------------------------------------------------------------
 * WHY "CONFIGURED" IS NOT "AUTHENTICATED", AND NEITHER IS "MODEL AVAILABLE"
 * ---------------------------------------------------------------------------
 * These are four independent facts and are probed separately:
 *
 *   A  CONFIGURED         process.env.GEMINI_API_KEY is non-empty
 *   B  CREDENTIAL VALID   a real, model-independent Google API call is accepted
 *                         (models.list() — proves the key itself)
 *   C  REQUEST SUCCEEDS   a real generateContent call returns
 *   D  MODEL AVAILABLE    that specific model can actually generate
 *
 * Google answers 200 for `models.get({ model })` even for models that are
 * dead for the caller's key (e.g. "gemini-2.5-flash is no longer available to
 * new users" -> models.get = 200, generateContent = 404). Therefore
 * `models.get` is NOT a valid availability test: only a real minimal
 * `generateContent` is. This module probes with exactly that call, using the
 * exact same candidate model list and the same fallback walk as PDF
 * extraction, so the health verdict and the extraction outcome cannot diverge.
 *
 * E  EXTRACTION SUCCEEDS is deliberately NOT asserted by the health endpoint —
 *    it cannot be known without sending a document.
 *
 * ---------------------------------------------------------------------------
 * SECURITY RULES ENFORCED HERE
 * ---------------------------------------------------------------------------
 * 1. The key is read ONLY from process.env.GEMINI_API_KEY. Never from the
 *    frontend, never from VITE_*, never from ~/.gemini or ~/.antigravity,
 *    never hardcoded. The SDK always receives an explicit apiKey, so it can
 *    never fall back to a CLI/session credential store.
 * 2. Credential-shape inspection is DIAGNOSTIC ONLY. It never sets
 *    `authenticated`. Only Google's actual response does that.
 * 3. No credential material is returned, logged or hinted at: not the key,
 *    not a prefix/suffix, not a length, not an authorization header.
 */

import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';

/* -------------------------------------------------------------------------
 * Public types
 * ---------------------------------------------------------------------- */

/** Classification of a real Google error. */
export type GeminiErrorCategory =
  | 'INVALID_API_KEY'       // 400 API_KEY_INVALID / malformed key
  | 'UNAUTHENTICATED'       // 401
  | 'PERMISSION_DENIED'     // 403
  | 'MODEL_NOT_FOUND'       // 404
  | 'RATE_LIMITED'          // 429 RESOURCE_EXHAUSTED (rate limit)
  | 'QUOTA_EXCEEDED'        // 429 RESOURCE_EXHAUSTED (hard quota)
  | 'SERVICE_UNAVAILABLE'   // 5xx / high demand / deadline
  | 'NETWORK_ERROR'         // socket/DNS/TLS failure
  | 'UNKNOWN';

/** Health status. Every value maps 1:1 to a user-facing message. */
export type GeminiStatus =
  | 'not_configured'
  | 'unverified'
  | 'authenticated'
  | 'authentication_failed'
  | 'permission_denied'
  | 'model_unavailable'
  | 'rate_limited'
  | 'service_unavailable'
  | 'error';

/** Shape of the configured credential. DIAGNOSTIC ONLY — never proof. */
export type GeminiCredentialType = 'gemini_api_key' | 'unrecognized_shape' | 'missing';

export interface GeminiHealth {
  /** A — environment variable present. */
  configured: boolean;
  /**
   * B/C — a real Google API request was accepted. False whenever the actual
   * request did not succeed; never inferred from presence or from shape.
   */
  authenticated: boolean;
  /** D — the model extraction will use can actually generate. */
  modelAvailable: boolean;
  /** True when Google answered a 429 while the credential itself was accepted. */
  rateLimited: boolean;
  status: GeminiStatus;
  /** The model the health probe actually verified. */
  model?: string;
  /** The model PDF extraction will try first. */
  extractionModel: string;
  errorCategory?: GeminiErrorCategory;
  /** Diagnostic only — never proof of authentication. */
  credentialType: GeminiCredentialType;
  /** True when the credential shape looks unusual but the live call is authoritative. */
  credentialWarning: boolean;
  /** Admin-facing, secret-free explanation. */
  message: string;
  /** End-user message for the exact status. Never a raw Google error. */
  userMessage: string;
  modelsTried?: string[];
  latencyMs?: number;
  checkedAt: string;
  cached?: boolean;
}

/* -------------------------------------------------------------------------
 * User-facing messages — keyed strictly by the confirmed status
 * ---------------------------------------------------------------------- */

const USER_MESSAGE: Record<GeminiStatus, string> = {
  authenticated: 'Gemini service is ready.',
  unverified: 'Gemini service has not been verified yet.',
  authentication_failed: 'Gemini authentication failed on the server. Please contact the administrator.',
  permission_denied: 'Gemini access was denied on the server. Please contact the administrator.',
  model_unavailable: 'Gemini model is currently unavailable. Please contact the administrator.',
  rate_limited: 'Gemini API rate limit reached. Please try again later.',
  service_unavailable: 'Gemini service is temporarily unavailable. Please try again later.',
  not_configured: 'Gemini is not configured on the server. Please contact the administrator.',
  error: 'Extraction failed due to a Gemini service error. Please contact the administrator.'
};

export function geminiUserMessage(status: GeminiStatus): string {
  return USER_MESSAGE[status] || USER_MESSAGE.error;
}

/** Category -> status. A 404 is never an API-key error; neither is a 429. */
export function statusForCategory(category: GeminiErrorCategory): GeminiStatus {
  switch (category) {
    case 'INVALID_API_KEY':
    case 'UNAUTHENTICATED':
      return 'authentication_failed';
    case 'PERMISSION_DENIED':
      return 'permission_denied';
    case 'MODEL_NOT_FOUND':
      return 'model_unavailable';
    case 'RATE_LIMITED':
    case 'QUOTA_EXCEEDED':
      return 'rate_limited';
    case 'SERVICE_UNAVAILABLE':
    case 'NETWORK_ERROR':
      return 'service_unavailable';
    default:
      return 'error';
  }
}

function httpStatusForCategory(category: GeminiErrorCategory): number {
  switch (category) {
    case 'INVALID_API_KEY':
    case 'UNAUTHENTICATED':
    case 'PERMISSION_DENIED':
      return 503;
    case 'MODEL_NOT_FOUND':
      return 503;
    case 'RATE_LIMITED':
    case 'QUOTA_EXCEEDED':
      return 429;
    case 'SERVICE_UNAVAILABLE':
    case 'NETWORK_ERROR':
      return 502;
    default:
      return 500;
  }
}

/**
 * Error thrown by every Gemini operation. `userMessage` is safe for the UI;
 * `message` is for server logs only and never reaches the client.
 */
export class GeminiServiceError extends Error {
  readonly category: GeminiErrorCategory;
  readonly status: GeminiStatus;
  readonly userMessage: string;
  readonly httpStatus: number;
  readonly model?: string;

  constructor(category: GeminiErrorCategory, debugMessage: string, model?: string) {
    super(debugMessage);
    this.name = 'GeminiServiceError';
    this.category = category;
    this.status = statusForCategory(category);
    this.userMessage = geminiUserMessage(this.status);
    this.httpStatus = httpStatusForCategory(category);
    this.model = model;
  }
}

export function isGeminiServiceError(err: unknown): err is GeminiServiceError {
  return (
    err instanceof GeminiServiceError ||
    (typeof err === 'object' && err !== null && (err as any).name === 'GeminiServiceError')
  );
}

/* -------------------------------------------------------------------------
 * Log sanitization
 * ---------------------------------------------------------------------- */

let redactionNeedle = '';

/**
 * Removes any credential material from a string before it is logged or
 * returned. Required because the Google SDK echoes the request URL — which
 * carries `?key=...` — inside error messages.
 */
export function sanitizeForLog(value: unknown): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (value instanceof Error) text = value.message || value.name;
  else if (value && typeof value === 'object') {
    try { text = JSON.stringify(value); } catch { text = '[unserializable]'; }
  } else text = String(value);

  if (redactionNeedle) text = text.split(redactionNeedle).join('[REDACTED]');
  text = text
    .replace(/AIza[A-Za-z0-9_\-]{5,}/g, '[REDACTED]')
    .replace(/([?&](?:key|api_key|apikey)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/\b(authorization|x-goog-api-key|bearer)\b\s*[:=]?\s*["']?[^\s,"'}]{4,}/gi, '$1: [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{4,}/g, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/* -------------------------------------------------------------------------
 * Credential
 * ---------------------------------------------------------------------- */

function cleanEnvVal(value: string | undefined): string {
  if (!value) return '';
  let cleaned = value.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

/** The ONLY place the API key is read: the server environment. */
export function getGeminiApiKey(): string {
  const key = cleanEnvVal(process.env.GEMINI_API_KEY);
  redactionNeedle = key;
  return key;
}

/** Non-reversible fingerprint for cache keys. Never derived value is exposed. */
function keyFingerprint(key: string): string {
  if (!key) return 'none';
  try {
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
  } catch {
    return `len${key.length}`;
  }
}

/** Exact wording required for a non-Gemini credential. Never includes the value. */
export const NON_GEMINI_CREDENTIAL_MESSAGE =
  'Configured credential does not appear to be a Gemini API key.';

/**
 * Shape inspection. DIAGNOSTIC ONLY.
 *
 * Deliberately not based on a hard-coded key prefix, so future valid Gemini key
 * formats are never flagged. A Generative Language API key is a single opaque
 * URL-safe token; OAuth access tokens, JWTs, Antigravity/CLI session tokens and
 * login cookies all violate that shape. Whatever this returns never sets
 * `authenticated` — only Google's actual response does.
 *
 * IMPORTANT: only UNAMBIGUOUS credential markers are flagged. Structural
 * characters such as `.` are NOT evidence of anything — a live-verified key
 * must never be reported as a non-Gemini credential, because that is a
 * self-contradicting health report. Verified in practice: a valid key
 * containing a dot authenticates fine against Google's API.
 */
export function inspectGeminiCredential(rawKey: string): {
  type: GeminiCredentialType;
  reason: string;
} {
  const value = (rawKey || '').trim();
  if (!value) return { type: 'missing', reason: 'empty_environment_variable' };
  if (/^\s*bearer\s/i.test(value)) return { type: 'unrecognized_shape', reason: 'oauth_bearer_token' };
  if (/^(ya29|gho_|ghp_|ghu_|ghs_|ghr_|1\/\/|__Secure-|sso_|sid=|ssid=)/i.test(value)) {
    return { type: 'unrecognized_shape', reason: 'oauth_or_session_token' };
  }
  // A classic JWT is EXACTLY three base64url segments — nothing else.
  if (/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(value)) {
    return { type: 'unrecognized_shape', reason: 'jwt_token' };
  }
  if (/\s/.test(value)) return { type: 'unrecognized_shape', reason: 'contains_whitespace' };
  // Printable ASCII with no header/scheme separator.
  if (!/^[\x21-\x7E]+$/.test(value)) return { type: 'unrecognized_shape', reason: 'non_ascii_or_control_characters' };
  if (value.length < 16 || value.length > 1024) return { type: 'unrecognized_shape', reason: 'implausible_length' };
  return { type: 'gemini_api_key', reason: 'api_key_shape' };
}

/* -------------------------------------------------------------------------
 * Model configuration — one source of truth for health AND extraction
 * ---------------------------------------------------------------------- */

/**
 * Default model. This is the project's existing, verified-working default and
 * is intentionally left unchanged.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

/**
 * The exact candidate order PDF extraction has always used, plus two extra
 * fallbacks that Google currently serves. The relative order is preserved so
 * the model preference of the existing extraction service is not changed.
 *
 * Note: `models.get` returns 200 even for models that are retired for
 * generation (the 2.x flash models do exactly this), so a model is only
 * treated as available once a real generateContent call succeeds. Entries that
 * exist but cannot generate are skipped automatically.
 */
export const GEMINI_MODEL_FALLBACKS: string[] = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.8-flash',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash'
];

/** Model configured for the deployment (env override wins). */
export function getConfiguredGeminiModel(): string {
  return cleanEnvVal(process.env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;
}

/**
 * Models tried by BOTH the health probe and PDF extraction, most preferred
 * first. The CONFIGURED model is always first, so the two endpoints can never
 * disagree about which model is primary.
 */
export function getGeminiModelCandidates(): string[] {
  return Array.from(
    new Set([getConfiguredGeminiModel(), ...GEMINI_MODEL_FALLBACKS].filter(Boolean))
  ) as string[];
}

/* -------------------------------------------------------------------------
 * Shared SDK client
 * ---------------------------------------------------------------------- */

let cachedClient: { fingerprint: string; client: GoogleGenAI } | null = null;

/**
 * One shared @google/genai client, always built from the server environment
 * with an explicit apiKey so no CLI/session credential store can be used.
 */
export function getGeminiClient(): GoogleGenAI {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new GeminiServiceError('UNAUTHENTICATED', 'GEMINI_API_KEY is not configured in the backend environment variables.');
  }
  const fingerprint = keyFingerprint(apiKey);
  if (cachedClient && cachedClient.fingerprint === fingerprint) return cachedClient.client;
  const client = new GoogleGenAI({ apiKey });
  cachedClient = { fingerprint, client };
  return client;
}

/* -------------------------------------------------------------------------
 * Error classification
 * ---------------------------------------------------------------------- */

function numericStatus(err: any): number | undefined {
  const raw = err?.status ?? err?.code ?? err?.response?.status ?? err?.error?.code;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * Maps a real Google error onto a category. A 404 is a model problem, a 429 is
 * a rate/quota problem — neither is ever reported as an invalid API key.
 */
export function classifyGeminiError(err: any): GeminiErrorCategory {
  const message = String(err?.message || err || '').toLowerCase();
  const status = numericStatus(err);
  const has = (...needles: string[]) => needles.some((n) => message.includes(n));

  // Only a real key-rejection from Google counts as an invalid key.
  if (has('api_key_invalid', 'api key not valid', 'invalid api key', 'invalid_api_key')) {
    return 'INVALID_API_KEY';
  }
  if (status === 401 || has('unauthenticated', 'unauthorized', 'invalid authentication')) {
    return 'UNAUTHENTICATED';
  }
  if (status === 403 || has('permission_denied', 'permission denied', 'forbidden', 'api is not enabled')) {
    return 'PERMISSION_DENIED';
  }
  if (has('quota exceeded', 'exceeded your current quota', 'billing')) return 'QUOTA_EXCEEDED';
  if (status === 429 || has('resource_exhausted', 'rate limit', 'rate-limit', 'too many requests')) {
    return 'RATE_LIMITED';
  }
  if (
    status === 404 ||
    has('not found', 'no longer available', 'is not supported for', 'was not found', 'not_found')
  ) {
    return 'MODEL_NOT_FOUND';
  }
  if (
    (status !== undefined && status >= 500) ||
    has('high demand', 'unavailable', 'overloaded', 'deadline exceeded', 'internal error')
  ) {
    return 'SERVICE_UNAVAILABLE';
  }
  if (
    has('econnreset', 'econnrefused', 'enotfound', 'etimedout', 'socket hang up', 'fetch failed',
        'network', 'dns', 'getaddrinfo', 'tls', 'timed out')
  ) {
    return 'NETWORK_ERROR';
  }
  return 'UNKNOWN';
}

/** True only when the credential itself was rejected (never for 404/429/5xx). */
export function isGeminiAuthError(error: any): boolean {
  const category = classifyGeminiError(error);
  return (
    category === 'INVALID_API_KEY' ||
    category === 'UNAUTHENTICATED' ||
    category === 'PERMISSION_DENIED'
  );
}

/** Safe server-side logging. Never prints the key, a header or credentials. */
export function logGeminiFailure(scope: string, err: any): GeminiErrorCategory {
  const category = classifyGeminiError(err);
  console.error(`[Gemini] ${scope} failed`);
  console.error(`[Gemini] Error category: ${category}`);
  console.error(`[Gemini] HTTP status: ${numericStatus(err) ?? 'n/a'}`);
  console.error(`[Gemini] Details: ${sanitizeForLog(err?.message || err)}`);
  return category;
}

/* -------------------------------------------------------------------------
 * The real authentication test
 * ---------------------------------------------------------------------- */

const SUCCESS_CACHE_TTL_MS = 60_000;
const FAILURE_CACHE_TTL_MS = 20_000;
const PROBE_TIMEOUT_MS = 20_000;

let cachedHealth: GeminiHealth | null = null;
let cachedAt = 0;
let cachedFingerprint = '';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function makeHealth(p: Partial<GeminiHealth>): GeminiHealth {
  const status = (p.status || 'error') as GeminiStatus;
  return {
    configured: !!p.configured,
    authenticated: !!p.authenticated,
    modelAvailable: !!p.modelAvailable,
    rateLimited: !!p.rateLimited,
    status,
    model: p.model,
    extractionModel: getConfiguredGeminiModel(),
    errorCategory: p.errorCategory,
    credentialType: (p.credentialType || 'missing') as GeminiCredentialType,
    credentialWarning: !!p.credentialWarning,
    message: p.message || '',
    // Always derived from the confirmed status — never a leftover.
    userMessage: geminiUserMessage(status),
    modelsTried: p.modelsTried,
    latencyMs: p.latencyMs,
    checkedAt: new Date().toISOString(),
    cached: false
  };
}

function remember(health: GeminiHealth, fingerprint: string): GeminiHealth {
  cachedHealth = health;
  cachedAt = Date.now();
  cachedFingerprint = fingerprint;
  return health;
}

export interface AuthenticateOptions {
  /** Skip the short-lived cache. */
  forceRefresh?: boolean;
}

/**
 * Runs the real Gemini checks and reports A/B/C/D honestly.
 *
 * Stage 1 — credential: `models.list()`. Model-independent, so a failure here
 *            is genuinely about the credential.
 * Stage 2 — availability: a minimal `generateContent` over the same candidate
 *            list, in the same order, with the same fallback walk used by PDF
 *            extraction. `models.get` is deliberately NOT used here because
 *            Google answers 200 for models that cannot actually generate.
 *
 * No user document, PDF or file content is ever sent.
 */
export async function authenticateGemini(
  options: AuthenticateOptions = {}
): Promise<GeminiHealth> {
  const apiKey = getGeminiApiKey();
  const fingerprint = keyFingerprint(apiKey);
  const startedAt = Date.now();

  if (!apiKey) {
    return makeHealth({
      configured: false,
      authenticated: false,
      modelAvailable: false,
      status: 'not_configured',
      credentialType: 'missing',
      message: 'GEMINI_API_KEY is not configured in the backend environment.'
    });
  }

  const credential = inspectGeminiCredential(apiKey);

  if (!options.forceRefresh && cachedHealth && cachedFingerprint === fingerprint) {
    const ttl = cachedHealth.authenticated ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS;
    if (Date.now() - cachedAt < ttl) return { ...cachedHealth, cached: true };
  }

  // ---- Stage 1: is the credential itself accepted by Google? ----
  let client: GoogleGenAI;
  try {
    client = getGeminiClient();
  } catch (err) {
    const category = classifyGeminiError(err);
    logGeminiFailure('Credential check', err);
    return remember(
      makeHealth({
        configured: true,
        authenticated: false,
        modelAvailable: false,
        status: statusForCategory(category),
        errorCategory: category,
        credentialType: credential.type,
        credentialWarning: credential.type !== 'gemini_api_key',
        message: `Gemini credential check failed (${category}).`
      }),
      fingerprint
    );
  }

  try {
    await withTimeout(client.models.list(), PROBE_TIMEOUT_MS, 'models.list');
  } catch (err) {
    const category = classifyGeminiError(err);
    logGeminiFailure('Credential check', err);

    // A 429 here still proves the credential was accepted.
    const credentialAccepted = category === 'RATE_LIMITED' || category === 'QUOTA_EXCEEDED';

    return remember(
      makeHealth({
        configured: true,
        // Only true when Google demonstrably accepted the credential.
        authenticated: credentialAccepted,
        modelAvailable: false,
        rateLimited: credentialAccepted,
        status: statusForCategory(category),
        errorCategory: category,
        credentialType: credential.type,
        credentialWarning: credential.type !== 'gemini_api_key',
        message: credentialAccepted
          ? `Gemini credential accepted, but the API is rate limited (${category}).`
          : `Google did not accept the Gemini credential (${category}). ${sanitizeForLog(err?.message || err)}`,
        latencyMs: Date.now() - startedAt
      }),
      fingerprint
    );
  }

  // ---- Stage 2: which candidate model can actually generate? ----
  const modelsTried: string[] = [];
  let lastError: any = null;
  let lastCategory: GeminiErrorCategory | null = null;

  for (const model of getGeminiModelCandidates()) {
    modelsTried.push(model);
    try {
      // The smallest possible real generation request. This is the same call
      // type PDF extraction makes, so availability is measured honestly.
      await withTimeout(
        client.models.generateContent({
          model,
          contents: 'ping',
          // Small but not degenerate: thinking models reject a 1-token budget.
          config: { maxOutputTokens: 16, temperature: 0 }
        }),
        PROBE_TIMEOUT_MS,
        `generateContent probe (${model})`
      );
    } catch (err) {
      const category = classifyGeminiError(err);
      if (category === 'MODEL_NOT_FOUND') continue; // dead model — try the next one
      lastError = err;
      lastCategory = category;
      if (
        category === 'RATE_LIMITED' ||
        category === 'QUOTA_EXCEEDED' ||
        category === 'SERVICE_UNAVAILABLE' ||
        category === 'NETWORK_ERROR'
      ) {
        continue; // transient — the next candidate may still work
      }
      // Credential was rejected mid-flight: stop probing.
      logGeminiFailure(`Model probe (${model})`, err);
      return remember(
        makeHealth({
          configured: true,
          authenticated: false,
          modelAvailable: false,
          status: statusForCategory(category),
          errorCategory: category,
          credentialType: credential.type,
          credentialWarning: credential.type !== 'gemini_api_key',
          modelsTried,
          latencyMs: Date.now() - startedAt,
          message: `Google rejected the Gemini credential (${category}).`
        }),
        fingerprint
      );
    }

    // Success: the credential is authenticated AND the model is available.
    // Google's own response is the verdict, so the shape heuristic is overridden
    // here — it can never contradict `authenticated` in this branch.
    const health = makeHealth({
      configured: true,
      authenticated: true,
      modelAvailable: true,
      rateLimited: false,
      status: 'authenticated',
      model,
      credentialType: 'gemini_api_key',
      credentialWarning: false,
      modelsTried,
      latencyMs: Date.now() - startedAt,
      message: `Gemini verified with a live request (model: ${model}).`
    });
    return remember(health, fingerprint);
  }

  // No candidate produced a successful generation.
  // The credential was already accepted in stage 1, so `authenticated` stays
  // true: this is a model / quota / capacity problem, never a key problem.
  const category: GeminiErrorCategory = lastCategory || 'MODEL_NOT_FOUND';
  if (lastError) logGeminiFailure('Model probe', lastError);
  else {
    console.error('[Gemini] No candidate model is available to this API key');
  }

  const transient = category === 'RATE_LIMITED' || category === 'QUOTA_EXCEEDED' ||
    category === 'SERVICE_UNAVAILABLE' || category === 'NETWORK_ERROR';

  return remember(
    makeHealth({
      configured: true,
      authenticated: true,
      modelAvailable: false,
      rateLimited: category === 'RATE_LIMITED' || category === 'QUOTA_EXCEEDED',
      status: statusForCategory(category),
      errorCategory: category,
      // Stage 1 already proved Google accepts this credential, so it IS a
      // Gemini API key regardless of what the shape heuristic guessed.
      credentialType: 'gemini_api_key',
      credentialWarning: false,
      modelsTried,
      latencyMs: Date.now() - startedAt,
      message: transient
        ? `Gemini credential accepted, but no model could complete a request (${category}).`
        : 'None of the configured Gemini models are available to this API key.'
    }),
    fingerprint
  );
}

/**
 * Zero-cost synchronous view. Reports CONFIGURED from the environment and
 * upgrades to AUTHENTICATED as soon as a live check has succeeded. Existing
 * synchronous callers keep working without a network round trip.
 */
export function checkGeminiConfig(): GeminiHealth {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    return makeHealth({
      configured: false,
      status: 'not_configured',
      credentialType: 'missing',
      message: 'GEMINI_API_KEY is not configured in the backend environment.'
    });
  }

  const fingerprint = keyFingerprint(apiKey);
  if (cachedHealth && cachedFingerprint === fingerprint) return { ...cachedHealth, cached: true };

  const credential = inspectGeminiCredential(apiKey);
  return makeHealth({
    configured: true,
    authenticated: false,
    modelAvailable: false,
    status: 'unverified',
    credentialType: credential.type,
    credentialWarning: credential.type !== 'gemini_api_key',
    message: 'Gemini API key is present in the backend environment. Authentication has not been verified yet.'
  });
}

/** Back-compat helper. */
export function requireGeminiApiKey(): string {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new GeminiServiceError('UNAUTHENTICATED', 'GEMINI_API_KEY is not configured in the backend environment variables.');
  }
  return apiKey;
}

/**
 * The model extraction should try first: the one that passed the live probe,
 * otherwise the configured model. Same list for everyone.
 */
export function getActiveGeminiModel(): string {
  const fingerprint = keyFingerprint(getGeminiApiKey());
  if (
    cachedHealth &&
    cachedFingerprint === fingerprint &&
    cachedHealth.authenticated &&
    cachedHealth.modelAvailable &&
    cachedHealth.model
  ) {
    return cachedHealth.model;
  }
  return getConfiguredGeminiModel();
}

/** Status -> HTTP code. Used so health and extraction agree on 503/429/502. */
export function httpStatusForStatus(status: GeminiStatus): number {
  switch (status) {
    case 'authentication_failed':
    case 'permission_denied':
    case 'model_unavailable':
    case 'not_configured':
      return 503;
    case 'rate_limited':
      return 429;
    case 'service_unavailable':
      return 502;
    default:
      return 500;
  }
}

/**
 * True when the health verdict is definitive, i.e. retrying the extraction
 * cannot help. Transient states (rate limit, capacity) are deliberately NOT
 * included: extraction already has its own retry/backoff walk.
 */
export function isDefinitiveGeminiFailure(health: GeminiHealth): boolean {
  return (
    health.status === 'not_configured' ||
    health.status === 'authentication_failed' ||
    health.status === 'permission_denied' ||
    (health.status === 'model_unavailable' && !health.modelAvailable)
  );
}

/**
 * Top-level service status.
 *
 * 'ok'        — the backend is up and Google gave a definitive answer about
 *               the credential (accepted, or definitively rejected). The
 *               endpoint must stay a 200 liveness probe either way.
 * 'degraded'  — the backend is up but Gemini cannot be used right now.
 */
export function overallStatusFor(gemini: GeminiHealth): 'ok' | 'degraded' {
  switch (gemini.status) {
    case 'authenticated':
    case 'authentication_failed':
    case 'permission_denied':
      return 'ok';
    default:
      return 'degraded';
  }
}

/**
 * The Gemini + Supabase portion of a health response. Shared by every health
 * route so /api/health and the router's /health can never disagree.
 *
 * Contains no credential material: not the key, not a prefix or suffix, not a
 * length, not an authorization header.
 */
export function buildGeminiHealthPayload(
  gemini: GeminiHealth,
  supabaseConfigured: boolean
): Record<string, unknown> {
  return {
    geminiConfigured: gemini.configured,
    geminiAuthenticated: gemini.authenticated,
    geminiModelAvailable: gemini.modelAvailable,
    geminiRateLimited: gemini.rateLimited,
    geminiStatus: gemini.status,
    // The model the probe actually verified, else the model extraction tries.
    geminiModel: gemini.model || gemini.extractionModel,
    geminiExtractionModel: gemini.extractionModel,
    geminiErrorCategory: gemini.errorCategory,
    geminiMessage: gemini.message,
    geminiUserMessage: gemini.userMessage,
    // Diagnostic only — never proof of authentication.
    geminiCredentialType: gemini.credentialType,
    geminiCredentialWarning: gemini.credentialWarning,
    supabaseConfigured
  };
}

/** Clears memoized client + health cache. Tests only. */
export function resetGeminiCaches(): void {
  cachedClient = null;
  cachedHealth = null;
  cachedAt = 0;
  cachedFingerprint = '';
}
