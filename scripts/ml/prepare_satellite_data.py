"""Load the Telangana fields, apply the observation quality rules and report what was kept and why the rest was dropped.

  .venv/Scripts/python scripts/ml/prepare_satellite_data.py

Cloud handling: the Earth Engine extraction (scripts/telangana_ndvi_extract.py) already masks Sentinel-2 SCL classes
0,1,2,3,8,9,10,11 per pixel and stores how many pixels stayed valid. Here an observation is kept only when enough pixels are valid
both in absolute terms and relative to the field's best image, so a mostly cloud-obscured date never enters a feature.
Only NDVI, NDRE (B8/B5) and NDMI (B8/B11) were extracted. B2, B3, B6, B7, B8A and B12 were not, so NDWI and EVI cannot be built from
the stored data (see docs/ml/DATASET_REPORT.md).
"""
from __future__ import annotations

import csv
from collections import Counter, defaultdict
from datetime import datetime

import numpy as np

from ml_common import ROOT, load_config, path, write_json

DAYS = lambda a, b: (datetime.strptime(a, '%Y-%m-%d') - datetime.strptime(b, '%Y-%m-%d')).days
num = lambda v: float(v) if v not in ('', 'None', None) else np.nan


def load_fields(drop_reasons: Counter | None = None) -> list[dict]:
    cfg = load_config('dataset_config')['telangana']
    train = {r['FarmID']: r for r in csv.DictReader(open(ROOT / cfg['train_csv'], encoding='utf-8'))}
    sample = {r['FarmID']: r for r in csv.DictReader(open(ROOT / cfg['s2_sample_csv']))}
    obs = defaultdict(list)
    for r in csv.DictReader(open(ROOT / cfg['s2_ndvi_csv'])):
        obs[r['FarmID']].append(r)
    reasons = drop_reasons if drop_reasons is not None else Counter()
    fields = []
    for fid, s in sample.items():
        rec = train.get(fid)
        if rec is None:
            reasons['no label row'] += 1
            continue
        rows = obs.get(fid, [])
        valid = [r for r in rows if r['ndvi'] != '' and float(r['valid_px']) > 0]
        if not valid:
            reasons['no valid Sentinel-2 observation'] += 1
            continue
        tiles = Counter(r['tile'] for r in valid)
        tile = tiles.most_common(1)[0][0]           # one Sentinel-2 tile per field: overlap zones are corrected separately
        mine = [r for r in rows if r['tile'] == tile]
        best = max(float(r['valid_px']) for r in mine if r['ndvi'] != '')
        sd, hd = s['sdate'], s['hdate']
        in_season = [r for r in mine if sd <= r['date'] <= hd]
        use = [r for r in in_season if r['ndvi'] != '' and float(r['valid_px']) >= cfg['min_valid_pixels'] and float(r['valid_px']) / best >= cfg['min_valid_fraction_of_max']]
        if len(use) < cfg['min_clear_observations']:
            reasons[f"fewer than {cfg['min_clear_observations']} clear observations in the season"] += 1
            continue
        use.sort(key=lambda r: r['date'])
        length = max(DAYS(hd, sd), 1)
        fields.append({
            'id': fid, 'label': rec['category'], 'crop': rec['Crop'], 'district': rec['District'], 'season': rec['Season'],
            'year': rec['SDate'][:4], 'sdate': sd, 'hdate': hd, 'area_ha': float(s['area_ha']), 'tile': tile, 'record': rec,
            't': np.array([DAYS(r['date'], sd) / length for r in use]),
            'doy': np.array([datetime.strptime(r['date'], '%Y-%m-%d').timetuple().tm_yday for r in use]),
            'ndvi': np.array([float(r['ndvi']) for r in use]), 'ndre': np.array([num(r['ndre']) for r in use]),
            'ndmi': np.array([num(r['ndmi']) for r in use]), 'ndvi_std': np.array([num(r['ndvi_std']) for r in use]),
            'n_in_season': len(in_season), 'n_clear': len(use), 'season_days': length,
        })
    return fields


def main() -> None:
    reasons: Counter = Counter()
    fields = load_fields(reasons)
    cfg = load_config('dataset_config')['telangana']
    total = sum(1 for _ in csv.DictReader(open(ROOT / cfg['s2_sample_csv'])))
    summary = {
        'labelled_fields_in_train_csv': sum(1 for _ in csv.DictReader(open(ROOT / cfg['train_csv'], encoding='utf-8'))),
        'fields_with_satellite_extract': total, 'fields_kept': len(fields), 'dropped': dict(reasons),
        'labels': dict(Counter(f['label'] for f in fields)), 'crops': dict(Counter(f['crop'] for f in fields)),
        'districts': dict(Counter(f['district'] for f in fields)), 'seasons': dict(Counter(f['season'] for f in fields)),
        'sowing_year': dict(Counter(f['year'] for f in fields)),
        'clear_observations': {'min': int(min(f['n_clear'] for f in fields)), 'median': float(np.median([f['n_clear'] for f in fields])), 'max': int(max(f['n_clear'] for f in fields))},
    }
    write_json(path('reports') / 'prepared_data_summary.json', summary)
    print(summary)


if __name__ == '__main__':
    main()
