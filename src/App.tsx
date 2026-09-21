import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { Login } from './pages/Login';
import { PatientList } from './pages/PatientList';
import { PatientChart } from './pages/PatientChart';
import { Calendar } from './pages/Calendar';
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
  | { page: 'calendar' };

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

  if (loading) return null;
  if (error) return <p className="p-6 text-sm text-[var(--danger,#b3261e)]">{error}</p>;

  function selectPatient(patient: PatientListItem, patientLabel: string) {
    setRoute({ page: 'chart', patientId: patient.patientId, patientLabel, patient });
  }

  if (route.page === 'chart') {
    return (
      <PatientChart
        patientId={route.patientId}
        patientLabel={route.patientLabel}
        patient={route.patient}
        onBack={() => setRoute({ page: 'list' })}
        onSignOut={onSignOut}
        onNavigateCalendar={() => setRoute({ page: 'calendar' })}
      />
    );
  }

  if (route.page === 'calendar') {
    return <Calendar onBack={() => setRoute({ page: 'list' })} onSelectPatient={selectPatient} onSignOut={onSignOut} />;
  }

  return <PatientList onSelectPatient={selectPatient} onSignOut={onSignOut} onNavigateCalendar={() => setRoute({ page: 'calendar' })} />;
}

export default App;
