import app from './app';
import { authenticateGemini, checkGeminiConfig } from './services/gemini';
import { isSupabaseConfigured } from './services/supabaseQuestionBankService';

const PORT = process.env.PORT || 4000;

// Start standalone Express server for local development
app.listen(PORT, async () => {
  const supabaseOk = isSupabaseConfigured();
  const gemini = checkGeminiConfig();
  console.log(`\n🚀 MSAJCE Exam Software API v3.0 running on http://localhost:${PORT}`);
  console.log(`   Gemini API: ${gemini.configured ? '✅ Configured' : `❌ ${gemini.message}`}`);
  console.log(`   Supabase:   ${supabaseOk ? '✅ Configured' : '❌ Not configured (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env)'}`);
  console.log(`\n   Auth:    POST http://localhost:${PORT}/api/auth/login`);
  console.log(`   Health:  GET  http://localhost:${PORT}/api/health`);
  console.log(`   Extract: POST http://localhost:${PORT}/api/question-banks/extract`);
  console.log(`   Approve: POST http://localhost:${PORT}/api/question-banks/:id/approve\n`);

  // Real Gemini authentication test at boot (no document is sent).
  try {
    const health = await authenticateGemini({ forceRefresh: true });
    console.log(
      `   Gemini: configured=${health.configured} authenticated=${health.authenticated} ` +
      `modelAvailable=${health.modelAvailable} model=${health.model} status=${health.status}`
    );
    if (health.userMessage) {
      console.warn(`   Gemini: ${health.message}`);
      console.warn(`   User-facing message: ${health.userMessage}`);
    }
  } catch (err: any) {
    console.warn(`   Gemini: ❌ check failed: ${err?.message || err}`);
  }
  console.log('');
});

export default app;
