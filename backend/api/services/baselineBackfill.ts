import { defaultPolicy } from '../../../shared/evidence.ts';
import { primaryTile } from './openSentinel.ts';

const DAY = 86400000;
export const BASELINE_SOURCE = 'Copernicus Sentinel-2 via Google Earth Engine (earlier seasons)';
const tileOf = (id: string) => /_T(\d{2}[C-X][A-Z]{2})$/.exec(id)?.[1] ?? null;

export interface BaselineScene { id: string; image_id: string; observed_at: string; cloud_cover: number | null }
export interface BaselineMeasurement { ndvi: number; validPixels: number; validCoverage: number }
/** The two Earth Engine calls the backfill needs; injected so the logic runs without the network. */
export interface BaselineEngine {
  search(start: string, end: string): Promise<BaselineScene[]>;
  measure(imageId: string): Promise<BaselineMeasurement | null>;
}
interface Db { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> }

/** One scene per `binDays` bin (the least cloudy), on the field's primary tile only, oldest first. */
export function pickBaselineScenes(scenes: BaselineScene[], tile: string | null, binDays = 10): BaselineScene[] {
  const bins = new Map<number, BaselineScene>();
  for (const scene of scenes) {
    const time = Date.parse(scene.observed_at);
    if (!Number.isFinite(time) || (tile && tileOf(scene.id) !== tile)) continue;
    const bin = Math.floor(time / (binDays * DAY));
    const current = bins.get(bin);
    if (!current || Number(scene.cloud_cover ?? 100) < Number(current.cloud_cover ?? 100)) bins.set(bin, scene);
  }
  return [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, scene]) => scene);
}

export interface BackfillSummary { years: number[]; candidates: number; stored: number; alreadyStored: number; unusable: number; failed: number }

/**
 * Stores usable Sentinel-2 NDVI readings from earlier years for one field, for the seasonal baseline only.
 * Only the field's primary tile is used, so readings are never mixed across tiles. Never touches vegetation_indices.
 */
export async function backfillBaseline(db: Db, fieldId: string, years: number[], engine: BaselineEngine, now = new Date()) {
  const thisYear = now.getUTCFullYear();
  if (!years.length || years.some(year => !Number.isInteger(year) || year < 2018 || year >= thisYear)) throw new Error(`Choose earlier years from 2018 to ${thisYear - 1}`);
  const field = (await db.query('select boundary_version, sentinel_tile from public.fields where id=$1', [fieldId])).rows[0];
  if (!field) throw new Error('Field not found');
  const version = Number(field.boundary_version);
  const summary: BackfillSummary = { years: [...years].sort(), candidates: 0, stored: 0, alreadyStored: 0, unusable: 0, failed: 0 };
  const found: BaselineScene[] = [];
  for (const year of summary.years) {
    for (let month = 0; month < 12; month += 1) {
      const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      const end = new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10);
      found.push(...await engine.search(start, end));
    }
  }
  const tile = primaryTile(found.map(scene => tileOf(scene.id)), (field.sentinel_tile as string | null) ?? null);
  const picks = pickBaselineScenes(found, tile);
  summary.candidates = picks.length;
  const known = new Set((await db.query('select scene_id from public.field_ndvi_baseline where field_id=$1 and boundary_version=$2', [fieldId, version])).rows.map(row => String(row.scene_id)));
  for (const scene of picks) {
    const sceneId = `gee-${scene.id}`;
    if (known.has(sceneId)) { summary.alreadyStored += 1; continue; }
    let measured: BaselineMeasurement | null;
    try { measured = await engine.measure(scene.image_id); } catch { summary.failed += 1; continue; }
    if (!measured || !Number.isFinite(measured.ndvi) || measured.ndvi < -1 || measured.ndvi > 1 || !Number.isInteger(measured.validPixels) || !Number.isFinite(measured.validCoverage)
      || measured.validCoverage < defaultPolicy.minCoverage || measured.validPixels < defaultPolicy.minPixels) { summary.unusable += 1; continue; }
    await db.query(`insert into public.field_ndvi_baseline (field_id, boundary_version, scene_id, observed_on, ndvi_value, valid_coverage_percent, valid_pixel_count, tile_id, source)
      values ($1,$2,$3,$4::timestamptz at time zone 'UTC',$5,$6,$7,$8,$9) on conflict (field_id, scene_id, boundary_version) do nothing`,
      [fieldId, version, sceneId, scene.observed_at, measured.ndvi, measured.validCoverage, measured.validPixels, tileOf(scene.id), BASELINE_SOURCE]);
    summary.stored += 1;
  }
  return summary;
}
