import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AppNavShell } from '../components/ui/AppNavShell';
import { CardTabs } from '../components/ui/CardTabs';
import { usePracticeContext } from '../contexts/PracticeContext';
import { useEmailTemplates, type TemplateFormValues } from '../hooks/useEmailTemplates';
import {
  PLACEHOLDER_LABELS,
  TEMPLATE_DEFS,
  TEMPLATE_KEYS,
  type TemplateDef,
  type TemplateKey,
  type TemplateOverride,
} from '../../supabase/functions/_shared/email/templateDefs';

interface EmailTemplatesProps {
  /** Back to the patient list (AppNavShell's "Domov"/"Storitve"). */
  onBack: () => void;
  onSignOut: () => void;
  onNavigateCalendar: () => void;
  onNavigateSettings: () => void;
  onNavigateInvoices: () => void;
  /** Its own menu item: starts this page afresh. */
  onNavigateEmail: () => void;
}

type EditableField = 'subject' | 'heading' | 'body';

function initialValues(key: TemplateKey, override: TemplateOverride | undefined): TemplateFormValues {
  const def = TEMPLATE_DEFS[key];
  return {
    subject: override?.subject ?? def.defaultSubject,
    heading: override?.heading ?? def.defaultHeading,
    body: override?.body ?? def.defaultBody,
    enabled: override?.enabled ?? true,
    timingValue: def.timing ? (override?.timing_value ?? def.timing.default) : null,
    sendHour: def.sendHourDefault !== null ? (override?.send_hour ?? def.sendHourDefault) : null,
  };
}

const INPUT_CLASS = 'w-full rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)]';
const NUMBER_CLASS = 'w-16 rounded border border-[var(--line,#ccd6d4)] px-2 py-1 text-sm text-[var(--ink,#1c2624)]';

// "E-pošta" — where a practice customizes the wording (and, for the
// scheduled types, the timing) of each automatic email. The layout shell,
// calendar attachment and unsubscribe footer are fixed and never editable;
// see supabase/functions/_shared/email/templates.ts. Everything shown here
// comes from templateDefs.ts, the same file the Edge Functions render from.
export function EmailTemplates({ onBack, onSignOut, onNavigateCalendar, onNavigateSettings, onNavigateInvoices, onNavigateEmail }: EmailTemplatesProps) {
  const { practiceName } = usePracticeContext();
  const { overrides, loading, error, saveTemplate, resetTemplate, previewTemplate, sendTestEmail } = useEmailTemplates();
  const [selectedKey, setSelectedKey] = useState<TemplateKey>(TEMPLATE_KEYS[0]);
  // Bumped on reset so the editor below (keyed on it) re-initializes from
  // the platform defaults.
  const [resetVersion, setResetVersion] = useState(0);

  return (
    <>
      <AppNavShell
        userLabel={practiceName ?? undefined}
        onSignOut={onSignOut}
        onNavigateHome={onBack}
        onNavigateStoritve={onBack}
        onNavigateCalendar={onNavigateCalendar}
        onNavigateSettings={onNavigateSettings}
        onNavigateInvoices={onNavigateInvoices}
        onNavigateEmail={onNavigateEmail}
        activeSubmenu="eposta"
      />
      <div className="mx-auto flex max-w-[1300px] flex-col gap-5 p-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink,#1c2624)]">E-poštna sporočila</h1>
          <p className="mt-1.5 text-sm text-[var(--ink-soft,#45524f)]">
            Prilagodite besedilo in čas pošiljanja samodejnih e-poštnih sporočil pacientom ter besedilo e-pošte, s katero pošiljate račune.
          </p>
        </div>

        {loading && <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje …</p>}
        {error && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>}

        {!loading && !error && (
          <CardTabs
            tabs={TEMPLATE_KEYS.map((key) => {
              const override = overrides[key];
              return {
                key,
                label: TEMPLATE_DEFS[key].label,
                badge: (
                  <>
                    {override && !override.enabled && (
                      <span className="rounded-full bg-[#fdecea] px-1.5 py-0.5 text-[10px] font-semibold text-[#b3261e]">Izklopljeno</span>
                    )}
                    {override && override.enabled && (
                      <span title="Prilagojeno" className="h-1.5 w-1.5 rounded-full bg-[var(--accent,#2e6e62)]" />
                    )}
                  </>
                ),
              };
            })}
            selectedKey={selectedKey}
            onSelect={(key) => setSelectedKey(key as TemplateKey)}
          >
            {({ squareTopLeft }) => (
              <TemplateEditor
                templateKey={selectedKey}
                formVersion={resetVersion}
                override={overrides[selectedKey]}
                saveTemplate={saveTemplate}
                resetTemplate={async (key) => {
                  const result = await resetTemplate(key);
                  if (!result.error) setResetVersion((v) => v + 1);
                  return result;
                }}
                previewTemplate={previewTemplate}
                sendTestEmail={sendTestEmail}
                squareTopLeft={squareTopLeft}
              />
            )}
          </CardTabs>
        )}
      </div>
    </>
  );
}

interface TemplateEditorProps {
  templateKey: TemplateKey;
  /** True when the first tab is selected — the card's top-left corner is then
      square so the tab's left line continues straight into the card's. */
  squareTopLeft: boolean;
  /** Bumped by the page on "reset to default" so the form re-initializes. */
  formVersion: number;
  override: TemplateOverride | undefined;
  saveTemplate: ReturnType<typeof useEmailTemplates>['saveTemplate'];
  resetTemplate: ReturnType<typeof useEmailTemplates>['resetTemplate'];
  previewTemplate: ReturnType<typeof useEmailTemplates>['previewTemplate'];
  sendTestEmail: ReturnType<typeof useEmailTemplates>['sendTestEmail'];
}

// One card for the selected email (the page's tabs choose which): fields on
// the left half, live preview on the right half. It isn't re-mounted on a tab
// switch (so the preview pane stays put instead of flashing blank) — the form
// re-initializes in place instead, below.
function TemplateEditor({
  templateKey,
  squareTopLeft,
  formVersion,
  override,
  saveTemplate,
  resetTemplate,
  previewTemplate,
  sendTestEmail,
}: TemplateEditorProps) {
  const def = TEMPLATE_DEFS[templateKey];
  // Re-initialized ONLY when the selected template or a reset changes (never on
  // a save's reload, so it can't clobber what the user is still typing) — the
  // "adjust state while rendering" pattern rather than an effect.
  const formId = `${templateKey}-${formVersion}`;
  const [loadedFormId, setLoadedFormId] = useState(formId);
  const [values, setValues] = useState<TemplateFormValues>(() => initialValues(templateKey, override));
  const [activeField, setActiveField] = useState<EditableField>('body');
  const [status, setStatus] = useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);
  if (loadedFormId !== formId) {
    setLoadedFormId(formId);
    setValues(initialValues(templateKey, override));
    setStatus(null);
  }
  const [busy, setBusy] = useState<'save' | 'reset' | 'test' | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const refs = {
    subject: useRef<HTMLInputElement>(null),
    heading: useRef<HTMLInputElement>(null),
    body: useRef<HTMLTextAreaElement>(null),
  };

  // Live preview: debounced, rendered server-side by the same code real
  // emails use (see the email-template-preview function).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await previewTemplate(templateKey, {
        subject: values.subject,
        heading: values.heading,
        body: values.body,
      });
      if (cancelled) return;
      if ('error' in result) {
        setPreviewError(result.error);
        return;
      }
      setPreviewError(null);
      setPreviewHtml(result.html);
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [templateKey, values.subject, values.heading, values.body, previewTemplate]);

  function insertPlaceholder(placeholder: string) {
    const element = refs[activeField].current;
    const token = `{${placeholder}}`;
    const current = values[activeField];
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    setValues((v) => ({
      ...v,
      [activeField]: current.slice(0, start) + token + current.slice(end),
    }));
    // Restore focus/cursor after React re-renders the controlled field.
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function validate(): string | null {
    if (!values.subject.trim()) return 'Zadeva ne sme biti prazna.';
    if (!values.body.trim()) return 'Besedilo ne sme biti prazno.';
    if (def.timing && values.timingValue !== null) {
      if (!Number.isInteger(values.timingValue) || values.timingValue < def.timing.min || values.timingValue > def.timing.max) {
        return `Čas pošiljanja mora biti med ${def.timing.min} in ${def.timing.max}.`;
      }
    }
    if (values.sendHour !== null && (!Number.isInteger(values.sendHour) || values.sendHour < 0 || values.sendHour > 23)) {
      return 'Ura mora biti med 0 in 23.';
    }
    return null;
  }

  async function handleSave() {
    const problem = validate();
    if (problem) {
      setStatus({ kind: 'error', text: problem });
      return;
    }
    setBusy('save');
    const result = await saveTemplate(templateKey, values);
    setBusy(null);
    setStatus(result.error ? { kind: 'error', text: result.error } : { kind: 'ok', text: 'Shranjeno.' });
  }

  async function handleReset() {
    if (!window.confirm('Ponastavim to sporočilo na privzeto besedilo in čas? Vaše spremembe bodo izgubljene.')) return;
    setBusy('reset');
    const result = await resetTemplate(templateKey);
    setBusy(null);
    if (result.error) setStatus({ kind: 'error', text: result.error });
  }

  async function handleTest() {
    setBusy('test');
    const result = await sendTestEmail(templateKey, {
      subject: values.subject,
      heading: values.heading,
      body: values.body,
    });
    setBusy(null);
    setStatus(
      'error' in result
        ? {
            kind: 'error',
            text: `Testnega e-maila ni bilo mogoče poslati: ${result.error}`,
          }
        : { kind: 'ok', text: `Testni e-mail poslan na ${result.sentTo}.` },
    );
  }

  const fieldRing = (field: EditableField) => (activeField === field ? ' ring-1 ring-[var(--accent,#2e6e62)]' : '');

  return (
    <div
      className={`flex flex-col gap-5 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-5 ${
        squareTopLeft ? 'rounded-tl-none' : ''
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink,#1c2624)]">{def.label}</h2>
          <p className="mt-0.5 text-xs text-[var(--muted,#6f7c79)]">{def.description}</p>
        </div>
        {/* Emails sent only by hand (the invoice) have nothing to switch off. */}
        {!def.manualOnly && (
          <label className="flex items-center gap-2 text-sm text-[var(--ink,#1c2624)]">
            <input type="checkbox" checked={values.enabled} onChange={(e) => setValues((v) => ({ ...v, enabled: e.target.checked }))} />
            Pošiljanje vklopljeno
          </label>
        )}
      </div>

      {/* Card body, split in half: fields on the left, live preview on the right. */}
      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-[var(--ink,#1c2624)]">
              Zadeva
              <input
                ref={refs.subject}
                value={values.subject}
                onFocus={() => setActiveField('subject')}
                onChange={(e) => setValues((v) => ({ ...v, subject: e.target.value }))}
                className={INPUT_CLASS + fieldRing('subject')}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-[var(--ink,#1c2624)]">
              Naslov v sporočilu
              <input
                ref={refs.heading}
                value={values.heading}
                onFocus={() => setActiveField('heading')}
                onChange={(e) => setValues((v) => ({ ...v, heading: e.target.value }))}
                className={INPUT_CLASS + fieldRing('heading')}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-[var(--ink,#1c2624)]">
              Besedilo
              <textarea
                ref={refs.body}
                rows={10}
                value={values.body}
                onFocus={() => setActiveField('body')}
                onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))}
                className={INPUT_CLASS + fieldRing('body')}
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-[var(--ink-soft,#45524f)]">
                Kliknite za vstavitev v polje, v katerem ste (zadeva, naslov ali besedilo):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {def.placeholders.map((placeholder) => (
                  <button
                    key={placeholder}
                    type="button"
                    title={PLACEHOLDER_LABELS[placeholder]}
                    onClick={() => insertPlaceholder(placeholder)}
                    className="rounded-full border border-[var(--line,#ccd6d4)] px-2.5 py-0.5 text-xs text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]"
                  >
                    {`{${placeholder}}`}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--muted,#6f7c79)]">
                Prazna vrstica naredi nov odstavek. **Tako** označite krepko. Odstavek, v katerem je vrednost prazna (npr. storitev), se
                izpusti.
                {templateKey === 'recall' && ' Pri tem sporočilu je {datum} datum zadnjega obiska.'}
              </p>
            </div>

            <div className="rounded border border-[var(--line,#ccd6d4)] bg-[#f7faf9] p-3">
              <div className="mb-1.5 text-sm font-medium text-[var(--ink,#1c2624)]">Kdaj pošljemo</div>
              <TimingControls def={def} values={values} setValues={setValues} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy !== null}
              className="rounded bg-[var(--accent,#2e6e62)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy === 'save' ? 'Shranjujem …' : 'Shrani'}
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={busy !== null}
              className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] disabled:opacity-50"
            >
              {busy === 'test' ? 'Pošiljam …' : 'Pošlji testni e-mail'}
            </button>
            {override && (
              <button
                type="button"
                onClick={handleReset}
                disabled={busy !== null}
                className="rounded px-3 py-2 text-sm text-[var(--danger,#b3261e)] disabled:opacity-50"
              >
                Ponastavi na privzeto
              </button>
            )}
            {status && (
              <span className={`text-sm ${status.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--accent,#2e6e62)]'}`}>
                {status.text}
              </span>
            )}
          </div>
        </div>

        {/* Live preview — as tall as the fields column, so the card ends just below the buttons. If the
            Besedilo box is dragged taller, the whole page simply grows and scrolls. */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--ink,#1c2624)]">Predogled</span>
          {previewError && <p className="text-sm text-[var(--danger,#b3261e)]">Predogleda ni bilo mogoče naložiti: {previewError}</p>}
          <iframe
            title="Predogled e-poštnega sporočila"
            sandbox=""
            srcDoc={previewHtml ?? ''}
            className="min-h-[420px] w-full flex-1 rounded border border-[var(--line,#ccd6d4)] bg-white"
          />
        </div>
      </div>
    </div>
  );
}

interface TimingControlsProps {
  def: TemplateDef;
  values: TemplateFormValues;
  setValues: Dispatch<SetStateAction<TemplateFormValues>>;
}

function parseNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Only the timing fields a type actually supports — immediate types (booking,
// cancellation, reschedule) just say so, since nothing there is adjustable.
function TimingControls({ def, values, setValues }: TimingControlsProps) {
  if (!def.timing) {
    return <p className="text-sm text-[var(--ink-soft,#45524f)]">{def.description}</p>;
  }

  const timing = def.timing;
  const valueInput = (
    <input
      type="number"
      min={timing.min}
      max={timing.max}
      value={values.timingValue ?? ''}
      onChange={(e) => setValues((v) => ({ ...v, timingValue: parseNumber(e.target.value) }))}
      className={NUMBER_CLASS}
    />
  );
  const hourInput = (
    <span className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        max={23}
        value={values.sendHour ?? ''}
        onChange={(e) => setValues((v) => ({ ...v, sendHour: parseNumber(e.target.value) }))}
        className={NUMBER_CLASS}
      />
      :00
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--ink,#1c2624)]">
      {timing.unit === 'days_before' && (
        <>
          {valueInput} dni pred terminom, ob {hourInput}
        </>
      )}
      {timing.unit === 'hours_after' && <>{valueInput} ur po koncu opravljenega termina</>}
      {timing.unit === 'months_after' && (
        <>
          {valueInput} mesecev po zadnjem obisku, ob {hourInput}
        </>
      )}
    </div>
  );
}
