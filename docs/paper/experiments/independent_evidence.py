"""E7: independent evidence that does not use the survey health labels.

(a) Harvest dates: the Telangana records give a sowing and a harvest date per field. If a recorded harvest date is real,
    field NDVI should fall around it. We test whether the app's decline rule (NDVI change <= -0.10 between comparable
    images) fires around the recorded harvest date more often than around placeholder dates earlier in the same season.
(b) Rainfall: NASA POWER district rainfall (PRECTOTCORR). In a rainfed field a dry spell should depress NDVI; in an
    irrigated field it should not. We test the decline rule and the rank correlation of NDVI change with rainfall,
    separately for rainfed and irrigated fields.

Thresholds are fixed in this file before the outcomes were computed. Only numpy/scipy/stdlib.

  .venv/Scripts/python.exe docs/paper/experiments/independent_evidence.py
"""
import csv, json, random, glob, os
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
import numpy as np
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[3]
D = ROOT / '.local/datasets/labelled/telangana-s2-full'
TRAIN = ROOT / '.local/datasets/labelled/zindi-telangana-crop-health/files/Train.csv'
WX = ROOT / '.local/datasets/labelled/telangana-weather'
OUT = ROOT / 'docs/paper/experiments/independent_evidence_results.json'
MIN_COV, MIN_PX, DROP, COMPARE_DAYS = 70.0, 10, 0.10, 30
rng = random.Random(11)
d0 = lambda s: date.fromisoformat(s[:10])

meta = {}
with open(TRAIN, newline='', encoding='utf-8') as fh:
    for r in csv.DictReader(fh):
        meta[int(r['FarmID'])] = dict(district=r['District'], irri=r['IrriSource'], crop=r['Crop'], season=r['Season'])
sample = {int(r['FarmID']): r for r in csv.DictReader(open(D / 'sample.csv', encoding='utf-8'))}
raw = defaultdict(list)
with open(D / 'ndvi.csv', newline='', encoding='utf-8') as fh:
    for r in csv.DictReader(fh):
        raw[int(r['FarmID'])].append(r)

def accepted_series(fid):
    """Same gate and primary-tile rule as the app: coverage >= 70 %, >= 10 valid pixels, one tile per field."""
    rows = raw.get(fid, [])
    tiles = defaultdict(int)
    for r in rows:
        if r['ndvi'] != '' and int(r['valid_px']) > 0:
            tiles[r['tile']] += 1
    if not tiles:
        return []
    primary = max(tiles, key=tiles.get)
    mine = [r for r in rows if r['tile'] == primary]
    foot = max([int(r['valid_px']) for r in mine] + [0])
    out = []
    for r in mine:
        if r['ndvi'] == '':
            continue
        px = int(r['valid_px']); cov = 100 * px / foot if foot else 0
        if cov >= MIN_COV and px >= MIN_PX:
            out.append((d0(r['date']), float(r['ndvi'])))
    return sorted(out)

series = {fid: accepted_series(fid) for fid in sample}

# ------------------------------------------------------------------ (a) harvest dates
# The extraction stops 2 days after the recorded harvest date, so there are no post-harvest images: we cannot compare
# before/after harvest. What we can test is whether NDVI and the decline rule behave as a canopy that is being harvested
# would: a season-peak well before harvest, a fall toward the recorded date, and decline events that concentrate in the
# last weeks before it.
def wilson(k, n, z=1.96):
    if n == 0: return [None, None]
    p = k / n; den = 1 + z * z / n; c = p + z * z / (2 * n); h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [round((c - h) / den, 4), round((c + h) / den, 4)]

PAIR_BINS = [(-400, -100), (-100, -60), (-60, -30), (-30, 3)]        # days from the recorded harvest date to the later image of a pair
comp_bins = list(range(-120, 21, 10))
comp = defaultdict(list); peak_off = []; pair_stat = {b: [0, 0] for b in PAIR_BINS}; n_plaus = 0; n_series = 0
per_crop_pairs = defaultdict(lambda: {b: [0, 0] for b in PAIR_BINS})
for fid, r in sample.items():
    s = series[fid]; sd, hd = d0(r['sdate']), d0(r['hdate']); L = (hd - sd).days
    if not (60 <= L <= 240) or len(s) < 4:
        continue
    n_plaus += 1
    win = [(d, v) for d, v in s if sd <= d <= hd + timedelta(days=3)]
    if len(win) >= 5:
        n_series += 1
        pd_, pv = max(win, key=lambda x: x[1]); peak_off.append((pd_ - hd).days)
        for d, v in win:
            k = (d - hd).days
            for b0 in comp_bins:
                if b0 <= k < b0 + 10: comp[b0].append(v / pv if pv > 0 else np.nan)
    for (da, va), (db, vb) in zip(s, s[1:]):
        if not (0 < (db - da).days <= COMPARE_DAYS) or db < sd: continue
        k = (db - hd).days
        for b in PAIR_BINS:
            if b[0] <= k < b[1]:
                hit = vb - va <= -DROP
                pair_stat[b][0] += hit; pair_stat[b][1] += 1
                per_crop_pairs[meta[fid]['crop']][b][0] += hit; per_crop_pairs[meta[fid]['crop']][b][1] += 1
peak_off = np.array(peak_off)
res_a = dict(
    fields_with_plausible_season_length_60_240_days=n_plaus, fields_with_5plus_images_in_season=n_series,
    ndvi_peak_offset_from_recorded_harvest_days=dict(median=float(np.median(peak_off)), q25=float(np.percentile(peak_off, 25)), q75=float(np.percentile(peak_off, 75)),
                                                     share_with_peak_after_harvest=round(float((peak_off > 0).mean()), 3)),
    composite_ndvi_over_season_peak=[dict(days_to_harvest_from=b0, days_to_harvest_to=b0 + 10, n=len(comp[b0]), median=round(float(np.nanmedian(comp[b0])), 3),
                                          q25=round(float(np.nanpercentile(comp[b0], 25)), 3), q75=round(float(np.nanpercentile(comp[b0], 75)), 3)) for b0 in comp_bins if comp[b0]],
    decline_rule_rate_by_days_before_harvest={f'{b[0]}..{b[1]}': dict(k=int(v[0]), n=int(v[1]), value=round(v[0] / v[1], 3) if v[1] else None, ci95=wilson(int(v[0]), int(v[1]))) for b, v in pair_stat.items()},
    decline_rule_rate_by_crop={c: {f'{b[0]}..{b[1]}': (round(v[0] / v[1], 3) if v[1] >= 30 else None) for b, v in st.items()} for c, st in sorted(per_crop_pairs.items())},
    limitation='No images after the recorded harvest date exist in the extract, so a before/after harvest comparison is not possible.',
)

# ------------------------------------------------------------------ (b) rainfall
rain = {}
for f in glob.glob(str(WX / '*.json')):
    j = json.load(open(f)); rain[os.path.basename(f)[:-5]] = {k: v for k, v in j['p']['PRECTOTCORR'].items() if v is not None and v > -900}

def rain_sum(district, a, b):
    """Total rainfall in the days after `a` up to and including `b`; None if any day is missing."""
    tot = 0.0; d = a + timedelta(days=1)
    w = rain.get(district, {})
    while d <= b:
        v = w.get(d.strftime('%Y%m%d'))
        if v is None: return None
        tot += v; d += timedelta(days=1)
    return tot

rows = []
for fid, r in sample.items():
    m = meta[fid]; s = series[fid]; sd, hd = d0(r['sdate']), d0(r['hdate']); L = (hd - sd).days
    if not (60 <= L <= 240):
        continue
    for (da, va), (db, vb) in zip(s, s[1:]):
        gap = (db - da).days
        if not (5 <= gap <= COMPARE_DAYS): continue
        if not (sd + timedelta(days=int(0.15 * L)) <= db <= sd + timedelta(days=int(0.85 * L))): continue   # growing stage only
        tot = rain_sum(m['district'], da, db)
        if tot is None: continue
        rows.append(dict(fid=fid, season=m['season'], rainfed=(m['irri'] == 'Rainfed'), d=vb - va, rpd=tot / gap, gap=gap))

def block(sel):
    if len(sel) < 40:
        return dict(pairs=len(sel))
    d = np.array([x['d'] for x in sel]); rp = np.array([x['rpd'] for x in sel])
    lo, hi = np.quantile(rp, [1 / 3, 2 / 3])           # terciles of rainfall per day, fixed rule
    dry, wet = d[rp <= lo], d[rp >= hi]
    rho = spearmanr(rp, d).statistic
    # cluster bootstrap over fields for the rank correlation and the dry-wet difference in decline-rule rate
    by = defaultdict(list)
    for x in sel: by[x['fid']].append(x)
    ids = list(by); boots_rho, boots_diff = [], []
    for _ in range(300):
        pick = [x for i in (rng.choice(ids) for _ in ids) for x in by[i]]
        dd = np.array([x['d'] for x in pick]); rr = np.array([x['rpd'] for x in pick])
        if len(dd) < 40: continue
        boots_rho.append(spearmanr(rr, dd).statistic)
        l2, h2 = np.quantile(rr, [1 / 3, 2 / 3]); a = dd[rr <= l2]; b = dd[rr >= h2]
        if len(a) and len(b): boots_diff.append(float((a <= -DROP).mean() - (b <= -DROP).mean()))
    ci = lambda v: [round(float(np.quantile(v, .025)), 3), round(float(np.quantile(v, .975)), 3)] if v else None
    return dict(pairs=len(sel), fields=len(by), dry_tercile_max_mm_per_day=round(float(lo), 2), wet_tercile_min_mm_per_day=round(float(hi), 2),
                decline_rate_dry=round(float((dry <= -DROP).mean()), 3), decline_rate_wet=round(float((wet <= -DROP).mean()), 3),
                dry_minus_wet=round(float((dry <= -DROP).mean() - (wet <= -DROP).mean()), 3), dry_minus_wet_ci95=ci(boots_diff),
                spearman_rain_vs_ndvi_change=round(float(rho), 3), spearman_ci95=ci(boots_rho),
                median_change_dry=round(float(np.median(dry)), 4), median_change_wet=round(float(np.median(wet)), 4))

res_b = {}
for season in ('Kharif', 'Rabi'):
    for label, flag in (('rainfed', True), ('irrigated', False)):
        res_b[f'{season}_{label}'] = block([x for x in rows if x['season'] == season and x['rainfed'] == flag])

out = dict(thresholds=dict(min_coverage=MIN_COV, min_pixels=MIN_PX, decline=DROP, compare_days=COMPARE_DAYS), harvest_dates=res_a, rainfall=res_b,
           note='Labels (Healthy/Pests/Diseased/Stressed) are not used anywhere in this script.')
OUT.write_text(json.dumps(out, indent=1))
print(json.dumps(out, indent=1))
