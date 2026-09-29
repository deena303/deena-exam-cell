import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { LoginView } from './components/LoginView';
import { DashboardView } from './components/DashboardView';
import { SubjectManagementView } from './components/SubjectManagementView';
import { QuestionBankView } from './components/QuestionBankView';
import { ImportQuestionBankView } from './components/ImportQuestionBankView';
import { ExamPatternsView } from './components/ExamPatternsView';
import { InternalConfigView } from './components/InternalConfigView';
import { GeneratePaperWizard } from './components/GeneratePaperWizard';
import { GeneratedPapersListView } from './components/GeneratedPapersListView';
import { UsageHistoryView } from './components/UsageHistoryView';
import { AnalyticsView } from './components/AnalyticsView';
import { UsersManagementView } from './components/UsersManagementView';
import { SettingsView } from './components/SettingsView';
import { Toast } from './components/Toast';
import { MeetTheTeamView } from './components/MeetTheTeamView';
// Super Admin views
import { SuperAdminDashboard } from './components/superadmin/SuperAdminDashboard';
import { AcademicYearsView } from './components/superadmin/AcademicYearsView';
import { DepartmentsView } from './components/superadmin/DepartmentsView';
import { SubjectsView } from './components/superadmin/SubjectsView';
// Principal Portal views
import { PrincipalDashboard } from './components/principal/PrincipalDashboard';
import { PrincipalRequestsView } from './components/principal/PrincipalRequestsView';
import { PrincipalPapersView } from './components/principal/PrincipalPapersView';
import { PrincipalNotificationsView } from './components/principal/PrincipalNotificationsView';
// Exam Cell Master Data & Audit views
import { ExamCellSubjectBankView } from './components/ExamCellSubjectBankView';
import { ExamCellAcademicYearsView } from './components/ExamCellAcademicYearsView';
import { ExamCellDepartmentsView } from './components/ExamCellDepartmentsView';
import { AuditLogView } from './components/AuditLogView';
// IAT Question Bank Generator (Spec §1, §20, §21) — IAT-only, never End Semester
import { IatQuestionBankGeneratorView } from './components/IatQuestionBankGeneratorView';
import { IatGeneratedBanksView } from './components/IatGeneratedBanksView';

// Pre-login Meet the Team page (shown when clicking "Meet the team" on login page)
// handled by a separate state since user isn't authenticated
const PreLoginMeetTheTeam: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <div className="min-h-screen bg-[#F7F8FA] p-4 sm:p-8">
    <div className="max-w-5xl mx-auto">
      <MeetTheTeamView onBack={onBack} />
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const { isAuthenticated, activeTab, setActiveTab, isSuperAdminPortal, isPrincipalPortal } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showPreLoginTeam, setShowPreLoginTeam] = useState(false);

  // Show Meet the Team from Login page (pre-auth)
  if (!isAuthenticated && showPreLoginTeam) {
    return <PreLoginMeetTheTeam onBack={() => setShowPreLoginTeam(false)} />;
  }

  // Handle special login-page "meet-the-team-login" tab signal
  if (!isAuthenticated && activeTab === 'meet-the-team-login') {
    setShowPreLoginTeam(true);
    setActiveTab('dashboard'); // reset tab
    return null;
  }

  if (!isAuthenticated) {
    return <LoginView />;
  }

  // ---- Render content based on role + active tab ----
  //
  // Spec §20/§21: the IAT Question Bank Generator belongs to the Super Admin
  // and Exam Cell portals only. The Principal portal has no case for these
  // tabs and `isIatTab` blocks them even if the tab is set programmatically.
  const IAT_TABS = ['iat-question-bank-generator', 'iat-generated-banks'];
  const isIatTab = IAT_TABS.includes(activeTab);
  const iatAllowed = !isPrincipalPortal;

  const renderSuperAdminContent = () => {
    switch (activeTab) {
      // Super Admin Master Data
      case 'dashboard': return <SuperAdminDashboard />;
      case 'academic-years': return <AcademicYearsView />;
      case 'departments': return <DepartmentsView />;
      case 'master-subjects': return <SubjectsView />;
      case 'users': return <UsersManagementView />;
      case 'audit-logs': return <AuditLogView />;
      // Super Admin retains administrative control over the approval workflow
      case 'principal-requests': return <PrincipalRequestsView />;
      case 'principal-papers': return <PrincipalPapersView />;
      case 'principal-notifications': return <PrincipalNotificationsView />;

      // Question Paper Suite (Full Existing System Functions)
      case 'exam-dashboard': return <DashboardView />;
      case 'import-question-bank': return <ImportQuestionBankView />;
      case 'question-bank': return <QuestionBankView />;
      // IAT Question Bank Generator (Spec §1) — IAT-only, never End Semester
      case 'iat-question-bank-generator': return <IatQuestionBankGeneratorView />;
      case 'iat-generated-banks': return <IatGeneratedBanksView />;
      case 'subjects':
      case 'subject-bank': return <ExamCellSubjectBankView />;
      case 'exam-patterns': return <ExamPatternsView />;
      case 'internal-config': return <InternalConfigView />;
      case 'generate-paper': return <GeneratePaperWizard />;
      case 'generated-papers': return <GeneratedPapersListView />;
      case 'usage-history': return <UsageHistoryView />;
      case 'reports': return <AnalyticsView />;

      // General
      case 'settings': return <SettingsView />;
      case 'meet-the-team': return <MeetTheTeamView onBack={() => setActiveTab('dashboard')} />;
      default: return <SuperAdminDashboard />;
    }
  };

  /**
   * Principal Portal (Spec §7, §8, §13).
   * Rendered inside the same application shell — same auth, same theme.
   * Route access is additionally enforced server-side on every API call.
   */
  const renderPrincipalContent = () => {
    switch (activeTab) {
      case 'dashboard': return <PrincipalDashboard />;
      case 'principal-requests': return <PrincipalRequestsView />;
      case 'principal-papers': return <PrincipalPapersView />;
      case 'principal-notifications': return <PrincipalNotificationsView />;

      // Read-only reuse of existing screens
      case 'generated-papers': return <GeneratedPapersListView />;
      case 'audit-logs': return <AuditLogView />;

      // General
      case 'settings': return <SettingsView />;
      case 'meet-the-team': return <MeetTheTeamView onBack={() => setActiveTab('dashboard')} />;
      default: return <PrincipalDashboard />;
    }
  };

  const renderExamCellContent = () => {
    switch (activeTab) {
      // Main Menu
      case 'dashboard': return <DashboardView />;
      case 'import-question-bank': return <ImportQuestionBankView />;
      case 'question-bank': return <QuestionBankView />;
      case 'iat-question-bank-generator': return <IatQuestionBankGeneratorView />;
      case 'iat-generated-banks': return <IatGeneratedBanksView />;
      case 'exam-patterns': return <ExamPatternsView />;
      case 'internal-config': return <InternalConfigView />;
      case 'generate-paper': return <GeneratePaperWizard />;
      case 'generated-papers': return <GeneratedPapersListView />;
      case 'usage-history': return <UsageHistoryView />;
      case 'reports': return <AnalyticsView />;

      // Master Data (DB Synced)
      case 'academic-years': return <ExamCellAcademicYearsView />;
      case 'departments': return <ExamCellDepartmentsView />;
      case 'subjects':
      case 'subject-bank': return <ExamCellSubjectBankView />;

      // Administration
      case 'audit-logs': return <AuditLogView />;

      // General
      case 'settings': return <SettingsView />;
      case 'meet-the-team': return <MeetTheTeamView onBack={() => setActiveTab('dashboard')} />;
      default: return <DashboardView />;
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] font-sans text-[#111827] flex flex-col">
      {/* Fixed Sidebar */}
      <Sidebar mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col lg:pl-72">
        {/* Top Header */}
        <Header mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />

      {/* Dynamic Page Content */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
        {isIatTab && !iatAllowed ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center">
            <h2 className="text-sm font-black text-red-900">Access Denied</h2>
            <p className="mt-1 text-xs text-red-700">
              The IAT Question Bank Generator is available only to the Super Admin and Exam Cell portals.
            </p>
          </div>
        ) : isPrincipalPortal ? (
          renderPrincipalContent()
        ) : isSuperAdminPortal ? (
          renderSuperAdminContent()
        ) : (
          renderExamCellContent()
        )}
      </main>
      </div>

      {/* Global Toast Notification */}
      <Toast />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
