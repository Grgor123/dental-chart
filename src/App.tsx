import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { Login } from './pages/Login';
import { PatientList } from './pages/PatientList';
import { PatientChart } from './pages/PatientChart';
import { Calendar } from './pages/Calendar';
import { EmailTemplates } from './pages/EmailTemplates';
import { Settings } from './pages/Settings';
import { Invoices } from './pages/Invoices';
import { InvoiceEditor } from './pages/InvoiceEditor';
import { StatusShowcase } from './pages/StatusShowcase';
import { PatientPageMockup } from './pages/PatientPageMockup';
import { PracticeProvider, usePracticeContext } from './contexts/PracticeContext';
import type { PatientListItem } from './hooks/usePatients';

// TEMPORARY: dev-only routing for StatusShowcase/PatientPageMockup, driven
// by VITE_DEV_PAGE (set per Vite --mode — see .env.showcase/
// .env.patient-mockup and the dev:showcase/dev:patient-mockup npm scripts)
// rather than a hand-edited boolean, so each can run on its own permanent
// port without a flag-flip/reload. PatientChart no longer has a dev-mode
// bypass here — real Supabase writes need a real authenticated session
// (RLS requires it), so `dev:patient` (port 5181, .env.patient) now goes
// through the same session-gated path everyone else does: the real Login
// screen first, then PatientList, then a chosen patient's chart. Sign in
// with the Supabase Auth user created for this.
const DEV_PAGE = import.meta.env.VITE_DEV_PAGE;

// Which of the three post-login pages is showing, once signed in.
// Deliberately plain useState, not a routing library — none of these need
// a URL of their own (no deep-linking requirement for an
// always-signed-in-locally app). Going "back" to the list (PatientChart's/
// Calendar's own back button) or picking a different patient both just
// replace this state; nothing here persists across a real page reload.
// `patient` carries the whole selected PatientListItem, not just its id —
// PatientList.tsx/Calendar.tsx already have it in memory (usePatients()),
// so PatientChart.tsx's Frame 2 can render real patient-info fields
// immediately with no extra fetch. `patientId`/`patientLabel` stay
// separate top-level fields (rather than read off `patient` everywhere)
// since they were already threaded through before Frame 2 existed and
// several call sites key off them directly.
type Route =
  | { page: 'list' }
  | { page: 'chart'; patientId: string; patientLabel: string; patient: PatientListItem }
  | { page: 'calendar' }
  | { page: 'email' }
  | { page: 'settings'; section?: string }
  | { page: 'invoices' }
  // One invoice; `returnTo` is where its back link goes (the patient record
  // or the Računi list), kept when hopping to a credit note and back.
  | { page: 'invoice'; invoiceId: string; returnTo: Route };

function App() {
  const { session, loading, signIn, signOut, signInError } = useAuth();

  if (DEV_PAGE === 'showcase') return <StatusShowcase />;
  if (DEV_PAGE === 'patient-mockup') return <PatientPageMockup />;

  if (loading) return null;
  if (!session) return <Login onSignIn={signIn} error={signInError} />;

  return (
    <PracticeProvider session={session}>
      <SignedInApp onSignOut={signOut} />
    </PracticeProvider>
  );
}

// Every table's RLS now scopes rows to the signed-in user's own practice
// (supabase/migrations/011_add_multi_tenancy.sql) — PracticeProvider above
// resolves which one that is. Split out from App() so this can read
// usePracticeContext() (only valid inside the provider it's wrapped in).
function SignedInApp({ onSignOut }: { onSignOut: () => void }) {
  const { loading, error } = usePracticeContext();
  const [route, setRoute] = useState<Route>({ page: 'list' });
  // Bumped by every menu navigation and used as the page's key, so clicking
  // the section you're already in starts it afresh (cleared search, today's
  // date, first tab ...) instead of doing nothing.
  const [navCount, setNavCount] = useState(0);

  if (loading) return null;
  if (error) return <p className="p-6 text-sm text-[var(--danger,#b3261e)]">{error}</p>;

  function selectPatient(patient: PatientListItem, patientLabel: string) {
    setRoute({ page: 'chart', patientId: patient.patientId, patientLabel, patient });
  }
  function go(next: Route) {
    setRoute(next);
    setNavCount((n) => n + 1);
  }
  const goList = () => go({ page: 'list' });
  const goCalendar = () => go({ page: 'calendar' });
  const goEmail = () => go({ page: 'email' });
  const goSettings = () => go({ page: 'settings' });
  const goInvoices = () => go({ page: 'invoices' });

  if (route.page === 'invoice') {
    const { returnTo } = route;
    return (
      <InvoiceEditor
        key={route.invoiceId}
        invoiceId={route.invoiceId}
        onBack={() => setRoute(returnTo)}
        backLabel={returnTo.page === 'chart' ? `Nazaj na pacienta ${returnTo.patientLabel}` : 'Nazaj na seznam računov'}
        onBackToInvoices={returnTo.page === 'chart' ? goInvoices : undefined}
        onOpenInvoice={(invoiceId) => setRoute({ page: 'invoice', invoiceId, returnTo })}
        onSignOut={onSignOut}
        onNavigateHome={goList}
        onNavigateStoritve={goList}
        onNavigateCalendar={goCalendar}
        onNavigateEmail={goEmail}
        onNavigateSettings={goSettings}
        onNavigateInvoiceSettings={() => go({ page: 'settings', section: 'racuni' })}
        onNavigateInvoices={goInvoices}
      />
    );
  }

  if (route.page === 'invoices') {
    return (
      <Invoices
        key={navCount}
        onOpenInvoice={(invoiceId) => setRoute({ page: 'invoice', invoiceId, returnTo: { page: 'invoices' } })}
        onBack={goList}
        onSignOut={onSignOut}
        onNavigateCalendar={goCalendar}
        onNavigateEmail={goEmail}
        onNavigateSettings={goSettings}
        onNavigateInvoices={goInvoices}
      />
    );
  }

  if (route.page === 'chart') {
    return (
      <PatientChart
        key={navCount}
        patientId={route.patientId}
        patientLabel={route.patientLabel}
        patient={route.patient}
        onBack={goList}
        onSignOut={onSignOut}
        onNavigateCalendar={goCalendar}
        onNavigateEmail={goEmail}
        onNavigateSettings={goSettings}
        onNavigateInvoices={goInvoices}
        onOpenInvoice={(invoiceId) => setRoute({ page: 'invoice', invoiceId, returnTo: route })}
      />
    );
  }

  if (route.page === 'calendar') {
    return (
      <Calendar
        key={navCount}
        onBack={goList}
        onSelectPatient={selectPatient}
        onSignOut={onSignOut}
        onNavigateCalendar={goCalendar}
        onNavigateEmail={goEmail}
        onNavigateSettings={goSettings}
        onNavigateInvoices={goInvoices}
      />
    );
  }

  if (route.page === 'email') {
    return (
      <EmailTemplates
        key={navCount}
        onBack={goList}
        onSignOut={onSignOut}
        onNavigateCalendar={goCalendar}
        onNavigateEmail={goEmail}
        onNavigateSettings={goSettings}
        onNavigateInvoices={goInvoices}
      />
    );
  }

  if (route.page === 'settings') {
    return (
      <Settings
        key={`${navCount}-${route.section ?? 'default'}`}
        initialSection={route.section}
        onNavigateInvoices={goInvoices}
        onBack={goList}
        onSignOut={onSignOut}
        onNavigateCalendar={goCalendar}
        onNavigateEmail={goEmail}
        onNavigateSettings={goSettings}
      />
    );
  }

  return (
    <PatientList
      key={navCount}
      onSelectPatient={selectPatient}
      onSignOut={onSignOut}
      onNavigateCalendar={goCalendar}
      onNavigateEmail={goEmail}
      onNavigateSettings={goSettings}
      onNavigateStoritve={goList}
      onNavigateInvoices={goInvoices}
    />
  );
}

export default App;
