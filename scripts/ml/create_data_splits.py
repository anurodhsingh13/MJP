"""Leakage-safe splits for the Telangana experiments.

  .venv/Scripts/python scripts/ml/create_data_splits.py

* main: 70 / 15 / 15 train / validation / test, stratified by label and crop. Every row is one field (FarmID is unique), so a field
  can never sit on both sides. Nearby fields in the same district still share weather and soil, so this split is optimistic;
  that is why the held-out splits below exist.
* lodo: leave-one-district-out on the largest districts (the whole district is the test set).
* season: train Rabi -> test Kharif and the reverse. 99% of the fields were sown in 2023, so a year-held-out test is impossible;
  this is the only temporal-style split the data allows.
The test rows are written here but nothing in training, tuning or model selection reads them (see compare_models.select_models).
"""
from __future__ import annotations

from collections import Counter

import numpy as np
from sklearn.model_selection import train_test_split

from ml_common import load_config, path, set_seed, training_config, write_json


def make_splits() -> dict:
    cfg = training_config()
    seed = cfg['seed']
    z = np.load(path('features') / 'telangana.npz', allow_pickle=True)
    ids, label, district, crop, season = z['ids'], z['label'], z['district'], z['crop'], z['season']
    n = len(ids)
    assert len(set(ids.tolist())) == n, 'FarmID must be unique: one row per field'
    strat = np.array([f'{l}|{c}' for l, c in zip(label, crop)])
    counts = Counter(strat.tolist())
    strat = np.array([s if counts[s] >= 4 else s.split('|')[0] for s in strat])        # merge crop strata too small to split
    idx = np.arange(n)
    tv, test = train_test_split(idx, test_size=cfg['split']['test'], stratify=strat, random_state=seed)
    train, val = train_test_split(tv, test_size=cfg['split']['validation'] / (1 - cfg['split']['test']), stratify=strat[tv], random_state=seed)
    main = {'train': sorted(train.tolist()), 'validation': sorted(val.tolist()), 'test': sorted(test.tolist())}
    lodo = {}
    for d in cfg['heldout']['districts']:
        te = np.where(district == d)[0]
        lodo[d] = {'train': np.where(district != d)[0].tolist(), 'test': te.tolist()}
    sea = {'Rabi->Kharif': {'train': np.where(season == 'Rabi')[0].tolist(), 'test': np.where(season == 'Kharif')[0].tolist()},
           'Kharif->Rabi': {'train': np.where(season == 'Kharif')[0].tolist(), 'test': np.where(season == 'Rabi')[0].tolist()}}
    # leakage checks: these raise, they are not just documentation
    sets = [set(main['train']), set(main['validation']), set(main['test'])]
    assert not (sets[0] & sets[1]) and not (sets[0] & sets[2]) and not (sets[1] & sets[2]) and sum(map(len, sets)) == n
    for d, s in lodo.items():
        assert not (set(district[s['train']].tolist()) & {d}) and set(district[s['test']].tolist()) == {d}
    for name, s in sea.items():
        assert not (set(s['train']) & set(s['test']))
    info = {'seed': seed, 'rows': n, 'fields_unique': True,
            'sizes': {k: len(v) for k, v in main.items()},
            'label_share': {k: {c: round(float((label[v] == c).mean()), 4) for c in sorted(set(label))} for k, v in main.items()},
            'lodo_test_sizes': {d: len(s['test']) for d, s in lodo.items()}, 'season_sizes': {k: [len(v['train']), len(v['test'])] for k, v in sea.items()},
            'sowing_years_note': 'about 99% of fields were sown in 2023; year-held-out validation is not possible'}
    return {'main': main, 'lodo': lodo, 'season': sea, 'info': info}


def main() -> None:
    set_seed(training_config()['seed'])
    splits = make_splits()
    write_json(path('features') / 'splits.json', splits)
    write_json(path('reports') / 'splits_summary.json', splits['info'])
    print(splits['info'])


if __name__ == '__main__':
    main()
