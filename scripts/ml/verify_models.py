"""Independent re-validation of every saved model, plus a fresh inference benchmark.

  .venv/Scripts/python scripts/ml/verify_models.py   ->  .local/ml/verify/phase_models.json

What is independent here: labels and splits are rebuilt from the raw feature file and splits.json; every metric is computed again by the code in
THIS file (scikit-learn functions called directly, calibration error and Brier written separately); the classical models are reloaded from their
saved artifacts and the exact saved preprocessing pipeline; timing uses its own loop.
What is NOT independent: it is the same author, the same machine and the same single dataset, and the deep models cannot be reloaded (their artifact
holds the weights but not the scalers), so they are re-fitted with the saved settings and seed and compared.
"""
import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import psutil
from sklearn.metrics import (accuracy_score, average_precision_score, balanced_accuracy_score, confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score)

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/ml'))
RUN = ROOT / '.local/ml/runs/main'
OUT = ROOT / '.local/ml/verify'
CLASSES = {'health_binary': ['Healthy', 'Problem'], 'health_4class': ['Healthy', 'Pests', 'Diseased', 'Stressed'], 'stress_cause': ['Pests', 'Diseased', 'Stressed']}
TOL_ARTIFACT, TOL_REFIT = 1e-6, 5e-3


def load_task_arrays(task):
    z = np.load(ROOT / '.local/ml/features/telangana.npz', allow_pickle=True)
    sp = json.load(open(ROOT / '.local/ml/features/splits.json'))
    label = z['label']
    keep = np.ones(len(label), bool) if task != 'stress_cause' else label != 'Healthy'
    local = np.full(len(label), -1)
    local[keep] = np.arange(keep.sum())
    rows = lambda ix: local[np.asarray(ix)[keep[np.asarray(ix)]]]
    lab = label[keep]
    y = (lab != 'Healthy').astype(int) if task == 'health_binary' else np.array([CLASSES[task].index(x) for x in lab])
    return z['X'][keep], y, rows(sp['main']['train']), rows(sp['main']['test']), z


def ece(p, y, bins=10):
    conf, hit = p.max(1), (p.argmax(1) == y)
    idx = np.clip(np.digitize(conf, np.linspace(0, 1, bins + 1)[1:-1], right=True), 0, bins - 1)
    return float(sum((idx == b).mean() * abs(hit[idx == b].mean() - conf[idx == b].mean()) for b in range(bins) if (idx == b).any()))


def metrics(y, p, task):
    k = p.shape[1]
    pred = p.argmax(1)
    lab = list(range(k))
    m = {'accuracy': accuracy_score(y, pred), 'balanced_accuracy': balanced_accuracy_score(y, pred),
         'precision_macro': precision_score(y, pred, labels=lab, average='macro', zero_division=0), 'recall_macro': recall_score(y, pred, labels=lab, average='macro', zero_division=0),
         'f1_macro': f1_score(y, pred, labels=lab, average='macro', zero_division=0), 'f1_weighted': f1_score(y, pred, labels=lab, average='weighted', zero_division=0),
         'brier': float(((p - np.eye(k)[y]) ** 2).sum(1).mean()), 'ece': ece(p, y)}
    try:
        if k == 2:
            m['roc_auc'], m['pr_auc'] = roc_auc_score(y, p[:, 1]), average_precision_score(y, p[:, 1])
        else:
            m['roc_auc'] = roc_auc_score(y, p, multi_class='ovr', average='macro', labels=lab)
            m['pr_auc'] = float(np.mean([average_precision_score((y == i).astype(int), p[:, i]) for i in lab if (y == i).any()]))
    except ValueError:
        m['roc_auc'] = m['pr_auc'] = None
    cm = confusion_matrix(y, pred, labels=lab)
    m['confusion_matrix'] = cm.tolist()
    if task != 'stress_cause':
        sick = y != 0
        m['false_healthy_rate'] = float((pred[sick] == 0).mean()) if sick.any() else None
        if k == 2:
            m['false_negative_rate'] = m['false_healthy_rate']
            m['false_positive_rate'] = float((pred[~sick] == 1).mean())
    return m


def compare(mine, recorded):
    worst, worst_key = 0.0, None
    for key, v in mine.items():
        r = recorded.get(key)
        if key == 'confusion_matrix':
            d = float(np.abs(np.array(v) - np.array(r)).max()) if r is not None else None
        elif v is None or r is None:
            d = 0.0 if v is None and r is None else None
        else:
            d = abs(float(v) - float(r))
        if d is None:
            return 1e9, key
        if d > worst:
            worst, worst_key = d, key
    return worst, worst_key


class Peak:
    def __enter__(self):
        self.p, self.peak, self.stop = psutil.Process(), 0.0, False
        import threading
        def loop():
            while not self.stop:
                self.peak = max(self.peak, self.p.memory_info().rss / 2**20)
                time.sleep(0.02)
        self.t = threading.Thread(target=loop, daemon=True)
        self.t.start()
        return self

    def __exit__(self, *a):
        self.stop = True
        self.t.join()


def gpu_snapshot():
    import subprocess
    try:
        out = subprocess.run(['nvidia-smi', '--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=10).stdout.strip()
        u, m = [float(x) for x in out.split(',')]
        return {'gpu_util_percent': u, 'gpu_memory_used_mb': m}
    except Exception:
        return None


def benchmark(predict, n_rows, warmup=20, singles=200, batch=256):
    for i in range(warmup):
        predict(np.array([i % n_rows]))
    lat = []
    with Peak() as pk:
        for i in range(singles):
            t0 = time.perf_counter()
            predict(np.array([i % n_rows]))
            lat.append((time.perf_counter() - t0) * 1000)
        ix = np.resize(np.arange(n_rows), batch)
        t0 = time.perf_counter()
        for _ in range(5):
            predict(ix)
        per = (time.perf_counter() - t0) / 5
    lat = np.array(lat)
    return {'p50_ms': float(np.median(lat)), 'p95_ms': float(np.percentile(lat, 95)), 'mean_ms': float(lat.mean()), 'samples_per_second': float(batch / per), 'peak_ram_mb': pk.peak}


def main():
    import task_data
    import train_deep_learning_models as deep
    import train_classical_models as classical            # needed so the pickled Majority / NdviRule classes can be found
    report, cfg = {}, json.load(open(ROOT / 'reports/ml/results.json'))
    hw = {'cpu': __import__('platform').processor(), 'logical_cores': psutil.cpu_count(), 'ram_gb': round(psutil.virtual_memory().total / 2**30, 1), 'gpu_before': gpu_snapshot()}
    try:
        import torch
        hw['torch_cuda_available'] = bool(torch.cuda.is_available())
    except Exception:
        hw['torch_cuda_available'] = None
    for path in sorted(RUN.glob('*/*.json')):
        rec = json.load(open(path))
        task, model, kind = rec['task'], rec['model'], rec['kind']
        entry = {'task': task, 'model': model, 'kind': kind, 'recorded_status': rec['status']}
        if rec['status'] != 'ok':
            entry['verdict'] = 'NOT_APPLICABLE' if rec['status'] == 'not_applicable' else 'FAILED_IN_ORIGINAL_RUN'
            report[f'{task}/{model}'] = entry
            continue
        X, y, tr, te, z = load_task_arrays(task)
        prob = np.load(path.with_suffix('.proba.npz'), allow_pickle=True)
        saved_test, saved_y = prob['test'], prob['test_y']
        entry['test_rows'], entry['train_rows'], entry['features'] = int(len(te)), int(len(tr)), int(X.shape[1])
        entry['labels_match_saved_predictions'] = bool((y[te] == saved_y).all())
        # level 1: metrics recomputed from the SAVED probabilities (checks the arithmetic and the logged numbers, not the model)
        m_saved = metrics(saved_y, saved_test, task)
        worst, key = compare(m_saved, rec['test'])
        entry['metrics_recomputed_from_saved_probabilities'] = {'max_abs_difference': worst, 'worst_metric': key, 'ok': worst < 1e-9 or worst < TOL_ARTIFACT}
        predict_fn = None
        if kind == 'classical':
            art = joblib.load(ROOT / f'.local/models/main/{task}/{model}.joblib')            # level 2: the saved artifact itself
            p = np.asarray(art.predict_proba(X[te]), float)
            d = float(np.abs(p - saved_test).max())
            entry['artifact_reload'] = {'loaded': True, 'max_abs_probability_difference_vs_saved': d}
            m_art = metrics(y[te], p, task)
            w2, k2 = compare(m_art, rec['test'])
            entry['metrics_from_reloaded_artifact'] = {'max_abs_difference': w2, 'worst_metric': k2}
            entry['verdict'] = 'VERIFIED_BY_ARTIFACT' if d < TOL_ARTIFACT and w2 < TOL_ARTIFACT else 'MISMATCH'
            entry['artifact_bytes_on_disk'] = (ROOT / f'.local/models/main/{task}/{model}.joblib').stat().st_size
            predict_fn = lambda ix, art=art, X=X, te=te: art.predict_proba(X[te][ix])
        else:
            td = task_data.load_task(task)                                                  # level 2 for deep models: refit with the saved settings and seed
            t0 = time.perf_counter()
            fitted = deep.fit(td, model, rec['params'], td.train, rec['seed'])
            entry['refit_seconds'] = time.perf_counter() - t0
            p = deep.predict(fitted, td, td.test)
            d = float(np.abs(p - saved_test).max())
            m_art = metrics(td.y[td.test], p, task)
            w2, k2 = compare(m_art, rec['test'])
            entry['artifact_reload'] = {'loaded': False, 'reason': 'the .pt file stores weights only; the fitted imputer, scaler and sequence statistics were not saved, so predictions cannot be reproduced from the artifact alone'}
            entry['refit'] = {'max_abs_probability_difference_vs_saved': d, 'metrics_max_abs_difference': w2, 'worst_metric': k2}
            entry['verdict'] = 'VERIFIED_BY_REFIT' if w2 < TOL_REFIT else 'MISMATCH_AFTER_REFIT'
            entry['artifact_bytes_on_disk'] = (ROOT / f'.local/models/main/{task}/{model}.pt').stat().st_size
            predict_fn = lambda ix, f=fitted, td=td: deep.predict(f, td, td.test[ix])
        # level 3: fresh benchmark, same inputs / batch / warm-up for every model
        entry['benchmark'] = benchmark(predict_fn, len(te))
        entry['original_latency_p50_ms'] = rec['latency']['single_median_ms']
        entry['original_train_seconds_total'] = rec['train_seconds']['total']
        report[f'{task}/{model}'] = entry
        print(f"{task}/{model}: {entry['verdict']} p50 {entry['benchmark']['p50_ms']:.2f} ms (orig {entry['original_latency_p50_ms']:.2f})", flush=True)
    hw['gpu_after'] = gpu_snapshot()
    json.dump({'hardware': hw, 'models': report}, open(OUT / 'phase_models.json', 'w'), indent=1, default=lambda o: float(o) if isinstance(o, (np.floating, np.integer)) else bool(o))


if __name__ == '__main__':
    main()
