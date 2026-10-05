import { useCallback, useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { ContactData, QuestionnaireAnswers } from '../../supabase/functions/_shared/questionnaire';

// One patient's health questionnaires (migration
// 021_add_health_questionnaires.sql) for the Patient Record page: the latest
// submitted one (what the red banner and the "Vprašalnik" view show) and
// whether a link is currently out waiting. Sending goes through the
// send-health-questionnaire Edge Function; reviewing and applying contact
// corrections are plain RLS-scoped updates.

export interface HealthQuestionnaire {
  id: string;
  sentAt: string;
  expiresAt: string;
  submittedAt: string | null;
  language: 'sl' | 'en' | null;
  answers: QuestionnaireAnswers | null;
  signatureName: string | null;
  submittedContact: ContactData | null;
  contactAppliedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

const COLUMNS =
  'id, sent_at, expires_at, submitted_at, language, answers, signature_name, submitted_contact, contact_applied_at, reviewed_at, reviewed_by';

function rowToQuestionnaire(row: Record<string, unknown>): HealthQuestionnaire {
  return {
    id: row.id as string,
    sentAt: row.sent_at as string,
    expiresAt: row.expires_at as string,
    submittedAt: (row.submitted_at as string | null) ?? null,
    language: (row.language as 'sl' | 'en' | null) ?? null,
    answers: (row.answers as QuestionnaireAnswers | null) ?? null,
    signatureName: (row.signature_name as string | null) ?? null,
    submittedContact: (row.submitted_contact as ContactData | null) ?? null,
    contactAppliedAt: (row.contact_applied_at as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    reviewedBy: (row.reviewed_by as string | null) ?? null,
  };
}

async function sendErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      const reason = body && typeof body.error === 'string' ? body.error : '';
      if (reason.includes('no address')) return 'Pacient nima e-poštnega naslova ali je odjavljen od e-poštnih obvestil.';
      if (reason) return reason;
    } catch {
      // fall through to the generic message
    }
  }
  return 'Pošiljanje ni uspelo.';
}

export function useHealthQuestionnaire(patientId: string) {
  const [latestSubmitted, setLatestSubmitted] = useState<HealthQuestionnaire | null>(null);
  const [pending, setPending] = useState<HealthQuestionnaire | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('health_questionnaires')
      .select(COLUMNS)
      .eq('patient_id', patientId)
      .order('sent_at', { ascending: false })
      .limit(20);
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []).map((r) => rowToQuestionnaire(r as Record<string, unknown>));
    const submitted = rows
      .filter((q) => q.submittedAt)
      .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
    const now = new Date().toISOString();
    setLatestSubmitted(submitted[0] ?? null);
    setPending(rows.find((q) => !q.submittedAt && q.expiresAt > now) ?? null);
    setError(null);
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const send = useCallback(async (): Promise<{ error?: string }> => {
    const { error: invokeError } = await supabase.functions.invoke('send-health-questionnaire', { body: { patientId } });
    if (invokeError) return { error: await sendErrorMessage(invokeError) };
    await reload();
    return {};
  }, [patientId, reload]);

  // "Pregledano" — the paper form's "Inspected by". Records the signed-in
  // staff member's login email, so it's clear who read it.
  const markReviewed = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const { data: userData } = await supabase.auth.getUser();
      const { error: updateError } = await supabase
        .from('health_questionnaires')
        .update({ reviewed_at: new Date().toISOString(), reviewed_by: userData.user?.email ?? null })
        .eq('id', id);
      if (updateError) return { error: updateError.message };
      await reload();
      return {};
    },
    [reload]
  );

  // Applying or dismissing the patient's contact corrections both just close
  // the notice; the actual patient update (if applying) is the caller's
  // updatePatient() call, so it goes through the same path as Frame 2's Shrani.
  const markContactHandled = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const { error: updateError } = await supabase
        .from('health_questionnaires')
        .update({ contact_applied_at: new Date().toISOString() })
        .eq('id', id);
      if (updateError) return { error: updateError.message };
      await reload();
      return {};
    },
    [reload]
  );

  return { latestSubmitted, pending, loading, error, send, markReviewed, markContactHandled };
}
