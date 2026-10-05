import type { CSSProperties, ReactNode } from 'react';

// A row of folder-style tabs sitting on top of a card — the look Gregor
// approved on the E-pošta page (extracted from there so Nastavitve reuses the
// exact same one): the selected tab is raised above the card's top border so
// the two read as one piece, with small concave fillets where its sides meet
// the card's top line. The first tab sits flush with the card's left edge, so
// its left line continues straight down into the card's — the caller squares
// off the card's top-left corner when `squareTopLeft` is true.
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

export function CardTabs({ tabs, selectedKey, onSelect, children }: CardTabsProps) {
  const selectedIndex = tabs.findIndex((tab) => tab.key === selectedKey);
  return (
    <div className="flex flex-col">
      <div role="tablist" className="-mb-px flex flex-wrap gap-1">
        {tabs.map((tab, index) => {
          const isSelected = tab.key === selectedKey;
          // No left fillet on the first tab — its left line runs straight
          // down into the card's.
          const showLeftFillet = isSelected && index > 0;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onSelect(tab.key)}
              className={`flex items-center gap-2 rounded-t-md border px-3.5 py-2 text-sm font-medium ${
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
      {children({ squareTopLeft: selectedIndex === 0 })}
    </div>
  );
}
