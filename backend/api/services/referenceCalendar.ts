import { validReferenceWindow, type ReferenceWindow } from '../../../shared/evidence.ts';

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/**
 * Regional sowing/harvest windows from the reviewed reference table, keyed by field id. Used only to place an image in the
 * crop season when the field's own saved dates cannot. A row counts only when its crop matches the field's crop, and the
 * reference is optional: any failure (table not imported, database error) just means "no reference".
 */
export async function referenceWindowsByField(db: Queryable, fields: { id: string; crop: unknown }[]): Promise<Map<string, ReferenceWindow>> {
  const windows = new Map<string, ReferenceWindow>();
  const ids = [...new Set(fields.map(field => field.id).filter(Boolean))];
  if (!ids.length) return windows;
  try {
    const exists = await db.query("select to_regclass('public.fao_crop_calendar_references') as table_name");
    if (!exists.rows[0]?.table_name) return windows;
    const { rows } = await db.query(
      `select field_id::text as field_id, crop, planting_start_month, planting_end_month, harvest_start_month, harvest_end_month
         from public.fao_crop_calendar_references where field_id = any($1::uuid[])
        order by reviewed_on desc nulls last, imported_at desc`, [ids]);
    const cropOf = new Map(fields.map(field => [field.id, String(field.crop ?? '').trim().toLowerCase()]));
    for (const row of rows) {
      const id = String(row.field_id);
      if (windows.has(id) || !cropOf.get(id) || cropOf.get(id) !== String(row.crop ?? '').trim().toLowerCase()) continue;
      const window = {
        plantingStartMonth: Number(row.planting_start_month), plantingEndMonth: Number(row.planting_end_month),
        harvestStartMonth: Number(row.harvest_start_month), harvestEndMonth: Number(row.harvest_end_month),
      };
      if (validReferenceWindow(window)) windows.set(id, window);
    }
  } catch {
    // Optional context: fall back to the field's own dates.
  }
  return windows;
}
