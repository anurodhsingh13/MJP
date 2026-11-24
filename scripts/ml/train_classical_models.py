"""Classical models and the two baselines on the Telangana tasks.

  .venv/Scripts/python scripts/ml/train_classical_models.py [--tasks health_binary ...] [--models xgboost ...] [--force]

Models: logistic regression, decision tree, random forest, extra trees, XGBoost, LightGBM, CatBoost, SVM, HistGradientBoosting, KNN.
Baselines: majority class (predicts the training prior) and the app's real alert replayed on every field (AppRuleReplay), which only exists for
the Healthy / Problem task.
All run on the CPU. GPU builds of XGBoost / CatBoost exist, but 2,500 rows gain nothing from them, so none is claimed or used.
"""
from __future__ import annotations

import argparse
import io

import joblib
import numpy as np

from ml_common import load_config, training_config
from optimize_hyperparameters import build, fit as fit_estimator, tune_classical
from task_data import TASKS

BASELINES = ('majority_class', 'ndvi_rule')


class Majority:
    def fit(self, X, y):
        self.prior = np.bincount(y, minlength=int(y.max()) + 1) / len(y)
        return self

    def predict_proba(self, X):
        return np.tile(self.prior, (len(X), 1))


class AppRuleReplay:
    """The app's real alert (shared/evidence.ts assessEvidence + shared/advice.ts decideVisit), replayed over each field's season by
    scripts/evaluate-telangana-alerts.mjs and stored in .local/ml/features/app_rule_replay.json. A field is Problem when the rule said
    "visit: yes" at least once; "no decision" (not enough comparable images) counts as no alert, so it is never hidden as a hit."""

    def __init__(self, outcomes: dict):
        self.outcomes = outcomes

    @classmethod
    def load(cls):
        import json
        from ml_common import ROOT
        f = ROOT / '.local/ml/features/app_rule_replay.json'
        if not f.exists():
            raise FileNotFoundError('run: node --import tsx scripts/evaluate-telangana-alerts.mjs --dir .local/datasets/labelled/telangana-s2-full --json .local/ml/features/app_rule_replay.json')
        return cls({r['id']: r['outcome'] for r in json.load(open(f))['rows']})

    def fit(self, X, y):
        return self

    def predict_ids(self, ids):
        alert = np.array([self.outcomes.get(str(i)) == 'alert' for i in ids], float)
        return np.stack([1 - alert, alert], 1)


def applicable(model, td):
    return not (model == 'ndvi_rule' and td.name != 'health_binary')


def not_applicable_reason(model, td):
    return 'the app rule only separates alert / no alert; it cannot name a cause or a class'


def tune(td, model, cfg, seed, rows=None, trials=None, timeout=None, cv_folds=None):
    if model in BASELINES:
        return {}, None, 0, 0.0
    rows = td.train if rows is None else rows
    params, cv, trials, secs = tune_classical(model, td.X[rows], td.y[rows], len(td.classes), cfg, seed, trials, timeout, cv_folds)
    if params is None:
        raise RuntimeError('no tuning trial finished inside the time limit')
    return params, cv, trials, secs


def fit(td, model, params, rows, seed):
    if model == 'majority_class':
        return Majority().fit(td.X[rows], td.y[rows])
    if model == 'ndvi_rule':
        return AppRuleReplay.load()
    return fit_estimator(model, build(model, params, seed, len(td.classes)), td.X[rows], td.y[rows])


def predict(fitted, td, rows):
    if isinstance(fitted, AppRuleReplay):
        return fitted.predict_ids(td.ids[rows])
    return np.asarray(fitted.predict_proba(td.X[rows]), float)


def gpu_used(model):
    return False


def size_bytes(fitted):
    buf = io.BytesIO()
    joblib.dump(fitted, buf)
    return buf.getbuffer().nbytes


def save(fitted, base):
    """The joblib pipeline (imputer / scaler included) plus, for the three boosted-tree libraries, a portable native file that is not a pickle."""
    base.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(fitted, base.with_suffix('.joblib'))
    est = getattr(fitted, 'named_steps', {}).get('model')
    name = type(est).__name__
    if name == 'LGBMClassifier':
        est.booster_.save_model(str(base.with_suffix('.lgb.txt')))
    elif name == 'XGBClassifier':
        est.save_model(str(base.with_suffix('.xgb.json')))
    elif name == 'CatBoostClassifier':
        est.save_model(str(base.with_suffix('.cbm')))


def main():
    from experiment import run_one
    ap = argparse.ArgumentParser()
    ap.add_argument('--tasks', nargs='*', default=list(TASKS))
    ap.add_argument('--models', nargs='*', default=None)
    ap.add_argument('--run-id', default='main')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    models = a.models or (list(BASELINES) + load_config('model_config')['classical'])
    for task in a.tasks:
        for m in models:
            run_one(task, m, 'classical', a.run_id, a.force)


if __name__ == '__main__':
    main()
