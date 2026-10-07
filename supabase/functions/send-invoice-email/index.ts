// Deno Edge Function — sends an issued invoice by email, PDF attached (the
// "Pošlji po e-pošti" window in src/pages/InvoiceEditor.tsx).
//
// Called from the browser with the signed-in user's own session (default JWT
// verification ON). The invoice is read through a client carrying THAT
// user's JWT, so RLS decides whether this user may touch it at all — an
// invoice id from another practice simply isn't found. Only then does the
// service-role client read the practice's sender settings and write
// email_log.
//
// Subject, heading and message come from the practice's editable "Račun" /
// "Dobropis" templates (templateDefs.ts), filled in and possibly edited in the
// send window before they get here.
//
// The PDF is made in the browser from exactly the pages the preview shows
// (src/lib/invoicePdf.ts) and checked here to really be a PDF. Recipients are
// whatever staff typed (the patient's address is prefilled), capped at 5,
// each sent as a separate email so no recipient sees the others.
//
// Deploy: supabase functions deploy send-invoice-email
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveSenderIdentity, sendEmail } from '../_shared/email/send.ts';
import { renderPlainEmail } from '../_shared/email/templates.ts';
import { logEmail } from '../_shared/email/log.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_RECIPIENTS = 5;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

/** One line, no control characters — the subject goes into a raw MIME header. */
function singleLine(text: string, max: number): string {
  return text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => null);
  const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId : null;
  const subject = typeof body?.subject === 'string' ? singleLine(body.subject, 200) : '';
  // The heading inside the email, from the practice's "Račun"/"Dobropis"
  // template (E-pošta page); falls back to the invoice number below.
  const heading = typeof body?.heading === 'string' ? singleLine(body.heading, 200) : '';
  const message = typeof body?.message === 'string' ? body.message.slice(0, 5000) : '';
  const pdfBase64 = typeof body?.pdfBase64 === 'string' ? body.pdfBase64 : '';
  const filename = typeof body?.filename === 'string' ? body.filename : 'racun.pdf';
  const rawRecipients: unknown[] = Array.isArray(body?.to) ? body.to : [];

  const recipients = [...new Set(rawRecipients.filter((r): r is string => typeof r === 'string').map((r) => r.trim().toLowerCase()))];
  if (!invoiceId) return json({ error: 'Missing invoiceId' }, 400);
  if (recipients.length === 0) return json({ error: 'Vpišite vsaj enega prejemnika.' }, 400);
  if (recipients.length > MAX_RECIPIENTS) return json({ error: `Največ ${MAX_RECIPIENTS} prejemnikov naenkrat.` }, 400);
  const invalid = recipients.filter((r) => !EMAIL_RE.test(r));
  if (invalid.length > 0) return json({ error: `Neveljaven e-poštni naslov: ${invalid.join(', ')}` }, 400);
  if (!subject) return json({ error: 'Vpišite zadevo.' }, 400);

  // The attachment must really be a PDF of sane size.
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
  } catch {
    return json({ error: 'Priponka ni veljavna.' }, 400);
  }
  if (pdfBytes.length === 0 || pdfBytes.length > MAX_PDF_BYTES || new TextDecoder().decode(pdfBytes.slice(0, 5)) !== '%PDF-') {
    return json({ error: 'Priponka ni veljaven PDF.' }, 400);
  }

  // The invoice, through the user's own RLS.
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: invoice } = await asUser
    .from('invoices')
    .select('id, practice_id, patient_id, status, number')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!invoice) return json({ error: 'Račun ni bil najden.' }, 404);
  if (invoice.status !== 'issued') return json({ error: 'Po e-pošti je mogoče poslati le izdan račun.' }, 409);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: practice } = await service
    .from('practices')
    .select('name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified')
    .eq('id', invoice.practice_id)
    .single();
  if (!practice) return json({ error: 'Ordinacija ni bila najdena.' }, 500);
  const { data: settings } = await service
    .from('invoice_settings')
    .select('legal_name, email')
    .eq('practice_id', invoice.practice_id)
    .maybeSingle();

  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });
  // Replies go to the practice: the invoice-settings email first, else the
  // general contact address.
  const replyTo = (settings?.email as string | null) || practice.contact_email;
  const html = renderPlainEmail({
    practiceName: (settings?.legal_name as string | null) || practice.name,
    heading: heading || `Račun št. ${invoice.number}`,
    message,
  });

  const results: { to: string; status: 'sent' | 'failed'; error?: string }[] = [];
  for (const to of recipients) {
    try {
      const { messageId } = await sendEmail({
        to,
        sender,
        replyTo,
        subject,
        html,
        attachments: [{ filename, contentType: 'application/pdf', base64: pdfBase64 }],
      });
      await logEmail(service, {
        patientId: invoice.patient_id,
        invoiceId: invoice.id,
        emailType: 'invoice',
        recipientEmail: to,
        subject,
        status: 'sent',
        providerMessageId: messageId,
        senderDomain: sender.fromDomain,
      });
      results.push({ to, status: 'sent' });
    } catch (sendError) {
      const errorMessage = sendError instanceof Error ? sendError.message : String(sendError);
      console.error(`Invoice email to ${to} failed:`, sendError);
      await logEmail(service, {
        patientId: invoice.patient_id,
        invoiceId: invoice.id,
        emailType: 'invoice',
        recipientEmail: to,
        subject,
        status: 'failed',
        senderDomain: sender.fromDomain,
        errorMessage,
      });
      results.push({ to, status: 'failed', error: errorMessage });
    }
  }

  const anySent = results.some((r) => r.status === 'sent');
  return json({ results }, anySent ? 200 : 502);
});
