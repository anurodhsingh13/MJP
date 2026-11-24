"""Compare every model, pick candidates by the pre-registered rules, draw the figures and assemble reports/ml/results.json.

  .venv/Scripts/python scripts/ml/compare_models.py [--run-id main]

Selection (select_models) reads VALIDATION and held-out district / season numbers plus latency and size. It never reads the test
split. Test numbers are reported next to it afterwards. Baselines are shown but never selected.
"""
from __future__ import annotations

import argparse
import math

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import precision_recall_curve, roc_curve

from evaluate_models import collect
from ml_common import hardware, path, read_json, training_config, write_json
from task_data import TASKS

BASELINES = {'majority_class', 'ndvi_rule'}


def chance(task: str) -> float:
    return 1 / len(TASKS[task]['classes'])


def heldout_balanced_accuracy(r: dict) -> float | None:
    vals = [m['balanced_accuracy'] for kind in ('lodo', 'season') for m in (r.get('heldout', {}).get(kind) or {}).values() if m]
    return float(np.mean(vals)) if vals else None


def stressed_recall(v: dict) -> float:
    return v['stressed_recall'] if v.get('stressed_recall') is not None else v['recall_macro']


def select_models(results: list[dict], task: str, cfg: dict) -> dict:
    """Pre-registered selection. Only keys 'val', 'heldout', 'latency' and 'model_size_bytes' are read: never 'test'."""
    sel, c = cfg['selection'], chance(task)
    rows = [r for r in results if r['task'] == task and r['status'] == 'ok' and r['model'] not in BASELINES]
    if not rows:
        return {'eligible': [], 'best_overall': None, 'best_attempt': None, 'fastest_reliable': None, 'production_candidate': None, 'scores': {}}
    info = {}
    for r in rows:
        v, held = r['val'], heldout_balanced_accuracy(r)
        info[r['model']] = {
            'val_f1_macro': v['f1_macro'], 'val_balanced_accuracy': v['balanced_accuracy'], 'val_balanced_accuracy_ci95': v['balanced_accuracy_ci95'],
            'stressed_recall': stressed_recall(v), 'false_healthy_rate': v.get('false_healthy_rate') or 0.0, 'heldout_balanced_accuracy': held,
            'ece': v['ece'], 'p50_ms': r['latency']['single_median_ms'], 'size_mb': r['model_size_bytes'] / 2**20,
            'eligible': bool(v['balanced_accuracy_ci95'][0] > c and held is not None and held >= c + sel['eligible_if']['mean_heldout_balanced_accuracy_margin_over_chance'])}

    def norm(key, invert=False, log=False):
        vals = {m: (math.log(max(i[key], 1e-6)) if log else (i[key] if i[key] is not None else 0.0)) for m, i in info.items()}
        lo, hi = min(vals.values()), max(vals.values())
        return {m: 0.5 if hi == lo else ((hi - x) / (hi - lo) if invert else (x - lo) / (hi - lo)) for m, x in vals.items()}
    w = sel['weights']
    parts = {'val_f1_macro': norm('val_f1_macro'), 'val_balanced_accuracy': norm('val_balanced_accuracy'), 'stressed_recall': norm('stressed_recall'),
             'low_false_healthy_rate': norm('false_healthy_rate', invert=True), 'heldout_generalisation': norm('heldout_balanced_accuracy'),
             'low_calibration_error': norm('ece', invert=True), 'inference_speed': norm('p50_ms', invert=True, log=True), 'small_model_size': norm('size_mb', invert=True, log=True)}
    for m in info:
        info[m]['composite'] = float(sum(w[k] * parts[k][m] for k in w))
    eligible = [m for m, i in info.items() if i['eligible']]
    attempt = max(info, key=lambda m: info[m]['composite'])
    best = max(eligible, key=lambda m: info[m]['composite']) if eligible else None
    fastest = min(eligible, key=lambda m: info[m]['p50_ms']) if eligible else None
    lim = sel['deployable_limits']
    deploy = [m for m in eligible if info[m]['p50_ms'] <= lim['single_call_p50_ms'] and info[m]['size_mb'] <= lim['model_size_mb']]
    prod = max(deploy, key=lambda m: info[m]['composite']) if deploy else None
    return {'chance': c, 'eligible': eligible, 'best_overall': best, 'best_attempt': attempt, 'fastest_reliable': fastest,
            'production_candidate': prod, 'scores': info}


# ------------------------------------------------------------------------------------------------------------------ figures
def fig_dir():
    d = path('reports') / 'figures'
    d.mkdir(parents=True, exist_ok=True)
    return d


def _proba(run_id: str, task: str, model: str):
    return np.load(path('runs') / run_id / task / f'{model}.proba.npz', allow_pickle=True)


def draw_task(run_id: str, task: str, results: list[dict], selection: dict) -> list[str]:
    ok = {r['model']: r for r in results if r['task'] == task and r['status'] == 'ok'}
    if not ok:
        return []
    out, c, classes = [], chance(task), TASKS[task]['classes']
    d = fig_dir()
    names = sorted(ok, key=lambda m: -ok[m]['val']['f1_macro'])
    # 1. macro-F1 and balanced accuracy, validation vs test, with chance
    fig, ax = plt.subplots(1, 2, figsize=(13, 0.34 * len(names) + 1.8), sharey=True)
    for a, key, title in ((ax[0], 'f1_macro', 'Macro F1'), (ax[1], 'balanced_accuracy', 'Balanced accuracy')):
        y = np.arange(len(names))
        a.barh(y - 0.2, [ok[m]['val'][key] for m in names], 0.4, label='validation')
        a.barh(y + 0.2, [ok[m]['test'][key] for m in names], 0.4, label='test')
        if key == 'balanced_accuracy':
            a.axvline(c, color='k', ls='--', lw=1, label=f'chance {c:.2f}')
        a.set_title(f'{task}: {title}')
        a.set_yticks(y, names)
        a.invert_yaxis()
        a.legend(loc='lower right')
    fig.tight_layout()
    p = d / f'comparison_{task}.png'
    fig.savefig(p, dpi=110)
    plt.close(fig)
    out.append(p.name)
    # 2. confusion matrix, ROC, PR and calibration for the strongest attempt (test split, shown after selection)
    best = selection.get('best_attempt')
    if best:
        z = _proba(run_id, task, best)
        yt, pt = z['test_y'], z['test']
        cm = np.array(ok[best]['test']['confusion_matrix'])
        fig, a = plt.subplots(figsize=(4.8, 4.2))
        a.imshow(cm / cm.sum(1, keepdims=True), cmap='Blues', vmin=0, vmax=1)
        for i in range(cm.shape[0]):
            for j in range(cm.shape[1]):
                a.text(j, i, cm[i, j], ha='center', va='center')
        a.set_xticks(range(len(classes)), classes, rotation=30)
        a.set_yticks(range(len(classes)), classes)
        a.set_xlabel('predicted')
        a.set_ylabel('true')
        a.set_title(f'{task}: {best} (test, row-normalised colour)')
        fig.tight_layout()
        p = d / f'confusion_{task}.png'
        fig.savefig(p, dpi=110)
        plt.close(fig)
        out.append(p.name)
        top = names[:5] if 'majority_class' in names[:5] else names[:5]
        for kind in ('roc', 'pr'):
            fig, a = plt.subplots(figsize=(5.2, 4.4))
            for m in top:
                zz = _proba(run_id, task, m)
                y, pr = zz['test_y'], zz['test']
                if len(classes) == 2:
                    xs, ys, _t = (roc_curve(y, pr[:, 1]) if kind == 'roc' else precision_recall_curve(y, pr[:, 1]))
                    if kind == 'pr':
                        xs, ys = ys, xs
                    a.plot(xs, ys, label=m)
                else:                                       # multi-class: macro of one-vs-rest is shown for the strongest model only
                    if m != best:
                        continue
                    for i, cname in enumerate(classes):
                        if (y == i).any():
                            xs, ys, _t = (roc_curve((y == i).astype(int), pr[:, i]) if kind == 'roc' else precision_recall_curve((y == i).astype(int), pr[:, i]))
                            if kind == 'pr':
                                xs, ys = ys, xs
                            a.plot(xs, ys, label=f'{m}: {cname}')
            if kind == 'roc':
                a.plot([0, 1], [0, 1], 'k--', lw=1)
                a.set_xlabel('false positive rate')
                a.set_ylabel('true positive rate')
            else:
                a.set_xlabel('recall')
                a.set_ylabel('precision')
            a.set_title(f'{task}: {kind.upper()} (test)')
            a.legend(fontsize=7)
            fig.tight_layout()
            p = d / f'{kind}_{task}.png'
            fig.savefig(p, dpi=110)
            plt.close(fig)
            out.append(p.name)
        # calibration (reliability) of the top-label confidence
        conf, hit = pt.max(1), (pt.argmax(1) == yt)
        edges = np.linspace(0, 1, 11)
        xs, ys = [], []
        for lo, hi in zip(edges[:-1], edges[1:]):
            m = (conf > lo) & (conf <= hi)
            if m.sum() >= 5:
                xs.append(conf[m].mean())
                ys.append(hit[m].mean())
        fig, a = plt.subplots(figsize=(4.6, 4.2))
        a.plot([0, 1], [0, 1], 'k--', lw=1)
        a.plot(xs, ys, 'o-')
        a.set_xlabel('confidence')
        a.set_ylabel('accuracy')
        a.set_title(f'{task}: calibration, {best} (ECE {ok[best]["test"]["ece"]:.3f})')
        fig.tight_layout()
        p = d / f'calibration_{task}.png'
        fig.savefig(p, dpi=110)
        plt.close(fig)
        out.append(p.name)
        # per-class recall (test), district-wise and season-wise held-out balanced accuracy
        fig, ax = plt.subplots(1, 3, figsize=(15, 3.8))
        pc = ok[best]['test']['per_class']
        ax[0].bar(classes, [pc[k]['recall'] for k in classes])
        ax[0].set_title(f'per-class recall, {best} (test)')
        ax[0].axhline(c, color='k', ls='--', lw=1)
        for a, kind, title in ((ax[1], 'lodo', 'held-out district balanced accuracy'), (ax[2], 'season', 'held-out season balanced accuracy')):
            keys = sorted({k for m in top for k in (ok[m].get('heldout', {}).get(kind) or {})})
            w = 0.8 / max(len(top), 1)
            for i, m in enumerate(top):
                a.bar(np.arange(len(keys)) + i * w, [((ok[m].get('heldout', {}).get(kind) or {}).get(k) or {}).get('balanced_accuracy', 0) for k in keys], w, label=m)
            a.axhline(c, color='k', ls='--', lw=1)
            a.set_xticks(np.arange(len(keys)) + 0.4, keys, rotation=20)
            a.set_title(title)
        ax[1].legend(fontsize=6)
        fig.tight_layout()
        p = d / f'generalisation_{task}.png'
        fig.savefig(p, dpi=110)
        plt.close(fig)
        out.append(p.name)
    return out


def draw_learning_curve() -> list[str]:
    f = path('reports') / 'sanity_checks.json'
    if not f.exists():
        return []
    lc = read_json(f).get('learning_curve_lightgbm_health_binary')
    if not lc:
        return []
    xs = [v['train_rows'] for v in lc.values()]
    fig, a = plt.subplots(figsize=(5.2, 4))
    a.plot(xs, [v['train_balanced_accuracy'] for v in lc.values()], 'o-', label='train balanced accuracy')
    a.plot(xs, [v['val_balanced_accuracy'] for v in lc.values()], 's-', label='validation balanced accuracy')
    a.axhline(0.5, color='k', ls='--', lw=1)
    a.set_xlabel('training rows')
    a.set_title('Learning curve (LightGBM, Healthy vs Problem)')
    a.legend()
    fig.tight_layout()
    p = fig_dir() / 'learning_curve.png'
    fig.savefig(p, dpi=110)
    plt.close(fig)
    return [p.name]


# -------------------------------------------------------------------------------------------------------------------- tables
def summary_row(r: dict) -> dict:
    t, v = r['test'], r['val']
    return {'model': r['model'], 'kind': r['kind'],
            'val_f1_macro': v['f1_macro'], 'val_balanced_accuracy': v['balanced_accuracy'],
            'test_accuracy': t['accuracy'], 'test_balanced_accuracy': t['balanced_accuracy'], 'test_f1_macro': t['f1_macro'], 'test_f1_macro_ci95': t['f1_macro_ci95'],
            'test_recall_macro': t['recall_macro'], 'test_roc_auc': t['roc_auc'], 'test_pr_auc': t['pr_auc'], 'test_false_healthy_rate': t.get('false_healthy_rate'),
            'test_ece': t['ece'], 'test_brier': t['brier'], 'heldout_balanced_accuracy': heldout_balanced_accuracy(r),
            'train_seconds': r['train_seconds']['total'], 'tuning_trials': r['tuning']['trials'], 'peak_ram_mb': r['peak_ram_mb'],
            'latency_p50_ms': r['latency']['single_median_ms'], 'latency_p95_ms': r['latency']['single_p95_ms'], 'throughput_per_s': r['latency']['samples_per_second'],
            'model_size_mb': r['model_size_bytes'] / 2**20, 'gpu_used': r['gpu_used'], 'params': r['params']}


def fmt(x, d=3):
    return '-' if x is None else (f'{x:.{d}f}' if isinstance(x, float) else str(x))


def markdown_table(task: str, results: list[dict], selection: dict) -> str:
    rows = sorted([summary_row(r) for r in results if r['task'] == task and r['status'] == 'ok'], key=lambda s: -s['val_f1_macro'])
    head = '| Model | Val Macro F1 | Val Bal. Acc | Test Accuracy | Test Bal. Acc | Test Macro F1 (95% CI) | Test Recall (macro) | Test ROC-AUC | Held-out Bal. Acc | Train time (s) | Inference p50 (ms) | Model size (MB) |\n|' + '---|' * 12
    lines = [head]
    for s in rows:
        tag = ' (baseline)' if s['model'] in BASELINES else (' **eligible**' if s['model'] in selection.get('eligible', []) else '')
        ci = s['test_f1_macro_ci95']
        lines.append(f"| {s['model']}{tag} | {fmt(s['val_f1_macro'])} | {fmt(s['val_balanced_accuracy'])} | {fmt(s['test_accuracy'])} | {fmt(s['test_balanced_accuracy'])} | "
                     f"{fmt(s['test_f1_macro'])} ({ci[0]:.3f}-{ci[1]:.3f}) | {fmt(s['test_recall_macro'])} | {fmt(s['test_roc_auc'])} | {fmt(s['heldout_balanced_accuracy'])} | "
                     f"{s['train_seconds']:.0f} | {s['latency_p50_ms']:.2f} | {s['model_size_mb']:.2f} |")
    return '\n'.join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--run-id', default='main')
    a = ap.parse_args()
    cfg = training_config()
    results = collect(a.run_id)
    selection, figures = {}, []
    for task in TASKS:
        selection[task] = select_models(results, task, cfg)
        figures += draw_task(a.run_id, task, results, selection[task])
    figures += draw_learning_curve()
    summary = {
        'run_id': a.run_id, 'hardware': hardware(), 'config': cfg,
        'data': read_json(path('reports') / 'prepared_data_summary.json') if (path('reports') / 'prepared_data_summary.json').exists() else None,
        'splits': read_json(path('reports') / 'splits_summary.json') if (path('reports') / 'splits_summary.json').exists() else None,
        'sanity_checks': read_json(path('reports') / 'sanity_checks.json') if (path('reports') / 'sanity_checks.json').exists() else None,
        'tasks': {t: {'models': {r['model']: (summary_row(r) if r['status'] == 'ok' else {'status': r['status'], 'reason': r.get('error') or r.get('reason')})
                                 for r in results if r['task'] == t},
                      'selection': selection[t]} for t in TASKS},
        'failed_or_skipped': [{'task': r['task'], 'model': r['model'], 'status': r['status'], 'detail': r.get('error') or r.get('reason')} for r in results if r['status'] != 'ok'],
        'skipped_by_design': read_json_cfg(),
        'figures': figures,
    }
    summary['tables_markdown'] = {t: markdown_table(t, results, selection[t]) for t in TASKS}
    write_json(path('reports') / 'results.json', summary)
    for t in TASKS:
        s = selection[t]
        print(f"{t}: eligible={s['eligible']} best_overall={s['best_overall']} best_attempt={s['best_attempt']} fastest_reliable={s['fastest_reliable']} production_candidate={s['production_candidate']}")


def read_json_cfg():
    from ml_common import load_config
    return load_config('model_config')['skipped']


if __name__ == '__main__':
    main()
