// Loads the official ZZZS dental service codes (šifranti) into the shared
// zzzs_services table (migration 033) — a local admin script, same convention
// as provision-practice-domain.mjs, not shipped as part of the app.
//
// Why a script and not an Edge Function: ZZZS publishes every code list as one
// ~60 MB XML file (4 MB zipped); parsing it needs far more CPU time than an
// Edge Function gets per request.
//
// Source (public): https://partner.zzzs.si/sifranti/ — the editions list is a
// JSON endpoint, each edition a ZIP with one XML. From that XML we read:
//   - list "15"  SifrantStoritev   every service: code, short/long name, unit
//   - list "S1"  SeznamiStoritev   names of the service lists (15.119, …)
//   - list "S3"  membership        which service belongs to which list
//   - list "T2"  points            points value per service (StTock)
//   - list "42"  EnoteMere         unit names (3 = Točka, …)
// Each record carries VeljaOd/VeljaDo; we take the version valid today.
//
// Rows are never deleted: a code that disappears, or whose name/points
// change, gets valid_to and (if changed) a new row — so an old record still
// shows the code that was valid at the time.
//
// Usage (PowerShell):
//   $env:SUPABASE_SERVICE_ROLE_KEY = '<service role key from Project Settings -> API>'
//   node scripts/sync-zzzs.mjs            # load the newest edition (skips if already loaded)
//   node scripts/sync-zzzs.mjs --force    # re-run even if that edition was loaded
//   node scripts/sync-zzzs.mjs --dry-run  # download + parse + print, no key needed, writes nothing

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';

const DENTAL_LISTS = new Set([
  '15.39', '15.108', '15.108a', '15.112', '15.113', '15.115', '15.116',
  '15.119', '15.120', '15.121', '15.122', '15.133', '15.138',
]);

const EDITIONS_URL = 'https://partner.zzzs.si/sifranti/?ajax=1&act=get-search-sifranti';
const zipUrl = (year, no) =>
  'https://partner.zzzs.si/?id=742&tx_agzzzsapi_zzzs%5Baction%5D=downloadfilesifranti' +
  '&tx_agzzzsapi_zzzs%5Bcontroller%5D=Izvajalci&type=1249058994' +
  `&leto_objave=${year}&zap_st_objave=${no}&oznaka_sifranta=%20&vrsta_datoteke=1` +
  '&naziv_datoteke=SifrantiXML_Vsi_objava&tip_datoteke=zip';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FORCE = args.has('--force');

function loadEnv(path) {
  const env = {};
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // .env not found — fine, real env vars may be set instead.
  }
  return env;
}

// ---- ZIP (the archive holds exactly one deflated XML) --------------------------
function unzipSingle(buf) {
  // End of central directory: signature 0x06054b50, within the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP file');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('bad ZIP central directory');
  const method = buf.readUInt16LE(cdOffset + 10);
  const compressedSize = buf.readUInt32LE(cdOffset + 20);
  const nameLen = buf.readUInt16LE(cdOffset + 28);
  const localOffset = buf.readUInt32LE(cdOffset + 42);
  const name = buf.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen);
  if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('bad ZIP local header');
  const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
  const data = buf.subarray(dataStart, dataStart + compressedSize);
  if (method === 0) return { name, xml: data.toString('utf8') };
  if (method !== 8) throw new Error(`unsupported ZIP compression method ${method}`);
  return { name, xml: inflateRawSync(data).toString('utf8') };
}

// ---- XML (flat, regular structure — no general parser needed) -----------------
const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The records of one code list, found by its <OznakaSifranta>. */
function listRecords(xml, oznaka) {
  const marker = `<OznakaSifranta>${oznaka}</OznakaSifranta>`;
  const at = xml.indexOf(marker);
  if (at < 0) throw new Error(`code list ${oznaka} not found in the XML`);
  const open = xml.lastIndexOf('<', at - 1);
  const tag = xml.slice(open + 1, xml.indexOf('>', open));
  const end = xml.indexOf(`</${tag}>`, at);
  const body = xml.slice(at, end);
  const records = [];
  const recordRe = /<Zapis[^>]*>([\s\S]*?)<\/Zapis>/g;
  const fieldRe = /<nsoct:(\w+)>([^<]*)<\/nsoct:\1>/g;
  let r;
  while ((r = recordRe.exec(body))) {
    const rec = {};
    let f;
    while ((f = fieldRe.exec(r[1]))) rec[f[1]] = decode(f[2]).trim();
    records.push(rec);
  }
  return records;
}

const TODAY = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Ljubljana' });

/** Of several versions of one record, the one valid today — or, if none is
 *  yet, the earliest future one. */
function currentVersion(versions) {
  const valid = versions.filter((v) => v.VeljaOd <= TODAY && (!v.VeljaDo || v.VeljaDo >= TODAY));
  if (valid.length > 0) return valid.sort((a, b) => b.VeljaOd.localeCompare(a.VeljaOd))[0];
  const future = versions.filter((v) => v.VeljaOd > TODAY).sort((a, b) => a.VeljaOd.localeCompare(b.VeljaOd));
  return future[0] ?? null;
}

function groupBy(records, key) {
  const map = new Map();
  for (const r of records) {
    const k = key(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

/** Every dental service valid today, one row per (list, code). */
function buildSnapshot(xml, edition) {
  const units = new Map(listRecords(xml, '42').map((u) => [u.SifraEnotMer, u.OpisEnotMer ?? u.NazivEnotMer ?? null]));
  const listNames = new Map();
  for (const [code, versions] of groupBy(listRecords(xml, 'S1'), (r) => r.SifraSezSto)) {
    const v = currentVersion(versions);
    if (v) listNames.set(code, v.OpisSezSto);
  }
  const services = groupBy(listRecords(xml, '15'), (r) => r.SiSto);
  const points = groupBy(listRecords(xml, 'T2'), (r) => r.SiSto);
  const membership = groupBy(
    listRecords(xml, 'S3').filter((r) => DENTAL_LISTS.has(r.SifraSezSto) && r.SiSto),
    (r) => `${r.SifraSezSto}|${r.SiSto}`
  );

  const rows = [];
  for (const [key, versions] of membership) {
    const member = currentVersion(versions);
    if (!member) continue;
    const [listCode, code] = key.split('|');
    const service = currentVersion(services.get(code) ?? []);
    if (!service) continue;
    const pts = currentVersion(points.get(code) ?? []);
    const validFrom = [member.VeljaOd, service.VeljaOd, pts?.VeljaOd].filter(Boolean).sort().at(-1);
    rows.push({
      list_code: listCode,
      list_name: listNames.get(listCode) ?? listCode,
      code,
      short_name: service.KratekOpisSiSto,
      long_name: service.DolgOpisSiSto || null,
      unit_name: units.get(service.SifraEnotMer) ?? null,
      points: pts?.StTock ? Number(pts.StTock) : null,
      valid_from: validFrom,
      edition_year: edition.year,
      edition_no: edition.no,
    });
  }
  return rows;
}

const sameContent = (a, b) =>
  a.short_name === b.short_name &&
  (a.long_name ?? null) === (b.long_name ?? null) &&
  (a.unit_name ?? null) === (b.unit_name ?? null) &&
  (a.points == null ? null : Number(a.points)) === (b.points == null ? null : Number(b.points));

const dayBefore = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

async function main() {
  const editions = await (await fetch(EDITIONS_URL)).json();
  if (!Array.isArray(editions) || editions.length === 0) throw new Error('ZZZS editions list is empty or unavailable');
  const latest = editions
    .map((e) => ({ year: Number(e.stletobj), no: Number(e.stzapobj), date: e.dtobjave, comment: e.txkoment }))
    .sort((a, b) => b.year - a.year || b.no - a.no)[0];
  const [dd, mm, yyyy] = latest.date.split('.');
  latest.publishedOn = `${yyyy}-${mm}-${dd}`;
  console.log(`Newest ZZZS edition: ${latest.no}/${latest.year} (${latest.date}) — ${latest.comment}`);

  let supabase = null;
  if (!DRY_RUN) {
    const fileEnv = loadEnv(fileURLToPath(new URL('../.env', import.meta.url)));
    const url = process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error('Missing VITE_SUPABASE_URL (in .env) or SUPABASE_SERVICE_ROLE_KEY (env var — paste from Project Settings -> API).');
      process.exit(1);
    }
    supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data: loaded, error } = await supabase
      .from('zzzs_editions').select('edition_no').eq('edition_year', latest.year).eq('edition_no', latest.no).maybeSingle();
    if (error) throw new Error(`reading zzzs_editions: ${error.message}`);
    if (loaded && !FORCE) {
      console.log('This edition is already loaded — nothing to do (use --force to re-run).');
      return;
    }
  }

  const zipRes = await fetch(zipUrl(latest.year, latest.no));
  if (!zipRes.ok) throw new Error(`download failed: HTTP ${zipRes.status}`);
  const { name, xml } = unzipSingle(Buffer.from(await zipRes.arrayBuffer()));
  console.log(`Downloaded ${name} (${(xml.length / 1e6).toFixed(1)} MB of XML).`);

  const snapshot = buildSnapshot(xml, latest);
  const perList = groupBy(snapshot, (r) => r.list_code);
  for (const list of [...perList.keys()].sort()) console.log(`  ${list}: ${perList.get(list).length} services — ${perList.get(list)[0].list_name}`);
  console.log(`Total: ${snapshot.length} rows, ${new Set(snapshot.map((r) => r.code)).size} distinct codes.`);

  if (DRY_RUN) {
    const sample = snapshot.find((r) => r.list_code === '15.119' && r.code === '52321');
    console.log('Sample 15.119/52321:', sample);
    console.log('Dry run — nothing written.');
    return;
  }

  // Current rows (valid_to null), paged — PostgREST returns at most 1000 at a time.
  const current = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('zzzs_services')
      .select('id, list_code, code, short_name, long_name, unit_name, points, valid_from')
      .is('valid_to', null)
      .range(from, from + 999);
    if (error) throw new Error(`reading zzzs_services: ${error.message}`);
    current.push(...data);
    if (data.length < 1000) break;
  }
  const currentByKey = new Map(current.map((r) => [`${r.list_code}|${r.code}`, r]));
  const snapshotKeys = new Set(snapshot.map((r) => `${r.list_code}|${r.code}`));

  const inserts = [];
  const closes = []; // { id, valid_to }
  const inPlace = []; // { id, fields }
  for (const row of snapshot) {
    const old = currentByKey.get(`${row.list_code}|${row.code}`);
    if (!old) inserts.push(row);
    else if (!sameContent(old, row) || old.list_name !== row.list_name) {
      if (row.valid_from > old.valid_from) {
        closes.push({ id: old.id, valid_to: dayBefore(row.valid_from) });
        inserts.push(row);
      } else {
        const { list_code: _l, code: _c, valid_from: _v, ...fields } = row;
        inPlace.push({ id: old.id, fields });
      }
    }
  }
  for (const old of current) {
    if (!snapshotKeys.has(`${old.list_code}|${old.code}`)) closes.push({ id: old.id, valid_to: dayBefore(latest.publishedOn) });
  }

  for (const c of closes) {
    const { error } = await supabase.from('zzzs_services').update({ valid_to: c.valid_to }).eq('id', c.id);
    if (error) throw new Error(`closing a row: ${error.message}`);
  }
  for (const u of inPlace) {
    const { error } = await supabase.from('zzzs_services').update(u.fields).eq('id', u.id);
    if (error) throw new Error(`updating a row: ${error.message}`);
  }
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await supabase.from('zzzs_services').insert(inserts.slice(i, i + 500));
    if (error) throw new Error(`inserting rows: ${error.message}`);
  }
  const { error: editionError } = await supabase.from('zzzs_editions').upsert({
    edition_year: latest.year,
    edition_no: latest.no,
    published_on: latest.publishedOn,
    comment: latest.comment,
    loaded_at: new Date().toISOString(),
  });
  if (editionError) throw new Error(`recording the edition: ${editionError.message}`);

  console.log(`Done: ${inserts.length} new, ${inPlace.length} updated in place, ${closes.length} closed (valid_to set).`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
