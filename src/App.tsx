import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { Login } from './pages/Login';
import { PatientList } from './pages/PatientList';
import { PatientChart } from './pages/PatientChart';
import { StatusShowcase } from './pages/StatusShowcase';
import { PatientPageMockup } from './pages/PatientPageMockup';

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

// Which of the two post-login pages is showing, once signed in. Deliberately
// plain useState, not a routing library — there are only ever these two
// screens, and neither needs a URL of its own (no deep-linking requirement
// for a single-dentist, always-signed-in-locally app). Going "back" to the
// list (PatientChart's own back button) or picking a different patient both
// just replace this state; nothing here persists across a real page reload.
type Route = { page: 'list' } | { page: 'chart'; patientId: string; patientLabel: string };

function App() {
  const { session, loading, signIn, signOut, signInError } = useAuth();
  const [route, setRoute] = useState<Route>({ page: 'list' });

  if (DEV_PAGE === 'showcase') return <StatusShowcase />;
  if (DEV_PAGE === 'patient-mockup') return <PatientPageMockup />;

  if (loading) return null;
  if (!session) return <Login onSignIn={signIn} error={signInError} />;

  if (route.page === 'chart') {
    return (
      <PatientChart
        patientId={route.patientId}
        patientLabel={route.patientLabel}
        onBack={() => setRoute({ page: 'list' })}
        onSignOut={signOut}
      />
    );
  }

  return (
    <PatientList
      onSelectPatient={(patientId, patientLabel) => setRoute({ page: 'chart', patientId, patientLabel })}
      onSignOut={signOut}
    />
  );
}

export default App;
