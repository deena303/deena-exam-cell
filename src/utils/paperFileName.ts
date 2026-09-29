/**
 * Paper File Naming (Spec §5)
 *
 * The Subject Code is the main identifier for every exported paper.
 *
 *   IAT          → 24CS514_IAT_Set_A.pdf / 24CS514_IAT_Set_A.docx
 *   End Semester → 24AM411_End_Semester_Set_A.pdf / 24AM411_End_Semester_Set_A.docx
 *
 * Random names and internal database IDs are never used.
 */
import type { ExamType, GeneratedPaper } from '../types';

export type ExportFormat = 'pdf' | 'docx';

/** 'Internal Assessment I' | 'Internal Assessment II' → 'IAT'; End Sem → 'End_Semester' */
export function examTypeSlug(examType: string): string {
  return examType.includes('Internal Assessment') ? 'IAT' : 'End_Semester';
}

export function buildPaperFileName(params: {
  subjectCode: string;
  examType: string;
  setLetter?: string | null;
  extension: ExportFormat;
}): string {
  const code = String(params.subjectCode || 'PAPER').trim().replace(/[^A-Za-z0-9]+/g, '_');
  const letter = String(params.setLetter || 'A').toUpperCase();
  return `${code}_${examTypeSlug(params.examType)}_Set_${letter}.${params.extension}`;
}

/** Convenience wrapper for a GeneratedPaper. */
export function paperFileName(paper: Pick<GeneratedPaper, 'subjectCode' | 'examType' | 'setLetter'>, extension: ExportFormat): string {
  return buildPaperFileName({
    subjectCode: paper.subjectCode,
    examType: paper.examType,
    setLetter: paper.setLetter,
    extension
  });
}

export const EXAM_TYPES: ExamType[] = [
  'Internal Assessment I',
  'Internal Assessment II',
  'End Semester Examination'
];
