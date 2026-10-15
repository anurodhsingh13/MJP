import type {MigrationBuilder} from 'node-pg-migrate';
export async function up(pgm:MigrationBuilder):Promise<void>{
 pgm.sql(`
 create table public.app_users(id uuid primary key default gen_random_uuid(),email text unique not null,password_hash text not null,created_at timestamptz not null default now());
 create table public.app_sessions(token_hash text primary key,user_id uuid not null references app_users(id) on delete cascade,expires_at timestamptz not null,created_at timestamptz not null default now());
 create index app_sessions_expiry on app_sessions(expires_at);
 create table public.auth_limits(key text primary key,attempts integer not null,window_start timestamptz not null default now());
 alter table public.fields add column owner_id uuid references app_users(id),add column client_key uuid;
 create unique index fields_client_key on fields(client_key) where client_key is not null;
 create index fields_owner on fields(owner_id);
 create table public.field_claim_audit(id uuid primary key default gen_random_uuid(),field_id uuid not null references fields(id) on delete cascade,user_id uuid not null references app_users(id),claimed_at timestamptz not null default now());
 create table public.ingestion_jobs(id uuid primary key default gen_random_uuid(),field_id uuid not null references fields(id) on delete cascade,owner_id uuid references app_users(id),boundary_version integer not null,kind text not null check(kind in ('satellite','weather')),status text not null default 'queued' check(status in ('queued','running','succeeded','failed')),attempts integer not null default 0,max_attempts integer not null default 3,progress text not null default 'Queued',result jsonb,error text,available_at timestamptz not null default now(),heartbeat_at timestamptz,lease_token uuid,created_at timestamptz not null default now(),finished_at timestamptz);
 create unique index jobs_active on ingestion_jobs(field_id,kind) where status in ('queued','running');
 create index jobs_queue on ingestion_jobs(available_at,created_at) where status='queued';
 create table public.scouting_cases(id uuid primary key default gen_random_uuid(),field_id uuid not null references fields(id) on delete cascade,client_key uuid not null,observed_on date not null,crop text,symptoms text,notes text,latitude numeric,longitude numeric,follow_up date,scene_id text,boundary_version integer not null,diagnosis_status text not null default 'unavailable',diagnosis jsonb not null default '{"reason":"No licensed, validated diagnosis provider is configured"}',created_at timestamptz not null default now(),unique(field_id,client_key));
 create table public.scouting_photos(id uuid primary key default gen_random_uuid(),case_id uuid not null references scouting_cases(id) on delete cascade,storage_key text unique not null,mime text not null,width integer not null,height integer not null,quality text not null,created_at timestamptz not null default now());
 create table public.field_tasks(id uuid primary key default gen_random_uuid(),field_id uuid not null references fields(id) on delete cascade,case_id uuid references scouting_cases(id) on delete cascade,title text not null,due_on date,status text not null default 'open' check(status in ('open','acknowledged','action_taken','resolved')),created_at timestamptz not null default now(),completed_at timestamptz);
 alter table public.alerts add column action_status text not null default 'open' check(action_status in ('open','acknowledged','action_taken','resolved','superseded'));
 update public.alerts set action_status='resolved' where resolved;
 alter table public.field_events add column client_key uuid;
 create unique index events_client_key on field_events(field_id,client_key) where client_key is not null;
 create or replace function public.record_field_boundary() returns trigger language plpgsql as $$
 begin
  if TG_OP='INSERT' then
   insert into public.field_boundary_versions(field_id,version,boundary_geom) values(NEW.id,NEW.boundary_version,NEW.boundary_geom);
  elsif NEW.boundary_geom is distinct from OLD.boundary_geom then
   NEW.boundary_version:=OLD.boundary_version+1;
   NEW.latest_scene_id:=null;NEW.latest_observed_at:=null;NEW.last_observation:=null;
   NEW.health_score:=0;NEW.ndvi_average:=0;NEW.health_delta:=0;
   update public.alerts set action_status='superseded'
    where field_id=NEW.id and boundary_version=OLD.boundary_version
      and action_status in ('open','acknowledged','action_taken');
   insert into public.field_boundary_versions(field_id,version,boundary_geom) values(NEW.id,NEW.boundary_version,NEW.boundary_geom);
   update public.satellite_scenes set processing_status='discovered',processing_boundary_version=null,
    processing_token=null,processing_started_at=null,processing_error=null,
    valid_coverage_percent=null,valid_pixel_count=null where field_id=NEW.id;
  end if;
  return NEW;
 end $$;
 `);
}
export async function down():Promise<void>{throw new Error('Forward-only: preserve accounts, evidence and scouting history');}
