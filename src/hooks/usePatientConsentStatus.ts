import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { PatientListItem } from './usePatients';

// The patient record's consent badges, kept live (migration 040): SMS consent,
// email opt-out / bounce, marketing consent, and whether a "Pošlji soglasje"
// request is still waiting for the patient. These change outside the page —
// the patient confirms by SMS or email, a bounce arrives — so the page listens
// through Supabase Realtime (RLS applies) and also re-reads when the window is
// looked at again, same as the Sporočila tab (usePatientMessages.ts).

export type ConsentStatus = Pick<PatientListItem, 'smsConsentStatus' | 'emailOptOut' | 'emailBounced' | 'marketingConsent'> & {
  /** A marketing consent request is sent and not yet confirmed or expired. */
  consentRequestPending: boolean;
};

export function usePatientConsentStatus(patientId: string) {
  const [status, setStatus] = useState<ConsentStatus | null>(null);

  const reload = useCallback(async () => {
    const patient = await supabase
      .from('patients')
      .select('sms_consent_status, email_opt_out, email_bounced, marketing_consent, marketing_consent_at')
      .eq('id', patientId)
      .maybeSingle();
    if (patient.error || !patient.data) return;
    const row = patient.data;
    // Only a request sent after the last consent change is still waiting — an
    // older unanswered one is overtaken by the patient's later answer.
    let requestQuery = supabase
      .from('marketing_consent_requests')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .is('confirmed_at', null)
      .gt('expires_at', new Date().toISOString());
    if (row.marketing_consent_at) requestQuery = requestQuery.gt('created_at', row.marketing_consent_at as string);
    const requests = await requestQuery;
    setStatus({
      smsConsentStatus: (row.sms_consent_status as ConsentStatus['smsConsentStatus']) ?? 'unknown',
      emailOptOut: (row.email_opt_out as boolean | null) ?? false,
      emailBounced: (row.email_bounced as boolean | null) ?? false,
      marketingConsent: (row.marketing_consent as boolean | null) ?? false,
      // Before migration 039/040 the table may not exist — treat as none.
      consentRequestPending: !requests.error && (requests.count ?? 0) > 0,
    });
  }, [patientId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, 300);
    };
    const channel = supabase
      .channel(`patient-consent-${patientId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'patients', filter: `id=eq.${patientId}` }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'marketing_consent_requests', filter: `patient_id=eq.${patientId}` }, soon)
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') soon();
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
  }, [patientId, reload]);

  return { status, reload };
}
