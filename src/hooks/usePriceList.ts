import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';

// Price list (Nastavitve → Cenik) — supabase/migrations/020_add_price_list.sql.
// Like therapists, both tables are root tables with no parent row to derive
// practice_id from, so it's set explicitly on insert from usePracticeContext();
// RLS already scopes every read/write to the signed-in user's own practice.
export interface ServiceCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface Service {
  id: string;
  categoryId: string | null;
  code: string | null;
  name: string;
  description: string | null;
  priceEur: number;
  /** Percent. 0 = exempt (health services generally are, in Slovenia). */
  vatRate: number;
  isActive: boolean;
}

/** What the service form edits. `code`/`description` are plain strings here
    (empty = none) and are stored as null when blank. */
export interface ServiceFields {
  name: string;
  categoryId: string | null;
  code: string;
  description: string;
  priceEur: number;
  vatRate: number;
}

const CATEGORY_COLUMNS = 'id, name, sort_order';
const SERVICE_COLUMNS = 'id, category_id, code, name, description, price_eur, vat_rate, is_active';

function rowToCategory(row: Record<string, unknown>): ServiceCategory {
  return { id: row.id as string, name: row.name as string, sortOrder: row.sort_order as number };
}

function rowToService(row: Record<string, unknown>): Service {
  return {
    id: row.id as string,
    categoryId: (row.category_id as string | null) ?? null,
    code: (row.code as string | null) ?? null,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    priceEur: Number(row.price_eur),
    vatRate: Number(row.vat_rate),
    isActive: row.is_active as boolean,
  };
}

// Postgres unique_violation — the friendly messages below only cover the two
// unique constraints these tables actually have.
const UNIQUE_VIOLATION = '23505';

function friendlyError(error: { code?: string; message: string }): string {
  if (error.code === UNIQUE_VIOLATION) {
    if (error.message.includes('services_practice_code_idx')) return 'Ta šifra je že v uporabi pri drugi storitvi.';
    if (error.message.includes('service_categories')) return 'Kategorija s tem imenom že obstaja.';
  }
  return error.message;
}

// Slovene noun agreement with a number (dual and paucal forms): 1 storitev,
// 2 storitvi, 3–4 storitve, 5+ storitev.
export function servicesWord(count: number): string {
  const lastTwo = count % 100;
  if (lastTwo === 1) return 'storitev';
  if (lastTwo === 2) return 'storitvi';
  if (lastTwo === 3 || lastTwo === 4) return 'storitve';
  return 'storitev';
}

export function usePriceList() {
  const { practiceId } = usePracticeContext();
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [categoriesResult, servicesResult] = await Promise.all([
      supabase
        .from('service_categories')
        .select(CATEGORY_COLUMNS)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase.from('services').select(SERVICE_COLUMNS).order('name', { ascending: true }),
    ]);
    const failure = categoriesResult.error ?? servicesResult.error;
    if (failure) {
      setError(failure.message);
      setLoading(false);
      return;
    }
    setCategories((categoriesResult.data ?? []).map(rowToCategory));
    setServices((servicesResult.data ?? []).map(rowToService));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const createCategory = useCallback(
    async (name: string): Promise<{ error?: string }> => {
      if (!practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      const trimmed = name.trim();
      if (!trimmed) return { error: 'Ime kategorije ne sme biti prazno.' };
      // Appended after the last one; there's no reorder UI yet, so this just
      // keeps new categories at the end of the list.
      const nextSortOrder = categories.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 10;
      const { error } = await supabase
        .from('service_categories')
        .insert({ practice_id: practiceId, name: trimmed, sort_order: nextSortOrder });
      if (error) return { error: friendlyError(error) };
      await reload();
      return {};
    },
    [practiceId, categories, reload]
  );

  const renameCategory = useCallback(
    async (id: string, name: string): Promise<{ error?: string }> => {
      const trimmed = name.trim();
      if (!trimmed) return { error: 'Ime kategorije ne sme biti prazno.' };
      const { error } = await supabase.from('service_categories').update({ name: trimmed }).eq('id', id);
      if (error) return { error: friendlyError(error) };
      await reload();
      return {};
    },
    [reload]
  );

  const deleteCategory = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const inUse = services.filter((s) => s.categoryId === id).length;
      if (inUse > 0) {
        return {
          error: `Kategorije ni mogoče izbrisati — vsebuje ${inUse} ${servicesWord(inUse)}. Storitve najprej premaknite v drugo kategorijo.`,
        };
      }
      const { error } = await supabase.from('service_categories').delete().eq('id', id);
      if (error) return { error: friendlyError(error) };
      await reload();
      return {};
    },
    [services, reload]
  );

  const createService = useCallback(
    async (fields: ServiceFields): Promise<{ error?: string }> => {
      if (!practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      const { error } = await supabase.from('services').insert({
        practice_id: practiceId,
        category_id: fields.categoryId,
        code: fields.code.trim() || null,
        name: fields.name.trim(),
        description: fields.description.trim() || null,
        price_eur: fields.priceEur,
        vat_rate: fields.vatRate,
      });
      if (error) return { error: friendlyError(error) };
      await reload();
      return {};
    },
    [practiceId, reload]
  );

  const updateService = useCallback(
    async (id: string, fields: ServiceFields): Promise<{ error?: string }> => {
      const { error } = await supabase
        .from('services')
        .update({
          category_id: fields.categoryId,
          code: fields.code.trim() || null,
          name: fields.name.trim(),
          description: fields.description.trim() || null,
          price_eur: fields.priceEur,
          vat_rate: fields.vatRate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) return { error: friendlyError(error) };
      await reload();
      return {};
    },
    [reload]
  );

  // Archive/restore rather than delete — invoices will reference services.
  const setServiceActive = useCallback(
    async (id: string, isActive: boolean): Promise<{ error?: string }> => {
      const { error } = await supabase.from('services').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) return { error: friendlyError(error) };
      await reload();
      return {};
    },
    [reload]
  );

  return {
    categories,
    services,
    loading,
    error,
    createCategory,
    renameCategory,
    deleteCategory,
    createService,
    updateService,
    setServiceActive,
  };
}
