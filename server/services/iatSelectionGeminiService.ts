/**
 * Gemini-assisted IAT question selection (Spec §24)
 *
 * STRICT CONTRACT
 * ---------------
 * Gemini is used for ONE thing only: choosing WHICH existing source question
 * ids form a balanced subset.
 *
 *   IN  : compact metadata of already-existing questions (id, unit, part,
 *         marks, BTL, CO, PI, difficulty, OR group, times used) + the
 *         requested counts.
 *   OUT : a list of SOURCE QUESTION IDs.
 *
 * It is NEVER asked to write, rewrite, translate, summarise or invent question
 * text. Every returned id is validated against the server-side candidate list;
 * the question text used by the caller is always read from Supabase.
 *
 * If Gemini is unavailable, errors, times out, or returns anything that does
 * not validate, this module returns `null` and the caller keeps the
 * deterministic server-side selection.
 */
import { GoogleGenAI } from '@google/genai';
import { checkGeminiConfig, getGeminiApiKey, isGeminiAuthError } from './geminiConfig';
import type { SourceQuestion } from './iatQuestionBankService';

const SELECTION_MODEL_FALLBACKS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash'
];

const REQUEST_TIMEOUT_MS = 25000;

export interface GeminiSelectionInput {
  /** Deterministic Part A selection offered to Gemini for re-ordering. */
  partA: SourceQuestion[];
  /** Deterministic Part B + C selection offered to Gemini for re-ordering. */
  partBC: SourceQuestion[];
  requestedPartA: number;
  requestedPartBC: number;
  partBAvailable: number;
  partCAvailable: number;
}

/** Compact, text-free representation sent to the model. */
function toBrief(q: SourceQuestion) {
  return {
    id: q.id,
    part: q.part,
    unit: q.unit,
    marks: q.marks,
    btl: q.btl || q.blooms_level || null,
    co: q.co,
    pi: q.pi,
    difficulty: q.difficulty,
    or_group: q.or_group_id,
    times_used: q.timesUsed
  };
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    partAQuestionIds: { type: 'array', items: { type: 'string' } },
    partBCQuestionIds: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' }
  },
  required: ['partAQuestionIds', 'partBCQuestionIds'],
  // Google AI Studio schema subset does not support additionalProperties.
} as const;

function buildPrompt(input: GeminiSelectionInput): string {
  return `You are selecting exam questions for an INTERNAL ASSESSMENT (IAT) question bank reduction.

You are given a fixed, pre-selected candidate pool. Choose a subset of the GIVEN ids only.

Rules:
1. Return ONLY ids that appear in the input. Never invent an id.
2. Return exactly ${input.requestedPartA} ids in partAQuestionIds.
3. Return exactly ${input.requestedPartBC} ids in partBCQuestionIds.
4. partAQuestionIds must come from the "partA_candidates" array (all are Part A).
5. partBCQuestionIds must come from the "partBC_candidates" array (Part B and Part C mixed).
   Among the ${input.requestedPartBC} picks, aim for roughly ${input.partBAvailable} Part B and ${input.partCAvailable} Part C in proportion to their availability.
6. Never return both members of the same OR group.
7. Prefer even unit spread and a mix of BTL / CO / difficulty levels, and questions with low times_used.
8. DO NOT output, rewrite, translate, paraphrase or comment on any question text. You are only choosing ids.`;
}

/**
 * Attempts a Gemini-assisted ordering of the candidate pool.
 * Returns `null` on ANY failure so the deterministic selection is kept.
 */
export async function tryGeminiSelection(
  input: GeminiSelectionInput
): Promise<{ partA: SourceQuestion[]; partBC: SourceQuestion[] } | null> {
  const config = checkGeminiConfig();
  if (!config.configured) return null;
  if (input.partA.length === 0 && input.partBC.length === 0) return null;

  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const model = config.model || process.env.GEMINI_MODEL?.trim() || SELECTION_MODEL_FALLBACKS[0];
    const models = [model, ...SELECTION_MODEL_FALLBACKS].filter(
      (m, i, arr) => m && arr.indexOf(m) === i
    );

    const contents = [
      buildPrompt(input),
      JSON.stringify({
        requestedPartA: input.requestedPartA,
        requestedPartBC: input.requestedPartBC,
        partA_candidates: input.partA.map(toBrief),
        partBC_candidates: input.partBC.map(toBrief)
      })
    ].join('\n\n');

    let parsed: any = null;
    for (const candidateModel of models) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model: candidateModel,
            contents,
            config: {
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA as any,
              temperature: 0.2,
              maxOutputTokens: 8192
            }
          }),
          REQUEST_TIMEOUT_MS
        );
        const text = (response as any)?.text ?? (response as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (text) {
          parsed = JSON.parse(text);
          if (parsed) break;
        }
      } catch (err: any) {
        if (isGeminiAuthError(err)) {
          console.warn('[iat-selection] Gemini auth error — keeping deterministic selection.');
          return null;
        }
        console.warn(`[iat-selection] model "${candidateModel}" failed: ${err?.message || err}`);
      }
    }

    if (!parsed) return null;

    // ---- Validate EVERY returned id against the real candidate list ----
    // Spec §24: "Validate that every returned question ID exists in the
    // source question bank" and "Do not trust AI-generated question text."
    const partAMap = new Map(input.partA.map((q) => [q.id, q]));
    const partBCMap = new Map(input.partBC.map((q) => [q.id, q]));

    const partA = dedupeAndValidate(parsed.partAQuestionIds, partAMap);
    const partBC = dedupeAndValidate(parsed.partBCQuestionIds, partBCMap);

    if (partA.length !== input.requestedPartA || partBC.length !== input.requestedPartBC) {
      console.warn(
        `[iat-selection] Gemini returned ${partA.length}/${input.requestedPartA} Part A and ` +
        `${partBC.length}/${input.requestedPartBC} Part B/C ids — keeping deterministic selection.`
      );
      return null;
    }

    return { partA, partBC };
  } catch (err: any) {
    console.warn('[iat-selection] Gemini selection failed — keeping deterministic selection:', err?.message || err);
    return null;
  }
}

function dedupeAndValidate(ids: any, map: Map<string, SourceQuestion>): SourceQuestion[] {
  const out: SourceQuestion[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(ids) ? ids : []) {
    if (typeof raw !== 'string') continue;
    const q = map.get(raw);
    if (!q) continue;      // id not in the candidate pool -> dropped
    if (seen.has(q.id)) continue; // no duplicates (Spec §13)
    seen.add(q.id);
    out.push(q);
  }
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Gemini selection timed out after ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}
