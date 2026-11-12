// Informed consents (migration 058): the consent text as HTML (same plain-text
// format as aftercare topics — blank line = paragraph, line break kept,
// **bold**, everything escaped) and the A4 printout of a signed consent.

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain consent text → escaped HTML paragraphs. Safe for innerHTML. */
export function consentTextHtml(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

export interface ConsentPrintInput {
  practiceName: string;
  practiceLines: string[];
  patientName: string;
  patientDob: string | null;
  title: string;
  body: string;
  details: string | null;
  signerName: string | null;
  signedAt: string | null;
  signedVia: 'tablet' | 'link' | 'device' | null;
  signaturePng: string | null;
  explainedByName: string | null;
  explainedAt: string | null;
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('sl-SI', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Ljubljana' });
}

export function renderConsentPrintHtml(c: ConsentPrintInput): string {
  const signature =
    c.signaturePng && c.signaturePng.startsWith('data:image/png;base64,')
      ? `<img class="sig" src="${c.signaturePng}" alt="Podpis">`
      : '<div class="sig-empty">Ni podpisano</div>';
  return `<!doctype html>
<html lang="sl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(c.title)}</title>
<style>
  @page { size: A4; margin: 18mm 18mm 20mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1c2624; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2e6e62; padding-bottom: 8px; margin-bottom: 16px; }
  .practice { font-weight: 700; font-size: 13pt; }
  .practice-lines { font-size: 9pt; color: #45524f; }
  .who { text-align: right; font-size: 10pt; }
  h1 { font-size: 15pt; margin: 0 0 10px; }
  .details { background: #eef3f2; padding: 6px 10px; margin: 0 0 12px; white-space: pre-wrap; }
  p { margin: 0 0 7px; }
  .signatures { display: flex; gap: 24px; margin-top: 18px; break-inside: avoid; }
  .box { flex: 1; border-top: 1px solid #1c2624; padding-top: 6px; font-size: 9.5pt; }
  .sig { display: block; max-width: 100%; height: 70px; object-fit: contain; object-position: left; margin-bottom: 4px; }
  .sig-empty { height: 70px; color: #b3261e; }
  .muted { color: #6f7c79; }
</style>
</head>
<body>
  <header>
    <div>
      <div class="practice">${escapeHtml(c.practiceName)}</div>
      <div class="practice-lines">${c.practiceLines.filter(Boolean).map(escapeHtml).join('<br>')}</div>
    </div>
    <div class="who">${escapeHtml(c.patientName)}${c.patientDob ? `<br>roj. ${escapeHtml(c.patientDob)}` : ''}</div>
  </header>
  <h1>${escapeHtml(c.title)}</h1>
  ${c.details ? `<div class="details"><strong>Predvideni poseg:</strong> ${escapeHtml(c.details)}</div>` : ''}
  ${consentTextHtml(c.body)}
  <div class="signatures">
    <div class="box">
      ${signature}
      <strong>Pacient:</strong> ${escapeHtml(c.signerName ?? c.patientName)}<br>
      <span class="muted">${c.signedAt ? `Podpisano ${escapeHtml(dateTime(c.signedAt))}${c.signedVia === 'link' ? ' (prek povezave)' : ' (v ordinaciji)'}` : ''}</span>
    </div>
    <div class="box">
      <div style="height:70px"></div>
      <strong>Pojasnil:</strong> ${escapeHtml(c.explainedByName ?? '—')}<br>
      <span class="muted">${c.explainedAt ? `Potrjeno ${escapeHtml(dateTime(c.explainedAt))}` : 'Pojasnilo še ni potrjeno'}</span>
    </div>
  </div>
</body>
</html>`;
}
