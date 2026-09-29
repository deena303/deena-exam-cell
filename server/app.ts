import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root ONLY for local development.
// In production (Netlify), environment variables are injected at runtime by the platform.
// Using { override: false } ensures Netlify runtime vars are never overwritten.
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

import express from 'express';
import cors from 'cors';
import questionBankRouter from './routes/questionBankRoutes';
import authRouter from './routes/authRoutes';
import masterDataRouter from './routes/masterDataRoutes';
import auditLogRouter from './routes/auditLogRoutes';
import paperSetRouter from './routes/paperSetRoutes';
import iatQuestionBankRouter from './routes/iatQuestionBankRoutes';
import { checkGeminiConfig } from './services/geminiConfig';


const app = express();

// Allowed origins for CORS (local development + deployed Netlify app)
const allowedOrigins = [
  'https://msajce-examcell.netlify.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, curl, same-origin)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || origin.endsWith('.netlify.app')) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Normalize URL path when invoked via Netlify Functions (e.g. /.netlify/functions/api/...)
app.use((req, _res, next) => {
  if (req.url.startsWith('/.netlify/functions/api')) {
    req.url = req.url.replace(/^\/\.netlify\/functions\/api/, '');
    if (!req.url.startsWith('/')) {
      req.url = '/' + req.url;
    }
  }
  next();
});

// Dedicated health endpoint that ALWAYS returns JSON immediately
app.get(['/health', '/api/health'], (_req, res) => {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const gemini = checkGeminiConfig();

  return res.json({
    status: gemini.configured ? 'ok' : 'configuration_error',
    supabaseUrlConfigured: Boolean(supabaseUrl && supabaseUrl.startsWith('http')),
    supabaseServiceRoleConfigured: Boolean(supabaseKey && supabaseKey.length > 10),
    supabaseConfigured: Boolean(supabaseUrl && supabaseUrl.startsWith('http') && supabaseKey && supabaseKey.length > 10),
    geminiConfigured: gemini.configured,
    geminiStatus: gemini.status,
    geminiMessage: gemini.message,
    environment: process.env.NODE_ENV || 'production',
    timestamp: new Date().toISOString()
  });
});

// Root API info endpoint
app.get(['/', '/api'], (_req, res) => {
  res.json({
    service: 'MSAJCE Exam Software — Question Paper Management API',
    version: '3.0.0',
    status: 'running',
    environment: process.env.NODE_ENV || 'production',
    endpoints: {
      health: 'GET /api/health',
      login: 'POST /api/auth/login',
      academicYears: 'GET /api/academic-years',
      departments: 'GET /api/departments',
      subjects: 'GET /api/subjects',
      extract: 'POST /api/question-banks/extract',
      approve: 'POST /api/question-banks/:id/approve',
      iatSourceBanks: 'GET /api/iat-question-banks/source-banks',
      iatSourceStats: 'GET /api/iat-question-banks/source-banks/:bankId/stats',
      iatPreview: 'POST /api/iat-question-banks/preview',
      iatCreate: 'POST /api/iat-question-banks',
      iatList: 'GET /api/iat-question-banks'
    }
  });
});

// Mount routes with /api prefix (standard API structure)
app.use('/api', authRouter);
app.use('/api', masterDataRouter);
app.use('/api', questionBankRouter);
app.use('/api', auditLogRouter);
app.use('/api', paperSetRouter);
app.use('/api', iatQuestionBankRouter);

// Also mount routes at root / as fallback so if a Netlify rewrite strips /api, the endpoint resolves seamlessly
app.use('/', authRouter);
app.use('/', masterDataRouter);
app.use('/', questionBankRouter);
app.use('/', auditLogRouter);
app.use('/', paperSetRouter);
app.use('/', iatQuestionBankRouter);

// Catch-all for undefined API routes — MUST ALWAYS return JSON, NEVER HTML (Requirement 8)
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found.'
  });
});

// Global error handler — ALWAYS returns JSON (Requirement 8)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server] Unhandled error:', err?.message || err);
  res.status(500).json({
    success: false,
    error: err?.message || 'Internal server error'
  });
});

export default app;
