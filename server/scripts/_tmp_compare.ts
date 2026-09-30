import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

// what the task asked for
const SPEC = [
  { code: '24IT611', name: 'FULL STACK DEVELOPMENT',      year: '3rd Year', depts: ['CSBS'] },
  { code: '24CS512', name: 'CLOUD COMPUTING',             year: '3rd Year', depts: ['CSE'] },
  { code: '24CY50',  name: 'CLOUD ARCHITECTURE AND DESIGN', year: '3rd Year', depts: ['CYBER'] },
  { code: '24IT501', name: 'MOBILE COMPUTING',           year: '3rd Year', depts: ['IT'] },
  { code: '24CE501', name: 'DESIGN OF REINFORCED CONCRETE STRUCTURES', year: '3rd Year', depts: ['CIVIL'] },
  { code: '24CS303', name: 'JAVA PROGRAMMING',            year: '2nd Year', depts: ['CSBS', 'CSE', 'IT', 'AIML', 'AIDS', 'CYBER'] },
  { code: '24EC314', name: 'ANALOG ELECTRONIC CIRCUITS',  year: '2nd Year', depts: ['EEE'] },
  { code: '24CS502', name: 'SOFTWARE ENGINEERING',        year: '3rd Year', depts: ['CSE'] },
  { code: '24CB501', name: 'DEVOPS',                      year: '3rd Year', depts: ['CSBS'] },
  { code: '24ME501', name: 'DESIGN OF MACHINE ELEMENTS',  year: '3rd Year', depts: ['MECH'] },
];

async function main() {
  const { data: deps } = await c.from('departments').select('id,department_code');
  const byId = new Map((deps ?? []).map((d: any) => [d.id, d.department_code]));
  const { data: rows } = await c.from('subjects')
    .select('id,subject_code,subject_name,department_id,academic_year_id,year_of_study,semester,regulation,status')
    .order('subject_code');

  const { data: yrs } = await c.from('academic_years').select('id,year_label');
  const ayById = new Map((yrs ?? []).map((y: any) => [y.id, y.year_label]));

  console.log('=== LIVE subjects vs SPEC ===\n');
  for (const s of SPEC) {
    const live = (rows ?? []).filter((r: any) => r.subject_code === s.code);
    console.log(`${s.code}  spec: ${s.year}  depts=[${s.depts.join(', ')}]  name="${s.name}"`);
    if (!live.length) { console.log('   *** NO ROW ***\n'); continue; }
    for (const r of live) {
      const flags: string[] = [];
      if ((r.subject_name || '').toUpperCase() !== s.name.toUpperCase()) flags.push(`name differs ("${r.subject_name}")`);
      if (r.year_of_study !== s.year) flags.push(`year_of_study=${r.year_of_study} (spec ${s.year})`);
      const dc = byId.get(r.department_id);
      const specDepts = s.depts.map((d) => (d === 'CYBER' ? 'CSCS' : d));
      if (!specDepts.includes(dc as string)) flags.push(`dept=${dc} not in spec`);
      console.log(`   ${flags.length ? 'MISMATCH' : 'ok      '} ${dc}/${ayById.get(r.academic_year_id)} sem=${r.semester} ${flags.join(' | ')}`);
    }
    const got = new Set(live.map((r: any) => byId.get(r.department_id)));
    const wantAll = new Set(s.depts.map((d) => (d === 'CYBER' ? 'CSCS' : d)));
    const missing = [...wantAll].filter((d) => !got.has(d as string));
    if (missing.length) console.log(`   *** MISSING DEPARTMENTS: ${missing.join(', ')}`);
    const extra = [...got].filter((d) => !wantAll.has(d as string));
    if (extra.length) console.log(`   *** UNEXPECTED DEPARTMENTS: ${extra.join(', ')}`);
    console.log('');
  }

  const stray = (rows ?? []).filter((r: any) => !SPEC.some((s) => s.code === r.subject_code));
  console.log(`=== rows not in the task list: ${stray.length} ===`);
  for (const r of stray) console.log(`  ${r.subject_code} ${r.subject_name} (${byId.get(r.department_id)})`);

  console.log('\n=== academic_year usage across the new rows ===');
  const usage = new Map<string, number>();
  for (const r of rows ?? []) {
    const y = ayById.get(r.academic_year_id) as string;
    usage.set(y, (usage.get(y) ?? 0) + 1);
  }
  for (const [y, n] of usage) console.log(`  ${y}: ${n} row(s)`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
