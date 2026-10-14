import { useState, type FormEvent } from 'react';
import { usePracticeUsers, type PracticeRole, type PracticeUser } from '../../hooks/usePracticeUsers';
import { ConfirmDialog } from '../ui/ConfirmDialog';

// Nastavitve → Uporabniki (migration 036): who can sign in to this practice.
// Everyone sees the list; only an owner can invite, re-send an invitation,
// change a role or remove someone (Gregor's choice: staff can do everything
// else in the app). The last owner can't be removed or demoted.

const ROLE_LABELS: Record<PracticeRole, string> = { owner: 'Lastnik', staff: 'Sodelavec' };
const INPUT_CLASS = 'rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)]';

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('sl-SI') : '—';
}

export function PracticeUsersSection() {
  const { users, callerId, callerRole, loading, error, invite, resend, setRole, remove } = usePracticeUsers();
  const isOwner = callerRole === 'owner';
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<PracticeRole>('staff');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<PracticeUser | null>(null);

  async function run(key: string, action: () => Promise<{ error?: string }>, okText: string) {
    setBusy(key);
    setMessage(null);
    const result = await action();
    setBusy(null);
    setMessage(result.error ? { kind: 'error', text: result.error } : { kind: 'ok', text: okText });
    return !result.error;
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    const ok = await run('invite', () => invite(address, fullName.trim(), inviteRole), `Vabilo je poslano na ${address}.`);
    if (ok) {
      setEmail('');
      setFullName('');
      setInviteRole('staff');
    }
  }

  if (loading) return <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje …</p>;
  if (error) return <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-[var(--ink-soft,#45524f)]">
        Osebe, ki se lahko prijavijo v vašo ordinacijo. Vsi uporabniki vidijo in urejajo paciente, kartoteke, koledar in račune;
        {isOwner ? ' kot lastnik lahko uporabnike dodajate, odstranjujete in jim spreminjate vlogo.' : ' uporabnike upravlja lastnik ordinacije.'}
      </p>

      <div className="overflow-x-auto rounded border border-[var(--line,#ccd6d4)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f7faf9] text-xs uppercase text-[var(--ink-soft,#45524f)]">
            <tr>
              <th className="px-3 py-2 font-semibold">Ime</th>
              <th className="px-3 py-2 font-semibold">E-pošta</th>
              <th className="px-3 py-2 font-semibold">Vloga</th>
              <th className="px-3 py-2 font-semibold">Zadnja prijava</th>
              {isOwner && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMe = u.userId === callerId;
              return (
                <tr key={u.userId} className="border-t border-[var(--line,#ccd6d4)]">
                  <td className="px-3 py-2">
                    {u.fullName || '—'}
                    {isMe && <span className="ml-1.5 text-xs text-[var(--muted,#6f7c79)]">(vi)</span>}
                  </td>
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">
                    {isOwner && !isMe ? (
                      <select
                        value={u.role}
                        disabled={busy !== null}
                        onChange={(e) =>
                          run(`role-${u.userId}`, () => setRole(u.userId, e.target.value as PracticeRole), 'Vloga je spremenjena.')
                        }
                        className="rounded border border-[var(--line,#ccd6d4)] px-2 py-1 text-sm"
                      >
                        <option value="staff">{ROLE_LABELS.staff}</option>
                        <option value="owner">{ROLE_LABELS.owner}</option>
                      </select>
                    ) : (
                      ROLE_LABELS[u.role]
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {u.pending ? (
                      <span className="rounded-full bg-[#fff6e5] px-2 py-0.5 text-xs font-semibold text-[#6b4a00]">Vabilo poslano</span>
                    ) : (
                      formatDate(u.lastSignInAt)
                    )}
                  </td>
                  {isOwner && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {u.pending && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => run(`resend-${u.userId}`, () => resend(u.userId), `Vabilo je znova poslano na ${u.email}.`)}
                          className="mr-3 text-xs font-medium text-[var(--accent,#2e6e62)] hover:underline disabled:opacity-50"
                        >
                          {busy === `resend-${u.userId}` ? 'Pošiljam …' : 'Pošlji znova'}
                        </button>
                      )}
                      {!isMe && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => setConfirmRemove(u)}
                          className="text-xs font-medium text-[var(--danger,#b3261e)] hover:underline disabled:opacity-50"
                        >
                          Odstrani
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {message && (
        <p className={`text-sm ${message.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--accent,#2e6e62)]'}`}>{message.text}</p>
      )}

      {isOwner && (
        <form onSubmit={handleInvite} className="flex flex-col gap-3 rounded border border-[var(--line,#ccd6d4)] p-4">
          <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Povabi uporabnika</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_160px]">
            <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
              Ime in priimek
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} className={INPUT_CLASS} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
              E-pošta
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT_CLASS} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
              Vloga
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as PracticeRole)} className={INPUT_CLASS}>
                <option value="staff">{ROLE_LABELS.staff}</option>
                <option value="owner">{ROLE_LABELS.owner}</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy !== null}
              className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy === 'invite' ? 'Pošiljam …' : 'Pošlji vabilo'}
            </button>
            <span className="text-xs text-[var(--muted,#6f7c79)]">
              Oseba prejme e-pošto s povezavo (velja 24 ur), s katero si nastavi geslo. Lastnik lahko tudi upravlja uporabnike.
            </span>
          </div>
        </form>
      )}

      {confirmRemove && (
        <ConfirmDialog
          confirmLabel="Odstrani"
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => {
            const u = confirmRemove;
            setConfirmRemove(null);
            run(`remove-${u.userId}`, () => remove(u.userId), `${u.fullName || u.email} ne more več dostopati do ordinacije.`);
          }}
        >
          Ali res želite odstraniti uporabnika <strong>{confirmRemove.fullName || confirmRemove.email}</strong>? Prijava v vašo ordinacijo
          mu bo takoj onemogočena. Zapisi, ki jih je ustvaril, ostanejo.
        </ConfirmDialog>
      )}
    </div>
  );
}
