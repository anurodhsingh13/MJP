import type { Request, Response } from 'express';
import { pool } from '../db/pool.ts';

export async function createTask(request: Request, response: Response) {
  const { client_key, title, reason, due_on, scene_id } = request.body ?? {};
  if (typeof client_key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client_key)
    || typeof title !== 'string' || !title.trim() || title.length > 200
    || typeof reason !== 'string' || reason.length > 2000
    || typeof due_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due_on)
    || !Number.isFinite(Date.parse(due_on)) || new Date(due_on).toISOString().slice(0, 10) !== due_on
    || (scene_id != null && (typeof scene_id !== 'string' || scene_id.length > 200))) {
    response.status(400).json({ error: 'Choose a visit date, a title under 200 characters and a reason under 2,000 characters.' }); return;
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    const existing = await client.query('select * from field_tasks where field_id=$1 and client_key=$2', [request.params.fieldId, client_key]);
    if (existing.rowCount) { await client.query('commit'); response.status(201).json(existing.rows[0]); return; }
    const field = (await client.query<{ boundary_version: number }>('select boundary_version from fields where id=$1 for share', [request.params.fieldId])).rows[0];
    if (!field) { await client.query('rollback'); response.status(404).json({ error: 'Field not found' }); return; }
    if (scene_id && !(await client.query(`select 1 from vegetation_indices where field_id=$1 and scene_id=$2 and boundary_version=$3 and accepted and provenance='measured_imagery'`, [request.params.fieldId, scene_id, field.boundary_version])).rowCount) {
      await client.query('rollback'); response.status(409).json({ error: 'This image no longer belongs to the current field boundary. Refresh before planning the visit.' }); return;
    }
    const result = await client.query(`insert into field_tasks(field_id,client_key,title,reason,due_on,scene_id,boundary_version)
      values($1,$2,$3,$4,$5,$6,$7)
      on conflict(field_id,client_key) where client_key is not null do update set client_key=excluded.client_key returning *`,
    [request.params.fieldId, client_key, title.trim(), reason.trim(), due_on, scene_id ?? null, field.boundary_version]);
    await client.query('commit'); response.status(201).json(result.rows[0]);
  } catch {
    await client.query('rollback'); console.error('Save field visit');
    response.status(503).json({ error: 'Your visit could not be saved. Keep the form open and retry.' });
  } finally { client.release(); }
}
