import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    alter table public.fields
      add column provenance text not null default 'legacy_unverified',
      add column boundary_version integer not null default 1,
      add column latest_scene_id text,
      add column latest_observed_at timestamptz;
    alter table public.fields alter column provenance set default 'user_reported';
    -- Preserve every legacy measurement. Existing scores are not proof of measured imagery.
    update public.fields set provenance = 'public_boundary' where name like 'Public demo:%';
    update public.fields set provenance = 'demo' where provenance = 'legacy_unverified' and
      ((name = 'North block' and crop = 'Winter wheat' and area_hectares = 42.8) or
       (name = 'River bend' and crop = 'Soybean' and area_hectares = 31.4) or
       (name = 'East orchard' and crop = 'Apple' and area_hectares = 18.6));
    create table public.field_boundary_versions (
      field_id uuid not null references public.fields(id) on delete cascade,
      version integer not null,
      boundary_geom geometry(Polygon,4326),
      recorded_at timestamptz not null default now(),
      primary key (field_id, version)
    );
    insert into public.field_boundary_versions (field_id, version, boundary_geom)
      select id, boundary_version, boundary_geom from public.fields;
    alter table public.vegetation_indices
      add column provenance text not null default 'legacy_unverified',
      add column boundary_version integer not null default 0,
      add column acquired_at timestamptz,
      add column accepted boolean not null default false,
      add column quality_reason text,
      add column calculation_version text not null default 'legacy-unverified',
      add column vegetation_score integer;
    alter table public.vegetation_indices drop constraint vegetation_indices_field_id_scene_id_observed_on_key;
    alter table public.vegetation_indices add constraint vegetation_indices_boundary_scene_key
      unique (field_id, scene_id, observed_on, boundary_version);
    create index vegetation_accepted_latest on public.vegetation_indices(field_id, boundary_version, acquired_at desc, scene_id desc) where accepted;
    alter table public.satellite_scenes
      add column processing_status text not null default 'discovered'
        check (processing_status in ('discovered','queued','processing','processed','rejected','failed')),
      add column processing_boundary_version integer,
      add column processing_token uuid,
      add column processing_started_at timestamptz,
      add column processing_finished_at timestamptz,
      add column processing_error text,
      add column valid_coverage_percent numeric(5,2),
      add column valid_pixel_count integer;
    alter table public.alerts add column boundary_version integer not null default 0,
      add column evidence_key text, add column interpretation text;
    create unique index alerts_evidence_key on public.alerts(field_id, evidence_key) where evidence_key is not null;
    create or replace function public.record_field_boundary() returns trigger language plpgsql as $$
    begin
      if TG_OP = 'INSERT' then
        insert into public.field_boundary_versions(field_id,version,boundary_geom) values (NEW.id,NEW.boundary_version,NEW.boundary_geom);
      elsif NEW.boundary_geom is distinct from OLD.boundary_geom then
        NEW.boundary_version := OLD.boundary_version + 1;
        NEW.latest_scene_id := null; NEW.latest_observed_at := null; NEW.last_observation := null;
        NEW.health_score := 0; NEW.ndvi_average := 0; NEW.health_delta := 0;
        insert into public.field_boundary_versions(field_id,version,boundary_geom) values (NEW.id,NEW.boundary_version,NEW.boundary_geom);
        update public.satellite_scenes set processing_status='discovered', processing_boundary_version=null,
          processing_token=null,processing_started_at=null,processing_error=null,
          valid_coverage_percent=null,valid_pixel_count=null where field_id=NEW.id;
      end if;
      return NEW;
    end $$;
    create trigger field_boundary_insert after insert on public.fields for each row execute function public.record_field_boundary();
    create trigger field_boundary_update before update of boundary_geom on public.fields for each row execute function public.record_field_boundary();
  `);
}
export async function down(): Promise<void> {
  throw new Error('Evidence provenance is data-preserving and forward-only. Restore a backup to roll back.');
}
