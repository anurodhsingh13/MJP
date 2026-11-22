#!/usr/bin/env node
/**
 * Score the app's NDVI alert (shared/evidence.ts assessEvidence + shared/advice.ts decideVisit, the code farmers see)
 * against the Telangana Crop Health Challenge labels, using Sentinel-2 NDVI from scripts/telangana_ndvi_extract.py.
 *
 *   node --import tsx scripts/evaluate-telangana-alerts.mjs [--dir .local/datasets/labelled/telangana-ndvi] [--json out.json]
 *
 * The labels are one per field per season with no date, so the test is season-level: the app is replayed on every
 * accepted image between sowing and harvest, and a field counts as "alerted" if it said "visit: yes" at least once.
 * Healthy fields alerted = false alarms. A field with no comparable image pair all season is "no_decision" and is
 * counted as a miss in the strict sensitivity, so missing imagery is never hidden.
 * Photo/Gemini are not involved. Labels: Pests, Diseased, Stressed are positive; Healthy is negative.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { assessEvidence, comparablePair, defaultPolicy } from '../shared/evidence.ts';
import { decideVisit } from '../shared/advice.ts';
import { parseCsv, wilson } from './evaluate-ndvi-alerts.mjs';

const args = process.argv.slice(2), get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = get('--dir', '.local/datasets/labelled/telangana-ndvi'), jsonOut = get('--json', null);
const sample = parseCsv(readFileSync(`${dir}/sample.csv`, 'utf8'));
const raw = parseCsv(readFileSync(`${dir}/ndvi.csv`, 'utf8'));

const byField = new Map();
for (const r of raw) { if (!byField.has(r.FarmID)) byField.set(r.FarmID, []); byField.get(r.FarmID).push(r); }

const day = s => Date.parse(s + 'T00:00:00Z');
const results = [];
for (const f of sample) {
  const rows = byField.get(f.FarmID) ?? [];
  // one primary tile per field (same rule as the app): the tile with the most clear images
  const tiles = new Map();
  for (const r of rows) if (r.ndvi !== '' && Number(r.valid_px) > 0) tiles.set(r.tile, (tiles.get(r.tile) ?? 0) + 1);
  const primary = [...tiles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mine = rows.filter(r => r.tile === primary);
  const totalPx = Math.max(0, ...mine.map(r => Number(r.valid_px) || 0)); // best clear count = field footprint
  const obs = mine.filter(r => r.ndvi !== '').map(r => ({
    scene_id: null, observed_on: r.date, acquired_at: r.date + 'T05:00:00Z', ndvi_value: Number(r.ndvi), cloud_cover: null,
    valid_coverage_percent: totalPx ? (100 * Number(r.valid_px)) / totalPx : 0, valid_pixel_count: Number(r.valid_px),
    source: 'gee', provenance: 'measured_imagery', boundary_version: 1, accepted: true, tile_id: r.tile,
  })).filter(o => o.valid_coverage_percent >= defaultPolicy.minCoverage && o.valid_pixel_count >= defaultPolicy.minPixels)
    .sort((a, b) => a.observed_on.localeCompare(b.observed_on));
  const season = { plantingDate: f.sdate, harvestDate: f.hdate };
  const inSeason = obs.filter(o => o.observed_on >= f.sdate && o.observed_on <= f.hdate);
  let alerts = 0, decided = 0, firstAlert = null; const why = new Set();
  for (const o of inSeason) {
    const history = obs.filter(x => x.observed_on <= o.observed_on);
    const [latest, previous] = comparablePair(history, defaultPolicy);
    const a = assessEvidence(latest, previous, defaultPolicy, Date.parse(o.observed_on + 'T23:59:59Z'), season);
    const d = decideVisit({ assessment: a, latestNdvi: latest.ndvi_value });
    if (d.visit === 'yes' || d.visit === 'no') decided++; // 'if_concerned' = imagery not enough to say
    if (d.visit === 'yes') { alerts++; firstAlert ??= o.observed_on; d.reasons.forEach(x => why.add(x)); }
  }
  results.push({ id: f.FarmID, label: f.category, crop: f.Crop, season: f.Season, area_ha: Number(f.area_ha), images: inSeason.length, decided, alerts, firstAlert, why: [...why].sort().join('+'),
    outcome: !decided ? 'no_decision' : alerts ? 'alert' : 'no_alert' });
}

const ratio = (k, n) => ({ k, n, value: n ? k / n : null, ci95: wilson(k, n) });
const pct = r => (r.value === null ? 'n/a' : `${(r.value * 100).toFixed(0)}% (${r.ci95.map(x => (x * 100).toFixed(0)).join('-')}%, ${r.k}/${r.n})`);
function summarise(rows) {
  const pos = rows.filter(r => r.label !== 'Healthy'), neg = rows.filter(r => r.label === 'Healthy');
  const tp = pos.filter(r => r.outcome === 'alert').length, fn = pos.filter(r => r.outcome === 'no_alert').length, nd = pos.filter(r => r.outcome === 'no_decision').length;
  const fp = neg.filter(r => r.outcome === 'alert').length, tn = neg.filter(r => r.outcome === 'no_alert').length, ndn = neg.filter(r => r.outcome === 'no_decision').length;
  return { n: rows.length, problems: pos.length, healthy: neg.length, tp, fn, fp, tn, no_decision: { problem: nd, healthy: ndn },
    sensitivity_judged: ratio(tp, tp + fn), sensitivity_strict: ratio(tp, pos.length), false_alarm_rate: ratio(fp, fp + tn),
    precision: ratio(tp, tp + fp), coverage: ratio(rows.length - nd - ndn, rows.length) };
}
const out = { all: summarise(results), by_label: {}, by_crop: {} };
for (const l of ['Pests', 'Diseased', 'Stressed']) out.by_label[l] = ratio(results.filter(r => r.label === l && r.outcome === 'alert').length, results.filter(r => r.label === l && r.outcome !== 'no_decision').length);
for (const c of [...new Set(results.map(r => r.crop))]) out.by_crop[c] = summarise(results.filter(r => r.crop === c));
out.median_images_in_season = results.map(r => r.images).sort((a, b) => a - b)[Math.floor(results.length / 2)];
out.fields_with_zero_images = results.filter(r => r.images === 0).length;

out.reasons = {};
for (const r of results) { const k = r.label === 'Healthy' ? 'Healthy' : 'Problem'; (out.reasons[r.why || '(none)'] ??= { Healthy: 0, Problem: 0 })[k]++; }
const s = out.all;
console.log(`Fields scored: ${s.n} (${s.problems} problem, ${s.healthy} healthy). Median usable images per season: ${out.median_images_in_season}; fields with none: ${out.fields_with_zero_images}`);
console.log(`Problem fields the alert flagged (sensitivity, judged):  ${pct(s.sensitivity_judged)}`);
console.log(`Same, no-imagery fields counted as misses:               ${pct(s.sensitivity_strict)}`);
console.log(`Healthy fields falsely alerted (false-alarm rate):       ${pct(s.false_alarm_rate)}`);
console.log(`Alerted fields that really had a problem (precision):    ${pct(s.precision)}`);
console.log(`Fields with a usable decision:                           ${pct(s.coverage)}`);
console.log(`Confusion: TP ${s.tp} FN ${s.fn} FP ${s.fp} TN ${s.tn} no-decision ${s.no_decision.problem + s.no_decision.healthy}`);
for (const [l, r] of Object.entries(out.by_label)) console.log(`  ${l}: alerted ${pct(r)}`);
for (const [c, r] of Object.entries(out.by_crop)) console.log(`  ${c}: sens ${pct(r.sensitivity_judged)} | false alarm ${pct(r.false_alarm_rate)} | n=${r.n}`);
console.log('Reasons that fired (per field):'); for (const [k, v] of Object.entries(out.reasons)) console.log(`  ${k}: healthy ${v.Healthy}, problem ${v.Problem}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ summary: out, rows: results }, null, 2));
