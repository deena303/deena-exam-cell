import React, { useState, useEffect, useMemo } from 'react';
import {
  ClipboardList,
  CheckCircle2,
  XCircle,
  Eye,
  RefreshCw,
  Search,
  Filter,
  AlertCircle,
  ShieldCheck,
  Ban
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fetchPaperRequests, decidePaperRequest } from '../../services/authApi';
import { AdditionalPaperRequest } from '../../types';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled';

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-800' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-600' }
};

const formatDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * Principal Portal — Additional Paper Requests (Spec §13)
 *
 * Table columns: Academic Year, Department, Subject Code, Subject Name,
 * Exam Type, Requested Set, Current Sets, Requested By, Requested Date,
 * Reason, Status, Actions.
 *
 * Every action here is enforced server-side — the backend rejects any
 * decision attempt from a non-Principal role and blocks self-approval.
 */
export const PrincipalRequestsView: React.FC = () => {
  const { authSession, currentUser, showToast } = useApp();
  const [requests, setRequests] = useState<AdditionalPaperRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [filterExamType, setFilterExamType] = useState('all');

  const [viewing, setViewing] = useState<AdditionalPaperRequest | null>(null);
  const [decision, setDecision] = useState<{ request: AdditionalPaperRequest; type: 'approved' | 'rejected' } | null>(null);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const token = authSession?.token || '';

  const load = () => {
    setLoading(true);
    fetchPaperRequests({}, token)
      .then(data => {
        setRequests(data as AdditionalPaperRequest[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(load, [authSession]);

  const filtered = useMemo(() => {
    return requests.filter(r => {
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (filterExamType !== 'all' && r.exam_type !== filterExamType) return false;
      if (search) {
        const q = search.toLowerCase();
        const match =
          (r.subjects?.subject_name || '').toLowerCase().includes(q) ||
          (r.subjects?.subject_code || '').toLowerCase().includes(q) ||
          (r.request_number || '').toLowerCase().includes(q) ||
          (r.requested_by_name || '').toLowerCase().includes(q) ||
          (r.reason || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [requests, filterStatus, filterExamType, search]);

  const openDecision = (request: AdditionalPaperRequest, type: 'approved' | 'rejected') => {
    setDecision({ request, type });
    setRemarks('');
  };

  const handleConfirmDecision = async () => {
    if (!decision || !token) return;
    if (decision.type === 'rejected' && !remarks.trim()) {
      showToast('A rejection reason is required.');
      return;
    }
    setSubmitting(true);
    try {
      await decidePaperRequest(
        decision.request.id,
        { decision: decision.type, remarks: remarks.trim() || undefined },
        token
      );
      showToast(
        decision.type === 'approved'
          ? `Request ${decision.request.request_number} approved. The Exam Cell can now generate Set ${(decision.request.requested_set_names || []).join(', ')}.`
          : `Request ${decision.request.request_number} rejected. The Exam Cell cannot generate the requested set.`
      );
      setDecision(null);
      setRemarks('');
      load();
    } catch (err: any) {
      showToast(err.message || 'Failed to process decision.');
    } finally {
      setSubmitting(false);
    }
  };

  const isOwnRequest = (r: AdditionalPaperRequest) => r.requested_by_user_id === currentUser.id;
  const StatusBadge = ({ status }: { status: string }) => {
    const s = STATUS_LABELS[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
    return <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ${s.cls}`}>{s.label}</span>;
  };

  const DecisionCell = ({ r }: { r: AdditionalPaperRequest }) => {
    if (r.status === 'pending') {
      if (isOwnRequest(r)) {
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700">
            <Ban className="h-3 w-3" /> Cannot approve own request
          </span>
        );
      }
      return (
        <div className="inline-flex items-center gap-1.5">
          <button
            onClick={() => openDecision(r, 'approved')}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-emerald-700 transition-colors cursor-pointer"
          >
            <CheckCircle2 className="h-3 w-3" /> Approve
          </button>
          <button
            onClick={() => openDecision(r, 'rejected')}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-[#FFF0F3] px-2.5 py-1 text-[10px] font-bold text-[#D71945] hover:bg-red-100 transition-colors cursor-pointer"
          >
            <XCircle className="h-3 w-3" /> Reject
          </button>
        </div>
      );
    }

    if (r.status === 'approved') {
      return (
        <div className="leading-tight">
          <div className="font-bold text-emerald-700">Approved</div>
          <div className="text-[10px] text-[#64748B]">By: {r.principal_decision_by_name || '—'}</div>
          <div className="text-[10px] text-[#64748B]">On: {formatDateTime(r.principal_decision_at)}</div>
          {r.consumed ? (
            <div className="mt-0.5 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">
              Consumed by Set {r.consumed_set_name}
            </div>
          ) : (
            <div className="mt-0.5 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
              Awaiting generation
            </div>
          )}
        </div>
      );
    }

    if (r.status === 'rejected') {
      return (
        <div className="leading-tight">
          <div className="font-bold text-[#D71945]">Rejected</div>
          <div className="text-[10px] text-[#64748B]">By: {r.rejected_by_name || r.principal_decision_by_name || '—'}</div>
          <div className="text-[10px] text-[#64748B]">On: {formatDateTime(r.rejected_at || r.principal_decision_at)}</div>
        </div>
      );
    }

    return <span className="text-[10px] text-slate-400">—</span>;
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-700">Principal Portal</span>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            Additional Paper Requests
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Review and decide on additional paper set requests submitted by the Exam Cell once the standard set limit is reached.
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

      {/* Filters */}
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-xs flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8]" />
          <input
            type="text"
            placeholder="Search by subject, request ID, requester or reason…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] py-2 pl-9 pr-3 text-xs focus:border-emerald-600 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-[#64748B]" />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as StatusFilter)}
            className="rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] px-3 py-2 text-xs font-semibold focus:border-emerald-600 focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={filterExamType}
            onChange={e => setFilterExamType(e.target.value)}
            className="rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] px-3 py-2 text-xs font-semibold focus:border-emerald-600 focus:outline-none"
          >
            <option value="all">All Exam Types</option>
            <option value="Internal Assessment I">Internal Assessment I</option>
            <option value="Internal Assessment II">Internal Assessment II</option>
            <option value="End Semester Examination">End Semester Examination</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-2xl bg-[#F1F5F9] animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-12 text-center">
          <ClipboardList className="h-10 w-10 text-[#94A3B8] mx-auto mb-3" />
          <p className="text-sm font-bold text-[#64748B]">No requests found.</p>
          <p className="text-xs text-[#94A3B8] mt-1">Requests from the Exam Cell will appear here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-[#E5E7EB] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F7F8FA] text-[#64748B] font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3.5 px-3">Request</th>
                  <th className="py-3.5 px-3">Academic Year</th>
                  <th className="py-3.5 px-3">Department</th>
                  <th className="py-3.5 px-3">Subject Code</th>
                  <th className="py-3.5 px-3 min-w-[160px]">Subject Name</th>
                  <th className="py-3.5 px-3">Exam Type</th>
                  <th className="py-3.5 px-3 text-center">Requested Set</th>
                  <th className="py-3.5 px-3 text-center">Current Sets</th>
                  <th className="py-3.5 px-3">Requested By</th>
                  <th className="py-3.5 px-3">Requested Date</th>
                  <th className="py-3.5 px-3 min-w-[180px]">Reason</th>
                  <th className="py-3.5 px-3">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {filtered.map(r => (
                  <tr key={r.id} className="hover:bg-[#F7F8FA] transition-colors align-top">
                    <td className="py-3.5 px-3 font-mono font-bold text-[#111827] whitespace-nowrap">{r.request_number}</td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-800">
                        {r.academic_years?.year_label || '—'}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 font-bold text-slate-700 whitespace-nowrap">
                      {r.departments?.department_code || '—'}
                      {r.departments?.department_name && (
                        <div className="text-[10px] font-medium text-slate-400">{r.departments.department_name}</div>
                      )}
                    </td>
                    <td className="py-3.5 px-3 font-mono font-extrabold text-emerald-700 whitespace-nowrap">
                      {r.subjects?.subject_code || '—'}
                    </td>
                    <td className="py-3.5 px-3 font-semibold text-[#111827]">{r.subjects?.subject_name || '—'}</td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                        {r.exam_type}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-emerald-700 text-white font-black text-xs">
                        {(r.requested_set_names || []).join(',') || '—'}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-center text-[11px] font-bold text-[#111827]">
                      {r.existing_set_count}
                      <div className="text-[10px] font-medium text-slate-400">
                        {r.existing_set_names?.length ? r.existing_set_names.join(', ') : 'None'}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-[11px] text-[#64748B] whitespace-nowrap">{r.requested_by_name}</td>
                    <td className="py-3.5 px-3 text-[11px] text-[#64748B] whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                    <td className="py-3.5 px-3 text-[11px] text-[#64748B]">
                      <span className="line-clamp-3">{r.reason}</span>
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          onClick={() => setViewing(r)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1 text-[10px] font-bold text-[#64748B] hover:bg-[#F7F8FA] cursor-pointer"
                          title="View full details"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                        {r.status === 'pending' && !isOwnRequest(r) && (
                          <>
                            <button
                              onClick={() => openDecision(r, 'approved')}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-emerald-700 transition-colors cursor-pointer"
                            >
                              <CheckCircle2 className="h-3 w-3" /> Approve
                            </button>
                            <button
                              onClick={() => openDecision(r, 'rejected')}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-[#FFF0F3] px-2.5 py-1 text-[10px] font-bold text-[#D71945] hover:bg-red-100 transition-colors cursor-pointer"
                            >
                              <XCircle className="h-3 w-3" /> Reject
                            </button>
                          </>
                        )}
                        {r.status === 'approved' && <DecisionCell r={r} />}
                        {r.status === 'rejected' && <DecisionCell r={r} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-[#E5E7EB] bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-emerald-700" />
              <div>
                <h3 className="text-base font-extrabold text-[#111827]">{viewing.request_number}</h3>
                <p className="text-xs text-[#64748B]">
                  {viewing.subjects?.subject_name} ({viewing.subjects?.subject_code}) · {viewing.exam_type}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs rounded-2xl bg-[#F7F8FA] p-4">
              {[
                { l: 'Academic Year', v: viewing.academic_years?.year_label || '—' },
                { l: 'Department', v: viewing.departments?.department_name || viewing.departments?.department_code || '—' },
                { l: 'Exam Type', v: viewing.exam_type },
                { l: 'Existing Sets', v: `${viewing.existing_set_count} (${(viewing.existing_set_names || []).join(', ') || 'None'})` },
                { l: 'Requested Set', v: (viewing.requested_set_names || []).join(', ') || '—' },
                { l: 'Requested By', v: viewing.requested_by_name },
                { l: 'Requested Date', v: formatDateTime(viewing.created_at) },
                { l: 'Status', v: viewing.status },
                { l: 'Approval Consumed', v: viewing.consumed ? `Yes — Set ${viewing.consumed_set_name || ''}` : 'No' }
              ].map(x => (
                <div key={x.l}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">{x.l}</div>
                  <div className="mt-0.5 font-semibold text-[#111827]">{x.v}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Reason for Additional Paper</div>
              <p className="mt-1 text-xs text-[#111827] leading-relaxed rounded-xl border border-[#E5E7EB] p-3">{viewing.reason}</p>
            </div>

            {viewing.principal_decision_at && (
              <div className="rounded-2xl border border-[#E5E7EB] p-4 text-xs space-y-1">
                <div className="font-extrabold text-[#111827]">Principal Decision</div>
                <div className="text-[#64748B]">By <strong>{viewing.principal_decision_by_name}</strong> on {formatDateTime(viewing.principal_decision_at)}</div>
                {viewing.approved_set_names && viewing.approved_set_names.length > 0 && (
                  <div className="text-[#64748B]">Approved set(s): <strong>{viewing.approved_set_names.join(', ')}</strong></div>
                )}
                {viewing.rejection_reason && (
                  <div className="text-[#64748B]">Rejection reason: <em className="text-[#D71945]">{viewing.rejection_reason}</em></div>
                )}
                {viewing.principal_remarks && (
                  <div className="text-[#64748B]">Remarks: <em>{viewing.principal_remarks}</em></div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                onClick={() => setViewing(null)}
                className="rounded-xl border border-[#E5E7EB] px-4 py-2 text-xs font-bold text-[#64748B] hover:bg-[#F7F8FA] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approve / Reject Modal */}
      {decision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-[#E5E7EB] bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              {decision.type === 'approved'
                ? <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                : <XCircle className="h-6 w-6 text-[#D71945]" />}
              <div>
                <h3 className="text-base font-extrabold text-[#111827]">
                  {decision.type === 'approved' ? 'Approve Additional Set Request' : 'Reject Additional Set Request'}
                </h3>
                <p className="text-xs text-[#64748B]">{decision.request.request_number}</p>
              </div>
            </div>

            <div className="rounded-xl bg-[#F7F8FA] p-3 text-xs space-y-0.5">
              <p className="font-bold text-[#111827]">
                {decision.request.subjects?.subject_name} ({decision.request.subjects?.subject_code})
              </p>
              <p className="text-[#64748B]">
                Academic Year: <strong>{decision.request.academic_years?.year_label || '—'}</strong> ·
                Department: <strong>{decision.request.departments?.department_code || '—'}</strong> ·
                Exam: <strong>{decision.request.exam_type}</strong>
              </p>
              <p className="text-[#64748B]">
                Existing Sets: <strong>{(decision.request.existing_set_names || []).join(', ') || 'None'}</strong> ·
                Requested Set: <strong>{(decision.request.requested_set_names || []).join(', ')}</strong>
              </p>
            </div>

            {decision.type === 'approved' && (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-900">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  This approval is bound to Set {(decision.request.requested_set_names || []).join(', ')} for this exact
                  Academic Year, Department, Subject and Exam Type. It cannot be reused for any other set, and it is
                  consumed as soon as the paper is generated.
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-[#111827] mb-1">
                {decision.type === 'rejected' ? 'Rejection Reason (Required)' : 'Approval Remarks (Optional)'}
              </label>
              <textarea
                rows={3}
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                placeholder={
                  decision.type === 'rejected'
                    ? 'Explain why the additional paper cannot be permitted…'
                    : 'Optional remarks for the Exam Cell…'
                }
                className="w-full rounded-xl border border-[#E5E7EB] p-3 text-xs focus:border-emerald-600 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setDecision(null)}
                disabled={submitting}
                className="rounded-xl border border-[#E5E7EB] px-4 py-2 text-xs font-bold text-[#64748B] hover:bg-[#F7F8FA] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDecision}
                disabled={submitting}
                className={`rounded-xl px-5 py-2 text-xs font-bold text-white shadow-md transition-colors disabled:opacity-50 cursor-pointer ${
                  decision.type === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-[#D71945] hover:bg-[#c0153c]'
                }`}
              >
                {submitting ? 'Processing…' : decision.type === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
