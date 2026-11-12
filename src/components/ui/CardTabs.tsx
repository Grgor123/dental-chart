import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// A row of folder-style tabs sitting on top of a card — the look Gregor
// approved on the E-pošta page (extracted from there so Nastavitve reuses the
// exact same one): the selected tab is raised above the card's top border so
// the two read as one piece, with small concave fillets where its sides meet
// the card's top line. The first tab sits flush with the card's left edge, so
// its left line continues straight down into the card's — the caller squares
// off the card's top-left corner when `squareTopLeft` is true.
//
// More tabs than fit on one line (E-pošta's eleven emails) wrap onto several
// rows, and then — like Windows' multi-row tab dialogs — the row holding the
// selected tab is always the one drawn against the card; the other rows stack
// above it in their usual order (Gregor, 2026-11-12: a second row floating
// above the card read as detached). Which tab lands on which row is measured
// from an invisible copy laid out in the natural order, so the rows don't
// change as tabs move around — only their order does.
//
// The card itself stays the caller's: it's handed `squareTopLeft` and renders
// its own markup, so this component doesn't dictate padding, gaps or content.
export interface CardTab {
  key: string;
  label: string;
  /** Small marker(s) after the label — e.g. a "customized" dot. */
  badge?: ReactNode;
}

interface CardTabsProps {
  tabs: CardTab[];
  selectedKey: string;
  onSelect: (key: string) => void;
  children: (state: { squareTopLeft: boolean }) => ReactNode;
}

const TAB_LINE = 'var(--line,#ccd6d4)';
const TAB_SURFACE = 'var(--surface,#fff)';
const FILLET_SIZE = 9;

// A 9x9 corner piece beside the selected tab, bottom-aligned with the card's
// top line: white in the corner next to the tab, a 1px arc in the line colour,
// transparent beyond it. `right` sits just outside the tab's right edge, `left`
// just outside its left edge (mirrored). It also covers the tab's own 1px side
// border along those bottom 9px, so the tab's outline doesn't run on past
// where the curve begins.
function filletStyle(side: 'left' | 'right'): CSSProperties {
  const arcCenter = side === 'right' ? '100% 0' : '0 0';
  return {
    position: 'absolute',
    bottom: -1,
    [side === 'right' ? 'left' : 'right']: '100%',
    width: FILLET_SIZE,
    height: FILLET_SIZE,
    pointerEvents: 'none',
    background: `radial-gradient(circle at ${arcCenter}, transparent ${FILLET_SIZE - 1}px, ${TAB_LINE} ${FILLET_SIZE - 1}px, ${TAB_LINE} ${FILLET_SIZE}px, ${TAB_SURFACE} ${FILLET_SIZE}px)`,
  };
}

/** Groups tab indexes into rows by the vertical position each tab gets in
 *  the natural, wrapped layout. */
function measureRows(container: HTMLElement): number[][] {
  const rows: { top: number; indexes: number[] }[] = [];
  Array.from(container.children).forEach((child, index) => {
    const top = (child as HTMLElement).offsetTop;
    const row = rows.find((r) => Math.abs(r.top - top) < 4);
    if (row) row.indexes.push(index);
    else rows.push({ top, indexes: [index] });
  });
  return rows.sort((x, y) => x.top - y.top).map((r) => r.indexes);
}

function sameRows(a: number[][], b: number[][]): boolean {
  return a.length === b.length && a.every((row, i) => row.length === b[i].length && row.every((v, j) => v === b[i][j]));
}

const TAB_CLASS = 'flex items-center gap-2 rounded-t-md border px-3.5 py-2 text-sm font-medium';

export function CardTabs({ tabs, selectedKey, onSelect, children }: CardTabsProps) {
  const selectedIndex = tabs.findIndex((tab) => tab.key === selectedKey);
  const measureRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<number[][]>(() => [tabs.map((_, i) => i)]);

  useLayoutEffect(() => {
    const container = measureRef.current;
    if (!container) return;
    const update = () => {
      const next = measureRows(container);
      setRows((current) => (sameRows(current, next) ? current : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }); // every render: a badge appearing can move a tab to another row; sameRows() stops loops

  // Rows from the measurement, the selected tab's row moved to the bottom.
  const validRows = rows.flat().length === tabs.length ? rows : [tabs.map((_, i) => i)];
  const selectedRow = validRows.findIndex((row) => row.includes(selectedIndex));
  const orderedRows =
    selectedRow < 0 ? validRows : [...validRows.filter((_, i) => i !== selectedRow), validRows[selectedRow]];
  const bottomRow = orderedRows[orderedRows.length - 1] ?? [];

  return (
    <div className="flex flex-col">
      <div className="relative">
        {/* Invisible copy in the natural order — only used to measure rows.
            Badges included, since they change a tab's width. */}
        <div
          ref={measureRef}
          aria-hidden
          className="pointer-events-none invisible absolute inset-x-0 top-0 flex flex-wrap gap-1"
        >
          {tabs.map((tab) => (
            <span key={tab.key} className={`${TAB_CLASS} border-transparent`}>
              {tab.label}
              {tab.badge}
            </span>
          ))}
        </div>
        <div role="tablist" className="-mb-px flex flex-col gap-1">
          {orderedRows.map((row) => (
            <div key={row[0]} className="flex gap-1">
              {row.map((index) => {
                const tab = tabs[index];
                const isSelected = index === selectedIndex;
                // No left fillet on a row's first tab — its left line runs
                // straight down into the card's.
                const showLeftFillet = isSelected && row.indexOf(index) > 0;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => onSelect(tab.key)}
                    className={`${TAB_CLASS} ${
                      isSelected
                        ? 'relative z-10 border-[var(--line,#ccd6d4)] border-b-[var(--surface,#fff)] bg-[var(--surface,#fff)] text-[var(--ink,#1c2624)]'
                        : 'border-transparent text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]'
                    }`}
                  >
                    {tab.label}
                    {tab.badge}
                    {isSelected && <span aria-hidden style={filletStyle('right')} />}
                    {showLeftFillet && <span aria-hidden style={filletStyle('left')} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {children({ squareTopLeft: bottomRow[0] === selectedIndex })}
    </div>
  );
}
