/**
 * Builds the candidate table list from the repo (migrations + every Supabase
 * .from('...') call in the code), then probes each one against the live
 * database via PostgREST to determine which actually exist.
 * Read-only. Produces the evidence list used to author the reset SQL.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const candidates = new Set<string>();

// from migrations: CREATE TABLE [IF NOT EXISTS] name
for (const f of files.filter((f) => f.endsWith('.sql'))) {
  const sql = fs.readFileSync(f, 'utf8');
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
    candidates.add(m[1].toLowerCase());
  }
}

// from code: .from('table')  and client.from("table")
for (const f of files.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\.from\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*\)/g)) {
    const n = m[1].toLowerCase();
    // filter out supabase-js builder helpers, not table names
    if (!['select', 'insert', 'update', 'delete', 'upsert'].includes(n)) candidates.add(n);
  }
}

async function main() {
  const names = [...candidates].sort();
  const exists: string[] = [];
  const missing: string[] = [];

  console.log(`Probing ${names.length} candidate table names derived from the repo...\n`);
  for (const n of names) {
    const { error } = await c.from(n).select('*').limit(1);
    const { count } = error
      ? { count: null as any }
      : await c.from(n).select('*', { count: 'exact', head: true });
    if (error) { missing.push(n); }
    else { exists.push(n); console.log(`  EXISTS  ${String(count).padStart(5)}  ${n}`); }
  }

  console.log(`\n=== TABLES DETECTED (${exists.length}) ===`);
  for (const e of exists) console.log(`  public.${e}`);
  console.log(`\n=== CANDIDATES THAT DO NOT EXIST (${missing.length}) ===`);
  for (const m of missing) console.log(`  ${m}`);

  fs.writeFileSync('C:/Users/deena/AppData/Local/Temp/opencode/qb_reset_backup/detected_tables.json',
    JSON.stringify({ exists, missing, probed_at: new Date().toISOString() }, null, 2));
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
