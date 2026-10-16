import type { MigrationBuilder } from 'node-pg-migrate';
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`alter table public.field_tasks
    add column client_key uuid,
    add column reason text,
    add column scene_id text,
    add column boundary_version integer;
    create unique index field_tasks_client_key on public.field_tasks(field_id,client_key) where client_key is not null;`);
}
export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('drop index public.field_tasks_client_key; alter table public.field_tasks drop column client_key, drop column reason, drop column scene_id, drop column boundary_version;');
}
