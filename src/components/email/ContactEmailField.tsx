import { useEffect, useState } from 'react';
import { usePracticeContext } from '../../contexts/PracticeContext';
import { usePracticeContactEmail } from '../../hooks/usePracticeContactEmail';

// E-pošta page, above the templates (Gregor, 2026-11-11): where patients'
// replies to automatic emails go (Reply-To). Owners edit, others read.
export function ContactEmailField() {
  const { role } = usePracticeContext();
  const readOnly = role !== 'owner';
  const { email, suggestion, loading, save } = usePracticeContactEmail();
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => setDraft(email), [email]);

  async function commit(value: string) {
    const next = value.trim();
    if (next === email) return;
    if (next && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(next)) {
      setMessage({ kind: 'error', text: 'E-poštni naslov ni pravilen.' });
      return;
    }
    const r = await save(next);
    setMessage(r.error ? { kind: 'error', text: r.error } : { kind: 'ok', text: 'Shranjeno.' });
  }

  if (loading) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="contact-email" className="text-sm font-semibold text-[var(--ink,#1c2624)]">
          Odgovori pacientov prejme
        </label>
        <input
          id="contact-email"
          type="email"
          value={draft}
          disabled={readOnly}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          placeholder={suggestion || 'npr. info@ordinacija.si'}
          className="w-80 rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)] disabled:bg-[#f4f6f5]"
        />
        {!readOnly && !email && suggestion && (
          <button
            type="button"
            onClick={() => commit(suggestion)}
            className="text-xs font-medium text-[var(--accent,#2e6e62)] hover:underline"
          >
            Uporabi {suggestion}
          </button>
        )}
        {message && (
          <span className={`text-sm ${message.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--accent,#2e6e62)]'}`}>
            {message.text}
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--muted,#6f7c79)]">
        E-pošto pošiljamo z naslova brez nabiralnika; ko pacient odgovori na potrditev, opomnik ali račun, odgovor pride na ta naslov.
        {!email && ' Dokler ni vpisan, se odgovori vrnejo kot nedostavljivi.'} Je tudi privzeti prejemnik dnevnega poročila o potrditvah.
      </p>
    </div>
  );
}
