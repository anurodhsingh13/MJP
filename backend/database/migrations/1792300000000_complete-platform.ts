import type {MigrationBuilder} from 'node-pg-migrate';
export async function up(pgm:MigrationBuilder):Promise<void>{pgm.sql(`
 create table public.field_forecasts(field_id uuid primary key references fields(id) on delete cascade,latitude double precision not null,longitude double precision not null,retrieved_at timestamptz not null,expires_at timestamptz not null,payload jsonb not null);
 create table public.account_notifications(id uuid primary key default gen_random_uuid(),owner_id uuid not null references app_users(id) on delete cascade,field_id uuid references fields(id) on delete set null,event_key text not null,kind text not null,title_en text not null,title_hi text not null,field_name text not null,href text not null,read_at timestamptz,created_at timestamptz not null default now(),unique(owner_id,event_key));
 create index account_notifications_recent on account_notifications(owner_id,created_at desc);
 create table public.notification_preferences(owner_id uuid primary key references app_users(id) on delete cascade,preferences jsonb not null default '{"visits":true,"imagery":true,"processing":true,"weather":true,"browser":false}'::jsonb);
 create table public.assistant_messages(id uuid primary key default gen_random_uuid(),position bigserial not null,owner_id uuid not null references app_users(id) on delete cascade,field_id uuid references fields(id) on delete cascade,role text not null check(role in ('user','assistant')),content text not null check(length(content)<=8000),created_at timestamptz not null default now());
 create index assistant_messages_owner on assistant_messages(owner_id,created_at desc);
 `);}
export async function down(pgm:MigrationBuilder):Promise<void>{pgm.dropTable('assistant_messages');pgm.dropTable('notification_preferences');pgm.dropTable('account_notifications');pgm.dropTable('field_forecasts');}
