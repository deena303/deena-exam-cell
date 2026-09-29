-- Minimal hotfix: replaces the IAT provenance trigger function.
-- Section 8 of supabase/migrations/012_iat_question_bank_generator.sql
-- The bug: the query aliased `questions` as `q` but selected `qb.id`.
-- Safe to run repeatedly.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_iat_question_provenance()
RETURNS TRIGGER AS $fn$
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
  -- FIX: was `qb.id`, the table alias is `q`.
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

  -- original_part must be the REAL part of the source question.
  -- A Part B question can never be relabelled as Part C.
  IF NEW.original_part IS DISTINCT FROM v_actual_part THEN
    RAISE EXCEPTION
      'original_part "%" does not match the source question''s part "%".',
      NEW.original_part, v_actual_part
      USING ERRCODE = '23514';
  END IF;

  -- The question text must be copied VERBATIM from the original question.
  IF NEW.question_text IS DISTINCT FROM v_actual_text THEN
    RAISE EXCEPTION
      'Generated question text does not match the source question text. Question text must be copied verbatim from the original question bank.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_iat_question_provenance ON public.iat_generated_questions;
CREATE TRIGGER trg_iat_question_provenance
  BEFORE INSERT OR UPDATE ON public.iat_generated_questions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_iat_question_provenance();

-- -------------------------------------------------------------------
-- Verify the function body is the corrected one.
-- Expect: the text 'SELECT q.question_bank_id' to be visible.
-- -------------------------------------------------------------------
SELECT position('SELECT q.question_bank_id' in pg_get_functiondef(
  'public.enforce_iat_question_provenance()'::regprocedure
)) > 0 AS function_body_is_corrected;
