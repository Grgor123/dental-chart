import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';

// FURS davčno potrjevanje on the browser side (migration 032):
//   - the signed-in user's own profile (name + personal tax number, which FURS
//     records as the operator of every invoice they issue);
//   - the practice's business premise registration (furs_premises — read-only
//     here; furs-register-premise writes it after FURS accepts).
// FURS is "on" for the practice once its premise is registered: from then on
// every cash/card invoice is sent to FURS right after issuing.

export interface UserProfile {
  fullName: string;
  taxNumber: string;
}

export interface FursPremiseData {
  cadastralNumber: string;
  buildingNumber: string;
  buildingSectionNumber: string;
  street: string;
  houseNumber: string;
  houseNumberAdditional: string;
  community: string;
  city: string;
  postalCode: string;
  /** YYYY-MM-DD */
  validityDate: string;
}

export interface FursPremiseRegistration extends FursPremiseData {
  premiseCode: string;
  environment: 'test' | 'production';
  registeredAt: string;
}

/** Slovenian tax number: 8 digits, the last a mod-11 check digit. */
export function isValidTaxNumber(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 7).reduce((acc, d, i) => acc + d * (8 - i), 0);
  const check = 11 - (sum % 11);
  if (check === 11) return false;
  return (check === 10 ? 0 : check) === digits[7];
}

async function functionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    const payload = await context.json().catch(() => null);
    if (payload?.error) return payload.error as string;
  }
  return error instanceof Error ? error.message : String(error);
}

export function useFurs() {
  const { practiceId } = usePracticeContext();
  const [profile, setProfile] = useState<UserProfile>({ fullName: '', taxNumber: '' });
  const [premise, setPremise] = useState<FursPremiseRegistration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    const [profileRes, premiseRes] = await Promise.all([
      userId
        ? supabase.from('user_profiles').select('full_name, tax_number').eq('user_id', userId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('furs_premises').select('*').order('registered_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const firstError = profileRes.error ?? premiseRes.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setProfile({
        fullName: (profileRes.data?.full_name as string | null) ?? '',
        taxNumber: (profileRes.data?.tax_number as string | null) ?? '',
      });
      const p = premiseRes.data as Record<string, unknown> | null;
      setPremise(
        p
          ? {
              premiseCode: p.premise_code as string,
              cadastralNumber: String(p.cadastral_number),
              buildingNumber: String(p.building_number),
              buildingSectionNumber: String(p.building_section_number),
              street: p.street as string,
              houseNumber: p.house_number as string,
              houseNumberAdditional: (p.house_number_additional as string | null) ?? '',
              community: p.community as string,
              city: p.city as string,
              postalCode: p.postal_code as string,
              validityDate: p.validity_date as string,
              environment: p.environment as 'test' | 'production',
              registeredAt: p.registered_at as string,
            }
          : null
      );
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const saveProfile = useCallback(
    async (next: UserProfile): Promise<{ error?: string }> => {
      const taxNumber = next.taxNumber.replace(/\s/g, '').replace(/^SI/i, '');
      if (taxNumber && !isValidTaxNumber(taxNumber)) return { error: 'Davčna številka ni veljavna (8 števk s kontrolno števko).' };
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user || !practiceId) return { error: 'Niste prijavljeni.' };
      const { error: saveError } = await supabase.from('user_profiles').upsert({
        user_id: auth.user.id,
        practice_id: practiceId,
        full_name: next.fullName.trim() || null,
        tax_number: taxNumber || null,
        updated_at: new Date().toISOString(),
      });
      if (saveError) return { error: saveError.message };
      setProfile({ fullName: next.fullName.trim(), taxNumber });
      return {};
    },
    [practiceId]
  );

  const registerPremise = useCallback(
    async (data: FursPremiseData): Promise<{ error?: string }> => {
      const toInt = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
      const { error: fnError } = await supabase.functions.invoke('furs-register-premise', {
        body: {
          ...data,
          cadastralNumber: toInt(data.cadastralNumber),
          buildingNumber: toInt(data.buildingNumber),
          buildingSectionNumber: toInt(data.buildingSectionNumber),
        },
      });
      if (fnError) return { error: await functionError(fnError) };
      await reload();
      return {};
    },
    [reload]
  );

  return { profile, premise, fursActive: !!premise, loading, error, saveProfile, registerPremise, reload };
}

/** Sends one issued cash/card invoice to FURS (supabase/functions/fiscalize-invoice). */
export async function fiscalizeInvoice(invoiceId: string): Promise<{ status?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('fiscalize-invoice', { body: { invoiceId } });
  if (error) return { error: await functionError(error) };
  return data as { status?: string; error?: string };
}
