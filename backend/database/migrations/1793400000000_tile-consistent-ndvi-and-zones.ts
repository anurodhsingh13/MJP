import type {MigrationBuilder} from 'node-pg-migrate';

/**
 * Tile-consistent NDVI time series and per-image NDVI zones.
 * - Sentinel-2 overlap areas are delivered in two MGRS tiles with separately corrected reflectance,
 *   so a field keeps one primary tile and observations remember the tile they came from.
 * - ndvi_classes stores the share of clear field pixels in each NDVI range.
 * - 'history' jobs backfill one image per ~10 days for the season.
 */
export async function up(pgm:MigrationBuilder):Promise<void>{
 pgm.sql(`
  alter table public.fields add column if not exists sentinel_tile text;
  alter table public.satellite_scenes add column if not exists tile_id text;
  alter table public.vegetation_indices add column if not exists tile_id text;
  alter table public.vegetation_indices add column if not exists ndvi_classes jsonb;
  alter table public.ingestion_jobs drop constraint if exists ingestion_jobs_kind_check;
  alter table public.ingestion_jobs add constraint ingestion_jobs_kind_check check(kind in ('satellite','weather','history'));
 `);
}

export async function down(pgm:MigrationBuilder):Promise<void>{
 pgm.sql(`
  delete from public.ingestion_jobs where kind='history';
  alter table public.ingestion_jobs drop constraint if exists ingestion_jobs_kind_check;
  alter table public.ingestion_jobs add constraint ingestion_jobs_kind_check check(kind in ('satellite','weather'));
  alter table public.vegetation_indices drop column if exists ndvi_classes;
  alter table public.vegetation_indices drop column if exists tile_id;
  alter table public.satellite_scenes drop column if exists tile_id;
  alter table public.fields drop column if exists sentinel_tile;
 `);
}
