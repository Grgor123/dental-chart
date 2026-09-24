// Shared inline-styled HTML layout + the renderer that turns a template
// (platform default, optionally overridden per practice — see
// templateDefs.ts) into a finished email. Inline styles only — most email
// clients strip or ignore external/`<style>` CSS, so every rule here is
// inline per element, the standard approach for transactional email HTML.
//
// A practice only ever supplies plain text with {placeholders}; this file is
// the one place that turns that into HTML, escaping every value, so a
// practice can't inject markup and can't remove the layout shell or the
// unsubscribe footer.
import {
  PLACEHOLDER_KEYS,
  TEMPLATE_DEFS,
  type PlaceholderKey,
  type TemplateKey,
  type TemplateOverride,
  type TemplateVars,
} from './templateDefs.ts';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const ACCENT_COLOR = '#2e6e62'; // same teal used elsewhere (e.g. docs/sms-consent.html's own button)
const TEXT_COLOR = '#222222';
const MUTED_COLOR = '#666666';
const TIME_ZONE = 'Europe/Ljubljana';

function wrapEmailLayout(params: { practiceName: string; heading: string; bodyHtml: string; unsubscribeUrl: string }): string {
  return `<!doctype html>
<html lang="sl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:${TEXT_COLOR};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:480px;width:100%;">
        <tr><td style="background:${ACCENT_COLOR};padding:20px 24px;">
          <span style="color:#ffffff;font-size:16px;font-weight:600;">${escapeHtml(params.practiceName)}</span>
        </td></tr>
        <tr><td style="padding:24px;">
          <h1 style="margin:0 0 16px;font-size:18px;color:${TEXT_COLOR};">${escapeHtml(params.heading)}</h1>
          ${params.bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #eeeeee;">
          <span style="color:${MUTED_COLOR};font-size:12px;">
            Če ne želite več prejemati e-poštnih obvestil,
            <a href="${params.unsubscribeUrl}" style="color:${MUTED_COLOR};">se odjavite tukaj</a>.
          </span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sl-SI', { dateStyle: 'long', timeZone: TIME_ZONE });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
}

export interface TemplateVarsInput {
  practiceName: string;
  firstName: string;
  lastName: string;
  startsAt: string; // ISO
  service: string | null;
  therapistName: string | null;
}

export function buildTemplateVars(input: TemplateVarsInput): TemplateVars {
  return {
    ime: input.firstName,
    priimek: input.lastName,
    datum: formatDate(input.startsAt),
    ura: formatTime(input.startsAt),
    storitev: input.service ?? '',
    terapevt: input.therapistName ?? '',
    ordinacija: input.practiceName,
  };
}

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

function isKnownPlaceholder(name: string): name is PlaceholderKey {
  return (PLACEHOLDER_KEYS as readonly string[]).includes(name);
}

// Known placeholders are replaced (empty string if the value is empty);
// unknown ones are left as typed so a typo like {imee} is visible in the
// editor preview instead of silently vanishing. `hadEmpty` reports whether
// any KNOWN placeholder resolved to nothing — the body renderer drops a whole
// paragraph in that case ("Storitev: {storitev}" disappears when there's no
// service), instead of leaving a dangling label.
function substitute(template: string, vars: TemplateVars): { text: string; hadEmpty: boolean } {
  let hadEmpty = false;
  const text = template.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
    if (!isKnownPlaceholder(name)) return match;
    const value = vars[name];
    if (!value) hadEmpty = true;
    return value;
  });
  return { text, hadEmpty };
}

// A subject/heading is one line. Also the header-injection guard: this string
// ends up in a raw MIME Subject header, and both the template text (practice
// input) and the placeholder values (patient/staff input) are untrusted, so
// no CR/LF may survive.
function singleLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function pick(overrideValue: string | null | undefined, fallback: string): string {
  return overrideValue && overrideValue.trim() ? overrideValue : fallback;
}

function paragraphsOf(template: string, vars: TemplateVars): string[] {
  return template
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => substitute(paragraph, vars))
    .filter((p) => !p.hadEmpty)
    .map((p) => p.text.trim())
    .filter((text) => text.length > 0);
}

// Only markup a practice gets: **bold**. Everything else is escaped text.
function paragraphToHtml(paragraph: string): string {
  const escaped = escapeHtml(paragraph).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  return `<p style="margin:0 0 16px;line-height:1.5;">${escaped}</p>`;
}

export interface RenderContext {
  practiceName: string;
  unsubscribeUrl: string;
}

export function renderTemplate(
  key: TemplateKey,
  override: Pick<TemplateOverride, 'subject' | 'heading' | 'body'> | null,
  vars: TemplateVars,
  context: RenderContext
): EmailContent {
  const def = TEMPLATE_DEFS[key];
  const subject = singleLine(substitute(pick(override?.subject, def.defaultSubject), vars).text);
  const heading = singleLine(substitute(pick(override?.heading, def.defaultHeading), vars).text);
  const paragraphs = paragraphsOf(pick(override?.body, def.defaultBody), vars);

  const html = wrapEmailLayout({
    practiceName: context.practiceName,
    heading,
    bodyHtml: paragraphs.map(paragraphToHtml).join('\n'),
    unsubscribeUrl: context.unsubscribeUrl,
  });
  const text = `${heading}\n\n${paragraphs.map((p) => p.replace(/\*\*/g, '')).join('\n\n')}\n\nOdjava od e-poštnih obvestil: ${context.unsubscribeUrl}`;

  return { subject, html, text };
}
