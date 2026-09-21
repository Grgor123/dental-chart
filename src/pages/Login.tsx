import { useState, type FormEvent } from 'react';

interface LoginProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  error: string | null;
}

export function Login({ onSignIn, error }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await onSignIn(email, password);
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg,#eef2f1)] p-6">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-8"
      >
        <div>
          <h1 className="text-xl font-semibold text-[var(--ink,#1c2624)]">Prijava</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft,#45524f)]">Zobna kartoteka za zobozdravstvene ordinacije</p>
        </div>
        <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          E-pošta
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Geslo
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-[var(--accent,#2e6e62)] py-2 font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Prijavljanje …' : 'Prijava'}
        </button>
      </form>
    </div>
  );
}
