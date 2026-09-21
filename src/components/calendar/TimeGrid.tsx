import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import type { AppointmentWithPatient } from '../../hooks/useAppointments';
import { layoutOverlappingEvents } from '../../lib/calendarLayout';
import { AppointmentChip } from './AppointmentChip';

// Full 24-hour range, Google-Calendar-style — the grid used to stop at
// business hours (07-20) with no scroll, but Gregor asked for every hour
// to be reachable via vertical scroll instead, inside a frame whose own
// dimensions stay fixed across Day/Week/Month (see Calendar.tsx, which
// gives this component a fixed-height flex ancestor via h-screen).
export const GRID_START_HOUR = 0;
export const GRID_END_HOUR = 24;
const HOUR_HEIGHT = 56; // px per hour — tall enough to fit a 15-min chip's own two lines of text
// Where the grid's scroll position opens by default — the old business-hours
// window, now that 00-24 all exist but midnight isn't a useful starting
// scroll position, same as Google Calendar's own default scroll-into-view.
const DEFAULT_SCROLL_HOUR = 7;

export interface TimeGridColumn {
  key: string;
  /** Plain therapist name for Day view; Week view passes a richer node
      (weekday + circled date number, matching the mockup's "today"
      highlight) — see Calendar.tsx's weekColumns construction. */
  label: ReactNode;
  dateIso: string;
  events: AppointmentWithPatient[];
  /** Day view: the therapist's own color, shown as a header dot and used
      as every chip's color in that column. Week view leaves this unset —
      colors there come from `resolveEventColor` (per-appointment therapist
      lookup) instead, since a Week column is a day, not a resource. */
  accentColor?: string;
}

interface TimeGridProps {
  columns: TimeGridColumn[];
  /** Week view only — resolves each chip's color from its own
      appointment's therapistId, since the column itself (a day) carries no
      single color. Day view omits this; TimeGrid falls back to the
      column's own accentColor. */
  resolveEventColor?: (appointment: AppointmentWithPatient) => string | undefined;
  onSlotClick: (columnKey: string, dateIso: string, timeHHmm: string) => void;
  onEventClick: (appointment: AppointmentWithPatient) => void;
  /** Called instead of onSlotClick when the clicked slot's own date/time
      has already passed — Calendar.tsx uses this to flash a notice rather
      than opening the create modal at all, since a past appointment can
      never actually be saved (see AppointmentModal's own handleSubmit
      guard). */
  onPastSlotClick?: () => void;
}

function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

// Local-getter formatting, not `.toISOString().slice(0, 10)` — the latter
// round-trips through UTC and would misreport "today" during the local
// 00:00-02:00 window in Slovenia's UTC+1/+2 timezone. Same fix applied to
// Calendar.tsx's own date helpers, which had a worse (always-wrong, not
// just near-midnight) form of this same bug.
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowOffsetPx(): number {
  const now = new Date();
  return ((now.getHours() * 60 + now.getMinutes() - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT;
}

// Renders both the (sticky) header row and the scrollable hour body inside
// one shared `overflow-auto` ancestor — `position: sticky` pins the header
// to the top of that scroll container on the vertical axis while still
// panning with it horizontally, so the two rows can never drift out of
// alignment the way two independently-scrolled containers would.
export function TimeGrid({ columns, resolveEventColor, onSlotClick, onEventClick, onPastSlotClick }: TimeGridProps) {
  const hours: number[] = [];
  for (let h = GRID_START_HOUR; h < GRID_END_HOUR; h++) hours.push(h);
  const gridHeight = (GRID_END_HOUR - GRID_START_HOUR) * HOUR_HEIGHT;
  const today = todayIso();
  const nowY = nowOffsetPx();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rangeKey = columns.map((c) => c.dateIso).join(',');

  // Opens scrolled to business hours rather than midnight — only on
  // mount/when the visible date range actually changes (Day/Week
  // navigation), not on every re-render (appointment edits, etc.), so it
  // never fights a scroll position the user has already set by hand.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: DEFAULT_SCROLL_HOUR * HOUR_HEIGHT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  function handleColumnClick(e: MouseEvent<HTMLDivElement>, column: TimeGridColumn) {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const rawMinutes = GRID_START_HOUR * 60 + (offsetY / HOUR_HEIGHT) * 60;
    const snapped = Math.min(Math.max(Math.round(rawMinutes / 15) * 15, GRID_START_HOUR * 60), GRID_END_HOUR * 60 - 15);
    const hh = String(Math.floor(snapped / 60)).padStart(2, '0');
    const mm = String(snapped % 60).padStart(2, '0');
    const slotStart = new Date(`${column.dateIso}T${hh}:${mm}:00`);
    if (slotStart.getTime() < Date.now()) {
      onPastSlotClick?.();
      return;
    }
    onSlotClick(column.key, column.dateIso, `${hh}:${mm}`);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)]">
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div className="flex min-w-fit flex-col">
          <div className="sticky top-0 z-20 flex flex-none bg-[var(--surface,#fff)]">
            <div
              className="flex h-14 flex-none items-center justify-center border-b border-[var(--line,#ccd6d4)]"
              style={{ width: 52 }}
            >
              <span className="text-[9px] text-[var(--muted,#6f7c79)]">GMT+02</span>
            </div>
            {columns.map((column) => (
              <div
                key={column.key}
                className="flex h-14 min-w-[150px] flex-1 items-center justify-center gap-1.5 border-b border-l border-[var(--line,#ccd6d4)] px-2"
              >
                {column.accentColor && (
                  <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: column.accentColor }} />
                )}
                {typeof column.label === 'string' ? (
                  <span className="truncate text-xs font-semibold text-[var(--ink,#1c2624)]">{column.label}</span>
                ) : (
                  column.label
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-none">
            <div className="flex-none" style={{ width: 52 }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="border-b border-[var(--line,#eef2f1)] pr-1.5 text-right text-[11px] text-[var(--muted,#6f7c79)]"
                  style={{ height: HOUR_HEIGHT }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {columns.map((column) => {
              const laidOut = layoutOverlappingEvents(
                column.events.map((a) => ({ id: a.id, startMinutes: minutesOfDay(a.startsAt), endMinutes: minutesOfDay(a.endsAt) }))
              );
              // How much of this column is already in the past — the
              // whole column for an earlier day, everything above the
              // "now" line for today, nothing for a future day. Purely a
              // visual cue (a faint tint); handleColumnClick's own
              // Date.now() check is what actually blocks the click,
              // matching Gregor's explicit request for both together.
              const pastBoundaryY =
                column.dateIso < today ? gridHeight : column.dateIso === today ? Math.min(Math.max(nowY, 0), gridHeight) : 0;
              return (
                <div
                  key={column.key}
                  className="relative min-w-[150px] flex-1 cursor-pointer border-l border-[var(--line,#ccd6d4)]"
                  style={{ height: gridHeight }}
                  onClick={(e) => handleColumnClick(e, column)}
                >
                  {pastBoundaryY > 0 && (
                    <div
                      className="pointer-events-none absolute left-0 right-0 top-0 bg-[rgba(28,38,36,0.04)]"
                      style={{ height: pastBoundaryY }}
                    />
                  )}
                  {hours.map((h, i) => (
                    <div
                      key={h}
                      className="pointer-events-none absolute left-0 right-0 border-b border-[var(--line,#eef2f1)]"
                      style={{ top: i * HOUR_HEIGHT }}
                    />
                  ))}
                  {column.dateIso === today && nowY >= 0 && nowY <= gridHeight && (
                    <div className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: nowY }}>
                      <div
                        className="absolute h-2.5 w-2.5 rounded-full bg-[var(--danger,#b3261e)]"
                        style={{ left: -5, top: -4.5 }}
                      />
                      <div className="border-t-2 border-[var(--danger,#b3261e)]" />
                    </div>
                  )}
                  {column.events.map((appt) => {
                    const layout = laidOut.find((l) => l.id === appt.id);
                    const startM = Math.max(minutesOfDay(appt.startsAt), GRID_START_HOUR * 60);
                    const endM = Math.max(minutesOfDay(appt.endsAt), startM + 15);
                    const top = ((startM - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT;
                    const height = ((endM - startM) / 60) * HOUR_HEIGHT;
                    const columnCount = layout?.columnCount ?? 1;
                    const columnIndex = layout?.columnIndex ?? 0;
                    const widthPct = 100 / columnCount;
                    return (
                      <AppointmentChip
                        key={appt.id}
                        appointment={appt}
                        color={resolveEventColor?.(appt) ?? column.accentColor}
                        style={{
                          position: 'absolute',
                          top,
                          height: Math.max(height, 22),
                          left: `${columnIndex * widthPct}%`,
                          width: `calc(${widthPct}% - 2px)`,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(appt);
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
