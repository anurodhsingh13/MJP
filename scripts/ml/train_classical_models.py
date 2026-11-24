"""Classical models and the two baselines on the Telangana tasks.

  .venv/Scripts/python scripts/ml/train_classical_models.py [--tasks health_binary ...] [--models xgboost ...] [--force]

Models: logistic regression, decision tree, random forest, extra trees, XGBoost, LightGBM, CatBoost, SVM, HistGradientBoosting, KNN.
Baselines: majority class (predicts the training prior) and the NDVI rule (the app's two triggers: a 0.10 drop within 30 days, or
NDVI below 0.3 while growing), which only exists for the Healthy / Problem task.
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


class NdviRule:
    """Problem when the app's rule would alert: a >= 0.10 NDVI drop within 30 days, or NDVI < 0.3 in mid-season."""

    def __init__(self, names):
        self.i = [names.index('n_drops_10_30d'), names.index('n_low_growing')]

    def fit(self, X, y):
        return self

    def predict_proba(self, X):
        alert = ((np.nan_to_num(X[:, self.i[0]]) > 0) | (np.nan_to_num(X[:, self.i[1]]) > 0)).astype(float)
        return np.stack([1 - alert, alert], 1)


def applicable(model, td):
    return not (model == 'ndvi_rule' and td.name != 'health_binary')


def not_applicable_reason(model, td):
    return 'the app rule only separates alert / no alert; it cannot name a cause or a class'


def tune(td, model, cfg, seed):
    if model in BASELINES:
        return {}, None, 0, 0.0
    params, cv, trials, secs = tune_classical(model, td.X[td.train], td.y[td.train], len(td.classes), cfg, seed)
    if params is None:
        raise RuntimeError('no tuning trial finished inside the time limit')
    return params, cv, trials, secs


def fit(td, model, params, rows, seed):
    if model == 'majority_class':
        return Majority().fit(td.X[rows], td.y[rows])
    if model == 'ndvi_rule':
        return NdviRule(td.feature_names).fit(td.X[rows], td.y[rows])
    return fit_estimator(model, build(model, params, seed, len(td.classes)), td.X[rows], td.y[rows])


def predict(fitted, td, rows):
    p = fitted.predict_proba(td.X[rows])
    return np.asarray(p, float)


def gpu_used(model):
    return False


def size_bytes(fitted):
    buf = io.BytesIO()
    joblib.dump(fitted, buf)
    return buf.getbuffer().nbytes


def save(fitted, base):
    base.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(fitted, base.with_suffix('.joblib'))


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
