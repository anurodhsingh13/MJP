"""Model zoo and Optuna search for the classical models, plus the generic study runner the deep models reuse.

Every model is tuned the same way: Optuna TPE (seeded), stratified K-fold CV on the TRAINING rows only, macro-F1 as the objective,
a trial count and a time limit from configs/ml/training_config.yaml. Validation and test rows are never seen here.
Search spaces are deliberately small: with ~2,500 training rows, aggressive tuning would only fit noise.
"""
from __future__ import annotations

import time

import numpy as np
import optuna
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.model_selection import StratifiedKFold
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier
from sklearn.utils.class_weight import compute_sample_weight

optuna.logging.set_verbosity(optuna.logging.WARNING)

NEEDS_IMPUTE = {'logistic_regression', 'decision_tree', 'random_forest', 'extra_trees', 'svm', 'knn'}   # the others take NaN natively
NEEDS_SCALE = {'logistic_regression', 'svm', 'knn'}
SAMPLE_WEIGHT = {'xgboost'}                                  # class balance via sample weights where there is no class_weight argument


def space(name: str, t: 'optuna.Trial') -> dict:
    if name == 'logistic_regression':
        return {'C': t.suggest_float('C', 1e-3, 10, log=True)}
    if name == 'decision_tree':
        return {'max_depth': t.suggest_int('max_depth', 2, 12), 'min_samples_leaf': t.suggest_int('min_samples_leaf', 5, 60)}
    if name in ('random_forest', 'extra_trees'):
        return {'n_estimators': t.suggest_int('n_estimators', 100, 300, step=50), 'max_depth': t.suggest_int('max_depth', 3, 16),
                'min_samples_leaf': t.suggest_int('min_samples_leaf', 1, 20), 'max_features': t.suggest_categorical('max_features', ['sqrt', 0.5])}
    if name == 'xgboost':
        return {'n_estimators': t.suggest_int('n_estimators', 100, 400, step=50), 'max_depth': t.suggest_int('max_depth', 2, 7),
                'learning_rate': t.suggest_float('learning_rate', 0.02, 0.3, log=True), 'subsample': t.suggest_float('subsample', 0.6, 1.0),
                'colsample_bytree': t.suggest_float('colsample_bytree', 0.5, 1.0), 'min_child_weight': t.suggest_int('min_child_weight', 1, 20),
                'reg_lambda': t.suggest_float('reg_lambda', 0.1, 10, log=True)}
    if name == 'lightgbm':
        return {'n_estimators': t.suggest_int('n_estimators', 100, 400, step=50), 'num_leaves': t.suggest_int('num_leaves', 4, 48),
                'learning_rate': t.suggest_float('learning_rate', 0.02, 0.3, log=True), 'min_child_samples': t.suggest_int('min_child_samples', 5, 60),
                'subsample': t.suggest_float('subsample', 0.6, 1.0), 'colsample_bytree': t.suggest_float('colsample_bytree', 0.5, 1.0),
                'reg_lambda': t.suggest_float('reg_lambda', 0.1, 10, log=True)}
    if name == 'catboost':
        return {'iterations': t.suggest_int('iterations', 100, 400, step=50), 'depth': t.suggest_int('depth', 3, 7),
                'learning_rate': t.suggest_float('learning_rate', 0.02, 0.3, log=True), 'l2_leaf_reg': t.suggest_float('l2_leaf_reg', 1, 10, log=True)}
    if name == 'svm':
        return {'C': t.suggest_float('C', 0.1, 30, log=True), 'gamma': t.suggest_float('gamma', 1e-4, 1e-1, log=True)}
    if name == 'hist_gradient_boosting':
        return {'max_depth': t.suggest_int('max_depth', 2, 8), 'learning_rate': t.suggest_float('learning_rate', 0.02, 0.3, log=True),
                'max_iter': t.suggest_int('max_iter', 100, 400, step=50), 'l2_regularization': t.suggest_float('l2_regularization', 0.01, 10, log=True),
                'min_samples_leaf': t.suggest_int('min_samples_leaf', 10, 60)}
    if name == 'knn':
        return {'n_neighbors': t.suggest_int('n_neighbors', 5, 60), 'weights': t.suggest_categorical('weights', ['uniform', 'distance'])}
    raise KeyError(name)


def build(name: str, params: dict, seed: int, n_classes: int):
    if name == 'logistic_regression':
        est = LogisticRegression(max_iter=3000, class_weight='balanced', random_state=seed, **params)
    elif name == 'decision_tree':
        est = DecisionTreeClassifier(class_weight='balanced', random_state=seed, **params)
    elif name == 'random_forest':
        est = RandomForestClassifier(class_weight='balanced_subsample', n_jobs=-1, random_state=seed, **params)
    elif name == 'extra_trees':
        est = ExtraTreesClassifier(class_weight='balanced_subsample', n_jobs=-1, random_state=seed, **params)
    elif name == 'xgboost':
        from xgboost import XGBClassifier
        est = XGBClassifier(tree_method='hist', device='cpu', n_jobs=8, random_state=seed, verbosity=0, eval_metric='mlogloss' if n_classes > 2 else 'logloss', **params)
    elif name == 'lightgbm':
        from lightgbm import LGBMClassifier
        est = LGBMClassifier(class_weight='balanced', n_jobs=8, random_state=seed, verbose=-1, **params)
    elif name == 'catboost':
        from catboost import CatBoostClassifier
        est = CatBoostClassifier(auto_class_weights='Balanced', thread_count=8, random_seed=seed, verbose=0, allow_writing_files=False, **params)
    elif name == 'svm':
        est = SVC(kernel='rbf', probability=True, class_weight='balanced', random_state=seed, **params)
    elif name == 'hist_gradient_boosting':
        est = HistGradientBoostingClassifier(class_weight='balanced', random_state=seed, early_stopping=False, **params)
    elif name == 'knn':
        est = KNeighborsClassifier(n_jobs=1, **params)
    else:
        raise KeyError(name)
    steps = []
    if name in NEEDS_IMPUTE:
        steps.append(('impute', SimpleImputer(strategy='median')))      # fitted on training rows only, inside the pipeline
    if name in NEEDS_SCALE:
        steps.append(('scale', StandardScaler()))
    steps.append(('model', est))
    return Pipeline(steps)


def fit(name: str, est, X: np.ndarray, y: np.ndarray):
    kwargs = {}
    if name in SAMPLE_WEIGHT:
        kwargs['model__sample_weight'] = compute_sample_weight('balanced', y)
    est.fit(X, y, **kwargs)
    return est


def run_study(objective, trials: int, timeout: float, seed: int):
    """Seeded TPE study maximising `objective(trial)`. Returns (best_params, best_value, trials_run, seconds)."""
    study = optuna.create_study(direction='maximize', sampler=optuna.samplers.TPESampler(seed=seed))
    t0 = time.perf_counter()
    study.optimize(objective, n_trials=trials, timeout=timeout, gc_after_trial=True)
    done = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
    if not done:
        return None, None, 0, time.perf_counter() - t0
    return study.best_params, float(study.best_value), len(done), time.perf_counter() - t0


def tune_classical(name: str, X: np.ndarray, y: np.ndarray, n_classes: int, cfg: dict, seed: int, trials: int | None = None, timeout: float | None = None, cv_folds: int | None = None):
    """CV macro-F1 on the rows given (training rows only). `trials` / `timeout` override the config (used for the smaller nested searches inside held-out folds).
    Returns (params, cv_f1, trials, seconds)."""
    folds = list(StratifiedKFold(cv_folds or cfg['optuna']['cv_folds'], shuffle=True, random_state=seed).split(X, y))

    def objective(trial):
        params = space(name, trial)
        scores = []
        for tr, te in folds:
            est = fit(name, build(name, params, seed, n_classes), X[tr], y[tr])
            scores.append(f1_score(y[te], est.predict(X[te]), average='macro', zero_division=0))
        return float(np.mean(scores))

    return run_study(objective, trials or cfg['optuna']['trials_classical'], timeout or cfg['optuna']['timeout_seconds_per_model'], seed)
