import { defaultPolicy, type BaselinePoint } from '../../../shared/evidence.ts';

interface Queryable { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }

/**
 * Earlier-season readings per field (current boundary only, usable coverage only), for the seasonal baseline.
 * The baseline is optional context: a missing table or a database error means "no baseline", never a failure.
 */
export async function baselinePointsByField(db: Queryable, fieldIds: string[]): Promise<Map<string, BaselinePoint[]>> {
  const result = new Map<string, BaselinePoint[]>();
  if (!fieldIds.length) return result;
  try {
    const table = (await db.query("select to_regclass('public.field_ndvi_baseline') as table_name")).rows[0]?.table_name;
    if (!table) return result;
    const rows = (await db.query(
      `select b.field_id::text as field_id, b.observed_on::text as observed_on, b.ndvi_value
       from public.field_ndvi_baseline b join public.fields f on f.id = b.field_id and f.boundary_version = b.boundary_version
       where b.field_id = any($1::uuid[]) and b.valid_coverage_percent >= $2 and b.valid_pixel_count >= $3
       order by b.field_id, b.observed_on`, [fieldIds, defaultPolicy.minCoverage, defaultPolicy.minPixels])).rows;
    for (const row of rows) {
      const id = String(row.field_id);
      result.set(id, [...(result.get(id) ?? []), { observed_on: String(row.observed_on), ndvi_value: row.ndvi_value as number | string | null }]);
    }
  } catch {
    return new Map();
  }
  return result;
}
