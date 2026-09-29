import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { getSupabaseClient } from '../services/supabaseQuestionBankService';

async function main() {
  const c = getSupabaseClient();
  const { data: banks } = await c.from('question_banks').select('*').order('created_at');
  for (const b of banks || []) {
    const { data: qs } = await c.from('questions').select('part, unit, marks, blooms_level, btl_raw, co, pi, difficulty, or_group_id, status').eq('question_bank_id', b.id);
    const a = (qs || []).filter((q: any) => q.part === 'Part A').length;
    const bb = (qs || []).filter((q: any) => q.part === 'Part B').length;
    const cc = (qs || []).filter((q: any) => q.part === 'Part C').length;
    const units = Array.from(new Set((qs || []).map((q: any) => q.unit))).sort();
    console.log(`${b.id} | ${b.subject_code} ${b.subject_name} | yr=${b.academic_year} dept=${b.department} | A=${a} B=${bb} C=${cc} tot=${(qs||[]).length} | units=[${units}] | status=${b.status} | ${b.file_name}`);
  }
  const { data: u } = await c.from('user_accounts').select('id,email,role,name');
  console.log('\nUSERS:', (u || []).map((x: any) => `${x.role}:${x.email}:${x.id}`).join('\n       '));
  const { data: ay } = await c.from('academic_years').select('id,year_label,status');
  console.log('YEARS:', JSON.stringify(ay));
  const { data: dp } = await c.from('departments').select('id,department_code');
  console.log('DEPTS:', JSON.stringify(dp));
}
main().catch(e => { console.error(e); process.exit(1); });
