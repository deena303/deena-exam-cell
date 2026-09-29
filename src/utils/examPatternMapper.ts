/**
 * Exam Pattern Mapping (Spec §1)
 *
 * The editable pattern configuration lives in the `exam_pattern_configs`
 * table. This module converts between the database row shape and the
 * `ExamPattern` shape used by the UI and the paper generator, so the IAT
 * pattern is never hardcoded in the frontend.
 */
import type { ExamPattern, ExamPatternSection, ExamType } from '../types';
import type {
  ExamPatternConfigRecord,
  ExamPatternPartBConfig,
  ExamPatternSectionConfig
} from '../services/authApi';

export const EXAM_TYPE_ORDER: ExamType[] = [
  'Internal Assessment I',
  'Internal Assessment II',
  'End Semester Examination'
];

export const EXAM_TYPE_META: Record<ExamType, {
  title: string;
  subtitle: string;
  badge: string;
  badgeCls: string;
  accent: string;
  localId: string;
  defaultUnits: number[];
}> = {
  'Internal Assessment I': {
    title: 'Internal Assessment I',
    subtitle: 'First 2½ Units — Part A short answer + Part B sectioned choice',
    badge: 'Continuous Assessment',
    badgeCls: 'bg-[#FFF0F3] text-[#D71945]',
    accent: '#D71945',
    localId: 'pat-ia',
    defaultUnits: [1, 2, 3]
  },
  'Internal Assessment II': {
    title: 'Internal Assessment II',
    subtitle: 'Remaining 2½ Units — Part A short answer + Part B sectioned choice',
    badge: 'Continuous Assessment',
    badgeCls: 'bg-[#FFF0F3] text-[#D71945]',
    accent: '#D71945',
    localId: 'pat-ia2',
    defaultUnits: [3, 4, 5]
  },
  'End Semester Examination': {
    title: 'End Semester Exam',
    subtitle: 'Comprehensive 5-Unit Examination (Autonomous Pattern)',
    badge: 'Summative Assessment',
    badgeCls: 'bg-purple-50 text-purple-700',
    accent: '#7C3AED',
    localId: 'pat-endsem',
    defaultUnits: [1, 2, 3, 4, 5]
  }
};

const num = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** DB row → ExamPattern */
export function dbConfigToExamPattern(row: ExamPatternConfigRecord): ExamPattern {
  const partA = row.part_a_config || ({} as any);
  const partB: ExamPatternPartBConfig = row.part_b_config || ({ format: 'sections', marks_per_question: 13 } as any);

  const sections: ExamPatternSectionConfig[] = Array.isArray(partB.sections) && partB.sections.length > 0
    ? partB.sections
    : [
      { name: 'Section A', display_questions: 3, answer_count: 2, unit_pool: [1, 2], instruction: 'Answer any two Questions' },
      { name: 'Section B', display_questions: 3, answer_count: 2, unit_pool: [2, 3], instruction: 'Answer any two Questions' }
    ];

  const examPatternSections: ExamPatternSection[] = sections.map(s => ({
    name: s.name || 'Section',
    display_questions: num(s.display_questions, 3),
    answer_count: num(s.answer_count, 2),
    unit_pool: Array.isArray(s.unit_pool) ? s.unit_pool.map(Number) : [],
    instruction: s.instruction || `Answer any ${num(s.answer_count, 2)} Questions`
  }));

  const partAInstructions = partA.instruction || 'Answer all Questions';

  return {
    id: EXAM_TYPE_META[row.exam_type as ExamType]?.localId || row.id,
    examType: row.exam_type as ExamType,
    examName: row.exam_name,
    totalMarks: num(row.max_marks, 60),
    duration: row.duration,
    description: `${row.exam_name} — ${row.max_marks} Marks, ${row.duration}`,
    regulation: row.regulation || 'Regulation 2024',
    showBlCoPI: row.show_bl_co_pi !== false,
    showCourseObjectives: row.show_course_obj === true,
    instructions: row.instructions || undefined,
    partA: {
      totalQuestions: num(partA.count, 4),
      marksPerQuestion: num(partA.marks_per_question, 2),
      choiceNote: partAInstructions,
      instruction: partAInstructions,
      questionStart: num(partA.question_start, 1),
      unitDistribution: partA.unit_distribution || undefined,
      unitsPerQuestion: partA.units_per_question ? num(partA.units_per_question, 1) : undefined
    },
    partB: {
      format: partB.format === 'or_choice' ? 'or_choice' : 'sections',
      sections: examPatternSections,
      sectionA: {
        totalQuestions: num(examPatternSections[0]?.display_questions, 3),
        answerCount: num(examPatternSections[0]?.answer_count, 2),
        marksPerQuestion: num(partB.marks_per_question, 13)
      },
      sectionB: examPatternSections[1]
        ? {
          totalQuestions: num(examPatternSections[1].display_questions, 3),
          answerCount: num(examPatternSections[1].answer_count, 2),
          marksPerQuestion: num(partB.marks_per_question, 13)
        }
        : undefined,
      orQuestionsCount: num(partB.or_pairs, 5),
      marksPerQuestion: num(partB.marks_per_question, 13),
      questionStart: num(partB.question_start, 5),
      unitMap: (partB.unit_map || {}) as Record<string, number>,
      unitDistribution: partB.unit_distribution || undefined
    },
    partC: row.part_c_config
      ? {
        enabled: true,
        orQuestionsCount: num((row.part_c_config as any).count, 1),
        marksPerQuestion: num((row.part_c_config as any).marks_per_question, 15),
        questionStart: num((row.part_c_config as any).question_start, 16),
        unitDistribution: (row.part_c_config as any).unit_distribution || undefined
      }
      : undefined
  };
}

/** Computes the marks breakdown — mirrors the backend validation exactly. */
export function computePatternTotals(pattern: ExamPattern): {
  partA: number;
  partB: number;
  partC: number;
  total: number;
  breakdown: string;
  valid: boolean;
} {
  const partA = pattern.partA.totalQuestions * pattern.partA.marksPerQuestion;
  let partB = 0;
  let partBSummary: string;

  if (pattern.partB.format === 'sections' && pattern.partB.sections && pattern.partB.sections.length > 0) {
    const lines = pattern.partB.sections.map((s) => {
      const subtotal = s.answer_count * (pattern.partB.marksPerQuestion || 0);
      partB += subtotal;
      return `${s.name}: ${s.answer_count} × ${pattern.partB.marksPerQuestion || 0} = ${subtotal}`;
    });
    partBSummary = lines.join(' + ');
  } else {
    partB = (pattern.partB.orQuestionsCount || 0) * (pattern.partB.marksPerQuestion || 0);
    partBSummary = `Part B: ${pattern.partB.orQuestionsCount || 0} × ${pattern.partB.marksPerQuestion || 0} = ${partB}`;
  }

  const partC = pattern.partC?.enabled
    ? (pattern.partC.orQuestionsCount || 0) * (pattern.partC.marksPerQuestion || 0)
    : 0;
  const partCSummary = pattern.partC?.enabled
    ? `Part C: ${pattern.partC.orQuestionsCount || 0} × ${pattern.partC.marksPerQuestion || 0} = ${partC}`
    : '';

  const total = partA + partB + partC;
  return {
    partA,
    partB,
    partC,
    total,
    breakdown: [
      `Part A: ${pattern.partA.totalQuestions} × ${pattern.partA.marksPerQuestion} = ${partA}`,
      partBSummary,
      ...(partCSummary ? [partCSummary] : [])
    ].join(' + '),
    valid: total === pattern.totalMarks
  };
}

/** ExamPattern → DB row payload for PUT /exam-patterns/:id */
export function examPatternToDbPayload(pattern: ExamPattern, existing?: ExamPatternConfigRecord) {
  const partA: any = {
    count: pattern.partA.totalQuestions,
    marks_per_question: pattern.partA.marksPerQuestion,
    total: pattern.partA.totalQuestions * pattern.partA.marksPerQuestion,
    instruction: pattern.partA.instruction || pattern.partA.choiceNote || 'Answer all Questions',
    question_start: pattern.partA.questionStart ?? 1
  };
  if (pattern.partA.unitDistribution) partA.unit_distribution = pattern.partA.unitDistribution;
  if (pattern.partA.unitsPerQuestion) partA.units_per_question = pattern.partA.unitsPerQuestion;

  const partB: any = {
    format: pattern.partB.format,
    marks_per_question: pattern.partB.marksPerQuestion || 0,
    question_start: pattern.partB.questionStart ?? 5
  };

  if (pattern.partB.format === 'sections') {
    const sections = (pattern.partB.sections || []).map(s => ({
      name: s.name,
      display_questions: s.display_questions,
      answer_count: s.answer_count,
      unit_pool: s.unit_pool,
      instruction: s.instruction,
      marks_per_question: pattern.partB.marksPerQuestion
    }));
    partB.sections = sections;
    partB.total = sections.reduce((sum, s) => sum + s.answer_count * (pattern.partB.marksPerQuestion || 0), 0);
    partB.unit_distribution = pattern.partB.unitDistribution;
  } else {
    partB.or_pairs = pattern.partB.orQuestionsCount || 0;
    partB.total = (pattern.partB.orQuestionsCount || 0) * (pattern.partB.marksPerQuestion || 0);
    partB.unit_map = pattern.partB.unitMap || existing?.part_b_config?.unit_map || {};
    partB.unit_distribution = pattern.partB.unitDistribution;
  }

  const partC: any | null = pattern.partC?.enabled
    ? {
      count: pattern.partC.orQuestionsCount,
      marks_per_question: pattern.partC.marksPerQuestion,
      total: pattern.partC.orQuestionsCount * pattern.partC.marksPerQuestion,
      question_start: pattern.partC.questionStart ?? 16,
      or_choice: true,
      ...(pattern.partC.unitDistribution ? { unit_distribution: pattern.partC.unitDistribution } : {})
    }
    : null;

  return {
    exam_name: pattern.examName || existing?.exam_name,
    duration: pattern.duration,
    max_marks: pattern.totalMarks,
    regulation: pattern.regulation || existing?.regulation || 'Regulation 2024',
    show_bl_co_pi: pattern.showBlCoPI !== false,
    show_course_obj: pattern.showCourseObjectives === true,
    part_a_config: partA,
    part_b_config: partB,
    part_c_config: partC,
    instructions: pattern.instructions || existing?.instructions || null,
    status: 'active'
  };
}
