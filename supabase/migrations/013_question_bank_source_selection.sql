-- ============================================================
-- Migration 013: Question Bank Source Selection (Original / Reduced)
--
-- Extends the EXISTING schema created by migrations 001-012. No new
-- bank table is created: `question_banks` already represents the
-- ORIGINAL banks, and `iat_generated_question_banks` /
-- `iat_generated_questions` already represent the REDUCED banks.
--
--   question_banks
--     + question_bank_type        'original' | 'reduced'
--   iat_generated_question_banks
--     + original_question_bank_id  (named alias of source_question_bank_id)
--     + subject_id / department_id / academic_year_id
--     + bank_type / question_bank_type  (always 'reduced')
--     + total_part_a / total_part_b / total_part_c
--   iat_generated_questions
--     + original_question_id      (the ORIGINAL questions.id it was selected from)
--   question_usage_history
--     + question_bank_id / question_bank_type / set_letter / paper_id
--     + created_by / created_by_name
--
-- IMPORTANT: every change here is ADDITIVE. No existing row is
-- deleted, no existing question text is modified, and the End
-- Semester flow is completely untouched. Running this file more than
-- once is safe.
--
-- Run in the Supabase SQL Editor.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- 1. question_banks.question_bank_type
--    The literal source discriminator required by the spec:
--    "original" for uploaded banks, "reduced" for screened banks.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_banks'
      AND column_name = 'question_bank_type'
  ) THEN
    ALTER TABLE public.question_banks
      ADD COLUMN question_bank_type VARCHAR(10) NULL;
  END IF;
END $$;

-- Backfill: every existing row is derived from bank_type.
UPDATE public.question_banks
   SET question_bank_type = CASE WHEN bank_type = 'IAT_GENERATED' THEN 'reduced' ELSE 'original' END
 WHERE question_bank_type IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_question_banks_question_bank_type'
  ) THEN
    ALTER TABLE public.question_banks
      ADD CONSTRAINT chk_question_banks_question_bank_type
      CHECK (question_bank_type IN ('original', 'reduced'));
  END IF;
END $$;

-- NOT NULL with a safe default so future inserts can never be ambiguous.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_banks'
      AND column_name = 'question_bank_type' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.question_banks
      ALTER COLUMN question_bank_type SET DEFAULT 'original';
    ALTER TABLE public.question_banks
      ALTER COLUMN question_bank_type SET NOT NULL;
  END IF;
END $$;

-- Keep question_bank_type consistent with the legacy bank_type discriminator.
CREATE OR REPLACE FUNCTION public.sync_question_bank_type()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.bank_type IS NOT NULL THEN
    NEW.question_bank_type := CASE WHEN NEW.bank_type = 'IAT_GENERATED' THEN 'reduced' ELSE 'original' END;
  ELSIF NEW.question_bank_type IS NULL THEN
    NEW.question_bank_type := 'original';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_question_bank_type ON public.question_banks;
CREATE TRIGGER trg_sync_question_bank_type
  BEFORE INSERT OR UPDATE OF bank_type, question_bank_type ON public.question_banks
  FOR EACH ROW EXECUTE FUNCTION public.sync_question_bank_type();

CREATE INDEX IF NOT EXISTS idx_question_banks_type ON public.question_banks (question_bank_type);

-- ------------------------------------------------------------
-- 2. iat_generated_question_banks — the reduced bank header
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'iat_generated_question_banks'
      AND column_name = 'original_question_bank_id'
  ) THEN
    ALTER TABLE public.iat_generated_question_banks
      ADD COLUMN original_question_bank_id UUID NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'iat_generated_question_banks'
      AND column_name = 'subject_id'
  ) THEN
    ALTER TABLE public.iat_generated_question_banks ADD COLUMN subject_id UUID NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'iat_generated_question_banks'
      AND column_name = 'department_id'
  ) THEN
    ALTER TABLE public.iat_generated_question_banks ADD COLUMN department_id UUID NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'iat_generated_question_banks'
      AND column_name = 'academic_year_id'
  ) THEN
    ALTER TABLE public.iat_generated_question_banks ADD COLUMN academic_year_id UUID NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'iat_generated_question_banks'
      AND column_name = 'bank_type'
  ) THEN
    ALTER TABLE public.iat_generated_question_banks
      ADD COLUMN bank_type VARCHAR(10) NOT NULL DEFAULT 'reduced';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'iat_generated_question_banks'
      AND column_name = 'question_bank_type'
  ) THEN
    ALTER TABLE public.iat_generated_question_banks
      ADD COLUMN question_bank_type VARCHAR(10) NOT NULL DEFAULT 'reduced';
  END IF;
END $$;

-- Backfill the named relationship column from the existing one.
UPDATE public.iat_generated_question_banks
   SET original_question_bank_id = source_question_bank_id
 WHERE original_question_bank_id IS NULL;

-- A reduced bank is ALWAYS a reduced bank.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_iat_banks_bank_type_reduced'
  ) THEN
    ALTER TABLE public.iat_generated_question_banks
      ADD CONSTRAINT chk_iat_banks_bank_type_reduced
      CHECK (bank_type = 'reduced' AND question_bank_type = 'reduced');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_iat_banks_original_bank'
  ) THEN
    ALTER TABLE public.iat_generated_question_banks
      ADD CONSTRAINT fk_iat_banks_original_bank
      FOREIGN KEY (original_question_bank_id)
      REFERENCES public.question_banks(id)
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END $$;

-- original_question_bank_id can never diverge from source_question_bank_id.
CREATE OR REPLACE FUNCTION public.sync_iat_bank_original_reference()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_question_bank_id IS NOT NULL THEN
    NEW.original_question_bank_id := NEW.source_question_bank_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_iat_bank_original_ref ON public.iat_generated_question_banks;
CREATE TRIGGER trg_sync_iat_bank_original_ref
  BEFORE INSERT OR UPDATE OF source_question_bank_id, original_question_bank_id
  ON public.iat_generated_question_banks
  FOR EACH ROW EXECUTE FUNCTION public.sync_iat_bank_original_reference();

-- Convenience read-only projections of the per-part totals.
ALTER TABLE public.iat_generated_question_banks
  DROP COLUMN IF EXISTS total_part_a;
ALTER TABLE public.iat_generated_question_banks
  ADD COLUMN IF NOT EXISTS total_part_a INTEGER
  GENERATED ALWAYS AS (actual_part_a_count) STORED;
ALTER TABLE public.iat_generated_question_banks
  DROP COLUMN IF EXISTS total_part_b;
ALTER TABLE public.iat_generated_question_banks
  ADD COLUMN IF NOT EXISTS total_part_b INTEGER
  GENERATED ALWAYS AS (actual_part_b_count) STORED;
ALTER TABLE public.iat_generated_question_banks
  DROP COLUMN IF EXISTS total_part_c;
ALTER TABLE public.iat_generated_question_banks
  ADD COLUMN IF NOT EXISTS total_part_c INTEGER
  GENERATED ALWAYS AS (actual_part_c_count) STORED;

-- Resolve the subject / department / academic year for existing rows where possible.
DO $$
DECLARE
  r RECORD;
  v_subject UUID;
  v_year    UUID;
  v_dept    UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT b.id, b.subject_code, b.academic_year, b.department
      FROM public.iat_generated_question_banks b
     WHERE b.subject_id IS NULL
  LOOP
    SELECT s.id INTO v_subject
      FROM public.subjects s
     WHERE s.subject_code = r.subject_code
     ORDER BY s.created_at DESC
     LIMIT 1;

    SELECT y.id INTO v_year
      FROM public.academic_years y
     WHERE y.year_label = r.academic_year
     LIMIT 1;

    SELECT d.id INTO v_dept
      FROM public.departments d
     WHERE d.department_code = r.department
     LIMIT 1;

    UPDATE public.iat_generated_question_banks
       SET subject_id        = v_subject,
           academic_year_id  = v_year,
           department_id     = v_dept
     WHERE id = r.id;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_iat_banks_subject  ON public.iat_generated_question_banks (subject_id);
CREATE INDEX IF NOT EXISTS idx_iat_banks_year     ON public.iat_generated_question_banks (academic_year_id);
CREATE INDEX IF NOT EXISTS idx_iat_banks_dept     ON public.iat_generated_question_banks (department_id);

-- ------------------------------------------------------------
-- 3. iat_generated_questions.original_question_id
--    Spec §12: "Reduced Question: id = RBQ123, original_question_id = OQ456".
--    Generated column so it can never drift from source_question_id.
-- ------------------------------------------------------------
ALTER TABLE public.iat_generated_questions
  DROP COLUMN IF EXISTS original_question_id;
ALTER TABLE public.iat_generated_questions
  ADD COLUMN IF NOT EXISTS original_question_id UUID
  GENERATED ALWAYS AS (source_question_id) STORED;

CREATE INDEX IF NOT EXISTS idx_iat_questions_original ON public.iat_generated_questions (original_question_id);

-- ------------------------------------------------------------
-- 4. question_usage_history — full provenance (Spec §11)
--    Usage is STILL only written on finalization. Creating or
--    deleting a reduced bank never writes a row here.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_usage_history'
      AND column_name = 'question_bank_id'
  ) THEN
    ALTER TABLE public.question_usage_history ADD COLUMN question_bank_id UUID NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_usage_history'
      AND column_name = 'question_bank_type'
  ) THEN
    ALTER TABLE public.question_usage_history
      ADD COLUMN question_bank_type VARCHAR(10) NOT NULL DEFAULT 'original';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_usage_history'
      AND column_name = 'set_letter'
  ) THEN
    ALTER TABLE public.question_usage_history ADD COLUMN set_letter VARCHAR(2) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_usage_history'
      AND column_name = 'paper_id'
  ) THEN
    ALTER TABLE public.question_usage_history ADD COLUMN paper_id UUID NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_usage_history'
      AND column_name = 'created_by'
  ) THEN
    ALTER TABLE public.question_usage_history ADD COLUMN created_by UUID NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_usage_history'
      AND column_name = 'created_by_name'
  ) THEN
    ALTER TABLE public.question_usage_history ADD COLUMN created_by_name TEXT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_usage_question_bank_type'
  ) THEN
    ALTER TABLE public.question_usage_history
      ADD CONSTRAINT chk_usage_question_bank_type
      CHECK (question_bank_type IN ('original', 'reduced'));
  END IF;
END $$;

-- Existing rows can only ever have come from an original bank.
UPDATE public.question_usage_history
   SET question_bank_source = 'original'
 WHERE question_bank_source IS DISTINCT FROM 'original';

CREATE INDEX IF NOT EXISTS idx_usage_bank    ON public.question_usage_history (question_bank_id);
CREATE INDEX IF NOT EXISTS idx_usage_paper   ON public.question_usage_history (paper_id);
CREATE INDEX IF NOT EXISTS idx_usage_type    ON public.question_usage_history (question_bank_type);

-- ------------------------------------------------------------
-- 5. generated_papers — record WHICH bank the paper used (Spec §8)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generated_papers'
      AND column_name = 'question_bank_id'
  ) THEN
    ALTER TABLE public.generated_papers ADD COLUMN question_bank_id UUID NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generated_papers'
      AND column_name = 'question_bank_type'
  ) THEN
    ALTER TABLE public.generated_papers
      ADD COLUMN question_bank_type VARCHAR(10) NOT NULL DEFAULT 'original';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_generated_papers_bank_type'
  ) THEN
    ALTER TABLE public.generated_papers
      ADD CONSTRAINT chk_generated_papers_bank_type
      CHECK (question_bank_type IN ('original', 'reduced'));
  END IF;
END $$;

-- End Semester papers are always 'original'. Enforced, not assumed.
UPDATE public.generated_papers
   SET question_bank_type = 'original',
       question_bank_source = 'ORIGINAL',
       iat_generated_bank_id = NULL
 WHERE exam_type = 'End Semester Examination'
   AND question_bank_type IS DISTINCT FROM 'original';

CREATE INDEX IF NOT EXISTS idx_generated_papers_bank ON public.generated_papers (question_bank_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_generated_papers_endsem_original'
  ) THEN
    ALTER TABLE public.generated_papers
      ADD CONSTRAINT chk_generated_papers_endsem_original
      CHECK (exam_type <> 'End Semester Examination' OR question_bank_type = 'original');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 6. Read view: both bank kinds in one place (Spec §13, §14)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.question_bank_source_directory AS
SELECT
  b.id                        AS question_bank_id,
  COALESCE(b.question_bank_type,
           CASE WHEN b.bank_type = 'IAT_GENERATED' THEN 'reduced' ELSE 'original' END) AS question_bank_type,
  b.bank_type                 AS legacy_bank_type,
  b.parent_question_bank_id,
  b.subject_id,
  b.subject_code,
  b.subject_name,
  b.academic_year,
  b.academic_year_id,
  b.department,
  b.department_id,
  b.file_name,
  b.status,
  b.created_at,
  b.created_by,
  b.created_by_name,
  g.id                       AS generated_bank_id,
  g.created_at               AS reduced_created_at,
  g.name                     AS reduced_bank_name,
  g.total_questions          AS reduced_total_questions,
  g.actual_part_a_count      AS reduced_part_a,
  g.actual_part_b_count      AS reduced_part_b,
  g.actual_part_c_count      AS reduced_part_c,
  g.unit_distribution        AS reduced_unit_distribution,
  COUNT(q.id)                                          AS total_questions,
  COUNT(q.id) FILTER (WHERE q.part = 'Part A')        AS part_a_count,
  COUNT(q.id) FILTER (WHERE q.part = 'Part B')        AS part_b_count,
  COUNT(q.id) FILTER (WHERE q.part = 'Part C')        AS part_c_count
FROM public.question_banks b
LEFT JOIN public.iat_generated_question_banks g
       ON g.question_bank_id = b.id
LEFT JOIN public.questions q
       ON q.question_bank_id = b.id
GROUP BY b.id, b.bank_type, b.question_bank_type, b.parent_question_bank_id,
         b.subject_id, b.subject_code, b.subject_name, b.academic_year,
         b.academic_year_id, b.department, b.department_id, b.file_name,
         b.status, b.created_at, b.created_by, b.created_by_name,
         g.id, g.created_at, g.name, g.total_questions, g.actual_part_a_count,
         g.actual_part_b_count, g.actual_part_c_count, g.unit_distribution;
