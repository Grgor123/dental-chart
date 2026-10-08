import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { TEMPLATE_DEFS, type TemplateKey } from '../../supabase/functions/_shared/email/templateDefs';

// One patient's communication history — every email and SMS the app sent
// them, newest first (Patient Record → Frame 3 → "Sporočila"). Read from the
// three audit tables the senders already write; the message text itself
// isn't stored anywhere, so each entry shows what was sent, to where, when,
// and what became of it (delivered / bounced / confirmed …).
//   - email_log: every email (appointment, questionnaire, invoice) — has
//     patient_id directly.
//   - appointment_reminders: the SMS reminder per appointment — linked to the
//     patient through the appointment.
//   - patient_sms_consents: the one-button SMS asking for reminder consent.

export type MessageChannel = 'email' | 'sms';
export type MessageTone = 'ok' | 'neutral' | 'warn' | 'error';

export interface PatientMessage {
  id: string;
  channel: MessageChannel;
  /** ISO timestamp of the send. */
  sentAt: string;
  title: string;
  /** Recipient address / phone number (for an email, with its type). */
  recipient: string;
  status: string;
  tone: MessageTone;
  /** Extra line, e.g. the patient's reply to an SMS reminder. */
  note: string | null;
  /** The message exactly as sent (migration 030): SMS text, or the email's
      HTML body. Null for messages sent before it was stored. */
  text: string | null;
}

type Row = Record<string, unknown>;

const EMAIL_STATUS: Record<string, { label: string; tone: MessageTone }> = {
  sent: { label: 'Poslano', tone: 'neutral' },
  delivered: { label: 'Dostavljeno', tone: 'ok' },
  bounced: { label: 'Vrnjeno — napačen naslov', tone: 'error' },
  complained: { label: 'Označeno kot neželeno', tone: 'warn' },
  failed: { label: 'Pošiljanje ni uspelo', tone: 'error' },
};

const SMS_DELIVERY: Record<string, { label: string; tone: MessageTone }> = {
  DELIVERED: { label: 'Dostavljeno', tone: 'ok' },
  SENT: { label: 'Poslano', tone: 'neutral' },
  FAILED: { label: 'Ni dostavljeno', tone: 'error' },
  REJECTED: { label: 'Ni dostavljeno', tone: 'error' },
  CANCELLED: { label: 'Preklicano', tone: 'warn' },
  UNKNOWN: { label: 'Poslano', tone: 'neutral' },
};

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('sl-SI', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Ljubljana' });
}

function emailToMessage(row: Row): PatientMessage {
  const type = row.email_type as string;
  const label = type in TEMPLATE_DEFS ? TEMPLATE_DEFS[type as TemplateKey].label : 'E-pošta';
  const status = EMAIL_STATUS[row.status as string] ?? EMAIL_STATUS.sent;
  return {
    id: `email-${row.id as string}`,
    channel: 'email',
    sentAt: row.sent_at as string,
    title: row.subject as string,
    recipient: `${label} · ${row.recipient_email as string}`,
    status: status.label,
    tone: status.tone,
    note: row.status === 'failed' && row.error_message ? (row.error_message as string) : null,
    text: (row.body_html as string | null | undefined) ?? null,
  };
}

function reminderToMessage(row: Row): PatientMessage {
  const appointment = row.appointments as { starts_at: string } | null;
  const delivery = SMS_DELIVERY[(row.delivery_status as string | null) ?? 'SENT'] ?? SMS_DELIVERY.SENT;
  const reply =
    row.status === 'confirmed'
      ? `Pacient je potrdil prihod${row.replied_at ? ` (${dateTime(row.replied_at as string)})` : ''}.`
      : row.status === 'declined'
        ? `Pacient je odpovedal termin${row.replied_at ? ` (${dateTime(row.replied_at as string)})` : ''}.`
        : null;
  return {
    id: `reminder-${row.id as string}`,
    channel: 'sms',
    sentAt: row.sent_at as string,
    title: appointment ? `Opomnik na termin ${dateTime(appointment.starts_at)}` : 'Opomnik na termin',
    recipient: row.patient_phone as string,
    status: delivery.label,
    tone: delivery.tone,
    note: reply,
    text: (row.message_text as string | null | undefined) ?? null,
  };
}

function consentToMessage(row: Row, phone: string | null): PatientMessage {
  const granted = row.granted_at as string | null;
  return {
    id: `consent-${row.id as string}`,
    channel: 'sms',
    sentAt: row.requested_at as string,
    title: 'Prošnja za soglasje za SMS opomnike',
    recipient: phone ?? '',
    status: granted ? 'Soglasje dano' : 'Brez odgovora',
    tone: granted ? 'ok' : 'neutral',
    note: granted ? `Potrjeno ${dateTime(granted)}.` : null,
    text: (row.message_text as string | null | undefined) ?? null,
  };
}

export function usePatientMessages(patientId: string, phone: string | null, live = false) {
  const [messages, setMessages] = useState<PatientMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const load = (withText: boolean) => {
      // Typed as plain strings so the query builder doesn't try to parse them.
      const emailCols: string = `id, email_type, recipient_email, subject, status, error_message, sent_at${withText ? ', body_html' : ''}`;
      const reminderCols: string = `id, sent_at, status, replied_at, delivery_status, patient_phone${withText ? ', message_text' : ''}, appointments!inner(patient_id, starts_at)`;
      const consentCols: string = `id, requested_at, granted_at${withText ? ', message_text' : ''}`;
      return Promise.all([
        supabase
          .from('email_log')
          .select(emailCols)
          .eq('patient_id', patientId),
        supabase
          .from('appointment_reminders')
          .select(reminderCols)
          .eq('appointments.patient_id', patientId),
        supabase
          .from('patient_sms_consents')
          .select(consentCols)
          .eq('patient_id', patientId),
      ]);
    };
    let [emails, reminders, consents] = await load(true);
    // Before migration 030 the text columns don't exist — list without them.
    if ([emails, reminders, consents].some((r) => r.error?.code === '42703')) {
      [emails, reminders, consents] = await load(false);
    }
    const firstError = emails.error ?? reminders.error ?? consents.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }
    const all = [
      ...((emails.data ?? []) as unknown as Row[]).map(emailToMessage),
      ...((reminders.data ?? []) as unknown as Row[]).map(reminderToMessage),
      ...((consents.data ?? []) as unknown as Row[]).map((row) => consentToMessage(row, phone)),
    ].sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
    setMessages(all);
    setError(null);
    setLoading(false);
  }, [patientId, phone]);

  useEffect(() => {
    reload();
  }, [reload]);

  // While shown: Supabase Realtime pushes every insert/update on the message
  // tables (migration 031) — a new send, or a delivery report from the SES /
  // Lertify webhooks — and the list reloads. Realtime applies RLS, so only
  // this practice's rows arrive. Also reloads when the window is looked at
  // again, in case the connection dropped while the computer slept.
  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Several rows can change at once (e.g. one email per recipient).
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, 300);
    };
    const channel = supabase
      .channel(`patient-messages-${patientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_log', filter: `patient_id=eq.${patientId}` }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_sms_consents', filter: `patient_id=eq.${patientId}` }, soon)
      // No patient column here (it hangs off the appointment), so any change
      // in the practice reloads — rare, and harmless.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointment_reminders' }, soon)
      .subscribe((status) => {
        // (Re)connected: catch up on anything missed while disconnected.
        if (status === 'SUBSCRIBED') soon();
      });
    const onVisible = () => {
      if (!document.hidden) soon();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [live, patientId, reload]);

  return { messages, loading, error, reload };
}

export function formatMessageTime(iso: string): string {
  return dateTime(iso);
}
