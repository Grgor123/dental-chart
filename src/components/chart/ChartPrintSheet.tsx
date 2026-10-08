import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { ALL_FDI } from '../../data/toothMeta';
import { DentalChart } from './DentalChart';
import { StatusLegend } from '../ui/StatusLegend';

// The A4 printout of a patient's dental chart ("Natisni karto" on the Patient
// Record page). Landscape: page 1 is a short patient header plus the whole
// chart, scaled to fit the page; page 2 is the Legenda and the tooth notes.
//
// Rendered into <body> only while printing, outside #root, which the print
// stylesheet hides — so nothing of the interactive page ends up on paper.
// On screen it sits far off to the side (still laid out, so it can be
// measured), then the chart is scaled to fit the page box and print() runs.

type ChartData = Pick<
  ComponentProps<typeof DentalChart>,
  | 'surfacesByFdi'
  | 'pocketsBuccal'
  | 'pocketsLingual'
  | 'gumMargin'
  | 'bleedingBuccal'
  | 'bleedingLingual'
  | 'postByFdi'
  | 'endoByFdi'
  | 'bridgeGroupByFdi'
>;

export interface ChartPrintPatient {
  name: string;
  /** YYYY-MM-DD */
  dob: string;
  healthCardNumber?: string | null;
  internalRecordNumber?: string | null;
}

interface ChartPrintSheetProps {
  practiceName: string | null;
  patient: ChartPrintPatient;
  chart: ChartData;
  notesByFdi: Record<string, string>;
  /** Called once the browser's print dialog has closed. */
  onDone: () => void;
}

// Landscape A4 minus the 10 mm page margins, minus the header above the chart.
const PAGE_CSS = `
@page { size: A4 landscape; margin: 10mm; }
@media screen { .chart-print { position: fixed; left: -100000px; top: 0; } }
@media print {
  body.printing-chart > #root { display: none !important; }
  body.printing-chart { background: #fff !important; }
  .chart-print { position: static; }
}
.chart-print { width: 277mm; color: #1c2624; font-family: inherit; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.chart-print .cp-page2 { break-before: page; }
`;

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${Number(d)}. ${Number(m)}. ${y}` : iso;
}

export function ChartPrintSheet({ practiceName, patient, chart, notesByFdi, onDone }: ChartPrintSheetProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; width: number; height: number } | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Scale the chart down (never up past its on-screen size) so it fits both
  // the page's width and the height left under the header.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = chartRef.current;
    if (!box || !content) return;
    const width = content.offsetWidth;
    const height = content.offsetHeight;
    if (!width || !height) return;
    const scale = Math.min(box.clientWidth / width, box.clientHeight / height, 1.5);
    setFit({ scale, width, height });
  }, []);

  useEffect(() => {
    if (!fit) return;
    document.body.classList.add('printing-chart');
    function finish() {
      document.body.classList.remove('printing-chart');
      onDoneRef.current();
    }
    window.addEventListener('afterprint', finish, { once: true });
    // Let the scaled layout paint before the dialog snapshots the page.
    const frame = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('printing-chart');
    };
  }, [fit]);

  const notes = ALL_FDI.filter((fdi) => notesByFdi[fdi]?.trim()).map((fdi) => [fdi, notesByFdi[fdi].trim()] as const);
  const printedOn = new Date().toLocaleDateString('sl-SI');
  const details = [
    `Datum rojstva: ${formatDate(patient.dob)}`,
    patient.healthCardNumber ? `Št. zdr. kartice: ${patient.healthCardNumber}` : '',
    patient.internalRecordNumber ? `Št. interne evidence: ${patient.internalRecordNumber}` : '',
  ].filter(Boolean);

  const header = (
    <div className="flex items-end justify-between gap-6 border-b border-[#1c2624] pb-1.5">
      <div>
        <div className="text-[15px] font-bold">{patient.name}</div>
        <div className="text-[11px]">{details.join(' · ')}</div>
      </div>
      <div className="text-right text-[11px]">
        <div className="font-semibold">{practiceName ?? ''}</div>
        <div>Zobni status · natisnjeno {printedOn}</div>
      </div>
    </div>
  );

  return createPortal(
    <div className="chart-print">
      <style>{PAGE_CSS}</style>
      {header}
      <div ref={boxRef} className="mt-2 flex h-[170mm] items-start justify-center overflow-hidden">
        <div style={fit ? { width: fit.width * fit.scale, height: fit.height * fit.scale } : undefined}>
          <div
            ref={chartRef}
            className="w-max"
            style={fit ? { transform: `scale(${fit.scale})`, transformOrigin: 'top left' } : undefined}
          >
            <DentalChart {...chart} hideArchLabels compact />
          </div>
        </div>
      </div>

      <div className="cp-page2">
        {header}
        <h2 className="mb-2 mt-4 text-[13px] font-bold">Legenda</h2>
        <StatusLegend />
        <h2 className="mb-2 mt-6 text-[13px] font-bold">Opombe k zobem</h2>
        {notes.length === 0 ? (
          <p className="text-[12px]">Ni opomb.</p>
        ) : (
          <table className="text-[12px]">
            <tbody>
              {notes.map(([fdi, text]) => (
                <tr key={fdi} className="align-top">
                  <td className="pr-4 font-semibold">{fdi}</td>
                  <td className="whitespace-pre-wrap">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>,
    document.body
  );
}
