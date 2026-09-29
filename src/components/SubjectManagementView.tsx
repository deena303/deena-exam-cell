import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  Database,
  Edit2,
  Trash2,
  CheckCircle2,
  X,
  Loader2,
  AlertCircle,
  PowerOff,
  Power,
  Info
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  SubjectRecord,
  fetchSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  fetchAcademicYears,
  fetchDepartments,
  AcademicYearRecord,
  DepartmentRecord
} from '../services/authApi';

interface SubjectFormState {
  subject_code: string;
  subject_name: string;
  department_id: string;
  academic_year_id: string;
  semester: string;
  regulation: string;
}

const EMPTY_FORM: SubjectFormState = {
  subject_code: '',
  subject_name: '',
  department_id: '',
  academic_year_id: '',
  semester: '',
  regulation: 'Regulation 2024'
};

export const SubjectManagementView: React.FC = () => {
  const { authSession, setSelectedSubjectCode, setActiveTab, showToast, academicYearsList, activeDepartmentsList } = useApp();

  const token = authSession?.token || '';

  // ---- Data ----
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [years, setYears] = useState<AcademicYearRecord[]>([]);
  const [depts, setDepts] = useState<DepartmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Filters ----
  const [search, setSearch] = useState('');
  const [filterYearId, setFilterYearId] = useState('');
  const [filterDeptId, setFilterDeptId] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');

  // ---- Modal ----
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SubjectFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // ---- Load departments and years (use from context when available) ----
  useEffect(() => {
    const contextYears = academicYearsList.length > 0 ? academicYearsList : null;
    const contextDepts = activeDepartmentsList.length > 0 ? activeDepartmentsList : null;

    const promises: Promise<any>[] = [];
    if (!contextYears) promises.push(fetchAcademicYears(false));
    if (!contextDepts) promises.push(fetchDepartments(false));

    if (contextYears) setYears(contextYears as AcademicYearRecord[]);
    if (contextDepts) setDepts(contextDepts as DepartmentRecord[]);

    if (promises.length > 0) {
      Promise.all(promises).then(([y, d]) => {
        if (!contextYears && y) setYears(y);
        if (!contextDepts && d) setDepts(d);
      }).catch(console.warn);
    }
  }, [academicYearsList, activeDepartmentsList]);

  // ---- Load subjects ----
  const loadSubjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSubjects({
        academicYearId: filterYearId || undefined,
        departmentId: filterDeptId || undefined
      });
      setSubjects(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load subjects.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSubjects(); }, [filterYearId, filterDeptId]);

  // ---- Filtered / searched view ----
  const filtered = useMemo(() => {
    let out = subjects;
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(
        (s) =>
          s.subject_code.toLowerCase().includes(q) ||
          s.subject_name.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all') {
      out = out.filter((s) => s.status === filterStatus);
    }
    return out;
  }, [subjects, search, filterStatus]);

  // ---- Open add modal ----
  const openAdd = () => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      academic_year_id: years.find((y) => y.status === 'active')?.id || '',
      department_id: depts[0]?.id || ''
    });
    setFormError(null);
    setModalOpen(true);
  };

  // ---- Open edit modal ----
  const openEdit = (sub: SubjectRecord) => {
    setEditingId(sub.id);
    setForm({
      subject_code: sub.subject_code,
      subject_name: sub.subject_name,
      department_id: sub.department_id,
      academic_year_id: sub.academic_year_id,
      semester: sub.semester || '',
      regulation: sub.regulation || 'Regulation 2024'
    });
    setFormError(null);
    setModalOpen(true);
  };

  // ---- Save ----
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const { subject_code, subject_name, department_id, academic_year_id } = form;
    if (!subject_code.trim() || !subject_name.trim() || !department_id || !academic_year_id) {
      setFormError('Subject code, name, department and academic year are required.');
      return;
    }
    if (!token) { showToast('Not authenticated.'); return; }

    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        const updated = await updateSubject(editingId, {
          subject_code: subject_code.trim().toUpperCase(),
          subject_name: subject_name.trim(),
          department_id,
          academic_year_id,
          semester: form.semester.trim() || null,
          regulation: form.regulation.trim() || null
        } as any, token);
        setSubjects((prev) => prev.map((s) => (s.id === editingId ? updated : s)));
        showToast(`Subject "${updated.subject_code}" updated.`);
      } else {
        const created = await createSubject(
          {
            subject_code: subject_code.trim().toUpperCase(),
            subject_name: subject_name.trim(),
            department_id,
            academic_year_id,
            semester: form.semester.trim() || undefined,
            regulation: form.regulation.trim() || undefined
          },
          token
        );
        setSubjects((prev) => [created, ...prev]);
        showToast(`Subject "${created.subject_code}" added. It is now available across all portals.`);
      }
      setModalOpen(false);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save subject.');
    } finally {
      setSaving(false);
    }
  };

  // ---- Toggle status ----
  const handleToggleStatus = async (sub: SubjectRecord) => {
    if (!token) return;
    const newStatus = sub.status === 'active' ? 'inactive' : 'active';
    try {
      const updated = await updateSubject(sub.id, { status: newStatus } as any, token);
      setSubjects((prev) => prev.map((s) => (s.id === sub.id ? updated : s)));
      showToast(`"${sub.subject_code}" is now ${newStatus}.`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to update status.');
    }
  };

  // ---- Delete ----
  const handleDelete = async (sub: SubjectRecord) => {
    if (!window.confirm(`Delete subject ${sub.subject_code} — ${sub.subject_name}?\n\nIf it has question banks it will be deactivated instead.`)) return;
    if (!token) return;
    try {
      const result = await deleteSubject(sub.id, token);
      if (result._action === 'deleted') {
        setSubjects((prev) => prev.filter((s) => s.id !== sub.id));
        showToast(`Subject deleted.`);
      } else {
        // deactivated — refresh from server
        await loadSubjects();
        showToast(result.message || 'Subject deactivated (referenced by question banks).');
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete subject.');
    }
  };

  const handleManageQuestions = (subCode: string) => {
    setSelectedSubjectCode(subCode);
    setActiveTab('question-bank');
  };

  const inputClass =
    'w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-semibold text-[#111827] focus:border-[#D71945] focus:ring-2 focus:ring-[#D71945]/20 outline-none transition';

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#D71945]">
            Academic Catalog
          </span>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">Subjects</h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Subjects added here are immediately available across the entire system — paper generation,
            question bank upload, and IAT generator will all see them automatically.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 rounded-xl bg-[#D71945] px-4 py-2.5 text-xs font-extrabold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          <span>Add Subject</span>
        </button>
      </div>

      {/* DB-backed notice */}
      <div className="flex items-start gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#1976D2]" />
        <p className="text-[11px] leading-relaxed text-[#64748B]">
          Subjects are stored in the database and are <strong className="text-[#111827]">globally available</strong> to all
          portals (Super Admin, Exam Cell, IAT Generator, Paper Generation) without any additional configuration.
          Hardcoded subject lists have been removed.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-3 shadow-xs">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-[#94A3B8]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code or name…"
            className="w-full rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] pl-10 pr-4 py-2 text-xs text-[#111827] placeholder:text-[#94A3B8] focus:border-[#D71945] focus:bg-white focus:outline-none"
          />
        </div>

        {/* Academic Year filter */}
        <select
          value={filterYearId}
          onChange={(e) => setFilterYearId(e.target.value)}
          className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#111827] font-semibold focus:border-[#D71945] focus:outline-none"
        >
          <option value="">All Academic Years</option>
          {years.map((y) => (
            <option key={y.id} value={y.id}>{y.year_label}</option>
          ))}
        </select>

        {/* Department filter */}
        <select
          value={filterDeptId}
          onChange={(e) => setFilterDeptId(e.target.value)}
          className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#111827] font-semibold focus:border-[#D71945] focus:outline-none"
        >
          <option value="">All Departments</option>
          {depts.filter((d) => !d.is_common).map((d) => (
            <option key={d.id} value={d.id}>
              {d.department_code} — {d.department_name}
            </option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
          className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#111827] font-semibold focus:border-[#D71945] focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <button
          onClick={loadSubjects}
          className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-bold text-[#64748B] hover:border-slate-400 hover:text-[#111827] transition cursor-pointer"
        >
          Refresh
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-[11px] font-semibold text-red-800">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-xs text-[#64748B]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading subjects from database…
        </div>
      )}

      {/* Table */}
      {!loading && (
        <div className="overflow-hidden rounded-3xl border border-[#E5E7EB] bg-white shadow-xs">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB] bg-[#F7F8FA]">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              {filtered.length} subject{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F7F8FA] text-[#64748B] font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3.5 px-4">Code</th>
                  <th className="py-3.5 px-4 min-w-[220px]">Subject Name</th>
                  <th className="py-3.5 px-3">Department</th>
                  <th className="py-3.5 px-3">Year</th>
                  <th className="py-3.5 px-3">Semester</th>
                  <th className="py-3.5 px-3">Regulation</th>
                  <th className="py-3.5 px-3">Question Bank</th>
                  <th className="py-3.5 px-3">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-5 py-16 text-center text-xs text-[#94A3B8]">
                      {subjects.length === 0
                        ? 'No subjects yet. Click "Add Subject" to create the first one.'
                        : 'No subjects match your current filters.'}
                    </td>
                  </tr>
                )}
                {filtered.map((sub) => {
                  const deptCode = sub.departments?.department_code || depts.find((d) => d.id === sub.department_id)?.department_code || '—';
                  const yearLabel = sub.academic_years?.year_label || years.find((y) => y.id === sub.academic_year_id)?.year_label || '—';
                  const isActive = sub.status === 'active';
                  return (
                    <tr key={sub.id} className={`transition-colors hover:bg-[#F7F8FA] ${!isActive ? 'opacity-60' : ''}`}>
                      <td className="py-3.5 px-4 font-mono font-bold text-[#111827]">{sub.subject_code}</td>
                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-[#111827]">{sub.subject_name}</div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="inline-flex rounded-md bg-[#EAF3FF] px-2 py-0.5 text-[11px] font-bold text-[#1976D2]">
                          {deptCode}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-[#64748B] font-medium">{yearLabel}</td>
                      <td className="py-3.5 px-3 font-medium text-[#111827]">
                        {sub.semester ? `Sem ${sub.semester}` : '—'}
                      </td>
                      <td className="py-3.5 px-3 text-[#64748B]">{sub.regulation || '—'}</td>
                      <td className="py-3.5 px-3">
                        <button
                          onClick={() => handleManageQuestions(sub.subject_code)}
                          className="inline-flex items-center gap-1.5 font-bold text-[#1976D2] hover:underline"
                        >
                          <Database className="h-3 w-3" />
                          <span>View Bank</span>
                        </button>
                      </td>
                      <td className="py-3.5 px-3">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[#ECFDF3] px-2 py-0.5 text-[10px] font-bold text-[#027A48]">
                            <CheckCircle2 className="h-3 w-3" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-bold text-[#64748B]">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEdit(sub)}
                            className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#111827] transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(sub)}
                            className={`rounded-lg p-1.5 transition-colors ${
                              isActive
                                ? 'text-[#64748B] hover:bg-amber-50 hover:text-amber-700'
                                : 'text-[#64748B] hover:bg-emerald-50 hover:text-emerald-700'
                            }`}
                            title={isActive ? 'Deactivate' : 'Activate'}
                          >
                            {isActive ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            onClick={() => handleDelete(sub)}
                            className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#FFF0F3] hover:text-[#D71945] transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-4">
              <div>
                <h3 className="text-xl font-extrabold text-[#111827]">
                  {editingId ? 'Edit Subject' : 'Add New Subject'}
                </h3>
                <p className="mt-0.5 text-[10px] text-[#64748B]">
                  {editingId
                    ? 'Changes take effect immediately across all portals.'
                    : 'New subjects are immediately available globally once saved.'}
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-full p-1.5 text-[#94A3B8] hover:bg-[#F7F8FA] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-5 space-y-4">
              {/* Code + Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
                    Subject Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.subject_code}
                    onChange={(e) => setForm((f) => ({ ...f, subject_code: e.target.value }))}
                    placeholder="e.g. 24CS301"
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
                    Semester
                  </label>
                  <select
                    value={form.semester}
                    onChange={(e) => setForm((f) => ({ ...f, semester: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">— Select —</option>
                    {['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'].map((s) => (
                      <option key={s} value={s}>Semester {s}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
                  Subject Name *
                </label>
                <input
                  type="text"
                  required
                  value={form.subject_name}
                  onChange={(e) => setForm((f) => ({ ...f, subject_name: e.target.value }))}
                  placeholder="e.g. Computer Organization and Architecture"
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
                    Academic Year *
                  </label>
                  <select
                    required
                    value={form.academic_year_id}
                    onChange={(e) => setForm((f) => ({ ...f, academic_year_id: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Select year…</option>
                    {years.map((y) => (
                      <option key={y.id} value={y.id}>{y.year_label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
                    Department *
                  </label>
                  <select
                    required
                    value={form.department_id}
                    onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Select dept…</option>
                    {depts.filter((d) => !d.is_common).map((d) => (
                      <option key={d.id} value={d.id}>{d.department_code}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
                  Regulation
                </label>
                <input
                  type="text"
                  value={form.regulation}
                  onChange={(e) => setForm((f) => ({ ...f, regulation: e.target.value }))}
                  placeholder="e.g. Regulation 2024"
                  className={inputClass}
                />
              </div>

              {formError && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[11px] font-semibold text-red-800">
                  <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex justify-end gap-3 border-t border-[#E5E7EB] pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                  className="rounded-xl border border-[#E5E7EB] px-4 py-2 text-xs font-bold text-[#64748B] hover:border-slate-400 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-xl bg-[#D71945] px-5 py-2 text-xs font-bold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c] disabled:opacity-60 cursor-pointer transition"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                  {editingId ? 'Update Subject' : 'Save Subject'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
