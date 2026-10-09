import { useState } from 'react';
import type { ImportedService, Service } from '../../hooks/usePriceList';
import type { ZzzsEntry } from '../../hooks/useZzzs';
import { downloadText, priceListTemplateCsv, readSpreadsheet, type Sheet } from '../../lib/spreadsheet';

// Nastavitve → Cenik → "Uvozi cenik": a practice's existing price list from a
// CSV or Excel file. Nothing is saved until the preview is confirmed; rows
// with errors are skipped; nothing is ever deleted. A row matches an existing
// service by šifra, or by name when it has no šifra.

interface PriceListImportDialogProps {
  services: Service[];
  /** The ZZZS catalogue, to check zzzs_sifra values (empty until loaded). */
  zzzsEntries: Map<string, ZzzsEntry>;
  zzzsLoading: boolean;
  onImport: (rows: ImportedService[]) => Promise<{ error?: string; created?: number; updated?: number }>;
  onClose: () => void;
}

type RowStatus = 'new' | 'update' | 'error';

interface PreviewRow {
  line: number;
  status: RowStatus;
  message: string;
  data: ImportedService;
}

// Header → field. Accepts the template's names and a few obvious variants,
// with or without diacritics ("Šifra", "sifra", "Cena z DDV" …).
const HEADER_ALIASES: Record<keyof Omit<ImportedService, 'existingId'>, string[]> = {
  code: ['sifra', 'koda', 'code'],
  name: ['naziv', 'storitev', 'ime', 'name', 'opis'],
  priceEur: ['cena', 'cenazddv', 'price', 'znesek'],
  vatRate: ['ddv', 'stopnjaddv', 'vat'],
  unit: ['em', 'enota', 'enotamere', 'unit'],
  categoryName: ['kategorija', 'category', 'skupina'],
  zzzsCode: ['zzzssifra', 'zzzs', 'sifrazzzs'],
};

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseNumber(text: string): number | null {
  const normalized = text.replace(/[\s€%]/g, '').replace(',', '.');
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function buildPreview(sheet: Sheet, services: Service[], zzzsEntries: Map<string, ZzzsEntry>): { rows: PreviewRow[]; error?: string } {
  if (sheet.length < 2) return { rows: [], error: 'Datoteka nima vrstic s storitvami (prva vrstica mora biti glava stolpcev).' };
  const headers = sheet[0].map(normalizeHeader);
  const col = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, headers.findIndex((h) => aliases.includes(h))])
  ) as Record<keyof typeof HEADER_ALIASES, number>;
  if (col.name < 0 || col.priceEur < 0) {
    return { rows: [], error: 'Manjka stolpec »naziv« ali »cena«. Uporabite predlogo (Prenesi predlogo).' };
  }

  const byCode = new Map(services.filter((s) => s.code).map((s) => [(s.code as string).toLowerCase(), s]));
  const byName = new Map(services.map((s) => [s.name.toLowerCase(), s]));
  const seen = new Set<string>();
  const cell = (row: string[], field: keyof typeof HEADER_ALIASES) => (col[field] >= 0 ? (row[col[field]] ?? '').trim() : '');

  const rows: PreviewRow[] = sheet.slice(1).map((row, i) => {
    const data: ImportedService = {
      existingId: null,
      code: cell(row, 'code'),
      name: cell(row, 'name'),
      priceEur: 0,
      vatRate: 0,
      unit: cell(row, 'unit') || 'kos',
      categoryName: cell(row, 'categoryName'),
      zzzsCode: cell(row, 'zzzsCode'),
    };
    const fail = (message: string): PreviewRow => ({ line: i + 2, status: 'error', message, data });

    if (!data.name) return fail('Manjka naziv.');
    const price = parseNumber(cell(row, 'priceEur'));
    if (price === null || price < 0) return fail('Neveljavna cena.');
    data.priceEur = Math.round(price * 100) / 100;
    const vatText = cell(row, 'vatRate').toLowerCase();
    const vat = vatText === '' || vatText.startsWith('opro') ? 0 : parseNumber(vatText);
    if (vat === null || vat < 0 || vat > 100) return fail('Neveljavna stopnja DDV.');
    data.vatRate = vat;
    if (data.unit.length > 12) return fail('Enota mere je daljša od 12 znakov.');
    if (data.zzzsCode && zzzsEntries.size > 0 && !zzzsEntries.has(data.zzzsCode)) {
      return fail(`Šifre ZZZS ${data.zzzsCode} ni v veljavnem šifrantu.`);
    }

    const key = data.code ? `c:${data.code.toLowerCase()}` : `n:${data.name.toLowerCase()}`;
    if (seen.has(key)) return fail(data.code ? 'Ta šifra se v datoteki ponovi.' : 'Ta naziv se v datoteki ponovi.');
    seen.add(key);

    const existing = data.code ? byCode.get(data.code.toLowerCase()) : byName.get(data.name.toLowerCase());
    if (existing) {
      data.existingId = existing.id;
      return { line: i + 2, status: 'update', message: existing.isActive ? 'Posodobi obstoječo' : 'Posodobi in obnovi iz arhiva', data };
    }
    return { line: i + 2, status: 'new', message: 'Nova storitev', data };
  });
  return { rows };
}

const STATUS_CLASS: Record<RowStatus, string> = {
  new: 'text-[var(--accent,#2e6e62)]',
  update: 'text-[#6b4a00]',
  error: 'text-[var(--danger,#b3261e)]',
};

export function PriceListImportDialog({ services, zzzsEntries, zzzsLoading, onImport, onClose }: PriceListImportDialogProps) {
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setResult(null);
    try {
      const built = buildPreview(await readSpreadsheet(file), services, zzzsEntries);
      setFileError(built.error ?? null);
      setPreview(built.error ? null : built.rows);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Datoteke ni bilo mogoče prebrati.');
    }
  }

  const valid = preview?.filter((r) => r.status !== 'error') ?? [];
  const created = valid.filter((r) => r.status === 'new').length;
  const updated = valid.length - created;
  const errors = (preview?.length ?? 0) - valid.length;

  async function handleImport() {
    setBusy(true);
    const outcome = await onImport(valid.map((r) => r.data));
    setBusy(false);
    if (outcome.error) {
      setResult(`Napaka: ${outcome.error}`);
      return;
    }
    setPreview(null);
    setResult(`Uvoženo: ${outcome.created ?? 0} novih, ${outcome.updated ?? 0} posodobljenih storitev.`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-5xl flex-col gap-3 rounded-md bg-[var(--surface,#fff)] p-5 text-left shadow-xl"
      >
        <div>
          <h2 className="text-base font-bold text-[var(--ink,#1c2624)]">Uvozi cenik</h2>
          <p className="text-xs text-[var(--muted,#6f7c79)]">
            Datoteka CSV ali Excel (.xlsx) s stolpci <span className="font-mono">sifra; naziv; cena; ddv; em; kategorija; zzzs_sifra</span>{' '}
            — obvezna sta naziv in cena. Storitve z enako šifro (ali nazivom, če šifre ni) se posodobijo, ostale dodajo. Nič se ne
            izbriše.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded border border-[var(--accent,#2e6e62)] px-3 py-2 text-sm font-medium text-[var(--accent,#2e6e62)] hover:bg-[#eaf4f1]">
            Izberi datoteko …
            <input
              type="file"
              accept=".csv,.xlsx,text/csv"
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <span className="text-sm text-[var(--ink-soft,#45524f)]">{fileName}</span>
          <button
            type="button"
            onClick={() => downloadText('cenik-predloga.csv', priceListTemplateCsv())}
            className="ml-auto text-sm font-medium text-[var(--accent,#2e6e62)] hover:underline"
          >
            Prenesi predlogo (CSV)
          </button>
        </div>
        {zzzsLoading && <p className="text-xs text-[var(--muted,#6f7c79)]">Nalagam šifrant ZZZS za preverjanje šifer …</p>}
        {fileError && <p className="text-sm text-[var(--danger,#b3261e)]">{fileError}</p>}
        {result && <p className="text-sm text-[var(--ink,#1c2624)]">{result}</p>}

        {preview && (
          <>
            <p className="text-sm text-[var(--ink,#1c2624)]">
              {created} novih · {updated} posodobljenih
              {errors > 0 && <span className="text-[var(--danger,#b3261e)]"> · {errors} z napako (bodo izpuščene)</span>}
            </p>
            <div className="min-h-[160px] flex-1 overflow-auto rounded border border-[var(--line,#ccd6d4)]">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[#f7faf9] text-xs uppercase text-[var(--ink-soft,#45524f)]">
                  <tr>
                    <th className="px-2 py-1.5">Vrst.</th>
                    <th className="px-2 py-1.5">Šifra</th>
                    <th className="px-2 py-1.5">Naziv</th>
                    <th className="px-2 py-1.5 text-right">Cena</th>
                    <th className="px-2 py-1.5">DDV</th>
                    <th className="px-2 py-1.5">EM</th>
                    <th className="px-2 py-1.5">Kategorija</th>
                    <th className="px-2 py-1.5">ZZZS</th>
                    <th className="px-2 py-1.5">Stanje</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.line} className="border-t border-[var(--line,#ccd6d4)]">
                      <td className="px-2 py-1 text-[var(--muted,#6f7c79)]">{r.line}</td>
                      <td className="px-2 py-1 font-mono text-xs">{r.data.code}</td>
                      <td className="px-2 py-1">{r.data.name}</td>
                      <td className="px-2 py-1 text-right">{r.status === 'error' ? '' : r.data.priceEur.toFixed(2).replace('.', ',')}</td>
                      <td className="px-2 py-1">{r.status === 'error' ? '' : `${String(r.data.vatRate).replace('.', ',')} %`}</td>
                      <td className="px-2 py-1">{r.data.unit}</td>
                      <td className="px-2 py-1">{r.data.categoryName}</td>
                      <td className="px-2 py-1 font-mono text-xs">{r.data.zzzsCode}</td>
                      <td className={`px-2 py-1 text-xs font-medium ${STATUS_CLASS[r.status]}`}>{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] hover:bg-[#f7faf9]"
          >
            {result && !preview ? 'Zapri' : 'Prekliči'}
          </button>
          {preview && (
            <button
              type="button"
              disabled={valid.length === 0 || busy}
              onClick={handleImport}
              className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Uvažam …' : `Uvozi (${valid.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
