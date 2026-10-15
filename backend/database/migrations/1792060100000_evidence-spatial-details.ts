import type { MigrationBuilder } from 'node-pg-migrate';
export async function up(pgm:MigrationBuilder):Promise<void> {
  pgm.sql(`
    alter table public.vegetation_indices alter column cloud_cover drop not null;
    alter table public.vegetation_indices alter column cloud_cover drop default;
    alter table public.vegetation_indices add column inspection_geom geometry(MultiPolygon,4326),
      add column affected_coverage_percent numeric(5,2);
  `);
}
export async function down():Promise<void> { throw new Error('Forward-only provenance migration'); }
