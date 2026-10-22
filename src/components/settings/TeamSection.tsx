import { useEffect, useState, type FormEvent } from 'react';
import { usePracticeContext } from '../../contexts/PracticeContext';
import {
  THERAPIST_COLORS,
  THERAPIST_KIND_LABELS,
  useTherapists,
  type Therapist,
  type TherapistFields,
  type TherapistKind,
} from '../../hooks/useTherapists';
import { useRooms, type Room } from '../../hooks/useRooms';
import { usePracticeUsers } from '../../hooks/usePracticeUsers';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { WorkingHoursDialog } from './WorkingHoursDialog';
import { useWorkingHours } from '../../hooks/useWorkingHours';
import { ABSENCE_LABELS, describeConflict, scheduleConflicts, toDateIso } from '../../lib/workingHours';

// Nastavitve → Ekipa (migration 046): the people who treat or assist, and the
// practice's rooms (ordinacije). Replaces the calendar's old "+ terapevt".
// Owners edit (RLS enforces it); everyone else sees the list. Like Cenik, every
// field saves on blur/change — no popup. Team members and rooms are archived,
// never deleted (appointments and patients keep pointing at them).

const KINDS: TherapistKind[] = ['dentist', 'specialist', 'hygienist', 'assistant'];
const INPUT_CLASS = 'w-full rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)]';
const TH_CLASS = 'px-3 py-2 font-semibold';

/** A text input that saves on blur when the value changed (and isn't empty if required). */
function TextCell({
  value,
  onCommit,
  required,
  placeholder,
  maxLength,
}: {
  value: string;
  onCommit: (next: string) => void;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next === value.trim()) return;
        if (required && !next) {
          setDraft(value);
          return;
        }
        onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={INPUT_CLASS}
    />
  );
}

function ColorPicker({ value, onChange, disabled }: { value: string; onChange: (c: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label="Barva v koledarju"
        className="h-6 w-6 rounded-full border border-black/10 disabled:cursor-default"
        style={{ backgroundColor: value }}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-20 flex w-[136px] flex-wrap gap-2 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-2 shadow-lg">
            {THERAPIST_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => {
                  setOpen(false);
                  if (c !== value) onChange(c);
                }}
                className="h-6 w-6 rounded-full"
                style={{ backgroundColor: c, outline: c === value ? '2px solid var(--ink, #1c2624)' : 'none', outlineOffset: 2 }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function TeamSection() {
  const { role } = usePracticeContext();
  const isOwner = role === 'owner';
  const { therapists, loading, error, createTherapist, updateTherapist, setArchived } = useTherapists();
  const { rooms, error: roomsError, createRoom, renameRoom, setRoomArchived } = useRooms();
  const { users } = usePracticeUsers();
  const workingHours = useWorkingHours();
  const [hoursFor, setHoursFor] = useState<Therapist | null>(null);
  const todayIso = toDateIso(new Date());
  const [message, setMessage] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<Therapist | null>(null);
  const [confirmArchiveRoom, setConfirmArchiveRoom] = useState<Room | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const active = therapists.filter((t) => !t.archived);
  const archived = therapists.filter((t) => t.archived);
  const activeRooms = rooms.filter((r) => !r.archived);
  const archivedRooms = rooms.filter((r) => r.archived);
  const roomName = new Map(rooms.map((r) => [r.id, r.name] as const));

  async function save(id: string, fields: TherapistFields) {
    setMessage(null);
    const result = await updateTherapist(id, fields);
    if (result.error) setMessage(result.error);
  }

  if (loading) return <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje …</p>;
  if (error) return <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>;

  /** Other active team members assigned the same room. */
  function roommatesOf(t: Therapist) {
    return t.roomId
      ? active.filter((o) => o.id !== t.id && o.roomId === t.roomId).map((o) => ({ therapist: o, schedule: workingHours.schedules.get(o.id) }))
      : [];
  }
  /** First overlap with a roommate, for the table's warning (null if none). */
  function roomClash(t: Therapist): string | null {
    for (const { therapist: other, schedule } of roommatesOf(t)) {
      const found = scheduleConflicts(workingHours.schedules.get(t.id), schedule, todayIso);
      if (found.length > 0) return `Prekrivanje z ${other.name}: ${describeConflict(found[0])}${found.length > 1 ? ` (+${found.length - 1})` : ''}`;
    }
    return null;
  }

  function loginLabel(userId: string | null): string {
    if (!userId) return '—';
    const u = users.find((x) => x.userId === userId);
    return u ? u.fullName || u.email : 'uporabnik';
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Ekipa</h3>
          <p className="mt-1 text-sm text-[var(--ink-soft,#45524f)]">
            Zobozdravniki, specialisti, ustni higieniki in asistenti. Vsi razen asistentov imajo v koledarju svoj stolpec; barva
            označuje njihove termine.
            {!isOwner && ' Ekipo ureja lastnik ordinacije.'}
          </p>
        </div>

        <div className="overflow-x-auto rounded border border-[var(--line,#ccd6d4)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#f7faf9] text-xs uppercase text-[var(--ink-soft,#45524f)]">
              <tr>
                <th className={`${TH_CLASS} w-14`}>Barva</th>
                <th className={TH_CLASS}>Ime in priimek</th>
                <th className={`${TH_CLASS} w-32`}>Naziv</th>
                <th className={`${TH_CLASS} w-44`}>Vloga</th>
                {(rooms.length > 0 || isOwner) && <th className={`${TH_CLASS} w-40`}>Ordinacija</th>}
                <th className={`${TH_CLASS} w-52`}>Uporabniški račun</th>
                <th className={`${TH_CLASS} w-40`}>Delovni čas</th>
                {isOwner && <th className="w-24 px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {active.map((t) => (
                <tr key={t.id} className="border-t border-[var(--line,#ccd6d4)]">
                  <td className="px-3 py-2">
                    <ColorPicker value={t.color} disabled={!isOwner} onChange={(color) => save(t.id, { color })} />
                  </td>
                  <td className="px-3 py-2">
                    {isOwner ? (
                      <TextCell value={t.name} required maxLength={80} onCommit={(name) => save(t.id, { name })} />
                    ) : (
                      t.name
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isOwner ? (
                      <TextCell value={t.title ?? ''} placeholder="npr. dr. dent. med." maxLength={60} onCommit={(title) => save(t.id, { title })} />
                    ) : (
                      t.title || '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isOwner ? (
                      <select value={t.kind} onChange={(e) => save(t.id, { kind: e.target.value as TherapistKind })} className={INPUT_CLASS}>
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {THERAPIST_KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      THERAPIST_KIND_LABELS[t.kind]
                    )}
                  </td>
                  {(rooms.length > 0 || isOwner) && (
                    <td className="px-3 py-2">
                      {isOwner ? (
                        <select
                          value={t.roomId ?? ''}
                          onChange={(e) => save(t.id, { roomId: e.target.value || null })}
                          className={INPUT_CLASS}
                          disabled={rooms.length === 0}
                          title={rooms.length === 0 ? 'Najprej dodajte ordinacijo spodaj.' : undefined}
                        >
                          <option value="">—</option>
                          {rooms
                            .filter((r) => !r.archived || r.id === t.roomId)
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        (t.roomId && roomName.get(t.roomId)) || '—'
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {isOwner ? (
                      <select value={t.userId ?? ''} onChange={(e) => save(t.id, { userId: e.target.value || null })} className={INPUT_CLASS}>
                        <option value="">Brez prijave</option>
                        {users
                          .filter((u) => u.userId === t.userId || !therapists.some((o) => o.userId === u.userId))
                          .map((u) => (
                            <option key={u.userId} value={u.userId}>
                              {u.fullName ? `${u.fullName} (${u.email})` : u.email}
                            </option>
                          ))}
                      </select>
                    ) : (
                      loginLabel(t.userId)
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {(() => {
                      const s = workingHours.schedules.get(t.id);
                      const set = (s?.weekly.length ?? 0) > 0;
                      const next = s?.absences.find((a) => a.dateTo >= todayIso);
                      const clash = roomClash(t);
                      return (
                        <div className="flex flex-col items-start">
                          <button
                            type="button"
                            onClick={() => setHoursFor(t)}
                            className="text-xs font-medium text-[var(--accent,#2e6e62)] hover:underline"
                          >
                            {set ? (isOwner ? 'Uredi' : 'Prikaži') : isOwner ? 'Nastavi' : 'Ni nastavljen'}
                          </button>
                          {next && (
                            <span className="text-[11px] text-[var(--muted,#6f7c79)]">
                              {ABSENCE_LABELS[next.reason]} od {next.dateFrom.split('-').reverse().join('. ').replace(/^0/, '')}
                            </span>
                          )}
                          {clash && <span className="text-[11px] font-semibold text-[var(--danger,#b3261e)]">⚠ {clash}</span>}
                        </div>
                      );
                    })()}
                  </td>
                  {isOwner && (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setConfirmArchive(t)}
                        className="text-xs font-medium text-[var(--danger,#b3261e)] hover:underline"
                      >
                        Arhiviraj
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {active.length === 0 && (
                <tr className="border-t border-[var(--line,#ccd6d4)]">
                  <td colSpan={8} className="px-3 py-3 text-sm text-[var(--muted,#6f7c79)]">
                    V ekipi še ni nikogar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-[var(--muted,#6f7c79)]">
          Uporabniški račun poveže osebo z njeno prijavo iz zavihka Uporabniki (ni obvezno) — kasneje za njen urnik, Google koledar in
          podpis zapisov.
        </p>

        {message && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka: {message}</p>}

        {isOwner && <AddTherapistForm therapists={therapists} onCreate={createTherapist} />}

        {archived.length > 0 && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowArchived((s) => !s)}
              className="self-start text-xs font-medium text-[var(--accent,#2e6e62)] hover:underline"
            >
              {showArchived ? '▾' : '▸'} Arhivirani ({archived.length})
            </button>
            {showArchived && (
              <ul className="flex flex-col gap-1 text-sm">
                {archived.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 text-[var(--ink-soft,#45524f)]">
                    <span className="h-3 w-3 rounded-full opacity-50" style={{ backgroundColor: t.color }} />
                    <span>
                      {t.name} · {THERAPIST_KIND_LABELS[t.kind]}
                    </span>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={async () => {
                          const r = await setArchived(t.id, false);
                          setMessage(r.error ?? null);
                        }}
                        className="text-xs font-medium text-[var(--accent,#2e6e62)] hover:underline"
                      >
                        Obnovi
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Ordinacije</h3>
          <p className="mt-1 text-sm text-[var(--ink-soft,#45524f)]">
            Prostori oziroma stoli v vaši ambulanti (npr. Ordinacija 1, Ordinacija 2). Članu ekipe lahko zgoraj določite, kje
            običajno dela. Rezervacija ordinacije pri terminu pride kasneje.
          </p>
        </div>
        {roomsError && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {roomsError}</p>}
        <ul className="flex max-w-md flex-col gap-2">
          {activeRooms.map((r) => (
            <li key={r.id} className="flex items-center gap-3">
              {isOwner ? (
                <TextCell
                  value={r.name}
                  required
                  maxLength={60}
                  onCommit={async (name) => {
                    const res = await renameRoom(r.id, name);
                    setMessage(res.error ?? null);
                  }}
                />
              ) : (
                <span className="text-sm">{r.name}</span>
              )}
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setConfirmArchiveRoom(r)}
                  className="text-xs font-medium text-[var(--danger,#b3261e)] hover:underline"
                >
                  Arhiviraj
                </button>
              )}
            </li>
          ))}
          {activeRooms.length === 0 && <li className="text-sm text-[var(--muted,#6f7c79)]">Ni dodanih ordinacij.</li>}
        </ul>
        {isOwner && <AddRoomForm onCreate={createRoom} />}
        {archivedRooms.length > 0 && (
          <p className="text-xs text-[var(--muted,#6f7c79)]">
            Arhivirane:{' '}
            {archivedRooms.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ', '}
                {r.name}
                {isOwner && (
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await setRoomArchived(r.id, false);
                      setMessage(res.error ?? null);
                    }}
                    className="ml-1 font-medium text-[var(--accent,#2e6e62)] hover:underline"
                  >
                    (obnovi)
                  </button>
                )}
              </span>
            ))}
          </p>
        )}
      </section>

      {confirmArchive && (
        <ConfirmDialog
          confirmLabel="Arhiviraj"
          onCancel={() => setConfirmArchive(null)}
          onConfirm={async () => {
            const t = confirmArchive;
            setConfirmArchive(null);
            const r = await setArchived(t.id, true);
            setMessage(r.error ?? null);
          }}
        >
          Ali res želite arhivirati <strong>{confirmArchive.name}</strong>? Iz koledarja izgine stolpec, obstoječi termini in pacienti
          ostanejo. Osebo lahko kadarkoli obnovite.
        </ConfirmDialog>
      )}
      {hoursFor && (
        <WorkingHoursDialog
          therapist={hoursFor}
          schedule={workingHours.schedules.get(hoursFor.id)}
          api={workingHours}
          isOwner={isOwner}
          roommates={roommatesOf(therapists.find((t) => t.id === hoursFor.id) ?? hoursFor)}
          roomName={(() => {
            const roomId = (therapists.find((t) => t.id === hoursFor.id) ?? hoursFor).roomId;
            return roomId ? (roomName.get(roomId) ?? null) : null;
          })()}
          onClose={() => setHoursFor(null)}
        />
      )}
      {confirmArchiveRoom && (
        <ConfirmDialog
          confirmLabel="Arhiviraj"
          onCancel={() => setConfirmArchiveRoom(null)}
          onConfirm={async () => {
            const r = confirmArchiveRoom;
            setConfirmArchiveRoom(null);
            const res = await setRoomArchived(r.id, true);
            setMessage(res.error ?? null);
          }}
        >
          Ali res želite arhivirati ordinacijo <strong>{confirmArchiveRoom.name}</strong>?
        </ConfirmDialog>
      )}
    </div>
  );
}

function AddTherapistForm({
  therapists,
  onCreate,
}: {
  therapists: Therapist[];
  onCreate: (fields: TherapistFields & { name: string }) => Promise<{ id: string } | { error: string }>;
}) {
  const firstFreeColor = () => THERAPIST_COLORS.find((c) => !therapists.some((t) => !t.archived && t.color === c)) ?? THERAPIST_COLORS[0];
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TherapistKind>('dentist');
  const [color, setColor] = useState(firstFreeColor);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Vnesite ime in priimek.');
      return;
    }
    setSaving(true);
    setError(null);
    const sortOrder = therapists.reduce((max, t) => Math.max(max, t.sortOrder), 0) + 1;
    const result = await onCreate({ name, title, kind, color, sortOrder });
    setSaving(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setName('');
    setTitle('');
    setKind('dentist');
    setColor(THERAPIST_COLORS.find((c) => c !== color && !therapists.some((t) => !t.archived && t.color === c)) ?? THERAPIST_COLORS[0]);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border border-[var(--line,#ccd6d4)] p-4">
      <h4 className="text-sm font-bold text-[var(--ink,#1c2624)]">Dodaj člana ekipe</h4>
      <div className="grid items-end gap-3 sm:grid-cols-[auto_1fr_160px_180px_auto]">
        <div className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
          Barva
          <div className="flex h-[34px] items-center">
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
          Ime in priimek
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
          Naziv
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="npr. dr. dent. med." className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
          Vloga
          <select value={kind} onChange={(e) => setKind(e.target.value as TherapistKind)} className={INPUT_CLASS}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {THERAPIST_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {saving ? 'Shranjujem …' : 'Dodaj'}
        </button>
      </div>
      {error && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka: {error}</p>}
    </form>
  );
}

function AddRoomForm({ onCreate }: { onCreate: (name: string) => Promise<{ error?: string }> }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const result = await onCreate(name);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setName('');
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-1">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="npr. Ordinacija 1"
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          className="flex-none rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-sm font-medium text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]"
        >
          Dodaj ordinacijo
        </button>
      </div>
      {error && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka: {error}</p>}
    </form>
  );
}
