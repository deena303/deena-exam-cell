import React, { useState, useMemo } from 'react';
import {
  FileText,
  Search,
  Eye,
  CheckCircle2,
  Sparkles,
  FileSpreadsheet,
  Tag,
  Download,
  ShieldCheck,
  FileDown
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { GeneratedPaper, PaperStatus } from '../types';
import { exportToWordDocument } from '../utils/exportUtils';
import { paperFileName } from '../utils/paperFileName';
import { auditPaperDownload } from '../services/authApi';

export const GeneratedPapersListView: React.FC = () => {
  const {
    generatedPapers,
    departments,
    subjects,
    academicYears,
    setActivePaper,
    setActiveTab,
    setPaperToReviewId,
    authToken,
    showToast
  } = useApp();

  // Search and 5 required filters: Academic Year, Department, Subject, Exam Type, Set
  const [search, setSearch] = useState('');
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>('all');
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [selectedExamType, setSelectedExamType] = useState<string>('all');
  const [selectedSet, setSelectedSet] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // Subjects filtered by selected department
  const availableSubjects = useMemo(() => {
    if (selectedDept === 'all') return subjects;
    return subjects.filter(s => s.department === selectedDept);
  }, [subjects, selectedDept]);

  // Filtered papers
  const filteredPapers = useMemo(() => {
    return generatedPapers.filter((p) => {
      if (search) {
        const q = search.toLowerCase();
        const matchCode = p.paperCode.toLowerCase().includes(q);
        const matchSub = p.subjectCode.toLowerCase().includes(q) || p.subjectName.toLowerCase().includes(q);
        const matchName = (p.setDisplayName || '').toLowerCase().includes(q);
        if (!matchCode && !matchSub && !matchName) return false;
      }
      if (selectedAcademicYear !== 'all' && p.academicYear !== selectedAcademicYear) return false;
      if (selectedDept !== 'all') {
        if (selectedDept === 'COMMON') {
          if (p.scope !== 'COMMON' && p.department !== 'COMMON') return false;
        } else {
          const isMatch = p.department === selectedDept || (p.commonDepartments && p.commonDepartments.includes(selectedDept));
          if (!isMatch) return false;
        }
      }
      if (selectedSubject !== 'all' && p.subjectCode !== selectedSubject) return false;
      if (selectedExamType !== 'all' && p.examType !== selectedExamType) return false;
      if (selectedSet !== 'all') {
        const paperSet = p.setLetter || 'A';
        if (paperSet !== selectedSet) return false;
      }
      if (selectedStatus !== 'all' && p.status !== selectedStatus) return false;
      return true;
    });
  }, [generatedPapers, search, selectedAcademicYear, selectedDept, selectedSubject, selectedExamType, selectedSet, selectedStatus]);

  const getStatusBadge = (status: PaperStatus) => {
    switch (status) {
      case 'Finalized':
        return 'bg-[#EAF3FF] text-[#1976D2] border-[#1976D2]/30';
      case 'Approved':
        return 'bg-[#ECFDF3] text-[#027A48] border-[#027A48]/30';
      case 'HOD Review':
      case 'Faculty Reviewed':
        return 'bg-[#FFF8E7] text-[#B45309] border-[#F59E0B]/30';
      case 'Rejected':
        return 'bg-[#FFF0F3] text-[#D71945] border-[#D71945]/30';
      default:
        return 'bg-[#F1F5F9] text-[#64748B] border-[#CBD5E1]';
    }
  };

  const handleView = (paper: GeneratedPaper) => {
    setActivePaper(paper);
    setPaperToReviewId(paper.id);
    setActiveTab('generate-paper');
  };

  // Spec §5 — Word download uses the canonical Subject Code file name
  const handleWordDownload = (paper: GeneratedPaper) => {
    exportToWordDocument(paper);
    const fileName = paperFileName(paper, 'docx');
    auditPaperDownload({
      paperCode: paper.paperCode,
      examType: paper.examType,
      setLetter: paper.setLetter,
      subjectCode: paper.subjectCode,
      format: 'docx',
      fileName
    }, authToken || '');
    showToast(`Downloaded ${fileName}`);
  };

  // Spec §5 — PDF is produced from the paper preview (html2canvas → jsPDF)
  const handlePdfDownload = (paper: GeneratedPaper) => {
    const fileName = paperFileName(paper, 'pdf');
    handleView(paper);
    showToast(`Use "Download PDF" in the preview to save ${fileName}.`);
  };

  const handleResetFilters = () => {
    setSearch('');
    setSelectedAcademicYear('all');
    setSelectedDept('all');
    setSelectedSubject('all');
    setSelectedExamType('all');
    setSelectedSet('all');
    setSelectedStatus('all');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#D71945]">
            Exam Paper Archives
          </span>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            Generated Question Papers
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            All active, reviewed, and finalized question papers generated for internal and end semester examinations with automated set designations.
          </p>
        </div>

        <button
          onClick={() => setActiveTab('generate-paper')}
          className="flex items-center gap-2 rounded-xl bg-[#D71945] px-4 py-2.5 text-xs font-extrabold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap self-start sm:self-auto"
        >
          <Sparkles className="h-4 w-4" />
          <span>Generate New Paper</span>
        </button>
      </div>

      {/* FILTER CONTROLS BAR (Academic Year, Department, Subject, Exam Type, Set) */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-[#94A3B8]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by paper code, subject code, title or set name..."
              className="w-full rounded-xl border border-slate-200 bg-[#F7F8FA] pl-10 pr-4 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#D71945] focus:bg-white focus:outline-hidden"
            />
          </div>

          <button
            type="button"
            onClick={handleResetFilters}
            className="text-xs font-bold text-slate-500 hover:text-[#D71945] transition-colors cursor-pointer self-end sm:self-auto shrink-0"
          >
            Reset Filters
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <button
              onClick={() => {
                setPaperToReviewId(null);
                setActiveTab('generate-paper');
              }}
              className="flex items-center gap-2 rounded-xl bg-[#D71945] px-4 py-2.5 text-xs font-extrabold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
            >
              <Sparkles className="h-4 w-4" />
              <span>Generate New Paper</span>
            </button>
            <p className="mt-1.5 text-[10px] text-slate-400">
              Set limits are enforced on the server — duplicate standard sets cannot be generated from this page.
            </p>
          </div>

          <span className="text-[11px] text-slate-400 self-end sm:self-auto">
            Downloads use the Subject Code file name (e.g. 24CS514_IAT_Set_A.pdf)
          </span>
        </div>

        {/* 5 Dropdowns */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
          {/* 1. Academic Year */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Academic Year
            </label>
            <select
              value={selectedAcademicYear}
              onChange={(e) => setSelectedAcademicYear(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-[#F7F8FA] px-2.5 py-2 text-xs font-bold text-slate-900 focus:border-[#D71945] focus:bg-white focus:outline-hidden"
            >
              <option value="all">All Academic Years</option>
              {academicYears.map(yr => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
          </div>

          {/* 2. Department */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Department
            </label>
            <select
              value={selectedDept}
              onChange={(e) => {
                setSelectedDept(e.target.value);
                setSelectedSubject('all');
              }}
              className="w-full rounded-xl border border-slate-200 bg-[#F7F8FA] px-2.5 py-2 text-xs font-bold text-slate-900 focus:border-[#D71945] focus:bg-white focus:outline-hidden"
            >
              <option value="all">All Departments</option>
              <option value="COMMON">COMMON (Common Scope)</option>
              {departments.map(d => (
                <option key={d.code} value={d.code}>{d.code}</option>
              ))}
            </select>
          </div>

          {/* 3. Subject */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Subject
            </label>
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-[#F7F8FA] px-2.5 py-2 text-xs font-bold text-slate-900 focus:border-[#D71945] focus:bg-white focus:outline-hidden"
            >
              <option value="all">All Subjects</option>
              {availableSubjects.map(s => (
                <option key={s.id} value={s.code}>{s.code} – {s.name}</option>
              ))}
            </select>
          </div>

          {/* 4. Exam Type */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Exam Type
            </label>
            <select
              value={selectedExamType}
              onChange={(e) => setSelectedExamType(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-[#F7F8FA] px-2.5 py-2 text-xs font-bold text-slate-900 focus:border-[#D71945] focus:bg-white focus:outline-hidden"
            >
              <option value="all">All Exam Types</option>
              <option value="Internal Assessment I">Internal Assessment I</option>
              <option value="Internal Assessment II">Internal Assessment II</option>
              <option value="End Semester Examination">End Semester Examination</option>
            </select>
          </div>

          {/* 5. Set */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Question Paper Set
            </label>
            <select
              value={selectedSet}
              onChange={(e) => setSelectedSet(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-[#F7F8FA] px-2.5 py-2 text-xs font-bold text-slate-900 focus:border-[#D71945] focus:bg-white focus:outline-hidden"
            >
              <option value="all">All Sets (A, B, C...)</option>
              <option value="A">Set A</option>
              <option value="B">Set B</option>
              <option value="C">Set C</option>
              <option value="D">Set D</option>
              <option value="E">Set E (Principal Approved)</option>
              <option value="F">Set F (Principal Approved)</option>
            </select>
          </div>
        </div>

        {/* Dynamic count status */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-600">
          <span>
            Found <span className="text-[#D71945] font-black">{filteredPapers.length}</span> question {filteredPapers.length === 1 ? 'paper' : 'papers'}
          </span>
          <span className="text-[11px] text-slate-400">
            Ordered by generation date
          </span>
        </div>
      </div>

      {/* Table with Required Columns: Academic Year, Department, Subject Code, Subject Name, Exam Type, Set, Generated Date, Status */}
      <div className="overflow-hidden rounded-3xl border border-[#E5E7EB] bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F7F8FA] text-[#64748B] font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3.5 px-4">Academic Year</th>
                <th className="py-3.5 px-3">Dept</th>
                <th className="py-3.5 px-3">Subject Code</th>
                <th className="py-3.5 px-4 min-w-[200px]">Subject Name & Set Title</th>
                <th className="py-3.5 px-3">Exam Type</th>
                <th className="py-3.5 px-3 text-center">Set</th>
                <th className="py-3.5 px-3">Generated Date</th>
                <th className="py-3.5 px-3">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {filteredPapers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    No question papers found matching the specified filters.
                  </td>
                </tr>
              ) : (
                filteredPapers.map((paper) => {
                  const setLetter = paper.setLetter || 'A';
                  const displayName = paper.setDisplayName || `${paper.subjectName} – Set ${setLetter}`;

                  return (
                    <tr key={paper.id} className="hover:bg-[#F7F8FA] transition-colors">
                      {/* Academic Year */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                          {paper.academicYear || '2024-2025'}
                        </span>
                      </td>

                      {/* Department */}
                      <td className="py-3.5 px-3 font-bold text-slate-700 whitespace-nowrap">
                        {paper.scope === 'COMMON' || paper.department === 'COMMON' ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex rounded-md bg-rose-100 border border-rose-200 px-2 py-0.5 text-[11px] font-black text-[#D71945] w-fit">
                              COMMON
                            </span>
                            {paper.commonDepartments && paper.commonDepartments.length > 0 && (
                              <span className="text-[10px] text-slate-500 font-medium">
                                {paper.commonDepartments.join(', ')}
                              </span>
                            )}
                          </div>
                        ) : (
                          paper.department
                        )}
                      </td>

                      {/* Subject Code */}
                      <td className="py-3.5 px-3 font-mono font-extrabold text-[#D71945] whitespace-nowrap">
                        {paper.subjectCode}
                      </td>

                      {/* Subject Name & Display Name */}
                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-[#111827]">{displayName}</div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          Code: {paper.paperCode} • Max: {paper.maxMarks}M
                        </div>
                        {paper.principalApprovalRequired && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-purple-100 text-purple-800 px-2 py-0.5 text-[9px] font-bold">
                            <ShieldCheck className="h-3 w-3" /> Principal Approved
                          </span>
                        )}
                      </td>

                      {/* Exam Type */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ${
                          paper.examType === 'End Semester Examination'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-rose-100 text-[#D71945]'
                        }`}>
                          {paper.examType}
                        </span>
                      </td>

                      {/* Set */}
                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-[#1976D2] text-white font-black text-xs shadow-xs">
                          {setLetter}
                        </span>
                      </td>

                      {/* Generated Date */}
                      <td className="py-3.5 px-3 text-slate-600 whitespace-nowrap text-[11px]">
                        {paper.createdDate || paper.examDate}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold ${getStatusBadge(paper.status)}`}>
                          {paper.status}
                        </span>
                      </td>

                      {/* Actions — Word, PDF, View / Print (Spec §17) */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleWordDownload(paper)}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                            title={`Download ${paperFileName(paper, 'docx')}`}
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5 text-blue-600" />
                            <span>Word</span>
                          </button>
                          <button
                            onClick={() => handlePdfDownload(paper)}
                            className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-[#FFF0F3] px-2.5 py-1 text-xs font-bold text-[#D71945] hover:bg-[#FFE0E6] transition-colors cursor-pointer"
                            title={`Download ${paperFileName(paper, 'pdf')}`}
                          >
                            <FileDown className="h-3.5 w-3.5" />
                            <span>PDF</span>
                          </button>
                          <button
                            onClick={() => handleView(paper)}
                            className="inline-flex items-center gap-1 rounded-xl bg-[#EAF3FF] px-3 py-1 text-xs font-bold text-[#1976D2] hover:bg-[#1976D2] hover:text-white transition-colors cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>View / Print</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
