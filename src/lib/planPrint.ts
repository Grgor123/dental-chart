// "Natisni" on a predračun (migration 061): A4 printout. Before acceptance it
// shows every variant (and a blank signature line, for signing on paper);
// after acceptance only the chosen variant with the signature or the verbal
// acceptance. Every value escaped.
import type { TreatmentPlan } from '../hooks/useTreatmentPlans';
import { itemTotal, variantTotal } from '../hooks/useTreatmentPlans';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function eur(value: number): string {
  return new Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'EUR' }).format(value);
}
function date(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('sl-SI', { dateStyle: 'long', timeZone: 'Europe/Ljubljana' });
}
function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('sl-SI', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Ljubljana' });
}

export interface PlanPrintInput {
  practiceName: string;
  practiceLines: string[];
  patientName: string;
  plan: TreatmentPlan;
}

export function renderPlanPrintHtml({ practiceName, practiceLines, patientName, plan }: PlanPrintInput): string {
  const accepted = plan.acceptedAt ? plan.variants.find((v) => v.id === plan.acceptedVariantId) ?? null : null;
  const shown = accepted ? [accepted] : plan.variants.filter((v) => v.items.length > 0);
  const many = plan.variants.length > 1;
  const variantsHtml = shown
    .map(
      (v) => `<section>
  ${many ? `<h2>${accepted ? 'Izbrana možnost: ' : ''}${escapeHtml(v.name)}</h2>` : ''}
  <table>
    <thead><tr><th>Zap.</th><th>Storitev</th><th>Zob</th><th class="n">Količina</th><th class="n">Cena</th><th class="n">Popust</th><th class="n">Znesek</th></tr></thead>
    <tbody>${v.items
      .map(
        (i, n) =>
          `<tr><td>${n + 1}</td><td>${escapeHtml(i.name)}${i.code ? ` <span class="m">(${escapeHtml(i.code)})</span>` : ''}</td><td>${escapeHtml(i.toothFdi ?? '')}</td><td class="n">${i.quantity} ${escapeHtml(i.unit)}</td><td class="n">${eur(i.unitPriceEur)}</td><td class="n">${i.discountPercent ? `${i.discountPercent} %` : ''}</td><td class="n">${eur(itemTotal(i))}</td></tr>`
      )
      .join('')}</tbody>
  </table>
  <div class="total">Skupaj: ${eur(variantTotal(v))}</div>
</section>`
    )
    .join('\n');

  const acceptance = accepted
    ? plan.acceptedVia === 'link' && plan.signaturePng?.startsWith('data:image/png;base64,')
      ? `<div class="sign"><img src="${plan.signaturePng}" alt="Podpis"><div class="line"></div><strong>Predračun sprejel/a: ${escapeHtml(plan.signerName ?? patientName)}</strong><br><span class="m">Podpisano ${escapeHtml(dateTime(plan.acceptedAt!))}</span></div>`
      : `<div class="sign"><strong>Predračun sprejet ustno ${escapeHtml(dateTime(plan.acceptedAt!))}</strong><br><span class="m">Zabeležil/a: ${escapeHtml(plan.acceptedByName ?? '—')}</span></div>`
    : `<div class="sign"><div style="height:60px"></div><div class="line"></div><strong>Podpis pacienta${many ? ' in izbrana možnost' : ''}</strong><br><span class="m">Kraj in datum: ______________________</span></div>`;

  return `<!doctype html>
<html lang="sl">
<head>
<meta charset="utf-8">
<title>Predračun ${escapeHtml(plan.number)}</title>
<style>
  @page { size: A4; margin: 16mm 16mm 18mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1c2624; font-size: 10pt; line-height: 1.4; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2e6e62; padding-bottom: 8px; margin-bottom: 14px; }
  .practice { font-weight: 700; font-size: 13pt; }
  .lines { font-size: 8.5pt; color: #45524f; }
  h1 { font-size: 16pt; margin: 0 0 2px; }
  h2 { font-size: 11.5pt; margin: 14px 0 4px; color: #2e6e62; }
  .m { color: #6f7c79; font-size: 8.5pt; }
  .note { white-space: pre-wrap; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { text-align: left; font-size: 8pt; color: #6f7c79; border-bottom: 1px solid #ccd6d4; padding: 3px 4px; }
  td { border-bottom: 1px solid #eef2f1; padding: 4px; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; }
  .total { text-align: right; font-weight: 700; font-size: 11pt; margin-top: 6px; }
  section { break-inside: avoid; }
  .foot { margin-top: 14px; font-size: 8.5pt; color: #6f7c79; }
  .sign { margin-top: 26px; width: 60%; break-inside: avoid; }
  .sign img { height: 64px; display: block; }
  .line { border-top: 1px solid #1c2624; margin: 4px 0 4px; }
</style>
</head>
<body>
  <header>
    <div><div class="practice">${escapeHtml(practiceName)}</div><div class="lines">${practiceLines.filter(Boolean).map(escapeHtml).join('<br>')}</div></div>
    <div>${escapeHtml(patientName)}</div>
  </header>
  <h1>${escapeHtml(plan.title)} ${escapeHtml(plan.number)}</h1>
  <div class="m">Izdano ${escapeHtml(date(plan.createdAt))} · velja do ${escapeHtml(date(plan.validUntil))}</div>
  ${plan.note ? `<div class="note">${escapeHtml(plan.note)}</div>` : ''}
  ${!accepted && many ? '<p class="m">Predlagane so različne možnosti zdravljenja; pacient izbere eno.</p>' : ''}
  ${variantsHtml}
  <div class="foot">Zneski vključujejo DDV, kjer se obračuna. Predračun ni račun; končni znesek je odvisen od dejansko opravljenih storitev.</div>
  ${acceptance}
</body>
</html>`;
}
