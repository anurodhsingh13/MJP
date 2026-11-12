import { pool } from '../db/pool.ts';
import { ProcessingError } from './satellite.ts';

/**
 * Open Sentinel-2 Level-2A access through the Earth Search STAC API (Element 84, AWS Open Data).
 * No account or key is needed: the engine reads the public Cloud-Optimized GeoTIFF bands directly.
 */
export const OPEN_SENTINEL_SOURCE = 'Copernicus Sentinel-2 L2A / Earth Search';
const BANDS = ['red', 'nir', 'scl', 'blue', 'rededge1', 'swir16'] as const;
type Band = typeof BANDS[number];
type RasterBand = { scale?: number; offset?: number; nodata?: number };
export interface StacItem {
  id: string;
  geometry: Record<string, unknown> | null;
  properties: Record<string, unknown>;
  assets: Record<string, { href?: string; 'raster:bands'?: RasterBand[] }>;
  links?: Array<{ rel?: string; href?: string }>;
}
export const earthSearchUrl = () => (process.env.EARTH_SEARCH_URL || 'https://earth-search.aws.element84.com/v1').replace(/\/+$/, '');
export const earthSearchCollection = () => process.env.EARTH_SEARCH_COLLECTION || 'sentinel-2-c1-l2a';
const maxCloud = () => {
  const value = Number(process.env.SATELLITE_MAX_CLOUD ?? 40);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : 40;
};

/** MGRS tile such as 43RGK, from STAC grid metadata or the item id. */
export function tileOf(item: Pick<StacItem, 'id' | 'properties'>): string | null {
  const normalize = (zone: string, square: string) => `${zone.padStart(2, '0')}${square}`;
  const code = item.properties['grid:code'];
  if (typeof code === 'string') {
    const match = code.replace(/^MGRS-/, '').match(/^(\d{1,2})([C-X][A-Z]{2})$/);
    if (match) return normalize(match[1], match[2]);
  }
  const zone = item.properties['mgrs:utm_zone'], band = item.properties['mgrs:latitude_band'], square = item.properties['mgrs:grid_square'];
  if ((typeof zone === 'number' || typeof zone === 'string') && typeof band === 'string' && typeof square === 'string' && /^[A-Z]{2}$/.test(square)) return normalize(String(zone), band + square);
  const fromId = item.id.match(/_T?(\d{2})([C-X][A-Z]{2})_/);
  return fromId ? normalize(fromId[1], fromId[2]) : null;
}

/** Public HTTPS object storage only: the engine must never be pointed at an arbitrary host. */
export function safeAssetUrl(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  try {
    const url = new URL(href);
    const hosts = (process.env.EARTH_SEARCH_ASSET_HOSTS || '.amazonaws.com').split(',').map(item => item.trim()).filter(Boolean);
    return url.protocol === 'https:' && hosts.some(host => url.hostname === host.replace(/^\./, '') || url.hostname.endsWith(host.startsWith('.') ? host : `.${host}`)) ? url.toString() : null;
  } catch { return null; }
}

/** Keeps only the bands the engine uses, with their reflectance scale/offset. Null when a required band is missing. */
export function sceneAssets(item: StacItem): Record<Band, { href: string; 'raster:bands'?: RasterBand[] }> | null {
  const assets: Partial<Record<Band, { href: string; 'raster:bands'?: RasterBand[] }>> = {};
  for (const band of BANDS) {
    const href = safeAssetUrl(item.assets?.[band]?.href);
    if (!href) continue;
    const raster = item.assets[band]['raster:bands']?.[0];
    assets[band] = raster && Number.isFinite(raster.scale) ? { href, 'raster:bands': [{ scale: raster.scale, offset: raster.offset ?? 0, nodata: raster.nodata }] } : { href };
  }
  // Reflectance bands without scale/offset would be guessed; the engine refuses those, so do not ingest them.
  if (!assets.red?.['raster:bands'] || !assets.nir?.['raster:bands'] || !assets.scl) return null;
  return assets as Record<Band, { href: string; 'raster:bands'?: RasterBand[] }>;
}

/**
 * One scene per acquisition day from one MGRS tile. Sentinel-2 overlap zones deliver the same pass in
 * two tiles whose surface reflectance is corrected separately; mixing them creates false NDVI jumps.
 * Prefers tiles whose data footprint fully covers the field, keeps the field's stored tile when present,
 * otherwise the most frequent covering tile (ties broken alphabetically for a stable choice).
 */
export function chooseScenes(items: StacItem[], coveringIds: Set<string>, preferredTile: string | null) {
  const entries = items.map(item => ({ item, tile: tileOf(item), covers: coveringIds.has(item.id) }));
  const candidates = entries.some(entry => entry.covers) ? entries.filter(entry => entry.covers) : entries;
  let tile = preferredTile && candidates.some(entry => entry.tile === preferredTile) ? preferredTile : null;
  if (!tile) {
    const counts = new Map<string, number>();
    for (const entry of candidates) if (entry.tile) counts.set(entry.tile, (counts.get(entry.tile) ?? 0) + 1);
    tile = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  }
  const fromTile = tile ? candidates.filter(entry => entry.tile === tile) : candidates;
  const byDay = new Map<string, { item: StacItem; cloud: number }>();
  for (const { item } of fromTile) {
    const when = String(item.properties.datetime ?? '');
    if (!Number.isFinite(Date.parse(when))) continue;
    const day = when.slice(0, 10);
    const cloud = Number(item.properties['eo:cloud_cover'] ?? 100);
    const current = byDay.get(day);
    if (!current || cloud < current.cloud) byDay.set(day, { item, cloud: Number.isFinite(cloud) ? cloud : 100 });
  }
  return { tile, scenes: [...byDay.values()].map(entry => entry.item).sort((a, b) => String(b.properties.datetime).localeCompare(String(a.properties.datetime))) };
}

async function search(boundary: Record<string, unknown>, start: string, end: string, maxItems: number): Promise<StacItem[]> {
  const items: StacItem[] = [];
  let request: { url: string; body: Record<string, unknown> } | null = {
    url: `${earthSearchUrl()}/search`,
    body: { collections: [earthSearchCollection()], intersects: boundary, datetime: `${start}T00:00:00Z/${end}T23:59:59Z`,
      limit: Math.min(100, maxItems), query: { 'eo:cloud_cover': { lt: maxCloud() } },
      sortby: [{ field: 'properties.datetime', direction: 'desc' }] },
  };
  for (let page = 0; request && page < 5 && items.length < maxItems; page++) {
    const response = await fetch(request.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/geo+json' }, body: JSON.stringify(request.body), signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new ProcessingError(`Earth Search Sentinel-2 search failed (${response.status})`, 502);
    const payload = await response.json() as { features?: unknown; links?: Array<{ rel?: string; href?: string; body?: Record<string, unknown>; method?: string }> };
    if (!Array.isArray(payload.features)) throw new ProcessingError('Earth Search returned an invalid response', 502);
    for (const feature of payload.features as StacItem[]) {
      if (feature && typeof feature.id === 'string' && feature.properties && feature.assets) items.push(feature);
    }
    const next = payload.links?.find(link => link.rel === 'next' && typeof link.href === 'string');
    request = next?.href && next.body && next.href.startsWith(earthSearchUrl()) ? { url: next.href, body: next.body } : null;
  }
  return items.slice(0, maxItems);
}

/** Searches open Sentinel-2 imagery for a field and stores one tile-consistent scene per day. */
export async function ingestOpenSentinel(fieldId: string, window: { start: string; end: string; maxItems?: number }) {
  const field = (await pool.query<{ boundary_geojson: Record<string, unknown> | null; sentinel_tile: string | null }>(
    'select ST_AsGeoJSON(boundary_geom)::jsonb as boundary_geojson, sentinel_tile from public.fields where id=$1', [fieldId])).rows[0];
  if (!field) throw new ProcessingError('Field not found', 404);
  if (!field.boundary_geojson) throw new ProcessingError('A field boundary is required', 400);
  const items = await search(field.boundary_geojson, window.start, window.end, window.maxItems ?? 100);
  const footprints = items.map(item => item.geometry ?? null);
  const covering = new Set<string>();
  if (items.length) {
    const rows = (await pool.query<{ index: number }>(`select (t.ordinality-1)::int as index
      from jsonb_array_elements($1::jsonb) with ordinality as t(geom, ordinality), public.fields f
      where f.id=$2 and t.geom is not null and jsonb_typeof(t.geom)='object'
        and ST_Covers(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(t.geom::text),4326)), f.boundary_geom)`, [JSON.stringify(footprints), fieldId])).rows;
    for (const row of rows) if (items[row.index]) covering.add(items[row.index].id);
  }
  const { tile, scenes } = chooseScenes(items, covering, field.sentinel_tile);
  if (tile && !field.sentinel_tile) await pool.query('update public.fields set sentinel_tile=$2 where id=$1 and sentinel_tile is null', [fieldId, tile]);
  let imported = 0;
  for (const item of scenes) {
    const assets = sceneAssets(item);
    if (!assets) continue;
    const self = item.links?.find(link => link.rel === 'self')?.href ?? `${earthSearchUrl()}/collections/${earthSearchCollection()}/items/${item.id}`;
    const cloud = Number(item.properties['eo:cloud_cover']);
    await pool.query(`insert into public.satellite_scenes (field_id, scene_id, collection, observed_at, cloud_cover, source, catalog_url, assets, tile_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (field_id, scene_id) do update set cloud_cover=excluded.cloud_cover, assets=excluded.assets, source=excluded.source,
        catalog_url=excluded.catalog_url, tile_id=excluded.tile_id`,
      [fieldId, `es-${item.id}`, earthSearchCollection(), item.properties.datetime, Number.isFinite(cloud) ? cloud : null, OPEN_SENTINEL_SOURCE, self, JSON.stringify(assets), tileOf(item)]);
    imported++;
  }
  return { source: OPEN_SENTINEL_SOURCE, collection: earthSearchCollection(), catalogUrl: `${earthSearchUrl()}/collections/${earthSearchCollection()}`, imported, tile, searched: items.length };
}

/** 'earth-engine' when explicitly chosen or when an Earth Engine project is configured; open data otherwise. */
export function satelliteProvider(): 'earth-engine' | 'earth-search' {
  const choice = (process.env.SATELLITE_PROVIDER || 'auto').trim().toLowerCase();
  if (choice === 'earth-engine' || choice === 'earth-search') return choice;
  const project = process.env.EARTH_ENGINE_PROJECT_ID?.trim() ?? '';
  // Placeholders copied from .env.example ("your-...") do not count as a configured project.
  return project && !project.startsWith('your-') ? 'earth-engine' : 'earth-search';
}
