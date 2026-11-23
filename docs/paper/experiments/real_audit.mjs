#!/usr/bin/env node
/**
 * E5-E6 (real imagery): audit of the app's own assessment rule (shared/evidence.ts + shared/advice.ts) on real
 * Sentinel-2 field series from the Zindi Telangana Crop Health Challenge (CC BY-SA 4.0), extracted by
 * scripts/telangana_ndvi_extract.py --full.
 *
 *   node --import tsx docs/paper/experiments/real_audit.mjs [--dir .local/datasets/labelled/telangana-s2-full] [--json out.json]
 *
 * Everything uses the code farmers see. The rule is replayed on every accepted image between sowing and harvest.
 * Season-level labels carry no date, so label-based numbers are season-level (a field "alerts" if it said visit=yes once).
 * Nothing here is tuned on the labels.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { assessEvidence, comparablePair, defaultPolicy } from '../../../shared/evidence.ts';
import { decideVisit } from '../../../shared/advice.ts';
import { parseCsv, wilson } from '../../../scripts/evaluate-ndvi-alerts.mjs';

const args = process.argv.slice(2), get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = get('--dir', '.local/datasets/labelled/telangana-s2-full'), jsonOut = get('--json', 'docs/paper/experiments/real_audit_results.json');
const sample = parseCsv(readFileSync(`${dir}/sample.csv`, 'utf8'));
const raw = parseCsv(readFileSync(`${dir}/ndvi.csv`, 'utf8'));
const byField = new Map();
for (const r of raw) { if (!byField.has(r.FarmID)) byField.set(r.FarmID, []); byField.get(r.FarmID).push(r); }
const DAY = 86400000, day = s => Date.parse(s + 'T00:00:00Z');
const PROBLEM = new Set(['Pests', 'Diseased', 'Stressed']);
const ratio = (k, n) => ({ k, n, value: n ? k / n : null, ci95: n ? wilson(k, n) : null });
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const bins = [['0.3-0.4', 0.3, 0.4], ['0.4-0.6', 0.4, 0.6], ['0.6-1.0', 0.6, 1.0], ['1.0-2.0', 1.0, 2.0], ['>=2.0', 2.0, 1e9]];
const binOf = ha => bins.find(([, lo, hi]) => ha >= lo && ha < hi)?.[0];

/** One primary tile per field (the app's rule), accepted images only, plus the attempt count for the size analysis. */
function fieldSeries(f) {
  const rows = byField.get(f.FarmID) ?? [];
  const tiles = new Map();
  for (const r of rows) if (r.ndvi !== '' && Number(r.valid_px) > 0) tiles.set(r.tile, (tiles.get(r.tile) ?? 0) + 1);
  const primary = [...tiles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mine = rows.filter(r => r.tile === primary);
  const footprint = Math.max(0, ...mine.map(r => Number(r.valid_px) || 0));
  const withData = mine.filter(r => r.ndvi !== '');
  const mk = r => ({
    scene_id: null, observed_on: r.date, acquired_at: r.date + 'T05:00:00Z', ndvi_value: Number(r.ndvi), cloud_cover: null,
    valid_coverage_percent: footprint ? (100 * Number(r.valid_px)) / footprint : 0, valid_pixel_count: Number(r.valid_px),
    source: 'gee', provenance: 'measured_imagery', boundary_version: 1, accepted: true, tile_id: r.tile,
  });
  const all = withData.map(mk);
  const acc = all.filter(o => o.valid_coverage_percent >= defaultPolicy.minCoverage && o.valid_pixel_count >= defaultPolicy.minPixels)
    .sort((a, b) => a.observed_on.localeCompare(b.observed_on));
  return { footprint, attempts: mine.length, withData: all.length, accepted: acc };
}
const assess = (history, o, season, series) => {
  const h = history.filter(x => x.observed_on <= o.observed_on);
  const [latest, previous] = comparablePair(h, defaultPolicy);
  const a = assessEvidence(latest, previous, defaultPolicy, Date.parse(o.observed_on + 'T23:59:59Z'), season);
  return { a, d: decideVisit({ assessment: a, latestNdvi: latest.ndvi_value }), latest, previous };
};

const fields = sample.map(f => {
  const s = fieldSeries(f);
  const L = (day(f.hdate) - day(f.sdate)) / DAY;
  return { ...f, area: Number(f.area_ha), bin: binOf(Number(f.area_ha)), L, plausible: L >= 60 && L <= 240, ...s, problem: PROBLEM.has(f.category) };
});

// ---------- A/B: replay every accepted in-season image ----------
const stateCount = {}, decisionCount = {}; let assessments = 0, thinAllClear = 0, allClear = 0, allClearTotalPairs = 0;
const perField = [];
for (const f of fields) {
  const season = { plantingDate: f.sdate, harvestDate: f.hdate };
  const inSeason = f.accepted.filter(o => o.observed_on >= f.sdate && o.observed_on <= f.hdate);
  let alerts = 0, decided = 0, last = null; const reasons = new Set();
  for (const o of inSeason) {
    const { a, d, latest, previous } = assess(f.accepted, o, season);
    assessments++; stateCount[a.state] = (stateCount[a.state] ?? 0) + 1; decisionCount[d.visit] = (decisionCount[d.visit] ?? 0) + 1;
    if (d.visit === 'yes' || d.visit === 'no') decided++;
    if (d.visit === 'yes') { alerts++; d.reasons.forEach(x => reasons.add(x)); }
    if (d.visit === 'no') { // reassurance: how thin is the evidence behind this "all clear"?
      allClear++;
      const weak = [latest, previous].some(x => x && (x.valid_coverage_percent < 85 || x.valid_pixel_count < 30));
      if (weak) thinAllClear++;
    }
    last = d.visit;
  }
  perField.push({ id: f.FarmID, label: f.category, problem: f.problem, crop: f.Crop, bin: f.bin, area: f.area, images: inSeason.length, decided, alerts, last, reasons: [...reasons] });
}
const rate = (rows, pred) => ratio(rows.filter(pred).length, rows.length);
const decidedRows = perField.filter(r => r.decided > 0);
const summarise = rows => {
  const prob = rows.filter(r => r.problem), heal = rows.filter(r => !r.problem);
  return {
    fields: rows.length, problem: prob.length, healthy: heal.length,
    alert_rate_problem: rate(prob, r => r.alerts > 0), alert_rate_healthy: rate(heal, r => r.alerts > 0),
    all_clear_all_season_problem: rate(prob, r => r.alerts === 0),                      // false reassurance, season level
    precision: ratio(prob.filter(r => r.alerts > 0).length, rows.filter(r => r.alerts > 0).length),
  };
};
const seasonLevel = {
  all: summarise(decidedRows),
  by_crop: Object.fromEntries([...new Set(fields.map(f => f.Crop))].map(c => [c, summarise(decidedRows.filter(r => r.crop === c))])),
  by_size: Object.fromEntries(bins.map(([b]) => [b, summarise(decidedRows.filter(r => r.bin === b))])),
  no_decision_fields: fields.length - decidedRows.length,
};

// ---------- C: per-pair false triggers in stable mid-season windows (healthy, plausible season length) ----------
const pairDeltas = [];
for (const f of fields.filter(x => !x.problem && x.plausible)) {
  const lo = day(f.sdate) + 0.4 * f.L * DAY, hi = day(f.sdate) + 0.8 * f.L * DAY;
  for (const o of f.accepted) {
    const t = day(o.observed_on); if (t < lo || t > hi) continue;
    const [latest, previous] = comparablePair(f.accepted.filter(x => x.observed_on <= o.observed_on), defaultPolicy);
    if (latest?.observed_on !== o.observed_on || !previous) continue;
    pairDeltas.push({ id: f.FarmID, bin: f.bin, crop: f.Crop, d: latest.ndvi_value - previous.ndvi_value, gap: (day(latest.observed_on) - day(previous.observed_on)) / DAY });
  }
}
const stable = {
  pairs: pairDeltas.length, fields: new Set(pairDeltas.map(p => p.id)).size,
  false_trigger_per_pair: ratio(pairDeltas.filter(p => p.d <= -defaultPolicy.declineThreshold).length, pairDeltas.length),
  median_abs_change: median(pairDeltas.map(p => Math.abs(p.d))),
  p90_abs_change: (() => { const s = pairDeltas.map(p => Math.abs(p.d)).sort((a, b) => a - b); return s[Math.floor(0.9 * (s.length - 1))]; })(),
  by_size: Object.fromEntries(bins.map(([b]) => { const r = pairDeltas.filter(p => p.bin === b); return [b, { pairs: r.length, false_trigger: ratio(r.filter(p => p.d <= -0.1).length, r.length), median_abs_change: median(r.map(p => Math.abs(p.d))) }]; })),
};

// ---------- D: injected stress on real healthy series ----------
// A localized stress covering a share f of the field, with an NDVI drop of 0.30 inside it, lowers the field mean by 0.30 f.
// The real change between consecutive images (noise, cloud edges, irrigation, phenology) is kept; only the stress is added.
const injection = {};
const fractions = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.8, 1.0];
for (const f of fractions) {
  let hit = 0, n = 0;
  for (const p of pairDeltas) { n++; if (p.d - 0.3 * f <= -defaultPolicy.declineThreshold) hit++; }
  injection[f] = ratio(hit, n);
}
const injectionBySize = Object.fromEntries(bins.map(([b]) => [b, Object.fromEntries([0, 0.2, 0.35, 0.6].map(f => {
  const r = pairDeltas.filter(p => p.bin === b); return [f, ratio(r.filter(p => p.d - 0.3 * f <= -0.1).length, r.length)];
}))]));

// ---------- E: field-size breakdown of the quality gate ----------
const sizeGate = Object.fromEntries(bins.map(([b]) => {
  const r = fields.filter(f => f.bin === b);
  const withData = r.reduce((s, f) => s + f.withData, 0), accepted = r.reduce((s, f) => s + f.accepted.length, 0);
  return [b, {
    fields: r.length, median_footprint_px: median(r.map(f => f.footprint)),
    images_with_any_valid_pixel: withData, accepted_by_gate: accepted, gate_acceptance: ratio(accepted, withData),
    fields_with_fewer_than_2_accepted_images: ratio(r.filter(f => f.accepted.length < 2).length, r.length),
    median_accepted_images_per_field: median(r.map(f => f.accepted.length)),
  }];
}));

// AUC of the per-field alert share (alerting assessments / assessments) for separating problem-labelled from healthy fields.
function auc(pos, neg) { // Mann-Whitney with ties = 0.5
  const all = [...pos.map(v => [v, 1]), ...neg.map(v => [v, 0])].sort((a, b) => a[0] - b[0]);
  let rank = 1, sumPos = 0; for (let i = 0; i < all.length;) { let j = i; while (j < all.length && all[j][0] === all[i][0]) j++; const avg = (rank + rank + (j - i) - 1) / 2; for (let k = i; k < j; k++) if (all[k][1]) sumPos += avg; rank += j - i; i = j; }
  return (sumPos - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
}
const score = r => r.alerts / Math.max(1, r.decided);
const posS = decidedRows.filter(r => r.problem).map(score), negS = decidedRows.filter(r => !r.problem).map(score);
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const boots = []; for (let b = 0; b < 300; b++) { const p = posS.map(() => posS[Math.floor(rnd() * posS.length)]), n = negS.map(() => negS[Math.floor(rnd() * negS.length)]); boots.push(auc(p, n)); }
boots.sort((a, b) => a - b);
const aucResult = { value: auc(posS, negS), ci95: [boots[7], boots[292]], n_problem: posS.length, n_healthy: negS.length, score: 'alerting assessments / assessments, per field' };
const out = {
  auc_alert_share: aucResult,
  data: { source: 'Zindi Telangana Crop Health Challenge (CC BY-SA 4.0), Sentinel-2 L2A via Earth Engine', fields: fields.length, labelled: { Healthy: fields.filter(f => !f.problem).length, problem: fields.filter(f => f.problem).length },
    plausible_season_length_fields: fields.filter(f => f.plausible).length, policy: defaultPolicy },
  assessments: { total: assessments, states: stateCount, decisions: decisionCount,
    all_clear: { total: allClear, resting_on_thin_evidence: ratio(thinAllClear, allClear), thin_definition: 'either image below 85% coverage or below 30 valid pixels' } },
  season_level: seasonLevel, stable_midseason_pairs: stable, injected_stress: { definition: 'field-mean drop = 0.30 * stressed share, added to the real change of each healthy mid-season pair', by_share: injection, by_size: injectionBySize },
  size_gate: sizeGate,
};
writeFileSync(jsonOut, JSON.stringify(out, null, 1));
const pct = r => (r?.value == null ? 'n/a' : `${(r.value * 100).toFixed(1)}% (${r.ci95.map(x => (x * 100).toFixed(1)).join('-')}; ${r.k}/${r.n})`);
console.log('AUC alert share', aucResult.value.toFixed(3), aucResult.ci95.map(x => x.toFixed(3)).join('-'));
console.log('fields', fields.length, 'decided', decidedRows.length, 'assessments', assessments);
console.log('states', stateCount, 'decisions', decisionCount);
console.log('ALL: alert problem', pct(seasonLevel.all.alert_rate_problem), '| alert healthy', pct(seasonLevel.all.alert_rate_healthy));
console.log('false reassurance (problem fields with no alert all season)', pct(seasonLevel.all.all_clear_all_season_problem));
console.log('all-clear on thin evidence', pct(out.assessments.all_clear.resting_on_thin_evidence));
console.log('stable mid-season pairs', stable.pairs, 'fields', stable.fields, 'false trigger/pair', pct(stable.false_trigger_per_pair), 'median |d|', stable.median_abs_change?.toFixed(3), 'p90', stable.p90_abs_change?.toFixed(3));
for (const f of fractions) console.log('inject f=' + f, pct(injection[f]));
console.log('size gate', JSON.stringify(Object.fromEntries(Object.entries(sizeGate).map(([b, v]) => [b, [v.fields, pct(v.gate_acceptance), pct(v.fields_with_fewer_than_2_accepted_images)]]))));
