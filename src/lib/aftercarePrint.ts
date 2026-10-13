// "Natisni navodila" on an invoice (aftercare topics, migration 034): an A4
// printout with the practice header, the patient and the ticked topics — for
// patients without an email address or who unsubscribed. Same plain-text
// format as the email (blank line = paragraph, line break kept, **bold**),
// every value escaped.

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function paragraphs(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

export interface AftercarePrintInput {
  practiceName: string;
  /** Practice address / contact lines under its name. */
  practiceLines: string[];
  patientName: string;
  /** Already formatted, e.g. "8. 10. 2026". */
  date: string;
  topics: { title: string; body: string }[];
}

export function renderAftercarePrintHtml(input: AftercarePrintInput): string {
  return `<!doctype html>
<html lang="sl">
<head>
<meta charset="utf-8">
<title>Navodila po obisku</title>
<style>
  @page { size: A4; margin: 18mm 18mm 20mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1c2624; font-size: 11pt; line-height: 1.45; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2e6e62; padding-bottom: 8px; margin-bottom: 18px; }
  .practice { font-weight: 700; font-size: 13pt; }
  .practice-lines { font-size: 9pt; color: #45524f; }
  .who { text-align: right; font-size: 10pt; }
  h1 { font-size: 16pt; margin: 0 0 14px; }
  h2 { font-size: 12.5pt; color: #2e6e62; margin: 18px 0 6px; break-after: avoid; }
  section { break-inside: avoid; }
  p { margin: 0 0 8px; }
</style>
</head>
<body>
  <header>
    <div>
      <div class="practice">${escapeHtml(input.practiceName)}</div>
      <div class="practice-lines">${input.practiceLines.filter(Boolean).map(escapeHtml).join('<br>')}</div>
    </div>
    <div class="who">${escapeHtml(input.patientName)}<br>${escapeHtml(input.date)}</div>
  </header>
  <h1>Navodila po obisku</h1>
  ${input.topics.map((t) => `<section><h2>${escapeHtml(t.title)}</h2>${paragraphs(t.body)}</section>`).join('\n')}
</body>
</html>`;
}
