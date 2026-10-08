// Sends the health questionnaire (vprašalnik o zdravju) email — the one send
// path for both the automatic send when an appointment is confirmed and the
// manual "Pošlji vprašalnik" button (both via send-health-questionnaire).
//
// Rules:
//   - automatic (force = false): skipped if the patient submitted one in the
//     last 12 months, if a still-valid link is already out, or if the
//     practice switched the template off;
//   - manual (force = true): always sends — staff asked for it — but reuses a
//     still-valid unsubmitted link instead of opening a second one, so the
//     patient only ever has one open questionnaire.
// Either way the email needs an address on file and no email opt-out.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail, resolveSenderIdentity } from './send.ts';
import { renderTemplate } from './templates.ts';
import { logEmail, resolveUnsubscribeToken } from './log.ts';
import { loadTemplateOverride, UNSUBSCRIBE_PAGE_URL, type SendOutcome } from './sendAppointmentEmail.ts';

export const QUESTIONNAIRE_PAGE_URL = 'https://grgor123.github.io/dental-chart/health-questionnaire.html';

const LINK_VALID_DAYS = 30;
const RESEND_AFTER_MONTHS = 12;

function randomToken(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

interface PatientRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  email_opt_out: boolean;
  practice_id: string;
  practices: {
    name: string;
    contact_email: string | null;
    email_sending_mode: 'platform_default' | 'custom_domain';
    custom_domain: string | null;
    custom_domain_sender_local_part: string;
    custom_domain_verified: boolean;
  } | null;
}

export async function sendQuestionnaireEmail(
  supabase: SupabaseClient,
  params: { patientId: string; appointmentId: string | null; force: boolean }
): Promise<SendOutcome> {
  const { patientId, appointmentId, force } = params;

  const { data, error } = await supabase
    .from('patients')
    .select(
      'id, first_name, last_name, email, email_opt_out, practice_id, practices(name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified)'
    )
    .eq('id', patientId)
    .single();
  if (error || !data) return { status: 'skipped', reason: 'patient not found' };
  const patient = data as unknown as PatientRow;
  const practice = patient.practices;
  if (!patient.email || patient.email_opt_out || !practice) {
    return { status: 'skipped', reason: 'no address on file, opted out, or missing data' };
  }

  const override = await loadTemplateOverride(supabase, patient.practice_id, 'health_questionnaire');
  if (!force && override && !override.enabled) return { status: 'skipped', reason: 'template disabled' };

  const now = new Date();
  if (!force) {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - RESEND_AFTER_MONTHS);
    const { data: recent } = await supabase
      .from('health_questionnaires')
      .select('id')
      .eq('patient_id', patientId)
      .gte('submitted_at', cutoff.toISOString())
      .limit(1);
    if (recent && recent.length > 0) return { status: 'skipped', reason: 'questionnaire submitted within 12 months' };
  }

  const expiresAt = new Date(now.getTime() + LINK_VALID_DAYS * 86400000).toISOString();

  // One open questionnaire per patient: reuse a still-valid, unsubmitted link.
  const { data: open } = await supabase
    .from('health_questionnaires')
    .select('id, token')
    .eq('patient_id', patientId)
    .is('submitted_at', null)
    .gt('expires_at', now.toISOString())
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let token: string;
  if (open) {
    if (!force) return { status: 'skipped', reason: 'a questionnaire link is already open' };
    token = open.token as string;
    await supabase.from('health_questionnaires').update({ sent_at: now.toISOString(), expires_at: expiresAt }).eq('id', open.id);
  } else {
    token = randomToken();
    const { error: insertError } = await supabase.from('health_questionnaires').insert({
      patient_id: patientId,
      appointment_id: appointmentId,
      token,
      expires_at: expiresAt,
    });
    if (insertError) return { status: 'failed', error: insertError.message };
  }

  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });
  const unsubscribeToken = await resolveUnsubscribeToken(supabase, patient.id);
  const content = renderTemplate(
    'health_questionnaire',
    override,
    { ime: patient.first_name, priimek: patient.last_name, datum: '', ura: '', storitev: '', terapevt: '', ordinacija: practice.name },
    {
      practiceName: practice.name,
      unsubscribeUrl: `${UNSUBSCRIBE_PAGE_URL}?token=${unsubscribeToken}`,
      actionUrl: `${QUESTIONNAIRE_PAGE_URL}?token=${token}`,
    }
  );

  try {
    const { messageId } = await sendEmail({
      to: patient.email,
      sender,
      replyTo: practice.contact_email,
      subject: content.subject,
      html: content.html,
      attachmentIcs: null,
    });
    await logEmail(supabase, {
      patientId: patient.id,
      appointmentId,
      emailType: 'health_questionnaire',
      recipientEmail: patient.email,
      subject: content.subject,
      bodyHtml: content.html,
      status: 'sent',
      providerMessageId: messageId,
      senderDomain: sender.fromDomain,
    });
    return { status: 'sent' };
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : String(sendError);
    console.error(`SES questionnaire send failed for patient ${patient.id}:`, sendError);
    await logEmail(supabase, {
      patientId: patient.id,
      appointmentId,
      emailType: 'health_questionnaire',
      recipientEmail: patient.email,
      subject: content.subject,
      bodyHtml: content.html,
      status: 'failed',
      senderDomain: sender.fromDomain,
      errorMessage: message,
    });
    return { status: 'failed', error: message };
  }
}
