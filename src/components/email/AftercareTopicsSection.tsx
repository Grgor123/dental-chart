import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { AftercareTopic, AftercareTopicFields, CategoryOption } from '../../hooks/useAftercareTopics';
import type { PreviewSection, TemplateFormValues } from '../../hooks/useEmailTemplates';
import {
  PLACEHOLDER_LABELS,
  TEMPLATE_DEFS,
  type TemplateKey,
  type TemplateOverride,
} from '../../../supabase/functions/_shared/email/templateDefs';

// E-pošta → "Navodila po posegu" (migration 034) — ONE card, per Gregor's
// request: the left list starts with "Uvodno besedilo" (the editable
// "aftercare" email template — subject, heading, intro, on/off, test send),
// followed by the practice's aftercare topics. Each topic is a titled plain
// text; the categories chosen for it tick it automatically on an invoice whose
// services belong to them. A starter text shows "Osnutek" until it's saved —
// saving is the review. Preview: intro + all included topics while the intro
// is selected, intro + that one topic while a topic is.

const INPUT_CLASS = 'w-full rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)]';
const KEY: TemplateKey = 'aftercare';
const INTRO = 'intro';
const NEW = 'new';
const EMPTY: AftercareTopicFields = { title: '', body: '', isActive: true, categoryIds: [] };

type IntroField = 'subject' | 'heading' | 'body';
type TextValues = Pick<TemplateFormValues, 'subject' | 'heading' | 'body'>;

interface AftercareTopicsSectionProps {
  /** Mounted only once loaded, so the list is complete from the start. */
  topics: AftercareTopic[];
  categories: CategoryOption[];
  error: string | null;
  /** The card's top-left corner is square when its tab is the first one. */
  squareTopLeft: boolean;
  /** The practice's saved intro ("aftercare" template), if customized. */
  override: TemplateOverride | undefined;
  createTopic: (fields: AftercareTopicFields) => Promise<{ error?: string; id?: string }>;
  saveTopic: (id: string, fields: AftercareTopicFields) => Promise<{ error?: string }>;
  deleteTopic: (id: string) => Promise<{ error?: string }>;
  saveTemplate: (key: TemplateKey, values: TemplateFormValues) => Promise<{ error?: string }>;
  resetTemplate: (key: TemplateKey) => Promise<{ error?: string }>;
  previewTemplate: (key: TemplateKey, values: TextValues, sections?: PreviewSection[]) => Promise<{ html: string } | { error: string }>;
  sendTestEmail: (key: TemplateKey, values: TextValues, sections?: PreviewSection[]) => Promise<{ sentTo: string } | { error: string }>;
}

function fieldsOf(topic: AftercareTopic | undefined): AftercareTopicFields {
  return topic ? { title: topic.title, body: topic.body, isActive: topic.isActive, categoryIds: topic.categoryIds } : EMPTY;
}

function introOf(override: TemplateOverride | undefined): TemplateFormValues {
  const def = TEMPLATE_DEFS[KEY];
  return {
    subject: override?.subject ?? def.defaultSubject,
    heading: override?.heading ?? def.defaultHeading,
    body: override?.body ?? def.defaultBody,
    enabled: override?.enabled ?? true,
    timingValue: null,
    sendHour: null,
  };
}

export function AftercareTopicsSection(props: AftercareTopicsSectionProps) {
  const { topics, categories, error, squareTopLeft, override } = props;
  const def = TEMPLATE_DEFS[KEY];
  const [selectedId, setSelectedId] = useState<string>(INTRO);
  const selected = topics.find((t) => t.id === selectedId);

  const [intro, setIntro] = useState<TemplateFormValues>(() => introOf(override));
  const [savedIntro, setSavedIntro] = useState<TemplateFormValues>(() => introOf(override));
  const [activeField, setActiveField] = useState<IntroField>('body');
  const refs = {
    subject: useRef<HTMLInputElement>(null),
    heading: useRef<HTMLInputElement>(null),
    body: useRef<HTMLTextAreaElement>(null),
  };

  const [values, setValues] = useState<AftercareTopicFields>(EMPTY);
  const [loadedId, setLoadedId] = useState<string>(INTRO);
  const [busy, setBusy] = useState<'save' | 'test' | 'reset' | 'delete' | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // A topic's form re-initializes only when another item is chosen (never on
  // a save's reload, so it can't clobber what's being typed).
  if (loadedId !== selectedId) {
    setLoadedId(selectedId);
    if (selectedId !== INTRO) setValues(fieldsOf(selected));
    setStatus(null);
  }

  const introDirty = JSON.stringify(intro) !== JSON.stringify(savedIntro);
  const topicDirty = selectedId !== INTRO && JSON.stringify(values) !== JSON.stringify(fieldsOf(selected));
  const introText: TextValues = { subject: intro.subject, heading: intro.heading, body: intro.body };
  const includedSections: PreviewSection[] = topics.filter((t) => t.isActive).map((t) => ({ title: t.title, body: t.body }));
  const previewSections: PreviewSection[] =
    selectedId === INTRO ? includedSections : [{ title: values.title || 'Nova tematika', body: values.body }];
  const previewKey = JSON.stringify([introText, previewSections]);

  const { previewTemplate } = props;
  useEffect(() => {
    let cancelled = false;
    const [text, sections] = JSON.parse(previewKey) as [TextValues, PreviewSection[]];
    const timer = setTimeout(async () => {
      const result = await previewTemplate(KEY, text, sections);
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
  }, [previewKey, previewTemplate]);

  function choose(id: string) {
    if (topicDirty && !window.confirm('Sprememb pri tej tematiki niste shranili. Jih zavržem?')) return;
    setSelectedId(id);
  }

  function insertPlaceholder(placeholder: string) {
    const element = refs[activeField].current;
    const token = `{${placeholder}}`;
    const current = intro[activeField];
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    setIntro((v) => ({ ...v, [activeField]: current.slice(0, start) + token + current.slice(end) }));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function toggleCategory(id: string) {
    setValues((v) => ({
      ...v,
      categoryIds: v.categoryIds.includes(id) ? v.categoryIds.filter((c) => c !== id) : [...v.categoryIds, id],
    }));
  }

  // ---- Intro actions -----------------------------------------------------------
  async function saveIntro() {
    if (!intro.subject.trim()) return setStatus({ kind: 'error', text: 'Zadeva ne sme biti prazna.' });
    if (!intro.body.trim()) return setStatus({ kind: 'error', text: 'Uvodno besedilo ne sme biti prazno.' });
    setBusy('save');
    const result = await props.saveTemplate(KEY, intro);
    setBusy(null);
    if (result.error) return setStatus({ kind: 'error', text: result.error });
    setSavedIntro(intro);
    setStatus({ kind: 'ok', text: 'Shranjeno.' });
  }

  async function resetIntro() {
    if (!window.confirm('Ponastavim uvodno besedilo na privzeto? Vaše spremembe bodo izgubljene.')) return;
    setBusy('reset');
    const result = await props.resetTemplate(KEY);
    setBusy(null);
    if (result.error) return setStatus({ kind: 'error', text: result.error });
    const defaults = introOf(undefined);
    setIntro(defaults);
    setSavedIntro(defaults);
    setStatus({ kind: 'ok', text: 'Ponastavljeno na privzeto.' });
  }

  async function sendTest() {
    setBusy('test');
    const result = await props.sendTestEmail(KEY, introText, includedSections);
    setBusy(null);
    setStatus(
      'error' in result
        ? { kind: 'error', text: `Testnega e-maila ni bilo mogoče poslati: ${result.error}` }
        : { kind: 'ok', text: `Testni e-mail (uvod in vse vključene tematike) poslan na ${result.sentTo}.` }
    );
  }

  // ---- Topic actions -------------------------------------------------------------
  async function saveCurrentTopic() {
    if (!values.title.trim()) return setStatus({ kind: 'error', text: 'Vpišite naslov tematike.' });
    if (!values.body.trim()) return setStatus({ kind: 'error', text: 'Vpišite besedilo navodil.' });
    setBusy('save');
    if (selectedId === NEW) {
      const result = await props.createTopic(values);
      setBusy(null);
      if (result.error) return setStatus({ kind: 'error', text: result.error });
      if (result.id) {
        setLoadedId(result.id);
        setSelectedId(result.id);
      }
      setStatus({ kind: 'ok', text: 'Tematika je dodana.' });
      return;
    }
    const result = await props.saveTopic(selectedId, values);
    setBusy(null);
    setStatus(result.error ? { kind: 'error', text: result.error } : { kind: 'ok', text: 'Shranjeno.' });
  }

  async function deleteCurrentTopic() {
    setConfirmDelete(false);
    setBusy('delete');
    const result = await props.deleteTopic(selectedId);
    setBusy(null);
    if (result.error) return setStatus({ kind: 'error', text: result.error });
    setSelectedId(INTRO);
  }

  const itemClass = (id: string) =>
    `flex flex-col items-start gap-0.5 rounded px-3 py-2 text-left text-sm text-[var(--ink,#1c2624)] ${
      id === selectedId ? 'bg-[#eaf4f1] font-semibold' : 'hover:bg-[#f7faf9]'
    }`;
  const statusLine = status && (
    <span className={`text-sm ${status.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--accent,#2e6e62)]'}`}>{status.text}</span>
  );

  return (
    <div
      className={`flex flex-col gap-4 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-5 ${squareTopLeft ? 'rounded-tl-none' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink,#1c2624)]">{def.label}</h2>
          <p className="mt-0.5 text-xs text-[var(--muted,#6f7c79)]">
            Ob izdaji računa pacient prejme uvodno besedilo in pod njim označene tematike. Tematika se na računu označi samodejno, če je na
            računu storitev iz izbrane kategorije cenika — pred izdajo jo lahko še odznačite ali dodate drugo.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--ink,#1c2624)]">
          <input
            type="checkbox"
            checked={intro.enabled}
            onChange={(e) => {
              setIntro((v) => ({ ...v, enabled: e.target.checked }));
              setSelectedId(INTRO);
            }}
          />
          Pošiljanje ob izdaji računa vklopljeno
        </label>
      </div>

      {error && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju tematik: {error}</p>}

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
        {/* List: the intro first, then the topics */}
        <div className="flex flex-col gap-1">
          <button type="button" onClick={() => choose(INTRO)} className={itemClass(INTRO)}>
            Uvodno besedilo
            {introDirty && <span className="text-[10px] font-normal text-[#6b4a00]">neshranjene spremembe</span>}
          </button>
          <span className="mt-2 px-3 text-xs font-medium uppercase text-[var(--muted,#6f7c79)]">Tematike</span>
          {topics.map((t) => (
            <button key={t.id} type="button" onClick={() => choose(t.id)} className={`${itemClass(t.id)} ${t.isActive ? '' : 'opacity-60'}`}>
              {t.title}
              <span className="flex gap-1">
                {t.needsReview && (
                  <span className="rounded-full bg-[#fff6e5] px-1.5 py-0.5 text-[10px] font-semibold text-[#6b4a00]">Osnutek — preglejte</span>
                )}
                {!t.isActive && <span className="rounded-full bg-[#fdecea] px-1.5 py-0.5 text-[10px] font-semibold text-[#b3261e]">Izklopljeno</span>}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => choose(NEW)}
            className={`rounded border border-dashed border-[var(--line,#ccd6d4)] px-3 py-2 text-left text-sm font-medium text-[var(--accent,#2e6e62)] hover:border-[var(--accent,#2e6e62)] ${
              selectedId === NEW ? 'bg-[#eaf4f1]' : ''
            }`}
          >
            + Nova tematika
          </button>
        </div>

        {/* Editor */}
        {selectedId === INTRO ? (
          <div className="flex min-w-0 flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-[var(--ink,#1c2624)]">
              Zadeva
              <input
                ref={refs.subject}
                value={intro.subject}
                onFocus={() => setActiveField('subject')}
                onChange={(e) => setIntro((v) => ({ ...v, subject: e.target.value }))}
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-[var(--ink,#1c2624)]">
              Naslov v sporočilu
              <input
                ref={refs.heading}
                value={intro.heading}
                onFocus={() => setActiveField('heading')}
                onChange={(e) => setIntro((v) => ({ ...v, heading: e.target.value }))}
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-[var(--ink,#1c2624)]">
              Uvodno besedilo
              <textarea
                ref={refs.body}
                rows={9}
                value={intro.body}
                onFocus={() => setActiveField('body')}
                onChange={(e) => setIntro((v) => ({ ...v, body: e.target.value }))}
                className={INPUT_CLASS}
              />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-[var(--ink-soft,#45524f)]">Kliknite za vstavitev v polje, v katerem ste:</span>
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
                {'{datum}'} je datum opravljene storitve na računu. Prazna vrstica naredi nov odstavek, **tako** označite krepko. Pod uvodom
                sledijo označene tematike.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={saveIntro}
                disabled={busy !== null}
                className="rounded bg-[var(--accent,#2e6e62)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy === 'save' ? 'Shranjujem …' : 'Shrani'}
              </button>
              <button
                type="button"
                onClick={sendTest}
                disabled={busy !== null}
                className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] disabled:opacity-50"
              >
                {busy === 'test' ? 'Pošiljam …' : 'Pošlji testni e-mail'}
              </button>
              {override && (
                <button
                  type="button"
                  onClick={resetIntro}
                  disabled={busy !== null}
                  className="rounded px-3 py-2 text-sm text-[var(--danger,#b3261e)] disabled:opacity-50"
                >
                  Ponastavi na privzeto
                </button>
              )}
              {statusLine}
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {selected?.needsReview && (
              <p className="rounded border border-[#EF9F27] bg-[#fff6e5] px-3 py-2 text-xs text-[#6b4a00]">
                To je osnutek splošnih navodil. Preden ga prejmejo pacienti, ga preberite in po potrebi popravite — s shranjevanjem potrdite,
                da je pregledan.
              </p>
            )}
            <label className="flex flex-col gap-1 text-sm font-medium text-[var(--ink,#1c2624)]">
              Naslov tematike
              <input value={values.title} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} maxLength={120} className={INPUT_CLASS} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-[var(--ink,#1c2624)]">
              Besedilo navodil
              <textarea rows={14} value={values.body} onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))} className={INPUT_CLASS} />
              <span className="text-xs font-normal text-[var(--muted,#6f7c79)]">
                Vsaka vrstica ostane svoja vrstica, prazna vrstica naredi nov odstavek. **Tako** označite krepko.
              </span>
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-[var(--ink,#1c2624)]">Samodejno označi pri kategorijah cenika</span>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => {
                  const on = values.categoryIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategory(c.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        on
                          ? 'border-[var(--accent,#2e6e62)] bg-[var(--accent,#2e6e62)] text-white'
                          : 'border-[var(--line,#ccd6d4)] text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]'
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
                {categories.length === 0 && <span className="text-xs text-[var(--muted,#6f7c79)]">V ceniku ni kategorij.</span>}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--ink,#1c2624)]">
              <input type="checkbox" checked={values.isActive} onChange={(e) => setValues((v) => ({ ...v, isActive: e.target.checked }))} />
              Tematika je vključena (izklopljena se ne ponudi na računu)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={saveCurrentTopic}
                disabled={busy !== null}
                className="rounded bg-[var(--accent,#2e6e62)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy === 'save' ? 'Shranjujem …' : selectedId === NEW ? 'Dodaj tematiko' : selected?.needsReview ? 'Shrani (pregledano)' : 'Shrani'}
              </button>
              {selectedId !== NEW && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy !== null}
                  className="rounded px-3 py-2 text-sm text-[var(--danger,#b3261e)] disabled:opacity-50"
                >
                  Izbriši
                </button>
              )}
              {statusLine}
            </div>
          </div>
        )}

        {/* Preview */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--ink,#1c2624)]">
            {selectedId === INTRO ? 'Predogled (uvod in vse vključene tematike)' : 'Predogled (uvod in ta tematika)'}
          </span>
          {previewError && <p className="text-sm text-[var(--danger,#b3261e)]">Predogleda ni bilo mogoče naložiti: {previewError}</p>}
          <iframe
            title="Predogled navodil"
            sandbox=""
            srcDoc={previewHtml ?? ''}
            className="min-h-[520px] w-full flex-1 rounded border border-[var(--line,#ccd6d4)] bg-white"
          />
        </div>
      </div>

      {confirmDelete && selected && (
        <ConfirmDialog onCancel={() => setConfirmDelete(false)} onConfirm={deleteCurrentTopic} confirmLabel="Izbriši">
          Ali res želite izbrisati tematiko <strong>{selected.title}</strong>? Namesto tega jo lahko tudi le izklopite.
        </ConfirmDialog>
      )}
    </div>
  );
}
