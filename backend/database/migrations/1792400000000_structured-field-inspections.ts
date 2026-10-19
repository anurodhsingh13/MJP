import type {MigrationBuilder} from 'node-pg-migrate';

export async function up(pgm:MigrationBuilder):Promise<void>{
 pgm.sql(`
  alter table public.scouting_cases
   add column observation_category text not null default 'unknown'
    check(observation_category in ('general_observation','visual_symptom','pest_observed','water_related','growth_stage','other','unknown')),
   add column growth_stage text not null default 'unknown'
    check(growth_stage in ('emergence','vegetative','flowering','fruiting','maturity','harvested','unknown')),
   add column severity text not null default 'not_applicable'
    check(severity in ('mild','moderate','severe','unknown','not_applicable')),
   add column provenance text not null default 'owner_reported'
    check(provenance='owner_reported'),
   add column verification_status text not null default 'unverified'
    check(verification_status in ('unverified','expert_verified')),
   add column reported_by uuid references public.app_users(id) on delete set null,
   add column reviewed_by uuid references public.app_users(id) on delete set null,
   add column reviewed_at timestamptz;
  alter table public.scouting_cases add constraint scouting_review_metadata_consistent
   check((verification_status='unverified' and reviewed_by is null and reviewed_at is null)
      or (verification_status='expert_verified' and reviewed_by is not null and reviewed_at is not null));
  create index scouting_cases_field_stage_date on public.scouting_cases(field_id, growth_stage, observed_on desc);
 `);
}

export async function down(pgm:MigrationBuilder):Promise<void>{
 pgm.sql(`
  drop index if exists public.scouting_cases_field_stage_date;
  alter table public.scouting_cases
   drop column reviewed_at, drop column reviewed_by, drop column reported_by,
   drop column verification_status, drop column provenance, drop column severity,
   drop column growth_stage, drop column observation_category;
 `);
}
