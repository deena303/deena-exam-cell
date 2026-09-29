/**
 * Applies the IAT Question Bank Generator migration (012) to Supabase and
 * prints a verification report. Run with:  npx tsx server/scripts/applyIatMigration.ts
 *
 * Safe to run repeatedly — the SQL is fully idempotent.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseQuestionBankService';

const MIGRATION = 'supabase/migrations/012_iat_question_bank_generator.sql';

async function main() {
  if (!isSupabaseConfigured()) {
    console.error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
  }

  const client = getSupabaseClient();
  const sql = fs.readFileSync(path.resolve(process.cwd(), MIGRATION), 'utf8');

  console.log(`Applying ${MIGRATION} (${sql.length} chars) ...`);

  const { error } = await client.rpc('exec_sql', { sql });
  if (error) {
    console.error('exec_sql failed:', error.message);
    console.error('Falling back to statement-by-statement execution.');
    await runStatements(client, sql);
  } else {
    console.log('Applied via exec_sql.');
  }

  await verify(client);
}

async function runStatements(client: any, sql: string) {
  // Split on semicolons that terminate a statement, ignoring $$ blocks.
  const stmts: string[] = [];
  let buf = '';
  let inDollar = false;
  for (const rawLine of sql.split('\n')) {
    const line = rawLine;
    const dollarCount = (line.match(/\$\$/g) || []).length;
    if (dollarCount % 2 === 1) inDollar = !inDollar;
    buf += line + '\n';
    if (!inDollar && /;\s*$/.test(line) && buf.trim()) {
      stmts.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) stmts.push(buf.trim());

  for (const stmt of stmts) {
    if (/^(--|\/\*)/.test(stmt) && !/^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|WITH|DO|GRANT|REVOKE|COMMENT)/i.test(stmt.replace(/^--[^\n]*\n?/g, ''))) {
      continue;
    }
    const { error } = await client.rpc('exec_sql', { sql: stmt });
    if (error) {
      console.error('Statement failed:', stmt.slice(0, 160).replace(/\s+/g, ' '));
      console.error('  ->', error.message);
    }
  }
}

async function verify(client: any) {
  console.log('\n=== Verification ===');

  const tables = [
    'question_banks',
    'questions',
    'iat_generated_question_banks',
    'iat_generated_questions',
    'question_usage_history',
    'generated_papers',
    'audit_logs',
  ];
  for (const t of tables) {
    const { error, count } = await client.from(t).select('*', { count: 'exact', head: true });
    console.log(`  ${error ? 'MISSING ' : 'OK      '} ${t}${error ? ' -> ' + error.message : ` (${count} rows)`}`);
  }

  const cols = [
    ['question_banks', 'bank_type'],
    ['question_banks', 'parent_question_bank_id'],
    ['question_banks', 'created_by'],
    ['question_banks', 'created_by_name'],
    ['iat_generated_question_banks', 'source_question_bank_id'],
    ['question_usage_history', 'iat_generated_bank_id'],
    ['generated_papers', 'iat_generated_bank_id'],
  ];
  for (const [t, c] of cols) {
    const { error } = await client.from(t as any).select(c).limit(1);
    console.log(`  ${error ? 'MISSING ' : 'OK      '} ${t}.${c}${error ? ' -> ' + error.message : ''}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
