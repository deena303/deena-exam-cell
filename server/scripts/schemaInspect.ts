import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { getSupabaseClient } from '../services/supabaseQuestionBankService';

const TABLES = [
  'question_banks', 'questions', 'question_usage_history', 'generated_papers',
  'iat_generated_question_banks', 'iat_generated_questions',
  'subjects', 'academic_years', 'departments', 'exam_patterns',
  'paper_set_tracking', 'additional_paper_requests'
];

async function main() {
  const c = getSupabaseClient();
  for (const t of TABLES) {
    const { data, error } = await c.from(t).select('*').limit(1);
    if (error) { console.log(`\n### ${t}: MISSING/ERR ${error.message}`); continue; }
    const row = data?.[0];
    if (!row) {
      const { error: e2 } = await c.from(t).select('*', { count: 'exact', head: true });
      if (e2) { console.log(`\n### ${t}: ERR ${e2.message}`); continue; }
      console.log(`\n### ${t}: (empty, reachable)`);
      continue;
    }
    console.log(`\n### ${t} sample row keys:`);
    console.log(Object.keys(row).join(', '));
    console.log('sample:', JSON.stringify(row).slice(0, 700));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
