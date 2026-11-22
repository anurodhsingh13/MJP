/**
 * Loads earlier-year Sentinel-2 NDVI readings into field_ndvi_baseline (seasonal baseline and VCI).
 * Calls the local engine, which calls Google Earth Engine with each field boundary.
 *
 *   node --import tsx scripts/backfill-ndvi-baseline.ts --years 2018-2025 [--field <id-prefix>] [--max-ha 1000]
 *
 * Fields without a boundary, or larger than --max-ha (default 1000), are skipped and listed.
 */
import { pool } from '../backend/api/db/pool.ts';
import { engineUrl } from '../backend/api/services/satellite.ts';
import { backfillBaseline, type BaselineEngine } from '../backend/api/services/baselineBackfill.ts';

const arg = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index > -1 ? process.argv[index + 1] : undefined; };
const range = /^(\d{4})-(\d{4})$/.exec(arg('years') ?? '');
if (!range || Number(range[1]) > Number(range[2])) { console.error('Usage: --years 2018-2025'); process.exit(2); }
const years = Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, index) => Number(range[1]) + index);
const maxHa = Number(arg('max-ha') ?? 1000);
const prefix = arg('field');

const post = (path: string, body: unknown) => fetch(`${engineUrl()}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });

const fields = (await pool.query(`select id::text, crop, boundary_version, ST_AsGeoJSON(boundary_geom)::jsonb as geojson,
  round((ST_Area(boundary_geom::geography)/10000)::numeric,1) as hectares from public.fields where boundary_geom is not null order by crop, id`)).rows
  .filter(row => !prefix || String(row.id).startsWith(prefix));
console.log(`years ${years[0]}-${years[years.length - 1]}, ${fields.length} field(s)`);
let failures = 0;
for (const field of fields) {
  const label = `${String(field.id).slice(0, 8)} ${field.crop ?? '-'} ${field.hectares} ha`;
  if (Number(field.hectares) > maxHa) { console.log(`${label}: skipped, larger than ${maxHa} ha (check the boundary)`); continue; }
  let measured = 0;
  const engine: BaselineEngine = {
    async search(start, end) {
      const response = await post('/earth-engine/scenes', { polygonGeojson: field.geojson, start, end, limit: 20 });
      if (!response.ok) throw new Error(`scene search failed (${response.status})`);
      return ((await response.json()) as { scenes?: Array<{ id: string; image_id: string; observed_at: string; cloud_cover: number | null }> }).scenes ?? [];
    },
    async measure(imageId) {
      measured += 1;
      if (measured % 25 === 0) console.log(`  ${label}: ${measured} images measured`);
      const response = await post('/earth-engine/calculate-indices', { imageId, polygonGeojson: field.geojson });
      if (response.status === 422) return null;
      if (!response.ok) throw new Error(`measure failed (${response.status})`);
      const result = await response.json() as { ndvi: number; validPixels: number; validCoverage: number };
      return { ndvi: result.ndvi, validPixels: result.validPixels, validCoverage: result.validCoverage };
    },
  };
  try {
    const summary = await backfillBaseline(pool, String(field.id), years, engine);
    console.log(`${label}: ${JSON.stringify(summary)}`);
  } catch (error) {
    failures += 1;
    console.error(`${label}: stopped, ${error instanceof Error ? error.message : 'failed'}`);
  }
}
await pool.end();
process.exitCode = failures ? 1 : 0;
