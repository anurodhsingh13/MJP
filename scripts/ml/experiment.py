"""The single procedure every model goes through, so the comparison is fair.

tune on TRAIN (CV) -> fit on TRAIN -> predict validation and test -> measure latency, memory, size -> refit for the held-out
districts and seasons -> save. Results are resumable (a finished model is skipped) and a failure is recorded, never fatal.
"""
from __future__ import annotations

import traceback

import joblib
import numpy as np
from sklearn.metrics import balanced_accuracy_score, f1_score, roc_auc_score

from ml_common import (PeakMemory, benchmark_inference, compute_metrics, hardware, path, read_json, set_seed, timer, training_config, write_json)
from task_data import TASKS, load_task


def trainer_for(kind: str):
    if kind == 'classical':
        import train_classical_models as m
    else:
        import train_deep_learning_models as m
    return m


def _light(y: np.ndarray, proba: np.ndarray, td) -> dict | None:
    """Headline numbers for a held-out slice; None when the slice cannot support them."""
    if len(y) < 20 or len(set(y.tolist())) < 2:
        return None
    pred = proba.argmax(1)
    out = {'n': int(len(y)), 'f1_macro': float(f1_score(y, pred, average='macro', zero_division=0)), 'balanced_accuracy': float(balanced_accuracy_score(y, pred))}
    if proba.shape[1] == 2:
        out['roc_auc'] = float(roc_auc_score(y, proba[:, 1]))
    if td.healthy_index is not None and (y != td.healthy_index).any():
        out['false_healthy_rate'] = float((pred[y != td.healthy_index] == td.healthy_index).mean())
    return out


def result_path(run_id: str, task: str, model: str):
    return path('runs') / run_id / task / f'{model}.json'


def run_one(task: str, model: str, kind: str, run_id: str = 'main', force: bool = False) -> dict:
    out = result_path(run_id, task, model)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists() and not force:
        print(f'[skip] {task}/{model} already done', flush=True)
        return read_json(out)
    cfg = training_config()
    seed = cfg['seed']
    set_seed(seed)
    td = load_task(task)
    tr = trainer_for(kind)
    result = {'task': task, 'model': model, 'kind': kind, 'status': 'ok', 'seed': seed}
    try:
        if not tr.applicable(model, td):
            result.update(status='not_applicable', reason=tr.not_applicable_reason(model, td))
            write_json(out, result)
            return result
        with PeakMemory() as mem:
            with timer() as t_tune:
                params, cv_f1, trials, tune_seconds = tr.tune(td, model, cfg, seed)
            with timer() as t_fit:
                fitted = tr.fit(td, model, params, td.train, seed)
        proba = {s: tr.predict(fitted, td, getattr(td, s)) for s in ('train', 'val', 'test')}
        result.update(params=params, tuning={'cv_f1_macro': cv_f1, 'trials': trials, 'seconds': tune_seconds},
                      train_seconds={'tuning': t_tune['seconds'], 'final_fit': t_fit['seconds'], 'total': t_tune['seconds'] + t_fit['seconds']},
                      peak_ram_mb=mem.peak_mb, ram_growth_mb=mem.delta_mb, gpu_used=tr.gpu_used(model))
        result['train'] = compute_metrics(td.y[td.train], proba['train'], td.classes, td.healthy, boot=0)
        result['val'] = compute_metrics(td.y[td.val], proba['val'], td.classes, td.healthy)
        result['test'] = compute_metrics(td.y[td.test], proba['test'], td.classes, td.healthy)
        result['per_crop_test'] = {c: m for c in sorted(set(td.crop[td.test])) if (m := _light(td.y[td.test][td.crop[td.test] == c], proba['test'][td.crop[td.test] == c], td))}
        result['per_district_test'] = {d: m for d in sorted(set(td.district[td.test])) if (m := _light(td.y[td.test][td.district[td.test] == d], proba['test'][td.district[td.test] == d], td))}
        lat = cfg['latency']
        result['latency'] = benchmark_inference(lambda idx: tr.predict(fitted, td, idx), td.test, lat['warmup'], lat['single_calls'], lat['batch_size'])
        result['model_size_bytes'] = tr.size_bytes(fitted)
        # robustness: refit with the tuned parameters on the other districts / the other season and score the held-out one
        held = {'lodo': {}, 'season': {}}
        for d, s in td.lodo.items():
            if len(s['test']) >= 20 and len(s['train']) >= 50:
                p = tr.predict(tr.fit(td, model, params, s['train'], seed), td, s['test'])
                held['lodo'][d] = _light(td.y[s['test']], p, td)
        if cfg['heldout']['season']:
            for k, s in td.season_split.items():
                if len(s['test']) >= 20 and len(s['train']) >= 50:
                    p = tr.predict(tr.fit(td, model, params, s['train'], seed), td, s['test'])
                    held['season'][k] = _light(td.y[s['test']], p, td)
        result['heldout'] = held
        np.savez_compressed(out.with_suffix('.proba.npz'), val=proba['val'], val_y=td.y[td.val], test=proba['test'], test_y=td.y[td.test],
                            test_crop=td.crop[td.test], test_district=td.district[td.test], val_n_clear=td.n_clear[td.val], test_n_clear=td.n_clear[td.test])
        tr.save(fitted, path('models') / run_id / task / model)
        result['hardware'] = hardware()
    except Exception as exc:                      # one failing model must not stop the others
        result.update(status='failed', error=f'{type(exc).__name__}: {exc}', trace=traceback.format_exc()[-1500:])
        print(f'[FAILED] {task}/{model}: {exc}', flush=True)
    write_json(out, result)
    if result['status'] == 'ok':
        v = result['val']
        print(f"[ok] {task}/{model}: val macroF1 {v['f1_macro']:.3f} balAcc {v['balanced_accuracy']:.3f} AUC {v['roc_auc']} | train {result['train_seconds']['total']:.0f}s | "
              f"p50 {result['latency']['single_median_ms']:.2f}ms", flush=True)
    return result
