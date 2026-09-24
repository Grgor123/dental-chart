// Amazon SES wrapper — builds a raw MIME message (so it can always carry an
// optional .ics attachment) and sends it via SESv2's Content.Raw.Data,
// using the official AWS SDK v3 through Deno's native npm: specifier
// support (no hand-rolled SigV4 signing needed).
//
// Also resolves WHICH verified identity a given practice sends from: the
// shared platform domain by default, or a practice's own verified custom
// domain (supabase/migrations/016_add_email_notifications.sql,
// scripts/provision-practice-domain.mjs) — both live under the SAME AWS
// account/credentials already configured here, so this is just picking
// which already-verified "From" header to use, never a separate client or
// credential per domain.
import { SESv2Client, SendEmailCommand } from 'npm:@aws-sdk/client-sesv2@3';

const SES_ACCESS_KEY_ID = Deno.env.get('SES_ACCESS_KEY_ID')!;
const SES_SECRET_ACCESS_KEY = Deno.env.get('SES_SECRET_ACCESS_KEY')!;
const SES_REGION = Deno.env.get('SES_REGION')!;
// e.g. "notifications@mail.example.com" — the shared platform identity
// every practice sends from until/unless it has its own verified domain.
const SES_SENDER_ADDRESS = Deno.env.get('SES_SENDER_ADDRESS')!;

const sesClient = new SESv2Client({
  region: SES_REGION,
  credentials: { accessKeyId: SES_ACCESS_KEY_ID, secretAccessKey: SES_SECRET_ACCESS_KEY },
});

export interface PracticeSenderConfig {
  name: string;
  emailSendingMode: 'platform_default' | 'custom_domain';
  customDomain: string | null;
  customDomainSenderLocalPart: string;
  customDomainVerified: boolean;
}

export interface SenderIdentity {
  fromAddress: string;
  fromDomain: string;
  fromDisplayName: string;
}

// A practice mid-verification (or one whose mode was flipped before DNS
// actually propagated) silently falls back to the platform domain rather
// than sending from an unverified identity or failing outright — this is
// why customDomainVerified is checked, not just emailSendingMode.
export function resolveSenderIdentity(practice: PracticeSenderConfig): SenderIdentity {
  if (practice.emailSendingMode === 'custom_domain' && practice.customDomainVerified && practice.customDomain) {
    return {
      fromAddress: `${practice.customDomainSenderLocalPart}@${practice.customDomain}`,
      fromDomain: practice.customDomain,
      fromDisplayName: practice.name,
    };
  }
  const fromDomain = SES_SENDER_ADDRESS.split('@')[1] ?? SES_SENDER_ADDRESS;
  return { fromAddress: SES_SENDER_ADDRESS, fromDomain, fromDisplayName: practice.name };
}

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// MIME line-wrap for base64 content — RFC 2045 recommends 76 chars/line.
function wrapBase64(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) return false;
  }
  return true;
}

// RFC 2047 encoded-word — only needed for headers containing non-ASCII
// (Slovene č/š/ž show up in practice names and subjects).
function encodeHeaderValue(text: string): string {
  if (isAscii(text)) return text;
  return `=?UTF-8?B?${utf8Base64(text)}?=`;
}

export interface SendEmailInput {
  to: string;
  sender: SenderIdentity;
  replyTo?: string | null;
  subject: string;
  html: string;
  attachmentIcs?: { filename: string; content: string; method?: 'REQUEST' | 'CANCEL' } | null;
}

export async function sendEmail(input: SendEmailInput): Promise<{ messageId: string | null }> {
  const boundary = `----=_Part_${crypto.randomUUID()}`;
  const fromHeader = `${encodeHeaderValue(input.sender.fromDisplayName)} <${input.sender.fromAddress}>`;

  const headers = [
    `From: ${fromHeader}`,
    `To: ${input.to}`,
    ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
    `Subject: ${encodeHeaderValue(input.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];

  const htmlPart = [
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(utf8Base64(input.html)),
  ].join('\r\n');

  const icsPart = input.attachmentIcs
    ? [
        `--${boundary}`,
        `Content-Type: text/calendar; charset=UTF-8; method=${input.attachmentIcs.method ?? 'REQUEST'}; name="${input.attachmentIcs.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${input.attachmentIcs.filename}"`,
        '',
        wrapBase64(utf8Base64(input.attachmentIcs.content)),
      ].join('\r\n')
    : '';

  const raw = [headers.join('\r\n'), '', htmlPart, ...(icsPart ? [icsPart] : []), `--${boundary}--`, ''].join('\r\n');

  const rawBytes = new TextEncoder().encode(raw);

  const result = await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: input.sender.fromAddress,
      Destination: { ToAddresses: [input.to] },
      Content: { Raw: { Data: rawBytes } },
    })
  );

  return { messageId: result.MessageId ?? null };
}
