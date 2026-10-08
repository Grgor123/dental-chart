import { useEffect, useState, type ReactNode } from 'react';
import { invoiceSettingsComplete, useInvoiceSettings, type InvoiceSettings } from '../../hooks/useInvoiceSettings';
import { formatIban, normalizeIban } from '../../../supabase/functions/_shared/invoice/payment';
import { FursPremiseSection } from './FursPremiseSection';

// Nastavitve → Podatki za račune — the issuer details printed on every
// invoice (supabase/migrations/023_add_invoicing.sql, invoice_settings).
// Same no-save-button feel as Cenik: a field saves when it's left (text) or
// changed (checkbox, buttons). Each issued invoice keeps its own snapshot, so
// editing here never changes an invoice that's already been issued.

const INPUT_CLASS =
  'w-full rounded border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] focus:border-[var(--accent,#2e6e62)] focus:outline-none';

type TextKey =
  | 'legalName'
  | 'address'
  | 'postalCode'
  | 'city'
  | 'taxNumber'
  | 'registrationNumber'
  | 'iban'
  | 'bankName'
  | 'vatExemptNote'
  | 'footerNote'
  | 'phone'
  | 'email'
  | 'website';

type ShowKey = 'showPhone' | 'showEmail' | 'showWebsite';

// The logo is stored as a data URL in the settings row and printed in a box
// of at most ~75 × 28 mm, so it has a hard size limit: a bigger image is
// refused with a notice (Gregor's explicit choice) rather than squeezed, which
// is what made a wide logo run into the issuer details.
export const LOGO_MAX_W = 500;
export const LOGO_MAX_H = 250;
const LOGO_MAX_CHARS = 650_000;

function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Datoteke ni bilo mogoče prebrati.'));
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error('To ni podprta slika (PNG, JPG, SVG ali WebP).'));
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w > LOGO_MAX_W || h > LOGO_MAX_H) {
          reject(
            new Error(
              `Logotip je prevelik: ${w} × ${h} px. Največja dovoljena velikost je ${LOGO_MAX_W} × ${LOGO_MAX_H} px — sliko pomanjšajte in jo naložite znova.`
            )
          );
          return;
        }
        if (src.length > LOGO_MAX_CHARS) {
          reject(new Error('Datoteka logotipa je prevelika (več kot ~450 KB) — shranite jo kot manjši PNG ali JPG.'));
          return;
        }
        resolve(src);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--muted,#6f7c79)]">{hint}</span>}
    </label>
  );
}

export function InvoiceSettingsSection() {
  const { settings, loading, error, save } = useInvoiceSettings();
  const [draft, setDraft] = useState<InvoiceSettings>(settings);
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Take the stored values ONCE, when loading finishes. Re-syncing after every
  // save would overwrite whatever is being typed in the next field while the
  // previous field's save is still in flight.
  useEffect(() => {
    if (!loading) setDraft(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function commit(next: InvoiceSettings) {
    if (JSON.stringify(next) === JSON.stringify(settings)) return;
    const result = await save(next);
    setStatus(result.error ? { kind: 'error', text: `Ni shranjeno: ${result.error}` } : { kind: 'saved', text: 'Shranjeno.' });
  }

  function text(key: TextKey, props: { placeholder?: string; inputMode?: 'numeric' | 'text' } = {}) {
    return (
      <input
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className={INPUT_CLASS}
        {...props}
      />
    );
  }

  function textarea(key: TextKey, maxLines?: number) {
    return (
      <textarea
        value={draft[key]}
        onChange={(e) => {
          const value = maxLines ? e.target.value.split('\n').slice(0, maxLines).join('\n') : e.target.value;
          setDraft({ ...draft, [key]: value });
        }}
        onBlur={() => commit(draft)}
        rows={2}
        className={INPUT_CLASS}
      />
    );
  }

  function contact(key: TextKey, showKey: ShowKey, label: string, placeholder: string) {
    return (
      <Field label={label}>
        <div className="flex items-center gap-3">
          {text(key, { placeholder })}
          <label className="flex flex-none items-center gap-1.5 text-xs text-[var(--ink-soft,#45524f)]">
            <input
              type="checkbox"
              checked={draft[showKey]}
              onChange={(e) => {
                const next = { ...draft, [showKey]: e.target.checked };
                setDraft(next);
                commit(next);
              }}
            />
            prikaži na računu
          </label>
        </div>
      </Field>
    );
  }

  async function handleLogoFile(file: File | undefined) {
    if (!file) return;
    try {
      const logoDataUrl = await readLogo(file);
      const next = { ...draft, logoDataUrl };
      setDraft(next);
      await commit(next);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  const ibanCheck = draft.iban.trim() ? normalizeIban(draft.iban) : null;

  if (loading) return <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje…</p>;
  if (error) return <p className="text-sm text-[var(--danger,#b3261e)]">{error}</p>;

  return (
    <div className="flex max-w-[860px] flex-col gap-6">
      {!invoiceSettingsComplete(settings) && (
        <p className="rounded border border-[#e0231c] bg-[#fdecea] px-3 py-2 text-sm text-[#8a1c14]">
          Za izdajo računov sta obvezna vsaj naziv izdajatelja in davčna številka.
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Logotip (neobvezno)</h3>
        <p className="text-xs text-[var(--muted,#6f7c79)]">
          Natisne se v levem zgornjem kotu računa. Največ {LOGO_MAX_W} × {LOGO_MAX_H} px; PNG s prozornim ozadjem je najboljša
          izbira.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {draft.logoDataUrl ? (
            <img
              src={draft.logoDataUrl}
              alt="Logotip"
              className="max-h-[80px] max-w-[260px] rounded border border-[var(--line,#ccd6d4)] bg-white object-contain p-2"
            />
          ) : (
            <span className="text-sm italic text-[var(--muted,#6f7c79)]">Ni naloženega logotipa.</span>
          )}
          <label className="cursor-pointer rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-sm text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]">
            {draft.logoDataUrl ? 'Zamenjaj' : 'Naloži logotip'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={(e) => {
                handleLogoFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {draft.logoDataUrl && (
            <button
              type="button"
              onClick={() => {
                const next = { ...draft, logoDataUrl: '' };
                setDraft(next);
                commit(next);
              }}
              className="text-sm text-[var(--danger,#b3261e)] hover:underline"
            >
              Odstrani
            </button>
          )}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)] sm:col-span-2">Izdajatelj</h3>
        <Field label="Naziv izdajatelja" hint="Polno ime, kot je vpisano v register (npr. »Zobozdravstvo Ana Novak s.p.«)." wide>
          {text('legalName')}
        </Field>
        <Field label="Naslov" wide>
          {text('address')}
        </Field>
        <Field label="Poštna številka">{text('postalCode', { inputMode: 'numeric' })}</Field>
        <Field label="Kraj" hint="Natisne se tudi kot kraj izdaje računa.">
          {text('city')}
        </Field>
        <Field label="Davčna številka" hint="8 številk, brez »SI« — predpona se doda sama, če ste zavezanec za DDV.">
          {text('taxNumber', { inputMode: 'numeric' })}
        </Field>
        <Field label="Matična številka">{text('registrationNumber', { inputMode: 'numeric' })}</Field>
        <label className="flex items-center gap-2 text-sm text-[var(--ink,#1c2624)] sm:col-span-2">
          <input
            type="checkbox"
            checked={draft.vatPayer}
            onChange={(e) => {
              const next = { ...draft, vatPayer: e.target.checked };
              setDraft(next);
              commit(next);
            }}
          />
          Zavezanec za DDV
        </label>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)] sm:col-span-2">Kontakt</h3>
        {contact('phone', 'showPhone', 'Telefon', '+386 …')}
        {contact('email', 'showEmail', 'E-pošta', 'info@…')}
        {contact('website', 'showWebsite', 'Spletna stran', 'www.…')}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)] sm:col-span-2">Plačilo</h3>
        <Field label="TRR (IBAN)">
          <input
            value={draft.iban}
            onChange={(e) => setDraft({ ...draft, iban: e.target.value })}
            onBlur={() => {
              // Shown and stored the way it's printed: "SI56 0400 0027 9667 334".
              const next = { ...draft, iban: draft.iban.trim() ? formatIban(draft.iban) : '' };
              setDraft(next);
              commit(next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            placeholder="SI56 0400 0027 9667 334"
            className={INPUT_CLASS}
          />
          {ibanCheck && !ibanCheck.valid && (
            <span className="text-xs text-[var(--danger,#b3261e)]">
              IBAN ni veljaven (napačna kontrolna številka ali dolžina) — preverite ga. UPN QR koda se brez veljavnega IBAN ne natisne.
            </span>
          )}
        </Field>
        <Field label="Banka">{text('bankName')}</Field>
        <Field label="Rok plačila pri nakazilu (dni)">
          <input
            type="number"
            min={0}
            max={365}
            value={draft.paymentDueDays}
            onChange={(e) => setDraft({ ...draft, paymentDueDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })}
            onBlur={() => commit(draft)}
            className={INPUT_CLASS}
          />
        </Field>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)] sm:col-span-2">Besedila na računu</h3>
        <Field
          label="Opomba o oprostitvi DDV"
          hint="Natisne se, kadar ima račun postavke z 0 % DDV. Besedilo naj potrdi vaš računovodja."
          wide
        >
          {textarea('vatExemptNote')}
        </Field>
        <Field
          label="Noga računa (neobvezno)"
          hint="Natisne se na dnu strani, 2 cm od spodnjega roba. Največ 2 vrstici — z Enter preidete v drugo vrstico."
          wide
        >
          {textarea('footerNote', 2)}
        </Field>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)] sm:col-span-2">Tiskanje</h3>
        <Field
          label="Privzeto tiskanje"
          hint="Ta gumb je na računu poudarjen, »Izdaj in natisni« pa natisne v tej obliki. Tiskalnik izberete v oknu za tiskanje — brskalnik si zapomni zadnjega."
          wide
        >
          <div className="flex gap-2">
            {(
              [
                ['receipt', 'Blagajniški trak'],
                ['a4', 'A4'],
              ] as const
            ).map(([format, label]) => (
              <button
                key={format}
                type="button"
                onClick={() => {
                  const next = { ...draft, defaultPrintFormat: format };
                  setDraft(next);
                  commit(next);
                }}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                  draft.defaultPrintFormat === format
                    ? 'bg-[var(--accent,#2e6e62)] text-white'
                    : 'border border-[var(--line,#ccd6d4)] text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Širina blagajniškega traku">
          <div className="flex gap-2">
            {([80, 58] as const).map((width) => (
              <button
                key={width}
                type="button"
                onClick={() => {
                  const next = { ...draft, receiptWidthMm: width };
                  setDraft(next);
                  commit(next);
                }}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                  draft.receiptWidthMm === width
                    ? 'bg-[var(--accent,#2e6e62)] text-white'
                    : 'border border-[var(--line,#ccd6d4)] text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]'
                }`}
              >
                {width} mm
              </button>
            ))}
          </div>
        </Field>
        <Field
          label="Oznaka poslovnega prostora in naprave"
          hint="Del številke računa (npr. P1-B1-14). Pod to oznako je poslovni prostor prijavljen pri FURS."
        >
          <span className="px-1 py-2 text-sm text-[var(--ink,#1c2624)]">
            {settings.premiseCode} – {settings.deviceCode}
          </span>
        </Field>
      </section>

      <FursPremiseSection premiseCode={settings.premiseCode} />

      {status && (
        <p className={`text-xs ${status.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--muted,#6f7c79)]'}`}>
          {status.text}
        </p>
      )}
      {notice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setNotice(null)}>
          <div
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-[var(--surface,#fff)] p-5 text-left shadow-xl"
          >
            <p className="text-sm text-[var(--ink,#1c2624)]">{notice}</p>
            <div className="flex justify-end">
              <button
                type="button"
                autoFocus
                onClick={() => setNotice(null)}
                className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                V redu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
