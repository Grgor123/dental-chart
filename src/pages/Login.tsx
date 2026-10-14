import { useState, type FormEvent } from 'react';

interface LoginProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  error: string | null;
  /** "Pozabljeno geslo?" — request-password-reset (migration 036). */
  onRequestReset: (email: string) => Promise<{ error?: string }>;
  /** The app opened from an invitation / reset link that didn't work. */
  linkError: string | null;
}

const INPUT_CLASS = 'rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]';

export function Login({ onSignIn, error, onRequestReset, linkError }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // "Pozabljeno geslo?" swaps the form for a single email field.
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    if (resetMode) {
      const result = await onRequestReset(email.trim());
      setResetError(result.error ?? null);
      setResetSent(!result.error);
    } else {
      await onSignIn(email, password);
    }
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg,#eef2f1)] p-6">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-8"
      >
        <div>
          <h1 className="text-xl font-semibold text-[var(--ink,#1c2624)]">{resetMode ? 'Pozabljeno geslo' : 'Prijava'}</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft,#45524f)]">
            {resetMode
              ? 'Vpišite e-poštni naslov svojega računa. Poslali vam bomo povezavo za nastavitev novega gesla.'
              : 'Zobna kartoteka za zobozdravstvene ordinacije'}
          </p>
        </div>

        {linkError && !resetMode && (
          <p className="rounded border border-[#EF9F27] bg-[#fff6e5] px-3 py-2 text-sm text-[#6b4a00]">
            Povezava iz e-pošte ne velja več (je potekla ali je bila že uporabljena). Zahtevajte novo z »Pozabljeno geslo?« ali prosite
            lastnika ordinacije, da vabilo pošlje znova.
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          E-pošta
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT_CLASS} />
        </label>
        {!resetMode && (
          <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
            Geslo
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        )}

        {!resetMode && error && <p className="text-sm text-red-600">{error}</p>}
        {resetMode && resetError && <p className="text-sm text-red-600">{resetError}</p>}
        {resetMode && resetSent && (
          <p className="rounded border border-[var(--accent,#2e6e62)] bg-[#eaf4f1] px-3 py-2 text-sm text-[var(--ink,#1c2624)]">
            Če za ta naslov obstaja račun, smo nanj poslali povezavo za novo geslo. Preverite tudi mapo z neželeno pošto.
          </p>
        )}

        <button type="submit" disabled={submitting} className="rounded bg-[var(--accent,#2e6e62)] py-2 font-medium text-white disabled:opacity-60">
          {resetMode ? (submitting ? 'Pošiljam …' : 'Pošlji povezavo') : submitting ? 'Prijavljanje …' : 'Prijava'}
        </button>
        <button
          type="button"
          onClick={() => {
            setResetMode((m) => !m);
            setResetSent(false);
            setResetError(null);
          }}
          className="self-center text-sm text-[var(--accent,#2e6e62)] hover:underline"
        >
          {resetMode ? '← Nazaj na prijavo' : 'Pozabljeno geslo?'}
        </button>
      </form>
    </div>
  );
}
