import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function main() {
  const need = ['CSBS', 'CSE', 'CSCS', 'IT', 'CIVIL', 'AIML', 'AIDS', 'EEE', 'MECH'];
  const { data, error } = await c.from('departments')
    .select('id,department_code,department_name,status,is_active')
    .in('department_code', need).order('department_code');
  if (error) throw error;
  console.log('=== resolved department ids ===');
  for (const d of data ?? []) {
    console.log(`  ${d.department_code.padEnd(6)} ${d.id}  ${d.department_name}  [status=${d.status} is_active=${d.is_active}]`);
  }
  const found = new Set((data ?? []).map((d: any) => d.department_code));
  const missing = need.filter((n) => !found.has(n));
  console.log(`\n  requested=${need.length} resolved=${found.size} missing=${missing.length ? missing.join(',') : 'none'}`);

  console.log('\n=== academic year ids to use ===');
  const { data: ay } = await c.from('academic_years')
    .select('id,year_label,status,is_active').in('year_label', ['2025-2029', '2026-2030']);
  for (const y of ay ?? []) console.log(`  ${y.year_label}  ${y.id}  [status=${y.status} is_active=${y.is_active}]`);

}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
