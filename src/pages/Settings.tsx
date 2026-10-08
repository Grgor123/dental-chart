import { useState } from 'react';
import { AppNavShell } from '../components/ui/AppNavShell';
import { CardTabs } from '../components/ui/CardTabs';
import { PriceListSection } from '../components/settings/PriceListSection';
import { InvoiceSettingsSection } from '../components/settings/InvoiceSettingsSection';
import { usePracticeContext } from '../contexts/PracticeContext';

interface SettingsProps {
  /** Back to the patient list (AppNavShell's "Domov"/"Storitve"). */
  onBack: () => void;
  onSignOut: () => void;
  onNavigateCalendar: () => void;
  onNavigateEmail: () => void;
  onNavigateInvoices: () => void;
  /** Its own menu item: starts this page afresh. */
  onNavigateSettings: () => void;
  /** Tab to open on (e.g. 'racuni' from the invoice editor's warning). */
  initialSection?: string;
}

// One entry per settings section — the sending domain, webhooks and API keys
// planned in CLAUDE.md will each become another tab here rather than a page
// of their own.
const SECTIONS = [
  { key: 'cenik', label: 'Cenik' },
  { key: 'racuni', label: 'Podatki za račune' },
];

// "Nastavitve" — the practice-wide setup area (the submenu item used to be an
// inert placeholder). See supabase/migrations/020_add_price_list.sql for the
// price list this first section manages.
export function Settings({ onBack, onSignOut, onNavigateCalendar, onNavigateEmail, onNavigateInvoices, onNavigateSettings, initialSection }: SettingsProps) {
  const { practiceName } = usePracticeContext();
  const [section, setSection] = useState(SECTIONS.some((s) => s.key === initialSection) ? initialSection! : SECTIONS[0].key);

  return (
    <>
      <AppNavShell
        userLabel={practiceName ?? undefined}
        onSignOut={onSignOut}
        onNavigateHome={onBack}
        onNavigateStoritve={onBack}
        onNavigateCalendar={onNavigateCalendar}
        onNavigateEmail={onNavigateEmail}
        onNavigateInvoices={onNavigateInvoices}
        onNavigateSettings={onNavigateSettings}
        activeSubmenu="nastavitve"
      />
      <div className="mx-auto flex max-w-[1300px] flex-col gap-5 p-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink,#1c2624)]">Nastavitve</h1>
          <p className="mt-1.5 text-sm text-[var(--ink-soft,#45524f)]">Nastavitve ordinacije.</p>
        </div>

        <CardTabs tabs={SECTIONS} selectedKey={section} onSelect={setSection}>
          {({ squareTopLeft }) => (
            <div
              className={`rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-5 ${squareTopLeft ? 'rounded-tl-none' : ''}`}
            >
              {section === 'cenik' && <PriceListSection />}
              {section === 'racuni' && <InvoiceSettingsSection />}
            </div>
          )}
        </CardTabs>
      </div>
    </>
  );
}
