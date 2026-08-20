import { useState } from 'react';
import { DentalChart } from '../components/chart/DentalChart';

interface PatientChartProps {
  onSignOut: () => void;
}

// Placeholder page for visual QA while the app is still running on mock
// data (patient identity and the full click-to-edit detail panel come
// later) — this proves the chart renders behind a real login and the
// per-tooth click event reaches the page.
export function PatientChart({ onSignOut }: PatientChartProps) {
  const [selectedFdi, setSelectedFdi] = useState<string | undefined>();

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink,#1c2624)]">Zobna karta — testni pacient</h1>
          <p className="mt-1.5 text-sm text-[var(--ink-soft,#45524f)]">
            Kliknite na zob za izbiro. {selectedFdi ? `Izbran zob: ${selectedFdi}` : 'Noben zob ni izbran.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-sm text-[var(--ink-soft,#45524f)]"
        >
          Odjava
        </button>
      </div>
      <DentalChart onSelect={setSelectedFdi} selectedFdi={selectedFdi} />
    </div>
  );
}
