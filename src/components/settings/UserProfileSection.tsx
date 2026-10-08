import { useEffect, useState } from 'react';
import { isValidTaxNumber, useFurs, type UserProfile } from '../../hooks/useFurs';

const INPUT_CLASS =
  'w-full rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] outline-none focus:border-[var(--accent,#2e6e62)]';

// Nastavitve → Moj profil: the signed-in user's own details. The tax number is
// what FURS records as the operator (OperatorTaxNumber) on every cash/card
// invoice this user issues — each user enters their own, once.
export function UserProfileSection() {
  const { profile, loading, error, saveProfile } = useFurs();
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!loading) setDraft(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function commit(next: UserProfile) {
    if (next.fullName === profile.fullName && next.taxNumber === profile.taxNumber) return;
    const result = await saveProfile(next);
    setStatus(result.error ? { kind: 'error', text: `Ni shranjeno: ${result.error}` } : { kind: 'saved', text: 'Shranjeno.' });
  }

  if (loading) return <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje…</p>;
  if (error) return <p className="text-sm text-[var(--danger,#b3261e)]">{error}</p>;

  const typedTax = draft.taxNumber.replace(/\s/g, '').replace(/^SI/i, '');
  const taxInvalid = typedTax !== '' && !isValidTaxNumber(typedTax);

  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      <p className="text-sm text-[var(--ink-soft,#45524f)]">
        Vaši osebni podatki. Davčna številka se ob davčnem potrjevanju (FURS) zapiše kot oznaka osebe, ki je izdala račun —
        brez nje računov, plačanih z gotovino ali kartico, ne morete izdati.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Ime in priimek</span>
          <input
            value={draft.fullName}
            onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Osebna davčna številka</span>
          <input
            value={draft.taxNumber}
            inputMode="numeric"
            placeholder="12345678"
            onChange={(e) => setDraft({ ...draft, taxNumber: e.target.value })}
            onBlur={() => {
              if (!taxInvalid) commit({ ...draft, taxNumber: typedTax });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className={`${INPUT_CLASS} ${taxInvalid ? 'border-[var(--danger,#b3261e)]' : ''}`}
          />
          {taxInvalid && <span className="text-xs text-[var(--danger,#b3261e)]">Davčna številka ni veljavna (8 števk s kontrolno števko).</span>}
        </label>
      </div>
      {status && (
        <p className={`text-xs ${status.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--muted,#6f7c79)]'}`}>{status.text}</p>
      )}
    </div>
  );
}
