import { useState } from 'react';
import type { VoiceLogEntry } from '../../hooks/useVoiceChartEntry';
import type { VoiceAlias } from '../../hooks/useVoiceAliases';
import { ALIAS_MEANINGS, guessAliasMeaning } from '../../lib/voice/parseVoiceCommand';

// Floating panel for voice entry on the patient chart (bottom right, over the
// page, so the layout never shifts): listening state, what is being heard,
// what was applied, undo, and a short list of what can be said.

interface VoicePanelProps {
  listening: boolean;
  interim: string;
  error: string | null;
  log: VoiceLogEntry[];
  canUndo: boolean;
  onStart: () => void;
  onStop: () => void;
  onUndo: () => void;
  onClose: () => void;
  /** The practice's taught words. */
  aliases: VoiceAlias[];
  /** Teach "heard" = meaning, then run the phrase again. */
  onTeach: (heard: string, meaning: string, phrase: string) => Promise<string | null>;
  onForget: (id: string) => void;
}

/** Inline form: what does this misheard word mean? */
function TeachForm({ word, phrase, onTeach, onDone }: { word: string; phrase: string; onTeach: VoicePanelProps['onTeach']; onDone: () => void }) {
  const [heard, setHeard] = useState(word.toLowerCase());
  // Preselect the most similar word ("miz" → mezialno); staff can change it.
  const [meaning, setMeaning] = useState(() => guessAliasMeaning(word) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-1 flex flex-col gap-1.5 rounded border border-[#e6c34a] bg-[#fffaf0] p-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span>»</span>
        <input
          value={heard}
          onChange={(e) => setHeard(e.target.value)}
          title="Lahko dodate tudi sosednjo besedo, npr. »kar je«"
          className="w-28 rounded border border-[var(--line,#ccd6d4)] px-1.5 py-0.5"
        />
        <span>« pomeni:</span>
        <select value={meaning} onChange={(e) => setMeaning(e.target.value)} className="rounded border border-[var(--line,#ccd6d4)] px-1 py-0.5">
          <option value="">— izberite —</option>
          {ALIAS_MEANINGS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.words.map((w) => (
                <option key={w} value={w}>
                  {w === 'prezri' ? 'prezri (šum)' : w}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!meaning || !heard.trim() || busy}
          onClick={async () => {
            setBusy(true);
            const err = await onTeach(heard, meaning, phrase);
            setBusy(false);
            if (err) setError(err);
            else onDone();
          }}
          className="rounded bg-[var(--accent,#2e6e62)] px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Shranjujem …' : 'Shrani in uporabi'}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-[var(--muted,#6f7c79)] hover:underline">
          Prekliči
        </button>
        {error && <span className="text-xs text-[var(--danger,#b3261e)]">{error}</span>}
      </div>
    </div>
  );
}

const EXAMPLES: [string, string][] = [
  ['36 karies mezialno okluzalno', 'ali »36 karies MO«'],
  ['17 krona · 46 manjka · 18 za ekstrakcijo · 23 obraba', ''],
  ['14 in 12 krona', 'več zob hkrati'],
  ['most od 14 do 12', 'konca sta sidri (če še nista, postaneta krona), vmes člen'],
  ['24 endo opravljeno · 25 kanal potreben', 'endo: potrebno / opravljeno / obstoječe'],
  ['25 zatiček · 36 plomba obstoječa distalno', ''],
  ['16 bukalno 3 2 4 krvavitev', 'globine žepkov; »krvavitev mezialno« za eno točko'],
  ['3 2 3', 'naslednji zob, ista stran (manjkajoči se preskočijo)'],
  ['16 lingvalno 2 2 3 · 16 recesija 2 1 2', ''],
  ['47 opomba občutljiv na mraz', 'doda opombo k zobu'],
  ['razveljavi · konec / izklopi mikrofon', 'prekliče zadnje / izklopi mikrofon'],
];

export function VoicePanel({
  listening,
  interim,
  error,
  log,
  canUndo,
  onStart,
  onStop,
  onUndo,
  onClose,
  aliases,
  onTeach,
  onForget,
}: VoicePanelProps) {
  const [showHelp, setShowHelp] = useState(false);
  // The misheard word being taught: entry id + word.
  const [teaching, setTeaching] = useState<{ entryId: number; word: string } | null>(null);
  const recent = [...log].reverse().slice(0, 8);

  return (
    <div className="fixed bottom-4 right-4 z-40 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border border-[var(--line,#ccd6d4)] bg-white p-3 text-sm shadow-xl">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${listening ? 'animate-pulse bg-[#d32f2f]' : 'bg-[#b0b8b6]'}`} aria-hidden />
        <strong className="flex-1 text-[var(--ink,#1c2624)]">{listening ? 'Poslušam …' : 'Glasovni vnos izklopljen'}</strong>
        <button
          type="button"
          disabled={!canUndo}
          onClick={onUndo}
          className="rounded border border-[var(--line,#ccd6d4)] px-2 py-0.5 text-xs hover:bg-[#f1f4f3] disabled:opacity-40"
        >
          Razveljavi
        </button>
        {listening ? (
          <button type="button" onClick={onStop} className="rounded bg-[#d32f2f] px-2 py-0.5 text-xs font-semibold text-white hover:opacity-90">
            Izklopi
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            className="rounded bg-[var(--accent,#2e6e62)] px-2 py-0.5 text-xs font-semibold text-white hover:opacity-90"
          >
            Vklopi
          </button>
        )}
        {!listening && (
          <button type="button" onClick={onClose} aria-label="Zapri" className="px-1 text-[var(--muted,#6f7c79)] hover:text-[var(--ink,#1c2624)]">
            ×
          </button>
        )}
      </div>

      {error && <p className="text-xs text-[var(--danger,#b3261e)]">{error}</p>}
      {listening && <p className="min-h-[1.25rem] text-xs italic text-[var(--muted,#6f7c79)]">{interim || 'Govorite …'}</p>}

      {recent.length > 0 && (
        <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto border-t border-[var(--line,#ccd6d4)] pt-2">
          {recent.map((e) => (
            <li key={e.id} className={e.undone ? 'opacity-50' : ''}>
              <div className="text-[11px] text-[var(--muted,#6f7c79)]">»{e.heard}«</div>
              {e.applied.map((a, i) => (
                <div key={i} className={`text-xs ${e.undone ? 'line-through' : 'text-[#1f6b4f]'}`}>
                  ✓ {a}
                </div>
              ))}
              {e.unknown.length > 0 && <div className="text-xs text-[#8a5a00]">Ni razumljeno: {e.unknown.join(', ')}</div>}
              {e.unknownWords.length > 0 && !e.undone && (
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-[var(--muted,#6f7c79)]">
                  Nauči:
                  {e.unknownWords.map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setTeaching({ entryId: e.id, word: w })}
                      className="rounded border border-dashed border-[#c9a227] px-1.5 text-[#8a5a00] hover:bg-[#fff6e5]"
                    >
                      {w}
                    </button>
                  ))}
                </div>
              )}
              {teaching?.entryId === e.id && (
                <TeachForm key={teaching.word} word={teaching.word} phrase={e.heard} onTeach={onTeach} onDone={() => setTeaching(null)} />
              )}
              {e.undone && <div className="text-[11px] text-[var(--muted,#6f7c79)]">razveljavljeno</div>}
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => setShowHelp((v) => !v)} className="self-start text-xs text-[var(--accent,#2e6e62)] hover:underline">
        {showHelp ? 'Skrij primere' : 'Kaj lahko rečem?'}
      </button>
      {showHelp && aliases.length > 0 && (
        <div className="flex flex-col gap-1 rounded border border-[var(--line,#ccd6d4)] p-2 text-xs">
          <span className="font-semibold text-[var(--ink,#1c2624)]">Naučene besede ({aliases.length})</span>
          <div className="flex flex-wrap gap-1.5">
            {aliases.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-[#eef2f1] px-2 py-0.5">
                »{a.heard}« → {a.meaning}
                <button
                  type="button"
                  onClick={() => onForget(a.id)}
                  aria-label={`Pozabi ${a.heard}`}
                  className="text-[var(--muted,#6f7c79)] hover:text-[var(--danger,#b3261e)]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      {showHelp && (
        <div className="flex flex-col gap-1 rounded bg-[#f7faf9] p-2 text-xs">
          {EXAMPLES.map(([say, hint]) => (
            <div key={say}>
              <span className="font-semibold text-[var(--ink,#1c2624)]">{say}</span>
              {hint && <span className="text-[var(--muted,#6f7c79)]"> — {hint}</span>}
            </div>
          ))}
          <p className="mt-1 text-[11px] text-[var(--ink-soft,#45524f)]">
            Nasvet: začnite z besedo <strong>»zob«</strong> (»zob 36 karies MO«) — če brskalnik odreže začetek stavka, izgubi »zob«,
            ne številke.
          </p>
          <p className="text-[11px] text-[var(--muted,#6f7c79)]">
            Najprej zob, nato izvid; več zob v enem stavku je v redu. Govor prepozna brskalnik (Chrome ga pošlje Googlu) — imena
            pacienta ne izgovarjajte.
          </p>
        </div>
      )}
    </div>
  );
}
