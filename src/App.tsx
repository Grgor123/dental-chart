import { useAuth } from './hooks/useAuth';
import { Login } from './pages/Login';
import { PatientChart } from './pages/PatientChart';
import { StatusShowcase } from './pages/StatusShowcase';

// TEMPORARY: showing the status color/symbol showcase in place of the real
// login-gated app so it's reviewable at localhost:5173 without needing to
// sign in first. Remove this flag once the palette is approved.
const SHOW_STATUS_SHOWCASE = true;

function App() {
  const { session, loading, signIn, signOut, signInError } = useAuth();

  if (SHOW_STATUS_SHOWCASE) return <StatusShowcase />;

  if (loading) return null;
  if (!session) return <Login onSignIn={signIn} error={signInError} />;

  return <PatientChart onSignOut={signOut} />;
}

export default App;
