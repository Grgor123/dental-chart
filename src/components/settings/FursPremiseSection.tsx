import { useEffect, useState } from 'react';
import { useFurs, type FursPremiseData } from '../../hooks/useFurs';

const INPUT_CLASS =
  'w-full rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] outline-none focus:border-[var(--accent,#2e6e62)]';

const EMPTY: FursPremiseData = {
  cadastralNumber: '',
  buildingNumber: '',
  buildingSectionNumber: '',
  street: '',
  houseNumber: '',
  houseNumberAdditional: '',
  community: '',
  city: '',
  postalCode: '',
  validityDate: new Date().toLocaleDateString('sv-SE'),
};

const FIELDS: { key: keyof FursPremiseData; label: string; hint?: string; numeric?: boolean; type?: string }[] = [
  { key: 'cadastralNumber', label: 'Šifra katastrske občine', numeric: true },
  { key: 'buildingNumber', label: 'Številka stavbe', numeric: true },
  { key: 'buildingSectionNumber', label: 'Številka dela stavbe', numeric: true },
  { key: 'validityDate', label: 'Velja od', type: 'date' },
  { key: 'street', label: 'Ulica' },
  { key: 'houseNumber', label: 'Hišna številka' },
  { key: 'houseNumberAdditional', label: 'Dodatek k hišni številki', hint: 'npr. »J« pri 41j' },
  { key: 'community', label: 'Občina' },
  { key: 'postalCode', label: 'Poštna številka', numeric: true },
  { key: 'city', label: 'Kraj' },
];

// Nastavitve → Podatki za račune → Davčno potrjevanje (FURS): the business
// premise registration. Once registered, every cash/card invoice is sent to
// FURS right after issuing. The data comes from the property record (GURS:
// katastrska občina, stavba, del stavbe).
export function FursPremiseSection({ premiseCode }: { premiseCode: string }) {
  const { premise, loading, error, registerPremise } = useFurs();
  const [draft, setDraft] = useState<FursPremiseData>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!loading && premise) {
      const { premiseCode: _code, environment: _env, registeredAt: _at, ...data } = premise;
      setDraft(data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function handleRegister() {
    setBusy(true);
    setMessage(null);
    const result = await registerPremise(draft);
    setBusy(false);
    setMessage(result.error ? { kind: 'error', text: result.error } : { kind: 'ok', text: 'Poslovni prostor je prijavljen pri FURS.' });
  }

  if (loading) return null;

  return (
    <section className="grid gap-4 sm:grid-cols-2">
      <h3 className="text-sm font-bold text-[var(--ink,#1c2624)] sm:col-span-2">Davčno potrjevanje (FURS)</h3>
      <div className="sm:col-span-2">
        {premise ? (
          <p className="rounded border border-[var(--accent,#2e6e62)] bg-[#eaf4f1] px-3 py-2 text-sm text-[var(--ink,#1c2624)]">
            Poslovni prostor <strong>{premise.premiseCode}</strong> je prijavljen pri FURS (
            {premise.environment === 'test' ? 'testno okolje' : 'produkcija'}, {new Date(premise.registeredAt).toLocaleDateString('sl-SI')}).
            Računi, plačani z gotovino ali kartico, se ob izdaji samodejno davčno potrdijo.
          </p>
        ) : (
          <p className="rounded border border-[#EF9F27] bg-[#fff6e5] px-3 py-2 text-sm text-[#6b4a00]">
            Poslovni prostor {premiseCode} še ni prijavljen pri FURS. Dokler ni, se računi ne potrjujejo davčno — računov,
            plačanih z gotovino ali kartico, zato ne uporabljajte za resnična plačila.
          </p>
        )}
        {error && <p className="mt-1 text-xs text-[var(--danger,#b3261e)]">{error}</p>}
      </div>
      {FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">{f.label}</span>
          <input
            type={f.type ?? 'text'}
            inputMode={f.numeric ? 'numeric' : undefined}
            value={draft[f.key]}
            onChange={(e) => setDraft({ ...draft, [f.key]: f.numeric ? e.target.value.replace(/\D/g, '') : e.target.value })}
            className={INPUT_CLASS}
          />
          {f.hint && <span className="text-xs text-[var(--muted,#6f7c79)]">{f.hint}</span>}
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button
          type="button"
          onClick={handleRegister}
          disabled={busy}
          className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Prijavljam …' : premise ? 'Ponovno prijavi (posodobi podatke)' : 'Prijavi poslovni prostor'}
        </button>
        <span className="text-xs text-[var(--muted,#6f7c79)]">
          Podatki o stavbi so v zemljiškem katastru (GURS) ali pri vašem računovodji.
        </span>
      </div>
      {message && (
        <p className={`text-sm sm:col-span-2 ${message.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--accent,#2e6e62)]'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
