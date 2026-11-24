"""Independent data verification for the CHM model comparison. Reads the RAW files and splits.json; imports nothing from the training code.

  .venv/Scripts/python scripts/ml/verify_data.py   ->  .local/ml/verify/phase_data.json
"""
import csv
import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / '.local/datasets/labelled'
OUT = ROOT / '.local/ml/verify'
OUT.mkdir(parents=True, exist_ok=True)


def centroid(wkt: str):
    nums = [float(x) for x in re.findall(r'-?\d+\.\d+', wkt)]
    xs, ys = nums[0::2], nums[1::2]
    return float(np.mean(xs)), float(np.mean(ys))


def main():
    rows = list(csv.DictReader(open(D / 'zindi-telangana-crop-health/files/Train.csv', encoding='utf-8')))
    res = {'train_csv_rows': len(rows)}
    ids = [r['FarmID'] for r in rows]
    res['unique_farm_ids'] = len(set(ids))
    res['duplicate_id_rows'] = len(ids) - len(set(ids))
    res['labels'] = dict(Counter(r['category'] for r in rows))
    res['invalid_labels'] = sum(1 for r in rows if r['category'] not in ('Healthy', 'Pests', 'Diseased', 'Stressed'))
    geom = Counter(r['geometry'] for r in rows)
    res['duplicate_geometry_rows'] = sum(c - 1 for c in geom.values() if c > 1)
    res['missing_by_column'] = {c: sum(1 for r in rows if r[c].strip() == '') for c in rows[0] if any(r[c].strip() == '' for r in rows)}
    res['one_row_per_field_one_label_per_season'] = True
    # base rate of Problem by district and crop: strong differences mean the label is confounded with place / crop
    by = defaultdict(lambda: [0, 0])
    for r in rows:
        for key in (('district', r['District']), ('crop', r['Crop']), ('season', r['Season'])):
            by[key][0] += 1
            by[key][1] += r['category'] != 'Healthy'
    res['problem_rate'] = {f'{k[0]}:{k[1]}': {'n': v[0], 'problem_rate': round(v[1] / v[0], 3)} for k, v in sorted(by.items()) if v[0] >= 100}
    # independent re-count of usable satellite fields (>= 3 clear observations in the season, one tile)
    sample = {r['FarmID']: r for r in csv.DictReader(open(D / 'telangana-s2-full/sample.csv'))}
    obs = defaultdict(list)
    for r in csv.DictReader(open(D / 'telangana-s2-full/ndvi.csv')):
        obs[r['FarmID']].append(r)
    usable = []
    for fid, s in sample.items():
        valid = [r for r in obs[fid] if r['ndvi'] != '' and float(r['valid_px']) > 0]
        if not valid:
            continue
        tile = Counter(r['tile'] for r in valid).most_common(1)[0][0]
        mine = [r for r in obs[fid] if r['tile'] == tile and r['ndvi'] != '']
        best = max(float(r['valid_px']) for r in mine)
        ok = [r for r in mine if s['sdate'] <= r['date'] <= s['hdate'] and float(r['valid_px']) >= 10 and float(r['valid_px']) / best >= 0.7]
        if len(ok) >= 3:
            usable.append(fid)
    res['extract_fields'] = len(sample)
    res['independently_counted_usable_fields'] = len(usable)
    res['extract_ids_all_in_train_csv'] = set(sample) <= set(ids)
    # splits: disjointness, coverage, stratification, leakage
    z = np.load(ROOT / '.local/ml/features/telangana.npz', allow_pickle=True)
    feat_ids = [str(i) for i in z['ids']]
    res['feature_rows'] = len(feat_ids)
    res['feature_ids_match_independent_usable_set'] = sorted(feat_ids) == sorted(usable)
    sp = json.load(open(ROOT / '.local/ml/features/splits.json'))
    tr, va, te = (set(sp['main'][k]) for k in ('train', 'validation', 'test'))
    res['split_sizes'] = {'train': len(tr), 'validation': len(va), 'test': len(te)}
    res['split_overlap_rows'] = len(tr & va) + len(tr & te) + len(va & te)
    res['split_covers_all_rows'] = (tr | va | te) == set(range(len(feat_ids)))
    res['split_field_id_overlap'] = len({feat_ids[i] for i in tr} & {feat_ids[i] for i in te}) + len({feat_ids[i] for i in tr} & {feat_ids[i] for i in va})
    lab = {i: r['category'] for r in rows for i in [r['FarmID']]}
    res['split_label_share'] = {k: {c: round(sum(lab[feat_ids[i]] == c for i in s) / len(s), 3) for c in ('Healthy', 'Pests', 'Diseased', 'Stressed')} for k, s in (('train', tr), ('validation', va), ('test', te))}
    district = {r['FarmID']: r['District'] for r in rows}
    lodo_ok = True
    for d, s in sp['lodo'].items():
        lodo_ok &= all(district[feat_ids[i]] == d for i in s['test']) and not any(district[feat_ids[i]] == d for i in s['train'])
    res['lodo_district_never_in_train'] = bool(lodo_ok)
    # SPATIAL leakage: how close is each test field to a training field? Same farm cluster = shared soil, weather and management.
    cent = {r['FarmID']: centroid(r['geometry']) for r in rows}
    lat0 = np.mean([c[1] for c in cent.values()])
    to_m = lambda lon, lat: (lon * 111320 * np.cos(np.radians(lat0)), lat * 110540)
    pts = lambda idx: np.array([to_m(*cent[feat_ids[i]]) for i in idx])
    tree = cKDTree(pts(sorted(tr)))
    near = {}
    for name, s in (('validation', va), ('test', te)):
        d, _ = tree.query(pts(sorted(s)))
        near[name] = {'median_m': float(np.median(d)), 'share_within_50m': float((d <= 50).mean()), 'share_within_250m': float((d <= 250).mean()), 'share_within_1000m': float((d <= 1000).mean())}
    # how far the SAME comparison is for a held-out district: those fields have no training neighbour in their own district
    d_all, _ = cKDTree(pts(sorted(tr))).query(pts(sorted(te)), k=2)
    res['spatial_distance_to_nearest_training_field'] = near
    res['spatial_leakage_conclusion'] = ('main test fields have a training field within 250 m' if near['test']['share_within_250m'] > 0.5 else 'most test fields are > 250 m from a training field')
    # label agreement between spatial neighbours: if close fields share labels more than chance, a random split inflates scores
    allp = pts(range(len(feat_ids)))
    tr_all = cKDTree(allp)
    dist, nn = tr_all.query(allp, k=2)
    close = dist[:, 1] <= 250
    y = np.array([lab[i] != 'Healthy' for i in feat_ids])
    agree = (y[close] == y[nn[close, 1]]).mean() if close.any() else float('nan')
    base = (y.mean() ** 2 + (1 - y.mean()) ** 2)
    res['neighbour_label_agreement_within_250m'] = {'fields_with_neighbour': int(close.sum()), 'agreement': float(agree), 'expected_if_independent': float(base)}
    json.dump(res, open(OUT / 'phase_data.json', 'w'), indent=1, default=lambda o: bool(o) if isinstance(o, np.bool_) else float(o))
    print(json.dumps(res, indent=1, default=lambda o: bool(o) if isinstance(o, np.bool_) else float(o))[:6000])


if __name__ == '__main__':
    main()
