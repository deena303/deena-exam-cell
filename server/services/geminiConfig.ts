/**
 * Back-compatibility re-export.
 *
 * The centralized Gemini configuration now lives in ./gemini, which is the
 * single source of truth shared by /api/health and /api/question-banks/extract.
 * This module is kept so existing imports keep resolving.
 */
export * from './gemini';
