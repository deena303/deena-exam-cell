import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function main() {
  const { data, error } = await c.from('subjects')
    .select('id,subject_code,subject_name,department_id,academic_year_id,semester,regulation,status,year_of_study,faculty_name,faculty_department,created_at')
    .order('created_at');
  if (error) throw new Error(error.message);
  console.log(`=== CURRENT subjects rows: ${data.length} ===`);
  for (const s of data) {
    console.log(JSON.stringify(s, null, 2));
  }

  // which academic_year / department do the new 5 use?
  console.log('\n=== joined view ===');
  const { data: j } = await c.from('subjects')
    .select('subject_code,subject_name,year_of_study,semester,departments(department_code),academic_years(year_label)')
    .order('created_at');
  for (const r of j ?? []) console.log(JSON.stringify(r));
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
