import React, { useEffect, useMemo, useState } from 'react';
import {
  Sliders,
  CheckCircle2,
  Clock,
  Edit2,
  Layers,
  AlertTriangle,
  Check,
  X,
  Loader2,
  RefreshCw,
  Info
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ExamPattern, ExamType } from '../types';
import {
  EXAM_TYPE_ORDER,
  EXAM_TYPE_META,
  computePatternTotals
} from '../utils/examPatternMapper';

const toNumber = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const parseUnitPool = (v: string): number[] =>
  String(v || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n >= 1 && n <= 5);

const formatUnitPool = (pool: number[] | undefined): string => (pool || []).join(', ');

/**
 * Exam Patterns (Spec §1)
 *
 * Internal Assessment I, Internal Assessment II and the End Semester pattern
 * are all editable here. Values are loaded from the `exam_pattern_configs`
 * table and saved back to it — nothing is hardcoded in the frontend, and the
 * total marks are validated before a pattern can be saved.
 */
export const ExamPatternsView: React.FC = () => {
  const {
    examPatterns,
    updateExamPattern,
    setActiveTab,
    examPatternsLoading,
    refreshExamPatterns
  } = useApp();

  const [editing, setEditing] = useState<ExamPattern | null>(null);
  const [draft, setDraft] = useState<ExamPattern | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const patternsByType = useMemo(() => {
    const map = new Map<ExamType, ExamPattern>();
    examPatterns.forEach(p => map.set(p.examType, p));
    EXAM_TYPE_ORDER.forEach(t => {
      if (!map.has(t)) map.set(t, examPatterns.find(p => p.examType === t) as ExamPattern);
    });
    return map;
  }, [examPatterns]);

  const orderedPatterns = useMemo(
    () => EXAM_TYPE_ORDER.map(t => patternsByType.get(t)).filter(Boolean) as ExamPattern[],
    [patternsByType]
  );

  const openEditor = (pattern: ExamPattern) => {
    // Deep clone so cancel discards changes
    setEditing(pattern);
    setDraft(JSON.parse(JSON.stringify(pattern)));
    setSaveError(null);
  };

  const closeEditor = () => {
    setEditing(null);
    setDraft(null);
    setSaveError(null);
  };

  const patch = (updates: Partial<ExamPattern>) => {
    setDraft(prev => (prev ? { ...prev, ...updates } : prev));
  };

  const patchPartA = (updates: Partial<ExamPattern['partA']>) => {
    setDraft(prev => (prev ? { ...prev, partA: { ...prev.partA, ...updates } } : prev));
  };

  const patchPartB = (updates: Partial<ExamPattern['partB']>) => {
    setDraft(prev => (prev ? { ...prev, partB: { ...prev.partB, ...updates } } : prev));
  };

  const patchPartC = (updates: Partial<ExamPattern['partC']>) => {
    setDraft(prev => (prev ? { ...prev, partC: { ...prev.partC, ...updates } as ExamPattern['partC'] } : prev));
  };

  const patchSection = (index: number, updates: Partial<NonNullable<ExamPattern['partB']['sections']>[number]>) => {
    setDraft(prev => {
      if (!prev) return prev;
      const sections = [...(prev.partB.sections || [])];
      sections[index] = { ...sections[index], ...updates };
      return { ...prev, partB: { ...prev.partB, sections } };
    });
  };

  const totals = draft ? computePatternTotals(draft) : null;
  const isIat = editing?.examType === 'Internal Assessment I' || editing?.examType === 'Internal Assessment II';
  const isEndSem = editing?.examType === 'End Semester Examination';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !editing) return;
    if (totals && !totals.valid) {
      setSaveError(
        `Total marks mismatch: ${totals.breakdown} = ${totals.total} marks, but Total Marks is set to ${draft.totalMarks}. The pattern cannot be saved until the totals match.`
      );
      return;
    }
    setSaving(true);
    setSaveError(null);
    await updateExamPattern(editing.id, draft);
    setSaving(false);
    closeEditor();
  };

  // ------------------------------------------------------------------
  // Section card renderer
  // ------------------------------------------------------------------
  const renderSectionBlock = (pattern: ExamPattern) => {
    const t = computePatternTotals(pattern);
    const meta = EXAM_TYPE_META[pattern.examType];
    const sections = pattern.partB.sections || [];

    return (
      <div className="rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-extrabold text-xs text-[#D71945] uppercase tracking-wider">
              Part B ({pattern.partB.format === 'sections' ? 'Long Form / Sections' : 'Internal Choice OR Pairs'})
            </span>
            <p className="text-xs text-[#64748B] mt-0.5">
              {pattern.partB.format === 'sections'
                ? `${sections.length} sections · ${pattern.partB.marksPerQuestion} marks per question`
                : `${pattern.partB.orQuestionsCount || 0} questions × ${pattern.partB.marksPerQuestion || 0} marks`}
            </p>
          </div>
          <span className="text-lg font-black text-[#111827]">{t.partB} Marks</span>
        </div>

        <div className={`mt-3 grid gap-2 text-xs ${sections.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
          {pattern.partB.format === 'sections' && sections.length > 0
            ? sections.map((s, i) => (
              <div key={i} className="rounded-xl border border-[#E5E7EB] bg-white p-2.5">
                <div className="font-bold text-[#111827]">{s.name}</div>
                <div className="text-[11px] text-[#64748B]">
                  {s.display_questions} shown · Answer {s.answer_count} of {s.display_questions} ({pattern.partB.marksPerQuestion}M each)
                </div>
                {s.unit_pool && s.unit_pool.length > 0 && (
                  <div className="text-[10px] text-[#94A3B8]">Units: {s.unit_pool.join(', ')}</div>
                )}
                <div className="font-bold text-[#D71945] mt-1">
                  {s.answer_count * (pattern.partB.marksPerQuestion || 0)} Marks
                </div>
              </div>
            ))
            : (
              <div className="rounded-xl border border-[#E5E7EB] bg-white p-2.5">
                <div className="font-bold text-[#111827]">OR Question Pairs</div>
                <div className="text-[11px] text-[#64748B]">One pair per unit</div>
                <div className="font-bold text-[#D71945] mt-1">{t.partB} Marks</div>
              </div>
            )}
        </div>
        {pattern.partB.unitDistribution && (
          <div className="mt-2 text-[11px] text-[#64748B] flex items-center gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
            <span>{pattern.partB.unitDistribution}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#D71945]">
            Curriculum Regulations
          </span>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            Exam Patterns
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Configure autonomous marks distribution and question structure for Internal Assessment I, Internal Assessment II and End Semester examinations.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={refreshExamPatterns}
            className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-xs font-bold text-[#111827] hover:bg-[#F7F8FA] transition-all cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 text-[#D71945] ${examPatternsLoading ? 'animate-spin' : ''}`} />
            <span>Reload</span>
          </button>
          <button
            onClick={() => setActiveTab('internal-config')}
            className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-xs font-bold text-[#111827] hover:bg-[#F7F8FA] transition-all cursor-pointer"
          >
            <Sliders className="h-4 w-4 text-[#D71945]" />
            <span>Syllabus Unit Config</span>
          </button>
        </div>
      </div>

      {/* Pattern Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {orderedPatterns.map((pattern) => {
          const meta = EXAM_TYPE_META[pattern.examType];
          const t = computePatternTotals(pattern);
          return (
            <div
              key={pattern.id}
              className="rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-xs flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className={`rounded-full px-3 py-1 text-[11px] font-extrabold uppercase ${meta.badgeCls}`}>
                    {meta.badge}
                  </span>
                  <span className="flex items-center gap-1 text-xs font-bold text-[#64748B]">
                    <Clock className="h-3.5 w-3.5 text-[#1976D2]" /> {pattern.duration}
                  </span>
                </div>

                <div className="mt-4 flex items-baseline justify-between border-b border-[#E5E7EB] pb-4">
                  <div>
                    <h3 className="text-2xl font-black text-[#111827]">{meta.title}</h3>
                    <p className="text-xs text-[#64748B] mt-0.5">{meta.subtitle}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-3xl font-black" style={{ color: meta.accent }}>{pattern.totalMarks}</span>
                    <span className="text-xs font-bold text-[#64748B]"> Marks</span>
                  </div>
                </div>

                <div className="mt-6 space-y-4">
                  {/* Part A */}
                  <div className="rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-extrabold text-xs text-[#1976D2] uppercase tracking-wider">
                          Part A (Short Answer)
                        </span>
                        <p className="text-xs text-[#64748B] mt-0.5">
                          {pattern.partA.totalQuestions} Questions × {pattern.partA.marksPerQuestion} Marks
                        </p>
                      </div>
                      <span className="text-lg font-black text-[#111827]">{t.partA} Marks</span>
                    </div>
                    <div className="mt-2 text-[11px] text-[#64748B] flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      <span>{pattern.partA.choiceNote}</span>
                    </div>
                    {pattern.partA.unitDistribution && (
                      <div className="mt-1 text-[11px] text-[#64748B] flex items-center gap-1.5">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        <span>{pattern.partA.unitDistribution}</span>
                      </div>
                    )}
                  </div>

                  {/* Part B */}
                  {renderSectionBlock(pattern)}

                  {/* Part C (End Semester only) */}
                  {pattern.partC?.enabled && (
                    <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-extrabold text-xs text-purple-700 uppercase tracking-wider">
                            Part C (Application / Case Study)
                          </span>
                          <p className="text-xs text-[#64748B] mt-0.5">
                            {pattern.partC.orQuestionsCount} Question × {pattern.partC.marksPerQuestion} Marks (Internal choice)
                          </p>
                        </div>
                        <span className="text-lg font-black text-purple-900">{t.partC} Marks</span>
                      </div>
                      {pattern.partC.unitDistribution && (
                        <div className="mt-2 text-[11px] text-[#64748B] flex items-center gap-1.5">
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          <span>{pattern.partC.unitDistribution}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-8 pt-4 border-t border-[#E5E7EB] flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs text-[#94A3B8]">
                  {t.breakdown} = <strong className={t.valid ? 'text-emerald-700' : 'text-[#D71945]'}>{t.total} Marks</strong>
                </span>
                <button
                  onClick={() => openEditor(pattern)}
                  className="flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2 text-xs font-bold text-[#111827] hover:bg-[#F7F8FA] hover:text-[#1976D2] transition-colors cursor-pointer"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                  <span>Edit Pattern</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pattern Edit Modal */}
      {editing && draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-2xl rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-2xl my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#D71945]">
                  Pattern Configuration
                </span>
                <h3 className="text-lg font-extrabold text-[#111827]">
                  Edit {EXAM_TYPE_META[editing.examType].title}
                </h3>
              </div>
              <button onClick={closeEditor} className="rounded-full p-1 text-[#94A3B8] hover:bg-[#F7F8FA] cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-5 space-y-5 text-xs">
              {/* ---- General ---- */}
              <div className="rounded-2xl border border-slate-200 bg-[#F7F8FA] p-4 space-y-3">
                <h4 className="text-xs font-black uppercase text-slate-900 tracking-wider">General Exam Details</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Total Marks</label>
                    <input
                      type="number"
                      min={1}
                      value={draft.totalMarks}
                      onChange={(e) => patch({ totalMarks: toNumber(e.target.value) })}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Duration</label>
                    <input
                      type="text"
                      value={draft.duration}
                      onChange={(e) => patch({ duration: e.target.value })}
                      placeholder="e.g. 2 Hours"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Paper Header Title</label>
                  <input
                    type="text"
                    value={draft.examName || ''}
                    onChange={(e) => patch({ examName: e.target.value })}
                    placeholder="e.g. B.E./B.Tech. DEGREE INTERNAL ASSESSMENT TEST-I"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#D71945] focus:outline-hidden"
                  />
                </div>
              </div>

              {/* ---- Part A ---- */}
              <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-xs text-[#1976D2] uppercase tracking-wider">
                    Part A (Short Answer Questions)
                  </span>
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-black text-[#1976D2]">
                    Total: {totals?.partA} Marks
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">No. of Questions</label>
                    <input
                      type="number"
                      min={0}
                      value={draft.partA.totalQuestions}
                      onChange={(e) => patchPartA({ totalQuestions: toNumber(e.target.value) })}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Marks per Question</label>
                    <input
                      type="number"
                      min={0}
                      value={draft.partA.marksPerQuestion}
                      onChange={(e) => patchPartA({ marksPerQuestion: toNumber(e.target.value) })}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Calculated Subtotal</label>
                    <div className="rounded-xl border border-blue-200 bg-white px-3 py-2 font-black text-blue-900 text-sm">
                      {totals?.partA} Marks
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Answer Instruction</label>
                    <input
                      type="text"
                      value={draft.partA.instruction || draft.partA.choiceNote || ''}
                      onChange={(e) => patchPartA({ instruction: e.target.value, choiceNote: e.target.value })}
                      placeholder="e.g. Answer all Questions"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#D71945] focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Unit Allocation Note</label>
                    <input
                      type="text"
                      value={draft.partA.unitDistribution || ''}
                      onChange={(e) => patchPartA({ unitDistribution: e.target.value })}
                      placeholder="e.g. 1 question from each of Units 1–3"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#D71945] focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>

              {/* ---- Part B ---- */}
              <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-xs text-[#D71945] uppercase tracking-wider">
                    Part B ({draft.partB.format === 'sections' ? 'Long Questions / Sections' : 'Internal Choice OR Pairs'})
                  </span>
                  <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-black text-[#D71945]">
                    Total: {totals?.partB} Marks
                  </span>
                </div>

                {isIat ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Marks per Question</label>
                        <input
                          type="number"
                          min={0}
                          value={draft.partB.marksPerQuestion || 0}
                          onChange={(e) => patchPartB({ marksPerQuestion: toNumber(e.target.value) })}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Part B Question No. Starts At</label>
                        <input
                          type="number"
                          min={1}
                          value={draft.partB.questionStart ?? 5}
                          onChange={(e) => patchPartB({ questionStart: toNumber(e.target.value) })}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Calculated Subtotal</label>
                        <div className="rounded-xl border border-rose-200 bg-white px-3 py-2 font-black text-rose-900 text-sm">
                          {totals?.partB} Marks
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        id="iatOrChoice"
                        checked={draft.partB.format === 'or_choice'}
                        onChange={(e) => patchPartB({ format: e.target.checked ? 'or_choice' : 'sections' })}
                        className="rounded border-slate-300 text-[#D71945] focus:ring-[#D71945]"
                      />
                      <label htmlFor="iatOrChoice" className="font-bold text-slate-800">
                        Use OR / choice pairs instead of separate sections
                      </label>
                    </div>

                    {draft.partB.format === 'or_choice' ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">No. of OR Questions</label>
                          <input
                            type="number"
                            min={0}
                            value={draft.partB.orQuestionsCount || 0}
                            onChange={(e) => patchPartB({ orQuestionsCount: toNumber(e.target.value) })}
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">Unit Distribution Note</label>
                          <input
                            type="text"
                            value={draft.partB.unitDistribution || ''}
                            onChange={(e) => patchPartB({ unitDistribution: e.target.value })}
                            placeholder="e.g. One OR pair per unit"
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#D71945] focus:outline-hidden"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between pt-1">
                          <span className="font-extrabold text-[11px] uppercase tracking-wider text-slate-700">
                            Part B Section Count: <span className="text-[#D71945]">{(draft.partB.sections || []).length}</span>
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => patchPartB({
                                sections: [
                                  ...(draft.partB.sections || []),
                                  {
                                    name: `Section ${String.fromCharCode(65 + (draft.partB.sections || []).length)}`,
                                    display_questions: 3,
                                    answer_count: 2,
                                    unit_pool: [],
                                    instruction: 'Answer any two Questions'
                                  }
                                ]
                              })}
                              className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-bold text-[#D71945] hover:bg-rose-50 cursor-pointer"
                            >
                              + Add Section
                            </button>
                            {(draft.partB.sections || []).length > 1 && (
                              <button
                                type="button"
                                onClick={() => patchPartB({ sections: (draft.partB.sections || []).slice(0, -1) })}
                                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                              >
                                − Remove Last
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2.5 pt-1">
                          {(draft.partB.sections || []).map((section, idx) => (
                            <div key={idx} className="rounded-xl border border-rose-100 bg-white p-3 space-y-2.5">
                              <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-700">
                                {section.name}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                <div>
                                  <label className="block font-bold text-slate-600 mb-1 text-[10px]">Section Name</label>
                                  <input
                                    type="text"
                                    value={section.name}
                                    onChange={(e) => patchSection(idx, { name: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                                  />
                                </div>
                                <div>
                                  <label className="block font-bold text-slate-600 mb-1 text-[10px]">Questions per Section</label>
                                  <input
                                    type="number"
                                    min={0}
                                    value={section.display_questions}
                                    onChange={(e) => patchSection(idx, { display_questions: toNumber(e.target.value) })}
                                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                                  />
                                </div>
                                <div>
                                  <label className="block font-bold text-slate-600 mb-1 text-[10px]">Questions to Answer</label>
                                  <input
                                    type="number"
                                    min={0}
                                    value={section.answer_count}
                                    onChange={(e) => patchSection(idx, { answer_count: toNumber(e.target.value) })}
                                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                                  />
                                </div>
                                <div>
                                  <label className="block font-bold text-slate-600 mb-1 text-[10px]">Unit Pool (e.g. 1, 2)</label>
                                  <input
                                    type="text"
                                    value={formatUnitPool(section.unit_pool)}
                                    onChange={(e) => patchSection(idx, { unit_pool: parseUnitPool(e.target.value) })}
                                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div>
                                  <label className="block font-bold text-slate-600 mb-1 text-[10px]">Section Instruction</label>
                                  <input
                                    type="text"
                                    value={section.instruction || ''}
                                    onChange={(e) => patchSection(idx, { instruction: e.target.value })}
                                    placeholder="e.g. Answer any two Questions"
                                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-[#D71945] focus:outline-hidden"
                                  />
                                </div>
                                <div className="flex items-end">
                                  <div className="w-full rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-black text-rose-800">
                                    {section.answer_count * (draft.partB.marksPerQuestion || 0)} Marks
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <div className="pt-1">
                      <label className="block font-bold text-slate-700 mb-1">Part B Unit Distribution Note</label>
                      <input
                        type="text"
                        value={draft.partB.unitDistribution || ''}
                        onChange={(e) => patchPartB({ unitDistribution: e.target.value })}
                        placeholder="e.g. Section A from Units 1–2, Section B from Units 2–3"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#D71945] focus:outline-hidden"
                      />
                    </div>
                  </>
                ) : (
                  /* End Semester Part B editor — unchanged behaviour */
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">No. of Main Questions</label>
                        <input
                          type="number"
                          min={0}
                          value={draft.partB.orQuestionsCount || 0}
                          onChange={(e) => patchPartB({ orQuestionsCount: toNumber(e.target.value) })}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Marks per Question</label>
                        <input
                          type="number"
                          min={0}
                          value={draft.partB.marksPerQuestion || 0}
                          onChange={(e) => patchPartB({ marksPerQuestion: toNumber(e.target.value) })}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Calculated Subtotal</label>
                        <div className="rounded-xl border border-rose-200 bg-white px-3 py-2 font-black text-rose-900 text-sm">
                          {totals?.partB} Marks
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div className="flex items-center gap-2 pt-4">
                        <input
                          type="checkbox"
                          id="partBOrChoice"
                          checked={draft.partB.format === 'or_choice'}
                          onChange={(e) => patchPartB({ format: e.target.checked ? 'or_choice' : 'sections' })}
                          className="rounded border-slate-300 text-[#D71945] focus:ring-[#D71945]"
                        />
                        <label htmlFor="partBOrChoice" className="font-bold text-slate-800">
                          Internal Choice (OR questions per unit)
                        </label>
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Unit Distribution Note</label>
                        <input
                          type="text"
                          value={draft.partB.unitDistribution || ''}
                          onChange={(e) => patchPartB({ unitDistribution: e.target.value })}
                          placeholder="e.g. One pair of OR questions per unit"
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#D71945] focus:outline-hidden"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* ---- Part C (End Semester) ---- */}
              {isEndSem && (
                <div className="rounded-2xl border border-purple-200 bg-purple-50/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="partCEnabled"
                        checked={Boolean(draft.partC?.enabled)}
                        onChange={(e) => patchPartC({ enabled: e.target.checked, orQuestionsCount: draft.partC?.orQuestionsCount ?? 1, marksPerQuestion: draft.partC?.marksPerQuestion ?? 15 })}
                        className="rounded border-slate-300 text-purple-700 focus:ring-purple-700"
                      />
                      <label htmlFor="partCEnabled" className="font-extrabold text-xs text-purple-900 uppercase tracking-wider">
                        Part C (Application / Case Study)
                      </label>
                    </div>
                    <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-black text-purple-800">
                      Total: {totals?.partC} Marks
                    </span>
                  </div>

                  {draft.partC?.enabled && (
                    <div className="space-y-3 pt-2">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">No. of Questions</label>
                          <input
                            type="number"
                            min={0}
                            value={draft.partC.orQuestionsCount}
                            onChange={(e) => patchPartC({ orQuestionsCount: toNumber(e.target.value) })}
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">Marks per Question</label>
                          <input
                            type="number"
                            min={0}
                            value={draft.partC.marksPerQuestion}
                            onChange={(e) => patchPartC({ marksPerQuestion: toNumber(e.target.value) })}
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-900 focus:border-[#D71945] focus:outline-hidden"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">Calculated Subtotal</label>
                          <div className="rounded-xl border border-purple-200 bg-white px-3 py-2 font-black text-purple-900 text-sm">
                            {totals?.partC} Marks
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Unit Distribution Note</label>
                        <input
                          type="text"
                          value={draft.partC.unitDistribution || ''}
                          onChange={(e) => patchPartC({ unitDistribution: e.target.value })}
                          placeholder="e.g. Comprehensive / Application question from any unit"
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#D71945] focus:outline-hidden"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ---- Live totals & validation ---- */}
              {totals && (
                <div className={`rounded-2xl border p-4 transition-all ${totals.valid ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        {totals.valid ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0" />
                        )}
                        <span className="font-extrabold text-xs uppercase tracking-wider">
                          {totals.valid ? 'Marks Breakdown Valid' : 'Marks Mismatch Detected'}
                        </span>
                      </div>
                      <p className="text-xs mt-1">
                        {totals.breakdown} = <strong>{totals.total} Marks</strong> (Target: {draft.totalMarks} Marks)
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`text-2xl font-black ${totals.valid ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {totals.total} / {draft.totalMarks}
                      </span>
                    </div>
                  </div>

                  {!totals.valid && (
                    <p className="mt-2 text-xs font-bold text-rose-700 border-t border-rose-200 pt-2">
                      Total marks sum ({totals.total}) must equal the specified Total Marks ({draft.totalMarks}). Adjust the section counts, questions to answer, or marks per question before saving.
                    </p>
                  )}
                </div>
              )}

              {saveError && (
                <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{saveError}</span>
                </div>
              )}

              {totals?.valid && (
                <div className="flex items-start gap-2 rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-3 text-[11px] text-[#64748B]">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    This pattern is stored in the <strong>exam_pattern_configs</strong> table and is used by the paper generator
                    and the PDF / Word export. Total marks are re-validated on the server before the save is accepted.
                  </span>
                </div>
              )}

              <div className="mt-2 flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-xl border border-[#E5E7EB] px-4 py-2 font-bold text-[#64748B] hover:bg-[#F7F8FA] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !totals?.valid}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D71945] px-6 py-2.5 font-bold text-white shadow-md shadow-[#D71945]/20 hover:bg-[#c0153c] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {saving ? 'Saving…' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {examPatternsLoading && orderedPatterns.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-8 text-xs font-bold text-[#64748B]">
          <Loader2 className="h-4 w-4 animate-spin text-[#D71945]" /> Loading exam patterns…
        </div>
      )}

      {orderedPatterns.length === 0 && !examPatternsLoading && (
        <div className="rounded-3xl border border-dashed border-gray-300 bg-gray-50/50 p-10 text-center">
          <Layers className="h-8 w-8 text-[#94A3B8] mx-auto mb-2" />
          <p className="text-sm font-bold text-gray-800">No exam patterns configured.</p>
          <p className="text-xs text-gray-500 mt-1">Run Supabase migration 008 to seed the IAT I, IAT II and End Semester patterns.</p>
        </div>
      )}
    </div>
  );
};
