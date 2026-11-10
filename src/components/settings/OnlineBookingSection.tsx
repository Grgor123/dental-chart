import { useEffect, useState } from 'react';
import { usePracticeContext } from '../../contexts/PracticeContext';
import { isBookable, useTherapists } from '../../hooks/useTherapists';
import { DEFAULT_CONSENT_TEXT, useOnlineBooking, type OnlineVisitType } from '../../hooks/useOnlineBooking';
import { durationOptions, usePracticeHours } from '../../hooks/usePracticeHours';
import { ConfirmDialog } from '../ui/ConfirmDialog';

// Nastavitve → Spletno naročanje (migration 050, Gregor 2026-11-09): the form
// patients use on the practice's website. Visit types (what can be booked, how
// long, who offers it), booking window, consent wording and the embed code.
// Patients never pick a therapist: a known patient goes to their "Izbran
// terapevt", everyone else to whoever is free first (supabase/functions/
// online-booking). Owners edit, others read. Saved on blur/change like Cenik.

const PAGES_BASE = 'https://grgor123.github.io/dental-chart';
const PAGES_ORIGIN = new URL(PAGES_BASE).origin;
const PROJECT_REF = new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname.split('.')[0];
const INPUT_CLASS = 'w-full rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)] disabled:bg-[#f4f6f5]';
const LABEL_CLASS = 'flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]';

/** A text field that saves on blur when the value changed. */
function TextField({
  value,
  onCommit,
  disabled,
  placeholder,
  maxLength,
  multiline,
  required,
}: {
  value: string;
  onCommit: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  required?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next === value.trim()) return;
    if (required && !next) {
      setDraft(value);
      return;
    }
    onCommit(next);
  };
  return multiline ? (
    <textarea
      value={draft}
      rows={3}
      disabled={disabled}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      className={INPUT_CLASS}
    />
  ) : (
    <input
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={INPUT_CLASS}
    />
  );
}

export function OnlineBookingSection() {
  const { role, practiceName } = usePracticeContext();
  const readOnly = role !== 'owner';
  const {
    settings,
    visitTypes,
    loading,
    error,
    saveSettings,
    createVisitType,
    updateVisitType,
    moveVisitType,
    deleteVisitType,
    setVisitTypeTherapists,
  } = useOnlineBooking();
  const { therapists } = useTherapists();
  // The clinic's own list (Nastavitve → Delovni čas → Trajanja terminov).
  const { durations } = usePracticeHours();
  const team = therapists.filter((t) => !t.archived && isBookable(t));
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OnlineVisitType | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(action: Promise<{ error?: string }>) {
    const r = await action;
    setMessage(r.error ?? null);
  }

  if (loading) return <p className="text-sm text-[var(--muted,#6f7c79)]">Nalagam …</p>;
  if (error) return <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>;

  const formUrl = settings.publicKey ? `${PAGES_BASE}/online-booking.html?k=${settings.publicKey}&p=${PROJECT_REF}` : null;
  const localUrl = settings.publicKey ? `http://localhost:5190/online-booking.html?k=${settings.publicKey}&p=${PROJECT_REF}` : null;
  const embedCode = formUrl
    ? `<iframe id="dental-booking" src="${formUrl}" title="Spletno naročanje" style="width:100%;max-width:680px;height:760px;border:0"></iframe>
<script>
window.addEventListener('message', function (e) {
  if (e.origin === '${PAGES_ORIGIN}' && e.data && e.data.type === 'dental-booking-height') {
    document.getElementById('dental-booking').style.height = (e.data.height + 8) + 'px';
  }
});
</script>`
    : '';
  const activeTypes = visitTypes.filter((v) => v.active);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Spletno naročanje</h3>
        <label className="flex items-start gap-2 text-sm text-[var(--ink,#1c2624)]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.enabled}
            disabled={readOnly}
            onChange={(e) => run(saveSettings({ enabled: e.target.checked }))}
          />
          <span>
            <strong>Pacienti se lahko naročijo prek obrazca na spletni strani</strong>
            <span className="block text-[var(--ink-soft,#45524f)]">
              Termin se takoj vpiše v koledar (oznaka »Spletno«), pacient prejme potrditveno e-pošto. Pacient terapevta ne izbira: znan
              pacient je naročen k svojemu izbranemu terapevtu, nov k tistemu, ki je prej prost.
            </span>
          </span>
        </label>
        {settings.enabled && activeTypes.length === 0 && (
          <p className="text-sm text-[var(--danger,#b3261e)]">Dodajte vsaj eno vrsto obiska, sicer obrazec ne ponudi ničesar.</p>
        )}
        {message && <p className="text-sm text-[var(--danger,#b3261e)]">{message}</p>}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Vrste obiska</h3>
          <p className="mt-1 text-xs text-[var(--muted,#6f7c79)]">
            Samo to se lahko naroči prek spleta; za vse drugo obrazec pacienta prosi, naj pokliče. »Kdo izvaja«: brez izbire — vsi
            terapevti (razen asistentov).
          </p>
        </div>
        <div className="overflow-x-auto rounded border border-[var(--line,#ccd6d4)]">
          <table className="w-full text-sm">
            <thead className="bg-[#f4f6f5] text-left text-xs text-[var(--ink-soft,#45524f)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Naziv</th>
                <th className="px-3 py-2 font-semibold">Opis (neobvezno)</th>
                <th className="w-28 px-3 py-2 font-semibold">Trajanje</th>
                <th className="px-3 py-2 font-semibold">Kdo izvaja</th>
                <th className="w-20 px-3 py-2 font-semibold">Ponujeno</th>
                <th className="w-28 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line,#ccd6d4)]">
              {visitTypes.map((v, i) => (
                <tr key={v.id} className={v.active ? '' : 'opacity-60'}>
                  <td className="px-3 py-2 align-top">
                    <TextField value={v.name} required maxLength={80} disabled={readOnly} onCommit={(name) => run(updateVisitType(v.id, { name }))} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <TextField
                      value={v.description}
                      maxLength={300}
                      disabled={readOnly}
                      placeholder="npr. Pregled zob in dlesni"
                      onCommit={(description) => run(updateVisitType(v.id, { description }))}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <select
                      value={v.durationMinutes}
                      disabled={readOnly}
                      onChange={(e) => run(updateVisitType(v.id, { durationMinutes: Number(e.target.value) }))}
                      className={INPUT_CLASS}
                    >
                      {durationOptions(durations, v.durationMinutes).map((d) => (
                          <option key={d} value={d}>
                            {d} min
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1">
                      {team.map((t) => {
                        const on = v.therapistIds.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            disabled={readOnly}
                            onClick={() =>
                              run(setVisitTypeTherapists(v.id, on ? v.therapistIds.filter((x) => x !== t.id) : [...v.therapistIds, t.id]))
                            }
                            className={`rounded-full border px-2 py-0.5 text-xs ${
                              on
                                ? 'border-[var(--accent,#2e6e62)] bg-[var(--accent,#2e6e62)] text-white'
                                : 'border-[var(--line,#ccd6d4)] text-[var(--ink-soft,#45524f)]'
                            }`}
                          >
                            {t.name}
                          </button>
                        );
                      })}
                      {v.therapistIds.length === 0 && <span className="self-center text-xs text-[var(--muted,#6f7c79)]">vsi</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      className="mt-2"
                      checked={v.active}
                      disabled={readOnly}
                      onChange={(e) => run(updateVisitType(v.id, { active: e.target.checked }))}
                    />
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    {!readOnly && (
                      <div className="flex items-center justify-end gap-2 pt-1.5 text-xs">
                        <button
                          type="button"
                          disabled={i === 0}
                          onClick={() => run(moveVisitType(v.id, -1))}
                          className="text-[var(--ink-soft,#45524f)] disabled:opacity-30"
                          title="Premakni gor"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          disabled={i === visitTypes.length - 1}
                          onClick={() => run(moveVisitType(v.id, 1))}
                          className="text-[var(--ink-soft,#45524f)] disabled:opacity-30"
                          title="Premakni dol"
                        >
                          ▼
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(v)}
                          className="font-medium text-[var(--danger,#b3261e)] hover:underline"
                        >
                          Izbriši
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {visitTypes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-3 text-sm text-[var(--muted,#6f7c79)]">
                    Ni vrst obiska.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => run(createVisitType())}
            className="self-start rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-sm font-medium text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]"
          >
            + Dodaj vrsto obiska
          </button>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Termini</h3>
        <div className="flex flex-wrap gap-4">
          <label className={LABEL_CLASS}>
            Naročanje vnaprej
            <select
              value={settings.bookingWindowDays}
              disabled={readOnly}
              onChange={(e) => run(saveSettings({ bookingWindowDays: Number(e.target.value) }))}
              className={INPUT_CLASS}
            >
              {[...new Set([7, 14, 21, 28, 42, 56, 90, settings.bookingWindowDays])]
                .sort((a, b) => a - b)
                .map((d) => (
                  <option key={d} value={d}>
                    {d % 7 === 0 ? `${d / 7} ${d / 7 === 1 ? 'teden' : d / 7 === 2 ? 'tedna' : d / 7 <= 4 ? 'tedni' : 'tednov'}` : `${d} dni`}
                  </option>
                ))}
            </select>
          </label>
          <label className={LABEL_CLASS}>
            Najmanj vnaprej
            <select
              value={settings.minNoticeHours}
              disabled={readOnly}
              onChange={(e) => run(saveSettings({ minNoticeHours: Number(e.target.value) }))}
              className={INPUT_CLASS}
            >
              {[...new Set([2, 4, 12, 24, 48, 72, settings.minNoticeHours])]
                .sort((a, b) => a - b)
                .map((h) => (
                  <option key={h} value={h}>
                    {h} ur
                  </option>
                ))}
            </select>
          </label>
          <label className={LABEL_CLASS}>
            Začetki terminov na
            <select
              value={settings.slotStepMinutes}
              disabled={readOnly}
              onChange={(e) => run(saveSettings({ slotStepMinutes: Number(e.target.value) }))}
              className={INPUT_CLASS}
            >
              {[10, 15, 20, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-[var(--muted,#6f7c79)]">
          Ponujeni so le termini znotraj delovnega časa ambulante in terapevta (Nastavitve → Delovni čas, Ekipa), mimo odsotnosti, zaprtih dni in
          že vpisanih terminov.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Obrazec</h3>
        <label className={LABEL_CLASS}>
          Soglasje (obvezno polje v obrazcu)
          <TextField
            multiline
            value={settings.consentText}
            maxLength={1000}
            disabled={readOnly}
            placeholder={DEFAULT_CONSENT_TEXT}
            onCommit={(consentText) => run(saveSettings({ consentText }))}
          />
          <span className="font-normal text-[var(--muted,#6f7c79)]">
            Prazno = privzeto besedilo zgoraj. {'{ordinacija}'} se zamenja z »{practiceName}«.
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={LABEL_CLASS}>
            Povezava do izjave o zasebnosti
            <TextField
              value={settings.privacyPolicyUrl}
              disabled={readOnly}
              placeholder="https://…"
              onCommit={(privacyPolicyUrl) => {
                if (privacyPolicyUrl && !privacyPolicyUrl.startsWith('https://')) {
                  setMessage('Povezava mora začeti s https://');
                  return;
                }
                run(saveSettings({ privacyPolicyUrl }));
              }}
            />
          </label>
          <label className={LABEL_CLASS}>
            Telefon za »pokličite nas«
            <TextField
              value={settings.phone}
              maxLength={40}
              disabled={readOnly}
              placeholder="iz Podatkov za račune"
              onCommit={(phone) => run(saveSettings({ phone }))}
            />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Vstavitev na spletno stran</h3>
        {formUrl ? (
          <>
            <p className="text-sm text-[var(--ink-soft,#45524f)]">
              Kodo prilepite na stran (WordPress: blok »Custom HTML«). Okvir se sam prilagodi višini obrazca.
            </p>
            <textarea readOnly value={embedCode} rows={8} className={`${INPUT_CLASS} font-mono text-xs`} onFocus={(e) => e.target.select()} />
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(embedCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 font-medium text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]"
              >
                {copied ? 'Kopirano ✓' : 'Kopiraj kodo'}
              </button>
              <a href={formUrl} target="_blank" rel="noreferrer" className="font-medium text-[var(--accent,#2e6e62)] hover:underline">
                Odpri obrazec ↗
              </a>
              {location.hostname === 'localhost' && localUrl && (
                <a href={localUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--ink-soft,#45524f)] hover:underline">
                  Preizkus na tem računalniku (localhost:5190) ↗
                </a>
              )}
            </div>
            {!settings.enabled && <p className="text-xs text-[var(--danger,#b3261e)]">Obrazec deluje šele, ko je spletno naročanje vklopljeno.</p>}
          </>
        ) : (
          <p className="text-sm text-[var(--muted,#6f7c79)]">Koda se pojavi, ko spletno naročanje prvič vklopite.</p>
        )}
      </section>

      {confirmDelete && (
        <ConfirmDialog
          confirmLabel="Izbriši"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const v = confirmDelete;
            setConfirmDelete(null);
            await run(deleteVisitType(v.id));
          }}
        >
          Ali res želite izbrisati vrsto obiska »{confirmDelete.name}«? Že naročeni termini ostanejo. Če jo želite le začasno skriti, odkljukajte
          »Ponujeno«.
        </ConfirmDialog>
      )}
    </div>
  );
}
