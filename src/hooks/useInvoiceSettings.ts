import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';
import type { InvoiceIssuer } from '../../supabase/functions/_shared/invoice/render';
import { formatIban } from '../../supabase/functions/_shared/invoice/payment';

// Issuer details printed on every invoice (Nastavitve → Podatki za račune) —
// supabase/migrations/023_add_invoicing.sql, `invoice_settings`. One row per
// practice; no row yet simply means "the defaults below". Root table, so
// practice_id is set explicitly from usePracticeContext().
export interface InvoiceSettings {
  legalName: string;
  address: string;
  postalCode: string;
  city: string;
  taxNumber: string;
  registrationNumber: string;
  vatPayer: boolean;
  iban: string;
  bankName: string;
  premiseCode: string;
  deviceCode: string;
  vatExemptNote: string;
  paymentDueDays: number;
  footerNote: string;
  receiptWidthMm: 58 | 80;
  phone: string;
  email: string;
  website: string;
  showPhone: boolean;
  showEmail: boolean;
  showWebsite: boolean;
  /** data: URL (migration 024), empty = no logo. */
  logoDataUrl: string;
  /** The practice's normal printout (migration 028). */
  defaultPrintFormat: 'a4' | 'receipt';
}

// Mirrors the column defaults in migration 023.
export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  legalName: '',
  address: '',
  postalCode: '',
  city: '',
  taxNumber: '',
  registrationNumber: '',
  vatPayer: true,
  iban: '',
  bankName: '',
  premiseCode: 'P1',
  deviceCode: 'B1',
  vatExemptNote: 'Oproščeno plačila DDV po 2. točki 1. odstavka 42. člena ZDDV-1.',
  paymentDueDays: 8,
  footerNote: '',
  receiptWidthMm: 80,
  phone: '',
  email: '',
  website: '',
  showPhone: true,
  showEmail: true,
  showWebsite: true,
  logoDataUrl: '',
  defaultPrintFormat: 'a4',
};

/** What issue_invoice() requires before it will number an invoice. */
export function invoiceSettingsComplete(s: InvoiceSettings): boolean {
  return s.legalName.trim() !== '' && s.taxNumber.trim() !== '';
}

/** Same shape the issue-time `issuer` snapshot is mapped to. */
export function settingsToIssuer(s: InvoiceSettings): InvoiceIssuer {
  return {
    legalName: s.legalName,
    address: s.address,
    postalCode: s.postalCode,
    city: s.city,
    taxNumber: s.taxNumber,
    registrationNumber: s.registrationNumber,
    vatPayer: s.vatPayer,
    iban: s.iban,
    bankName: s.bankName,
    vatExemptNote: s.vatExemptNote,
    footerNote: s.footerNote,
    phone: s.showPhone ? s.phone : '',
    email: s.showEmail ? s.email : '',
    website: s.showWebsite ? s.website : '',
    logoDataUrl: s.logoDataUrl,
  };
}

/** Row (or the `issuer` jsonb snapshot, which has the same keys) → settings. */
export function rowToInvoiceSettings(row: Record<string, unknown> | null): InvoiceSettings {
  if (!row) return DEFAULT_INVOICE_SETTINGS;
  const text = (key: string, fallback = '') => (row[key] as string | null | undefined) ?? fallback;
  return {
    legalName: text('legal_name'),
    address: text('address'),
    postalCode: text('postal_code'),
    city: text('city'),
    taxNumber: text('tax_number'),
    registrationNumber: text('registration_number'),
    vatPayer: (row.vat_payer as boolean | undefined) ?? true,
    iban: text('iban'),
    bankName: text('bank_name'),
    premiseCode: text('premise_code', 'P1'),
    deviceCode: text('device_code', 'B1'),
    vatExemptNote: text('vat_exempt_note', DEFAULT_INVOICE_SETTINGS.vatExemptNote),
    paymentDueDays: Number(row.payment_due_days ?? 8),
    footerNote: text('footer_note'),
    receiptWidthMm: Number(row.receipt_width_mm) === 58 ? 58 : 80,
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    showPhone: (row.show_phone as boolean | undefined) ?? true,
    showEmail: (row.show_email as boolean | undefined) ?? true,
    showWebsite: (row.show_website as boolean | undefined) ?? true,
    logoDataUrl: text('logo_data_url'),
    defaultPrintFormat: row.default_print_format === 'receipt' ? 'receipt' : 'a4',
  };
}

function settingsToRow(s: InvoiceSettings) {
  const blankToNull = (v: string) => v.trim() || null;
  return {
    legal_name: blankToNull(s.legalName),
    address: blankToNull(s.address),
    postal_code: blankToNull(s.postalCode),
    city: blankToNull(s.city),
    tax_number: blankToNull(s.taxNumber.replace(/^SI/i, '').replace(/\s/g, '')),
    registration_number: blankToNull(s.registrationNumber),
    vat_payer: s.vatPayer,
    // Always stored the way it's printed: "SI56 0400 0027 9667 334".
    iban: s.iban.trim() ? formatIban(s.iban) : null,
    bank_name: blankToNull(s.bankName),
    vat_exempt_note: s.vatExemptNote.trim() || DEFAULT_INVOICE_SETTINGS.vatExemptNote,
    payment_due_days: s.paymentDueDays,
    footer_note: blankToNull(s.footerNote),
    receipt_width_mm: s.receiptWidthMm,
    phone: blankToNull(s.phone),
    email: blankToNull(s.email),
    website: blankToNull(s.website),
    show_phone: s.showPhone,
    show_email: s.showEmail,
    show_website: s.showWebsite,
    logo_data_url: s.logoDataUrl || null,
    default_print_format: s.defaultPrintFormat,
    updated_at: new Date().toISOString(),
  };
}

export function useInvoiceSettings() {
  const { practiceId } = usePracticeContext();
  const [settings, setSettings] = useState<InvoiceSettings>(DEFAULT_INVOICE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: fetchError } = await supabase.from('invoice_settings').select('*').maybeSingle();
    if (fetchError) {
      setError(fetchError.message);
    } else {
      // Reloaded on every window focus (InvoiceEditor) — keep the same object
      // when nothing changed, so the invoice preview isn't rebuilt each time
      // the tab is revisited.
      const next = rowToInvoiceSettings(data);
      setSettings((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Premise/device labels are never written from here — they belong to the
  // FURS registration (phase 2), and changing them would restart numbering.
  const save = useCallback(
    async (next: InvoiceSettings): Promise<{ error?: string }> => {
      if (!practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      const { data, error: saveError } = await supabase
        .from('invoice_settings')
        .upsert({ practice_id: practiceId, ...settingsToRow(next) })
        .select('*')
        .single();
      if (saveError) return { error: saveError.message };
      setSettings(rowToInvoiceSettings(data));
      return {};
    },
    [practiceId]
  );

  return { settings, loading, error, save, reload };
}
