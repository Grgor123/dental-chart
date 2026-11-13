// The patient's copy of a signed consent (Gregor, 2026-11-12): emailed right
// after signing (patient-consent function) — a short message with the signed
// consent as a PDF (consentPdf.ts) attached, through the shared sendPdfCopy.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendPdfCopy } from './sendPdfCopy.ts';

/** Returns true when the copy went out. */
export async function sendConsentCopy(
  supabase: SupabaseClient,
  consentId: string,
  pdf: { filename: string; base64: string }
): Promise<boolean> {
  const { data } = await supabase.from('patient_consents').select('patient_id, title').eq('id', consentId).maybeSingle();
  if (!data) return false;
  return await sendPdfCopy(supabase, {
    patientId: data.patient_id as string,
    emailType: 'patient_consent',
    subject: `Kopija podpisanega soglasja — ${data.title as string}`,
    heading: 'Kopija podpisanega soglasja',
    paragraphs: [
      `V priponki vam pošiljamo kopijo soglasja »${data.title as string}«, ki ste ga podpisali. Shranite si jo za svojo evidenco.`,
      'Če imate vprašanja, nam odgovorite na to sporočilo ali nas pokličite.',
    ],
    pdf,
  });
}
