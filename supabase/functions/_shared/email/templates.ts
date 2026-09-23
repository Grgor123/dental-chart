// Shared inline-styled HTML layout + the two real email templates
// (confirmation, reminder). Inline styles only — most email clients strip
// or ignore external/`<style>` CSS, so every rule here is inline per
// element, the standard approach for transactional email HTML.

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const ACCENT_COLOR = '#2e6e62'; // same teal used elsewhere (e.g. docs/sms-consent.html's own button)
const TEXT_COLOR = '#222222';
const MUTED_COLOR = '#666666';

function wrapEmailLayout(params: { practiceName: string; bodyHtml: string; unsubscribeUrl: string }): string {
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
          ${params.bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #eeeeee;">
          <span style="color:${MUTED_COLOR};font-size:12px;">
            Če ne želite več prejemati e-poštnih obvestil o terminih,
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

function formatAppointmentTime(startsAtIso: string): string {
  return new Date(startsAtIso).toLocaleString('sl-SI', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Ljubljana' });
}

export interface AppointmentEmailInput {
  practiceName: string;
  patientFirstName: string;
  startsAt: string; // ISO
  service: string | null;
  unsubscribeUrl: string;
}

export function confirmationEmail(input: AppointmentEmailInput): EmailContent {
  const time = formatAppointmentTime(input.startsAt);
  const serviceLine = input.service ? `<p style="margin:0 0 16px;color:${MUTED_COLOR};">Storitev: ${escapeHtml(input.service)}</p>` : '';
  const serviceText = input.service ? `\nStoritev: ${input.service}` : '';

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:18px;color:${TEXT_COLOR};">Termin je potrjen</h1>
    <p style="margin:0 0 8px;">Pozdravljeni ${escapeHtml(input.patientFirstName)},</p>
    <p style="margin:0 0 16px;">vaš termin pri <strong>${escapeHtml(input.practiceName)}</strong> je naročen za:</p>
    <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:${ACCENT_COLOR};">${time}</p>
    ${serviceLine}
    <p style="margin:0;color:${MUTED_COLOR};">V priponki je vabilo za vaš koledar (.ics).</p>
  `;

  return {
    subject: `Termin potrjen — ${time}`,
    html: wrapEmailLayout({ practiceName: input.practiceName, bodyHtml, unsubscribeUrl: input.unsubscribeUrl }),
    text: `Pozdravljeni ${input.patientFirstName},\n\nVaš termin pri ${input.practiceName} je naročen za: ${time}${serviceText}\n\nOdjava od e-poštnih obvestil: ${input.unsubscribeUrl}`,
  };
}

export function reminderEmail(input: AppointmentEmailInput): EmailContent {
  const time = formatAppointmentTime(input.startsAt);
  const serviceLine = input.service ? `<p style="margin:0 0 16px;color:${MUTED_COLOR};">Storitev: ${escapeHtml(input.service)}</p>` : '';
  const serviceText = input.service ? `\nStoritev: ${input.service}` : '';

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:18px;color:${TEXT_COLOR};">Opomnik na termin</h1>
    <p style="margin:0 0 8px;">Pozdravljeni ${escapeHtml(input.patientFirstName)},</p>
    <p style="margin:0 0 16px;">spomnimo vas na vaš termin pri <strong>${escapeHtml(input.practiceName)}</strong>:</p>
    <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:${ACCENT_COLOR};">${time}</p>
    ${serviceLine}
  `;

  return {
    subject: `Opomnik na termin — ${time}`,
    html: wrapEmailLayout({ practiceName: input.practiceName, bodyHtml, unsubscribeUrl: input.unsubscribeUrl }),
    text: `Pozdravljeni ${input.patientFirstName},\n\nSpomnimo vas na vaš termin pri ${input.practiceName}: ${time}${serviceText}\n\nOdjava od e-poštnih obvestil: ${input.unsubscribeUrl}`,
  };
}
