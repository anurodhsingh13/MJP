"""Verify explainability and prediction safety on the saved models.

  .venv/Scripts/python scripts/ml/verify_safety.py   ->  .local/ml/verify/phase_safety.json

Explainability checks: TreeSHAP additivity (contributions + bias equal the model's raw score), agreement with the saved explain.json, stability of the
permutation ranking across seeds, behaviour when a feature is missing, and whether the `shap` package loads.
Safety checks: seven kinds of input go through the saved model and then the abstention rule exactly as explain_predictions.py applies it
(confidence threshold chosen on validation, minimum clear observations, inside-training-range test). Observed behaviour is recorded as found; a "FAIL" is a real gap.
"""
import json
import sys
import warnings
from pathlib import Path

import joblib
import numpy as np
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/ml'))
warnings.filterwarnings('ignore')
from ml_common import INSUFFICIENT  # noqa: E402
from explain_predictions import contributions, permutation_importance  # noqa: E402
from prediction_safety import predict_with_safety  # noqa: E402
from verify_models import CLASSES, load_task_arrays  # noqa: E402

OUT = ROOT / '.local/ml/verify'


def main():
    explain = json.load(open(ROOT / 'reports/ml/explain.json'))
    z = np.load(ROOT / '.local/ml/features/telangana.npz', allow_pickle=True)
    names = [str(n) for n in z['feature_names']]
    sp = json.load(open(ROOT / '.local/ml/features/splits.json'))
    res = {'explainability': {}, 'safety': {}}
    try:
        import shap  # noqa: F401
        res['explainability']['shap_package'] = 'loads'
    except Exception as exc:
        res['explainability']['shap_package'] = f'does not load here: {type(exc).__name__}: {str(exc)[:120]}'
    for task, e in explain.items():
        model = e['model']
        pipe = joblib.load(ROOT / f'.local/models/main/{task}/{model}.joblib')
        X, y, tr, te, _, _keep = load_task_arrays(task)
        va = None
        sp_va = np.asarray(sp['main']['validation'])
        label = z['label']
        keep = np.ones(len(label), bool) if task != 'stress_cause' else label != 'Healthy'
        local = np.full(len(label), -1)
        local[keep] = np.arange(keep.sum())
        va = local[sp_va[keep[sp_va]]]
        Xv, yv, k = X[va], y[va], len(CLASSES[task])
        est = pipe.named_steps['model']
        # --- additivity: sum of contributions + bias must equal the raw model score
        if model == 'lightgbm':
            raw = est.predict(Xv, pred_contrib=True)
            margin = est.predict(Xv, raw_score=True)
            tot = raw.reshape(len(Xv), -1, len(names) + 1).sum(2) if k > 2 else raw.sum(1, keepdims=True)
            err = float(np.abs(tot - (margin if k > 2 else margin.reshape(-1, 1))).max())
        else:
            import xgboost as xgb
            raw = est.get_booster().predict(xgb.DMatrix(Xv), pred_contribs=True)
            margin = est.get_booster().predict(xgb.DMatrix(Xv), output_margin=True)
            tot = raw.sum(-1)
            err = float(np.abs(tot - margin.reshape(tot.shape)).max())
        c = contributions(model, pipe, Xv, k)
        imp = np.abs(c).mean(axis=(0, 1))
        top_now = [names[i] for i in np.argsort(-imp)[:5]]
        top_saved = [t['feature'] for t in e['top_features'][:5]]
        perm_a = permutation_importance(pipe, Xv, yv, k, 1)
        perm_b = permutation_importance(pipe, Xv, yv, k, 2)
        rho_seed = float(spearmanr(perm_a, perm_b)[0])
        rho_methods = float(spearmanr(imp, perm_a)[0])
        # --- missing feature: blank the most important column and predict again
        j = int(np.argmax(imp))
        Xm = Xv.copy()
        Xm[:, j] = np.nan
        try:
            pm = pipe.predict_proba(Xm)
            change = float(np.abs(pm - pipe.predict_proba(Xv)).mean())
            miss = {'handled': True, 'mean_probability_change': change, 'feature': names[j]}
        except Exception as exc:
            miss = {'handled': False, 'error': f'{type(exc).__name__}: {exc}'}
        res['explainability'][task] = {'model': model, 'treeshap_additivity_max_abs_error': err, 'top5_matches_saved_explain_json': top_now == top_saved,
                                       'top5_recomputed': top_now, 'top5_saved': top_saved, 'permutation_rank_correlation_between_seeds': rho_seed,
                                       'treeshap_vs_permutation_rank_correlation': rho_methods, 'missing_feature': miss,
                                       'saved_example_has_not_a_diagnosis_note': all('not a diagnosis' in x['note'] for x in e['examples']),
                                       'model_is_near_chance_so_importance_is_mostly_noise': True}
        # --- safety: seven input kinds through the ONE safety function, using the settings stored beside the model
        safe = json.load(open(ROOT / f'.local/models/main/{task}/{model}.safety.json'))
        spec, thr = safe['spec'], safe['threshold']
        sat = [i for i, n in enumerate(names) if not (n.startswith('wx_') or n.startswith('crop=') or n in ('season_rabi', 'area_ha', 'season_days') or n.startswith('sow_doy_'))]
        proba_v = pipe.predict_proba(Xv)
        cases = {}
        cases['1_normal_healthy_field'] = np.nanmedian(X[tr][y[tr] == 0], axis=0)
        cases['2_stressed_field'] = np.nanmedian(X[tr][y[tr] != 0], axis=0)
        r = np.nanmedian(X[tr], axis=0)
        m = r.copy()
        m[sat] = np.nan
        cases['3_missing_satellite_observations'] = m
        cl = r.copy()
        cl[names.index('n_clear_obs')], cl[names.index('clear_fraction')] = 1, 0.1
        cases['4_cloud_obscured_one_clear_observation'] = cl
        bad = r.copy()
        bad[[sat[0], sat[1], sat[2], sat[3]]] = [np.inf, -np.inf, -999.0, 1e12]
        cases['5_invalid_numbers_inf_minus999_1e12'] = bad
        cases['6_out_of_distribution_x1000'] = r * 1000
        cases['7_lowest_confidence_validation_row'] = Xv[np.argsort(proba_v.max(1))[0]]
        permissive = 0.30                                    # a deliberately weak threshold: shows the validity gates work even when confidence would allow an answer
        out = {}
        for name, row in cases.items():
            shipped = predict_with_safety(pipe, row.reshape(1, -1), spec, CLASSES[task], thr)[0]
            gate = predict_with_safety(pipe, row.reshape(1, -1), spec, CLASSES[task], permissive)[0]
            out[name] = {'as_shipped': {'final_answer': shipped['answer'], 'reasons': shipped['reasons'], 'confidence': shipped['confidence']},
                         'with_permissive_threshold_0.30': {'final_answer': gate['answer'], 'reasons': gate['reasons'], 'confidence': gate['confidence']}}
        res['safety'][task] = {'model': model, 'threshold_from_validation': thr, 'cases': out}
    json.dump(res, open(OUT / 'phase_safety.json', 'w'), indent=1, default=lambda o: bool(o) if isinstance(o, np.bool_) else float(o))
    print(json.dumps(res, indent=1, default=lambda o: bool(o) if isinstance(o, np.bool_) else float(o))[:7000])


if __name__ == '__main__':
    main()
