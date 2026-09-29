-- ============================================================
-- Migration 012: IAT Question Bank Generator
--
-- Extends the EXISTING `question_banks` table (no duplicate bank table is
-- created) and adds two tables that hold the IAT-specific reduction
-- metadata and the per-question provenance of the reduced bank.
--
--   question_banks                  (EXTENDED)
--     + bank_type                    'ORIGINAL' | 'IAT_GENERATED'
--     + parent_question_bank_id      self-FK -> original bank (NULL for originals)
--     + created_by / created_by_name
--
--   iat_generated_question_banks    (NEW)  reduction run header
--   iat_generated_questions         (NEW)  selected questions + provenance
--
-- NOTHING here mutates existing `questions` rows. A generated bank is a
-- separate subset; the original bank and all of its questions remain intact
-- forever (Spec §9, §28).
--
-- Run in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> Run).
-- The file is fully idempotent and safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Sanity: required extension (same as migration 001)
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- 1. Extend `question_banks`
--    Idempotent column adds so the script runs on a database that
--    already has migrations 001-011 applied.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_banks' AND column_name = 'bank_type'
  ) THEN
    ALTER TABLE public.question_banks
      ADD COLUMN bank_type VARCHAR(20) NOT NULL DEFAULT 'ORIGINAL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_banks' AND column_name = 'parent_question_bank_id'
  ) THEN
    ALTER TABLE public.question_banks
      ADD COLUMN parent_question_bank_id UUID NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_banks' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE public.question_banks ADD COLUMN created_by UUID NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_banks' AND column_name = 'created_by_name'
  ) THEN
    ALTER TABLE public.question_banks ADD COLUMN created_by_name TEXT NULL;
  END IF;
END $$;

-- Every pre-existing row is, by definition, an ORIGINAL bank.
UPDATE public.question_banks
   SET bank_type = 'ORIGINAL'
 WHERE bank_type IS NULL;

-- Constrain the discriminator to the two legal values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_question_banks_bank_type'
  ) THEN
    ALTER TABLE public.question_banks
      ADD CONSTRAINT chk_question_banks_bank_type
      CHECK (bank_type IN ('ORIGINAL', 'IAT_GENERATED'));
  END IF;
END $$;

-- Self-referencing parent link.
-- ON DELETE RESTRICT is deliberate: a source bank can never be deleted out
-- from under a generated bank (Spec §20 / §28).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_question_banks_parent'
  ) THEN
    ALTER TABLE public.question_banks
      ADD CONSTRAINT fk_question_banks_parent
      FOREIGN KEY (parent_question_bank_id)
      REFERENCES public.question_banks(id)
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END $$;

-- A generated bank must always point at a parent; an original must never do.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_question_banks_parent_shape'
  ) THEN
    ALTER TABLE public.question_banks
      ADD CONSTRAINT chk_question_banks_parent_shape
      CHECK (
        (bank_type = 'ORIGINAL'      AND parent_question_bank_id IS NULL)
        OR
        (bank_type = 'IAT_GENERATED' AND parent_question_bank_id IS NOT NULL)
      );
  END IF;
END $$;

-- A bank can never be its own parent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_question_banks_not_self_parent'
  ) THEN
    ALTER TABLE public.question_banks
      ADD CONSTRAINT chk_question_banks_not_self_parent
      CHECK (parent_question_bank_id IS DISTINCT FROM id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_question_banks_bank_type    ON public.question_banks (bank_type);
CREATE INDEX IF NOT EXISTS idx_question_banks_parent_bank  ON public.question_banks (parent_question_bank_id);
CREATE INDEX IF NOT EXISTS idx_question_banks_created_by    ON public.question_banks (created_by);

-- ============================================================
-- 2. TABLE: iat_generated_question_banks
--    One row per reduction run. Points at BOTH the source bank and the
--    `question_banks` row that was created for the reduced bank, so the
--    reduced bank is a first-class bank that existing bank queries see.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.iat_generated_question_banks (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- The question_banks row created for this reduced bank.
  question_bank_id          UUID NOT NULL REFERENCES public.question_banks(id) ON DELETE CASCADE,

  -- The ORIGINAL question bank the questions were selected from.
  source_question_bank_id   UUID NOT NULL REFERENCES public.question_banks(id) ON DELETE RESTRICT,

  academic_year             TEXT NULL,
  department                TEXT NULL,
  subject_code              VARCHAR(20) NOT NULL,
  subject_name              TEXT NULL,
  name                      TEXT NOT NULL,

  -- What the user asked for (Spec §11)
  requested_part_a_count    INTEGER NOT NULL CHECK (requested_part_a_count >= 0),
  requested_part_bc_count   INTEGER NOT NULL CHECK (requested_part_bc_count >= 0),

  -- What was actually selected, preserving the ORIGINAL part of each pick
  -- (Spec §6 / §11)
  actual_part_a_count       INTEGER NOT NULL DEFAULT 0 CHECK (actual_part_a_count >= 0),
  actual_part_b_count       INTEGER NOT NULL DEFAULT 0 CHECK (actual_part_b_count >= 0),
  actual_part_c_count       INTEGER NOT NULL DEFAULT 0 CHECK (actual_part_c_count >= 0),
  total_questions           INTEGER NOT NULL DEFAULT 0 CHECK (total_questions >= 0),

  -- Final unit distribution of the reduced bank, shown before saving (Spec §8)
  unit_distribution         JSONB NULL,

  -- 'deterministic' | 'gemini' — how the subset was chosen (Spec §24)
  selection_method          VARCHAR(20) NOT NULL DEFAULT 'deterministic'
                             CHECK (selection_method IN ('deterministic', 'gemini')),

  status                    VARCHAR(20) NOT NULL DEFAULT 'Active'
                             CHECK (status IN ('Active', 'Archived')),

  created_by                UUID NULL,
  created_by_name           TEXT NULL,
  archived_at               TIMESTAMPTZ NULL,
  archived_by               UUID NULL,
  archived_by_name          TEXT NULL,
  archive_reason            TEXT NULL,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A bank can never be its own source.
  CONSTRAINT chk_iat_bank_not_self_source
    CHECK (source_question_bank_id IS DISTINCT FROM question_bank_id)
);

CREATE INDEX IF NOT EXISTS idx_iat_banks_source        ON public.iat_generated_question_banks (source_question_bank_id);
CREATE INDEX IF NOT EXISTS idx_iat_banks_question_bank ON public.iat_generated_question_banks (question_bank_id);
CREATE INDEX IF NOT EXISTS idx_iat_banks_status        ON public.iat_generated_question_banks (status);
CREATE INDEX IF NOT EXISTS idx_iat_banks_created_at    ON public.iat_generated_question_banks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iat_banks_identity      ON public.iat_generated_question_banks (academic_year, department, subject_code);

-- The human-readable name must be unique per source bank so a regenerated
-- bank can never overwrite an existing one (Spec §26).
CREATE UNIQUE INDEX IF NOT EXISTS uq_iat_banks_name_per_source
  ON public.iat_generated_question_banks (source_question_bank_id, name);

-- The bank name must also be unique across the whole subject, otherwise
-- "IAT Bank 01" could be created twice for different source banks.
CREATE UNIQUE INDEX IF NOT EXISTS uq_iat_banks_name_global
  ON public.iat_generated_question_banks (name);

-- Count integrity: total must always equal the sum of the actual parts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_iat_banks_total_consistent'
  ) THEN
    ALTER TABLE public.iat_generated_question_banks
      ADD CONSTRAINT chk_iat_banks_total_consistent
      CHECK (total_questions = actual_part_a_count + actual_part_b_count + actual_part_c_count);
  END IF;
END $$;

-- ============================================================
-- 3. TABLE: iat_generated_questions
--    Every generated question keeps a permanent link back to the exact
--    source question it was selected from (Spec §12).
--
--    The denormalised question_text / unit / original_part / marks / btl /
--    co / pi / difficulty columns are a VERBATIM COPY of the source row at
--    selection time. They are never used to override the original: the
--    authoritative text always comes from `questions` via source_question_id.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.iat_generated_questions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  generated_bank_id       UUID NOT NULL REFERENCES public.iat_generated_question_banks(id) ON DELETE CASCADE,

  -- THE provenance link. Points at the ORIGINAL `questions` row.
  source_question_id      UUID NOT NULL REFERENCES public.questions(id) ON DELETE RESTRICT,

  -- Convenience denormalisation of the source bank (read-only).
  source_question_bank_id UUID NOT NULL REFERENCES public.question_banks(id) ON DELETE RESTRICT,

  -- Snapshot of the source question at selection time.
  question_text           TEXT NOT NULL,
  unit                    INTEGER NULL,
  original_part           VARCHAR(10) NOT NULL CHECK (original_part IN ('Part A', 'Part B', 'Part C')),
  marks                   INTEGER NULL,
  btl                     TEXT NULL,
  co                      VARCHAR(10) NULL,
  pi                      TEXT NULL,
  difficulty              VARCHAR(10) NULL,
  source_question_number  TEXT NULL,

  -- Additional source metadata preserved for balancing / audit.
  blooms_level            VARCHAR(5) NULL,
  or_group_id             TEXT NULL,
  or_option               CHAR(1) NULL,
  subject_code            VARCHAR(20) NULL,
  source_page             INTEGER NULL,

  -- Display order inside the reduced bank.
  order_index             INTEGER NOT NULL DEFAULT 0,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spec §13 — a generated bank must never contain the same source question
-- twice. Enforced by the database, not just by application code.
CREATE UNIQUE INDEX IF NOT EXISTS uq_iat_questions_bank_source
  ON public.iat_generated_questions (generated_bank_id, source_question_id);

CREATE INDEX IF NOT EXISTS idx_iat_questions_source  ON public.iat_generated_questions (source_question_id);
CREATE INDEX IF NOT EXISTS idx_iat_questions_bank    ON public.iat_generated_questions (generated_bank_id);
CREATE INDEX IF NOT EXISTS idx_iat_questions_part    ON public.iat_generated_questions (generated_bank_id, original_part);
CREATE INDEX IF NOT EXISTS idx_iat_questions_unit    ON public.iat_generated_questions (generated_bank_id, unit);

-- order_index must be unique inside a bank.
CREATE UNIQUE INDEX IF NOT EXISTS uq_iat_questions_order
  ON public.iat_generated_questions (generated_bank_id, order_index);

-- ------------------------------------------------------------
-- 4. updated_at triggers
-- ------------------------------------------------------------
-- NOTE: the outer block uses $do$ and the nested function body uses $fn$.
-- Reusing $$ for both would close the outer block at the first inner $$.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'update_updated_at_column'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    CREATE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $fn$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $do$;

DROP TRIGGER IF EXISTS set_iat_banks_updated_at ON public.iat_generated_question_banks;
CREATE TRIGGER set_iat_banks_updated_at
  BEFORE UPDATE ON public.iat_generated_question_banks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 5. Provenance columns on the EXISTING usage-history table
--    Purely additive and nullable: existing End Semester / original-bank
--    behaviour is completely unchanged (Spec §17, §19).
--    Creating a generated IAT bank writes NOTHING here — usage is only
--    recorded when an IAT paper is finalized.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_usage_history' AND column_name = 'iat_generated_bank_id'
  ) THEN
    ALTER TABLE public.question_usage_history
      ADD COLUMN iat_generated_bank_id UUID NULL
      REFERENCES public.iat_generated_question_banks(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_usage_history' AND column_name = 'question_bank_source'
  ) THEN
    ALTER TABLE public.question_usage_history
      ADD COLUMN question_bank_source VARCHAR(20) NOT NULL DEFAULT 'ORIGINAL';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_usage_iat_bank ON public.question_usage_history (iat_generated_bank_id);

-- ============================================================
-- 6. Provenance columns on `generated_papers`
--    Records WHICH question bank a paper was built from (Spec §18, §27).
--    Additive + nullable, so End Semester papers are unaffected.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generated_papers' AND column_name = 'question_bank_source'
  ) THEN
    ALTER TABLE public.generated_papers
      ADD COLUMN question_bank_source VARCHAR(20) NOT NULL DEFAULT 'ORIGINAL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generated_papers' AND column_name = 'iat_generated_bank_id'
  ) THEN
    ALTER TABLE public.generated_papers
      ADD COLUMN iat_generated_bank_id UUID NULL
      REFERENCES public.iat_generated_question_banks(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generated_papers' AND column_name = 'iat_generated_bank_name'
  ) THEN
    ALTER TABLE public.generated_papers
      ADD COLUMN iat_generated_bank_name TEXT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_generated_papers_iat_bank
  ON public.generated_papers (iat_generated_bank_id);

-- ============================================================
-- 7. Row Level Security — same permissive pattern as migrations 001/005 so
--    a publishable/anon key is never blocked in addition to service_role.
-- ============================================================
ALTER TABLE IF EXISTS public.iat_generated_question_banks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on iat_generated_question_banks" ON public.iat_generated_question_banks;
CREATE POLICY "Allow all on iat_generated_question_banks" ON public.iat_generated_question_banks
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

ALTER TABLE IF EXISTS public.iat_generated_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on iat_generated_questions" ON public.iat_generated_questions;
CREATE POLICY "Allow all on iat_generated_questions" ON public.iat_generated_questions
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 8. Referential safety net
--    The source question of a generated question must belong to the source
--    question bank of the generated bank. Implemented as a trigger because
--    Postgres CHECK constraints cannot reference other tables.
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_iat_question_provenance()
RETURNS TRIGGER AS $$
DECLARE
  v_expected_bank UUID;
  v_actual_bank   UUID;
  v_actual_part   VARCHAR(10);
  v_actual_text   TEXT;
BEGIN
  -- Which source bank does the generated bank's header claim?
  SELECT source_question_bank_id
    INTO v_expected_bank
    FROM public.iat_generated_question_banks
   WHERE id = NEW.generated_bank_id;

  -- Which bank / part / text does the referenced source question actually have?
  SELECT q.question_bank_id, q.part, q.question_text
    INTO v_actual_bank, v_actual_part, v_actual_text
    FROM public.questions q
   WHERE q.id = NEW.source_question_id;

  IF v_actual_bank IS NULL THEN
    RAISE EXCEPTION
      'Source question % does not exist in the questions table.', NEW.source_question_id
      USING ERRCODE = '23503';
  END IF;

  IF v_actual_bank IS DISTINCT FROM v_expected_bank THEN
    RAISE EXCEPTION
      'Source question % belongs to question bank % but generated bank % expects bank %.',
      NEW.source_question_id, v_actual_bank, NEW.generated_bank_id, v_expected_bank
      USING ERRCODE = '23514';
  END IF;

  -- original_part must be the REAL part of the source question. A Part B
  -- question can never be relabelled as Part C (Spec §6).
  IF NEW.original_part IS DISTINCT FROM v_actual_part THEN
    RAISE EXCEPTION
      'original_part "%" does not match the source question''s part "%".',
      NEW.original_part, v_actual_part
      USING ERRCODE = '23514';
  END IF;

  IF NEW.question_text IS DISTINCT FROM v_actual_text THEN
    RAISE EXCEPTION
      'Generated question text does not match the source question text. Question text must be copied verbatim from the original question bank (Spec §2).'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_iat_question_provenance ON public.iat_generated_questions;
CREATE TRIGGER trg_iat_question_provenance
  BEFORE INSERT OR UPDATE ON public.iat_generated_questions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_iat_question_provenance();

-- ============================================================
-- 9. Useful read view — original bank statistics (Spec §25)
-- ============================================================
CREATE OR REPLACE VIEW public.question_bank_part_statistics AS
SELECT
  qb.id                AS question_bank_id,
  qb.subject_code,
  qb.subject_name,
  qb.academic_year,
  qb.department,
  qb.bank_type,
  COUNT(*) FILTER (WHERE q.part = 'Part A')      AS part_a_count,
  COUNT(*) FILTER (WHERE q.part = 'Part B')      AS part_b_count,
  COUNT(*) FILTER (WHERE q.part = 'Part C')      AS part_c_count,
  (COUNT(*) FILTER (WHERE q.part = 'Part B')
   + COUNT(*) FILTER (WHERE q.part = 'Part C'))  AS part_bc_count,
  COUNT(*)                                       AS total_questions
FROM public.question_banks qb
LEFT JOIN public.questions q ON q.question_bank_id = qb.id
GROUP BY qb.id, qb.subject_code, qb.subject_name,
         qb.academic_year, qb.department, qb.bank_type;
