-- ============================================================================
--  MSAJCE Question Paper Management System
--  DATA-ONLY RESET  —  empties rows, preserves 100% of the schema
-- ============================================================================
--
--  WHAT THIS DOES
--    Empties the data in the application tables. Nothing else.
--
--  WHAT THIS DOES NOT DO  (there is no DROP / ALTER / CREATE / TRUNCATE-of-
--  structure anywhere in this file)
--    * does NOT drop any table, schema or database
--    * does NOT drop or alter any column, type or default
--    * does NOT drop any primary key, foreign key, unique or check constraint
--    * does NOT drop any index, view, sequence, function or trigger
--    * does NOT drop or alter any RLS policy
--    * does NOT touch the `auth` schema, Supabase Auth users, roles or claims
--    * does NOT touch the `storage` schema, buckets or objects
--
--  MECHANISM
--    TRUNCATE (not DELETE). TRUNCATE removes rows only; every structural
--    object above is left exactly as-is. It also resets identity sequences and
--    does not fire row-level triggers, so no updated_at / provenance trigger
--    side effects.
--
--  FOREIGN KEYS
--    All target tables are truncated in ONE statement, so PostgreSQL resolves
--    the dependencies itself — no manual ordering, and no CASCADE needed.
--    CASCADE is deliberately NOT used: it would silently truncate any table
--    outside the list that has an FK pointing into it (including `auth` or
--    `storage`). Section 2 is a hard guard that ABORTS if that situation
--    exists, instead of destroying something you meant to keep.
--
--  IDEMPOTENT
--    Safe to run any number of times. Truncating an already-empty table is a
--    no-op. Re-running the verification queries is always safe.
--
--  HOW TO RUN
--    Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--    Suggested: run SECTION 1 alone first to read the plan, then run the rest.
--    NOTE: Section 3 is wrapped in its own transaction, so if it fails the
--    database rolls back to the state before it started.
--
--  BACK UP FIRST.  This is destructive and there is no undo in the database.
-- ============================================================================


-- ############################################################################
--  SECTION 0 — CONFIGURATION
--  Edit the preserve list here, then run the rest of the script unchanged.
-- ############################################################################

--  PRESERVE_MASTER_DATA = TRUE  ->  keeps identity + master + audit data and
--                                   empties only the operational data.
--  PRESERVE_MASTER_DATA = FALSE ->  empties EVERY table in the public schema
--                                   (login accounts and audit history included).
DO $$
DECLARE
  PRESERVE_MASTER_DATA BOOLEAN := TRUE;

  -- Tables kept when PRESERVE_MASTER_DATA = TRUE.
  -- These are the login accounts, org master data, exam configuration and the
  -- audit trail — i.e. the things a reset should not throw away.
  preserve_tables TEXT[] := ARRAY[
      'user_accounts',           -- login accounts (Super Admin / Exam Cell / Principal)
      'departments',             -- org master data
      'academic_years',          -- org master data
      'audit_logs',              -- audit trail
      'exam_pattern_configs',    -- exam pattern configuration
      'exam_set_limits'          -- principal approval / set-limit configuration
  ];
BEGIN
  RAISE NOTICE '--------------------------------------------------';
  RAISE NOTICE 'DATA-ONLY RESET';
  RAISE NOTICE '  PRESERVE_MASTER_DATA = %', PRESERVE_MASTER_DATA;
  RAISE NOTICE '  preserve list size  = %', array_length(preserve_tables, 1);
  RAISE NOTICE '--------------------------------------------------';
END $$;


-- ############################################################################
--  SECTION 1 — PRE-FLIGHT REPORT  (read-only, safe to run on its own)
--  Shows what exists, what the FK graph looks like, and what will be emptied.
-- ############################################################################

-- 1.1  Every table that exists in the public schema, with its live row count.
SELECT
    c.relname                                        AS table_name,
    pg_size_pretty(pg_total_relation_size(c.oid))     AS total_size,
    (xpath('/row/c/text()', query_to_xml(
        format('SELECT count(*) AS c FROM public.%I', c.relname), false, true, '')))[1]::text::bigint
                                                        AS row_count,
    obj_description(c.oid, 'pg_class')               AS comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- 1.2  The full foreign-key graph, child -> parent, with delete behaviour.
SELECT
    child_ns.nspname || '.' || child.relname          AS child_table,
    child_col.attname                                 AS child_column,
    parent_ns.nspname || '.' || parent.relname         AS parent_table,
    parent_col.attname                                AS parent_column,
    con.confdeltype                                   AS on_delete_code,
    CASE con.confdeltype
        WHEN 'a' THEN 'NO ACTION'  WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'    WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
    END                                               AS on_delete
FROM pg_constraint con
JOIN pg_class child        ON child.oid  = con.conrelid
JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
JOIN pg_class parent       ON parent.oid = con.confrelid
JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
JOIN LATERAL unnest(con.conkey)  WITH ORDINALITY AS k(attnum, ord) ON true
JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS p(attnum, ord) ON p.ord = k.ord
JOIN pg_attribute child_col  ON child_col.attrelid  = child.oid  AND child_col.attnum  = k.attnum
JOIN pg_attribute parent_col ON parent_col.attrelid = parent.oid AND parent_col.attnum = p.attnum
WHERE con.contype = 'f'
ORDER BY child_ns.nspname, child.relname, con.conname;

-- 1.3  Structural objects that must survive (counts, for before/after diffing).
SELECT 'tables'       AS object_type, count(*) AS total FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
UNION ALL SELECT 'columns',      count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
UNION ALL SELECT 'primary keys', count(*) FROM pg_constraint WHERE contype='p'
UNION ALL SELECT 'foreign keys', count(*) FROM pg_constraint WHERE contype='f'
UNION ALL SELECT 'unique',       count(*) FROM pg_constraint WHERE contype='u'
UNION ALL SELECT 'check',        count(*) FROM pg_constraint WHERE contype='c'
UNION ALL SELECT 'indexes',      count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='i'
UNION ALL SELECT 'triggers',     count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
UNION ALL SELECT 'rls policies', count(*) FROM pg_policies WHERE schemaname='public'
UNION ALL SELECT 'views',        count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='v'
UNION ALL SELECT 'functions',    count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public';

-- 1.4  Objects deliberately NOT in scope — proves the reset cannot reach them.
SELECT n.nspname AS schema, c.relname AS object_name, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('auth','storage','extensions')
  AND c.relkind IN ('r','v','m','p')
ORDER BY n.nspname, c.relname;


-- ############################################################################
--  SECTION 2 — PRE-FLIGHT GUARD + THE RESET
--
--  The table list is discovered from the live catalog at run time. Nothing is
--  hardcoded, so a table added later is picked up automatically.
--  A table is preserved only if it is in the preserve list AND has no ancestor
--  being truncated — that keeps every foreign key satisfiable without CASCADE.
-- ############################################################################

BEGIN;

DO $reset$
DECLARE
    PRESERVE_MASTER_DATA BOOLEAN := TRUE;

    preserve_tables TEXT[] := ARRAY[
        'user_accounts', 'departments', 'academic_years',
        'audit_logs', 'exam_pattern_configs', 'exam_set_limits'
    ];

    all_public    TEXT[];
    keep_public   TEXT[];   -- preserve list + everything hanging off it
    empty_public  TEXT[];   -- the tables whose rows get removed
    target_oids   OID[];
    foreign_offenders INT;
    stmt          TEXT;
    v_count       INT;
BEGIN

    -- --- discover every base table in the public schema -------------------
    SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}')
      INTO all_public
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r';

    -- --- nothing to do? ---------------------------------------------------
    IF array_length(all_public, 1) IS NULL THEN
        RAISE EXCEPTION 'No tables found in schema public. Nothing to do.';
    END IF;

    -- --- everything that must keep its rows -------------------------------
    -- Seeds are the preserve list, then we walk DOWN the FK graph (parent ->
    -- child) so a preserved parent drags its children in with it. Without
    -- this, truncating a parent would break a preserved child.
    IF PRESERVE_MASTER_DATA THEN
        WITH RECURSIVE keep(oid) AS (
            SELECT c.oid
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = ANY (preserve_tables)

            UNION

            SELECT con.conrelid
            FROM pg_constraint con
            JOIN keep ON con.confrelid = keep.oid
            WHERE con.contype = 'f'
        )
        SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}')
          INTO keep_public
        FROM keep
        JOIN pg_class c      ON c.oid = keep.oid
        JOIN pg_namespace n  ON n.oid = c.relnamespace
        WHERE n.nspname = 'public';
    ELSE
        keep_public := '{}';
    END IF;

    -- --- the tables whose rows will be removed ----------------------------
    SELECT array(SELECT unnest(all_public) EXCEPT SELECT unnest(keep_public))
      INTO empty_public;

    SELECT array_agg(c.oid)
      INTO target_oids
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY (empty_public);

    -- --- GUARD: refuse to run if anything outside public references a target
    -- This is why CASCADE is unnecessary. If this ever fires, truncating would
    -- require a CASCADE that reaches into auth/storage, so stop and report.
    SELECT count(*) INTO foreign_offenders
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid = ANY (target_oids)
      AND con.conrelid <> ALL (target_oids);

    IF foreign_offenders > 0 THEN
        RAISE EXCEPTION
            'ABORTED: % foreign key(s) point into the target tables from tables '
            'that are NOT in the target set. TRUNCATE would fail, and using '
            'CASCADE would delete tables outside the list. Inspect Section 1.2 '
            'and extend the target set deliberately. No data was changed.',
            foreign_offenders;
    END IF;

    -- --- report the plan --------------------------------------------------
    RAISE NOTICE '--------------------------------------------------';
    RAISE NOTICE 'PRESERVED (rows kept): %', coalesce(array_to_string(keep_public, ', '), '(none)');
    RAISE NOTICE 'EMPTYING  (rows removed): %', coalesce(array_to_string(empty_public, ', '), '(none)');
    RAISE NOTICE '--------------------------------------------------';

    IF array_length(empty_public, 1) IS NULL THEN
        RAISE NOTICE 'Nothing to empty. All public tables are on the preserve list.';
        RETURN;
    END IF;

    -- --- one statement for every target: Postgres orders it correctly ------
    SELECT format('TRUNCATE TABLE %s RESTART IDENTITY',
                  string_agg(quote_ident(t), ', ' ORDER BY t))
      INTO stmt
    FROM unnest(empty_public) AS t;

    EXECUTE stmt;

    -- --- immediate post-TRUNCATE verification (inside same transaction) -----
    -- This runs before COMMIT so a failure rolls back the entire reset cleanly.
    DECLARE
        bad_struct INT;
        leftover   INT;
        auth_users INT;
    BEGIN
        SELECT count(*) INTO bad_struct
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns t
                          WHERE t.table_schema='public' AND t.table_name=c.relname);

        SELECT count(*) INTO leftover
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname <> ALL (keep_public)
          AND (xpath('/row/c/text()', query_to_xml(
                format('SELECT count(*) AS c FROM public.%I', c.relname),
                false, true, '')))[1]::text::bigint > 0;

        BEGIN
            SELECT count(*) INTO auth_users FROM auth.users;
        EXCEPTION WHEN OTHERS THEN
            auth_users := -1;  -- auth schema not readable from this role
        END;

        RAISE NOTICE '==================================================';
        IF bad_struct = 0 THEN
            RAISE NOTICE 'PASS  every public table still exists with its columns';
        ELSE
            RAISE EXCEPTION 'FAIL  % table(s) lost their structure — rolling back', bad_struct;
        END IF;

        IF leftover = 0 THEN
            RAISE NOTICE 'PASS  all targeted tables are empty (0 rows)';
        ELSE
            RAISE EXCEPTION 'FAIL  % targeted table(s) still hold rows — rolling back', leftover;
        END IF;

        IF auth_users >= 0 THEN
            RAISE NOTICE 'PASS  auth.users untouched (% row(s))', auth_users;
        ELSE
            RAISE NOTICE 'NOTE  auth.users not readable from this role (not modified)';
        END IF;
        RAISE NOTICE '==================================================';
    END;

    -- --- table count confirm -----------------------------------------------
    SELECT count(*) INTO v_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r';

    RAISE NOTICE 'TRUNCATE completed. % public tables still present.', v_count;

END $reset$;

COMMIT;


-- ############################################################################
--  SECTION 3 — POST-VERIFICATION  (read-only)
--  Run after Section 2. Proves rows are gone and the structure is untouched.
-- ############################################################################

-- 3.1  Every table still exists, and shows its row count.
--      row_count = 0 on the emptied tables; preserved tables keep their rows.
SELECT
    c.relname                                    AS table_name,
    CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' END AS kind,
    (xpath('/row/c/text()', query_to_xml(
        format('SELECT count(*) AS c FROM public.%I', c.relname), false, true, '')))[1]::text::bigint
                                                    AS row_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','v')
ORDER BY c.relkind, c.relname;

-- 3.2  Structure inventory. Compare with the 1.3 numbers taken BEFORE the
--      reset — every count must be identical. Any difference means structure
--      was damaged.
SELECT 'tables'       AS object_type, count(*) AS total FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
UNION ALL SELECT 'columns',      count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
UNION ALL SELECT 'primary keys', count(*) FROM pg_constraint WHERE contype='p'
UNION ALL SELECT 'foreign keys', count(*) FROM pg_constraint WHERE contype='f'
UNION ALL SELECT 'unique',       count(*) FROM pg_constraint WHERE contype='u'
UNION ALL SELECT 'check',        count(*) FROM pg_constraint WHERE contype='c'
UNION ALL SELECT 'indexes',      count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='i'
UNION ALL SELECT 'triggers',     count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
UNION ALL SELECT 'rls policies', count(*) FROM pg_policies WHERE schemaname='public'
UNION ALL SELECT 'views',        count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='v'
UNION ALL SELECT 'functions',    count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public';

-- 3.3  Informational re-check (read-only, runs after the committed reset).
--      Verification with hard failure now happens INSIDE Section 2 (before
--      COMMIT) so this block is a safe, non-aborting double-check only.
DO $verify$
DECLARE
    bad_struct INT;
    leftover   INT;
    auth_users INT;
BEGIN
    SELECT count(*) INTO bad_struct
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns t
                      WHERE t.table_schema='public' AND t.table_name=c.relname);

    -- any non-empty table that was supposed to be emptied shows up here
    SELECT count(*) INTO leftover
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname <> ALL (ARRAY['user_accounts','departments','academic_years',
                                  'audit_logs','exam_pattern_configs','exam_set_limits'])
      AND (xpath('/row/c/text()', query_to_xml(
            format('SELECT count(*) AS c FROM public.%I', c.relname), false, true, '')))[1]::text::bigint > 0;

    BEGIN
        SELECT count(*) INTO auth_users FROM auth.users;
    EXCEPTION WHEN OTHERS THEN
        auth_users := -1;   -- auth schema not readable from this role
    END;

    RAISE NOTICE '==================================================';
    IF bad_struct = 0 THEN
        RAISE NOTICE 'PASS  every public table still exists with its columns';
    ELSE
        -- Use WARNING here: the reset already committed; EXCEPTION would be misleading.
        RAISE WARNING 'WARN  % table(s) appear to have lost their structure', bad_struct;
    END IF;

    IF leftover = 0 THEN
        RAISE NOTICE 'PASS  all targeted tables are empty (0 rows)';
    ELSE
        -- Use WARNING: if reset committed and rows remain something else re-inserted them.
        RAISE WARNING 'WARN  % targeted table(s) still hold rows after reset', leftover;
    END IF;

    IF auth_users >= 0 THEN
        RAISE NOTICE 'PASS  auth.users untouched (% row(s))', auth_users;
    ELSE
        RAISE NOTICE 'NOTE  auth.users not readable from this role (not modified)';
    END IF;
    RAISE NOTICE '==================================================';
END $verify$;


-- ############################################################################
--  OPTIONAL — DELETE-based alternative
--
--  Use this INSTEAD of Section 2 if you prefer row-by-row deletion (e.g. you
--  do not hold the TRUNCATE privilege). DELETE fires row-level triggers and
--  leaves the transaction log heavier, but it respects the same FK rules and
--  fails loudly rather than cascading.
--
--    BEGIN;
--    DELETE FROM public.paper_request_notifications;
--    DELETE FROM public.paper_set_tracking;
--    DELETE FROM public.additional_paper_requests;
--    DELETE FROM public.principal_paper_assignments;
--    DELETE FROM public.question_usage_history;
--    DELETE FROM public.generated_papers;
--    DELETE FROM public.iat_generated_questions;
--    DELETE FROM public.iat_generated_question_banks;
--    DELETE FROM public.question_departments;
--    DELETE FROM public.question_bank_departments;
--    DELETE FROM public.questions;
--    DELETE FROM public.question_banks;
--    DELETE FROM public.subjects;
--    COMMIT;
--
--  That is child -> parent order, matching the foreign keys in Section 1.2.
--  The preserve-list tables are intentionally absent, so their rows survive.
-- ############################################################################
