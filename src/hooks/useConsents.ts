import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';

// Informed consents (migration 058): the practice's library of consent forms
// (useConsentTemplates — Nastavitve → Soglasja) and one patient's consents
// (usePatientConsents — the patient record's "Soglasja" tab). The patient
// signs on their phone (or the practice tablet) through the QR code shown in
// the practice, or at home from an emailed link (Gregor, 2026-11-12).

export interface ConsentTemplate {
  id: string;
  title: string;
  body: string;
  sortOrder: number;
  isActive: boolean;
  needsReview: boolean;
}

export function useConsentTemplates() {
  const { practiceId } = usePracticeContext();
  const [templates, setTemplates] = useState<ConsentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error: fetchError } = await supabase
        .from('consent_templates')
        .select('id, title, body, sort_order, is_active, needs_review')
        .order('sort_order')
        .order('title');
      if (cancelled) return;
      if (fetchError) setError(fetchError.message);
      else {
        setError(null);
        setTemplates(
          (data ?? []).map((r) => ({
            id: r.id,
            title: r.title,
            body: r.body,
            sortOrder: r.sort_order,
            isActive: r.is_active,
            needsReview: r.needs_review,
          }))
        );
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  /** A new form — created only when first saved (an empty one never lands
   *  in the library or the patient record's list). */
  const createTemplate = useCallback(async (fields: { title: string; body: string; isActive: boolean }): Promise<{ id?: string; error?: string }> => {
    if (!practiceId) return { error: 'Ordinacija ni najdena.' };
    const nextOrder = templates.reduce((max, t) => Math.max(max, t.sortOrder), 0) + 10;
    const { data, error: insertError } = await supabase
      .from('consent_templates')
      .insert({ practice_id: practiceId, title: fields.title.trim(), body: fields.body, is_active: fields.isActive, sort_order: nextOrder })
      .select('id')
      .single();
    if (insertError) return { error: insertError.message };
    reload();
    return { id: data.id as string };
  }, [practiceId, templates, reload]);

  /** Saving is the review: it clears "Osnutek — preglejte". */
  const saveTemplate = useCallback(
    async (id: string, fields: { title: string; body: string; isActive: boolean }): Promise<{ error?: string }> => {
      const { error: updateError } = await supabase
        .from('consent_templates')
        .update({ title: fields.title.trim(), body: fields.body, is_active: fields.isActive, needs_review: false, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (updateError) return { error: updateError.message };
      reload();
      return {};
    },
    [reload]
  );

  const deleteTemplate = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const { error: deleteError } = await supabase.from('consent_templates').delete().eq('id', id);
      if (deleteError) return { error: deleteError.message };
      reload();
      return {};
    },
    [reload]
  );

  const addDefaults = useCallback(async (): Promise<{ error?: string }> => {
    const { error: rpcError } = await supabase.rpc('add_default_consent_templates');
    if (rpcError) return { error: rpcError.message };
    reload();
    return {};
  }, [reload]);

  return { templates, loading, error, createTemplate, saveTemplate, deleteTemplate, addDefaults };
}

export interface PatientConsent {
  id: string;
  templateId: string | null;
  title: string;
  body: string;
  details: string | null;
  createdAt: string;
  createdByName: string | null;
  sentAt: string | null;
  expiresAt: string;
  explainedAt: string | null;
  explainedByName: string | null;
  signedAt: string | null;
  signedVia: 'tablet' | 'link' | 'device' | null;
  signerName: string | null;
  signaturePng: string | null;
  cancelledAt: string | null;
}

export function usePatientConsents(patientId: string) {
  const { practiceId } = usePracticeContext();
  const [consents, setConsents] = useState<PatientConsent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error: fetchError } = await supabase
        .from('patient_consents')
        .select(
          'id, template_id, title, body, details, created_at, created_by_name, sent_at, expires_at, explained_at, explained_by_name, signed_at, signed_via, signer_name, signature_png, cancelled_at'
        )
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (fetchError) setError(fetchError.message);
      else {
        setError(null);
        setConsents(
          (data ?? []).map((r) => ({
            id: r.id,
            templateId: r.template_id,
            title: r.title,
            body: r.body,
            details: r.details,
            createdAt: r.created_at,
            createdByName: r.created_by_name,
            sentAt: r.sent_at,
            expiresAt: r.expires_at,
            explainedAt: r.explained_at,
            explainedByName: r.explained_by_name,
            signedAt: r.signed_at,
            signedVia: r.signed_via,
            signerName: r.signer_name,
            signaturePng: r.signature_png,
            cancelledAt: r.cancelled_at,
          }))
        );
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [patientId, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // A patient signing through the emailed link happens elsewhere — refresh on
  // returning to the window.
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  const createConsent = useCallback(
    async (input: { templateId: string | null; title: string; body: string; details: string }): Promise<{ id?: string; error?: string }> => {
      const { data, error: insertError } = await supabase
        .from('patient_consents')
        .insert({
          patient_id: patientId,
          template_id: input.templateId,
          title: input.title.trim(),
          body: input.body,
          details: input.details.trim() || null,
          // Re-derived from the patient by the database (prepare_patient_consent);
          // sent for the insert policy's check.
          practice_id: practiceId,
        })
        .select('id')
        .single();
      if (insertError) return { error: insertError.message };
      reload();
      return { id: data.id as string };
    },
    [patientId, practiceId, reload]
  );

  const rpc = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<{ error?: string }> => {
      const { error: rpcError } = await supabase.rpc(name, args);
      if (rpcError) return { error: rpcError.message };
      reload();
      return {};
    },
    [reload]
  );

  const confirmExplained = useCallback((id: string) => rpc('confirm_consent_explained', { p_consent_id: id }), [rpc]);
  const cancelConsent = useCallback((id: string) => rpc('cancel_patient_consent', { p_consent_id: id }), [rpc]);
  /** The consent's link token for the QR code (keeps the link valid a day). */
  const prepareLink = useCallback(async (id: string): Promise<{ token?: string; error?: string }> => {
    const { data, error: rpcError } = await supabase.rpc('prepare_consent_link', { p_consent_id: id });
    if (rpcError) return { error: rpcError.message };
    return { token: data as string };
  }, []);

  /** Emails the patient the link (send-patient-consent); the explanation must be confirmed first. */
  const sendByEmail = useCallback(
    async (id: string): Promise<{ sentTo?: string; error?: string }> => {
      const { data, error: fnError } = await supabase.functions.invoke('send-patient-consent', { body: { consentId: id } });
      if (fnError) {
        let message = fnError.message;
        const context = (fnError as { context?: Response }).context;
        if (context && typeof context.json === 'function') {
          const payload = await context.json().catch(() => null);
          if (payload?.error) message = payload.error;
        }
        return { error: message };
      }
      reload();
      return { sentTo: (data as { sentTo?: string }).sentTo };
    },
    [reload]
  );

  return { consents, loading, error, reload, createConsent, confirmExplained, cancelConsent, prepareLink, sendByEmail };
}

