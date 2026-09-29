import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers,
  AlertCircle,
  Loader2,
  Eye,
  Sparkles,
  Archive,
  ArchiveRestore,
  Trash2,
  Search,
  RefreshCw,
  Database,
  ShieldCheck,
  X,
  Download,
  ChevronDown,
  FileText,
  FileType2
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { IatGeneratedBank, IatGeneratedBankDetail, SelectedIatQuestion } from '../types';
import {
  fetchIatGeneratedBanks,
  fetchIatGeneratedBank,
  fetchSourceQuestionBanks,
  archiveIatGeneratedBank,
  restoreIatGeneratedBank,
  deleteIatGeneratedBank,
  SourceBankOption
} from '../services/iatQuestionBankApi';
import { exportIatBankPdf, exportIatBankWord } from '../utils/exportUtils';

const statusBadge: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-800',
  Archived: 'bg-slate-200 text-slate-700'
};

const UNIT_ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
const PART_LABELS: Record<string, { label: string; sublabel: string; color: string }> = {
  'Part A': { label: 'PART A', sublabel: 'Short Answer Questions', color: 'bg-blue-50 border-blue-200 text-blue-900' },
  'Part B': { label: 'PART B', sublabel: 'Long Answer Questions', color: 'bg-amber-50 border-amber-200 text-amber-900' },
  'Part C': { label: 'PART C', sublabel: 'Application / Case Study Questions', color: 'bg-purple-50 border-purple-200 text-purple-900' }
};

function groupByUnit(questions: SelectedIatQuestion[]): Map<number, { partA: SelectedIatQuestion[]; partB: SelectedIatQuestion[]; partC: SelectedIatQuestion[] }> {
  const map = new Map<number, { partA: SelectedIatQuestion[]; partB: SelectedIatQuestion[]; partC: SelectedIatQuestion[] }>();
  for (const q of questions) {
    const unit = typeof q.unit === 'number' && q.unit >= 1 && q.unit <= 5 ? q.unit : 0;
    if (!map.has(unit)) map.set(unit, { partA: [], partB: [], partC: [] });
    const b = map.get(unit)!;
    if (q.originalPart === 'Part A') b.partA.push(q);
    else if (q.originalPart === 'Part C') b.partC.push(q);
    else b.partB.push(q);
  }
  return new Map([...map.entries()].sort((a, b) => a[0] - b[0]));
}

interface DetailDrawerProps {
  detail: IatGeneratedBankDetail;
  accentBg: string;
  accentHover: string;
  accentShadow: string;
  showToast: (msg: string) => void;
  onClose: () => void;
}

const DetailDrawer: React.FC<DetailDrawerProps> = ({ detail, accentBg, accentHover, accentShadow, showToast, onClose }) => {
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const unitGroups = groupByUnit(detail.questions);

  // Close export dropdown when clicking outside
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleExportPdf = async () => {
    setExportOpen(false);
    setExporting(true);
    try {
      exportIatBankPdf(detail);
      showToast('PDF export opened in a new window. Use Print → Save as PDF.');
    } catch (err: any) {
      showToast(err?.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const handleExportWord = async () => {
    setExportOpen(false);
    setExporting(true);
    try {
      exportIatBankWord(detail);
      showToast('Word document (.docx) downloaded successfully.');
    } catch (err: any) {
      showToast(err?.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const renderPartSection = (part: 'Part A' | 'Part B' | 'Part C', qs: SelectedIatQuestion[]) => {
    if (qs.length === 0) return null;
    const meta = PART_LABELS[part];
    return (
      <div className="mb-5">
        <div className={`mb-3 flex items-center gap-2 rounded-xl border px-3 py-2 ${meta.color}`}>
          <span className="text-xs font-extrabold uppercase tracking-widest">{meta.label}</span>
          <span className="text-[10px] font-semibold opacity-70">— {meta.sublabel}</span>
          <span className="ml-auto rounded-md bg-white/60 px-2 py-0.5 text-[10px] font-bold">{qs.length} Q</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
          <table className="w-full text-left">
            <thead className="bg-[#F7F8FA] text-[9px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              <tr>
                <th className="w-8 px-3 py-2 text-center">#</th>
                <th className="px-3 py-2">Question</th>
                <th className="w-14 px-2 py-2 text-center">Marks</th>
                <th className="w-14 px-2 py-2 text-center">BTL</th>
                <th className="w-14 px-2 py-2 text-center">CO</th>
                <th className="w-14 px-2 py-2 text-center">PI</th>
                <th className="w-20 px-2 py-2 text-center">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-xs text-[#111827]">
              {qs.map((q, i) => (
                <tr key={`${q.sourceQuestionId}-${i}`} className="align-top hover:bg-[#F9FAFB]">
                  <td className="px-3 py-2.5 text-center font-black text-[#94A3B8]">{i + 1}</td>
                  <td className="px-3 py-2.5 leading-relaxed">{q.questionText}</td>
                  <td className="px-2 py-2.5 text-center font-bold">{q.marks ?? '—'}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-[10px] font-bold">{q.btl || q.bloomsLevel || '—'}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-[10px] font-bold">{q.co || '—'}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-[10px] font-bold">{q.pi || '—'}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-[10px] text-[#94A3B8]"
                    title={q.sourceQuestionId}>
                    {q.sourceQuestionNumber || q.sourceQuestionId.slice(0, 6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm sm:p-6">
      <div className="w-full max-w-6xl rounded-3xl border border-[#E5E7EB] bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] p-6 pb-5">
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#D71945]">IAT Generated Question Bank</span>
            <h3 className="mt-0.5 text-xl font-black text-[#111827] leading-tight">{detail.name}</h3>
            <p className="mt-1 text-[11px] text-[#64748B]">
              {detail.subjectCode} · {detail.department || '—'} · {detail.academicYear || '—'} ·
              Source: <span className="font-semibold text-[#374151]">{detail.sourceBankName || '—'}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Export dropdown */}
            <div ref={exportRef} className="relative">
              <button
                onClick={() => setExportOpen((o) => !o)}
                disabled={exporting || !detail.questions.length}
                className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold text-white shadow-md transition-all disabled:opacity-50 cursor-pointer ${accentBg} ${accentHover} ${accentShadow}`}
              >
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Export
                <ChevronDown className={`h-3 w-3 transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
              </button>
              {exportOpen && (
                <div className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-2xl border border-[#E5E7EB] bg-white py-1.5 shadow-xl">
                  <button
                    onClick={handleExportPdf}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-xs font-bold text-[#111827] hover:bg-[#F7F8FA] transition-colors cursor-pointer"
                  >
                    <FileText className="h-3.5 w-3.5 text-[#D71945]" />
                    Export as PDF
                  </button>
                  <button
                    onClick={handleExportWord}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-xs font-bold text-[#111827] hover:bg-[#F7F8FA] transition-colors cursor-pointer"
                  >
                    <FileType2 className="h-3.5 w-3.5 text-[#1976D2]" />
                    Export as Word (.docx)
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-[#94A3B8] transition-colors hover:bg-[#F1F5F9] hover:text-[#111827] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Total Questions', String(detail.totalQuestions)],
              ['Part A', String(detail.actualPartACount)],
              ['Part B', String(detail.actualPartBCount)],
              ['Part C', String(detail.actualPartCCount)]
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-[#F7F8FA] p-3 text-center">
                <div className="text-[9px] font-extrabold uppercase tracking-wider text-[#94A3B8]">{k}</div>
                <div className="mt-1 text-2xl font-black text-[#111827]">{v}</div>
              </div>
            ))}
          </div>

          {/* Unit-wise distribution summary */}
          <div className="rounded-2xl border border-[#E5E7EB] overflow-hidden">
            <div className="bg-[#F7F8FA] px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-widest text-[#94A3B8]">
              Unit-wise Distribution
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-[9px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
                  <tr>
                    <th className="px-4 py-2 text-left">Unit</th>
                    <th className="px-4 py-2 text-center">Part A</th>
                    <th className="px-4 py-2 text-center">Part B</th>
                    <th className="px-4 py-2 text-center">Part C</th>
                    <th className="px-4 py-2 text-center">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] text-[#111827]">
                  {Array.from(unitGroups.entries()).filter(([u]) => u >= 1 && u <= 5).map(([u, g]) => (
                    <tr key={u} className="hover:bg-[#F9FAFB]">
                      <td className="px-4 py-2 font-bold">UNIT {UNIT_ROMAN[u] || u}</td>
                      <td className="px-4 py-2 text-center font-bold text-blue-700">{g.partA.length || '–'}</td>
                      <td className="px-4 py-2 text-center font-bold text-amber-700">{g.partB.length || '–'}</td>
                      <td className="px-4 py-2 text-center font-bold text-purple-700">{g.partC.length || '–'}</td>
                      <td className="px-4 py-2 text-center font-black">{g.partA.length + g.partB.length + g.partC.length}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#F1F5F9] font-black text-[#111827]">
                    <td className="px-4 py-2.5">TOTAL</td>
                    <td className="px-4 py-2.5 text-center">{detail.actualPartACount}</td>
                    <td className="px-4 py-2.5 text-center">{detail.actualPartBCount}</td>
                    <td className="px-4 py-2.5 text-center">{detail.actualPartCCount || '–'}</td>
                    <td className="px-4 py-2.5 text-center">{detail.totalQuestions}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Source bank safety notice */}
          <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
            <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <p className="text-[10px] leading-relaxed text-emerald-800">
              Every question is linked to its source. The original bank{' '}
              <strong>{detail.sourceBankName || detail.sourceQuestionBankId}</strong> still contains all of its
              questions and was not modified. Export is read-only and never modifies the database.
            </p>
          </div>

          {/* Unit-wise question sections */}
          <div className="space-y-8">
            {Array.from(unitGroups.entries()).filter(([u]) => u >= 1 && u <= 5).map(([u, g]) => {
              const roman = UNIT_ROMAN[u] || String(u);
              const unitTotal = g.partA.length + g.partB.length + g.partC.length;
              return (
                <div key={u}>
                  {/* Unit header */}
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex-1 h-px bg-[#E5E7EB]" />
                    <div className="flex items-center gap-3 rounded-2xl bg-[#1E293B] px-5 py-2.5 text-white">
                      <span className="text-xs font-extrabold uppercase tracking-widest">UNIT – {roman}</span>
                      <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-bold">{unitTotal} Questions</span>
                    </div>
                    <div className="flex-1 h-px bg-[#E5E7EB]" />
                  </div>

                  {renderPartSection('Part A', g.partA)}
                  {renderPartSection('Part B', g.partB)}
                  {renderPartSection('Part C', g.partC)}
                </div>
              );
            })}
          </div>

          {/* Meta info grid */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-[#E5E7EB] pt-4">
            {[
              ['Academic Year', detail.academicYear || '—'],
              ['Department', detail.department || '—'],
              ['Requested Part A', String(detail.requestedPartACount)],
              ['Requested Part B/C', String(detail.requestedPartBcCount)],
              ['Selection Method', detail.selectionMethod],
              ['Status', detail.status],
              ['Created By', detail.createdByName || '—'],
              ['Created At', detail.createdAt ? new Date(detail.createdAt).toLocaleDateString() : '—']
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-[#F7F8FA] p-3">
                <div className="text-[9px] font-extrabold uppercase tracking-wider text-[#94A3B8]">{k}</div>
                <div className="mt-0.5 text-xs font-bold text-[#111827]">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const IatGeneratedBanksView: React.FC = () => {
  const {
    authSession,
    isSuperAdminPortal,
    activeAcademicYearsList,
    academicYearsList,
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

  const token = authSession?.token || '';

  // ---- Filters (Spec §23) — all values come from the database ----
  const [academicYear, setAcademicYear] = useState<string>('');
  const [department, setDepartment] = useState<string>('');
  const [subjectCode, setSubjectCode] = useState<string>('');
  const [sourceBankId, setSourceBankId] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  // ---- Data ----
  const [banks, setBanks] = useState<IatGeneratedBank[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceBanks, setSourceBanks] = useState<SourceBankOption[]>([]);

  // ---- Detail drawer ----
  const [detail, setDetail] = useState<IatGeneratedBankDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<IatGeneratedBank | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const years = activeAcademicYearsList.length > 0 ? activeAcademicYearsList : academicYearsList;
  const depts = activeDepartmentsList.length > 0 ? activeDepartmentsList : [];

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

  const loadBanks = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchIatGeneratedBanks(token, {
        academicYear: academicYear || undefined,
        department: department || undefined,
        subjectCode: subjectCode || undefined,
        sourceQuestionBankId: sourceBankId || undefined,
        status: (status as 'Active' | 'Archived' | undefined) || undefined
      });
      setBanks(rows);
    } catch (err: any) {
      setError(err?.message || 'Failed to load IAT generated question banks.');
      setBanks([]);
    } finally {
      setLoading(false);
    }
  }, [token, academicYear, department, subjectCode, sourceBankId, status]);

  useEffect(() => {
    loadBanks();
  }, [loadBanks]);

  // Source bank options for the "Source Question Bank" filter
  useEffect(() => {
    if (!token || !academicYear || !department) {
      setSourceBanks([]);
      return;
    }
    let cancelled = false;
    fetchSourceQuestionBanks(token, { academicYear, department, subjectCode: subjectCode || undefined })
      .then((rows) => !cancelled && setSourceBanks(rows))
      .catch(() => !cancelled && setSourceBanks([]));
    return () => {
      cancelled = true;
    };
  }, [token, academicYear, department, subjectCode]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchIatGeneratedBank(token, id));
    } catch (err: any) {
      showToast(err?.message || 'Failed to load the IAT question bank.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleArchive = async (bank: IatGeneratedBank) => {
    setBusyId(bank.id);
    try {
      await archiveIatGeneratedBank(token, bank.id, 'Archived from the IAT Generated Question Banks list');
      showToast(`"${bank.name}" archived. The original question bank was not modified.`);
      loadBanks();
    } catch (err: any) {
      showToast(err?.message || 'Failed to archive the IAT question bank.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRestore = async (bank: IatGeneratedBank) => {
    setBusyId(bank.id);
    try {
      await restoreIatGeneratedBank(token, bank.id);
      showToast(`"${bank.name}" restored and can be used for IAT paper generation again.`);
      loadBanks();
    } catch (err: any) {
      showToast(err?.message || 'Failed to restore the IAT question bank.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (bank: IatGeneratedBank) => {
    setBusyId(bank.id);
    try {
      await deleteIatGeneratedBank(token, bank.id);
      showToast(`"${bank.name}" deleted. The source question bank was not deleted or modified.`);
      setConfirmDelete(null);
      loadBanks();
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete the IAT question bank.');
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return banks;
    return banks.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.subjectCode.toLowerCase().includes(q) ||
        (b.subjectName || '').toLowerCase().includes(q) ||
        (b.sourceBankName || '').toLowerCase().includes(q)
    );
  }, [banks, search]);

  const selectClass =
    'w-full rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#111827] outline-none transition focus:border-[#D71945] focus:ring-2 focus:ring-[#D71945]/20 disabled:bg-[#F7F8FA] disabled:text-[#94A3B8]';

  const clearFilters = () => {
    setAcademicYear('');
    setDepartment('');
    setSubjectCode('');
    setSourceBankId('');
    setStatus('');
    setSearch('');
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <span className={`text-[11px] font-extrabold uppercase tracking-widest ${accentText}`}>
            Internal Assessment Only
          </span>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            IAT Generated Question Banks
          </h1>
          <p className="mt-1 max-w-3xl text-xs text-[#64748B]">
            Every reduced IAT question bank created from an original question bank. Each one keeps a permanent
            link to its source, so the original bank and the generated bank always remain separate entities.
          </p>
        </div>
        <button
          onClick={() => setActiveTab('iat-question-bank-generator')}
          className={`flex items-center gap-2 self-start sm:self-auto rounded-xl px-4 py-2.5 text-xs font-extrabold text-white shadow-md transition-all ${accentBg} ${accentShadow} ${accentHover} cursor-pointer`}
        >
          <Sparkles className="h-4 w-4" />
          <span>New IAT Question Bank</span>
        </button>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <p className="text-[11px] leading-relaxed text-[#64748B]">
          Only Internal Assessment I and II banks appear here. End Semester question banks are never generated by
          this feature. Deleting or archiving a generated bank never deletes or modifies its source question bank.
        </p>
      </div>

      {/* Filters (Spec §23) */}
      <div className="rounded-3xl border border-[#E5E7EB] bg-white p-5 sm:p-6 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              Academic Year
            </span>
            <select
              value={academicYear}
              onChange={(e) => {
                setAcademicYear(e.target.value);
                setSubjectCode('');
                setSourceBankId('');
              }}
              className={selectClass}
            >
              <option value="">All academic years</option>
              {years.map((y) => (
                <option key={y.id} value={y.year_label}>
                  {y.year_label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              Department
            </span>
            <select
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                setSubjectCode('');
                setSourceBankId('');
              }}
              className={selectClass}
            >
              <option value="">All departments</option>
              {depts.map((d) => (
                <option key={d.id} value={d.department_code}>
                  {d.department_code} — {d.department_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              Subject
            </span>
            <select
              value={subjectCode}
              onChange={(e) => {
                setSubjectCode(e.target.value);
                setSourceBankId('');
              }}
              className={selectClass}
            >
              <option value="">All subjects</option>
              {subjectOptions.map((s) => (
                <option key={s.subject_code} value={s.subject_code}>
                  {s.subject_code} — {s.subject_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              Source Question Bank
            </span>
            <select
              value={sourceBankId}
              onChange={(e) => setSourceBankId(e.target.value)}
              disabled={!sourceBanks.length}
              className={selectClass}
            >
              <option value="">All source banks</option>
              {sourceBanks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.subject_code} — {b.file_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              Status
            </span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
              <option value="">Active only</option>
              <option value="Active">Active</option>
              <option value="Archived">Archived</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              Search
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Bank name, subject…"
                className={`${selectClass} pl-9`}
              />
            </div>
          </label>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2 text-[11px] font-bold text-[#64748B] transition-all hover:border-slate-400 hover:text-[#111827] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" /> Clear Filters
          </button>
          <button
            onClick={loadBanks}
            className="flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2 text-[11px] font-bold text-[#64748B] transition-all hover:border-slate-400 hover:text-[#111827] cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-[11px] font-semibold text-red-800">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Table (Spec §22) */}
      <div className="rounded-3xl border border-[#E5E7EB] bg-white shadow-xs overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-xs text-[#64748B]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading IAT generated question banks…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <Layers className="h-8 w-8 text-[#CBD5E1]" />
            <p className="text-sm font-extrabold text-[#111827]">No IAT generated question banks yet</p>
            <p className="max-w-md text-xs text-[#64748B]">
              Create one from the IAT Question Bank Generator by selecting an original question bank and entering
              the reduced Part A and Part B + Part C counts.
            </p>
            <button
              onClick={() => setActiveTab('iat-question-bank-generator')}
              className={`mt-2 flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold text-white shadow-md transition-all ${accentBg} ${accentShadow} ${accentHover} cursor-pointer`}
            >
              <Sparkles className="h-4 w-4" /> Open IAT Question Bank Generator
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left">
              <thead className="bg-[#F7F8FA] text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
                <tr>
                  <th className="px-4 py-3">Academic Year</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Subject Code</th>
                  <th className="px-4 py-3">Subject Name</th>
                  <th className="px-4 py-3">Source Bank</th>
                  <th className="px-4 py-3 text-center">Part A</th>
                  <th className="px-4 py-3 text-center">Part B</th>
                  <th className="px-4 py-3 text-center">Part C</th>
                  <th className="px-4 py-3 text-center">Total</th>
                  <th className="px-4 py-3">Created By</th>
                  <th className="px-4 py-3">Created Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] text-xs text-[#111827]">
                {filtered.map((b) => (
                  <tr key={b.id} className="hover:bg-[#F9FAFB]">
                    <td className="px-4 py-3 font-bold">{b.academicYear || '—'}</td>
                    <td className="px-4 py-3 font-bold">{b.department || '—'}</td>
                    <td className="px-4 py-3 font-mono font-bold">{b.subjectCode}</td>
                    <td className="px-4 py-3">{b.subjectName || '—'}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-[#64748B]" title={b.sourceBankName || ''}>
                      {b.sourceBankName || '—'}
                    </td>
                    <td className="px-4 py-3 text-center font-black">{b.actualPartACount}</td>
                    <td className="px-4 py-3 text-center font-black">{b.actualPartBCount}</td>
                    <td className="px-4 py-3 text-center font-black">{b.actualPartCCount}</td>
                    <td className="px-4 py-3 text-center font-black">{b.totalQuestions}</td>
                    <td className="px-4 py-3">{b.createdByName || '—'}</td>
                    <td className="px-4 py-3 text-[#64748B]">
                      {b.createdAt ? new Date(b.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-extrabold ${
                          statusBadge[b.status] || 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openDetail(b.id)}
                          title="View"
                          className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#64748B] transition-all hover:border-[#1976D2] hover:text-[#1976D2] cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setAcademicYear(b.academicYear || '');
                            setDepartment(b.department || '');
                            setSubjectCode(b.subjectCode);
                            setSourceBankId(b.sourceQuestionBankId);
                            setActiveTab('iat-question-bank-generator');
                            showToast(
                              `Loaded the source of "${b.name}". Enter new counts and generate — "${b.name}" will not be overwritten.`
                            );
                          }}
                          disabled={b.status !== 'Active'}
                          title="Regenerate a new bank from the same source"
                          className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#64748B] transition-all hover:border-[#D71945] hover:text-[#D71945] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </button>
                        {b.status === 'Active' ? (
                          <button
                            onClick={() => handleArchive(b)}
                            disabled={busyId === b.id}
                            title="Archive"
                            className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#64748B] transition-all hover:border-amber-500 hover:text-amber-600 disabled:opacity-50 cursor-pointer"
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRestore(b)}
                            disabled={busyId === b.id}
                            title="Restore"
                            className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#64748B] transition-all hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-50 cursor-pointer"
                          >
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmDelete(b)}
                          disabled={busyId === b.id}
                          title="Delete"
                          className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#64748B] transition-all hover:border-red-500 hover:text-red-600 disabled:opacity-50 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {detail && (
        <DetailDrawer
          detail={detail}
          accentBg={accentBg}
          accentHover={accentHover}
          accentShadow={accentShadow}
          showToast={showToast}
          onClose={() => setDetail(null)}
        />
      )}

      {detailLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-2xl bg-white px-5 py-4 text-xs font-bold text-[#111827] shadow-xl">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        </div>
      )}

      {/* Delete confirmation — never deletes the source bank */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-[#E5E7EB] bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-red-50 p-2">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-black text-[#111827]">Delete this IAT question bank?</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#64748B]">
                  <strong>{confirmDelete.name}</strong> and its {confirmDelete.totalQuestions} selected questions
                  will be permanently removed. The source question bank{' '}
                  <strong>{confirmDelete.sourceBankName || 'original bank'}</strong> will <strong>not</strong> be
                  deleted or modified.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-xs font-bold text-[#64748B] transition-all hover:border-slate-400 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={busyId === confirmDelete.id}
                className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-extrabold text-white shadow-md transition-all hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {busyId === confirmDelete.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                <span>Delete Generated Bank</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
