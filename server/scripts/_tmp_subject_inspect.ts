/** Read-only inspection of subjects / departments / academic_years for the INSERT script. */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const BACKUP = 'C:/Users/deena/AppData/Local/Temp/opencode/qb_reset_backup/subjects.json';

async function main() {
  console.log('=== subjects: current rows ===');
  const { count: sc, error: se } = await c.from('subjects').select('*', { count: 'exact', head: true });
  console.log(se ? `ERR ${se.message}` : `row count = ${sc}`);

  console.log('\n=== subjects: columns (from prior backup, table is empty) ===');
  const old: any[] = fs.existsSync(BACKUP) ? JSON.parse(fs.readFileSync(BACKUP, 'utf8')) : [];
  if (old.length) {
    console.log('  ' + Object.keys(old[0]).join(', '));
    console.log('\n=== PRIOR subjects rows: year_of_study / semester conventions ===');
    for (const s of old) {
      console.log(`  ${String(s.subject_code).padEnd(9)} year_of_study=${JSON.stringify(s.year_of_study).padEnd(8)} semester=${JSON.stringify(s.semester).padEnd(12)} regulation=${JSON.stringify(s.regulation)} status=${s.status}  ${s.subject_name}`);
    }
    console.log('\n  distinct year_of_study values : ' + JSON.stringify([...new Set(old.map((s) => s.year_of_study))]));
    console.log('  distinct semester values      : ' + JSON.stringify([...new Set(old.map((s) => s.semester))]));
    console.log('  distinct regulation values    : ' + JSON.stringify([...new Set(old.map((s) => s.regulation))]));
    console.log('  distinct status values        : ' + JSON.stringify([...new Set(old.map((s) => s.status))]));
    console.log('  distinct faculty_name sample  : ' + JSON.stringify([...new Set(old.map((s) => s.faculty_name))].slice(0, 6)));
    console.log('  distinct faculty_dept sample  : ' + JSON.stringify([...new Set(old.map((s) => s.faculty_department))].slice(0, 6)));
  } else {
    console.log('  (no backup available)');
  }

  console.log('\n=== departments (live) ===');
  const { data: deps, error: de } = await c.from('departments')
    .select('id,department_code,department_name,short_name,status,is_active,is_common').order('department_code');
  if (de) console.log('ERR ' + de.message);
  for (const d of deps ?? []) {
    console.log(`  ${d.department_code.padEnd(6)} ${d.id}  name="${d.department_name}" short=${JSON.stringify(d.short_name)} status=${d.status} active=${d.is_active} common=${d.is_common}`);
  }

  console.log('\n=== academic_years (live) ===');
  const { data: yrs, error: ye } = await c.from('academic_years')
    .select('id,year_label,start_year,end_year,status,is_active').order('year_label');
  if (ye) console.log('ERR ' + ye.message);
  for (const y of yrs ?? []) {
    console.log(`  ${y.year_label}  ${y.id}  start=${y.start_year} end=${y.end_year} status=${y.status} active=${y.is_active}`);
  }

  console.log('\n=== departments required by the task — presence check ===');
  const NEED = ['CSBS', 'CSE', 'CYBER', 'IT', 'CIVIL', 'AIML', 'AIDS', 'EEE', 'MECH'];
  const have = new Map((deps ?? []).map((d) => [d.department_code, d]));
  for (const n of NEED) {
    const d = have.get(n);
    console.log(`  ${n.padEnd(6)} ${d ? 'FOUND   ' + d.id : '*** MISSING ***'}`);
  }
  const unused = (deps ?? []).filter((d) => !NEED.includes(d.department_code)).map((d) => d.department_code);
  console.log(`\n  existing departments not in the task list: ${unused.join(', ')}`);
  const fuzzy = (deps ?? []).filter((d) => /CY|SEC|SAFETY/i.test(d.department_code + ' ' + (d.department_name ?? '')));
  console.log(`  possible 'CYBER' lookalikes: ${fuzzy.map((d) => `${d.department_code}="${d.department_name}"`).join(', ') || '(none)'}`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
