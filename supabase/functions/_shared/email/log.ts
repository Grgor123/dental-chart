// Shared audit-log + unsubscribe-token helpers — both real send functions
// (send-appointment-confirmation-email, send-appointment-reminder-emails)
// call these, so the email_log write and the token lazy-creation live in
// exactly one place.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { TemplateKey } from './templateDefs.ts';

function randomToken(length = 24): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// One persistent token per patient (see the migration's own comment on
// patients.email_unsubscribe_token for why this differs from SMS's
// per-message tokens) — created the first time an email actually goes out
// to that patient, not eagerly at patient-creation time.
export async function resolveUnsubscribeToken(supabase: SupabaseClient, patientId: string): Promise<string> {
  const { data } = await supabase.from('patients').select('email_unsubscribe_token').eq('id', patientId).single();
  if (data?.email_unsubscribe_token) return data.email_unsubscribe_token as string;

  const token = randomToken();
  await supabase.from('patients').update({ email_unsubscribe_token: token }).eq('id', patientId);
  return token;
}

export type EmailLogStatus = 'sent' | 'failed';
// One email_log type per template key, plus 'invoice' (a staff-written
// message with the invoice PDF attached — not a template).
export type EmailType = TemplateKey | 'invoice';

export interface LogEmailInput {
  patientId?: string | null;
  appointmentId?: string | null;
  invoiceId?: string | null;
  emailType: EmailType;
  recipientEmail: string;
  subject: string;
  status: EmailLogStatus;
  providerMessageId?: string | null;
  senderDomain: string;
  errorMessage?: string | null;
  /** The HTML body as sent (migration 030) — shown in the patient's Sporočila tab. */
  bodyHtml?: string | null;
}

// Postgres "undefined column" / PostgREST "column not in schema cache": the
// insert names a column a not-yet-migrated database doesn't have.
export function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

export async function logEmail(supabase: SupabaseClient, input: LogEmailInput): Promise<void> {
  const row = {
    patient_id: input.patientId ?? null,
    appointment_id: input.appointmentId ?? null,
    // Only sent when set: the column exists from migration 026 on, and the
    // other functions sharing this helper mustn't depend on it.
    ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
    email_type: input.emailType,
    recipient_email: input.recipientEmail,
    subject: input.subject,
    status: input.status,
    provider_message_id: input.providerMessageId ?? null,
    sender_domain: input.senderDomain,
    error_message: input.errorMessage ?? null,
  };
  let { error } = await supabase.from('email_log').insert(input.bodyHtml ? { ...row, body_html: input.bodyHtml } : row);
  // Deployed before migration 030 ran: keep the audit row, just without the text.
  if (error && input.bodyHtml && isMissingColumn(error)) ({ error } = await supabase.from('email_log').insert(row));
  if (error) console.error('Failed to write email_log row:', error.message);
}
