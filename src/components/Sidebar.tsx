import React from 'react';
import {
  LayoutDashboard,
  Database,
  ScanLine,
  BookOpen,
  Sliders,
  Sparkles,
  FileCheck2,
  History,
  BarChart3,
  Settings,
  LogOut,
  GraduationCap,
  SlidersHorizontal,
  Users,
  CalendarDays,
  Building2,
  ShieldCheck,
  Landmark,
  BellRing,
  ClipboardCheck,
  Layers,
  GitBranch
} from 'lucide-react';
import { useApp } from '../context/AppContext';

interface SidebarProps {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, setMobileOpen }) => {
  const {
    activeTab,
    setActiveTab,
    currentUser,
    logout,
    isSuperAdminPortal,
    isPrincipalPortal
  } = useApp();

  // ---- Exam Cell navigation items ----
  const examCellSections = [
    {
      title: 'Main Menu',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'import-question-bank', label: 'Import Question Bank', icon: ScanLine, highlight: true },
        { id: 'question-bank', label: 'Question Bank', icon: Database },
        { id: 'iat-question-bank-generator', label: 'IAT Question Bank Generator', icon: GitBranch, highlight: true },
        { id: 'iat-generated-banks', label: 'IAT Generated Banks', icon: Layers },
        { id: 'exam-patterns', label: 'Exam Patterns', icon: Sliders },
        { id: 'internal-config', label: 'IA Configuration', icon: SlidersHorizontal },
        { id: 'generate-paper', label: 'Generate Paper', icon: Sparkles, highlight: true },
        { id: 'generated-papers', label: 'Generated Papers', icon: FileCheck2 },
        { id: 'usage-history', label: 'Usage History', icon: History },
        { id: 'reports', label: 'Reports', icon: BarChart3 },
      ]
    },
    {
      title: 'Master Data',
      items: [
        { id: 'academic-years', label: 'Academic Years', icon: CalendarDays },
        { id: 'departments', label: 'Departments', icon: Building2 },
        { id: 'subject-bank', label: 'Subject Bank', icon: BookOpen },
      ]
    },
    {
      title: 'Administration',
      items: [
        { id: 'audit-logs', label: 'Audit Logs', icon: ShieldCheck },
      ]
    },
    {
      title: 'General',
      items: [
        { id: 'settings', label: 'Settings', icon: Settings },
        { id: 'meet-the-team', label: 'Meet the Team', icon: Users },
      ]
    }
  ];

  // ---- Principal Portal (Spec §8) — focused on approval ----
  const principalSections = [
    {
      title: 'Principal Portal',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'principal-requests', label: 'Additional Paper Requests', icon: ClipboardCheck, highlight: true },
        { id: 'principal-papers', label: 'Generated / Assigned Papers', icon: FileCheck2 },
        { id: 'principal-notifications', label: 'Notifications', icon: BellRing },
        { id: 'audit-logs', label: 'Audit Logs', icon: ShieldCheck },
      ]
    },
    {
      title: 'General',
      items: [
        { id: 'settings', label: 'Settings', icon: Settings },
        { id: 'meet-the-team', label: 'Meet the Team', icon: Users },
      ]
    }
  ];

  // ---- Super Admin has full administrative + question paper suite access ----
  const superAdminSections = [
    {
      title: 'Master Administration',
      items: [
        { id: 'dashboard', label: 'Super Admin Overview', icon: LayoutDashboard },
        { id: 'academic-years', label: 'Academic Years', icon: CalendarDays },
        { id: 'departments', label: 'Departments', icon: Building2 },
        { id: 'master-subjects', label: 'Master Subjects', icon: BookOpen },
        { id: 'users', label: 'User Accounts', icon: Users },
        { id: 'audit-logs', label: 'Audit Logs', icon: ShieldCheck },
        { id: 'principal-requests', label: 'Paper Requests', icon: ClipboardCheck },
      ]
    },
    {
      title: 'Question Paper Suite',
      items: [
        { id: 'exam-dashboard', label: 'Exam Cell Dashboard', icon: BarChart3 },
        { id: 'import-question-bank', label: 'Import Question Bank', icon: ScanLine, highlight: true },
        { id: 'question-bank', label: 'Question Bank', icon: Database },
        { id: 'iat-question-bank-generator', label: 'IAT Question Bank Generator', icon: GitBranch, highlight: true },
        { id: 'iat-generated-banks', label: 'IAT Generated Banks', icon: Layers },
        { id: 'subject-bank', label: 'Subject Bank', icon: BookOpen },
        { id: 'exam-patterns', label: 'Exam Patterns', icon: Sliders },
        { id: 'internal-config', label: 'IA Configuration', icon: SlidersHorizontal },
        { id: 'generate-paper', label: 'Generate Paper', icon: Sparkles, highlight: true },
        { id: 'generated-papers', label: 'Generated Papers', icon: FileCheck2 },
        { id: 'usage-history', label: 'Usage History', icon: History },
        { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
      ]
    },
    {
      title: 'General',
      items: [
        { id: 'settings', label: 'Settings', icon: Settings },
        { id: 'meet-the-team', label: 'Meet the Team', icon: Users },
      ]
    }
  ];

  const sections = isPrincipalPortal ? principalSections : isSuperAdminPortal ? superAdminSections : examCellSections;

  const handleNavClick = (id: string) => {
    setActiveTab(id);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden transition-opacity"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex w-72 flex-col justify-between border-r border-[#E5E7EB] bg-white transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col overflow-y-auto">
          {/* Logo & Application Title */}
          <div className="flex items-center gap-3 border-b border-[#E5E7EB] p-5">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-md ${isSuperAdminPortal ? 'bg-purple-700 shadow-purple-700/20' : isPrincipalPortal ? 'bg-emerald-700 shadow-emerald-700/20' : 'bg-[#D71945] shadow-[#D71945]/20'}`}>
              {isPrincipalPortal ? <Landmark className="h-6 w-6" /> : <GraduationCap className="h-6 w-6" />}
            </div>
            <div>
              <div className={`text-xs font-black tracking-wider uppercase ${isSuperAdminPortal ? 'text-purple-700' : isPrincipalPortal ? 'text-emerald-700' : 'text-[#D71945]'}`}>
                MSAJCE
              </div>
              <h1 className="text-sm font-extrabold text-[#111827] leading-tight">
                {isPrincipalPortal ? (
                  <>Principal<br /><span className="text-[#64748B] font-semibold">Approval Portal</span></>
                ) : isSuperAdminPortal ? (
                  <>Super Admin<br /><span className="text-[#64748B] font-semibold">Portal &amp; QP Suite</span></>
                ) : (
                  <>Question Paper<br /><span className="text-[#64748B] font-semibold">Management</span></>
                )}
              </h1>
            </div>
          </div>

          {/* Navigation Sections */}
          <nav className="flex-1 space-y-4 p-3">
            {sections.map((sec, secIdx) => (
              <div key={secIdx} className="space-y-1">
                <div className="px-3 pt-1 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
                  {sec.title}
                </div>
                {sec.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  const highlight = 'highlight' in item && item.highlight;

                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNavClick(item.id)}
                      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-150 cursor-pointer ${
                        isActive
                          ? isSuperAdminPortal
                            ? 'bg-purple-700 text-white shadow-md shadow-purple-700/25 font-bold'
                            : isPrincipalPortal
                            ? 'bg-emerald-700 text-white shadow-md shadow-emerald-700/25 font-bold'
                            : 'bg-[#D71945] text-white shadow-md shadow-[#D71945]/25 font-bold'
                          : highlight
                          ? isPrincipalPortal
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-[#FFF0F3] text-[#D71945] hover:bg-[#FFE0E6]'
                          : 'text-[#111827] hover:bg-[#F7F8FA] hover:text-[#111827]'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 transition-transform group-hover:scale-105 ${
                          isActive ? 'text-white' : highlight ? (isPrincipalPortal ? 'text-emerald-700' : 'text-[#D71945]') : 'text-[#64748B]'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                      {highlight && !isActive && (
                        <span className={`ml-auto rounded-md px-1.5 py-0.5 text-[9px] font-extrabold text-white ${isPrincipalPortal ? 'bg-emerald-700' : 'bg-[#D71945]'}`}>
                          {isPrincipalPortal ? 'REVIEW' : 'AUTO'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* User Profile Card at Bottom */}
        <div className="border-t border-[#E5E7EB] p-3 bg-[#F7F8FA]/60 space-y-2">
          <div className="flex items-center justify-between rounded-2xl border border-[#E5E7EB] bg-white p-3 shadow-xs">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white shadow-xs ${
                isSuperAdminPortal ? 'bg-purple-700' : isPrincipalPortal ? 'bg-emerald-700' : 'bg-[#111827]'
              }`}>
                {(currentUser?.name || 'Staff User').split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('') || 'U'}
              </div>
              <div className="overflow-hidden">
                <p className="truncate text-xs font-bold text-[#111827] leading-tight">
                  {currentUser?.name || 'Staff User'}
                </p>
                <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                  isSuperAdminPortal ? 'bg-purple-100 text-purple-800' : isPrincipalPortal ? 'bg-emerald-100 text-emerald-800' : 'bg-[#FFF8E7] text-[#B45309]'
                }`}>
                  {currentUser?.role || 'Exam Cell'}
                </span>
              </div>
            </div>
            <button
              onClick={logout}
              className="p-2 text-[#94A3B8] hover:text-[#D71945] hover:bg-[#FFF0F3] rounded-lg transition-colors cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
