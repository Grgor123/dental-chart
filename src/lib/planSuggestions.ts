// The chart's planned (red) marks as suggestions for a predračun (migration
// 061; Gregor, 2026-11-13). Read from the LIVE chart state on the patient
// record, so a mark the doctor adds shows up at once. Each mark carries the
// chart link it corresponds to ("Iz karte" in Cenik); the panel shows the
// linked service — but nothing goes on the predračun until the doctor clicks
// "Dodaj" (the links can be wrong, Gregor).
import { TOOTH_META } from '../data/toothMeta';
import type { EndoStage, SurfaceMap } from '../types/dental';
import { effectiveChartLink, sameChartLink, type ChartLinkChoice, type ServiceChartLinkRow } from './chartBilling';
import type { Service } from '../hooks/usePriceList';

export interface PlannedMark {
  /** Stable key, e.g. "36:filling". */
  key: string;
  fdi: string;
  label: string;
  link: ChartLinkChoice;
}

const WHOLE: Record<string, { label: string; link: ChartLinkChoice }> = {
  extraction_planned: { label: 'predvidena ekstrakcija', link: { trigger: 'extraction', variant: null } },
  overlay_planned: { label: 'predviden overlay', link: { trigger: 'overlay', variant: null } },
  sealant_planned: { label: 'predvideno zalitje fisur', link: { trigger: 'sealant', variant: null } },
};

export function plannedMarksFromChart(
  surfacesByFdi: Record<string, SurfaceMap>,
  endoByFdi: Record<string, EndoStage>
): PlannedMark[] {
  const fdis = [...new Set([...Object.keys(surfacesByFdi), ...Object.keys(endoByFdi)])].sort();
  const marks: PlannedMark[] = [];
  for (const fdi of fdis) {
    const surfaces = surfacesByFdi[fdi] ?? {};
    const whole = surfaces.all ? WHOLE[surfaces.all] : undefined;
    if (whole) marks.push({ key: `${fdi}:${whole.link.trigger}`, fdi, label: whole.label, link: whole.link });
    const cariesSurfaces =
      surfaces.all === 'caries'
        ? (TOOTH_META[fdi]?.surfaces ?? []).map(String)
        : Object.entries(surfaces)
            .filter(([key, value]) => key !== 'all' && value === 'caries')
            .map(([key]) => key);
    if (cariesSurfaces.length > 0) {
      const count = cariesSurfaces.length;
      marks.push({
        key: `${fdi}:filling`,
        fdi,
        label: `karies ${cariesSurfaces.join('').toUpperCase()}`,
        link: { trigger: 'filling', variant: count >= 3 ? '3+' : count === 2 ? '2' : '1' },
      });
    }
    if (endoByFdi[fdi] === 'planned') {
      marks.push({ key: `${fdi}:root_canal`, fdi, label: 'potrebno endodontsko zdravljenje', link: { trigger: 'root_canal', variant: null } });
    }
  }
  return marks;
}

/** Active price-list services linked to this chart mark. */
export function servicesForMark(mark: PlannedMark, services: Service[], links: ServiceChartLinkRow[], useZzzs: boolean): Service[] {
  return services.filter((s) => {
    if (!s.isActive) return false;
    const link = effectiveChartLink(s.id, s.zzzsCode, links, useZzzs);
    return !!link && sameChartLink(link, mark.link);
  });
}
