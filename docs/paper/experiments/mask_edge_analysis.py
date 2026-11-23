"""Analyse the Earth Engine extract from gee_mask_edge_validation.py (cloud-mask validation and edge-pixel effects).

  .venv/Scripts/python.exe docs/paper/experiments/mask_edge_analysis.py

Output: docs/paper/experiments/mask_edge_results.json (all numbers quoted in the paper).
Decision rule replayed here is the app's: image accepted if >= 70 % of the field is clear and >= 10 pixels; two images are
compared if <= 30 days apart; decline = NDVI change <= -0.10. Cloud Score+ is used only as an independent reference.
"""
import csv, json
from collections import defaultdict
from datetime import date
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / '.local/datasets/labelled/telangana-mask-validation/images.csv'
OUT = ROOT / 'docs/paper/experiments/mask_edge_results.json'
MIN_COV, MIN_PX, DROP, COMPARE = 0.70, 10, 0.10, 30
BINS = [('0.3-0.4', .3, .4), ('0.4-0.6', .4, .6), ('0.6-1.0', .6, 1.), ('1.0-2.0', 1., 2.), ('>=2.0', 2., 1e9)]
binof = lambda a: next(b for b, lo, hi in BINS if lo <= a < hi)
fl = lambda x: float(x) if x not in ('', None) else np.nan

rows = []
with open(SRC, newline='', encoding='utf-8') as fh:
    for r in csv.DictReader(fh):
        d = dict(fid=int(r['FarmID']), area=float(r['area_ha']), bin=binof(float(r['area_ha'])), crop=r['crop'], label=r['label'], date=date.fromisoformat(r['date']), tile=r['tile'])
        for k in ('n_all', 'n_all_inner', 'f_scl', 'f_cs', 'f_both', 'cs_mean', 'f_cs50', 'f_cs65', 'ndvi_scl', 'n_scl', 'ndvi_both', 'n_both', 'ndvi_inner', 'n_inner', 'f_scl_inner'):
            d[k] = fl(r[k])
        rows.append(d)
print('image rows', len(rows), 'fields', len({r['fid'] for r in rows}))

def wilson(k, n, z=1.96):
    if n == 0: return [None, None]
    p = k / n; den = 1 + z * z / n; c = p + z * z / (2 * n); h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [round((c - h) / den, 4), round((c + h) / den, 4)]
R = lambda k, n: dict(k=int(k), n=int(n), value=round(k / n, 4) if n else None, ci95=wilson(int(k), int(n)))

# a field is only used for one tile (the one with most clear images), like the app
by_field = defaultdict(list)
for r in rows: by_field[r['fid']].append(r)
prim = {}
for fid, rs in by_field.items():
    cnt = defaultdict(int)
    for r in rs:
        if r['f_scl'] >= MIN_COV and r['n_scl'] >= MIN_PX: cnt[r['tile']] += 1
    prim[fid] = max(cnt, key=cnt.get) if cnt else (rs[0]['tile'] if rs else None)
rows = [r for r in rows if r['tile'] == prim[r['fid']]]
by_field = defaultdict(list)
for r in rows: by_field[r['fid']].append(r)
for fid in by_field: by_field[fid].sort(key=lambda r: r['date'])

app_ok = lambda r: r['f_scl'] >= MIN_COV and r['n_scl'] >= MIN_PX
both_ok = lambda r: r['f_both'] >= MIN_COV and r['n_both'] >= MIN_PX
inner_ok = lambda r: r['f_scl_inner'] >= MIN_COV and r['n_inner'] >= 5

def clear_frac(r, t):  # independent reference clear fraction at three Cloud Score+ thresholds
    return {0.5: r['f_cs50'], 0.6: r['f_cs'], 0.65: r['f_cs65']}[t]

# ---------------------------------------------------------------- 1. cloud-mask agreement
usable = [r for r in rows if not np.isnan(r['f_scl']) and not np.isnan(r['f_cs'])]
acc = [r for r in usable if app_ok(r)]
rej = [r for r in usable if not app_ok(r)]
def share(rs, pred): return R(sum(1 for r in rs if pred(r)), len(rs))
fs = np.array([r['f_scl'] for r in usable]); fc = np.array([r['f_cs'] for r in usable])
from scipy.stats import spearmanr
agree = dict(
    images=len(usable), fields=len({r['fid'] for r in usable}),
    spearman_f_scl_vs_f_cs=round(float(spearmanr(fs, fc).statistic), 3), mean_abs_difference=round(float(np.mean(np.abs(fs - fc))), 3),
    app_accepted=len(acc), app_rejected=len(rej),
    accepted_but_reference_calls_30pct_or_more_unclear={f'cs_cdf>={t}': share(acc, lambda r, t=t: clear_frac(r, t) < 0.70) for t in (0.5, 0.6, 0.65)},
    accepted_but_reference_calls_10pct_or_more_unclear={f'cs_cdf>={t}': share(acc, lambda r, t=t: clear_frac(r, t) < 0.90) for t in (0.5, 0.6, 0.65)},
    rejected_but_reference_calls_90pct_or_more_clear={f'cs_cdf>={t}': share(rej, lambda r, t=t: clear_frac(r, t) >= 0.90) for t in (0.5, 0.6, 0.65)},
    gate_acceptance_app=R(len(acc), len(usable)), gate_acceptance_if_reference_alone=R(sum(1 for r in usable if r['f_cs'] >= MIN_COV), len(usable)), gate_acceptance_app_and_reference=R(sum(1 for r in usable if both_ok(r)), len(usable)),
    partially_masked_images_share=R(sum(1 for r in usable if 0 < r['f_scl'] < 1), len(usable)),
)
strong = lambda r: r['cs_mean'] < 0.30           # the mean Cloud Score+ itself is low: much closer to real cloud/shadow than a moderate score
unc_w = [r for r in acc if r['f_cs'] < 0.70 and not np.isnan(r['ndvi_scl'])]
unc_s = [r for r in acc if strong(r) and not np.isnan(r['ndvi_scl'])]
clr_a = [r for r in acc if r['f_cs'] >= 0.70 and not np.isnan(r['ndvi_scl'])]
agree['accepted_but_reference_strongly_unclear_mean_cs_below_0p30'] = share(acc, strong)
agree['confound_low_ndvi'] = dict(
    median_ndvi_reference_clear=round(float(np.median([r['ndvi_scl'] for r in clr_a])), 3), share_ndvi_below_0p2_reference_clear=R(sum(r['ndvi_scl'] < .2 for r in clr_a), len(clr_a)),
    median_ndvi_weakly_unclear=round(float(np.median([r['ndvi_scl'] for r in unc_w])), 3), share_ndvi_below_0p2_weakly_unclear=R(sum(r['ndvi_scl'] < .2 for r in unc_w), len(unc_w)),
    median_ndvi_strongly_unclear=round(float(np.median([r['ndvi_scl'] for r in unc_s])), 3) if unc_s else None,
    share_ndvi_below_0p2_strongly_unclear=R(sum(r['ndvi_scl'] < .2 for r in unc_s), len(unc_s)) if unc_s else None,
    median_cs_mean_weakly_unclear=round(float(np.median([r['cs_mean'] for r in unc_w])), 3),
    note='A moderate Cloud Score+ on dark-to-bright bare ground is not cloud; weak disagreement is confounded with low NDVI (bare or harvested fields).')
agree['by_size'] = {}
for b, _, _ in BINS:
    a = [r for r in acc if r['bin'] == b]; u = [r for r in usable if r['bin'] == b]; j = [r for r in rej if r['bin'] == b]
    agree['by_size'][b] = dict(images=len(u), accepted=len(a),
        accepted_but_reference_30pct_unclear=share(a, lambda r: r['f_cs'] < 0.70), accepted_but_reference_10pct_unclear=share(a, lambda r: r['f_cs'] < 0.90),
        rejected_but_reference_90pct_clear=share(j, lambda r: r['f_cs'] >= 0.90),
        partially_masked=share(u, lambda r: 0 < r['f_scl'] < 1))

# ---------------------------------------------------------------- 2. NDVI error caused by what the app's mask lets through
bias_rows = [r for r in acc if not np.isnan(r['ndvi_both']) and not np.isnan(r['ndvi_scl']) and r['n_both'] >= 1]
dd = np.array([r['ndvi_scl'] - r['ndvi_both'] for r in bias_rows])
bias = dict(images=len(dd), median=round(float(np.median(dd)), 4), p5=round(float(np.percentile(dd, 5)), 4), p95=round(float(np.percentile(dd, 95)), 4),
            share_abs_over_0p05=R(int((np.abs(dd) > .05).sum()), len(dd)), share_abs_over_0p10=R(int((np.abs(dd) > .10).sum()), len(dd)),
            share_scl_lower_than_reference_by_0p05=R(int((dd < -.05).sum()), len(dd)))
# images where the reference disagrees the most
bad = [r for r in bias_rows if r['f_cs'] < 0.70]
bd = np.array([r['ndvi_scl'] - r['ndvi_both'] for r in bad]) if bad else np.array([])
bias['images_where_reference_unclear_30pct'] = dict(n=len(bad), median_ndvi_difference=round(float(np.median(bd)), 4) if len(bd) else None)

# ---------------------------------------------------------------- 3. decline alerts that rest on a cloud-affected image
def pairs(series_rows, ok):
    s = [r for r in series_rows if ok(r)]
    out = []
    for a, b in zip(s, s[1:]):
        gap = (b['date'] - a['date']).days
        if 0 < gap <= COMPARE: out.append((a, b))
    return out
alert_total = alert_cloud = 0; alert_clean = 0; pairs_scl = pairs_both = flag_scl = flag_both = 0
per_bin = {b: dict(flag=0, cloud=0, pairs=0) for b, _, _ in BINS}
for fid, rs in by_field.items():
    rs2 = [r for r in rs if not np.isnan(r['ndvi_scl'])]
    for a, b in pairs(rs2, app_ok):
        pairs_scl += 1; per_bin[a['bin']]['pairs'] += 1
        if b['ndvi_scl'] - a['ndvi_scl'] <= -DROP:
            flag_scl += 1; per_bin[a['bin']]['flag'] += 1
            # does the independent mask call either image of this alerting pair cloud-affected (>= 30 % unclear)?
            if a['f_cs'] < 0.70 or b['f_cs'] < 0.70:
                alert_cloud += 1; per_bin[a['bin']]['cloud'] += 1
    for a, b in pairs([r for r in rs if not np.isnan(r['ndvi_both'])], both_ok):
        pairs_both += 1
        if b['ndvi_both'] - a['ndvi_both'] <= -DROP: flag_both += 1
strong_flag = strong_pairs = 0
for fid, rs in by_field.items():
    for a, b in pairs([r for r in rs if not np.isnan(r['ndvi_scl'])], app_ok):
        s_ = strong(a) or strong(b)
        strong_pairs += s_
        if b['ndvi_scl'] - a['ndvi_scl'] <= -DROP and s_: strong_flag += 1
p_img = agree['accepted_but_reference_strongly_unclear_mean_cs_below_0p30']['value']
alerts = dict(pairs_under_app_mask=pairs_scl,
              pairs_with_a_strongly_unclear_image=R(strong_pairs, pairs_scl),
              flagged_pairs_resting_on_a_strongly_unclear_image=R(strong_flag, flag_scl),
              expected_share_if_independent_of_decline=round(1 - (1 - p_img) ** 2, 4), flagged_under_app_mask=R(flag_scl, pairs_scl),
              pairs_under_app_plus_reference_mask=pairs_both, flagged_under_app_plus_reference_mask=R(flag_both, pairs_both),
              flagged_pairs_resting_on_a_weakly_unclear_image_CONFOUNDED_WITH_BARE_GROUND_DO_NOT_CITE_AS_CLOUD=R(alert_cloud, flag_scl),
              by_size={b: dict(pairs=v['pairs'], flagged=R(v['flag'], v['pairs']), flagged_resting_on_cloud_affected_image=R(v['cloud'], v['flag'])) for b, v in per_bin.items()})

# ---------------------------------------------------------------- 4. edge pixels and field size
edge = {}
for b, _, _ in BINS:
    rs = [r for r in rows if r['bin'] == b and r['n_all'] > 0 and not np.isnan(r['n_all_inner'])]
    lost = [1 - r['n_all_inner'] / r['n_all'] for r in rs if r['n_all'] > 0]
    both = [r for r in rs if app_ok(r) and inner_ok(r) and not np.isnan(r['ndvi_inner']) and not np.isnan(r['ndvi_scl'])]
    d = np.array([r['ndvi_inner'] - r['ndvi_scl'] for r in both])
    # decline decisions with and without edge pixels, same images, same gate on both
    flips = dict(pairs=0, flagged_full=0, flagged_inner=0, disagree=0)
    for fid, frs in by_field.items():
        if frs[0]['bin'] != b: continue
        ok = lambda r: app_ok(r) and inner_ok(r) and not np.isnan(r['ndvi_inner']) and not np.isnan(r['ndvi_scl'])
        for x, y in pairs(frs, ok):
            f_ = y['ndvi_scl'] - x['ndvi_scl'] <= -DROP; i_ = y['ndvi_inner'] - x['ndvi_inner'] <= -DROP
            flips['pairs'] += 1; flips['flagged_full'] += f_; flips['flagged_inner'] += i_; flips['disagree'] += (f_ != i_)
    nfoot = [r['n_all'] for r in rs]; ninn = [r['n_all_inner'] for r in rs]
    edge[b] = dict(images=len(rs), median_pixels_in_field=float(np.median(nfoot)) if nfoot else None, median_pixels_after_removing_edge=float(np.median(ninn)) if ninn else None,
                   median_share_of_pixels_removed=round(float(np.median(lost)), 3) if lost else None,
                   ndvi_inner_minus_full_median=round(float(np.median(d)), 4) if len(d) else None, ndvi_inner_minus_full_p5=round(float(np.percentile(d, 5)), 4) if len(d) else None,
                   ndvi_inner_minus_full_p95=round(float(np.percentile(d, 95)), 4) if len(d) else None,
                   share_abs_difference_over_0p05=R(int((np.abs(d) > .05).sum()), len(d)) if len(d) else None,
                   decline_decision_disagrees=R(flips['disagree'], flips['pairs']) if flips['pairs'] else None, pairs=flips['pairs'])
inner_all = np.array([r['ndvi_inner'] - r['ndvi_scl'] for r in rows if app_ok(r) and inner_ok(r) and not np.isnan(r['ndvi_inner']) and not np.isnan(r['ndvi_scl'])])
edge['_all'] = dict(images=int(len(inner_all)), ndvi_inner_minus_full_median=round(float(np.median(inner_all)), 4), share_abs_over_0p05=R(int((np.abs(inner_all) > .05).sum()), len(inner_all)))

out = dict(extract=dict(images=len(rows), fields=len(by_field), sample='size-stratified random sample of Telangana fields (real polygons), all Sentinel-2 L2A images in the crop season',
                        reference_mask='Cloud Score+ S2_HARMONIZED (cs_cdf); clear if cs_cdf >= 0.6 (0.5 and 0.65 as sensitivity)', edge_definition='polygon shrunk by 10 m (one pixel)'),
           cloud_mask_agreement=agree, ndvi_error_from_mask=bias, decline_alerts_and_clouds=alerts, edge_and_size=edge)
OUT.write_text(json.dumps(out, indent=1))
pc = lambda r: 'n/a' if not r or r['value'] is None else f"{100*r['value']:.1f}% ({100*r['ci95'][0]:.1f}-{100*r['ci95'][1]:.1f}; {r['k']}/{r['n']})"
print('images', agree['images'], 'fields', agree['fields'], 'accepted', agree['app_accepted'], 'rejected', agree['app_rejected'])
print('gate acceptance app', pc(agree['gate_acceptance_app']), '| reference alone', pc(agree['gate_acceptance_if_reference_alone']))
print('rho(f_scl,f_cs)', agree['spearman_f_scl_vs_f_cs'], 'mean|diff|', agree['mean_abs_difference'], '| partial-mask share', pc(agree['partially_masked_images_share']))
for t in agree['accepted_but_reference_calls_30pct_or_more_unclear']:
    print(t, 'accepted but reference >=30% unclear:', pc(agree['accepted_but_reference_calls_30pct_or_more_unclear'][t]), '| >=10%:', pc(agree['accepted_but_reference_calls_10pct_or_more_unclear'][t]), '| rejected but ref >=90% clear:', pc(agree['rejected_but_reference_calls_90pct_or_more_clear'][t]))
print('NDVI scl-both: median', bias['median'], 'p5', bias['p5'], 'p95', bias['p95'], '>|0.05|', pc(bias['share_abs_over_0p05']), '>|0.10|', pc(bias['share_abs_over_0p10']), '| unclear-30% images:', bias['images_where_reference_unclear_30pct'])
print('strongly unclear accepted:', pc(agree['accepted_but_reference_strongly_unclear_mean_cs_below_0p30']), '| confound', agree['confound_low_ndvi'])
print('flagged resting on STRONGLY unclear image', pc(alerts['flagged_pairs_resting_on_a_strongly_unclear_image']), '| all pairs with one', pc(alerts['pairs_with_a_strongly_unclear_image']), '| expected if independent', alerts['expected_share_if_independent_of_decline'])
print('decline flagged: app mask', pc(alerts['flagged_under_app_mask']), '| app+ref mask', pc(alerts['flagged_under_app_plus_reference_mask']), '| flagged resting on weakly-unclear image (confounded with bare ground)', pc(alerts['flagged_pairs_resting_on_a_weakly_unclear_image_CONFOUNDED_WITH_BARE_GROUND_DO_NOT_CITE_AS_CLOUD']))
for b, v in edge.items():
    if b == '_all': continue
    print(b, 'px', v['median_pixels_in_field'], '->', v['median_pixels_after_removing_edge'], 'removed', v['median_share_of_pixels_removed'], '| dNDVI median', v['ndvi_inner_minus_full_median'], 'p5/p95', v['ndvi_inner_minus_full_p5'], v['ndvi_inner_minus_full_p95'], '| |d|>0.05', pc(v['share_abs_difference_over_0p05']), '| decision disagree', pc(v['decline_decision_disagrees']))
print('edge all', edge['_all'])
for b, v in agree['by_size'].items(): print('size', b, 'acc', v['accepted'], 'acc-but-30%unclear', pc(v['accepted_but_reference_30pct_unclear']), 'rej-but-clear', pc(v['rejected_but_reference_90pct_clear']), 'partial', pc(v['partially_masked']))
