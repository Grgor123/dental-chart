// The patient's copy of a signed consent (Gregor, 2026-11-12): emailed right
// after signing (patient-consent function) when the patient has an address and
// hasn't unsubscribed — a short message with the signed consent as a PDF
// (consentPdf.ts) attached. Fixed wording, not an editable template; logged in
// email_log as 'patient_consent', so it shows in the patient's Sporočila.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail, resolveSenderIdentity } from './send.ts';
import { escapeHtml, wrapEmailLayout } from './templates.ts';
import { logEmail, resolveUnsubscribeToken } from './log.ts';
import { unsubscribeUrl } from './sendAppointmentEmail.ts';

interface CopyRow {
  id: string;
  title: string;
  patients: { id: string; first_name: string; email: string | null; email_opt_out: boolean } | null;
  practices: {
    name: string;
    contact_email: string | null;
    email_sending_mode: 'platform_default' | 'custom_domain';
    custom_domain: string | null;
    custom_domain_sender_local_part: string;
    custom_domain_verified: boolean;
  } | null;
}

/** Returns true when the copy went out. */
export async function sendConsentCopy(
  supabase: SupabaseClient,
  consentId: string,
  pdf: { filename: string; base64: string }
): Promise<boolean> {
  const { data } = await supabase
    .from('patient_consents')
    .select(
      'id, title, patients(id, first_name, email, email_opt_out), practices(name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified)'
    )
    .eq('id', consentId)
    .maybeSingle();
  const c = data as unknown as CopyRow | null;
  const patient = c?.patients;
  const practice = c?.practices;
  if (!c || !patient || !practice || !patient.email || patient.email_opt_out) return false;

  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });
  const subject = `Kopija podpisanega soglasja — ${c.title}`.replace(/[\r\n]+/g, ' ');
  const bodyHtml =
    `<p style="margin:0 0 16px;line-height:1.5;">Pozdravljeni ${escapeHtml(patient.first_name)},</p>` +
    `<p style="margin:0 0 16px;line-height:1.5;">v priponki vam pošiljamo kopijo soglasja »${escapeHtml(c.title)}«, ki ste ga podpisali. Shranite si jo za svojo evidenco.</p>` +
    `<p style="margin:0 0 16px;line-height:1.5;">Če imate vprašanja, nam odgovorite na to sporočilo ali nas pokličite.</p>` +
    `<p style="margin:0;line-height:1.5;">Lep pozdrav,<br>${escapeHtml(practice.name)}</p>`;
  const unsubscribeToken = await resolveUnsubscribeToken(supabase, patient.id);
  const html = wrapEmailLayout({ practiceName: practice.name, heading: 'Kopija podpisanega soglasja', bodyHtml, unsubscribeUrl: unsubscribeUrl(unsubscribeToken) });

  try {
    const { messageId } = await sendEmail({
      to: patient.email,
      sender,
      replyTo: practice.contact_email,
      subject,
      html,
      attachmentIcs: null,
      attachments: [{ filename: pdf.filename, contentType: 'application/pdf', base64: pdf.base64 }],
    });
    await logEmail(supabase, {
      patientId: patient.id,
      appointmentId: null,
      emailType: 'patient_consent',
      recipientEmail: patient.email,
      subject,
      bodyHtml: html,
      status: 'sent',
      providerMessageId: messageId,
      senderDomain: sender.fromDomain,
    });
    return true;
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : String(sendError);
    console.error(`SES consent copy failed for consent ${c.id}:`, sendError);
    await logEmail(supabase, {
      patientId: patient.id,
      appointmentId: null,
      emailType: 'patient_consent',
      recipientEmail: patient.email,
      subject,
      bodyHtml: html,
      status: 'failed',
      senderDomain: sender.fromDomain,
      errorMessage: message,
    });
    return false;
  }
}
