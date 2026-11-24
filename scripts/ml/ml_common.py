"""Shared helpers for the CHM model comparison: config, seeds, metrics, latency, memory and the abstention rule.

Everything here is measurement code. No result is invented: a metric that cannot be computed is returned as None.
"""
from __future__ import annotations

import json
import os
import platform
import random
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import yaml
from sklearn.metrics import (accuracy_score, average_precision_score, balanced_accuracy_score, confusion_matrix,
                             f1_score, precision_recall_fscore_support, roc_auc_score)

ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / 'configs' / 'ml'


def load_config(name: str) -> dict:
    return yaml.safe_load((CONFIG_DIR / f'{name}.yaml').read_text(encoding='utf-8'))


def training_config() -> dict:
    return load_config('training_config')


def path(key: str) -> Path:
    p = ROOT / training_config()['paths'][key]
    p.mkdir(parents=True, exist_ok=True)
    return p


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    os.environ['PYTHONHASHSEED'] = str(seed)
    try:
        import torch
        torch.manual_seed(seed)
    except Exception:  # torch is optional for the classical part
        pass


def write_json(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=1, default=_json_default), encoding='utf-8')


def read_json(p: Path):
    return json.loads(p.read_text(encoding='utf-8'))


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))


def hardware() -> dict:
    import psutil
    info = {'platform': platform.platform(), 'processor': platform.processor(), 'cpu_logical_cores': os.cpu_count(),
            'ram_gb': round(psutil.virtual_memory().total / 2**30, 1), 'python': platform.python_version(), 'gpu_present': None, 'gpu_used_in_training': False}
    try:
        import subprocess
        out = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader'], capture_output=True, text=True, timeout=10)
        info['gpu_present'] = out.stdout.strip() or None
    except Exception:
        pass
    try:
        import torch
        info['torch'] = torch.__version__
        info['torch_cuda_available'] = bool(torch.cuda.is_available())
    except Exception:
        info['torch'] = None
    return info


# ----------------------------------------------------------------------------------------------------------------- memory
class PeakMemory:
    """Samples the process resident memory while a block runs; `peak_mb` is the maximum, `delta_mb` the growth over the start."""

    def __init__(self, interval: float = 0.05):
        import psutil
        self.proc, self.interval, self.peak_mb, self.delta_mb = psutil.Process(), interval, 0.0, 0.0
        self._stop = threading.Event()

    def __enter__(self):
        self.start = self.proc.memory_info().rss / 2**20
        self.peak_mb = self.start

        def loop():
            while not self._stop.is_set():
                self.peak_mb = max(self.peak_mb, self.proc.memory_info().rss / 2**20)
                time.sleep(self.interval)
        self.thread = threading.Thread(target=loop, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self.thread.join(timeout=1)
        self.peak_mb = max(self.peak_mb, self.proc.memory_info().rss / 2**20)
        self.delta_mb = self.peak_mb - self.start
        return False


@contextmanager
def timer():
    box = {}
    t0 = time.perf_counter()
    yield box
    box['seconds'] = time.perf_counter() - t0


# ---------------------------------------------------------------------------------------------------------------- latency
def benchmark_inference(predict, X, warmup: int, single_calls: int, batch_size: int) -> dict:
    """Same procedure for every model: warm-up, then `single_calls` one-sample calls (median / p95 / mean), then batch throughput.

    `predict` maps an array of samples to probabilities. Hardware is CPU for every model (see hardware())."""
    n = len(X)
    for i in range(min(warmup, n)):
        predict(X[i:i + 1])
    lat = []
    for i in range(single_calls):
        row = X[i % n:i % n + 1]
        t0 = time.perf_counter()
        predict(row)
        lat.append((time.perf_counter() - t0) * 1000)
    reps = np.resize(np.arange(n), batch_size)
    batch = X[reps]
    t0 = time.perf_counter()
    runs = 5
    for _ in range(runs):
        predict(batch)
    per_batch = (time.perf_counter() - t0) / runs
    lat = np.array(lat)
    return {'single_median_ms': float(np.median(lat)), 'single_p95_ms': float(np.percentile(lat, 95)), 'single_mean_ms': float(lat.mean()),
            'batch_size': batch_size, 'batch_ms': per_batch * 1000, 'samples_per_second': float(batch_size / per_batch)}


# ---------------------------------------------------------------------------------------------------------------- metrics
def expected_calibration_error(proba: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    conf, pred = proba.max(1), proba.argmax(1)
    hit = (pred == y).astype(float)
    edges = np.linspace(0, 1, bins + 1)
    ece = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            ece += m.mean() * abs(hit[m].mean() - conf[m].mean())
    return float(ece)


def brier(proba: np.ndarray, y: np.ndarray) -> float:
    onehot = np.eye(proba.shape[1])[y]
    return float(((proba - onehot) ** 2).sum(1).mean())


def _safe(fn):
    try:
        v = fn()
        return None if v is None or not np.isfinite(v) else float(v)
    except ValueError:
        return None


def compute_metrics(y: np.ndarray, proba: np.ndarray, classes: list[str], healthy: str | None = None, boot: int = 200, seed: int = 0) -> dict:
    """Every metric asked for in the brief. `healthy` is the class name treated as 'no stress' (None for the cause task)."""
    k = len(classes)
    pred = proba.argmax(1)
    labels = list(range(k))
    p, r, f, s = precision_recall_fscore_support(y, pred, labels=labels, zero_division=0)
    pm, rm, fm, _ = precision_recall_fscore_support(y, pred, labels=labels, average='macro', zero_division=0)
    out = {
        'n': int(len(y)), 'classes': classes, 'support': s.tolist(),
        'accuracy': float(accuracy_score(y, pred)), 'balanced_accuracy': float(balanced_accuracy_score(y, pred)),
        'precision_macro': float(pm), 'recall_macro': float(rm), 'f1_macro': float(fm),
        'f1_weighted': float(f1_score(y, pred, labels=labels, average='weighted', zero_division=0)),
        'per_class': {c: {'precision': float(p[i]), 'recall': float(r[i]), 'f1': float(f[i]), 'support': int(s[i])} for i, c in enumerate(classes)},
        'confusion_matrix': confusion_matrix(y, pred, labels=labels).tolist(),
        'ece': expected_calibration_error(proba, y), 'brier': brier(proba, y), 'mean_confidence': float(proba.max(1).mean()),
        'majority_accuracy': float(np.bincount(y, minlength=k).max() / len(y)),
    }
    if k == 2:
        out['roc_auc'] = _safe(lambda: roc_auc_score(y, proba[:, 1]))
        out['pr_auc'] = _safe(lambda: average_precision_score(y, proba[:, 1]))
    else:
        out['roc_auc'] = _safe(lambda: roc_auc_score(y, proba, multi_class='ovr', average='macro', labels=labels))
        out['pr_auc'] = _safe(lambda: np.mean([average_precision_score((y == i).astype(int), proba[:, i]) for i in labels if (y == i).any()]))
    if healthy is not None and healthy in classes:
        h = classes.index(healthy)
        stressed = y != h
        out['false_healthy_rate'] = float((pred[stressed] == h).mean()) if stressed.any() else None
        out['false_alarm_rate'] = float((pred[~stressed] != h).mean()) if (~stressed).any() else None
        out['stressed_recall'] = float((pred[stressed] != h).mean()) if stressed.any() else None
        if k == 2:
            out['false_negative_rate'] = out['false_healthy_rate']
            out['false_positive_rate'] = out['false_alarm_rate']
    # bootstrap 95% interval for the two headline metrics so "better than baseline" can be judged, not assumed
    if boot <= 0:
        return out
    rng = np.random.default_rng(seed)
    f1s, bas = [], []
    for _ in range(boot):
        i = rng.integers(0, len(y), len(y))
        f1s.append(f1_score(y[i], pred[i], labels=labels, average='macro', zero_division=0))
        bas.append(balanced_accuracy_score(y[i], pred[i]))
    out['f1_macro_ci95'] = [float(np.percentile(f1s, 2.5)), float(np.percentile(f1s, 97.5))]
    out['balanced_accuracy_ci95'] = [float(np.percentile(bas, 2.5)), float(np.percentile(bas, 97.5))]
    return out


# -------------------------------------------------------------------------------------------------------------- abstention
INSUFFICIENT = 'INSUFFICIENT_DATA_OR_LOW_CONFIDENCE'


def choose_confidence_threshold(proba: np.ndarray, y: np.ndarray, healthy_index: int | None, target_false_healthy: float, min_coverage: float):
    """Threshold on the top-class probability, chosen on VALIDATION data only.

    The largest coverage whose false-healthy rate (stressed fields answered 'Healthy' among answered stressed fields) stays
    at or below the target and whose coverage is at least `min_coverage`. Returns None when no threshold meets the safety target,
    which means the model must always abstain: it is not safe to answer."""
    conf, pred = proba.max(1), proba.argmax(1)
    best = None
    for t in np.linspace(0.30, 0.99, 70):
        ans = conf >= t
        cov = ans.mean()
        if cov < min_coverage:
            continue
        if healthy_index is None:
            ok = True
        else:
            st = ans & (y != healthy_index)
            fh = float((pred[st] == healthy_index).mean()) if st.any() else 0.0
            ok = fh <= target_false_healthy
        if ok and (best is None or cov > best['coverage']):
            best = {'threshold': float(t), 'coverage': float(cov)}
    return best
