import { useState, type FormEvent } from 'react';

// "Nastavite geslo" — shown when the app opens from an invitation or a
// password-reset link (migration 036). The link has already signed the person
// in; they choose a password here, then continue into the app.

interface SetPasswordProps {
  email: string;
  invited: boolean;
  onSetPassword: (password: string) => Promise<{ error?: string }>;
  onCancel: () => void;
}

const MIN_LENGTH = 8;
const INPUT_CLASS = 'rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]';

export function SetPassword({ email, invited, onSetPassword, onCancel }: SetPasswordProps) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_LENGTH) return setError(`Geslo naj ima vsaj ${MIN_LENGTH} znakov.`);
    if (password !== repeat) return setError('Gesli se ne ujemata.');
    setSubmitting(true);
    const result = await onSetPassword(password);
    setSubmitting(false);
    if (result.error) setError(result.error);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg,#eef2f1)] p-6">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-8"
      >
        <div>
          <h1 className="text-xl font-semibold text-[var(--ink,#1c2624)]">{invited ? 'Dobrodošli' : 'Novo geslo'}</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft,#45524f)]">
            {invited ? 'Nastavite si geslo za svoj račun' : 'Nastavite novo geslo za račun'} <strong>{email}</strong>.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Geslo (vsaj {MIN_LENGTH} znakov)
          <input
            type="password"
            required
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Ponovite geslo
          <input
            type="password"
            required
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={submitting} className="rounded bg-[var(--accent,#2e6e62)] py-2 font-medium text-white disabled:opacity-60">
          {submitting ? 'Shranjujem …' : 'Shrani geslo in nadaljuj'}
        </button>
        <button type="button" onClick={onCancel} className="self-center text-sm text-[var(--ink-soft,#45524f)] hover:underline">
          Prekliči in se odjavi
        </button>
      </form>
    </div>
  );
}
