import { pool } from '../db/pool.ts';

const DAY = 86400000;
/** NASA POWER daily meteorology is published 2-3 days late, so a field is only "stale" once a newer day can exist. */
export const PUBLISH_LAG_DAYS = 3;
const FIRST_FETCH_DAYS = 60;
const MAX_CATCH_UP_DAYS = 90;
const compact = (time: number) => new Date(time).toISOString().slice(0, 10).replaceAll('-', '');

/**
 * Date range for a weather job: from two days before the newest stored day (so a late correction is picked up) to the
 * latest published day. A field with no weather yet gets the last 60 days; a long gap is caught up to at most 90 days.
 */
export function weatherWindow(latestStored: string | Date | null, now = Date.now()) {
  const latest = latestStored ? new Date(latestStored).getTime() : NaN;
  const end = now - PUBLISH_LAG_DAYS * DAY;
  const start = Number.isFinite(latest) ? Math.max(latest - 2 * DAY, now - MAX_CATCH_UP_DAYS * DAY) : now - (FIRST_FETCH_DAYS + PUBLISH_LAG_DAYS) * DAY;
  return { start: compact(Math.min(start, end)), end: compact(end) };
}

/**
 * Queues a weather job for every field whose weather is behind, unless one is already queued or ran in the last 6 hours
 * (so a provider outage is retried by the job's own back-off, not every tick). Returns how many jobs were queued.
 */
export async function queueStaleWeather(): Promise<number> {
  const result = await pool.query(`insert into ingestion_jobs(field_id,owner_id,boundary_version,kind)
    select f.id, f.owner_id, f.boundary_version, 'weather' from public.fields f
    where f.location is not null and f.provenance not in ('demo','public_boundary')
      and coalesce((select max(w.observed_on) from public.weather_observations w where w.field_id=f.id), '-infinity'::date) < current_date - $1::int
      and not exists (select 1 from ingestion_jobs j where j.field_id=f.id and j.kind='weather' and j.created_at > now() - interval '6 hours')
    on conflict (field_id,kind) where status in ('queued','running') do nothing
    returning id`, [PUBLISH_LAG_DAYS]);
  return result.rowCount ?? 0;
}

/** Checks shortly after start and then every 6 hours. Set WEATHER_AUTO_REFRESH=off to disable. */
export function startWeatherSchedule() {
  if ((process.env.WEATHER_AUTO_REFRESH || 'on').trim().toLowerCase() === 'off') return async () => {};
  const tick = () => { void queueStaleWeather().then(queued => { if (queued) console.log(`Weather refresh queued for ${queued} field(s)`); }).catch(() => console.error('Weather refresh scheduling failed')); };
  const first = setTimeout(tick, 30000);
  const timer = setInterval(tick, 6 * 3600000);
  first.unref(); timer.unref();
  return async () => { clearTimeout(first); clearInterval(timer); };
}
