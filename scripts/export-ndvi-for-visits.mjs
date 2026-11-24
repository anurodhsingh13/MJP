#!/usr/bin/env node
/**
 * Export the satellite history that scripts/evaluate-ndvi-alerts.mjs needs, read-only.
 *
 *   node scripts/export-ndvi-for-visits.mjs [--out .local/datasets/ground-truth/ndvi.csv]
 *
 * Runs the query documented in datasets/ground-truth/README.md (accepted, measured-imagery observations plus each field's crop dates)
 * against DATABASE_URL and writes a CSV. It only reads; it never changes the database. The output stays under the git-ignored .local/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { loadEnvironment } from './environment.mjs';

loadEnvironment();
const args = process.argv.slice(2);
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : '.local/datasets/ground-truth/ndvi.csv');
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required (set it in .env.local).'); process.exit(2); }

const columns = ['field_id', 'observed_on', 'acquired_at', 'ndvi_value', 'valid_coverage_percent', 'valid_pixel_count', 'boundary_version', 'tile_id', 'planting_date', 'harvest_date'];
const iso = value => (value instanceof Date ? value.toISOString() : value);
const day = value => (value instanceof Date ? value.toISOString().slice(0, 10) : value);
const cell = value => { const s = value == null ? '' : String(value); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query(`select v.field_id, v.observed_on, v.acquired_at, v.ndvi_value, v.valid_coverage_percent, v.valid_pixel_count, v.boundary_version, v.tile_id,
      f.planting_date, f.harvest_date
    from public.vegetation_indices v join public.fields f on f.id = v.field_id
    where v.accepted and v.provenance = 'measured_imagery' order by v.field_id, v.observed_on`);
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map(c => cell(c === 'acquired_at' ? iso(r[c]) : ['observed_on', 'planting_date', 'harvest_date'].includes(c) ? day(r[c]) : r[c])).join(','));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`Wrote ${rows.length} observations for ${new Set(rows.map(r => r.field_id)).size} fields to ${out}`);
} finally {
  await client.end();
}
