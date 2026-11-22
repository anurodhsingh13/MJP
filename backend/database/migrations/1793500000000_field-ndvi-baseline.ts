import type {MigrationBuilder} from 'node-pg-migrate';

/**
 * Earlier-season Sentinel-2 NDVI readings for a field, used only to say what is usual for this field at this time of year.
 * Kept apart from vegetation_indices so past years never appear as the field's current evidence, alerts or history.
 */
export async function up(pgm:MigrationBuilder):Promise<void>{
 pgm.sql(`
  create table public.field_ndvi_baseline (
   field_id uuid not null references public.fields(id) on delete cascade,
   boundary_version integer not null,
   scene_id text not null,
   observed_on date not null,
   ndvi_value numeric not null check(ndvi_value between -1 and 1),
   valid_coverage_percent numeric not null,
   valid_pixel_count integer not null,
   tile_id text,
   source text not null,
   imported_at timestamptz not null default now(),
   primary key(field_id,scene_id,boundary_version)
  );
  create index field_ndvi_baseline_lookup on public.field_ndvi_baseline(field_id,boundary_version,observed_on);
 `);
}

export async function down(pgm:MigrationBuilder):Promise<void>{pgm.dropTable({schema:'public',name:'field_ndvi_baseline'});}
