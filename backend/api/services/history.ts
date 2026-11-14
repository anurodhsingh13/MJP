import { pool } from '../db/pool.ts';
import { processScene, ProcessingError, EARTH_ENGINE_SOURCE } from './satellite.ts';
import { ingestOpenSentinel, OPEN_SENTINEL_SOURCE } from './openSentinel.ts';

const DAY = 86400000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const setting = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= min && value <= max ? Math.floor(value) : fallback;
};

/**
 * Season window for the NDVI history: from 15 days before sowing when a recent sowing date exists,
 * otherwise the last 180 days. Never longer than one year.
 */
export function historyWindow(plantingDate: string | null, now = Date.now()) {
  const planting = plantingDate ? Date.parse(`${plantingDate.slice(0, 10)}T00:00:00Z`) : NaN;
  const recentSowing = Number.isFinite(planting) && planting < now && now - planting <= 300 * DAY;
  const start = recentSowing ? planting - 15 * DAY : now - setting('SATELLITE_HISTORY_DAYS', 180, 30, 365) * DAY;
  return { start: iso(Math.max(start, now - 365 * DAY)), end: iso(now + DAY), fromSowing: recentSowing };
}

export interface HistoryCandidate { scene_id: string; observed_at: string | Date; cloud_cover: number | string | null; tile_id: string | null; accepted: boolean; processing_status: string | null; same_boundary: boolean }
/**
 * One scene per bin of `binDays`, newest bins first: the least cloudy scene that has not already been
 * rejected for this boundary. Bins that already hold an accepted observation are skipped.
 */
export function pickHistoryScenes(candidates: HistoryCandidate[], end: number, binDays = 10, max = 18) {
  const bins = new Map<number, HistoryCandidate[]>();
  for (const scene of candidates) {
    const time = new Date(scene.observed_at).getTime();
    if (!Number.isFinite(time) || time > end) continue;
    const bin = Math.floor((end - time) / (binDays * DAY));
    bins.set(bin, [...(bins.get(bin) ?? []), scene]);
  }
  const picks: HistoryCandidate[] = [];
  for (const bin of [...bins.keys()].sort((a, b) => a - b)) {
    const scenes = bins.get(bin)!;
    if (scenes.some(scene => scene.accepted)) continue;
    const open = scenes.filter(scene => !(scene.same_boundary && ['rejected', 'processed'].includes(scene.processing_status ?? '')))
      .sort((a, b) => Number(a.cloud_cover ?? 100) - Number(b.cloud_cover ?? 100) || String(b.observed_at).localeCompare(String(a.observed_at)));
    if (open[0]) picks.push(open[0]);
    if (picks.length >= max) break;
  }
  return picks;
}

/** Builds the season NDVI time series: discover scenes, then process one clear image per ~10 days. */
export async function backfillHistory(fieldId: string, provider: 'earth-engine' | 'earth-search', ingestEarthEngine: (days: number) => Promise<unknown>, report: (progress: string) => Promise<void>) {
  const field = (await pool.query<{ planting_date: string | null; boundary_version: number; sentinel_tile: string | null }>(
    'select planting_date, boundary_version, sentinel_tile from public.fields where id=$1', [fieldId])).rows[0];
  if (!field) throw new ProcessingError('Field not found', 404);
  const window = historyWindow(field.planting_date);
  await report('Searching Sentinel-2 images for the season');
  const days = Math.ceil((Date.parse(window.end) - Date.parse(window.start)) / DAY);
  if (provider === 'earth-engine') await ingestEarthEngine(Math.min(days, 365));
  else await ingestOpenSentinel(fieldId, { start: window.start, end: window.end, maxItems: 300 });
  const tile = (await pool.query<{ sentinel_tile: string | null }>('select sentinel_tile from public.fields where id=$1', [fieldId])).rows[0]?.sentinel_tile ?? field.sentinel_tile;
  const source = provider === 'earth-engine' ? EARTH_ENGINE_SOURCE : OPEN_SENTINEL_SOURCE;
  const candidates = (await pool.query<HistoryCandidate>(`select s.scene_id, s.observed_at, s.cloud_cover, s.tile_id, s.processing_status,
      coalesce(s.processing_boundary_version=$2,false) as same_boundary,
      exists(select 1 from public.vegetation_indices vi where vi.field_id=s.field_id and vi.scene_id=s.scene_id and vi.boundary_version=$2 and vi.accepted) as accepted
    from public.satellite_scenes s
    where s.field_id=$1 and s.source=$3 and s.observed_at >= $4::date and s.observed_at < $5::date and s.observed_at <= now()
      and ($6::text is null or s.tile_id is null or s.tile_id=$6)`,
    [fieldId, field.boundary_version, source, window.start, window.end, tile])).rows;
  const picks = pickHistoryScenes(candidates, Date.now(), setting('SATELLITE_HISTORY_BIN_DAYS', 10, 5, 30), setting('SATELLITE_HISTORY_MAX', 18, 1, 40));
  const summary = { window, tile, candidates: candidates.length, attempted: 0, accepted: 0, rejected: 0, failed: 0 };
  for (const scene of picks) {
    summary.attempted++;
    await report(`Processing image ${summary.attempted} of ${picks.length} (${new Date(scene.observed_at).toISOString().slice(0, 10)})`);
    try {
      const result = await processScene(fieldId, scene.scene_id);
      if (result.accepted) summary.accepted++; else summary.rejected++;
    } catch (error) {
      if (error instanceof ProcessingError && error.status === 422) summary.rejected++;
      else if (error instanceof ProcessingError && [400, 404].includes(error.status)) throw error;
      else summary.failed++;
    }
  }
  return summary;
}
