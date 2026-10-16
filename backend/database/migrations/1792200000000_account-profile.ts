import type {MigrationBuilder} from 'node-pg-migrate';
export async function up(pgm:MigrationBuilder):Promise<void>{
 pgm.sql(`alter table public.app_users add column profile jsonb not null default '{}'::jsonb check(jsonb_typeof(profile)='object');`);
}
export async function down(pgm:MigrationBuilder):Promise<void>{pgm.dropColumns('app_users',['profile']);}
