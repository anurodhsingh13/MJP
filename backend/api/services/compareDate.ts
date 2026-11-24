import { pool } from '../db/pool.ts';
import { processScene, ProcessingError, engineUrl, EARTH_ENGINE_SOURCE } from './satellite.ts';
import { ingestOpenSentinel, primaryTile, satelliteProvider, OPEN_SENTINEL_SOURCE } from './openSentinel.ts';

const DAY = 86400000;
/** How far from the chosen date an image may be and still count as "that date". */
export const SEARCH_RADIUS_DAYS = 5;
/** Stored images this close to the chosen date are reused instead of searching again. */
export const REUSE_RADIUS_DAYS = 3;
/** Sentinel-2 L2A covers the farm regions from 2017; the picker is limited to the last two years. */
export const MAX_LOOKBACK_DAYS = 730;
const MAX_ATTEMPTS = 4;

export interface DateScene { scene_id: string; observed_at: string | Date; cloud_cover: number | string | null; tile_id: string | null; rejected: boolean }

/** Closest acquisition to the chosen date first, then the clearest. Scenes already rejected for this boundary are skipped. */
export function rankScenesForDate(scenes: DateScene[], targetMs: number, beforeMs: number | null = null, radiusDays = SEARCH_RADIUS_DAYS) {
  return scenes
    .map(scene => ({ scene, time: new Date(scene.observed_at).getTime() }))
    .filter(({ scene, time }) => Number.isFinite(time) && !scene.rejected && Math.abs(time - targetMs) <= radiusDays * DAY && (beforeMs === null || time < beforeMs))
    .sort((a, b) => Math.abs(a.time - targetMs) - Math.abs(b.time - targetMs) || Number(a.scene.cloud_cover ?? 100) - Number(b.scene.cloud_cover ?? 100))
    .map(({ scene }) => scene);
}

export interface DateRequest { targetMs: number; beforeMs: number | null; date: string }
/** Validates the YYYY-MM-DD the user chose. `before` is the date of the image it will be compared with. */
export function parseDateRequest(input: { date?: unknown; before?: unknown }, now = Date.now()): DateRequest {
  const valid = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(input.date)) throw new ProcessingError('Choose a valid date', 400);
  const date = input.date as string;
  const startOfDay = Date.parse(`${date}T00:00:00Z`);
  if (startOfDay >= Math.floor(now / DAY) * DAY) throw new ProcessingError('Choose a date in the past', 400);
  if (startOfDay < now - MAX_LOOKBACK_DAYS * DAY) throw new ProcessingError('Choose a date within the last 2 years', 400);
  let beforeMs: number | null = null;
  if (input.before !== undefined && input.before !== null && input.before !== '') {
    if (!valid(input.before)) throw new ProcessingError('Invalid comparison date', 400);
    beforeMs = Date.parse(`${input.before as string}T00:00:00Z`);
    if (startOfDay >= beforeMs) throw new ProcessingError('Choose a date earlier than the image you are comparing with', 400);
  }
  // Scenes are timestamped in the early morning UTC; aim at the middle of the chosen day.
  return { targetMs: startOfDay + DAY / 2, beforeMs, date };
}

/** Earth Engine scene search for an explicit date window (the controller's version only looks back N days from now). */
async function ingestEarthEngineWindow(fieldId: string, start: string, end: string) {
  const field = (await pool.query<{ boundary_geojson: Record<string, unknown> | null; sentinel_tile: string | null }>(
    'select ST_AsGeoJSON(boundary_geom)::jsonb as boundary_geojson, sentinel_tile from public.fields where id=$1', [fieldId])).rows[0];
  if (!field) throw new ProcessingError('Field not found', 404);
  if (!field.boundary_geojson) throw new ProcessingError('A field boundary is required', 400);
  const response = await fetch(`${engineUrl()}/earth-engine/scenes`, {
    signal: AbortSignal.timeout(180000), method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ polygonGeojson: field.boundary_geojson, start, end, limit: 20 }),
  });
  if (!response.ok) throw new ProcessingError(response.status === 503 ? 'Google Earth Engine is not configured.' : 'Google Earth Engine image search failed. Retry shortly.', response.status === 503 ? 503 : 502);
  const catalog = await response.json() as { scenes?: Array<{ id: string; image_id: string; observed_at: string; cloud_cover: number | null }> };
  const tileOf = (scene: { id: string }) => /_T(\d{2}[C-X][A-Z]{2})$/.exec(scene.id)?.[1] ?? null;
  const usable = (catalog.scenes ?? []).filter(scene => scene.id && scene.image_id && Number.isFinite(Date.parse(scene.observed_at)));
  const fieldTile = primaryTile(usable.map(tileOf), field.sentinel_tile ?? null);
  if (fieldTile && !field.sentinel_tile) await pool.query('update public.fields set sentinel_tile=$2 where id=$1 and sentinel_tile is null', [fieldId, fieldTile]);
  const catalogUrl = 'https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED';
  for (const scene of usable) {
    const tile = tileOf(scene);
    if (fieldTile && tile !== fieldTile) continue;
    await pool.query(`insert into public.satellite_scenes (field_id, scene_id, collection, observed_at, cloud_cover, source, catalog_url, assets, tile_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (field_id, scene_id) do update set cloud_cover=excluded.cloud_cover, assets=excluded.assets, source=excluded.source, catalog_url=excluded.catalog_url, tile_id=excluded.tile_id`,
      [fieldId, `gee-${scene.id}`, 'COPERNICUS/S2_SR_HARMONIZED', scene.observed_at, scene.cloud_cover, EARTH_ENGINE_SOURCE, catalogUrl, JSON.stringify({ earth_engine: { image_id: scene.image_id } }), tile]);
  }
}

export interface DateResult {
  found: boolean; sceneId?: string; observedAt?: string; daysFromRequested?: number; reused?: boolean;
  requestedDate: string; message: string; attempts?: number;
}

/**
 * Finds (or fetches and processes) the clearest accepted image closest to a past date, so the user can compare
 * it with the latest image. Nothing is invented: if no clear image exists near that date, it says so.
 */
export async function imageForDate(fieldId: string, input: { date?: unknown; before?: unknown }): Promise<DateResult> {
  const request = parseDateRequest(input);
  const field = (await pool.query<{ boundary_version: number; sentinel_tile: string | null }>('select boundary_version, sentinel_tile from public.fields where id=$1', [fieldId])).rows[0];
  if (!field) throw new ProcessingError('Field not found', 404);
  const beforeIso = request.beforeMs === null ? null : new Date(request.beforeMs).toISOString();
  const daysAway = (time: number) => Math.round(Math.abs(time - request.targetMs) / DAY);

  // 1. An accepted image already stored for this boundary, close to the chosen date.
  const stored = (await pool.query<{ scene_id: string; acquired_at: string }>(`select scene_id, acquired_at from public.vegetation_indices
    where field_id=$1 and boundary_version=$2 and accepted and provenance='measured_imagery' and scene_id is not null
      and abs(extract(epoch from acquired_at) * 1000 - $3) <= $4 and ($5::timestamptz is null or acquired_at < $5)
    order by abs(extract(epoch from acquired_at) * 1000 - $3) limit 1`,
    [fieldId, field.boundary_version, request.targetMs, REUSE_RADIUS_DAYS * DAY, beforeIso])).rows[0];
  if (stored) {
    const time = new Date(stored.acquired_at).getTime();
    return { found: true, sceneId: stored.scene_id, observedAt: new Date(time).toISOString(), daysFromRequested: daysAway(time), reused: true, requestedDate: request.date, message: 'Using an image already saved for this field.' };
  }

  // 2. Search the satellite catalogue around that date.
  const provider = satelliteProvider();
  const start = new Date(request.targetMs - (SEARCH_RADIUS_DAYS + 1) * DAY).toISOString().slice(0, 10);
  const end = new Date(request.targetMs + (SEARCH_RADIUS_DAYS + 1) * DAY).toISOString().slice(0, 10);
  if (provider === 'earth-engine') await ingestEarthEngineWindow(fieldId, start, end);
  else await ingestOpenSentinel(fieldId, { start, end, maxItems: 100 });

  const tile = (await pool.query<{ sentinel_tile: string | null }>('select sentinel_tile from public.fields where id=$1', [fieldId])).rows[0]?.sentinel_tile ?? field.sentinel_tile;
  const candidates = (await pool.query<DateScene>(`select s.scene_id, s.observed_at, s.cloud_cover, s.tile_id,
      (coalesce(s.processing_boundary_version=$2,false) and s.processing_status='rejected') as rejected
    from public.satellite_scenes s
    where s.field_id=$1 and s.source=$3 and s.observed_at >= $4::date and s.observed_at < $5::date and s.observed_at <= now()
      and ($6::text is null or s.tile_id is null or s.tile_id=$6)`,
    [fieldId, field.boundary_version, provider === 'earth-engine' ? EARTH_ENGINE_SOURCE : OPEN_SENTINEL_SOURCE, start, end, tile])).rows;
  const ranked = rankScenesForDate(candidates, request.targetMs, request.beforeMs);
  if (!ranked.length) return { found: false, requestedDate: request.date, message: `No clear satellite image within ${SEARCH_RADIUS_DAYS} days of this date (clouds, or no pass over the field). Try a nearby date.` };

  // 3. Process the closest candidates until one passes the quality check.
  let attempts = 0;
  for (const scene of ranked.slice(0, MAX_ATTEMPTS)) {
    attempts++;
    try {
      const result = await processScene(fieldId, scene.scene_id);
      if (result.accepted) {
        const time = new Date(scene.observed_at).getTime();
        return { found: true, sceneId: scene.scene_id, observedAt: new Date(time).toISOString(), daysFromRequested: daysAway(time), reused: false, requestedDate: request.date, attempts, message: 'Image found and processed.' };
      }
    } catch (error) {
      // 409 means another request is already processing this scene; any other 4xx stops the search.
      if (error instanceof ProcessingError && [400, 404].includes(error.status)) throw error;
    }
  }
  return { found: false, requestedDate: request.date, attempts, message: 'Images near this date were too cloudy or did not cover the field well enough. Try a nearby date.' };
}
