import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function main() {
  for (let i = 1; i <= 5; i++) {
    const { count } = await c.from('subjects').select('*', { count: 'exact', head: true });
    console.log(`poll ${i}: subjects=${count}  at ${new Date().toISOString()}`);
    if (i < 5) await new Promise((r) => setTimeout(r, 20000));
  }
  const { data } = await c.from('subjects')
    .select('subject_code,subject_name,year_of_study,semester,department_id,academic_year_id,created_at')
    .order('created_at');
  console.log('\n--- current rows ---');
  for (const r of data ?? []) {
    console.log(`${r.subject_code.padEnd(9)} ${String(r.year_of_study).padEnd(10)} sem=${String(r.semester).padEnd(4)} ay=${r.academic_year_id.slice(0, 8)} dept=${r.department_id.slice(0, 8)}  ${r.created_at}`);
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
