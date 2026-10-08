// Deno Edge Function — registers the practice's business premise with FURS
// ("Prijavi poslovni prostor", Nastavitve → Podatki za račune). Called from
// the browser with the signed-in user's JWT: the practice and its premise
// code (P1) are read through that user's RLS, the premise is registered with
// FURS, and only on success is the furs_premises row written (service role —
// the table has no client write policy, so "registered" can't be faked).
//
// Deploy: supabase functions deploy furs-register-premise
import { createClient } from 'npm:@supabase/supabase-js@2';
import { FURS_ENV } from '../_shared/furs/client.ts';
import { registerPremise, type FursPremise } from '../_shared/furs/premise.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const text = (value: unknown, max = 100) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const int = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : NaN);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser();
  const { data: settings } = await asUser.from('invoice_settings').select('practice_id, premise_code').maybeSingle();
  if (!userData?.user || !settings) return json({ error: 'Najprej shranite podatke za račune.' }, 400);

  const body = await req.json().catch(() => ({}));
  const premise: FursPremise = {
    premiseId: settings.premise_code as string,
    cadastralNumber: int(body.cadastralNumber),
    buildingNumber: int(body.buildingNumber),
    buildingSectionNumber: int(body.buildingSectionNumber),
    street: text(body.street),
    houseNumber: text(body.houseNumber, 10),
    houseNumberAdditional: text(body.houseNumberAdditional, 10) || undefined,
    community: text(body.community),
    city: text(body.city),
    postalCode: text(body.postalCode, 4),
    validityDate: text(body.validityDate, 10),
  };
  const missing = [
    Number.isNaN(premise.cadastralNumber) && 'šifra katastrske občine',
    Number.isNaN(premise.buildingNumber) && 'številka stavbe',
    Number.isNaN(premise.buildingSectionNumber) && 'številka dela stavbe',
    !premise.street && 'ulica',
    !premise.houseNumber && 'hišna številka',
    !premise.community && 'občina',
    !premise.city && 'kraj',
    !/^\d{4}$/.test(premise.postalCode) && 'poštna številka',
    !/^\d{4}-\d{2}-\d{2}$/.test(premise.validityDate) && 'datum veljavnosti',
  ].filter(Boolean);
  if (missing.length) return json({ error: `Manjka ali ni pravilno: ${missing.join(', ')}.` }, 400);

  try {
    const result = await registerPremise(
      Number(Deno.env.get('FURS_TAX_NUMBER')),
      premise,
      Number(Deno.env.get('FURS_SOFTWARE_SUPPLIER_TAX_NUMBER'))
    );
    if (!result.ok) {
      return json({ error: `FURS je zavrnil prijavo: ${[result.errorCode, result.errorMessage].filter(Boolean).join(' ')}` }, 502);
    }
  } catch (e) {
    return json({ error: `FURS ni dosegljiv: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await service.from('furs_premises').upsert({
    practice_id: settings.practice_id,
    premise_code: premise.premiseId,
    cadastral_number: premise.cadastralNumber,
    building_number: premise.buildingNumber,
    building_section_number: premise.buildingSectionNumber,
    street: premise.street,
    house_number: premise.houseNumber,
    house_number_additional: premise.houseNumberAdditional ?? null,
    community: premise.community,
    city: premise.city,
    postal_code: premise.postalCode,
    validity_date: premise.validityDate,
    environment: FURS_ENV,
    registered_at: new Date().toISOString(),
    registered_by: userData.user.id,
  });
  if (error) return json({ error: `Prijava je uspela, shranjevanje pa ne: ${error.message}` }, 500);
  return json({ ok: true, environment: FURS_ENV });
});
