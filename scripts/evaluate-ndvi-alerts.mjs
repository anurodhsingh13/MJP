#!/usr/bin/env node
/**
 * Score the app's satellite alert against real field visits.
 *
 *   node --import tsx scripts/evaluate-ndvi-alerts.mjs --visits visits.csv --ndvi ndvi.csv [--json out.json]
 *
 * It calls the app's own decision code (shared/evidence.ts assessEvidence + shared/advice.ts decideVisit)
 * as of each visit date, so the result cannot drift from what farmers are shown. No Gemini or photo is used:
 * this measures the measured-evidence alert only ("visit: yes" = alert).
 *
 * visits.csv  datasets/ground-truth/observation-template.csv columns. A row counts only if consent_status=granted,
 *             reviewed_by is filled, and condition_label is healthy (negative) or stressed/symptomatic (positive).
 *             Other labels (unknown, ...) are skipped and counted.
 * ndvi.csv    field_id,observed_on,acquired_at,ndvi_value,valid_coverage_percent,valid_pixel_count,boundary_version,
 *             tile_id,planting_date,harvest_date  (export from public.vegetation_indices where accepted and
 *             provenance='measured_imagery'; planting/harvest dates from public.fields, repeated per row).
 *
 * Visits where the app had no fresh, comparable imagery get decision "no_decision": reported separately and
 * counted as misses in the strict sensitivity, so missing coverage is never hidden.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assessEvidence, comparablePair, defaultPolicy } from '../shared/evidence.ts';
import { decideVisit } from '../shared/advice.ts';

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some(x => x !== '')) rows.push(row); }
  const [head = [], ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** Wilson 95% interval: with a few dozen visits the plain percentage is far too confident. */
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + z * z / n, centre = (p + z * z / (2 * n)) / d, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const POSITIVE = new Set(['stressed', 'symptomatic']);
const NEGATIVE = new Set(['healthy']);
const num = v => (v === '' || v === undefined ? null : Number(v));

export function evaluate(visits, ndviRows, policy = defaultPolicy) {
  const byField = new Map();
  for (const r of ndviRows) {
    const o = {
      scene_id: null, observed_on: r.observed_on.slice(0, 10), acquired_at: r.acquired_at || null,
      ndvi_value: num(r.ndvi_value), cloud_cover: null, valid_coverage_percent: num(r.valid_coverage_percent),
      valid_pixel_count: num(r.valid_pixel_count), source: 'export', provenance: 'measured_imagery',
      boundary_version: num(r.boundary_version) ?? 1, accepted: true, calculation_version: undefined, tile_id: r.tile_id || null,
      _planting: r.planting_date || null, _harvest: r.harvest_date || null,
    };
    if (!byField.has(r.field_id)) byField.set(r.field_id, []);
    byField.get(r.field_id).push(o);
  }
  const skipped = { no_consent: 0, not_reviewed: 0, label_not_usable: 0, bad_date: 0 };
  const cells = { tp: 0, fn: 0, fp: 0, tn: 0 };
  const undecided = { positive: 0, negative: 0 };
  const rows = [];
  for (const v of visits) {
    if (v.consent_status !== 'granted') { skipped.no_consent++; continue; }
    if (!v.reviewed_by) { skipped.not_reviewed++; continue; }
    const label = (v.condition_label || '').toLowerCase();
    const positive = POSITIVE.has(label);
    if (!positive && !NEGATIVE.has(label)) { skipped.label_not_usable++; continue; }
    const day = (v.observed_at || '').slice(0, 10), at = Date.parse(day + 'T23:59:59Z');
    if (!Number.isFinite(at)) { skipped.bad_date++; continue; }
    const history = (byField.get(v.field_id) ?? []).filter(o => o.observed_on <= day);
    // Use the boundary version of the newest image so older boundaries are never compared with newer ones.
    const [latest, previous] = comparablePair(history, policy);
    const season = latest ? { plantingDate: latest._planting, harvestDate: latest._harvest } : null;
    const assessment = assessEvidence(latest, previous, policy, at, season);
    const decision = decideVisit({ assessment, latestNdvi: latest ? latest.ndvi_value : null });
    const outcome = decision.visit === 'yes' ? 'alert' : decision.visit === 'no' ? 'no_alert' : 'no_decision';
    if (outcome === 'no_decision') undecided[positive ? 'positive' : 'negative']++;
    else if (positive) cells[outcome === 'alert' ? 'tp' : 'fn']++;
    else cells[outcome === 'alert' ? 'fp' : 'tn']++;
    rows.push({ field_id: v.field_id, visit: day, truth: positive ? 'problem' : 'healthy', outcome, reasons: decision.reasons.join('|'), ndvi_change: assessment.change, image_age_days: assessment.ageDays });
  }
  const { tp, fn, fp, tn } = cells;
  const ratio = (k, n) => (n ? { value: k / n, n, ci95: wilson(k, n) } : { value: null, n: 0, ci95: null });
  const problems = tp + fn + undecided.positive, healthy = fp + tn + undecided.negative;
  return {
    cells, undecided, skipped, visitsScored: rows.length,
    sensitivity_decided: ratio(tp, tp + fn),                 // of problem visits the app judged, how many it flagged
    sensitivity_strict: ratio(tp, problems),                 // no_decision counted as a miss
    specificity_decided: ratio(tn, tn + fp),                 // of healthy visits the app judged, how many it left alone
    precision: ratio(tp, tp + fp),                           // of alerts, how many were real problems
    coverage: ratio(rows.length - undecided.positive - undecided.negative, rows.length),
    healthy_visits: healthy, problem_visits: problems, rows,
  };
}

const pct = r => (r.value === null ? 'n/a' : `${(r.value * 100).toFixed(0)}% (${r.ci95.map(x => (x * 100).toFixed(0)).join('-')}%, n=${r.n})`);

function main() {
  const args = process.argv.slice(2), get = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const visitsFile = get('--visits'), ndviFile = get('--ndvi'), jsonOut = get('--json');
  if (!visitsFile || !ndviFile) { console.error('Usage: node --import tsx scripts/evaluate-ndvi-alerts.mjs --visits visits.csv --ndvi ndvi.csv [--json out.json]'); process.exit(2); }
  const result = evaluate(parseCsv(readFileSync(visitsFile, 'utf8')), parseCsv(readFileSync(ndviFile, 'utf8')));
  console.log(`Visits scored: ${result.visitsScored} (${result.problem_visits} problem, ${result.healthy_visits} healthy). Skipped: ${JSON.stringify(result.skipped)}`);
  console.log(`Alert caught real problems (sensitivity, judged visits): ${pct(result.sensitivity_decided)}`);
  console.log(`Same, counting no-imagery visits as misses:           ${pct(result.sensitivity_strict)}`);
  console.log(`Healthy fields left alone (specificity):               ${pct(result.specificity_decided)}`);
  console.log(`Alerts that were real problems (precision):            ${pct(result.precision)}`);
  console.log(`Visits where the app had usable imagery:               ${pct(result.coverage)}`);
  console.log(`Confusion: TP ${result.cells.tp}  FN ${result.cells.fn}  FP ${result.cells.fp}  TN ${result.cells.tn}  no-decision ${result.undecided.positive + result.undecided.negative}`);
  if (result.visitsScored < 30) console.log('Warning: fewer than 30 scored visits; the intervals above are very wide.');
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 2));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
