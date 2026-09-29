-- Verify the RLS repair for generated_papers (Spec §6).
-- Paste into the Supabase SQL Editor and run, or execute via psql.
SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'generated_papers'
ORDER BY policyname;

-- Confirm RLS is enabled
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname = 'generated_papers';
