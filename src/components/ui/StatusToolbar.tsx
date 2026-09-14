import type { ToothStatus, EndoStage } from '../../types/dental';
import { STATUS_STYLES, STATUS_ORDER, ENDO_STAGE_LABELS } from '../../data/statusStyles';
import { StatusSwatch } from './StatusSwatch';
import { PostSwatch } from './PostSwatch';
import { EndoSwatch } from './EndoSwatch';

const ENDO_STAGES: EndoStage[] = ['planned', 'done', 'existing'];

interface StatusToolbarProps {
  /** How many chart targets (surfaces/whole teeth) are currently selected. */
  selectionCount: number;
  onStatusClick: (status: ToothStatus) => void;
  onClearSelection: () => void;
  /**
   * Dental post (zobni zatiček) — a plain per-tooth boolean, not a status,
   * but per Monika's explicit request it's still presented as one single
   * clickable entry in this same grid, exactly like every real status —
   * not a separate multi-button control. One click toggles it: on for
   * every distinct tooth in the current selection if any lack it, off if
   * all of them already have it.
   */
  onTogglePost: () => void;
  /**
   * Endodontic treatment (kanal) — also a plain per-tooth field, not a
   * status (see EndoStage), but presented uniformly here too: three grid
   * entries (planned/done/existing), same icon+label shape as everything
   * else. One click sets that stage for every distinct tooth in the
   * current selection — on if any of them don't already have exactly this
   * stage, cleared if all of them already do (same on/off pattern as
   * onTogglePost, generalized from boolean to stage-equality).
   */
  onSetEndoStage: (stage: EndoStage) => void;
  /**
   * Why the last "Člen mostu" click didn't create a bridge, if it didn't
   * (see handleCreateBridge's own comment in PatientChart.tsx). Rendered
   * as a prominent banner right above the grid — not a small aside up in
   * the page header — since Monika reported "nothing happens" when this
   * used to only show there: easy to miss when your eyes are already on
   * this panel's own "Člen mostu" button, not the page title above the
   * chart.
   */
  bridgeMessage?: string | null;
  /**
   * Overrides the outer panel's own width/flex classes — defaults to the
   * narrow `w-[260px] flex-none` sidebar every real caller (PatientChart.tsx)
   * still uses. `PatientPageMockup.tsx` passes `w-full` instead to lay this
   * same grid out as a wide, short horizontal bar below the chart rather
   * than a tall sidebar beside it — the grid's own `flex-wrap` naturally
   * reflows into fewer, wider rows at that width, which is what actually
   * saves the vertical space that layout needed.
   */
  className?: string;
  /**
   * Drops this panel's own border/background/padding, leaving just the
   * flex-col content — for when it's nested inside another card that
   * already provides those (PatientPageMockup.tsx's frame 7 embeds this
   * whole toolbar as the "Legenda" tab's own content, inside a tabs card
   * that already has its own border/bg/padding — a second nested border
   * there read as a redundant box-in-a-box). Defaults to false so every
   * other caller (PatientChart.tsx) keeps its own standalone bordered
   * panel unchanged.
   */
  bare?: boolean;
  /**
   * Suppresses this panel's own header block entirely — both the
   * idle-state prompt ("Kliknite ploskev ali cel zob…") and the "n
   * izbranih… / Prekliči izbiro" pair shown once something's selected —
   * for PatientPageMockup.tsx's frame 7, which moved both of those up
   * into the tab bar itself (right-aligned, same row as the "Legenda"/
   * "Storitve po zobeh" tab buttons, both on one line) to reclaim
   * vertical space and avoid the page needing a scroll to see the rest of
   * this card. Defaults to false so PatientChart.tsx's own standalone
   * panel is unchanged.
   */
  hideHeader?: boolean;
}

// Always-visible status palette for PatientChart.tsx's direct-click
// selection flow — unlike StatusPicker.tsx (which only ever appears after a
// target is already chosen, inside ToothDetailPanel.tsx), this is mounted
// permanently so it's reachable as soon as a selection exists, without
// having to open a tooth's own detail panel first. Select-then-apply only:
// click surface(s)/whole tooth on the chart (Ctrl/Cmd+click for several),
// then click a status here to apply it to the whole selection at once. An
// earlier version also supported picking a status first and "locking" it to
// paint across clicks — reverted per explicit feedback that the "armed but
// not yet applied" state was too easy to miss, reading as broken rather
// than as a mode waiting to be used.
export function StatusToolbar({
  selectionCount,
  onStatusClick,
  onClearSelection,
  onTogglePost,
  onSetEndoStage,
  bridgeMessage,
  className = 'w-[260px] flex-none',
  bare = false,
  hideHeader = false,
}: StatusToolbarProps) {
  const hasSelection = selectionCount > 0;

  return (
    <div
      className={`flex flex-col gap-2.5 ${bare ? '' : 'rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-3'} ${className}`}
    >
      {bridgeMessage && (
        <p className="rounded border border-[var(--danger,#b3261e)] bg-[var(--danger-bg,#fdecea)] p-2 text-xs text-[var(--danger,#b3261e)]">
          {bridgeMessage}
        </p>
      )}
      {!hideHeader && (
        <div className="flex flex-col gap-1">
          {hasSelection ? (
            <p className="text-xs text-[var(--ink,#1c2624)]">
              <strong>{selectionCount}</strong> {selectionCount === 1 ? 'izbrana ploskev/zob' : 'izbranih'} — kliknite
              status za uporabo.
            </p>
          ) : (
            <p className="text-xs text-[var(--ink-soft,#45524f)]">
              Kliknite ploskev ali cel zob na karti (Ctrl/Cmd za več), nato status spodaj za uporabo.
            </p>
          )}
          {hasSelection && (
            <button
              type="button"
              onClick={onClearSelection}
              className="self-start rounded border border-[var(--line,#ccd6d4)] px-2 py-1 text-xs text-[var(--ink-soft,#45524f)]"
            >
              Prekliči izbiro (Esc)
            </button>
          )}
        </div>
      )}
      {/* Always full-opacity and clickable, whether or not there's a
          selection — per explicit feedback that dimming/disabling the grid
          between edits was distracting during fast, repeated entry (select
          a tooth → apply → select the next one). Clicking with nothing
          selected is a harmless no-op (see handleStatusClick's/
          handleTogglePost's/handleSetEndoStage's own guards in
          PatientChart.tsx) rather than something the UI needs to visibly
          block. Dental post (zobni zatiček) and the three endodontic
          treatment stages render as ordinary entries in this exact same
          grid, same button/icon/label shape as every real status — per
          Monika's explicit request that every service be presented
          uniformly here, not just the ones that happen to be a ToothStatus
          internally (see CLAUDE.md's "Uniform service presentation"
          note). */}
      <div role="group" aria-label="Izberite status" className="flex flex-wrap gap-1.5">
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => onStatusClick(status)}
            className="flex items-center gap-1.5 rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-left text-xs"
          >
            <StatusSwatch status={status} size={18} />
            <span className="text-[var(--ink,#1c2624)]">{STATUS_STYLES[status].label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={onTogglePost}
          className="flex items-center gap-1.5 rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-left text-xs"
        >
          <PostSwatch size={18} />
          <span className="text-[var(--ink,#1c2624)]">Zobni zatiček</span>
        </button>
        {ENDO_STAGES.map((stage) => (
          <button
            key={stage}
            type="button"
            onClick={() => onSetEndoStage(stage)}
            className="flex items-center gap-1.5 rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-left text-xs"
          >
            <EndoSwatch stage={stage} size={18} />
            <span className="text-[var(--ink,#1c2624)]">{ENDO_STAGE_LABELS[stage]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
