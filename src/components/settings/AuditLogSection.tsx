import { useMemo, useState } from 'react';
import { useAuditLog, type AuditEntry } from '../../hooks/useAuditLog';
import { usePatients } from '../../hooks/usePatients';

// Nastavitve → Revizijska sled (owners only; migration 056). Who created,
// changed, deleted, viewed, printed or emailed which patient's data, and
// when. The log can't be changed or deleted by anyone.

const ACTION_LABELS: Record<string, string> = {
  insert: 'Nov vnos',
  update: 'Sprememba',
  delete: 'Izbris',
  view: 'Ogled',
  print: 'Tiskanje',
  email: 'E-pošta',
  sign: 'Podpis obiska',
  addendum: 'Dopolnilo',
};

const ENTITY_LABELS: Record<string, string> = {
  patients: 'Pacient',
  visits: 'Obisk',
  tooth_records: 'Karta',
  appointments: 'Termin',
  health_questionnaires: 'Vprašalnik o zdravju',
  invoices: 'Račun',
  visit_addenda: 'Dopolnilo obiska',
  patient_consents: 'Soglasje',
};

const DOCUMENT_LABELS: Record<string, string> = {
  karta: 'karta (A4)',
  racun: 'račun',
  navodila: 'navodila po posegu',
  soglasje: 'soglasje',
};

// The most common field names in plain words; others are shown as stored.
const FIELD_LABELS: Record<string, string> = {
  first_name: 'ime',
  last_name: 'priimek',
  dob: 'datum rojstva',
  phone: 'telefon',
  email: 'e-pošta',
  address: 'naslov',
  postal_code: 'poštna št.',
  city: 'kraj',
  health_card_number: 'št. kartice',
  sex: 'spol',
  surfaces: 'stanje zoba',
  pockets_buccal: 'žepki (bukalno)',
  pockets_lingual: 'žepki (lingvalno)',
  gum_margin_buccal: 'recesija',
  bleeding_buccal: 'krvavitev (bukalno)',
  bleeding_lingual: 'krvavitev (lingvalno)',
  endo: 'endodontija',
  post: 'zatiček',
  notes: 'opombe',
  bridge_group_id: 'most',
  starts_at: 'čas',
  ends_at: 'konec',
  status: 'status',
  therapist_id: 'terapevt',
  service: 'storitev',
  closed_at: 'zaprt',
  signed_at: 'podpis',
  explained_at: 'pojasnilo',
  cancelled_at: 'preklic',
  sent_at: 'poslano',
};
// Bookkeeping columns that change with every save — not worth listing.
const HIDDEN_FIELDS = new Set(['updated_at', 'signed_by', 'signed_by_name', 'signature_png', 'signer_user_agent', 'signed_via', 'signer_name', 'explained_by', 'explained_by_name', 'expires_at']);

// Repeated changes of the same record by the same person, one after another
// (the chart saves every 30 seconds), are shown as one row. The log itself
// keeps every entry.
interface AuditRow {
  entry: AuditEntry;
  count: number;
  /** Time of the earliest entry in the group. */
  firstAt: string;
  fields: string[];
}

function groupEntries(entries: AuditEntry[]): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const entry of entries) {
    const prev = rows[rows.length - 1];
    const fields = Array.isArray(entry.details?.fields) ? entry.details.fields : [];
    if (
      prev &&
      entry.action === 'update' &&
      prev.entry.action === 'update' &&
      prev.entry.actor === entry.actor &&
      prev.entry.entity === entry.entity &&
      prev.entry.recordId === entry.recordId
    ) {
      prev.count += 1;
      prev.firstAt = entry.occurredAt;
      for (const f of fields) if (!prev.fields.includes(f)) prev.fields.push(f);
      continue;
    }
    rows.push({ entry, count: 1, firstAt: entry.occurredAt, fields: [...fields] });
  }
  return rows;
}

function describe(row: AuditRow): string {
  const entry = row.entry;
  const d = entry.details;
  const parts: string[] = [];
  if (d?.tooth) parts.push(`zob ${d.tooth}`);
  if (typeof d?.document === 'string') parts.push(DOCUMENT_LABELS[d.document] ?? d.document);
  if (typeof d?.number === 'string') parts.push(d.number);
  if (entry.action === 'update') {
    const fields = row.fields.filter((f) => !HIDDEN_FIELDS.has(f)).map((f) => FIELD_LABELS[f] ?? f);
    if (fields.length) parts.push(fields.join(', '));
  }
  if (row.count > 1) parts.push(`${row.count}× od ${TIME.format(new Date(row.firstAt))}`);
  return parts.join(' · ');
}

const TIME = new Intl.DateTimeFormat('sl-SI', { timeStyle: 'short', timeZone: 'Europe/Ljubljana' });
const DATE_TIME = new Intl.DateTimeFormat('sl-SI', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Ljubljana' });

const INPUT_CLASS = 'rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)]';

export function AuditLogSection() {
  const { patients } = usePatients();
  const [patientId, setPatientId] = useState('');
  // Everything by default, views included (hiding them was confusing).
  const [action, setAction] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { entries, loading, error, hasMore, loadMore } = useAuditLog({
    patientId: patientId || null,
    action: action || null,
    from: from || null,
    to: to || null,
  });

  const rows = useMemo(() => groupEntries(entries), [entries]);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of patients) map.set(p.patientId, `${p.lastName} ${p.firstName}`.trim());
    return map;
  }, [patients]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Revizijska sled</h3>
        <p className="mt-1 text-xs text-[var(--muted,#6f7c79)]">
          Kdo je ustvaril, spremenil, izbrisal, odprl, natisnil ali poslal podatke pacientov in kdaj. Zapisov ni mogoče
          spreminjati ali brisati. »Sistem« pomeni samodejno delo (opomniki, spletno naročanje, poročila o dostavi).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--ink-soft,#45524f)]">
          Pacient
          <select value={patientId} onChange={(e) => setPatientId(e.target.value)} className={`${INPUT_CLASS} min-w-[220px]`}>
            <option value="">Vsi pacienti</option>
            {[...patients]
              .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'sl'))
              .map((p) => (
                <option key={p.patientId} value={p.patientId}>
                  {p.lastName} {p.firstName}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--ink-soft,#45524f)]">
          Dejanje
          <select value={action} onChange={(e) => setAction(e.target.value)} className={INPUT_CLASS}>
            <option value="all">Vsa dejanja</option>
            <option value="noview">Vse razen ogledov</option>
            <option value="view">Ogled</option>
            <option value="print">Tiskanje</option>
            <option value="email">E-pošta</option>
            <option value="change">Vnosi, spremembe, izbrisi</option>
            <option value="sign">Podpis obiska</option>
            <option value="addendum">Dopolnilo</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--ink-soft,#45524f)]">
          Od
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--ink-soft,#45524f)]">
          Do
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT_CLASS} />
        </label>
      </div>

      {error && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--line,#ccd6d4)] text-xs text-[var(--muted,#6f7c79)]">
              <th className="py-2 pr-3 font-semibold">Čas</th>
              <th className="py-2 pr-3 font-semibold">Uporabnik</th>
              <th className="py-2 pr-3 font-semibold">Dejanje</th>
              <th className="py-2 pr-3 font-semibold">Kaj</th>
              <th className="py-2 pr-3 font-semibold">Pacient</th>
              <th className="py-2 font-semibold">Podrobnosti</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entry, ...row }) => (
              <tr key={entry.id} className="border-b border-[var(--line,#ccd6d4)] align-top text-[var(--ink,#1c2624)]">
                <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs">{DATE_TIME.format(new Date(entry.occurredAt))}</td>
                <td className="py-1.5 pr-3">{entry.actor === 'sistem' ? <span className="text-[var(--muted,#6f7c79)]">Sistem</span> : entry.actor}</td>
                <td className="whitespace-nowrap py-1.5 pr-3">{ACTION_LABELS[entry.action] ?? entry.action}</td>
                <td className="py-1.5 pr-3">{ENTITY_LABELS[entry.entity] ?? entry.entity}</td>
                <td className="py-1.5 pr-3">
                  {entry.patientId ? nameById.get(entry.patientId) ?? <span className="text-[var(--muted,#6f7c79)]">(izbrisan)</span> : '—'}
                </td>
                <td className="py-1.5 text-xs text-[var(--ink-soft,#45524f)]">{describe({ entry, ...row })}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-sm italic text-[var(--muted,#6f7c79)]">
                  Ni zapisov.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje …</p>}
      {hasMore && !loading && (
        <button
          type="button"
          onClick={loadMore}
          className="self-start rounded-full border border-[var(--ink,#1c2624)] px-4 py-1.5 text-sm font-semibold text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)] hover:text-[var(--accent,#2e6e62)]"
        >
          Naloži starejše
        </button>
      )}
    </div>
  );
}
