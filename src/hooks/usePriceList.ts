import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';
import {
  sameChartLink,
  zzzsAutoLink,
  type ChartLinkChoice,
  type ChartTrigger,
  type FillingVariant,
  type ServiceChartLinkRow,
} from '../lib/chartBilling';

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
  /** Enota mere printed on invoices (migration 029), e.g. "kos". */
  unit: string;
  /** ZZZS code this service corresponds to (migration 033), null = own service. */
  zzzsCode: string | null;
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
  unit: string;
  /** Empty = none. */
  zzzsCode: string;
}

const CATEGORY_COLUMNS = 'id, name, sort_order';
const SERVICE_COLUMNS = 'id, category_id, code, name, description, price_eur, vat_rate, unit, zzzs_code, is_active';

function rowToCategory(row: Record<string, unknown>): ServiceCategory {
  return { id: row.id as string, name: row.name as string, sortOrder: row.sort_order as number };
}

function rowToLink(row: Record<string, unknown>): ServiceChartLinkRow {
  return {
    id: row.id as string,
    serviceId: row.service_id as string,
    trigger: row.trigger_key as ChartTrigger,
    variant: (row.variant as FillingVariant | null) ?? null,
    excluded: row.excluded as boolean,
  };
}

/** A ZZZS catalogue entry to add as a new service (price filled in later). */
export interface ZzzsServiceToAdd {
  zzzsCode: string;
  name: string;
}

/** One row of an imported price list, already validated by the import dialog. */
export interface ImportedService {
  /** Existing service to update, or null to create a new one. */
  existingId: string | null;
  code: string;
  name: string;
  priceEur: number;
  vatRate: number;
  unit: string;
  /** Empty = leave the service's category as it is (new: none). */
  categoryName: string;
  /** Empty = leave as it is (new: none). */
  zzzsCode: string;
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
    unit: (row.unit as string | null) ?? 'kos',
    zzzsCode: (row.zzzs_code as string | null) ?? null,
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
  const [links, setLinks] = useState<ServiceChartLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [categoriesResult, servicesResult, linksResult] = await Promise.all([
      supabase
        .from('service_categories')
        .select(CATEGORY_COLUMNS)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase.from('services').select(SERVICE_COLUMNS).order('name', { ascending: true }),
      supabase.from('service_chart_links').select('id, service_id, trigger_key, variant, excluded'),
    ]);
    const failure = categoriesResult.error ?? servicesResult.error ?? linksResult.error;
    if (failure) {
      setError(failure.message);
      setLoading(false);
      return;
    }
    setCategories((categoriesResult.data ?? []).map(rowToCategory));
    setServices((servicesResult.data ?? []).map(rowToService));
    setLinks((linksResult.data ?? []).map(rowToLink));
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
        unit: fields.unit.trim() || 'kos',
        zzzs_code: fields.zzzsCode.trim() || null,
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
          unit: fields.unit.trim() || 'kos',
          zzzs_code: fields.zzzsCode.trim() || null,
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

  // Sets which chart mark a service is billed for (one per service in the
  // UI). A link set by hand overrides the automatic one from the ZZZS code;
  // choosing "none" for a service that has an automatic link records an
  // `excluded` row so it isn't re-derived. See effectiveChartLink().
  const setServiceLink = useCallback(
    async (serviceId: string, choice: ChartLinkChoice | null, useZzzs: boolean): Promise<{ error?: string }> => {
      if (!practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      const service = services.find((s) => s.id === serviceId);
      const auto = useZzzs ? zzzsAutoLink(service?.zzzsCode ?? null) : null;
      const { error: deleteError } = await supabase.from('service_chart_links').delete().eq('service_id', serviceId);
      if (deleteError) return { error: deleteError.message };
      let row: ChartLinkChoice | null = null;
      let excluded = false;
      if (choice === null) {
        if (auto) {
          row = auto;
          excluded = true;
        }
      } else if (!sameChartLink(choice, auto)) {
        row = choice;
      }
      if (row) {
        const { error: insertError } = await supabase.from('service_chart_links').insert({
          practice_id: practiceId,
          service_id: serviceId,
          trigger_key: row.trigger,
          variant: row.variant,
          excluded,
        });
        if (insertError) return { error: insertError.message };
      }
      await reload();
      return {};
    },
    [practiceId, services, reload]
  );

  // "+ Iz šifranta ZZZS": new services named after the ZZZS entry, price 0
  // until the practice fills it in (the row is highlighted until then). The
  // ZZZS code doubles as the practice's own šifra unless that šifra is taken.
  const addZzzsServices = useCallback(
    async (items: ZzzsServiceToAdd[], categoryId: string | null): Promise<{ error?: string }> => {
      if (!practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      if (items.length === 0) return {};
      const takenCodes = new Set(services.map((s) => (s.code ?? '').toLowerCase()).filter(Boolean));
      const { error: insertError } = await supabase.from('services').insert(
        items.map((item) => ({
          practice_id: practiceId,
          category_id: categoryId,
          code: takenCodes.has(item.zzzsCode.toLowerCase()) ? null : item.zzzsCode,
          name: item.name,
          price_eur: 0,
          vat_rate: 0,
          unit: 'kos',
          zzzs_code: item.zzzsCode,
        }))
      );
      if (insertError) return { error: friendlyError(insertError) };
      await reload();
      return {};
    },
    [practiceId, services, reload]
  );

  // "Uvozi cenik": creates any missing categories, inserts the new services
  // in one go, then updates the matched ones (re-activating archived ones —
  // a service in the imported list is meant to be in use). Never deletes.
  const importServices = useCallback(
    async (rows: ImportedService[]): Promise<{ error?: string; created?: number; updated?: number }> => {
      if (!practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      const categoryIdByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
      const missing = [
        ...new Set(rows.map((r) => r.categoryName.trim()).filter((n) => n && !categoryIdByName.has(n.toLowerCase()))),
      ];
      if (missing.length > 0) {
        let sortOrder = categories.reduce((max, c) => Math.max(max, c.sortOrder), 0);
        const { data, error: catError } = await supabase
          .from('service_categories')
          .insert(missing.map((name) => ({ practice_id: practiceId, name, sort_order: (sortOrder += 10) })))
          .select(CATEGORY_COLUMNS);
        if (catError) return { error: friendlyError(catError) };
        for (const c of (data ?? []).map(rowToCategory)) categoryIdByName.set(c.name.toLowerCase(), c.id);
      }
      // undefined = no category given in the file (leave as is).
      const categoryOf = (name: string): string | null | undefined =>
        name.trim() ? (categoryIdByName.get(name.trim().toLowerCase()) ?? null) : undefined;

      const created = rows.filter((r) => !r.existingId);
      if (created.length > 0) {
        const { error: insertError } = await supabase.from('services').insert(
          created.map((r) => ({
            practice_id: practiceId,
            category_id: categoryOf(r.categoryName) ?? null,
            code: r.code.trim() || null,
            name: r.name.trim(),
            price_eur: r.priceEur,
            vat_rate: r.vatRate,
            unit: r.unit.trim() || 'kos',
            zzzs_code: r.zzzsCode.trim() || null,
          }))
        );
        if (insertError) {
          await reload();
          return { error: friendlyError(insertError) };
        }
      }
      let updated = 0;
      for (const r of rows.filter((row) => row.existingId)) {
        const category = categoryOf(r.categoryName);
        const { error: updateError } = await supabase
          .from('services')
          .update({
            ...(category !== undefined ? { category_id: category } : {}),
            ...(r.code.trim() ? { code: r.code.trim() } : {}),
            ...(r.zzzsCode.trim() ? { zzzs_code: r.zzzsCode.trim() } : {}),
            name: r.name.trim(),
            price_eur: r.priceEur,
            vat_rate: r.vatRate,
            unit: r.unit.trim() || 'kos',
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', r.existingId as string);
        if (updateError) {
          await reload();
          return { error: `${r.name}: ${friendlyError(updateError)}`, created: created.length, updated };
        }
        updated++;
      }
      await reload();
      return { created: created.length, updated };
    },
    [practiceId, categories, reload]
  );

  return {
    categories,
    services,
    links,
    loading,
    error,
    createCategory,
    renameCategory,
    deleteCategory,
    createService,
    updateService,
    setServiceActive,
    setServiceLink,
    addZzzsServices,
    importServices,
  };
}
