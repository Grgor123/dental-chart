// The one send path for every appointment-scoped email (confirmation,
// reminder, cancelled, rescheduled, post-visit, recall). Each Edge Function
// only decides WHICH appointment gets WHICH template and WHEN; everything
// from "should this actually go out" through render, optional .ics, SES send
// and the email_log write happens here, so the opt-out check, template
// override, dedup and logging live in exactly one place.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail, resolveSenderIdentity } from './send.ts';
import { buildTemplateVars, renderTemplate } from './templates.ts';
import { buildIcsEvent } from './ics.ts';
import { logEmail, resolveUnsubscribeToken } from './log.ts';
import { TEMPLATE_DEFS, type TemplateKey, type TemplateOverride } from './templateDefs.ts';

export const UNSUBSCRIBE_PAGE_URL = 'https://grgor123.github.io/dental-chart/email-unsubscribe.html';

export const APPOINTMENT_SELECT =
  'id, starts_at, ends_at, service, practice_id, patients(id, first_name, last_name, email, email_opt_out), practices(id, name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified), therapists(name)';

interface PatientJoin {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  email_opt_out: boolean;
}
interface PracticeJoin {
  id: string;
  name: string;
  contact_email: string | null;
  email_sending_mode: 'platform_default' | 'custom_domain';
  custom_domain: string | null;
  custom_domain_sender_local_part: string;
  custom_domain_verified: boolean;
}
interface AppointmentRow {
  id: string;
  starts_at: string;
  ends_at: string;
  service: string | null;
  practice_id: string;
  patients: PatientJoin | null;
  practices: PracticeJoin | null;
  therapists: { name: string } | null;
}

export type SendOutcome = { status: 'sent' } | { status: 'skipped'; reason: string } | { status: 'failed'; error: string };

const OVERRIDE_COLUMNS = 'subject, heading, body, enabled, timing_value, send_hour';

// A practice's override row for one template, or null (= platform defaults).
export async function loadTemplateOverride(
  supabase: SupabaseClient,
  practiceId: string,
  key: TemplateKey
): Promise<TemplateOverride | null> {
  const { data } = await supabase
    .from('email_templates')
    .select(OVERRIDE_COLUMNS)
    .eq('practice_id', practiceId)
    .eq('template_key', key)
    .maybeSingle();
  return (data as TemplateOverride | null) ?? null;
}

// Every practice's override for one template, keyed by practice id — for the
// cron functions, which walk all practices each run.
export async function loadAllOverrides(supabase: SupabaseClient, key: TemplateKey): Promise<Map<string, TemplateOverride>> {
  const { data } = await supabase.from('email_templates').select(`practice_id, ${OVERRIDE_COLUMNS}`).eq('template_key', key);
  const byPractice = new Map<string, TemplateOverride>();
  for (const row of (data ?? []) as unknown as (TemplateOverride & { practice_id: string })[]) {
    byPractice.set(row.practice_id, row);
  }
  return byPractice;
}

export async function sendAppointmentEmail(
  supabase: SupabaseClient,
  params: { appointmentId: string; templateKey: TemplateKey }
): Promise<SendOutcome> {
  const { appointmentId, templateKey } = params;
  const def = TEMPLATE_DEFS[templateKey];

  // Dedup first (cheap) — the unique index on (appointment_id, email_type)
  // would reject a second log row anyway, but that only fires AFTER the SES
  // send, so checking here avoids a duplicate real email. Rescheduled is the
  // one type that may repeat (an appointment can move more than once), and
  // is excluded from that index for the same reason.
  if (templateKey !== 'appointment_rescheduled') {
    const { data: existing } = await supabase
      .from('email_log')
      .select('id')
      .eq('appointment_id', appointmentId)
      .eq('email_type', templateKey)
      .maybeSingle();
    if (existing) return { status: 'skipped', reason: 'already sent' };
  }

  const { data, error } = await supabase.from('appointments').select(APPOINTMENT_SELECT).eq('id', appointmentId).single();
  if (error || !data) return { status: 'skipped', reason: 'appointment not found' };
  const appointment = data as unknown as AppointmentRow;

  const patient = appointment.patients;
  const practice = appointment.practices;
  if (!patient || !patient.email || patient.email_opt_out || !practice) {
    return { status: 'skipped', reason: 'no address on file, opted out, or missing data' };
  }

  const override = await loadTemplateOverride(supabase, appointment.practice_id, templateKey);
  if (override && !override.enabled) return { status: 'skipped', reason: 'template disabled' };

  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });

  const unsubscribeToken = await resolveUnsubscribeToken(supabase, patient.id);
  const unsubscribeUrl = `${UNSUBSCRIBE_PAGE_URL}?token=${unsubscribeToken}`;

  const vars = buildTemplateVars({
    practiceName: practice.name,
    firstName: patient.first_name,
    lastName: patient.last_name,
    startsAt: appointment.starts_at,
    service: appointment.service,
    therapistName: appointment.therapists?.name ?? null,
  });
  const content = renderTemplate(templateKey, override, vars, { practiceName: practice.name, unsubscribeUrl });

  let attachmentIcs: { filename: string; content: string; method: 'REQUEST' | 'CANCEL' } | null = null;
  if (def.ics) {
    const method = def.ics === 'cancel' ? 'CANCEL' : 'REQUEST';
    attachmentIcs = {
      filename: 'termin.ics',
      method,
      content: buildIcsEvent({
        appointmentId: appointment.id,
        startsAt: appointment.starts_at,
        endsAt: appointment.ends_at,
        summary: appointment.service ? `Termin: ${appointment.service}` : 'Zobozdravstveni termin',
        organizerEmail: practice.contact_email || sender.fromAddress,
        organizerName: practice.name,
        method,
        // The first confirmation is sequence 0; every later update/cancel
        // must be higher than whatever came before it, and a unix timestamp
        // always is.
        sequence: templateKey === 'appointment_confirmation' ? 0 : Math.floor(Date.now() / 1000),
      }),
    };
  }

  try {
    const { messageId } = await sendEmail({
      to: patient.email,
      sender,
      replyTo: practice.contact_email,
      subject: content.subject,
      html: content.html,
      attachmentIcs,
    });
    await logEmail(supabase, {
      patientId: patient.id,
      appointmentId: appointment.id,
      emailType: templateKey,
      recipientEmail: patient.email,
      subject: content.subject,
      status: 'sent',
      providerMessageId: messageId,
      senderDomain: sender.fromDomain,
    });
    return { status: 'sent' };
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : String(sendError);
    console.error(`SES ${templateKey} send failed for appointment ${appointment.id}:`, sendError);
    await logEmail(supabase, {
      patientId: patient.id,
      appointmentId: appointment.id,
      emailType: templateKey,
      recipientEmail: patient.email,
      subject: content.subject,
      status: 'failed',
      senderDomain: sender.fromDomain,
      errorMessage: message,
    });
    return { status: 'failed', error: message };
  }
}
