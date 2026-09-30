import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  AlertCircle,
  CheckCircle2,
  RotateCw,
  Save,
  X,
  Layers,
  Database,
  ShieldCheck,
  Loader2,
  Info,
  BarChart3,
  FileText,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type {
  IatGeneratedBank,
  IatPreview,
  SelectedIatQuestion,
  SourceBankStats,
  UnitDistributionRow
} from '../types';
import {
  fetchSourceQuestionBanks,
  fetchSourceBankStats,
  generateIatPreview,
  saveIatGeneratedBank,
  SourceBankOption,
  IatApiError,
  UnitRequest
} from '../services/iatQuestionBankApi';

const EXAM_TYPE_OPTIONS = ['Internal Assessment I', 'Internal Assessment II'] as const;
const ALL_UNITS = [1, 2, 3, 4, 5] as const;

// Default per-unit counts — always numeric 0, never undefined/null/string.
function makeDefaultUnitRequests(): UnitRequest[] {
  return ALL_UNITS.map((u) => ({ unit: u, partA: 0, partBC: 0 }));
}

/** Safely convert a raw input value to a non-negative integer. Returns 0 for empty/invalid. */
function safeCount(raw: string | number | undefined | null): number {
  if (raw === '' || raw === undefined || raw === null) return 0;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 0;
  return n;
}

/** Normalize all unit requests to exact integers before sending to the API. */
function normalizeUnitRequestsForApi(requests: UnitRequest[]): UnitRequest[] {
  return requests.map((r) => ({
    unit: r.unit,
    partA: safeCount(r.partA),
    partBC: safeCount(r.partBC)
  }));
}

// Per-unit availability from SourceBankStats
function buildUnitAvailability(stats: SourceBankStats): Map<number, { partA: number; partBC: number }> {
  const m = new Map<number, { partA: number; partBC: number }>();
  for (const u of stats.units) {
    m.set(u.unit, { partA: u.partA, partBC: u.partB + u.partC });
  }
  return m;
}

export const IatQuestionBankGeneratorView: React.FC = () => {
  const {
    authSession,
    isSuperAdminPortal,
    academicYearsList,
    activeAcademicYearsList,
    activeDepartmentsList,
    dbSubjects,
    showToast,
    setActiveTab
  } = useApp();

  const accent = isSuperAdminPortal ? 'purple' : 'rose';
  const accentText = accent === 'purple' ? 'text-purple-700' : 'text-[#D71945]';
  const accentBg = accent === 'purple' ? 'bg-purple-700' : 'bg-[#D71945]';
  const accentHover = accent === 'purple' ? 'hover:bg-purple-800' : 'hover:bg-[#c0153c]';
  const accentShadow = accent === 'purple' ? 'shadow-purple-700/25' : 'shadow-[#D71945]/25';
  const accentRing = accent === 'purple'
    ? 'border-purple-700 bg-purple-50 ring-purple-700'
    : 'border-[#D71945] bg-[#FFF0F3] ring-[#D71945]';

  const token = authSession?.token || '';

  // ---- Step 1–4 selectors ----
  const [academicYear, setAcademicYear] = useState<string>('');
  const [department, setDepartment] = useState<string>('');
  const [subjectCode, setSubjectCode] = useState<string>('');
  const [sourceBankId, setSourceBankId] = useState<string>('');
  const [examType, setExamType] = useState<string>('Internal Assessment I');

  // ---- Step 5: per-unit counts ----
  const [unitRequests, setUnitRequests] = useState<UnitRequest[]>(makeDefaultUnitRequests());
  const [bankName, setBankName] = useState<string>('');
  const [useGemini, setUseGemini] = useState<boolean>(false);

  // ---- Data ----
  const [sourceBanks, setSourceBanks] = useState<SourceBankOption[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [stats, setStats] = useState<SourceBankStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [suggestedName, setSuggestedName] = useState<string>('');

  // ---- Preview / generation state ----
  const [preview, setPreview] = useState<IatPreview | null>(null);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [regenerateCount, setRegenerateCount] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedBank, setSavedBank] = useState<IatGeneratedBank | null>(null);

  // ---- UI state ----
  const [previewExpanded, setPreviewExpanded] = useState(true);

  const years = activeAcademicYearsList.length > 0 ? activeAcademicYearsList : academicYearsList;
  const depts = activeDepartmentsList.length > 0 ? activeDepartmentsList : [];

  // ---- Reset downstream on bank change ----
  const resetFromBankChange = useCallback(() => {
    setStats(null);
    setPreview(null);
    setSeed(undefined);
    setUnitRequests(makeDefaultUnitRequests());
    setErrors([]);
    setSaveError(null);
    setSavedBank(null);
    setSuggestedName('');
  }, []);

  // ---- Load ORIGINAL source banks ----
  useEffect(() => {
    if (!token || !academicYear || !department) {
      setSourceBanks([]);
      return;
    }
    let cancelled = false;
    setBanksLoading(true);
    fetchSourceQuestionBanks(token, { academicYear, department, subjectCode: subjectCode || undefined })
      .then((rows) => {
        if (cancelled) return;
        setSourceBanks(rows);
        if (rows.length > 0 && !rows.some((b) => b.id === sourceBankId)) {
          setSourceBankId(rows[0].id);
        }
        if (rows.length === 0) setSourceBankId('');
      })
      .catch((err) => {
        if (!cancelled) {
          setSourceBanks([]);
          setSourceBankId('');
          showToast(err?.message || 'Failed to load question banks.');
        }
      })
      .finally(() => !cancelled && setBanksLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, academicYear, department, subjectCode]);

  // ---- Load statistics for the selected source bank ----
  useEffect(() => {
    if (!token || !sourceBankId) { setStats(null); return; }
    let cancelled = false;
    setStatsLoading(true);
    fetchSourceBankStats(token, sourceBankId)
      .then((res) => {
        if (cancelled) return;
        setStats(res.stats);
        setSuggestedName(res.suggestedName);
        // Reset unit requests to zero when bank changes
        setUnitRequests(makeDefaultUnitRequests());
      })
      .catch((err) => {
        if (!cancelled) { setStats(null); setErrors([err?.message || 'Failed to load question bank statistics.']); }
      })
      .finally(() => !cancelled && setStatsLoading(false));
    return () => { cancelled = true; };
  }, [token, sourceBankId]);

  // ---- Subject options ----
  const subjectOptions = useMemo(() => {
    const rows = (dbSubjects || []).filter((s) => {
      const yearLabel = s.academic_years?.year_label || '';
      const deptCode = s.departments?.department_code || '';
      return (!academicYear || yearLabel === academicYear) && (!department || deptCode === department);
    });
    const seen = new Set<string>();
    return rows.filter((s) => {
      if (seen.has(s.subject_code)) return false;
      seen.add(s.subject_code);
      return true;
    });
  }, [dbSubjects, academicYear, department]);

  // ---- Per-unit availability map ----
  const unitAvailability = useMemo(
    () => (stats ? buildUnitAvailability(stats) : new Map<number, { partA: number; partBC: number }>()),
    [stats]
  );

  // ---- Per-unit validation (uses safeCount so 0-valued fields never cause spurious errors) ----
  const unitValidationErrors = useMemo(() => {
    if (!stats) return [];
    const out: string[] = [];
    for (const req of unitRequests) {
      const avail = unitAvailability.get(req.unit) || { partA: 0, partBC: 0 };
      const partA  = safeCount(req.partA);
      const partBC = safeCount(req.partBC);
      // Only flag actual bad values — a cleared/0 field is always valid
      if (req.partA !== 0 && (isNaN(Number(req.partA)) || Number(req.partA) < 0 || !Number.isInteger(Number(req.partA))))
        out.push(`Unit ${req.unit}: Part A must be a non-negative integer.`);
      else if (partA > avail.partA)
        out.push(`Unit ${req.unit}: Requested ${partA} Part A but only ${avail.partA} available.`);
      if (req.partBC !== 0 && (isNaN(Number(req.partBC)) || Number(req.partBC) < 0 || !Number.isInteger(Number(req.partBC))))
        out.push(`Unit ${req.unit}: Part B/C must be a non-negative integer.`);
      else if (partBC > avail.partBC)
        out.push(`Unit ${req.unit}: Requested ${partBC} Part B/C but only ${avail.partBC} available.`);
    }
    const totalA  = unitRequests.reduce((s, r) => s + safeCount(r.partA),  0);
    const totalBC = unitRequests.reduce((s, r) => s + safeCount(r.partBC), 0);
    if (totalA === 0 && totalBC === 0)
      out.push('Enter at least one question across all units.');
    return out;
  }, [stats, unitRequests, unitAvailability]);

  const canGenerate = Boolean(stats) && unitValidationErrors.length === 0 && !generating;

  // ---- Update a single unit's count ----
  const setUnitField = (unit: number, field: 'partA' | 'partBC', raw: string) => {
    // Allow the field to be empty while the user is typing, but store 0 for
    // calculation purposes so totals and validation always work with numbers.
    const val = raw === '' ? 0 : Math.max(0, Math.floor(Number(raw) || 0));
    setUnitRequests((prev) =>
      prev.map((r) => (r.unit === unit ? { ...r, [field]: val } : r))
    );
    setPreview(null);
    setErrors([]);
  };

  // ---- Generate / Regenerate ----
  const runGeneration = async (useNewSeed: boolean) => {
    // Final client-side normalization — BEFORE validation, so 0s are valid.
    const normalized = normalizeUnitRequestsForApi(unitRequests);
    const normalizedErrors: string[] = [];
    if (stats) {
      for (const req of normalized) {
        const avail = unitAvailability.get(req.unit) || { partA: 0, partBC: 0 };
        const partA = safeCount(req.partA);
        const partBC = safeCount(req.partBC);
        if (!Number.isInteger(partA) || partA < 0)
          normalizedErrors.push(`Unit ${req.unit}: Part A must be a non-negative integer.`);
        else if (partA > avail.partA)
          normalizedErrors.push(`Unit ${req.unit}: Requested ${partA} Part A but only ${avail.partA} available.`);
        if (!Number.isInteger(partBC) || partBC < 0)
          normalizedErrors.push(`Unit ${req.unit}: Part B/C must be a non-negative integer.`);
        else if (partBC > avail.partBC)
          normalizedErrors.push(`Unit ${req.unit}: Requested ${partBC} Part B/C but only ${avail.partBC} available.`);
      }
      const totalA = normalized.reduce((s, r) => s + safeCount(r.partA), 0);
      const totalBC = normalized.reduce((s, r) => s + safeCount(r.partBC), 0);
      if (totalA === 0 && totalBC === 0)
        normalizedErrors.push('Enter at least one question across all units.');
    }
    if (!stats || normalizedErrors.length > 0) {
      setErrors(normalizedErrors.length > 0 ? normalizedErrors : unitValidationErrors);
      return;
    }
    setGenerating(true);
    setErrors([]);
    setSaveError(null);
    const nextSeed = useNewSeed || seed === undefined ? Math.floor(Math.random() * 2 ** 31) : seed;
    try {
      // Send only units that have at least one question requested; all values are guaranteed integers.
      const activeRequests = normalized.filter((r) => r.partA > 0 || r.partBC > 0);
      const result = await generateIatPreview(token, {
        sourceQuestionBankId: sourceBankId,
        requestedPartA: 0,
        requestedPartBC: 0,
        examType,
        seed: nextSeed,
        useGemini,
        unitRequests: activeRequests
      });
      setPreview(result);
      setSeed(result.seed);
      setPreviewExpanded(true);
      if (!bankName.trim()) setBankName(result.suggestedName);
      if (useNewSeed) setRegenerateCount((c) => c + 1);
      showToast(
        `Generated preview: ${result.totalQuestions} questions (${result.actualPartA} Part A, ${result.actualPartB} Part B, ${result.actualPartC} Part C). Not saved yet.`
      );
    } catch (err: any) {
      const message = err instanceof IatApiError ? err.message : err?.message || 'Generation failed.';
      setErrors([message]);
      setPreview(null);
    } finally {
      setGenerating(false);
    }
  };

  // ---- Save ----
  const handleSave = async () => {
    if (!preview) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Normalize once more before saving — guarantees no empty strings reach the API.
      const normalizedForSave = normalizeUnitRequestsForApi(unitRequests)
        .filter((r) => r.partA > 0 || r.partBC > 0);
      const result = await saveIatGeneratedBank(token, {
        sourceQuestionBankId: preview.sourceBankId,
        requestedPartA: safeCount(preview.requestedPartA),
        requestedPartBC: safeCount(preview.requestedPartBC),
        examType,
        name: bankName.trim() || preview.suggestedName,
        seed: preview.seed,
        unitRequests: normalizedForSave
      });
      setSavedBank(result.generatedBank);
      setPreview(null);
      showToast(
        `Saved "${result.generatedBank.name}" with ${result.generatedBank.totalQuestions} questions. Original bank unchanged.`
      );
    } catch (err: any) {
      setSaveError(err instanceof IatApiError ? err.message : err?.message || 'Failed to save the IAT question bank.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setPreview(null);
    setErrors([]);
    setSaveError(null);
  };

  // ==================================================================
  // Render helpers
  // ==================================================================
  const selectClass =
    'w-full rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#111827] outline-none transition focus:border-[#D71945] focus:ring-2 focus:ring-[#D71945]/20 disabled:bg-[#F7F8FA] disabled:text-[#94A3B8]';

  const inputClass =
    'w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-bold text-[#111827] outline-none transition text-center focus:border-[#D71945] focus:ring-2 focus:ring-[#D71945]/20 disabled:bg-[#F7F8FA] disabled:text-[#94A3B8]';

  const QuestionTable: React.FC<{ title: string; questions: SelectedIatQuestion[] }> = ({ title, questions }) => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[#64748B]">
          <FileText className="h-4 w-4" />
          {title}
        </h4>
        <span className="rounded-lg bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-extrabold text-[#64748B]">
          {questions.length} questions
        </span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-[#E5E7EB]">
        <table className="w-full min-w-[860px] text-left">
          <thead className="bg-[#F7F8FA] text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
            <tr>
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Question</th>
              <th className="px-3 py-2.5">Unit</th>
              <th className="px-3 py-2.5">Original Part</th>
              <th className="px-3 py-2.5">Marks</th>
              <th className="px-3 py-2.5">BTL</th>
              <th className="px-3 py-2.5">CO</th>
              <th className="px-3 py-2.5">PI</th>
              <th className="px-3 py-2.5">Source Q</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9] text-xs text-[#111827]">
            {questions.map((q, idx) => (
              <tr key={`${q.sourceQuestionId}-${idx}`} className="align-top hover:bg-[#F9FAFB]">
                <td className="px-3 py-2.5 font-black text-[#64748B]">{idx + 1}</td>
                <td className="max-w-md px-3 py-2.5 font-medium leading-relaxed">{q.questionText}</td>
                <td className="px-3 py-2.5 font-bold">{q.unit ?? '—'}</td>
                <td className="px-3 py-2.5">
                  <span
                    className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${
                      q.originalPart === 'Part A'
                        ? 'bg-[#EAF3FF] text-[#1976D2]'
                        : q.originalPart === 'Part B'
                          ? 'bg-[#FFF0F3] text-[#D71945]'
                          : 'bg-purple-50 text-purple-700'
                    }`}
                  >
                    {q.originalPart}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-bold">{q.marks ?? '—'}</td>
                <td className="px-3 py-2.5 font-mono text-[11px] font-bold">{q.btl || q.bloomsLevel || '—'}</td>
                <td className="px-3 py-2.5 font-mono text-[11px] font-bold">{q.co || '—'}</td>
                <td className="px-3 py-2.5 font-mono text-[11px] font-bold">{q.pi || '—'}</td>
                <td className="px-3 py-2.5 font-mono text-[10px] text-[#94A3B8]">{q.sourceQuestionNumber}</td>
              </tr>
            ))}
            {questions.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-xs text-[#94A3B8]">No questions selected.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const DistributionTable: React.FC<{ title: string; rows: UnitDistributionRow[]; total: number }> = ({ title, rows, total }) => (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider text-[#64748B]">
          <BarChart3 className="h-3.5 w-3.5" />
          {title}
        </h4>
        <span className="text-[10px] font-extrabold text-[#94A3B8]">Total = {total}</span>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((u) => {
          const row = rows.find((r) => r.unit === u);
          return (
            <div key={u} className="rounded-xl bg-[#F7F8FA] p-2.5 text-center">
              <div className="text-[9px] font-extrabold uppercase text-[#94A3B8]">Unit {u}</div>
              <div className="mt-0.5 text-lg font-black text-[#111827]">{row ? row.total : 0}</div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // Per-unit row totals — always computed from safe numeric values.
  const totalRequestedA = unitRequests.reduce((s, r) => s + safeCount(r.partA), 0);
  const totalRequestedBC = unitRequests.reduce((s, r) => s + safeCount(r.partBC), 0);
  const totalRequested = totalRequestedA + totalRequestedBC;

  // ==================================================================
  // Render
  // ==================================================================
  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <span className={`text-[11px] font-extrabold uppercase tracking-widest ${accentText}`}>
            Internal Assessment Only
          </span>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            IAT Question Bank Generator
          </h1>
          <p className="mt-1 max-w-3xl text-xs text-[#64748B]">
            Reduce a complete, uploaded question bank into a smaller Internal Assessment question bank. Every
            question is <strong className="text-[#111827]">selected from the original bank</strong> — the original
            bank is never modified, and the reduced bank is stored separately with a permanent link back to its source.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('iat-generated-banks')}
            className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-xs font-bold text-[#64748B] transition-all hover:border-slate-400 hover:text-[#111827] cursor-pointer"
          >
            <Layers className="h-4 w-4" />
            <span>View Saved Banks</span>
          </button>
        </div>
      </div>

      {/* End Semester protection notice */}
      <div className="flex items-start gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <p className="text-[11px] leading-relaxed text-[#64748B]">
          This feature is available for <strong className="text-[#111827]">Internal Assessment I</strong> and{' '}
          <strong className="text-[#111827]">Internal Assessment II</strong> only. It is never applied to{' '}
          <strong className="text-[#111827]">End Semester Examination</strong> papers — those always use the
          original, full question bank.
        </p>
      </div>

      {/* Success banner after saving */}
      {savedBank && (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <p className="text-xs font-extrabold text-emerald-900">Saved: {savedBank.name}</p>
              <p className="mt-0.5 text-[11px] text-emerald-800">
                {savedBank.actualPartACount} Part A · {savedBank.actualPartBCount} Part B ·{' '}
                {savedBank.actualPartCCount} Part C · Total {savedBank.totalQuestions} questions. The source
                question bank was not modified. No question-usage record was created — usage is recorded only
                when an IAT paper is finalized.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setSavedBank(null);
              setBankName('');
              resetFromBankChange();
            }}
            className="shrink-0 rounded-lg p-1.5 text-emerald-700 transition-colors hover:bg-emerald-100 cursor-pointer"
            title="Generate another bank"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Step 1–4: selectors */}
      <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-xs space-y-6">
        <div>
          <span className="text-xs font-extrabold uppercase tracking-wider text-[#94A3B8]">Steps 1 – 4</span>
          <h2 className="mt-1 text-xl font-extrabold text-[#111827]">Select the source question bank</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              Step 1 · Academic Year
            </span>
            <select
              value={academicYear}
              onChange={(e) => {
                setAcademicYear(e.target.value);
                setSubjectCode('');
                setSourceBankId('');
                resetFromBankChange();
              }}
              className={selectClass}
            >
              <option value="">Select academic year…</option>
              {years.map((y) => (
                <option key={y.id} value={y.year_label}>{y.year_label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              Step 2 · Department
            </span>
            <select
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                setSubjectCode('');
                setSourceBankId('');
                resetFromBankChange();
              }}
              disabled={!academicYear}
              className={selectClass}
            >
              <option value="">Select department…</option>
              {depts.map((d) => (
                <option key={d.id} value={d.department_code}>
                  {d.department_code} — {d.department_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              Step 3 · Subject
            </span>
            <select
              value={subjectCode}
              onChange={(e) => {
                setSubjectCode(e.target.value);
                setSourceBankId('');
                resetFromBankChange();
              }}
              disabled={!department}
              className={selectClass}
            >
              <option value="">All subjects…</option>
              {subjectOptions.map((s) => (
                <option key={s.subject_code} value={s.subject_code}>
                  {s.subject_code} — {s.subject_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              Internal Assessment Type
            </span>
            <select
              value={examType}
              onChange={(e) => { setExamType(e.target.value); resetFromBankChange(); }}
              className={selectClass}
            >
              {EXAM_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
            Step 4 · Original Question Bank
          </span>
          <select
            value={sourceBankId}
            onChange={(e) => { setSourceBankId(e.target.value); resetFromBankChange(); }}
            disabled={!department || banksLoading}
            className={selectClass}
          >
            <option value="">
              {banksLoading ? 'Loading question banks…' : 'Select the original question bank…'}
            </option>
            {sourceBanks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.subject_code} · {b.subject_name || '—'} — {b.file_name}
              </option>
            ))}
          </select>
          <span className="mt-1.5 flex items-start gap-1.5 text-[10px] text-[#94A3B8]">
            <Info className="mt-px h-3 w-3 shrink-0" />
            Only original, uploaded question banks are listed. A generated IAT bank can never be used as a source.
          </span>
        </label>
      </div>

      {/* Step 5: Unit-wise question count grid */}
      {sourceBankId && (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-xs space-y-6">
          <div>
            <span className="text-xs font-extrabold uppercase tracking-wider text-[#94A3B8]">Step 5</span>
            <h2 className="mt-1 text-xl font-extrabold text-[#111827]">
              Unit-wise Question Count
            </h2>
            <p className="text-xs text-[#64748B] mt-1">
              Set the number of Part A and Part B/C questions to include from <strong>each unit</strong>.
              Part B and Part C form a combined selection pool within each unit — the original part of every
              selected question is preserved as-is. All 5 units must be considered; units with 0 for both
              counts are skipped.
            </p>
          </div>

          {statsLoading && (
            <div className="flex items-center gap-2 text-xs text-[#64748B]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading question bank statistics…
            </div>
          )}

          {stats && !statsLoading && (
            <>
              {/* Overall stats summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Total Part A', value: stats.partA, hint: '2 marks each' },
                  { label: 'Total Part B', value: stats.partB, hint: 'available' },
                  { label: 'Total Part C', value: stats.partC, hint: 'available' },
                  { label: 'Total Questions', value: stats.total, hint: 'in original bank' }
                ].map(({ label, value, hint }) => (
                  <div key={label} className="rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-3.5 text-center">
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">{label}</div>
                    <div className="mt-1 text-2xl font-black text-[#111827]">{value}</div>
                    <div className="text-[10px] font-semibold text-[#64748B]">{hint}</div>
                  </div>
                ))}
              </div>

              {/* Unit-wise grid */}
              <div className="overflow-x-auto rounded-2xl border border-[#E5E7EB]">
                <table className="w-full min-w-[600px] text-left">
                  <thead className="bg-[#F7F8FA]">
                    <tr className="text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
                      <th className="px-4 py-3">Unit</th>
                      <th className="px-4 py-3 text-center">Avail. Part A</th>
                      <th className="px-4 py-3 text-center">Avail. B+C</th>
                      <th className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block h-2 w-2 rounded-full bg-[#1976D2]" />
                          Request Part A
                        </span>
                      </th>
                      <th className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block h-2 w-2 rounded-full bg-[#D71945]" />
                          Request B+C
                        </span>
                      </th>
                      <th className="px-4 py-3 text-center">Unit Total</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {unitRequests.map((req) => {
                      const avail = unitAvailability.get(req.unit) || { partA: 0, partBC: 0 };
                      const unitTotal = req.partA + req.partBC;
                      const hasError =
                        req.partA > avail.partA || req.partBC > avail.partBC ||
                        req.partA < 0 || req.partBC < 0;
                      const isEmpty = req.partA === 0 && req.partBC === 0;
                      return (
                        <tr
                          key={req.unit}
                          className={`transition-colors ${
                            hasError ? 'bg-red-50' : isEmpty ? 'bg-white' : 'bg-emerald-50/40'
                          }`}
                        >
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black ${
                                  hasError
                                    ? 'bg-red-100 text-red-700'
                                    : isEmpty
                                      ? 'bg-[#F1F5F9] text-[#64748B]'
                                      : 'bg-emerald-100 text-emerald-800'
                                }`}
                              >
                                {req.unit}
                              </span>
                              <span className="text-xs font-bold text-[#111827]">Unit {req.unit}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-sm font-extrabold text-[#1976D2]">{avail.partA}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-sm font-extrabold text-[#D71945]">{avail.partBC}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="number"
                              min={0}
                              max={avail.partA}
                              step={1}
                              value={safeCount(req.partA) === 0 ? '' : safeCount(req.partA)}
                              placeholder="0"
                              onChange={(e) => setUnitField(req.unit, 'partA', e.target.value)}
                              className={`${inputClass} w-20 ${
                                safeCount(req.partA) > avail.partA ? 'border-red-400 bg-red-50 focus:ring-red-400/20' : ''
                              }`}
                            />
                            {safeCount(req.partA) > avail.partA && (
                              <div className="mt-0.5 text-[9px] font-bold text-red-600">max {avail.partA}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="number"
                              min={0}
                              max={avail.partBC}
                              step={1}
                              value={safeCount(req.partBC) === 0 ? '' : safeCount(req.partBC)}
                              placeholder="0"
                              onChange={(e) => setUnitField(req.unit, 'partBC', e.target.value)}
                              className={`${inputClass} w-20 ${
                                safeCount(req.partBC) > avail.partBC ? 'border-red-400 bg-red-50 focus:ring-red-400/20' : ''
                              }`}
                            />
                            {safeCount(req.partBC) > avail.partBC && (
                              <div className="mt-0.5 text-[9px] font-bold text-red-600">max {avail.partBC}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-sm font-extrabold ${hasError ? 'text-red-700' : isEmpty ? 'text-[#94A3B8]' : 'text-emerald-700'}`}>
                              {unitTotal}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {hasError ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                                <AlertCircle className="h-3 w-3" /> Error
                              </span>
                            ) : isEmpty ? (
                              <span className="text-[10px] font-semibold text-[#94A3B8]">Skipped</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" /> Ready
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Totals row */}
                    <tr className="bg-[#F7F8FA] font-extrabold">
                      <td className="px-4 py-3 text-xs font-extrabold text-[#111827]">Total Requested</td>
                      <td className="px-4 py-3 text-center text-[#94A3B8]">—</td>
                      <td className="px-4 py-3 text-center text-[#94A3B8]">—</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-black ${totalRequestedA > stats.partA ? 'text-red-700' : 'text-[#1976D2]'}`}>
                          {totalRequestedA}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-black ${totalRequestedBC > stats.partBc ? 'text-red-700' : 'text-[#D71945]'}`}>
                          {totalRequestedBC}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-black text-[#111827]">{totalRequested}</span>
                      </td>
                      <td className="px-4 py-3" />
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Part B/C pool note */}
              <div className="flex items-start gap-3 rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-4">
                <Database className="mt-0.5 h-4 w-4 shrink-0 text-[#64748B]" />
                <p className="text-[11px] leading-relaxed text-[#64748B]">
                  <strong className="text-[#111827]">Combined Part B + Part C pool</strong> — within each unit,
                  Part B and Part C questions are selected from a single combined pool. The system preserves the
                  original proportion of Part B vs Part C in the final selection, and the original part of every
                  selected question is never changed.
                </p>
              </div>

              {/* Bank name */}
              <label className="block max-w-xl">
                <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
                  Generated Bank Name (optional)
                </span>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder={suggestedName || '24CS514 - Computer Networks - IAT Bank 01'}
                  className={selectClass}
                />
                <span className="mt-1 block text-[10px] text-[#94A3B8]">
                  Leave blank to use the auto-generated name. An existing generated bank is never overwritten.
                </span>
              </label>

              {/* Gemini toggle */}
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={useGemini}
                  onChange={(e) => setUseGemini(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#E5E7EB]"
                />
                <span>
                  <span className="block text-xs font-bold text-[#111827]">Use Gemini to balance the selection</span>
                  <span className="block text-[10px] text-[#64748B]">
                    Gemini only chooses <em>which existing question IDs</em> to include. It never writes or invents
                    question text — all text is read from the original bank. If Gemini is unavailable the
                    deterministic server-side algorithm is used instead.
                  </span>
                </span>
              </label>

              {/* Validation errors */}
              {unitValidationErrors.length > 0 && (
                <div className="space-y-2 rounded-2xl border border-red-200 bg-red-50 p-4">
                  {unitValidationErrors.map((msg, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] font-semibold text-red-800">
                      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>{msg}</span>
                    </div>
                  ))}
                </div>
              )}

              {errors.length > 0 && (
                <div className="space-y-2 rounded-2xl border border-red-200 bg-red-50 p-4">
                  {errors.map((msg, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] font-semibold text-red-800">
                      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>{msg}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Generate button */}
              <div className="flex items-center justify-between border-t border-[#E5E7EB] pt-4">
                <p className="text-[10px] text-[#94A3B8]">
                  {totalRequested > 0
                    ? `Requesting ${totalRequested} questions (${totalRequestedA} Part A + ${totalRequestedBC} Part B/C) from ${unitRequests.filter((r) => r.partA > 0 || r.partBC > 0).length} unit(s)`
                    : 'Enter counts above to generate a preview'}
                </p>
                <button
                  disabled={!canGenerate}
                  onClick={() => runGeneration(true)}
                  className={`flex items-center gap-2 rounded-xl px-6 py-2.5 text-xs font-extrabold shadow-md transition-all ${
                    canGenerate
                      ? `${accentBg} text-white ${accentShadow} ${accentHover} cursor-pointer`
                      : 'cursor-not-allowed bg-gray-300 text-gray-500 shadow-none'
                  }`}
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  <span>Generate IAT Question Bank</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-xs space-y-6">
          {/* Preview header with collapse toggle */}
          <div className="flex items-center justify-between">
            <div>
              <span className={`text-xs font-extrabold uppercase tracking-wider ${accentText}`}>
                Preview — not saved yet
              </span>
              <h2 className="mt-1 text-xl font-extrabold text-[#111827]">Generated IAT Question Bank</h2>
            </div>
            <button
              onClick={() => setPreviewExpanded((v) => !v)}
              className="flex items-center gap-1 rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-[10px] font-bold text-[#64748B] hover:border-slate-400 cursor-pointer"
            >
              {previewExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {previewExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>

          {previewExpanded && (
            <>
              {/* Summary grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <dl className="space-y-2 text-xs">
                  {[
                    ['Academic Year', preview.academicYear || '—'],
                    ['Department', preview.department || '—'],
                    ['Subject', `${preview.subjectCode} – ${preview.subjectName}`],
                    ['Source Question Bank', preview.sourceBankName]
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 border-b border-[#F1F5F9] pb-1.5">
                      <dt className="font-bold text-[#94A3B8]">{k}</dt>
                      <dd className="text-right font-semibold text-[#111827]">{v}</dd>
                    </div>
                  ))}
                </dl>

                <div className="space-y-3">
                  <div className="rounded-2xl border border-[#E5E7EB] p-4">
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">Requested (unit-wise total)</div>
                    <p className="mt-1 text-xs font-semibold text-[#111827]">
                      Part A = {preview.requestedPartA} · Part B/C = {preview.requestedPartBC}
                    </p>
                  </div>
                  <div className={`rounded-2xl border p-4 ${accentRing}`}>
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">Generated</div>
                    <p className="mt-1 text-xs font-extrabold text-[#111827]">
                      Part A = {preview.actualPartA} · Part B = {preview.actualPartB} · Part C = {preview.actualPartC}
                    </p>
                    <p className="mt-1 text-sm font-black text-[#111827]">Total = {preview.totalQuestions} questions</p>
                  </div>
                  <div className="rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-4">
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">Selection method</div>
                    <p className="mt-1 text-xs font-semibold text-[#111827]">
                      Unit-wise deterministic selection
                      {regenerateCount > 0 && ` · regenerated ${regenerateCount}×`}
                    </p>
                    <p className="mt-1 text-[10px] text-[#94A3B8]">
                      All {preview.totalQuestions} questions come from the original question bank. No new question text was created.
                    </p>
                  </div>
                </div>
              </div>

              {/* Unit distribution */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <DistributionTable title="Part A unit distribution" rows={preview.unitDistribution.partA} total={preview.actualPartA} />
                <DistributionTable title="Part B/C unit distribution" rows={preview.unitDistribution.partBC} total={preview.actualPartB + preview.actualPartC} />
              </div>

              {/* Question tables */}
              <QuestionTable title="Part A — selected questions" questions={preview.partA} />
              <QuestionTable title="Part B + Part C — selected questions" questions={preview.partBC} />
            </>
          )}

          {saveError && (
            <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-[11px] font-semibold text-red-800">
              <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#E5E7EB] pt-5">
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-xs font-bold text-[#64748B] transition-all hover:border-slate-400 hover:text-[#111827] disabled:opacity-50 cursor-pointer"
            >
              <X className="h-4 w-4" />
              <span>Cancel</span>
            </button>

            <button
              onClick={() => runGeneration(true)}
              disabled={generating || saving}
              className="flex items-center gap-2 rounded-xl border border-[#1976D2] bg-[#EAF3FF] px-4 py-2.5 text-xs font-bold text-[#1976D2] transition-all hover:bg-[#1976D2] hover:text-white disabled:opacity-50 cursor-pointer"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              <span>Regenerate Selection</span>
            </button>

            <button
              onClick={handleSave}
              disabled={saving || generating}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-extrabold shadow-md transition-all disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none ${
                saving || generating ? '' : `${accentBg} text-white ${accentShadow} ${accentHover} cursor-pointer`
              }`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              <span>Save IAT Question Bank</span>
            </button>
          </div>

          <p className="text-right text-[10px] text-[#94A3B8]">
            Nothing is written to the database until you click <strong>Save IAT Question Bank</strong>. Saving does
            not create any question-usage record.
          </p>
        </div>
      )}
    </div>
  );
};
