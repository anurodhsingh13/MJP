"""One prediction function that refuses to answer when it should: validation, evidence and confidence checks in a single place.

Why this exists: the first version split the safety across the caller (clear observations passed in by hand), a range test that counted only a
fraction of bad columns, and a confidence threshold that fell to a 0.30 floor for the cause task. The verification then showed the cause model
answering "Stressed" at 0.88 for inf / -999 / 1e12 inputs. Here every check is derived from the feature row itself and any failed check returns
INSUFFICIENT_DATA_OR_LOW_CONFIDENCE with the reasons, so a caller cannot forget one.

A model that has no validated confidence threshold (none met its safety target on validation) never answers.
"""
from __future__ import annotations

import numpy as np
from sklearn.metrics import balanced_accuracy_score

from ml_common import INSUFFICIENT

MIN_CLEAR_OBSERVATIONS = 3
MAX_MISSING_SHARE_FLOOR = 0.20       # a row may miss at most this share of features, or more if the training rows themselves miss it (99th percentile)
ENVELOPE_PAD = 1.0                   # a value is impossible when it is more than one full training range beyond the training min / max
OOD_SHARE = 0.10                     # out of distribution: more than 10% of present features outside the 0.5-99.5 training percentiles


def build_spec(X_train: np.ndarray, names: list[str]) -> dict:
    """Everything the safety checks need, computed from TRAINING rows only (so it can be stored beside the model)."""
    finite = np.where(np.isfinite(X_train), X_train, np.nan)
    lo, hi = np.nanmin(finite, 0), np.nanmax(finite, 0)
    rng = np.maximum(hi - lo, 1e-9)
    miss = np.isnan(X_train).mean(1)
    return {'names': names, 'min': lo.tolist(), 'max': hi.tolist(), 'p_lo': np.nanpercentile(finite, 0.5, axis=0).tolist(), 'p_hi': np.nanpercentile(finite, 99.5, axis=0).tolist(),
            'envelope_lo': (lo - ENVELOPE_PAD * rng).tolist(), 'envelope_hi': (hi + ENVELOPE_PAD * rng).tolist(),
            'max_missing_share': float(max(MAX_MISSING_SHARE_FLOOR, np.percentile(miss, 99))), 'n_clear_index': names.index('n_clear_obs') if 'n_clear_obs' in names else None,
            'min_clear_observations': MIN_CLEAR_OBSERVATIONS}


def validate_rows(X: np.ndarray, spec: dict) -> list[list[str]]:
    """Reasons each row must not be answered (empty list = acceptable). Never raises on bad numbers."""
    X = np.asarray(X, float)
    lo, hi, pl, ph = (np.array(spec[k]) for k in ('envelope_lo', 'envelope_hi', 'p_lo', 'p_hi'))
    out = []
    for row in X:
        why = []
        if np.isinf(row).any():
            why.append('non_finite_values')
        present = ~np.isnan(row) & ~np.isinf(row)
        if np.isnan(row).mean() > spec['max_missing_share']:
            why.append('too_many_missing_features')
        if (present & ((row < lo) | (row > hi))).any():
            why.append('physically_implausible_values')
        if present.any() and ((present & ((row < pl) | (row > ph))).sum() / present.sum()) > OOD_SHARE:
            why.append('outside_training_distribution')
        i = spec.get('n_clear_index')
        if i is not None and (np.isnan(row[i]) or row[i] < spec['min_clear_observations']):
            why.append('too_few_clear_observations')
        out.append(why)
    return out


def choose_cause_threshold(proba: np.ndarray, y: np.ndarray, margin: float, min_coverage: float, min_answered: int = 30):
    """For a task with no Healthy class there is no false-healthy target, so the safety target is skill: the answered subset must beat chance by
    `margin` in balanced accuracy on VALIDATION data. Returns the largest-coverage threshold that does, or None (the model must then abstain)."""
    k = proba.shape[1]
    conf, pred = proba.max(1), proba.argmax(1)
    best = None
    for t in np.linspace(0.30, 0.99, 70):
        ans = conf >= t
        if ans.mean() < min_coverage or ans.sum() < min_answered or len(set(y[ans].tolist())) < 2:
            continue
        if balanced_accuracy_score(y[ans], pred[ans]) >= 1 / k + margin and (best is None or ans.mean() > best['coverage']):
            best = {'threshold': float(t), 'coverage': float(ans.mean())}
    return best


def predict_with_safety(model, X: np.ndarray, spec: dict, classes: list[str], threshold: float | None) -> list[dict]:
    """The only function a service should call. `model.predict_proba` must accept a 2-D float array (a saved sklearn pipeline does)."""
    X = np.asarray(X, float).reshape(-1, len(spec['names']))
    reasons = validate_rows(X, spec)
    answers = []
    for i, why in enumerate(reasons):
        entry = {'answer': INSUFFICIENT, 'reasons': list(why), 'confidence': None, 'probabilities': None}
        if not why:
            try:
                p = np.asarray(model.predict_proba(X[i:i + 1]), float)[0]
            except Exception as exc:                      # a model error is an abstention, not a crash and not a guess
                entry['reasons'].append(f'model_error:{type(exc).__name__}')
                answers.append(entry)
                continue
            entry.update(confidence=float(p.max()), probabilities={c: float(v) for c, v in zip(classes, p)})
            if threshold is None:
                entry['reasons'].append('no_validated_confidence_threshold')
            elif p.max() < threshold:
                entry['reasons'].append('low_confidence')
            else:
                entry['answer'] = classes[int(p.argmax())]
        answers.append(entry)
    return answers
