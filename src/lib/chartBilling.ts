// Chart marks that can be billed (supabase/migrations/033 — service_chart_links,
// performed_services). trigger_key is the chart's own vocabulary
// (ToothStatus / EndoStage / post / perio measurements), not a billing
// taxonomy. Shared by Nastavitve → Cenik (the "Iz karte" column) and the
// invoice's "Dodaj iz karte".

import { TOOTH_META } from '../data/toothMeta';
import type { EndoStage, Surface, SurfaceMap, ToothStatus } from '../types/dental';

export type ChartTrigger =
  | 'filling'
  | 'extraction'
  | 'root_canal'
  | 'crown'
  | 'overlay'
  | 'sealant'
  | 'bridge_pontic'
  | 'post'
  | 'prosthesis'
  | 'implant'
  | 'perio';

/** Only fillings have a variant — the number of treated surfaces, which the
 *  chart records exactly, so a filling resolves to one service by itself. */
export type FillingVariant = '1' | '2' | '3+';

export interface ChartLinkChoice {
  trigger: ChartTrigger;
  variant: FillingVariant | null;
}

export const CHART_TRIGGERS: { key: ChartTrigger; label: string }[] = [
  { key: 'filling', label: 'Plomba' },
  { key: 'extraction', label: 'Ekstrakcija' },
  { key: 'root_canal', label: 'Endodontsko zdravljenje' },
  { key: 'crown', label: 'Prevleka (krona)' },
  { key: 'overlay', label: 'Overlay / onlay' },
  { key: 'sealant', label: 'Zalitje fisur' },
  { key: 'bridge_pontic', label: 'Člen mostu' },
  { key: 'post', label: 'Zobni zatiček' },
  { key: 'prosthesis', label: 'Proteza' },
  { key: 'implant', label: 'Implantat' },
  { key: 'perio', label: 'Parodontologija' },
];

export const FILLING_VARIANTS: { key: FillingVariant; label: string }[] = [
  { key: '1', label: '1 ploskev' },
  { key: '2', label: '2 ploskvi' },
  { key: '3+', label: '3 ali več ploskev' },
];

export function chartLinkLabel(choice: ChartLinkChoice): string {
  const trigger = CHART_TRIGGERS.find((t) => t.key === choice.trigger)?.label ?? choice.trigger;
  if (!choice.variant) return trigger;
  const variant = FILLING_VARIANTS.find((v) => v.key === choice.variant)?.label ?? choice.variant;
  return `${trigger} · ${variant}`;
}

/** "filling:2" / "extraction" — one string per choice, for a <select>. */
export function chartLinkValue(choice: ChartLinkChoice | null): string {
  if (!choice) return '';
  return choice.variant ? `${choice.trigger}:${choice.variant}` : choice.trigger;
}

export function parseChartLinkValue(value: string): ChartLinkChoice | null {
  if (!value) return null;
  const [trigger, variant] = value.split(':');
  return { trigger: trigger as ChartTrigger, variant: (variant as FillingVariant | undefined) ?? null };
}

/** Every choice in display order: fillings split by surface count. */
export const CHART_LINK_CHOICES: ChartLinkChoice[] = CHART_TRIGGERS.flatMap((t): ChartLinkChoice[] =>
  t.key === 'filling'
    ? FILLING_VARIANTS.map((v) => ({ trigger: t.key, variant: v.key }))
    : [{ trigger: t.key, variant: null }]
);

export const sameChartLink = (a: ChartLinkChoice | null, b: ChartLinkChoice | null): boolean =>
  chartLinkValue(a) === chartLinkValue(b);

// ZZZS codes whose chart mark is known — used to link a service automatically
// when "Uporabljaj šifrant ZZZS" is on. Adult codes plus their children's
// variants (fillings / root canals "do 15 let", "pri predšolskih otrocih").
// Implants have no ZZZS code here (placing one isn't a ZZZS service) — a
// practice links its own implant service by hand.
const ZZZS_AUTO: Record<string, ChartLinkChoice> = {
  ...Object.fromEntries(
    (
      [
        ['52320', '1'], ['52321', '2'], ['52322', '3+'],
        ['52323', '1'], ['52324', '2'], ['52325', '3+'],
        ['52326', '1'], ['52327', '2'],
      ] as const
    ).map(([code, variant]) => [code, { trigger: 'filling', variant }])
  ),
  ...codes('extraction', ['52301', '52302', '52303', '52305', '52310', '52311']),
  ...codes('root_canal', ['52306', '52307', '52308', '52309', '52313', '52314', '52315', '52316']),
  ...codes('crown', ['52336', '52337', '52338', '52340', '52341', '52344', '52345']),
  ...codes('overlay', ['52332']),
  ...codes('sealant', ['45390']),
  ...codes('bridge_pontic', ['52389', '52390']),
  ...codes('post', ['52392', '52393', '52394']),
  ...codes('prosthesis', ['93004', '93005', '93006', '93007', '93008']),
  ...codes('perio', ['45201', '45225', '45226', '45227', '45228', '45229', '45230', '45231', '45232', '45233']),
};

function codes(trigger: ChartTrigger, list: string[]): Record<string, ChartLinkChoice> {
  return Object.fromEntries(list.map((code) => [code, { trigger, variant: null }]));
}

export function zzzsAutoLink(zzzsCode: string | null): ChartLinkChoice | null {
  return zzzsCode ? (ZZZS_AUTO[zzzsCode] ?? null) : null;
}

export interface ServiceChartLinkRow {
  id: string;
  serviceId: string;
  trigger: ChartTrigger;
  variant: FillingVariant | null;
  excluded: boolean;
}

export interface EffectiveChartLink extends ChartLinkChoice {
  /** Derived from the service's ZZZS code, not set by hand. */
  automatic: boolean;
}

/** A service's chart link: one set by hand wins; otherwise the automatic one
 *  from its ZZZS code (switch on), unless the practice removed it. */
export function effectiveChartLink(
  serviceId: string,
  zzzsCode: string | null,
  links: ServiceChartLinkRow[],
  useZzzs: boolean
): EffectiveChartLink | null {
  const own = links.filter((l) => l.serviceId === serviceId);
  const manual = own.find((l) => !l.excluded);
  if (manual) return { trigger: manual.trigger, variant: manual.variant, automatic: false };
  const auto = useZzzs ? zzzsAutoLink(zzzsCode) : null;
  if (!auto) return null;
  if (own.some((l) => l.excluded && sameChartLink(l, auto))) return null;
  return { ...auto, automatic: true };
}

// ---- What was done in a visit ------------------------------------------------
// tooth_records holds one row per tooth per visit, each a full snapshot of that
// tooth at the time. Comparing a visit's row with the tooth's latest row from
// an EARLIER visit tells what changed in that visit; only changes are billable.

export interface ChartRecordRow {
  visitId: string;
  /** visits.date (ISO). */
  visitDate: string;
  visitCreatedAt: string;
  visitClosed: boolean;
  fdi: string;
  surfaces: SurfaceMap;
  endo: EndoStage | null;
  post: boolean;
  pocketsBuccal: (number | null)[] | null;
  pocketsLingual: (number | null)[] | null;
  gumMargin: (number | null)[] | null;
}

export interface ChartWorkItem {
  visitId: string;
  /** null = whole mouth (perio). */
  fdi: string | null;
  trigger: ChartTrigger;
  variant: FillingVariant | null;
  /** Ticked by default: certainly done in this visit (a planned stage turned
      done, a filling, or a change on a tooth already charted before). A
      status set on a tooth's very first record may just be its history being
      charted, so it's shown unticked. */
  confident: boolean;
  /** Perio: how many teeth were measured in this visit. */
  teethMeasured?: number;
}

export interface ChartVisitWork {
  visitId: string;
  visitDate: string;
  visitClosed: boolean;
  items: ChartWorkItem[];
}

const STATUS_TRIGGER: Partial<Record<ToothStatus, { trigger: ChartTrigger; planned?: ToothStatus }>> = {
  extracted: { trigger: 'extraction', planned: 'extraction_planned' },
  crown: { trigger: 'crown' },
  overlay: { trigger: 'overlay', planned: 'overlay_planned' },
  sealant: { trigger: 'sealant', planned: 'sealant_planned' },
  bridge_pontic: { trigger: 'bridge_pontic' },
  prosthesis: { trigger: 'prosthesis' },
  implant: { trigger: 'implant' },
};

const surfaceStatus = (map: SurfaceMap | undefined, s: Surface): ToothStatus | undefined => map?.[s] ?? map?.all;
const hasValue = (values: (number | null)[] | null | undefined) => !!values?.some((v) => v !== null && v !== undefined);
const sameValues = (a: (number | null)[] | null | undefined, b: (number | null)[] | null | undefined) =>
  JSON.stringify(a ?? [null, null, null]) === JSON.stringify(b ?? [null, null, null]);

/** Billable chart changes per visit, newest visit first. `rows` = every
 *  tooth_records row of one patient. */
export function detectChartWork(rows: ChartRecordRow[]): ChartVisitWork[] {
  const ordered = [...rows].sort((a, b) => a.visitCreatedAt.localeCompare(b.visitCreatedAt));
  const visits = new Map<string, ChartVisitWork>();
  const latest = new Map<string, ChartRecordRow>(); // fdi -> latest row from an earlier visit
  let i = 0;
  while (i < ordered.length) {
    const visitId = ordered[i].visitId;
    const visitRows: ChartRecordRow[] = [];
    while (i < ordered.length && ordered[i].visitId === visitId) visitRows.push(ordered[i++]);
    const work: ChartVisitWork = { visitId, visitDate: visitRows[0].visitDate, visitClosed: visitRows[0].visitClosed, items: [] };
    let measured = 0;

    for (const cur of visitRows) {
      const prev = latest.get(cur.fdi);
      const chartedBefore = !!prev;
      const meta = TOOTH_META[cur.fdi];

      // Fillings: surfaces newly "Plomba" (caries_treated) in this visit.
      if (meta) {
        const filled = meta.surfaces.filter(
          (s) => surfaceStatus(cur.surfaces, s) === 'caries_treated' && surfaceStatus(prev?.surfaces, s) !== 'caries_treated'
        ).length;
        if (filled > 0) {
          work.items.push({
            visitId,
            fdi: cur.fdi,
            trigger: 'filling',
            variant: filled >= 3 ? '3+' : (String(filled) as FillingVariant),
            confident: true,
          });
        }
      }

      // Whole-tooth statuses.
      const curAll = cur.surfaces.all;
      const prevAll = prev?.surfaces.all;
      const mapped = curAll ? STATUS_TRIGGER[curAll] : undefined;
      if (mapped && curAll !== prevAll) {
        work.items.push({
          visitId,
          fdi: cur.fdi,
          trigger: mapped.trigger,
          variant: null,
          confident: chartedBefore || (!!mapped.planned && prevAll === mapped.planned),
        });
      }

      if (cur.endo === 'done' && prev?.endo !== 'done') {
        work.items.push({ visitId, fdi: cur.fdi, trigger: 'root_canal', variant: null, confident: chartedBefore });
      }
      if (cur.post && !prev?.post) {
        work.items.push({ visitId, fdi: cur.fdi, trigger: 'post', variant: null, confident: chartedBefore });
      }

      const perioChanged =
        !sameValues(cur.pocketsBuccal, prev?.pocketsBuccal) ||
        !sameValues(cur.pocketsLingual, prev?.pocketsLingual) ||
        !sameValues(cur.gumMargin, prev?.gumMargin);
      if (perioChanged && (hasValue(cur.pocketsBuccal) || hasValue(cur.pocketsLingual) || hasValue(cur.gumMargin))) measured++;
    }
    if (measured > 0) {
      work.items.push({ visitId, fdi: null, trigger: 'perio', variant: null, confident: true, teethMeasured: measured });
    }
    for (const cur of visitRows) latest.set(cur.fdi, cur);
    if (work.items.length > 0) visits.set(visitId, work);
  }
  return [...visits.values()].reverse();
}

/** Stable identity of a work item — the same key performed_services is unique on. */
export function workItemKey(item: Pick<ChartWorkItem, 'visitId' | 'fdi' | 'trigger'>): string {
  return `${item.visitId}|${item.fdi ?? ''}|${item.trigger}`;
}
