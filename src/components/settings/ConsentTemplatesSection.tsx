import { useState } from 'react';
import { useConsentTemplates, type ConsentTemplate } from '../../hooks/useConsents';
import { consentTextHtml } from '../../lib/consentPrint';
import { ConfirmDialog } from '../ui/ConfirmDialog';

// Nastavitve → Soglasja (migration 058): the practice's consent forms. Every
// practice starts with drafts written by Claude, marked "Osnutek — preglejte"
// until saved (saving is the review). A consent already given to a patient
// keeps its own copy of the text, so editing here never changes signed ones.

const NEW_ID = 'new';
const NEW_TEMPLATE: ConsentTemplate = { id: NEW_ID, title: '', body: '', sortOrder: 0, isActive: true, needsReview: false };

export function ConsentTemplatesSection() {
  const { templates, loading, error, createTemplate, saveTemplate, deleteTemplate, addDefaults } = useConsentTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // "+ Novo soglasje" opens an unsaved form; it's created on Shrani.
  const isNew = selectedId === NEW_ID;
  const selected = isNew ? NEW_TEMPLATE : (templates.find((t) => t.id === selectedId) ?? templates[0] ?? null);

  if (loading) return <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje …</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Soglasja k posegom</h3>
        <p className="mt-1 text-xs text-[var(--muted,#6f7c79)]">
          Besedila soglasij, ki jih pacient podpiše prek kode QR na svojem telefonu ali tablici ordinacije oziroma doma prek povezave v e-pošti (kartoteka pacienta → Soglasja → Podpiši).
          Začetna besedila so osnutki — zobozdravnik naj jih pregleda in prilagodi; s shranjevanjem je osnutek pregledan. Sprememba
          besedila ne vpliva na že podpisana soglasja.
        </p>
      </div>
      {error && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>}

      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              className={`flex flex-col items-start rounded px-3 py-2 text-left text-sm ${
                selected?.id === t.id ? 'bg-[#C8D1D9] text-[var(--ink,#1c2624)]' : 'text-[var(--ink-soft,#45524f)] hover:bg-[#eef1f3]'
              }`}
            >
              <span className={t.isActive ? '' : 'line-through'}>{t.title}</span>
              {t.needsReview && <span className="text-[11px] font-semibold text-[#8a5a00]">Osnutek — preglejte</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedId(NEW_ID)}
            className={`mt-1 rounded px-3 py-2 text-left text-sm font-semibold text-[var(--accent,#2e6e62)] ${isNew ? 'bg-[#C8D1D9]' : 'hover:bg-[#eef1f3]'}`}
          >
            + Novo soglasje
          </button>
          {templates.length === 0 && (
            <button type="button" onClick={() => addDefaults()} className="rounded px-3 py-2 text-left text-sm text-[var(--accent,#2e6e62)] hover:bg-[#eef1f3]">
              Dodaj osnutke (implantat, puljenje, endodontija …)
            </button>
          )}
        </div>

        {selected ? (
          <TemplateEditor
            key={selected.id}
            template={selected}
            isNew={isNew}
            onSave={async (fields) => {
              if (!isNew) return saveTemplate(selected.id, fields);
              const result = await createTemplate(fields);
              if (result.id) setSelectedId(result.id);
              return result;
            }}
            onDelete={async () => {
              if (isNew) {
                setSelectedId(null);
                return {};
              }
              const result = await deleteTemplate(selected.id);
              if (!result.error) setSelectedId(null);
              return result;
            }}
          />
        ) : (
          <p className="text-sm italic text-[var(--muted,#6f7c79)]">Ni soglasij.</p>
        )}
      </div>

    </div>
  );
}

function TemplateEditor({
  template,
  isNew,
  onSave,
  onDelete,
}: {
  template: ConsentTemplate;
  isNew: boolean;
  onSave: (fields: { title: string; body: string; isActive: boolean }) => Promise<{ error?: string }>;
  onDelete: () => Promise<{ error?: string }>;
}) {
  const [title, setTitle] = useState(template.title);
  const [body, setBody] = useState(template.body);
  const [isActive, setIsActive] = useState(template.isActive);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    if (!title.trim()) {
      setStatus({ kind: 'error', text: 'Naslov ne sme biti prazen.' });
      return;
    }
    if (!body.trim()) {
      setStatus({ kind: 'error', text: 'Besedilo ne sme biti prazno.' });
      return;
    }
    setBusy(true);
    const result = await onSave({ title, body, isActive });
    setBusy(false);
    setStatus(result.error ? { kind: 'error', text: result.error } : { kind: 'ok', text: 'Shranjeno.' });
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold text-[var(--ink,#1c2624)]">
          Naslov
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm font-normal text-[var(--ink,#1c2624)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-[var(--ink,#1c2624)]">
          Besedilo
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={22}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm font-normal text-[var(--ink,#1c2624)]"
          />
        </label>
        <p className="text-xs text-[var(--muted,#6f7c79)]">Prazna vrstica naredi nov odstavek. **Tako** označite krepko.</p>
        <label className="flex items-center gap-2 text-sm text-[var(--ink,#1c2624)]">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Na voljo pri novem soglasju
        </label>
        {status && (
          <p className={`text-sm ${status.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--accent,#2e6e62)]'}`}>{status.text}</p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {template.needsReview ? 'Pregledano — shrani' : 'Shrani'}
          </button>
          <button
            type="button"
            onClick={() => (isNew ? onDelete() : setConfirmDelete(true))}
            disabled={busy}
            className="rounded border border-[var(--line,#ccd6d4)] px-4 py-2 text-sm text-[var(--danger,#b3261e)]"
          >
            {isNew ? 'Zavrzi' : 'Izbriši'}
          </button>
        </div>
      </div>

      <div className="min-w-0">
        <div className="mb-1 text-sm font-semibold text-[var(--ink,#1c2624)]">Predogled</div>
        <div className="rounded-md border border-[var(--line,#ccd6d4)] bg-[#f4f6f5] p-4">
          <div className="rounded bg-white p-4 text-sm leading-relaxed text-[var(--ink,#1c2624)] [&_p]:mb-2">
            <h4 className="mb-2 text-base font-semibold">{title}</h4>
            {/* Escaped by consentTextHtml (only <p>, <br>, <strong> are produced). */}
            <div dangerouslySetInnerHTML={{ __html: consentTextHtml(body) }} />
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false);
            const result = await onDelete();
            if (result.error) setStatus({ kind: 'error', text: result.error });
          }}
        >
          Izbrisati soglasje »{template.title}«? Že dana soglasja pacientov ostanejo nespremenjena.
        </ConfirmDialog>
      )}
    </>
  );
}
