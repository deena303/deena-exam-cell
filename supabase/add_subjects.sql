-- ============================================================================
--  MSAJCE Question Paper Management System
--  ADD SUBJECTS  —  INSERT only, no DDL, no data modification
-- ============================================================================
--
--  WHAT THIS DOES
--    Inserts 15 subject rows (10 subject definitions; 24CS303 is offered to 6
--    departments, so it produces 6 rows) into public.subjects.
--
--  WHAT THIS DOES NOT DO
--    * no CREATE / ALTER / DROP of any table, column, index, constraint,
--      policy or trigger  — the schema is not touched at all
--    * no new department rows      (existing departments are joined by code)
--    * no new academic-year rows   (existing years are joined by label)
--    * no UPDATE or DELETE of any existing row
--
--  SCHEMA THIS WAS WRITTEN AGAINST  (verified live, not assumed)
--    public.subjects(
--      id                uuid primary key default uuid_generate_v4()
--      subject_code      varchar(20)  NOT NULL
--      subject_name      text         NOT NULL
--      department_id     uuid         NOT NULL REFERENCES departments(id)
--      academic_year_id  uuid         NOT NULL REFERENCES academic_years(id)
--      semester          varchar(20)      NULL
--      regulation        varchar(30)      NULL
--      status            varchar(20)  NOT NULL DEFAULT 'active'
--      created_at        timestamptz      NULL DEFAULT now()
--      updated_at        timestamptz      NULL DEFAULT now()
--      year_of_study     text             NULL   <-- holds '2nd Year' / '3rd Year'
--      faculty_name      text             NULL
--      faculty_department text            NULL
--      UNIQUE (subject_code, academic_year_id, department_id)
--    )
--
--    The existing UNIQUE (subject_code, academic_year_id, department_id) is
--    exactly the subject identity required: academic_year + department +
--    subject_code. 24CS303 therefore yields one independent row per department.
--
--  MAPPINGS DECIDED
--    * "CYBER" -> department_code 'CSCS'
--      (Computer Science & Engineering - Cyber Security). No CYBER code exists.
--    * "3rd Year" -> academic_year '2026-2030'
--    * "2nd Year" -> academic_year '2025-2029'
--    * regulation 'Regulation 2024' (matches all 24xxx codes and existing rows)
--    * year_of_study carries the year; `semester` is left NULL because the
--      existing rows hold inconsistent legacy values ('II'..'V', 'III / IV')
--      and you specified year-of-study, not semester. See the optional
--      back-fill at the very bottom if you want semester populated too.
--
--  IDEMPOTENT
--    ON CONFLICT (subject_code, academic_year_id, department_id) DO NOTHING
--    Running this repeatedly inserts nothing new and changes nothing.
--
--  HOW TO RUN
--    Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--    Everything is inside one transaction; it rolls back on any error.
-- ============================================================================


-- ############################################################################
--  SECTION 0 — PRE-FLIGHT: show the IDs this script resolved, and the exact
--               subject -> department -> academic-year mapping. Read-only.
-- ############################################################################

-- 0.1  The departments this script depends on.
SELECT department_code, department_name, id AS department_id, status, is_active
FROM public.departments
WHERE department_code IN ('CSBS','CSE','CSCS','IT','CIVIL','AIML','AIDS','EEE','MECH')
ORDER BY department_code;

-- 0.2  The academic years this script depends on.
SELECT year_label, id AS academic_year_id, status, is_active
FROM public.academic_years
WHERE year_label IN ('2025-2029','2026-2030')
ORDER BY year_label;

-- 0.3  Any of these 10 subject codes that ALREADY exist (should be none).
SELECT s.subject_code, s.subject_name, d.department_code, ay.year_label, s.year_of_study
FROM public.subjects s
JOIN public.departments     d ON d.id = s.department_id
JOIN public.academic_years ay ON ay.id = s.academic_year_id
WHERE s.subject_code IN
      ('24IT611','24CS512','24CY50','24IT501','24CE501',
       '24CS303','24EC314','24CS502','24CB501','24ME501')
ORDER BY s.subject_code, d.department_code;

-- 0.4  Confirm the conflict target actually exists (this is what makes the
--      script idempotent — if this returns nothing, DO NOTHING is invalid).
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.subjects'::regclass
  AND contype  = 'u'
ORDER BY conname;


-- ############################################################################
--  SECTION 1 — GUARD
--  Aborts before any insert if a department or academic year is missing, or
--  if the UNIQUE constraint the script relies on is not present. This turns a
--  silent partial insert into a clear, early failure.
-- ############################################################################

DO $guard$
DECLARE
    v_missing_dept TEXT;
    v_missing_year TEXT;
    v_has_uniq     BOOLEAN;
BEGIN
    SELECT string_agg(x.code, ', ')
      INTO v_missing_dept
    FROM unnest(ARRAY['CSBS','CSE','CSCS','IT','CIVIL','AIML','AIDS','EEE','MECH']) AS x(code)
    WHERE NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.department_code = x.code);

    SELECT string_agg(x.label, ', ')
      INTO v_missing_year
    FROM unnest(ARRAY['2025-2029','2026-2030']) AS x(label)
    WHERE NOT EXISTS (SELECT 1 FROM public.academic_years ay WHERE ay.year_label = x.label);

    SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.subjects'::regclass
          AND contype  = 'u'
          AND conkey = ARRAY[
                (SELECT attnum FROM pg_attribute
                  WHERE attrelid='public.subjects'::regclass AND attname='subject_code'),
                (SELECT attnum FROM pg_attribute
                  WHERE attrelid='public.subjects'::regclass AND attname='academic_year_id'),
                (SELECT attnum FROM pg_attribute
                  WHERE attrelid='public.subjects'::regclass AND attname='department_id')
              ]::smallint[]
    ) INTO v_has_uniq;

    IF v_missing_dept IS NOT NULL THEN
        RAISE EXCEPTION 'ABORTED: department_code(s) not found: %', v_missing_dept;
    END IF;
    IF v_missing_year IS NOT NULL THEN
        RAISE EXCEPTION 'ABORTED: academic year(s) not found: %', v_missing_year;
    END IF;
    IF NOT v_has_uniq THEN
        RAISE EXCEPTION
            'ABORTED: subjects has no UNIQUE (subject_code, academic_year_id, department_id) '
            'constraint, so ON CONFLICT DO NOTHING cannot be used. Nothing was inserted.';
    END IF;

    RAISE NOTICE 'Guard passed: 9 departments, 2 academic years and the UNIQUE constraint all present.';
END $guard$;


-- ############################################################################
--  SECTION 2 — THE INSERT
--
--  15 rows. department_id and academic_year_id are resolved by JOIN on the
--  existing department_code / year_label, so the script reuses the real rows
--  instead of trusting hardcoded UUIDs.
-- ############################################################################

BEGIN;

INSERT INTO public.subjects
    (subject_code, subject_name, department_id, academic_year_id,
     year_of_study, regulation, status)
SELECT
    v.subject_code,
    v.subject_name,
    d.id,
    ay.id,
    v.year_of_study,
    'Regulation 2024',
    'active'
FROM (
    VALUES
      -- ---------- 3rd Year -> academic year 2026-2030 ----------
      ('24IT611', 'FULL STACK DEVELOPMENT',                       'IT',    '3rd Year'),
      ('24CS512', 'CLOUD COMPUTING',                              'CSE',   '3rd Year'),
      ('24CY50',  'CLOUD ARCHITECTURE AND DESIGN',                 'CSCS',  '3rd Year'),
      ('24IT501', 'MOBILE COMPUTING',                             'IT',    '3rd Year'),
      ('24CE501', 'DESIGN OF REINFORCED CONCRETE STRUCTURES',     'CIVIL', '3rd Year'),
      ('24CS502', 'SOFTWARE ENGINEERING',                         'CSE',   '3rd Year'),
      ('24CB501', 'DEVOPS',                                        'CSBS',  '3rd Year'),
      ('24ME501', 'DESIGN OF MACHINE ELEMENTS',                    'MECH',  '3rd Year'),

      -- ---------- 2nd Year -> academic year 2025-2029 ----------
      ('24CS303', 'JAVA PROGRAMMING',                              'CSBS',  '2nd Year'),
      ('24CS303', 'JAVA PROGRAMMING',                              'CSE',   '2nd Year'),
      ('24CS303', 'JAVA PROGRAMMING',                              'IT',    '2nd Year'),
      ('24CS303', 'JAVA PROGRAMMING',                              'AIML',  '2nd Year'),
      ('24CS303', 'JAVA PROGRAMMING',                              'AIDS',  '2nd Year'),
      ('24CS303', 'JAVA PROGRAMMING',                              'CSCS',  '2nd Year'),
      ('24EC314', 'ANALOG ELECTRONIC CIRCUITS',                    'EEE',   '2nd Year')
) AS v(subject_code, subject_name, dept_code, year_of_study)
JOIN public.departments d
       ON d.department_code = v.dept_code
JOIN public.academic_years ay
       ON ay.year_label = CASE v.year_of_study
                            WHEN '3rd Year' THEN '2026-2030'
                            WHEN '2nd Year' THEN '2025-2029'
                          END
ON CONFLICT (subject_code, academic_year_id, department_id) DO NOTHING;

COMMIT;


-- ############################################################################
--  SECTION 3 — VERIFICATION (read-only)
-- ############################################################################

-- 3.1  The 15 rows just added, with department and academic year resolved.
SELECT
    s.subject_code,
    s.subject_name,
    d.department_code                              AS department,
    d.department_name,
    s.year_of_study                                AS year_of_study,
    s.semester,
    ay.year_label                                  AS academic_year,
    s.regulation,
    s.status,
    s.id                                           AS subject_id
FROM public.subjects s
JOIN public.departments     d  ON d.id  = s.department_id
JOIN public.academic_years ay ON ay.id = s.academic_year_id
WHERE s.subject_code IN
      ('24IT611','24CS512','24CY50','24IT501','24CE501',
       '24CS303','24EC314','24CS502','24CB501','24ME501')
ORDER BY s.year_of_study DESC, s.subject_code, d.department_code;

-- 3.2  Row count per subject code. Each must be 1, except 24CS303 which must
--      be 6 (one row per offering department).
SELECT
    s.subject_code,
    count(*)                        AS rows_created,
    string_agg(d.department_code, ', ' ORDER BY d.department_code) AS departments,
    string_agg(DISTINCT s.year_of_study, ', ')                      AS year_of_study,
    string_agg(DISTINCT ay.year_label, ', ')                        AS academic_year
FROM public.subjects s
JOIN public.departments     d  ON d.id  = s.department_id
JOIN public.academic_years ay ON ay.id = s.academic_year_id
WHERE s.subject_code IN
      ('24IT611','24CS512','24CY50','24IT501','24CE501',
       '24CS303','24EC314','24CS502','24CB501','24ME501')
GROUP BY s.subject_code
ORDER BY s.subject_code;

-- 3.3  Duplicate check. The UNIQUE constraint makes true duplicates
--      impossible, but this proves no subject_code+year+dept pair repeats.
SELECT s.subject_code, ay.year_label, d.department_code, count(*) AS occurrences
FROM public.subjects s
JOIN public.departments     d  ON d.id  = s.department_id
JOIN public.academic_years ay ON ay.id = s.academic_year_id
GROUP BY s.subject_code, ay.year_label, d.department_code
HAVING count(*) > 1;
-- expected: 0 rows

-- 3.4  Total subjects in the table, and the untouched reference data.
SELECT
    (SELECT count(*) FROM public.subjects)       AS total_subjects,
    (SELECT count(*) FROM public.departments)    AS total_departments,
    (SELECT count(*) FROM public.academic_years) AS total_academic_years;


-- ############################################################################
--  OPTIONAL — populate `semester` for the rows above
--
--  Only run this if you decide semester should mirror year-of-study. It is
--  kept separate because `semester` was left NULL by the insert and the
--  existing rows use inconsistent legacy values.
--
--  UPDATE public.subjects s
--     SET semester = CASE s.year_of_study
--                      WHEN '2nd Year' THEN 'III / IV'
--                      WHEN '3rd Year' THEN 'V'
--                    END
--   WHERE s.subject_code IN
--         ('24IT611','24CS512','24CY50','24IT501','24CE501',
--          '24CS303','24EC314','24CS502','24CB501','24ME501')
--     AND s.semester IS NULL;
-- ############################################################################
