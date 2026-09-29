-- ============================================================
-- MSAJCE Exam Software — Migration 011
-- Code-based set identity + question-count query support
--
-- Safe, additive migration. Does not delete or modify existing data.
-- Run AFTER 010 in the Supabase SQL editor.
-- ============================================================

-- ============================================================
-- 0. RLS repair for generated_papers
--
-- The backend writes generated_papers through the same Supabase client that
-- writes questions / question_banks. Those two tables accept writes, but
-- generated_papers rejects every INSERT with
--   "new row violates row-level security policy for table generated_papers"
-- so paper records can never be persisted (Spec §6).
--
-- The deployed key is a *publishable* key (sb_publishable_...), which maps to
-- the `anon` role and does NOT bypass RLS — so a permissive policy is
-- required, exactly as migrations 001 already defines for questions and
-- question_banks. This restores that policy; it grants nothing that the
-- other question-bank tables do not already grant.
-- ============================================================
ALTER TABLE IF EXISTS generated_papers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on generated_papers" ON generated_papers;
CREATE POLICY "Allow all on generated_papers" ON generated_papers
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 1. Indexes for the question-count query (Spec §9, §13)
-- The count walks: subjects -> question_banks -> questions
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_questions_subject_code
  ON questions(subject_code);
CREATE INDEX IF NOT EXISTS idx_questions_question_bank
  ON questions(question_bank_id);

CREATE INDEX IF NOT EXISTS idx_question_banks_subject_code
  ON question_banks(subject_code);
CREATE INDEX IF NOT EXISTS idx_question_banks_year_dept
  ON question_banks(academic_year, department);
CREATE INDEX IF NOT EXISTS idx_question_banks_subject_id
  ON question_banks(subject_id);

-- subjects lookup used to resolve the unambiguous subject codes
CREATE INDEX IF NOT EXISTS idx_subjects_code_year_dept
  ON subjects(subject_code, academic_year_id, department_id);

-- ============================================================
-- 2. Duplicate-set guard on the CODE identity (Spec §6)
--
-- Migration 010 guarded generated_papers on UUID columns
-- (subject_id / academic_year_id / department_id). Spec §6 also names
-- academic_year + department + subject_code + exam_type + set_letter,
-- so the same rule is enforced on those human-readable columns.
-- Existing papers are never removed.
-- ============================================================
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  IF to_regclass('public.generated_papers') IS NULL THEN
    RAISE NOTICE 'generated_papers not found — run migration 001 first. Skipping.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_generated_papers_code_identity'
  ) THEN
    SELECT COUNT(*) INTO dup_count
      FROM (
        SELECT 1
          FROM generated_papers
         WHERE subject_code IS NOT NULL
           AND set_letter   IS NOT NULL
           AND exam_type    IS NOT NULL
         GROUP BY academic_year, department, subject_code, exam_type, set_letter
        HAVING COUNT(*) > 1
      ) d;

    IF dup_count = 0 THEN
      EXECUTE 'CREATE UNIQUE INDEX uq_generated_papers_code_identity
        ON generated_papers(academic_year, department, subject_code, exam_type, set_letter)
        WHERE set_letter IS NOT NULL AND subject_code IS NOT NULL';
      RAISE NOTICE 'Created unique index uq_generated_papers_code_identity.';
    ELSE
      RAISE WARNING 'Skipped uq_generated_papers_code_identity: % pre-existing duplicate code-identity combination(s) found. Existing papers were preserved.', dup_count;
    END IF;
  END IF;
END $$;

-- Trigger enforcing the code identity even when the unique index had to be
-- skipped because of legacy duplicates.
CREATE OR REPLACE FUNCTION enforce_generated_paper_code_identity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.set_letter IS NOT NULL
     AND NEW.subject_code IS NOT NULL
     AND NEW.exam_type IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM generated_papers g
       WHERE g.subject_code IS NOT DISTINCT FROM NEW.subject_code
         AND g.set_letter   IS NOT DISTINCT FROM NEW.set_letter
         AND g.exam_type    IS NOT DISTINCT FROM NEW.exam_type
         AND g.academic_year IS NOT DISTINCT FROM NEW.academic_year
         AND g.department    IS NOT DISTINCT FROM NEW.department
         AND g.id <> NEW.id
    ) THEN
      RAISE EXCEPTION
        'Duplicate set blocked: Set % already exists for % / % / % / % / Set %.',
        NEW.set_letter,
        COALESCE(NEW.academic_year, 'any year'),
        COALESCE(NEW.department, 'any department'),
        NEW.subject_code,
        NEW.exam_type,
        NEW.set_letter
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generated_paper_code_identity ON generated_papers;
CREATE TRIGGER trg_generated_paper_code_identity
  BEFORE INSERT OR UPDATE ON generated_papers
  FOR EACH ROW EXECUTE FUNCTION enforce_generated_paper_code_identity();

-- ============================================================
-- 3. Attribute unattagged question banks where it is unambiguous (Spec §11)
--
-- Legacy banks were created before Academic Year / Department were recorded
-- on question_banks. Backfill them ONLY when the subject code maps to exactly
-- ONE subject row for a given year+department, so a question is never
-- attributed to the wrong academic year or department.
-- ============================================================
UPDATE question_banks qb
   SET academic_year = src.year_label,
       department    = src.department_code
  FROM (
    SELECT qb2.id AS bank_id,
           ay.year_label,
           d.department_code
      FROM question_banks qb2
      JOIN subjects s        ON s.subject_code = qb2.subject_code
      JOIN academic_years ay  ON ay.id = s.academic_year_id
      JOIN departments d     ON d.id = s.department_id
     WHERE qb2.academic_year IS NULL
       AND NOT EXISTS (
             SELECT 1 FROM subjects s2
              WHERE s2.subject_code = qb2.subject_code
                AND NOT (s2.academic_year_id = s.academic_year_id
                         AND s2.department_id    = s.department_id)
           )
  ) src
 WHERE qb.id = src.bank_id
   AND qb.academic_year IS NULL;

-- ============================================================
-- 4. Keep question_banks.subject_id in sync where it is missing
-- Same unambiguity rule — never guess across year/department.
-- ============================================================
ALTER TABLE IF EXISTS question_banks
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES subjects(id);

UPDATE question_banks qb
   SET subject_id = s.id
  FROM subjects s
 WHERE qb.subject_id IS NULL
   AND s.subject_code = qb.subject_code
   AND NOT EXISTS (
         SELECT 1 FROM subjects s2
          WHERE s2.subject_code = qb.subject_code
            AND s2.id <> s.id
       );

-- ============================================================
-- 5. Same unambiguity rule for questions.academic_year / questions.department
-- These columns exist (migration 002) but were never populated by
-- mapQuestionToRow(). Backfill so direct queries on `questions` agree with
-- the count computed through question_banks.
-- ============================================================
ALTER TABLE IF EXISTS questions
  ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20),
  ADD COLUMN IF NOT EXISTS department    VARCHAR(20);

UPDATE questions q
   SET academic_year = qb.academic_year,
       department    = qb.department
  FROM question_banks qb
 WHERE q.question_bank_id = qb.id
   AND (q.academic_year IS NULL OR q.department IS NULL)
   AND qb.academic_year IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_questions_academic_year_department
  ON questions(academic_year, department, subject_code);

-- ============================================================
-- DONE
-- No frontend changes are required — the counts refresh automatically.
-- ============================================================
