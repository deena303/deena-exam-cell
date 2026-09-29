-- ============================================================
-- MSAJCE Exam Software — Migration 010
-- Paper Set Tracking, Principal Approval Linkage & Approval Consumption
--
-- Safe, additive migration:
--   * Reuses the existing `generated_papers` table (no duplicate table)
--   * Reuses the existing `additional_paper_requests` / `paper_set_tracking`
--     tables created in migration 006
--   * Uses ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / DO blocks
--   * Never drops or deletes existing data
-- Run in the Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- 1. generated_papers — full set tracking identity (Spec §6, §18)
-- ============================================================
-- Every generated paper must carry the columns listed in Spec §6:
--   id, academic_year, department, subject_code, subject_name, exam_type,
--   set_name, set_letter, generated_by, generated_at, status, file_name,
--   paper_code, principal_approval_required, principal_approval_status,
--   approved_by, approved_at
ALTER TABLE IF EXISTS generated_papers
  ADD COLUMN IF NOT EXISTS set_name                    VARCHAR(20),   -- 'Set A'
  ADD COLUMN IF NOT EXISTS set_letter                  VARCHAR(5),    -- 'A'   (already added in 002/003, kept idempotent)
  ADD COLUMN IF NOT EXISTS set_display_name            TEXT,          -- 'AI & ML – Set A'
  ADD COLUMN IF NOT EXISTS file_name                   TEXT,          -- '24CS514_IAT_Set_A.pdf'
  ADD COLUMN IF NOT EXISTS generated_by                TEXT,          -- display name of generator
  ADD COLUMN IF NOT EXISTS generated_by_user_id        UUID,          -- user_accounts.id
  ADD COLUMN IF NOT EXISTS generated_at                TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS principal_approval_required BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS principal_approval_status   VARCHAR(20)  NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approved_by                 TEXT,
  ADD COLUMN IF NOT EXISTS approved_at                 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS principal_request_id        UUID;         -- FK added below

ALTER TABLE IF EXISTS generated_papers
  DROP CONSTRAINT IF EXISTS generated_papers_principal_approval_status_check;
ALTER TABLE IF EXISTS generated_papers
  ADD CONSTRAINT generated_papers_principal_approval_status_check
  CHECK (principal_approval_status IN
    ('not_required', 'pending', 'approved', 'rejected', 'consumed'));

-- Link a paper back to the Principal request that permitted it (Spec §18)
DO $$
BEGIN
  IF to_regclass('public.additional_paper_requests') IS NULL THEN
    RAISE NOTICE 'additional_paper_requests not found — run migration 006 first. Skipping FK.';
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'generated_papers'::regclass
      AND conname = 'generated_papers_principal_request_id_fkey'
  ) THEN
    ALTER TABLE generated_papers
      ADD CONSTRAINT generated_papers_principal_request_id_fkey
      FOREIGN KEY (principal_request_id) REFERENCES additional_paper_requests(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_generated_papers_principal_request_id
  ON generated_papers(principal_request_id);
CREATE INDEX IF NOT EXISTS idx_generated_papers_set_letter
  ON generated_papers(set_letter);
CREATE INDEX IF NOT EXISTS idx_generated_papers_generated_at
  ON generated_papers(generated_at DESC);

-- Backfill: derive set_name from set_letter where possible (no data loss)
UPDATE generated_papers
   SET set_name = 'Set ' || set_letter
 WHERE set_letter IS NOT NULL
   AND (set_name IS NULL OR set_name = '');

-- ============================================================
-- 2. Database-level duplicate standard set prevention (Spec §4, §21, §22)
-- ============================================================
-- The authoritative anti-duplicate constraint already exists on
-- `paper_set_tracking` (UNIQUE (academic_year_id, department_id,
-- subject_id, exam_type, set_name) — migration 006).
-- We mirror it onto `generated_papers` so the paper record itself is
-- also protected, but ONLY when no pre-existing duplicates would make
-- the index creation fail (existing data must never be removed).
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_generated_papers_set_identity'
  ) THEN
    SELECT COUNT(*) INTO dup_count
      FROM (
        SELECT 1
          FROM generated_papers
         WHERE academic_year_id IS NOT NULL
           AND department_id    IS NOT NULL
           AND subject_id       IS NOT NULL
           AND exam_type        IS NOT NULL
           AND set_letter       IS NOT NULL
         GROUP BY academic_year_id, department_id, subject_id, exam_type, set_letter
        HAVING COUNT(*) > 1
      ) d;

    IF dup_count = 0 THEN
      EXECUTE 'CREATE UNIQUE INDEX uq_generated_papers_set_identity
        ON generated_papers(academic_year_id, department_id, subject_id, exam_type, set_letter)
        WHERE set_letter IS NOT NULL';
      RAISE NOTICE 'Created unique index uq_generated_papers_set_identity (duplicate standard sets blocked at DB level).';
    ELSE
      RAISE WARNING 'Skipped uq_generated_papers_set_identity: % pre-existing duplicate set combination(s) found. Duplicates were preserved (no data removed). Run the cleanup query in the README before re-running this migration.',
        dup_count;
    END IF;
  END IF;
END $$;

-- Belt-and-braces trigger: always refuse a duplicate standard set even when
-- the unique index had to be skipped because of legacy duplicates.
CREATE OR REPLACE FUNCTION enforce_generated_paper_set_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.set_letter IS NOT NULL
     AND NEW.academic_year_id IS NOT NULL
     AND NEW.department_id IS NOT NULL
     AND NEW.subject_id IS NOT NULL
     AND NEW.exam_type IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM generated_papers g
       WHERE g.academic_year_id = NEW.academic_year_id
         AND g.department_id    = NEW.department_id
         AND g.subject_id       = NEW.subject_id
         AND g.exam_type        = NEW.exam_type
         AND g.set_letter       = NEW.set_letter
         AND g.id <> NEW.id
    ) THEN
      RAISE EXCEPTION
        'Duplicate set blocked: Set % already exists for this Academic Year + Department + Subject + Exam Type.',
        NEW.set_letter
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generated_paper_set_uniqueness ON generated_papers;
CREATE TRIGGER trg_generated_paper_set_uniqueness
  BEFORE INSERT OR UPDATE ON generated_papers
  FOR EACH ROW EXECUTE FUNCTION enforce_generated_paper_set_uniqueness();

-- ============================================================
-- 3. additional_paper_requests — rejection + consumption columns (Spec §11, §12, §21)
-- ============================================================
ALTER TABLE IF EXISTS additional_paper_requests
  ADD COLUMN IF NOT EXISTS rejected_by_id    UUID REFERENCES user_accounts(id),
  ADD COLUMN IF NOT EXISTS rejected_by_name  TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason  TEXT,
  ADD COLUMN IF NOT EXISTS consumed          BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consumed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consumed_set_name VARCHAR(5);

CREATE INDEX IF NOT EXISTS idx_apr_consumed ON additional_paper_requests(consumed);
CREATE INDEX IF NOT EXISTS idx_apr_status_created ON additional_paper_requests(status, created_at DESC);

-- An approval is tied to exactly ONE specific set (Spec §12).
-- NOT VALID so any pre-existing multi-set rows are preserved, while every
-- NEW request is constrained to a single approved set.
ALTER TABLE IF EXISTS additional_paper_requests
  DROP CONSTRAINT IF EXISTS additional_paper_requests_single_set_check;
ALTER TABLE IF EXISTS additional_paper_requests
  ADD CONSTRAINT additional_paper_requests_single_set_check
  CHECK (requested_set_count = 1) NOT VALID;

-- An approval can never be consumed more than once (Spec §12).
ALTER TABLE IF EXISTS additional_paper_requests
  DROP CONSTRAINT IF EXISTS additional_paper_requests_consume_once_check;
ALTER TABLE IF EXISTS additional_paper_requests
  ADD CONSTRAINT additional_paper_requests_consume_once_check
  CHECK (consumed = FALSE OR consumed_at IS NOT NULL) NOT VALID;

-- ============================================================
-- 4. paper_set_tracking — link back + helper indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pst_approval_consumed
  ON paper_set_tracking(additional_set_request_id, generation_status);

-- A single approval request can only ever produce ONE tracked set.
-- Partial unique index (Postgres 9.x+ compatible). Standard sets have a NULL
-- approval id and are therefore never affected by this constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_pst_one_set_per_approval'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX uq_pst_one_set_per_approval
      ON paper_set_tracking(additional_set_request_id)
      WHERE additional_set_request_id IS NOT NULL';
    RAISE NOTICE 'Created unique index uq_pst_one_set_per_approval (one approval = one set).';
  END IF;
END $$;

-- ============================================================
-- 5. Seed the Principal account role constraint defensively (Spec §7)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_accounts'::regclass
      AND conname = 'user_accounts_role_check'
  ) THEN
    -- Remove any legacy role CHECK that would block 'PRINCIPAL'
    EXECUTE (
      SELECT 'ALTER TABLE user_accounts DROP CONSTRAINT ' || quote_ident(conname)
        FROM pg_constraint
       WHERE conrelid = 'user_accounts'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%role%'
         AND pg_get_constraintdef(oid) NOT ILIKE '%PRINCIPAL%'
       LIMIT 1
    );
    ALTER TABLE user_accounts
      ADD CONSTRAINT user_accounts_role_check
      CHECK (role IN ('SUPER_ADMIN', 'EXAM_CELL', 'PRINCIPAL'));
  END IF;
END $$;

-- ============================================================
-- 6. Standard set limit reference data (Spec §3, §15)
-- Kept in a lookup table so limits are data-driven, not hardcoded.
-- ============================================================
CREATE TABLE IF NOT EXISTS exam_set_limits (
  exam_type     VARCHAR(60) PRIMARY KEY
    CHECK (exam_type IN ('Internal Assessment I', 'Internal Assessment II', 'End Semester Examination')),
  max_sets      INTEGER     NOT NULL,
  set_letters   TEXT[]      NOT NULL,
  requires_approval_beyond BOOLEAN NOT NULL DEFAULT TRUE,
  limit_message TEXT        NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO exam_set_limits (exam_type, max_sets, set_letters, requires_approval_beyond, limit_message)
VALUES
  ('Internal Assessment I',
   2, ARRAY['A','B'], TRUE,
   'Standard IAT limit reached. Additional paper generation requires Principal approval.'),
  ('Internal Assessment II',
   2, ARRAY['A','B'], TRUE,
   'Standard IAT limit reached. Additional paper generation requires Principal approval.'),
  ('End Semester Examination',
   4, ARRAY['A','B','C','D'], TRUE,
   'Standard End Semester set limit reached. Additional paper generation requires Principal approval.')
ON CONFLICT (exam_type) DO UPDATE SET
  max_sets = EXCLUDED.max_sets,
  set_letters = EXCLUDED.set_letters,
  requires_approval_beyond = EXCLUDED.requires_approval_beyond,
  limit_message = EXCLUDED.limit_message,
  updated_at = NOW();

ALTER TABLE IF EXISTS exam_set_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on exam_set_limits" ON exam_set_limits;
CREATE POLICY "Allow all on exam_set_limits" ON exam_set_limits
  FOR ALL TO public USING (true) WITH CHECK (true);

-- ============================================================
-- 7. Audit log action vocabulary (Spec §19)
-- No schema change needed — action is free text — but we document the
-- canonical event names used by the backend so the Audit Logs page,
-- filters and any reporting stay consistent.
-- ============================================================
--   LOGIN
--   LOGOUT
--   IAT_SET_A_GENERATED / IAT_SET_B_GENERATED
--   END_SEM_SET_A_GENERATED / END_SEM_SET_B_GENERATED
--   END_SEM_SET_C_GENERATED / END_SEM_SET_D_GENERATED
--   ADDITIONAL_PAPER_REQUEST_CREATED
--   PRINCIPAL_APPROVED_REQUEST
--   PRINCIPAL_REJECTED_REQUEST
--   ADDITIONAL_PAPER_GENERATED
--   EXAM_PATTERN_EDITED
--   PAPER_DOWNLOADED
--   PAPER_FINALIZED

-- ============================================================
-- DONE
-- Then run:  npx tsx server/scripts/seedAccounts.ts
-- ============================================================
