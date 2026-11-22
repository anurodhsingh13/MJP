"""Peer-comparison test: does a field that looks different from same-crop, same-district, same-sowing-window neighbours
carry the problem label? Removes crop/season/weather effects that defeated the absolute-NDVI rule.
  .venv/Scripts/python scripts/ml/peer_anomaly_telangana.py"""
import sys, numpy as np
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import train_telangana_satellite as T
from sklearn.metrics import roc_auc_score
train, sample, obs = T.load()
rows = []
for fid, s in sample.items():
    f = T.sat_features(obs.get(fid, []), s['sdate'], s['hdate'], float(s['area_ha']))
    if f is None: continue
    r = train[fid]
    rows.append(dict(f=f, crop=r['Crop'], dist=r['District'], sd=(datetime.strptime(s['sdate'], '%Y-%m-%d') - datetime(2022, 1, 1)).days, y=int(r['category'] != 'Healthy'), cat=r['category']))
keys = [f'ndvi_p{b}' for b in range(T.NB)] + ['ndvi_max', 'ndvi_amp', 'ndvi_auc', 'peak_phase', 'ndvi_mean', 'within_field_std']
def peers(i, wide):
    a = rows[i]
    return [j for j, b in enumerate(rows) if j != i and b['crop'] == a['crop'] and (wide or b['dist'] == a['dist']) and abs(b['sd'] - a['sd']) <= 15]
for wide, name in ((False, 'same district'), (True, 'any district')):
    sc = {k: [] for k in ('mean_abs_z', 'min_z', 'max_neg_z', 'max_abs_z')}; ys = []; cats = []
    for i, a in enumerate(rows):
        P = peers(i, wide)
        if len(P) < 8: continue
        z = []
        for k in keys:
            v = np.array([rows[j]['f'][k] for j in P], float); x = a['f'][k]
            if np.isnan(x) or np.isnan(v).all(): continue
            sd = np.nanstd(v); z.append((x - np.nanmean(v)) / sd if sd > 1e-6 else 0.0)
        if len(z) < 6: continue
        z = np.array(z); sc['mean_abs_z'].append(np.abs(z).mean()); sc['min_z'].append(-z.min()); sc['max_neg_z'].append(np.sum(z < -1.5)); sc['max_abs_z'].append(np.abs(z).max())
        ys.append(a['y']); cats.append(a['cat'])
    ys = np.array(ys); cats = np.array(cats)
    print(f'[{name}] fields scored {len(ys)}; AUC problem vs healthy:', {k: round(roc_auc_score(ys, v), 3) for k, v in sc.items()})
    for c in ('Pests', 'Diseased', 'Stressed'):
        m = (cats == c) | (cats == 'Healthy'); print('   ', c, 'mean_abs_z AUC', round(roc_auc_score(ys[m], np.array(sc['mean_abs_z'])[m]), 3))
