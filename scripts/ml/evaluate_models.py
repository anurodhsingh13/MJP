"""Collect the per-model results and run the checks that say whether the numbers mean anything.

  .venv/Scripts/python scripts/ml/evaluate_models.py [--run-id main]

* collect(): every finished model result in one list.
* sanity checks (LightGBM, fixed settings): (1) the real labels, (2) the labels shuffled (must score about chance), (3) the SAME features
  predicting crop type (a label we know is visible from space). If (3) is far above chance and (1) is not, the features work and the
  health labels carry no signal these inputs can read.
* ablation: which input groups (satellite, crop/season, weather, the survey's field-record columns) change the score.
* learning curve for the strongest model: does more training data help?
"""
from __future__ import annotations

import argparse

import numpy as np
from lightgbm import LGBMClassifier
from sklearn.metrics import balanced_accuracy_score, f1_score, roc_auc_score

from ml_common import path, read_json, set_seed, training_config, write_json
from task_data import load_task

FIXED = dict(n_estimators=200, learning_rate=0.05, num_leaves=15, min_child_samples=20, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
             class_weight='balanced', n_jobs=8, verbose=-1)


def collect(run_id: str = 'main') -> list[dict]:
    out = []
    for p in sorted((path('runs') / run_id).glob('*/*.json')):
        if p.name.endswith('.proba.npz'):
            continue
        out.append(read_json(p))
    return out


def _groups(names: list[str]) -> dict[str, list[int]]:
    meta = [i for i, n in enumerate(names) if n.startswith('crop=') or n in ('season_rabi', 'area_ha', 'season_days') or n.startswith('sow_doy_')]
    wx = [i for i, n in enumerate(names) if n.startswith('wx_')]
    sat = [i for i in range(len(names)) if i not in set(meta) | set(wx)]
    return {'satellite': sat, 'meta': meta, 'weather': wx}


def _score(X, y, td, binary: bool, seed: int) -> dict:
    """Validation and mean leave-one-district-out score for one feature matrix."""
    def run(tr, te):
        m = LGBMClassifier(random_state=seed, **FIXED).fit(X[tr], y[tr])
        p = m.predict_proba(X[te])
        return (roc_auc_score(y[te], p[:, 1]) if binary else None), balanced_accuracy_score(y[te], p.argmax(1)), f1_score(y[te], p.argmax(1), average='macro', zero_division=0)
    auc, ba, f1 = run(td.train, td.val)
    lodo = [run(s['train'], s['test']) for s in td.lodo.values()]
    out = {'val_balanced_accuracy': float(ba), 'val_f1_macro': float(f1), 'lodo_balanced_accuracy': float(np.mean([r[1] for r in lodo])), 'lodo_f1_macro': float(np.mean([r[2] for r in lodo]))}
    if binary:
        out.update(val_roc_auc=float(auc), lodo_roc_auc=float(np.mean([r[0] for r in lodo])))
    return out


def record_matrix(td) -> np.ndarray:
    """The survey's field-record columns (irrigation, expected yield, ...). The app does not have them; used for the ablation only."""
    import train_telangana_satellite as legacy
    from prepare_satellite_data import load_fields
    fields = {f['id']: f for f in load_fields()}
    recs = [fields[i]['record'] for i in td.ids]
    cats = {k: sorted({r[k] for r in recs}) for k in ('IrriType', 'IrriSource', 'CNext', 'CLast', 'CTransp')}
    rows = [legacy.tab_features(r, cats) for r in recs]
    keys = sorted(rows[0])
    return np.array([[r.get(k, np.nan) for k in keys] for r in rows], float)


def checks(seed: int) -> dict:
    set_seed(seed)
    td = load_task('health_binary')
    names, X, y = td.feature_names, td.X, td.y
    g = _groups(names)
    out = {'labels': _score(X, y, td, True, seed)}
    rng = np.random.default_rng(seed)
    ys = y.copy()
    ys[td.train] = rng.permutation(ys[td.train])                       # shuffle the training labels only
    m = LGBMClassifier(random_state=seed, **FIXED).fit(X[td.train], ys[td.train])
    out['shuffled_training_labels'] = {'val_roc_auc': float(roc_auc_score(y[td.val], m.predict_proba(X[td.val])[:, 1]))}
    # the same inputs on a label that IS visible from space: crop type (crop one-hot columns removed from the inputs)
    keep = [i for i, n in enumerate(names) if not n.startswith('crop=')]
    crop_y = np.unique(td.crop, return_inverse=True)[1]
    cm = LGBMClassifier(random_state=seed, **{**FIXED, 'class_weight': None}).fit(X[td.train][:, keep], crop_y[td.train])
    pred = cm.predict(X[td.val][:, keep])
    out['crop_type_from_same_features'] = {'val_accuracy': float((pred == crop_y[td.val]).mean()), 'majority_accuracy': float(np.bincount(crop_y[td.val]).max() / len(td.val)),
                                           'classes': int(crop_y.max() + 1)}
    sets = {'satellite_only': g['satellite'], 'satellite+crop_season': g['satellite'] + g['meta'], 'satellite+weather': g['satellite'] + g['weather'],
            'satellite+crop_season+weather (main)': g['satellite'] + g['meta'] + g['weather']}
    out['ablation'] = {k: _score(X[:, idx], y, td, True, seed) for k, idx in sets.items()}
    rec = record_matrix(td)
    out['ablation']['field_record_only (survey columns, not in the app)'] = _score(rec, y, td, True, seed)
    out['ablation']['all + field_record'] = _score(np.hstack([X, rec]), y, td, True, seed)
    return out


def learning_curve(seed: int) -> dict:
    td = load_task('health_binary')
    rng = np.random.default_rng(seed)
    res = {}
    for frac in (0.1, 0.25, 0.5, 0.75, 1.0):
        sel = rng.permutation(td.train)[:max(int(len(td.train) * frac), 60)]
        m = LGBMClassifier(random_state=seed, **FIXED).fit(td.X[sel], td.y[sel])
        pv, pt = m.predict_proba(td.X[td.val]), m.predict_proba(td.X[sel])
        res[str(frac)] = {'train_rows': int(len(sel)), 'val_roc_auc': float(roc_auc_score(td.y[td.val], pv[:, 1])), 'val_balanced_accuracy': float(balanced_accuracy_score(td.y[td.val], pv.argmax(1))),
                          'train_balanced_accuracy': float(balanced_accuracy_score(td.y[sel], pt.argmax(1)))}
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--run-id', default='main')
    a = ap.parse_args()
    seed = training_config()['seed']
    results = collect(a.run_id)
    c = checks(seed)
    c['learning_curve_lightgbm_health_binary'] = learning_curve(seed)
    write_json(path('reports') / 'sanity_checks.json', c)
    ok = [r for r in results if r['status'] == 'ok']
    print(f"{len(results)} results ({len(ok)} ok, {sum(r['status'] == 'failed' for r in results)} failed, {sum(r['status'] == 'not_applicable' for r in results)} not applicable)")
    print('real labels:', c['labels'])
    print('shuffled labels AUC:', c['shuffled_training_labels'])
    print('crop type from same features:', c['crop_type_from_same_features'])


if __name__ == '__main__':
    main()
