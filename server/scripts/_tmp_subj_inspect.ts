/** Read-only inspection of subjects / departments / academic_years before authoring INSERTs. */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function main() {
  console.log('=== departments (all rows, live) ===');
  const { data: d, error: de } = await c.from('departments')
    .select('id,department_code,department_name,short_name,status,is_active,is_common,hod_name')
    .order('department_code');
  if (de) throw de;
  for (const r of d ?? []) {
    console.log(`  ${r.department_code.padEnd(6)} | ${String(r.department_name).padEnd(48)} | short=${String(r.short_name ?? '-').padEnd(6)} | status=${r.status} is_active=${r.is_active} is_common=${r.is_common}`);
  }

  console.log('\n=== any department matching CYBER? ===');
  const { data: cy } = await c.from('departments')
    .select('id,department_code,department_name,short_name')
    .or('department_code.ilike.%cyber%,department_name.ilike.%cyber%,short_name.ilike.%cyber%');
  console.log(cy && cy.length ? JSON.stringify(cy, null, 2) : '  (no direct cyber match)');

  console.log('\n=== academic_years (all rows, live) ===');
  const { data: y, error: ye } = await c.from('academic_years')
    .select('id,year_label,status,start_year,end_year,is_active').order('year_label');
  if (ye) throw ye;
  for (const r of y ?? []) {
    console.log(`  ${r.year_label} | id=${r.id} | status=${r.status} is_active=${r.is_active} | ${r.start_year}-${r.end_year}`);
  }

  console.log('\n=== subjects: current row count + columns ===');
  const { count } = await c.from('subjects').select('*', { count: 'exact', head: true });
  console.log(`  row count: ${count}`);
  const { data: s1 } = await c.from('subjects').select('*').limit(1);
  console.log(`  columns: ${s1 && s1.length ? Object.keys(s1[0]).join(', ') : '(table empty - probing by name)'} `);
  for (const col of ['id','subject_code','subject_name','department_id','academic_year_id',
    'semester','regulation','status','created_at','updated_at','year_of_study',
    'faculty_name','faculty_department']) {
    const { error } = await c.from('subjects').select(col).limit(1);
    console.log(`    ${error ? 'MISSING' : 'exists '}  ${col}`);
  }

  console.log('\n=== which subject_codes already exist? ===');
  const WANTED = ['24IT611','24CS512','24CY50','24IT501','24CE501','24CS303','24EC314','24CS502','24CB501','24ME501'];
  const { data: existing } = await c.from('subjects').select('id,subject_code,subject_name,department_id,academic_year_id,year_of_study,semester,regulation,status');
  for (const w of WANTED) {
    const hit = (existing ?? []).filter((r: any) => r.subject_code === w);
    console.log(`  ${w}: ${hit.length ? 'EXISTS -> ' + JSON.stringify(hit) : 'not present'}`);
  }
  console.log(`  (subjects table currently holds ${existing?.length ?? 0} rows)`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
