"""Run the whole CHM model comparison with one command.

  .venv/Scripts/python scripts/ml/run_all_experiments.py [--run-id main] [--force] [--tasks ...] [--skip classical deep] [--quick]

Steps: 1 audit datasets, 2 prepare data, 3 build features, 4 leakage-safe splits, 5 classical models (with Optuna), 6 deep models,
7 evaluate (sanity checks, ablation, learning curve), 8 compare + select + figures, 9 explain + abstention, 10 write the reports.

* Reproducible: seeds and every setting come from configs/ml/*.yaml. Nothing is downloaded: it reads the git-ignored .local datasets.
* Resumable: a model whose result file exists is skipped (use --force to redo). An interrupted run continues where it stopped.
* Tolerant: each step runs in its own process; a failing model is recorded and the rest continue. Only a failure in steps 1-4 stops the run,
  because nothing can be trained without data.
* Hardware: CPU. XGBoost / CatBoost could use the NVIDIA GPU and PyTorch here is a CPU build, so no GPU use is claimed.
  --quick lowers the Optuna trial counts and epochs for a smoke test; do not report its numbers.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

STEPS = [
    ('audit', 'audit_datasets.py', True), ('prepare', 'prepare_satellite_data.py', True), ('features', 'build_satellite_features.py', True),
    ('splits', 'create_data_splits.py', True), ('classical', 'train_classical_models.py', False), ('deep', 'train_deep_learning_models.py', False),
    ('evaluate', 'evaluate_models.py', False), ('compare', 'compare_models.py', False), ('explain', 'explain_predictions.py', False), ('reports', 'write_reports.py', False),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--run-id', default='main')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--tasks', nargs='*')
    ap.add_argument('--skip', nargs='*', default=[], choices=[s[0] for s in STEPS])
    ap.add_argument('--quick', action='store_true')
    a = ap.parse_args()
    cfg_path = ROOT / 'configs/ml/training_config.yaml'
    original = cfg_path.read_text(encoding='utf-8')
    if a.quick:
        cfg = yaml.safe_load(original)
        cfg['optuna'].update(trials_classical=3, trials_deep=1, timeout_seconds_per_model=30)
        cfg['deep']['max_epochs'] = 8
        cfg_path.write_text(yaml.safe_dump(cfg), encoding='utf-8')
        print('QUICK MODE: reduced tuning. These numbers are only a smoke test.')
    status, log_dir = {}, ROOT / '.local/ml/logs'
    log_dir.mkdir(parents=True, exist_ok=True)
    try:
        for name, script, critical in STEPS:
            if name in a.skip:
                status[name] = 'skipped'
                continue
            cmd = [sys.executable, str(HERE / script)]
            if name in ('classical', 'deep', 'evaluate', 'compare', 'explain', 'reports'):
                cmd += ['--run-id', a.run_id]
            if name in ('classical', 'deep'):
                cmd += (['--force'] if a.force else []) + (['--tasks', *a.tasks] if a.tasks else [])
            t0 = time.time()
            print(f'[{name}] ...', flush=True)
            with open(log_dir / f'{name}.log', 'w', encoding='utf-8') as log:
                code = subprocess.run(cmd, cwd=HERE, stdout=log, stderr=subprocess.STDOUT).returncode
            status[name] = {'exit_code': code, 'seconds': round(time.time() - t0, 1)}
            print(f"[{name}] exit {code} in {time.time() - t0:.0f}s (log: .local/ml/logs/{name}.log)", flush=True)
            if code and critical:
                print(f'Stopping: step "{name}" is required and failed. See its log.')
                return code
    finally:
        if a.quick:
            cfg_path.write_text(original, encoding='utf-8')          # never leave the quick settings behind
        (log_dir / 'pipeline_status.json').write_text(yaml.safe_dump(status), encoding='utf-8')
    failed = [k for k, v in status.items() if isinstance(v, dict) and v['exit_code']]
    print('Done.' if not failed else f'Done with failed steps: {failed}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
