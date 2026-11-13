// A patient's copy of a signed document as a PDF attachment — the signed
// consent (sendConsentCopy.ts) and the accepted predračun (treatment-plan
// function). Sent only when the patient has an address and didn't unsubscribe;
// a short fixed message in the practice's layout; logged in email_log so it
// shows in the patient's Sporočila.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail, resolveSenderIdentity } from './send.ts';
import { escapeHtml, wrapEmailLayout } from './templates.ts';
import { logEmail, resolveUnsubscribeToken, type EmailType } from './log.ts';
import { unsubscribeUrl } from './sendAppointmentEmail.ts';

interface PatientRow {
  id: string;
  first_name: string;
  email: string | null;
  email_opt_out: boolean;
  practices: {
    name: string;
    contact_email: string | null;
    email_sending_mode: 'platform_default' | 'custom_domain';
    custom_domain: string | null;
    custom_domain_sender_local_part: string;
    custom_domain_verified: boolean;
  } | null;
}

export interface PdfCopyInput {
  patientId: string;
  emailType: EmailType;
  subject: string;
  heading: string;
  /** Plain-text paragraphs after the greeting (escaped here). */
  paragraphs: string[];
  pdf: { filename: string; base64: string };
}

/** Returns true when the copy went out. */
export async function sendPdfCopy(supabase: SupabaseClient, input: PdfCopyInput): Promise<boolean> {
  const { data } = await supabase
    .from('patients')
    .select(
      'id, first_name, email, email_opt_out, practices(name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified)'
    )
    .eq('id', input.patientId)
    .maybeSingle();
  const patient = data as unknown as PatientRow | null;
  const practice = patient?.practices;
  if (!patient || !practice || !patient.email || patient.email_opt_out) return false;

  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });
  const subject = input.subject.replace(/[\r\n]+/g, ' ');
  const p = (text: string) => `<p style="margin:0 0 16px;line-height:1.5;">${text}</p>`;
  const bodyHtml =
    p(`Pozdravljeni ${escapeHtml(patient.first_name)},`) +
    input.paragraphs.map((t) => p(escapeHtml(t))).join('') +
    p(`Lep pozdrav,<br>${escapeHtml(practice.name)}`);
  const unsubscribeToken = await resolveUnsubscribeToken(supabase, patient.id);
  const html = wrapEmailLayout({ practiceName: practice.name, heading: input.heading, bodyHtml, unsubscribeUrl: unsubscribeUrl(unsubscribeToken) });

  try {
    const { messageId } = await sendEmail({
      to: patient.email,
      sender,
      replyTo: practice.contact_email,
      subject,
      html,
      attachmentIcs: null,
      attachments: [{ filename: input.pdf.filename, contentType: 'application/pdf', base64: input.pdf.base64 }],
    });
    await logEmail(supabase, {
      patientId: patient.id,
      appointmentId: null,
      emailType: input.emailType,
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
    console.error(`SES PDF copy failed for patient ${patient.id}:`, sendError);
    await logEmail(supabase, {
      patientId: patient.id,
      appointmentId: null,
      emailType: input.emailType,
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
