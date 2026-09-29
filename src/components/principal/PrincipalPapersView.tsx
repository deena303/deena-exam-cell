import React, { useEffect, useMemo, useState } from 'react';
import {
  FileCheck2,
  RefreshCw,
  Search,
  ShieldCheck,
  Eye,
  CheckCircle2,
  Undo2,
  FileSpreadsheet,
  Download,
  Landmark,
  BookOpen
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fetchPaperAssignments, reviewPaperAssignment, auditPaperDownload, fetchSummaryStats } from '../../services/authApi';
import { paperFileName } from '../../utils/paperFileName';
import { PrincipalPaperAssignment } from '../../types';

const REVIEW_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending Review', cls: 'bg-amber-100 text-amber-800' },
  reviewed: { label: 'Reviewed', cls: 'bg-emerald-100 text-emerald-800' },
  returned: { label: 'Returned', cls: 'bg-[#FFF0F3] text-[#D71945]' }
};

/**
 * Principal Portal — Generated / Assigned Papers (Spec §8)
 *
 * Read-only view of every paper assigned to the Principal for inspection,
 * plus basic system totals. Uses the existing MSAJCE card/table styling.
 */
export const PrincipalPapersView: React.FC = () => {
  const { authSession, setActiveTab, showToast } = useApp();
  const [assignments, setAssignments] = useState<PrincipalPaperAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'reviewed' | 'returned'>('all');
  const [stats, setStats] = useState<{ subjects: number; questionBanks: number; generatedPapers: number } | null>(null);
  const [reviewing, setReviewing] = useState<PrincipalPaperAssignment | null>(null);
  const [remarks, setRemarks] = useState('');

  const token = authSession?.token || '';

  const load = () => {
    setLoading(true);
    Promise.all([fetchPaperAssignments({}, token), fetchSummaryStats()])
      .then(([rows, summary]) => {
        setAssignments(rows as PrincipalPaperAssignment[]);
        setStats({
          subjects: summary?.subjects ?? 0,
          questionBanks: summary?.questionBanks ?? 0,
          generatedPapers: summary?.generatedPapers ?? 0
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(load, [authSession]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assignments.filter((a) => {
      if (filter !== 'all' && a.review_status !== filter) return false;
      if (!q) return true;
      return (
        (a.paper_code || '').toLowerCase().includes(q) ||
        (a.subject_code || '').toLowerCase().includes(q) ||
        (a.subject_name || '').toLowerCase().includes(q) ||
        (a.set_name || '').toLowerCase().includes(q)
      );
    });
  }, [assignments, filter, search]);

  const submitReview = async (status: 'reviewed' | 'returned') => {
    if (!reviewing || !token) return;
    try {
      await reviewPaperAssignment(reviewing.id, { reviewStatus: status, reviewRemarks: remarks || undefined }, token);
      showToast(status === 'reviewed' ? 'Paper marked as reviewed.' : 'Paper returned to the Exam Cell.');
      setReviewing(null);
      setRemarks('');
      load();
    } catch (err: any) {
      showToast(err.message || 'Failed to submit review.');
    }
  };

  const systemCards = [
    { label: 'Total Subjects', value: stats?.subjects ?? 0, icon: BookOpen, color: 'text-[#1976D2]', bg: 'bg-[#EAF3FF]' },
    { label: 'Total Question Banks', value: stats?.questionBanks ?? 0, icon: FileCheck2, color: 'text-[#D71945]', bg: 'bg-[#FFF0F3]' },
    { label: 'Total Generated Papers', value: stats?.generatedPapers ?? 0, icon: FileSpreadsheet, color: 'text-emerald-700', bg: 'bg-emerald-50' }
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-700">Principal Portal</span>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            Generated / Assigned Papers
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Papers assigned to you by the Exam Cell for inspection, and basic system information.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-xs font-bold text-[#111827] hover:bg-[#F7F8FA] transition-all self-start sm:self-auto cursor-pointer"
        >
          <RefreshCw className="h-4 w-4 text-emerald-700" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Basic System Information (Spec §8) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {systemCards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="rounded-3xl border border-[#E5E7EB] bg-white p-5 shadow-xs flex items-center gap-4">
              <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${c.bg}`}>
                <Icon className={`h-5 w-5 ${c.color}`} />
              </div>
              <div>
                <div className="text-2xl font-black text-[#111827]">{loading ? '—' : c.value}</div>
                <div className="text-xs font-semibold text-[#64748B]">{c.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-xs flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8]" />
          <input
            type="text"
            placeholder="Search by paper code, subject code or set…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] py-2 pl-9 pr-3 text-xs focus:border-emerald-600 focus:outline-none"
          />
        </div>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as any)}
          className="rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] px-3 py-2 text-xs font-semibold focus:border-emerald-600 focus:outline-none"
        >
          <option value="all">All Papers</option>
          <option value="pending">Pending Review</option>
          <option value="reviewed">Reviewed</option>
          <option value="returned">Returned</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-2xl bg-[#F1F5F9] animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-12 text-center">
          <FileCheck2 className="h-10 w-10 text-[#94A3B8] mx-auto mb-3" />
          <p className="text-sm font-bold text-[#64748B]">No papers assigned yet.</p>
          <p className="text-xs text-[#94A3B8] mt-1">
            Papers assigned by the Exam Cell for review will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-[#E5E7EB] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F7F8FA] text-[#64748B] font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3.5 px-4">Paper Code</th>
                  <th className="py-3.5 px-3">Subject Code</th>
                  <th className="py-3.5 px-3">Subject Name</th>
                  <th className="py-3.5 px-3">Exam Type</th>
                  <th className="py-3.5 px-3 text-center">Set</th>
                  <th className="py-3.5 px-3">Assigned</th>
                  <th className="py-3.5 px-3">Review Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {filtered.map((a) => {
                  const badge = REVIEW_LABELS[a.review_status] || REVIEW_LABELS.pending;
                  const fileName = paperFileName(
                    { subjectCode: a.subject_code, examType: a.exam_type, setLetter: a.set_name },
                    'pdf'
                  );
                  return (
                    <tr key={a.id} className="hover:bg-[#F7F8FA] transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-[#111827] whitespace-nowrap">{a.paper_code}</td>
                      <td className="py-3.5 px-3 font-mono font-extrabold text-emerald-700 whitespace-nowrap">{a.subject_code}</td>
                      <td className="py-3.5 px-3 font-semibold text-[#111827]">{a.subject_name || '—'}</td>
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                          {a.exam_type}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-emerald-700 text-white font-black text-xs">
                          {a.set_name || 'A'}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-[11px] text-[#64748B] whitespace-nowrap">
                        {new Date(a.assigned_at).toLocaleDateString('en-IN')}
                      </td>
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {a.paper_snapshot && (
                            <button
                              onClick={() => setActiveTab('generated-papers')}
                              className="inline-flex items-center gap-1 rounded-xl border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#64748B] hover:bg-[#F7F8FA] cursor-pointer"
                              title="Open in Generated Papers"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => { setReviewing(a); setRemarks(a.review_remarks || ''); }}
                            className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            <span>Review</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-[#E5E7EB] bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <Landmark className="h-6 w-6 text-emerald-700" />
              <div>
                <h3 className="text-base font-extrabold text-[#111827]">Review Paper</h3>
                <p className="text-xs text-[#64748B]">{reviewing.paper_code} · {reviewing.subject_code} · Set {reviewing.set_name || 'A'}</p>
              </div>
            </div>

            <div className="rounded-xl bg-[#F7F8FA] p-3 text-[11px] text-[#64748B] space-y-0.5">
              <p>File name: <span className="font-mono font-bold text-[#111827]">{paperFileName({ subjectCode: reviewing.subject_code, examType: reviewing.exam_type, setLetter: reviewing.set_name }, 'pdf')}</span></p>
              <p>Assigned by: <strong className="text-[#111827]">{reviewing.assigned_by_name}</strong></p>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#111827] mb-1">Review Remarks</label>
              <textarea
                rows={3}
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                placeholder="Optional remarks for the Exam Cell…"
                className="w-full rounded-xl border border-[#E5E7EB] p-3 text-xs focus:border-emerald-600 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setReviewing(null)}
                className="rounded-xl border border-[#E5E7EB] px-4 py-2 text-xs font-bold text-[#64748B] hover:bg-[#F7F8FA] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => submitReview('returned')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-[#FFF0F3] px-4 py-2 text-xs font-bold text-[#D71945] hover:bg-red-100 cursor-pointer"
              >
                <Undo2 className="h-3.5 w-3.5" /> Return
              </button>
              <button
                onClick={() => submitReview('reviewed')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Mark Reviewed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
