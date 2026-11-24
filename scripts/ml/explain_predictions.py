"""Explainability and the abstention rule, for the strongest tree model of each task.

  .venv/Scripts/python scripts/ml/explain_predictions.py [--run-id main]

* Feature contributions: exact TreeSHAP values from LightGBM (pred_contrib) or XGBoost (pred_contribs). The `shap` package is not required: it failed to
  import once under a Windows Application Control policy, and these two libraries compute the same values natively (verified equal to shap.TreeExplainer).
* Permutation importance on the validation split (drop in balanced accuracy and ROC-AUC when a column is shuffled).
* Example predictions with their top reasons. These are satellite indicators that moved the score, not a diagnosis of any disease.
* Abstention: the confidence threshold is chosen on VALIDATION data, then applied once to the test split.
"""
from __future__ import annotations

import argparse

import joblib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import balanced_accuracy_score, roc_auc_score

from compare_models import fig_dir
from evaluate_models import collect
from ml_common import INSUFFICIENT, apply_abstention, choose_confidence_threshold, path, set_seed, training_config, write_json
from task_data import TASKS, load_task


def contributions(model_name: str, pipe, X: np.ndarray, n_classes: int) -> np.ndarray:
    """(n, classes, features) TreeSHAP contributions in log-odds space (bias column dropped)."""
    est = pipe.named_steps['model']
    n_feat = X.shape[1]
    if model_name == 'lightgbm':
        c = est.predict(X, pred_contrib=True)
    else:
        import xgboost as xgb
        c = est.get_booster().predict(xgb.DMatrix(X), pred_contribs=True)
    c = np.asarray(c)
    if n_classes == 2:                       # binary models give one margin: it explains the positive class
        return np.stack([-c[:, :n_feat], c[:, :n_feat]], 1)
    return c.reshape(len(X), n_classes, n_feat + 1)[:, :, :n_feat]


def permutation_importance(pipe, X, y, n_classes, seed, repeats=3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    base_p = pipe.predict_proba(X)
    base = balanced_accuracy_score(y, base_p.argmax(1))
    drop = np.zeros(X.shape[1])
    for j in range(X.shape[1]):
        s = []
        for _ in range(repeats):
            Xp = X.copy()
            Xp[:, j] = rng.permutation(Xp[:, j])
            s.append(base - balanced_accuracy_score(y, pipe.predict_proba(Xp).argmax(1)))
        drop[j] = np.mean(s)
    return drop


def out_of_range(X_train: np.ndarray, X: np.ndarray, max_share: float = 0.20) -> np.ndarray:
    """True when a row is inside the training distribution: at most `max_share` of its non-missing features outside the 0.5-99.5 percentiles."""
    lo, hi = np.nanpercentile(X_train, 0.5, axis=0), np.nanpercentile(X_train, 99.5, axis=0)
    with np.errstate(invalid='ignore'):
        outside = ((X < lo) | (X > hi)) & ~np.isnan(X)
    present = np.maximum((~np.isnan(X)).sum(1), 1)
    return (outside.sum(1) / present) <= max_share


def explain_task(run_id: str, task: str, results: list[dict], cfg: dict, seed: int) -> dict | None:
    cands = [r for r in results if r['task'] == task and r['status'] == 'ok' and r['model'] in ('lightgbm', 'xgboost')]
    if not cands:
        return None
    best = max(cands, key=lambda r: r['val']['f1_macro'])
    name = best['model']
    pipe = joblib.load(path('models') / run_id / task / f'{name}.joblib')
    td = load_task(task)
    k = len(td.classes)
    Xv, yv = td.X[td.val], td.y[td.val]
    contrib = contributions(name, pipe, Xv, k)
    global_imp = np.abs(contrib).mean(axis=(0, 1))
    perm = permutation_importance(pipe, Xv, yv, k, seed)
    order = np.argsort(-global_imp)[:15]
    top = [{'feature': td.feature_names[i], 'mean_abs_contribution': float(global_imp[i]), 'permutation_drop_balanced_accuracy': float(perm[i])} for i in order]
    pv = pipe.predict_proba(Xv)
    examples = []
    for i in np.argsort(-pv.max(1))[:3]:             # the three most confident validation predictions
        c = int(pv[i].argmax())
        idx = np.argsort(-contrib[i, c])[:3]
        examples.append({'field_row': int(i), 'predicted': td.classes[c], 'true': td.classes[yv[i]], 'confidence': float(pv[i, c]),
                         'top_reasons': [{'feature': td.feature_names[j], 'value': None if np.isnan(Xv[i, j]) else float(Xv[i, j]), 'contribution': float(contrib[i, c, j])} for j in idx],
                         'note': 'satellite indicators that raised this class score; not a diagnosis'})
    # abstention: threshold from VALIDATION, applied to TEST
    a = cfg['abstention']
    thr = choose_confidence_threshold(pv, yv, td.healthy_index, a['target_false_healthy_rate'], a['min_coverage'])
    Xt, yt = td.X[td.test], td.y[td.test]
    pt = pipe.predict_proba(Xt)
    inside = out_of_range(td.X[td.train], Xt)
    answers = apply_abstention(pt, thr['threshold'] if thr else None, td.classes, td.n_clear[td.test], a['min_clear_observations'], inside)
    answered = np.array([x != INSUFFICIENT for x in answers])
    pred = np.array([td.classes.index(x) if x != INSUFFICIENT else -1 for x in answers])
    ab = {'threshold_chosen_on_validation': thr, 'target_false_healthy_rate': a['target_false_healthy_rate'], 'test_coverage': float(answered.mean()),
          'test_outside_training_range_share': float((~inside).mean())}
    if answered.any():
        ab['test_accuracy_when_answered'] = float((pred[answered] == yt[answered]).mean())
        ab['test_majority_accuracy_when_answered'] = float(np.bincount(yt[answered]).max() / answered.sum())
        if td.healthy_index is not None and (answered & (yt != td.healthy_index)).any():
            st = answered & (yt != td.healthy_index)
            ab['test_false_healthy_rate_when_answered'] = float((pred[st] == td.healthy_index).mean())
            ab['test_stressed_fields_answered'] = int(st.sum())
    else:
        ab['verdict'] = 'no confidence threshold met the safety target on validation, so the model abstains on every field'
    return {'task': task, 'model': name, 'method': 'exact TreeSHAP (native) + permutation importance on validation', 'top_features': top, 'examples': examples, 'abstention': ab}


def draw(task: str, info: dict) -> str:
    f = info['top_features'][:12][::-1]
    fig, a = plt.subplots(figsize=(7, 4.4))
    y = np.arange(len(f))
    a.barh(y + 0.2, [x['mean_abs_contribution'] for x in f], 0.4, label='mean |TreeSHAP|')
    a2 = a.twiny()
    a2.barh(y - 0.2, [x['permutation_drop_balanced_accuracy'] for x in f], 0.4, color='tab:orange', label='permutation drop (balanced accuracy)')
    a.set_yticks(y, [x['feature'] for x in f])
    a.set_title(f"{task}: {info['model']} feature importance (validation)\nblue = TreeSHAP, orange = permutation (top axis)", fontsize=9)
    fig.tight_layout()
    p = fig_dir() / f'feature_importance_{task}.png'
    fig.savefig(p, dpi=110)
    plt.close(fig)
    return p.name


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--run-id', default='main')
    a = ap.parse_args()
    cfg = training_config()
    set_seed(cfg['seed'])
    results = collect(a.run_id)
    out = {}
    for task in TASKS:
        info = explain_task(a.run_id, task, results, cfg, cfg['seed'])
        if info:
            info['figure'] = draw(task, info)
            out[task] = info
            ab = info['abstention']
            print(f"{task} [{info['model']}] abstention: threshold {ab['threshold_chosen_on_validation']} coverage {ab['test_coverage']:.2f}; top feature {info['top_features'][0]['feature']}")
    write_json(path('reports') / 'explain.json', out)


if __name__ == '__main__':
    main()
