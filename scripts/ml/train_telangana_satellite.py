"""Train and evaluate field-level crop-problem models on the Telangana Crop Health labels.

  .venv-ml/Scripts/python scripts/ml/train_telangana_satellite.py

Inputs (git-ignored):  .local/datasets/labelled/telangana-s2-full/{sample.csv,ndvi.csv}  (scripts/telangana_ndvi_extract.py --full)
                       .local/datasets/labelled/zindi-telangana-crop-health/files/Train.csv
Outputs:               .local/models/telangana/{report.json,model_sat.pkl}

Question answered: can Sentinel-2 time series alone (NDVI/NDRE/NDMI shape over the season) tell problem fields
(Pests/Diseased/Stressed) from Healthy ones, better than the app's rule alert? Three feature sets are compared:
satellite only (what the app has), field-record only (Train.csv agronomy columns the app does not have), both.
Evaluation is district-held-out (GroupKFold) so a score is not just memorising a district, plus stratified folds.
Licence: CC-BY SA 4.0 data, so this is an evaluation; model weights stay local and are not shipped.
"""
import csv, json, pickle, sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, roc_auc_score, roc_curve, f1_score
from sklearn.model_selection import GroupKFold, StratifiedKFold

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / '.local/datasets/labelled'
OUTD = ROOT / '.local/models/telangana'; OUTD.mkdir(parents=True, exist_ok=True)
NB = 8  # phase bins
PROBLEM = {'Pests', 'Diseased', 'Stressed'}
days = lambda a, b: (datetime.strptime(a, '%Y-%m-%d') - datetime.strptime(b, '%Y-%m-%d')).days


def load():
    train = {r['FarmID']: r for r in csv.DictReader(open(D / 'zindi-telangana-crop-health/files/Train.csv', encoding='utf-8'))}
    sample = {r['FarmID']: r for r in csv.DictReader(open(D / 'telangana-s2-full/sample.csv'))}
    obs = defaultdict(list)
    for r in csv.DictReader(open(D / 'telangana-s2-full/ndvi.csv')):
        obs[r['FarmID']].append(r)
    return train, sample, obs


def sat_features(rows, sdate, hdate, area_ha):
    f = {}
    tiles = defaultdict(int)
    for r in rows:
        if r['ndvi'] != '' and float(r['valid_px']) > 0: tiles[r['tile']] += 1
    if not tiles: return None
    tile = max(tiles, key=tiles.get)
    mine = [r for r in rows if r['tile'] == tile and r['ndvi'] != '']
    total = max(float(r['valid_px']) for r in mine)
    use = [r for r in mine if float(r['valid_px']) >= 10 and float(r['valid_px']) / total >= 0.7 and sdate <= r['date'] <= hdate]
    if len(use) < 3: return None
    use.sort(key=lambda r: r['date'])
    L = max(days(hdate, sdate), 1)
    t = np.array([days(r['date'], sdate) / L for r in use])
    ndvi = np.array([float(r['ndvi']) for r in use])
    ndre = np.array([float(r['ndre']) if r['ndre'] not in ('', 'None') else np.nan for r in use])
    ndmi = np.array([float(r['ndmi']) if r['ndmi'] not in ('', 'None') else np.nan for r in use])
    sd = np.array([float(r['ndvi_std']) if r['ndvi_std'] not in ('', 'None') else np.nan for r in use])
    edges = np.linspace(0, 1, NB + 1)
    for name, arr in (('ndvi', ndvi), ('ndre', ndre), ('ndmi', ndmi)):
        for b in range(NB):
            m = (t >= edges[b]) & (t <= edges[b + 1] if b == NB - 1 else t < edges[b + 1]) & ~np.isnan(arr)
            f[f'{name}_p{b}'] = float(arr[m].mean()) if m.any() else np.nan
    f.update(ndvi_max=ndvi.max(), ndvi_min=ndvi.min(), ndvi_mean=ndvi.mean(), ndvi_std_time=ndvi.std(),
             ndvi_amp=ndvi.max() - ndvi.min(), peak_phase=float(t[ndvi.argmax()]), n_obs=len(use), season_days=L, area_ha=area_ha,
             ndvi_auc=float(getattr(np, "trapezoid", getattr(np, "trapz", None))(ndvi, t)) if len(t) > 1 else np.nan, within_field_std=float(np.nanmean(sd)) if (~np.isnan(sd)).any() else np.nan)
    d = np.diff(ndvi); dt = np.diff([days(r['date'], sdate) for r in use]).clip(min=1)
    f['max_drop'] = float(-d.min()) if len(d) else np.nan
    f['n_drops_10'] = int(((-d >= 0.10) & (dt <= 30)).sum())
    f['n_low_growing'] = int(((ndvi < 0.3) & (t > 0.15) & (t < 0.85)).sum())
    f['mid_season_min'] = float(ndvi[(t > 0.25) & (t < 0.8)].min()) if ((t > 0.25) & (t < 0.8)).any() else np.nan
    f['ndmi_mid'] = float(np.nanmean(ndmi[(t > 0.25) & (t < 0.8)])) if ((t > 0.25) & (t < 0.8) & ~np.isnan(ndmi)).any() else np.nan
    return f


WX = {}
def weather_features(district, sdate, hdate):
    if district not in WX:
        WX[district] = json.load(open(D / f'telangana-weather/{district}.json'))['p']
    p = WX[district]
    ks = [k for k in sorted(p['T2M']) if sdate.replace('-', '') <= k <= hdate.replace('-', '')]
    if len(ks) < 10: return {}
    g = lambda name: np.array([p[name][k] for k in ks], float)
    rain, t, tmax, rh, sw = g('PRECTOTCORR'), g('T2M'), g('T2M_MAX'), g('RH2M'), g('ALLSKY_SFC_SW_DWN')
    bad = lambda a: np.where(a < -900, np.nan, a)
    rain, t, tmax, rh, sw = map(bad, (rain, t, tmax, rh, sw))
    dry, run = 0, 0
    for x in rain:
        run = run + 1 if (not np.isnan(x) and x < 1) else 0; dry = max(dry, run)
    n = len(ks); third = n // 3
    return {'wx_rain_sum': float(np.nansum(rain)), 'wx_rain_days': int(np.nansum(rain >= 2.5)), 'wx_max_dry_spell': dry,
            'wx_tmean': float(np.nanmean(t)), 'wx_tmax_mean': float(np.nanmean(tmax)), 'wx_hot_days_38': int(np.nansum(tmax >= 38)),
            'wx_rh_mean': float(np.nanmean(rh)), 'wx_sw_mean': float(np.nanmean(sw)),
            'wx_rain_mid': float(np.nansum(rain[third:2 * third])), 'wx_tmax_mid': float(np.nanmean(tmax[third:2 * third])),
            'wx_rain_last_third': float(np.nansum(rain[2 * third:]))}


def tab_features(r, cats):
    f = {}
    for k in ('CropCoveredArea', 'CHeight', 'ExpYield', 'WaterCov', 'IrriCount'):
        try: f[k] = float(r[k])
        except Exception: f[k] = np.nan
    for k in ('IrriType', 'IrriSource', 'CNext', 'CLast', 'CTransp'):
        for v in cats[k]: f[f'{k}={v}'] = float(r[k] == v)
    return f


def main():
    train, sample, obs = load()
    cats = {k: sorted({r[k] for r in train.values()}) for k in ('IrriType', 'IrriSource', 'CNext', 'CLast', 'CTransp')}
    crops = sorted({r['Crop'] for r in train.values()})
    X_sat, X_tab, X_wx, y, y4, grp, ids = [], [], [], [], [], [], []
    for fid, s in sample.items():
        sf = sat_features(obs.get(fid, []), s['sdate'], s['hdate'], float(s['area_ha']))
        if sf is None: continue
        r = train[fid]
        for c in crops: sf[f'crop={c}'] = float(r['Crop'] == c)
        sf['season_rabi'] = float(r['Season'] == 'Rabi')
        X_sat.append(sf); X_tab.append(tab_features(r, cats)); X_wx.append(weather_features(r['District'], s['sdate'], s['hdate']))
        y.append(int(r['category'] in PROBLEM)); y4.append(r['category']); grp.append(r['District']); ids.append(fid)
    print(f'fields with usable satellite series: {len(y)} of {len(sample)}; problem share {np.mean(y):.3f}', flush=True)
    keys_s, keys_t = sorted(X_sat[0]), sorted(X_tab[0])
    M = lambda rows, keys: np.array([[r.get(k, np.nan) for k in keys] for r in rows], float)
    keys_w = sorted({k for w in X_wx for k in w}); Xs, Xt, Xw = M(X_sat, keys_s), M(X_tab, keys_t), M(X_wx, keys_w)
    sets = {'satellite_only': Xs, 'weather_only': Xw, 'satellite_plus_weather': np.hstack([Xs, Xw]), 'field_record_only': Xt, 'satellite_plus_record': np.hstack([Xs, Xt]), 'all': np.hstack([Xs, Xw, Xt])}
    y = np.array(y); grp = np.array(grp); y4 = np.array(y4)
    report = {'n': int(len(y)), 'problem_share': float(y.mean()), 'districts': sorted(set(grp.tolist())), 'results': {}}
    mk = lambda: HistGradientBoostingClassifier(max_depth=5, learning_rate=0.05, max_iter=300, l2_regularization=1.0,
                                                class_weight='balanced', random_state=0, early_stopping=True, validation_fraction=0.15)
    def tpr_at(yt, p, fpr_target):
        fpr, tpr, _ = roc_curve(yt, p); return float(np.interp(fpr_target, fpr, tpr))
    for name, X in sets.items():
        res = {}
        for cvname, splits in (('district_held_out', GroupKFold(n_splits=min(5, len(set(grp)))).split(X, y, grp)),
                               ('random_stratified', StratifiedKFold(5, shuffle=True, random_state=0).split(X, y))):
            oof = np.zeros(len(y))
            for tr, te in splits:
                m = mk().fit(X[tr], y[tr]); oof[te] = m.predict_proba(X[te])[:, 1]
            res[cvname] = {'auc': float(roc_auc_score(y, oof)), 'pr_auc': float(average_precision_score(y, oof)),
                           'recall_at_20pct_false_alarm': tpr_at(y, oof, 0.2), 'recall_at_10pct_false_alarm': tpr_at(y, oof, 0.1)}
            if name == 'satellite_only' and cvname == 'district_held_out':
                report['oof_satellite_district'] = {i: float(p) for i, p in zip(ids, oof)}
        report['results'][name] = res
        print(name, json.dumps({k: {a: round(b, 3) for a, b in v.items()} for k, v in res.items()}), flush=True)
    # per-crop AUC (satellite only, district held out)
    oof = np.array([report['oof_satellite_district'][i] for i in ids]); cropv = np.array([r['Crop'] for r in (train[i] for i in ids)])
    report['per_crop_auc_satellite_district'] = {c: float(roc_auc_score(y[cropv == c], oof[cropv == c])) for c in crops if len(set(y[cropv == c])) == 2 and (cropv == c).sum() > 40}
    print('per crop AUC (sat only, district held out):', {k: round(v, 3) for k, v in report['per_crop_auc_satellite_district'].items()})
    # No weights are saved: on this data no feature set beats chance (see report.json), so a model file would only mislead.
    json.dump(report, open(OUTD / 'report.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
