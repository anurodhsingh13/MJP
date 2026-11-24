"""Assemble the verification evidence into reports/ml/verification_results.json and docs/ml/FINAL_VERIFICATION_REPORT.md.

  .venv/Scripts/python scripts/ml/verify_report.py

Inputs (all produced by actually running things, see the commands in the report): .local/ml/verify/phase_data.json, phase_models.json, phase_fit_time.json,
phase_safety.json, test_exit_codes.txt and the test logs, plus reports/ml/results.json. Nothing is estimated: a number that has no evidence is "NOT AVAILABLE".
The score rubric is written out below so every percentage can be traced.
"""
import json
import re
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
V = ROOT / '.local/ml/verify'
TASKS = {'health_binary': 'Healthy vs Problem', 'health_4class': 'Healthy / Pests / Diseased / Stressed', 'stress_cause': 'Cause among problem fields'}
BASE = {'majority_class', 'ndvi_rule'}
na = lambda x, f='{:.3f}': 'NOT AVAILABLE' if x is None else f.format(x)

data, models, fit, safety = (json.load(open(V / f'phase_{n}.json')) for n in ('data', 'models', 'fit_time', 'safety'))
before = json.load(open(ROOT / 'reports/ml/verification_results_before_fixes.json'))
res = json.load(open(ROOT / 'reports/ml/results.json'))
hw = models['hardware']


# ------------------------------------------------------------------------------------------------------------ automated tests
def parse_tests():
    rows = []
    for line in open(V / 'test_exit_codes.txt'):
        name, code, secs, cmd = line.rstrip('\n').split('|', 3)
        log = (V / f'{name}.log').read_text(errors='ignore')
        counts = {}
        if m := re.search(r'ℹ tests (\d+)', log):
            counts = {k: int(re.search(rf'ℹ {k} (\d+)', log)[1]) for k in ('tests', 'pass', 'fail', 'skipped')}
        elif m := re.search(r'Ran (\d+) tests', log):
            counts = {'tests': int(m[1]), 'pass': int(m[1]), 'fail': 0, 'skipped': 0}
        elif m := re.search(r'(\d+) passed', log):
            counts = {'tests': int(m[1]), 'pass': int(m[1]), 'fail': 0, 'skipped': 0}
        cmd = re.sub(r'(://[^:/@\s]+:)[^@\s]+@', r'***@', cmd)           # never write a database password into a report
        rows.append({'name': name, 'exit_code': int(code), 'seconds': int(secs), 'command': cmd[:150] + ('...' if len(cmd) > 150 else ''), **counts})
    return rows


tests = parse_tests()
not_run = [{'name': 'launcher migration tests (3 tests)', 'status': 'SKIPPED BY DESIGN', 'reason': 'scripts/local.test.mjs skips them when process.platform is win32; they cannot run on this Windows machine'},
           {'name': '5 backend tests marked integration (4 existing + the new weather-scheduler test)', 'status': 'SKIPPED in the ordinary run, EXECUTED in the integration run', 'reason': 'ordinary `npm test` skips them by design; the integration_tests row above runs them against the dedicated chm_integration database: 6 of 6 pass'},
           {'name': 'Playwright UI tests (npm run test:ui)', 'status': 'NOT EXECUTED', 'reason': 'not run in this verification; they start their own dev servers and browsers'},
           {'name': 'ML prediction API tests', 'status': 'NOT APPLICABLE', 'reason': 'there is no health / stress prediction endpoint to test'}]

# ---------------------------------------------------------------------------------------------------- per-model verified table
rows = []
for key, m in models['models'].items():
    task, name = key.split('/')
    rec = res['tasks'][task]['models'].get(name, {})
    if m['recorded_status'] != 'ok':
        rows.append({'task': task, 'model': name, 'status': m['verdict']})
        continue
    r = json.load(open(ROOT / f'.local/ml/runs/main/{task}/{name}.json'))
    t = r['test']
    rows.append({'task': task, 'model': name, 'kind': m['kind'], 'status': m['verdict'], 'train_rows': m['train_rows'], 'test_rows': m['test_rows'], 'features': m['features'],
                 'accuracy': t['accuracy'], 'balanced_accuracy': t['balanced_accuracy'], 'f1_macro': t['f1_macro'], 'f1_macro_ci95': t['f1_macro_ci95'], 'recall_macro': t['recall_macro'],
                 'roc_auc': t['roc_auc'], 'pr_auc': t['pr_auc'], 'ba_ci95': t['balanced_accuracy_ci95'], 'val_balanced_accuracy': r['val']['balanced_accuracy'], 'false_healthy_rate': t.get('false_healthy_rate'), 'brier': t['brier'], 'ece': t['ece'],
                 'train_seconds_recorded': r['train_seconds']['total'], 'tuning_trials': r['tuning']['trials'], 'val_f1_macro': r['val']['f1_macro'],
                 'p50_ms_verified': m['benchmark']['p50_ms'], 'p95_ms_verified': m['benchmark']['p95_ms'], 'throughput_verified': m['benchmark']['samples_per_second'],
                 'peak_ram_mb_verified': m['benchmark']['peak_ram_mb'], 'p50_ms_original': m['original_latency_p50_ms'], 'size_bytes': m['artifact_bytes_on_disk'],
                 'heldout_balanced_accuracy': res['tasks'][task]['models'][name].get('heldout_balanced_accuracy')})
ok_rows = [r for r in rows if r.get('kind')]
real = [r for r in ok_rows if r['model'] not in BASE]
trained_models = len(ok_rows)
verified = sum(1 for r in ok_rows if r['status'].startswith('VERIFIED'))
beat_chance = sum(len(res['tasks'][t]['selection']['eligible']) for t in TASKS)

winners = {}
for t in TASKS:
    rr = [r for r in real if r['task'] == t]
    majority = next(r for r in ok_rows if r['task'] == t and r['model'] == 'majority_class')
    top_acc = max(rr, key=lambda r: r['accuracy'])
    top_f1 = max(rr, key=lambda r: r['f1_macro'])
    fastest = min(rr, key=lambda r: r['p50_ms_verified'])
    winners[t] = {
        'highest_test_accuracy': {'model': top_acc['model'], 'value': top_acc['accuracy'], 'majority_baseline_accuracy': majority['accuracy'],
                                  'note': 'equal to the always-answer-the-commonest-class baseline: no real skill' if top_acc['accuracy'] >= majority['accuracy'] - 1e-9 else 'below the baseline'},
        'highest_test_macro_f1': {'model': top_f1['model'], 'value': top_f1['f1_macro'], 'ci95': top_f1['f1_macro_ci95'], 'majority_baseline': majority['f1_macro'],
                                  'note': (f"above the majority baseline's {majority['f1_macro']:.3f}, but balanced accuracy is {top_f1['balanced_accuracy']:.3f} (95% {top_f1['ba_ci95'][0]:.3f} to {top_f1['ba_ci95'][1]:.3f}), ROC-AUC {na(top_f1['roc_auc'])}, "
                                           f"validation balanced accuracy {top_f1['val_balanced_accuracy']:.3f} and held-out {na(top_f1['heldout_balanced_accuracy'])}; "
                                           + ('it clears the pre-registered bar' if top_f1['model'] in res['tasks'][t]['selection']['eligible'] else 'it does NOT clear the pre-registered bar, so it is not a demonstrated winner'))},
        'fastest_verified': {'model': fastest['model'], 'p50_ms': fastest['p50_ms_verified']},
        'best_overall': res['tasks'][t]['selection']['best_overall'], 'most_reliable': None, 'best_production_candidate': res['tasks'][t]['selection']['production_candidate']}

# ----------------------------------------------------------------------------------------------------------------------- issues
CHANCE = {'health_binary': 0.5, 'health_4class': 0.25, 'stress_cause': 1 / 3}
above_on_test = [{'task': r['task'], 'model': r['model'], 'test_balanced_accuracy': r['balanced_accuracy'], 'ci95_lower': r['ba_ci95'][0], 'chance': CHANCE[r['task']],
                  'val_balanced_accuracy': r['val_balanced_accuracy'], 'heldout_balanced_accuracy': r['heldout_balanced_accuracy'], 'eligible': r['model'] in res['tasks'][r['task']]['selection']['eligible']}
                 for r in real if r['ba_ci95'][0] > CHANCE[r['task']]]
above_text = '; '.join(f"{x['task']}/{x['model']}: test {x['test_balanced_accuracy']:.3f}, lower bound {x['ci95_lower']:.3f}, validation {x['val_balanced_accuracy']:.3f}, held-out {na(x['heldout_balanced_accuracy'])}" for x in above_on_test)
ISSUES = [
    {'id': 'I-01', 'severity': 'HIGH', 'file': 'scripts/ml/explain_predictions.py (out_of_range); scripts/ml/ml_common.py (choose_confidence_threshold)', 'problem': 'The stress-cause model answers on invalid and low-quality inputs, and can output "Diseased". The cause task has no Healthy class, so its confidence threshold falls to the 0.30 floor and it never abstains on confidence; the out-of-range test passes inf / -999 / 1e12 because only 4 of 77 features are outside the range (5% < 20%).',
     'evidence': 'phase_safety.json: stress_cause case 5 (inf, -inf, -999, 1e12) -> "Stressed" at 0.879; case 2 (typical stressed field) -> "Diseased" at 0.717; case 7 (lowest-confidence validation row, p=0.398) -> "Diseased".', 'fix': 'Validate inputs before prediction (finite, within physical bounds, enough non-missing features); require a validated accuracy-above-baseline threshold for the cause task or do not serve it; never expose a disease label from satellite data alone.'},
    {'id': 'I-02', 'severity': 'HIGH', 'file': 'scripts/ml/train_deep_learning_models.py (save)', 'problem': 'The five deep-model artifacts are not self-contained. The .pt file holds weights only; the fitted imputer, scaler and sequence statistics are not saved, so predictions cannot be reproduced from the artifact.',
     'evidence': 'phase_models.json: all 15 deep entries have artifact_reload.loaded = false; they were verified only by re-fitting with the saved settings and seed (probability difference 0.0).', 'fix': 'Save the preprocessing objects and architecture next to the weights and add a reload test.'},
    {'id': 'I-03', 'severity': 'HIGH', 'file': 'datasets/TRAINING-DATA-REGISTER.md; data labels', 'problem': 'The target labels do not support the requested outcome. Telangana labels are season-level survey cause categories with no severity (Mild / Moderate / Severe), no dates, one year (99% sown 2023), and cannot be independently verified. All 49 models score at chance on unseen districts.',
     'evidence': 'phase_data.json (labels, 99% single year); results.json selection.eligible = [] for all 3 tasks; shuffled-label AUC 0.491 vs real 0.499.', 'fix': 'Collect dated, agronomist-confirmed severity observations; see PRODUCTION_READINESS.md.'},
    {'id': 'I-04', 'severity': 'MEDIUM', 'file': 'backend/engine/{satellite_features,crop_health_predictor,stress_risk_predictor,prediction_confidence,model_loader}.py; .local/models/{best_health_model,best_stress_risk_model,model_metadata.json}', 'problem': 'The expected backend modules, "best model" folders and model_metadata.json do not exist. Backend integration was deliberately not done (no approved model; Telangana licence is evaluation-only).',
     'evidence': 'file listing in this report; no reference to any new model in backend/ or frontend/src (grep).', 'fix': 'Create them only together with a model that clears validation and licence review.'},
    {'id': 'I-05', 'severity': 'MEDIUM', 'file': '.local/ml/runs/main/*/*.json (latency, train_seconds, peak_ram_mb)', 'problem': 'Originally recorded timings were taken while other processes were running (a large directory scan and unit tests), so they are inflated.',
     'evidence': f"Fresh benchmark vs original single-call p50: median ratio {np.median([r['p50_ms_original'] / r['p50_ms_verified'] for r in ok_rows if r['p50_ms_verified'] > 0.05]):.2f}x, maximum {max(r['p50_ms_original'] / r['p50_ms_verified'] for r in ok_rows if r['p50_ms_verified'] > 0.05):.2f}x; deep-model final-fit time 1.6-2.7x higher than the clean re-run (phase_fit_time.json).", 'fix': 'Use the verified numbers in this report; re-run the pipeline on an idle machine for the final record.'},
    {'id': 'I-06', 'severity': 'MEDIUM', 'file': 'scripts/ml/experiment.py (held-out refits)', 'problem': 'Held-out district and season scores are slightly optimistic: the hyperparameters were tuned on main-train rows that include the held-out district\'s fields, and the refit reuses them.', 'evidence': 'code path: tune() uses td.train; held-out loops call fit(..., params, s["train"]).', 'fix': 'Nested tuning inside each held-out fold. Effect is small here because every model is near chance.'},
    {'id': 'I-07', 'severity': 'MEDIUM', 'file': 'reports/ml (test split use)', 'problem': 'No genuinely independent test set exists. Test metrics were computed for every model and were visible when the report text was written and during this verification; selection never reads them (unit-tested), but the same 547 fields were reused.', 'evidence': 'splits.json has one test split; no other labelled satellite dataset is available.', 'fix': 'Evaluate once on new, dated field observations collected after the pass limit is agreed.'},
    {'id': 'I-08', 'severity': 'MEDIUM', 'file': 'scripts/ml/train_classical_models.py (NdviRule)', 'problem': 'The "ndvi_rule" baseline is a feature-based approximation of the app\'s two triggers, not a replay of shared/evidence.ts (which compares comparable pairs by tile and method).', 'evidence': 'source inspection; its test AUC 0.524 vs the earlier node replay on 750 fields (0.454).', 'fix': 'Replay the real rule through node for the baseline.'},
    {'id': 'I-09', 'severity': 'MEDIUM', 'file': 'backend/api/services/platform.integration.test.ts, satellite.integration.test.ts', 'problem': '4 integration tests were SKIPPED (need a dedicated chm_integration PostGIS database), including the durable-jobs test that covers jobs.ts, which the uncommitted weather scheduler modifies. They are not counted as passed.', 'evidence': 'backend_node_tests.log: 162 tests, 158 pass, 4 skipped.', 'fix': 'Create the integration database and run `npm run test:integration` before committing the scheduler.'},
    {'id': 'I-10', 'severity': 'MEDIUM', 'file': 'scripts/ml/build_satellite_features.py', 'problem': 'The raw bands B2, B3, B6, B7, B8A, B12 were never extracted, so NDWI and EVI (requested) cannot be computed, and there is no soil-moisture source.', 'evidence': 'scripts/telangana_ndvi_extract.py selects only B4, B5, B8, B11; feature_summary.json "not_available".', 'fix': 'Re-extract the bands for the 3,644 fields.'},
    {'id': 'I-11', 'severity': 'MEDIUM', 'file': 'docs/ml/PRODUCTION_READINESS.md:9; scripts/ml/write_reports.py', 'problem': 'A report sentence said "across all 16 models"; the task has 15 models (17 with baselines). FIXED during this verification: the count is now computed and baselines are excluded.', 'evidence': 'results.json health_binary has 17 entries, 15 non-baseline.', 'fix': 'Fixed.'},
    {'id': 'I-12', 'severity': 'LOW', 'file': 'docs/ml/REPOSITORY_AUDIT.md:40; docs/ml/TRAINING_REPORT.md:50; scripts/ml/explain_predictions.py; scripts/ml/README.md', 'problem': 'The documents said `shap` cannot load. It failed on the first import (Application Control, numba DLL) but imports now, and shap.TreeExplainer equals the native TreeSHAP exactly. FIXED.', 'evidence': 'verify_safety.py output: shap 0.51.0 loads; difference 0.0.', 'fix': 'Fixed; the claim now says what was observed.'},
    {'id': 'I-13', 'severity': 'LOW', 'file': '.local/ml/logs/classical.log', 'problem': 'The resumed run overwrote the log, so 19 of 34 classical models have no training log line (15 are logged). Their result JSON files are intact and the models were independently reproduced.', 'evidence': 'log lines found: classical 15, deep 15; mismatches vs result JSON: 0.', 'fix': 'Append to logs instead of overwriting.'},
    {'id': 'I-14', 'severity': 'LOW', 'file': '.local/models/main/**/*.joblib', 'problem': 'Artifacts are pickles: loading an untrusted file can execute code, and the two baselines need scripts/ml on the Python path to unpickle. Local files only.', 'evidence': 'joblib load worked only with scripts/ml on sys.path.', 'fix': 'Export tree models to a portable format before any serving.'},
    {'id': 'I-15', 'severity': 'LOW', 'file': 'scripts/ml/explain_predictions.py', 'problem': 'Explanations are unstable and lean on observation-quality proxies. For Healthy vs Problem the permutation ranking agrees between two seeds at only 0.45 (rank correlation) and with TreeSHAP at 0.03; the top features across tasks include clear_fraction and area_ha.', 'evidence': 'phase_safety.json explainability.', 'fix': 'Do not present these as evidence of crop condition; they describe a model at chance.'},
    {'id': 'I-16', 'severity': 'LOW', 'file': 'environment', 'problem': 'No GPU was used: PyTorch is a CPU build although an RTX 4050 is present. GPU utilisation stayed at 0% during the benchmark. Not a correctness issue.', 'evidence': f"torch_cuda_available={hw['torch_cuda_available']}; nvidia-smi utilisation {hw['gpu_before']['gpu_util_percent']}% before and {hw['gpu_after']['gpu_util_percent']}% after.", 'fix': 'Install a CUDA build only if larger models are ever justified.'},
]

# ------------------------------------------------------------------------------------------------- what was fixed, with evidence
ISSUES.append({'id': 'I-17', 'severity': 'MEDIUM', 'file': 'backend/api/services/platform.integration.test.ts', 'problem': 'The "platform persistence" integration test failed on a developer machine with GOOGLE_WEATHER_API_KEY set (as in this .env.local): the fixture mocks Open-Meteo but forecast.ts then calls Google Weather. Found while running the integration tests that were skipped before.',
               'evidence': 'integration_tests.log before the fix: 4 pass, 1 fail "Weather provider request failed" (provider: Google Weather API).', 'fix': 'The test now removes the key for its own run and restores it.'})
runs = [json.load(open(p)) for p in sorted((ROOT / '.local/ml/runs/main').glob('*/*.json')) if not p.name.endswith('.proba.npz')]
fold_notes = [v for r in runs if r['status'] == 'ok' for v in (r.get('heldout', {}).get('tuning') or {}).values()]
nested, fallback = fold_notes.count('nested'), fold_notes.count('fallback_to_main_settings')
as_shipped_all_abstain = all(c['as_shipped']['final_answer'] == 'INSUFFICIENT_DATA_OR_LOW_CONFIDENCE' for t in safety['safety'].values() for c in t['cases'].values())
gate_cases = ('3_missing_satellite_observations', '4_cloud_obscured_one_clear_observation', '5_invalid_numbers_inf_minus999_1e12', '6_out_of_distribution_x1000')
gates_hold = all(t['cases'][k]['with_permissive_threshold_0.30']['final_answer'] == 'INSUFFICIENT_DATA_OR_LOW_CONFIDENCE' for t in safety['safety'].values() for k in gate_cases)
deep_entries = [m for m in models['models'].values() if m.get('kind') == 'deep']
ratio = [r['p50_ms_original'] / r['p50_ms_verified'] for r in ok_rows if r['p50_ms_verified'] > 0.05]
rule = next(r for r in ok_rows if r['task'] == 'health_binary' and r['model'] == 'ndvi_rule')
log_headers = (ROOT / '.local/ml/logs/classical.log').read_text(errors='ignore').count('===== ')
native = sum(1 for m in models['models'].values() if m.get('portable_native_export'))
explain = json.load(open(ROOT / 'reports/ml/explain.json'))
rule_replay = json.load(open(ROOT / '.local/ml/features/app_rule_replay.json'))['summary']['all']
RESOLUTION = {
    'I-01': ('FIXED', f"New scripts/ml/prediction_safety.py: one predict_with_safety function derives every check from the row. Re-ran the 7 safety cases (verify_safety.py): as shipped all abstain ({as_shipped_all_abstain}); with a deliberately permissive 0.30 threshold the validity gates still refuse missing observations, cloud (1 clear observation), inf / -inf / -999 / 1e12 and x1000 inputs in all three tasks ({gates_hold}). The stress-cause model also no longer answers at all, because only a model that passed the pre-registered validation bar may answer. 10 new unit tests."),
    'I-02': ('FIXED', f"Deep models save .pt (weights, loadable with weights_only=True) + .json + .prep.joblib and reload with deep.load(); all {len(deep_entries)} reload and reproduce probabilities to {max(m['artifact_reload']['max_abs_probability_difference_vs_saved'] for m in deep_entries):.1e}. Unit test: save, reload, identical predictions."),
    'I-03': ('NOT FIXED', 'Cannot be fixed in code: needs dated, agronomist-confirmed severity labels.'),
    'I-04': ('NOT FIXED (deliberate)', 'No model passed validation and the Telangana licence is evaluation-only, so nothing is integrated. The safety logic now exists as prediction_safety.py for when a model qualifies.'),
    'I-05': ('FIXED', f"Whole pipeline re-run with --force on an idle machine. Recorded single-call p50 now vs the fresh verification benchmark: median ratio {np.median(ratio):.2f}, range {min(ratio):.2f} to {max(ratio):.2f} (before: median 1.57, up to 5.15)."),
    'I-06': ('FIXED', f"Held-out folds now tune on their own training rows (nested): {nested} nested searches, {fallback} fallbacks to the main settings. The budget is deliberately small (2 trials, 2-fold CV for classical; 1 trial for deep): the aim is no leakage, not a better search."),
    'I-07': ('NOT FIXED', 'No other labelled satellite dataset exists, so no genuinely independent test set can be made. The limitation remains.'),
    'I-08': ('FIXED', f"The baseline now replays the app's real alert (shared/evidence.ts + advice.ts) through scripts/evaluate-telangana-alerts.mjs on all {rule_replay['n']} fields: it flags {rule_replay['sensitivity_judged']['value']:.0%} of problem fields and {rule_replay['false_alarm_rate']['value']:.0%} of healthy fields; its test balanced accuracy is {rule['balanced_accuracy']:.3f}. The pipeline runs the replay as a step."),
    'I-09': ('FIXED', 'Created the dedicated chm_integration PostGIS database on your local server (README steps; the tests refuse any other database), ran the migrations and scripts/run-integration-tests.mjs: 6 of 6 pass, including the durable-jobs test and a new test for the weather scheduler. Fixtures are cleaned up (0 rows left). This created a database on your server; drop it with DROP DATABASE chm_integration if unwanted.'),
    'I-10': ('NOT FIXED', 'Needs hours of Earth Engine extraction for 3,644 fields; not attempted.'),
    'I-11': ('FIXED', 'Fixed earlier in this verification.'),
    'I-12': ('FIXED', 'Fixed earlier in this verification.'),
    'I-13': ('FIXED', f"run_all_experiments.py now appends to each step log with a timestamped header ({log_headers} run headers in classical.log after the re-run). The earlier lost lines are not recoverable, but every result was re-generated."),
    'I-14': ('PARTIALLY FIXED', f"The three boosted-tree libraries are also exported in their native formats (.lgb.txt / .xgb.json / .cbm) for {native} models, and deep weights load with weights_only=True. The other scikit-learn models are still pickles."),
    'I-15': ('PARTIALLY FIXED', f"explain.json now carries a reliability block per task (ranking stability and whether the model has validated skill); explanation_reliable = {[e['reliability']['explanation_reliable'] for e in explain.values()]}, each with a warning. The instability itself is a property of models at chance and cannot be fixed."),
    'I-16': ('NOT FIXED (not a defect)', 'PyTorch stays a CPU build; no GPU is used or claimed.'),
    'I-17': ('FIXED', 'The test removes GOOGLE_WEATHER_API_KEY for its own run and restores it; the integration tests pass with the key set.'),
}
for i in ISSUES:
    i['status'], i['status_evidence'] = RESOLUTION[i['id']]

# ------------------------------------------------------------------------------------------------------------ implementation
COMPONENTS = [
    ('Repository audit', 'PASS', 'docs/ml/REPOSITORY_AUDIT.md (facts checked against code: e.g. potato-leaf model is wired into the app)'),
    ('Dataset audit', 'PASS', 'scripts/ml/audit_datasets.py executed; docs/ml/DATASET_REPORT.md; numbers re-derived independently by verify_data.py'),
    ('Satellite feature extraction', 'PARTIAL', '77 features and 32-step sequences built from NDVI / NDRE / NDMI; B2, B3, B6, B7, B8A, B12, NDWI, EVI and soil moisture are unavailable (I-10)'),
    ('Data preprocessing', 'PASS', 'prepare_satellite_data.py: tile choice and clear-observation rules; independent recount 3,644 = 3,644'),
    ('Leakage-safe data splitting', 'PASS', 'verify_data.py: 0 overlapping rows or FarmIDs; held-out district never in training; spatial leakage low'),
    ('Classical ML training', 'PASS', '10 models + 2 baselines x 3 tasks executed; 34 results, artifacts reloaded and reproduced'),
    ('Deep learning training', 'PASS', '5 models x 3 tasks executed (15 results); every artifact reloads from its own files and reproduces exactly (I-02 fixed)'),
    ('Hyperparameter optimization', 'PASS', 'Optuna ran for every model (12 trials classical, 4 deep); small by design'),
    ('Model evaluation', 'PASS', '49 results; every metric recomputed independently with zero difference'),
    ('Model comparison', 'PASS', 'tables, figures and pre-registered selection; unit test that selection never reads test'),
    ('Explainability', 'PASS', 'TreeSHAP additive to 2e-15 and equal to shap.TreeExplainer; but near-chance models (I-15)'),
    ('Prediction confidence / abstention', 'PASS', 'prediction_safety.predict_with_safety: one function, every check derived from the row; 7 safety cases refused correctly; 10 unit tests (I-01 fixed). Not wired into the backend'),
    ('Model export', 'PASS', 'all 49 artifacts reload exactly (classical joblib + native tree exports; deep .pt + .json + .prep.joblib). No best_* folder or model_metadata.json exists because no model qualified (not applicable, I-04)'),
    ('Backend integration', 'NOT IMPLEMENTED', 'deliberate: no approved model, evaluation-only licence (I-04)'),
    ('Final reports', 'PASS', 'all 7 deliverables exist and parse; two wording errors found and fixed (I-11, I-12)'),
]
score_of = {'PASS': 1.0, 'PARTIAL': 0.5, 'FAIL': 0.0, 'NOT IMPLEMENTED': 0.0}
impl = np.mean([score_of[s] for _, s, _ in COMPONENTS])

n_exec = sum(t.get('tests', 0) for t in tests)
n_skip = sum(t.get('skipped', 0) for t in tests)
deep_ok = all(m['artifact_reload']['loaded'] for m in models['models'].values() if m.get('kind') == 'deep')
heldout_clean = 1.0 if fallback == 0 else nested / max(nested + fallback, 1)
timing_clean = 1.0 if (np.median(ratio) > 0.7 and np.median(ratio) < 1.4 and max(ratio) < 2.5) else 0.0
rubric = {
    'Implementation (15%)': (0.15, float(impl), 'PASS=1, PARTIAL=0.5, else 0 over 15 components'),
    'Dataset quality (15%)': (0.15, 8.0 / 12, '12 checks: unique ids, no duplicates, valid labels, no missing, no cross-split leakage, low spatial label leakage, licence recorded = 7; class imbalance handled 0.5; sample adequacy 0.5; label reliability verifiable 0; labels support the target 0; temporal coverage 0. Unchanged: these are data limits'),
    'Actual training (20%)': (0.20, (1 + 1 + timing_clean + 1 + 1 + 1 + (1.0 if deep_ok else 0.75) + 1) / 8, f'8 checks: all trained 1, per-model data documented 1, durations clean {timing_clean:g}, tuning 1, validation 1, test 1, artifacts self-contained {1.0 if deep_ok else 0.75:g}, failures documented 1'),
    'Independent validation (20%)': (0.20, (1 + 1 + 0.75 + 0 + 1 + heldout_clean + 1) / 7, f'7 checks: metrics reproduced from every artifact 1, independent metric code 1, test not used for selection 0.75 (visible to the author), external independent test set 0, held-out validation done 1, no tuning leakage in held-out {heldout_clean:g} ({nested} nested, {fallback} fallback), calibration and abstention validated 1'),
    'Performance benchmarking (10%)': (0.10, (1 + 1 + 15 / 49 + 1 + 1 + (0.75 if timing_clean else 0)) / 6, '6 checks: fresh benchmark of all 49 1, identical conditions 1, training time re-measured for 15 of 49 models (0.31), peak RAM 1, hardware recorded 1, recorded timings from an idle re-run consistent with the fresh benchmark 0.75'),
    'Backend integration (10%)': (0.10, 2 / 10, '10 checks: only existing-API compatibility and frontend build pass; model loading, versioning, endpoint, validation, schema, confidence, error handling, database are not implemented (deliberate)'),
    'Testing and documentation (10%)': (0.10, (1 + 1 + 0.85 + 0 + 1 + 1 + 1) / 7, f'7 checks: ML unit tests (21) 1, other suites 1, executed not skipped 0.85 (integration tests now run: 6 of 6; 3 launcher tests skip by design on Windows), ML API tests 0 (none exist), deliverables exist 1, numbers accurate 1 (2 errors fixed), JSON valid and consistent 1'),
}
engineering = sum(w * s for w, s, _ in rubric.values()) * 100
overall = 'PARTIAL PASS'
production = 'NOT READY'

verification = {
    'overall_status': overall, 'production_decision': production, 'engineering_completion_percent': round(engineering, 1),
    'ml_validation_and_production_readiness': {'tasks_with_an_eligible_model': f'{beat_chance} of 3', 'models_that_beat_chance_on_unseen_districts': 0, 'production_readiness_percent': 0,
                                               'test_intervals_above_chance': {'count': len(above_on_test), 'of_model_task_combinations': len(real), 'detail': above_on_test, 'note': 'about 2 of 45 are expected by chance alone at a 95% interval; none of them passes the validation / held-out bar'},
                                               'statement': 'High engineering completion does not mean the models are valid: none beats chance.'},
    'counts': {'result_files': len(rows), 'models_trained_ok': trained_models, 'not_applicable': sum(1 for r in rows if r['status'] == 'NOT_APPLICABLE'), 'failed': sum(1 for r in rows if r['status'] == 'FAILED_IN_ORIGINAL_RUN'),
               'reproduced_exactly': verified, 'passed_pre_registered_validation_bar': beat_chance, 'classical_by_artifact': sum(1 for r in ok_rows if r['status'] == 'VERIFIED_BY_ARTIFACT' and r['kind'] == 'classical'),
               'deep_by_artifact': sum(1 for r in ok_rows if r['status'] == 'VERIFIED_BY_ARTIFACT' and r['kind'] != 'classical')},
    'components': [{'component': c, 'status': s, 'evidence': e} for c, s, e in COMPONENTS],
    'score_rubric': {k: {'weight': w, 'score': round(s, 3), 'basis': b} for k, (w, s, b) in rubric.items()},
    'dataset': data, 'hardware': hw, 'tests': tests, 'tests_not_executed': not_run, 'explainability_and_safety': safety, 'fit_time_remeasured_health_binary': fit,
    'models': rows, 'winners': winners, 'issues': ISSUES,
    'missing_deliverables': [c for c in ('backend/engine/satellite_features.py', 'backend/engine/crop_health_predictor.py', 'backend/engine/stress_risk_predictor.py', 'backend/engine/prediction_confidence.py',
                                         'backend/engine/model_loader.py', '.local/models/best_health_model/', '.local/models/best_stress_risk_model/', '.local/models/model_metadata.json') if not (ROOT / c).exists()],
    'independence_limits': 'The same author built and verified this. Independence comes from separate code paths (raw CSV recounts, direct scikit-learn metric calls, artifact reloads), not from a different person, machine or dataset.',
}
(ROOT / 'reports/ml/verification_results.json').write_text(json.dumps(verification, indent=1, default=lambda o: bool(o) if isinstance(o, np.bool_) else float(o)), encoding='utf-8')


# -------------------------------------------------------------------------------------------------------------------- markdown
def table(task):
    L = ['| Model | Training status | Accuracy | Balanced Acc. | Macro F1 | Recall (macro) | ROC-AUC | Train time (s, recorded) | Inference p50 (ms, verified) | Model size (MB) |', '|---|---|---|---|---|---|---|---|---|---|']
    for r in sorted([x for x in rows if x['task'] == task], key=lambda x: -x.get('f1_macro', -1)):
        if 'kind' not in r:
            L.append(f"| {r['model']} | {r['status']} | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE |")
            continue
        tag = ' (baseline)' if r['model'] in BASE else ''
        L.append(f"| {r['model']}{tag} | {r['status']} | {r['accuracy']:.3f} | {r['balanced_accuracy']:.3f} | {r['f1_macro']:.3f} | {r['recall_macro']:.3f} | {na(r['roc_auc'])} | {r['train_seconds_recorded']:.0f} | {r['p50_ms_verified']:.2f} | {r['size_bytes'] / 2**20:.3f} |")
    return '\n'.join(L)


def md():
    d, c = data, verification['counts']
    c_now = c
    L = ['# Final verification report', '', 'Independent audit of the CHM model-training workflow. Every statement below comes from files read, commands run and models reloaded in this verification. '
         f"Limit of independence: {verification['independence_limits']}", '',
         '## A. Overall completion status', '', f"* **Overall status: {overall}.** The pipeline was implemented, executed and reproduced, but backend integration is not implemented (deliberately) and no model shows skill.",
         f"* **Production decision: {production}.**", f"* **Engineering completion: {engineering:.0f}%** (rubric in section O).",
         f"* **ML validation / production readiness: 0%.** {beat_chance} of 3 tasks have a model that clears the pre-registered bar; no model beats chance on unseen districts. A high engineering score does not make the models valid.",
         f"* One caveat stated plainly: on the test split {len(above_on_test)} of {len(real)} model-task combinations has a 95% balanced-accuracy interval above chance ({above_text}). About 2 of 45 are expected by chance alone, and it fails the validation / held-out bar, so it is not a finding.", '',
         f"Not FALSE COMPLETION: the earlier claims (49 models trained, none production ready) reproduced exactly. Two wording errors in the reports were found and fixed (I-11, I-12).", '',
         '### Before and after the fixes', '', '| | Before | After |', '|---|---|---|',
         f"| Engineering completion | {before['engineering_completion_percent']}% | {engineering:.0f}% |", f"| Models reproduced from their own saved files | {before['counts']['classical_by_artifact']} of 49 (deep models only by re-fit) | {c_now['reproduced_exactly']} of 49 |",
         f"| Issues open | {len(before['issues'])} found | {sum(1 for i in ISSUES if i['status'].startswith('FIXED'))} fixed, {sum(1 for i in ISSUES if i['status'].startswith('PARTIALLY'))} partly fixed, {sum(1 for i in ISSUES if i['status'].startswith('NOT FIXED'))} not fixed (of {len(ISSUES)}) |",
         f"| Overall status / production | {before['overall_status']} / {before['production_decision']} | {overall} / {production} |", '',
         '## B. Implementation verification', '', '| Component | Status | Evidence |', '|---|---|---|'] + [f'| {a} | {b} | {e} |' for a, b, e in COMPONENTS]
    L += ['', 'Scripts created but never executed: none of the 16 new pipeline scripts is unexecuted (`optimize_hyperparameters.py`, `experiment.py`, `task_data.py`, `ml_common.py` run as libraries). '
          'Older scripts in `scripts/ml/` (`train_timesen2crop.py`, `make_labelling_sheet.py`, PLDD-UP scripts) are outside this task and were not run here.', '',
          '## C. Actual training verification', '',
          f"* **{c['models_trained_ok']} models trained successfully**, {c['not_applicable']} not applicable (the NDVI rule exists only for Healthy vs Problem), **{c['failed']} failed**. 17 result files per task x 3 tasks = {c['result_files']} files (49 trained + 2 not applicable).",
          f"* Dataset: Telangana Crop Health, {d['feature_rows']:,} usable fields of {d['train_csv_rows']:,} labelled. Training rows: health tasks {real[0]['train_rows']:,}; cause task {next(r for r in real if r['task'] == 'stress_cause')['train_rows']:,}. Features: {real[0]['features']} (all models read the same table; the 5 sequence models read 32 steps x 4 channels plus crop/season).",
          '* Labels: Healthy vs Problem; Healthy / Pests / Diseased / Stressed; Pests / Diseased / Stressed. Hyperparameter tuning: yes, Optuna, 12 trials (classical) or 4 (deep). Validation: yes. Independent test: the single held test split (no external set exists).',
          '* Transformer: not trained (not eligible: 3,644 fields, no signal). Failed models: none.', '',
          'Per-model status, tuning trials, rows and durations are in `reports/ml/verification_results.json` (`models`).', '',
          '## D. Dataset verification (recomputed from the raw files)', '',
          f"* Train.csv rows {d['train_csv_rows']:,}; unique FarmIDs {d['unique_farm_ids']:,}; duplicate rows {d['duplicate_id_rows']}; duplicate geometries {d['duplicate_geometry_rows']}; invalid labels {d['invalid_labels']}; missing cells: {d['missing_by_column'] or 'none'}.",
          f"* Labels: {d['labels']} (Healthy {d['labels']['Healthy'] / d['train_csv_rows']:.1%}). Usable fields counted independently: **{d['independently_counted_usable_fields']}** = the {d['feature_rows']} in the feature file (ids identical: {d['feature_ids_match_independent_usable_set']}).",
          f"* Splits: {d['split_sizes']}; overlapping rows {d['split_overlap_rows']}; overlapping field ids {d['split_field_id_overlap']}; covers all rows {d['split_covers_all_rows']}; held-out district never in training {d['lodo_district_never_in_train']}.",
          f"* Spatial leakage: median distance from a test field to the nearest training field {d['spatial_distance_to_nearest_training_field']['test']['median_m']:.0f} m; {d['spatial_distance_to_nearest_training_field']['test']['share_within_250m']:.0%} within 250 m. "
          f"Labels of fields within 250 m of each other agree {d['neighbour_label_agreement_within_250m']['agreement']:.1%} against {d['neighbour_label_agreement_within_250m']['expected_if_independent']:.1%} expected by chance, so neighbouring labels are not clustered and spatial leakage of labels is negligible.",
          '* Label reliability: **cannot be verified** (survey answers, one season, no dates). Labels do **not** support severity prediction (none exist). Crop-type accuracy was not counted as health accuracy.',
          '* Licence: CC-BY-SA 4.0, evaluation only, no shipped weights (datasets/TRAINING-DATA-REGISTER.md). Weights are under `.local/models` and not committed.', '',
          '## E. Independent metric verification', '',
          f"* Labels rebuilt from the raw feature file; metrics recomputed with scikit-learn called directly and separately written Brier / calibration code (`scripts/ml/verify_models.py`).",
          f"* **{c['classical_by_artifact']} classical models**: saved artifact reloaded with its saved preprocessing pipeline; probabilities equal the saved ones to 3.3e-16 (**VERIFIED_BY_ARTIFACT**).",
          f"* **{c['deep_by_artifact']} deep models**: reloaded from their own files (.pt weights with weights_only=True, .json architecture, .prep.joblib scalers); probabilities identical (difference 0.0) (**VERIFIED_BY_ARTIFACT**). Before the fix these could only be re-fitted.",
          '* Metrics from the saved probabilities for all 49 models match the logged numbers exactly; `results.json` equals the per-run files for all 49 (0 mismatches); the deep log (15 models) and classical log (15 models) match the result files (0 mismatches).',
          '* Metrics checked: accuracy, balanced accuracy, precision, recall, macro and weighted F1, ROC-AUC, PR-AUC, confusion matrix, false-positive / false-negative / false-healthy rate, Brier, calibration error. None is UNVERIFIED.',
          '* Limitation: the test split was never used for tuning or selection (unit-tested), but it is the only test set, and its numbers were visible while the reports were written (I-07). Held-out folds now use nested tuning (I-06 fixed).', '',
          '## F. Accuracy and performance comparison (test split, verified)', '', 'Accuracy is shown because it was asked for, but 82% of fields are Healthy, so always answering Healthy scores 0.821. Use balanced accuracy and macro F1.', '']
    for t, title in TASKS.items():
        w = winners[t]
        L += [f'### {title} (`{t}`)', '', table(t), '',
              f"* Highest test accuracy: **{w['highest_test_accuracy']['model']}** {w['highest_test_accuracy']['value']:.3f}: {w['highest_test_accuracy']['note']} (baseline {w['highest_test_accuracy']['majority_baseline_accuracy']:.3f}).",
              f"* Highest test macro F1: **{w['highest_test_macro_f1']['model']}** {w['highest_test_macro_f1']['value']:.3f} (95% interval {w['highest_test_macro_f1']['ci95'][0]:.3f} to {w['highest_test_macro_f1']['ci95'][1]:.3f}); {w['highest_test_macro_f1']['note']}.",
              f"* Fastest verified (no skill): {w['fastest_verified']['model']} at {w['fastest_verified']['p50_ms']:.2f} ms.",
              f"* Best overall: {w['best_overall'] or 'none'}; most reliable: none; best production candidate: {w['best_production_candidate'] or 'none'}.", '']
    L += ['**Winners:** Best Overall Model: none. Best Crop Health Model: none. Best Stress-Risk Model: none (a weak, unproven hint for the cause task: several tree models reach 0.40 to 0.42 test balanced accuracy against 0.33 chance, but held-out districts give 0.35 and the intervals include chance). '
          'Fastest Model: the decision tree and logistic regression (about 0.2 ms per field) but with no skill. Most Reliable Model: none. Best Production Candidate: none.', '',
          '## G. Training and inference speed', '',
          f"Hardware: {hw['cpu']}, {hw['logical_cores']} logical cores, {hw['ram_gb']} GB RAM; GPU present: NVIDIA RTX 4050 (6 GB). **GPU used: no.** `torch.cuda.is_available()` = {hw['torch_cuda_available']}; GPU utilisation {hw['gpu_before']['gpu_util_percent']}% before and {hw['gpu_after']['gpu_util_percent']}% after the benchmark (memory in use {hw['gpu_before']['gpu_memory_used_mb']:.0f} to {hw['gpu_after']['gpu_memory_used_mb']:.0f} MB cannot come from these models, because PyTorch has no CUDA support here and the tree libraries ran on the CPU). Peak GPU memory for the models: NOT APPLICABLE.", '',
          'Same procedure for all 49 models: 20 warm-up calls, 200 single-sample calls, then a 256-sample batch x5; CPU; one Python process; tabular models read feature rows and sequence models read 32-step series (inputs differ by design).', '',
          '| Task | Model | p50 (ms) | p95 (ms) | Samples/s (batch 256) | Peak RAM (MB, process) | Original p50 (ms) |', '|---|---|---|---|---|---|---|']
    for r in sorted(ok_rows, key=lambda x: (x['task'], x['p50_ms_verified'])):
        if r['task'] == 'health_binary':
            L.append(f"| {r['task']} | {r['model']} | {r['p50_ms_verified']:.2f} | {r['p95_ms_verified']:.2f} | {r['throughput_verified']:.0f} | {r['peak_ram_mb_verified']:.0f} | {r['p50_ms_original']:.2f} |")
    L += ['', 'The table shows Healthy vs Problem; all three tasks are in `verification_results.json`. Random forest and extra trees are slowest (about 17 ms) because of multi-core overhead on one-row calls.', '',
          f"The pipeline was re-run with `--force` on an idle machine (I-05). Recorded single-call p50 against the fresh benchmark: median ratio {np.median(ratio):.2f}, range {min(ratio):.2f} to {max(ratio):.2f} (before the re-run: 1.57, up to 5.15). Final-fit time re-measured for the 15 Healthy-vs-Problem models: now / recorded between {min(v['final_fit_seconds_now'] / max(v['final_fit_seconds_recorded'], 1e-3) for v in fit.values()):.2f} and {max(v['final_fit_seconds_now'] / max(v['final_fit_seconds_recorded'], 1e-3) for v in fit.values()):.2f} (tuning time was not re-run; the other two tasks were NOT RE-MEASURED).", '',
          '## H. Model artifact verification', '',
          f"* {c['models_trained_ok']} artifacts exist under `.local/models/main/<task>/` (34 `.joblib`, 15 deep models as `.pt` + `.json` + `.prep.joblib`). All 49 reload and reproduce exactly; the boosted-tree models also have native exports (`.lgb.txt`, `.xgb.json`, `.cbm`).",
          '* `.local/models/best_health_model/`, `best_stress_risk_model/` and `model_metadata.json` do not exist (no model was selected). Existing models (PLDD-UP runs) were not touched.',
          '* `reports/ml/results.json` and `verification_results.json` parse as JSON; `results.json` equals the per-run files for all 49 models.', '',
          '## I. Explainability verification', '',
          '* `shap` 0.51.0 imports now and `shap.TreeExplainer` equals the native TreeSHAP exactly (difference 0.0). Native TreeSHAP contributions plus bias equal the raw model score: maximum error 2e-15 (LightGBM) and 1.4e-6 (XGBoost).',
          '* The top-5 features in `reports/ml/explain.json` are reproduced exactly for all three tasks. A missing feature is handled (the model predicts; the probability moves 0.02 to 0.05 on average).',
          '* Consistency is poor, as expected for models at chance: permutation-rank correlation between two seeds is 0.45 / 0.75 / 0.71 and with TreeSHAP 0.03 / 0.54 / 0.43 (binary / 4-class / cause). Top features include `clear_fraction` and `area_ha`, which describe observation coverage and field size, not crop condition.',
          '* Example explanations carry the note "satellite indicators that raised this class score; not a diagnosis". Feature importance is **not** evidence of disease.', '',
          '## J. Prediction safety verification', '', 'Seven input kinds go through `prediction_safety.predict_with_safety` (new): every check is derived from the feature row itself (finite values, plausible envelope, share of missing features, clear observations, distribution test) and the settings stored beside the model. '
          'Each case is run twice: **as shipped** (the validated threshold) and with a deliberately **permissive 0.30 threshold**, so the validity gates are tested even though the shipped threshold abstains on everything.', '',
          '| Case | as shipped (all 3 tasks) | permissive threshold: health_binary | health_4class | stress_cause |', '|---|---|---|---|---|']
    for case in safety['safety']['health_binary']['cases']:
        shipped = {safety['safety'][t]['cases'][case]['as_shipped']['final_answer'].replace('INSUFFICIENT_DATA_OR_LOW_CONFIDENCE', 'INSUFFICIENT') for t in safety['safety']}
        cell = lambda t: (lambda g: g['final_answer'].replace('INSUFFICIENT_DATA_OR_LOW_CONFIDENCE', 'INSUFFICIENT') + (f" ({', '.join(g['reasons'][:2])})" if g['reasons'] else ''))(safety['safety'][t]['cases'][case]['with_permissive_threshold_0.30'])
        L.append(f"| {case.replace('_', ' ')} | {', '.join(sorted(shipped))} | {cell('health_binary')} | {cell('health_4class')} | {cell('stress_cause')} |")
    L += ['', f"* **As shipped, every case in every task abstains** ({as_shipped_all_abstain}). That is correct today because no model passed the pre-registered validation bar, so none may answer; it is also why this table alone would be vacuous.",
          f"* **The validity gates hold** with the permissive threshold: missing satellite observations, a single clear observation, inf / -inf / -999 / 1e12 values and x1000 inputs are refused in all three tasks ({gates_hold}). The earlier failure (stress-cause answering \"Stressed\" at 0.88 on invalid numbers) is gone (I-01 fixed).",
          '* With the permissive threshold a normal field, a typical stressed field and the lowest-confidence row can still be answered; that is the confidence rule working as configured, not a gate failure.',
          '* Still true: nothing of this is exposed to users, because nothing is integrated.', '',
          '## K. Backend integration verification', '',
          '* **The backend does not use any newly trained model.** No reference to the new artifacts or modules exists in `backend/`, `frontend/src` or `shared/` (grep); there is no health or stress prediction route (the API and engine only have the older potato-leaf photo check, which was not part of this work and loads lazily on first use, not at startup).',
          '* Model loading at startup, versioning, prediction endpoint, input validation, output schema, confidence reporting, error handling, database integration: **NOT IMPLEMENTED** (deliberate).',
          '* **Old functionality works:** live `GET /api/health` 200, engine `/health` 200, frontend 200, `GET /api/fields` returns data; the 162-test backend suite, 41 engine tests, type check and production build all exit 0 (below). The uncommitted weather-scheduler change is separate from this ML work.', '',
          '## L. Automated test results (exact commands and exit codes)', '', '| Name | Command | Exit code | Tests | Pass | Fail | Skipped | Seconds |', '|---|---|---|---|---|---|---|---|']
    for t in tests:
        L.append(f"| {t['name']} | `{t['command']}` | {t['exit_code']} | {t.get('tests', '-')} | {t.get('pass', '-')} | {t.get('fail', '-')} | {t.get('skipped', '-')} | {t['seconds']} |")
    L += ['', 'Not counted as passed:', ''] + [f"* **{x['name']}: {x['status']}.** {x['reason']}" for x in not_run]
    L += ['', f"Totals: {n_exec} tests executed in these suites, {n_skip} skipped; type check and build have no test count. Also run in this verification (not suites): `verify_data.py`, `verify_models.py`, `verify_safety.py`.", '',
          '## M. Missing deliverables', '', '* ' + '\n* '.join(verification['missing_deliverables']),
          '* All seven required documents and `reports/ml/results.json` exist, parse and contain genuine results. (`FINAL_VERIFICATION_REPORT.md` and `verification_results.json` are this report.)', '',
          '## N. Failures and recommended fixes', '', '| ID | Severity | Status | File | Problem | Evidence | Fix / what was done |', '|---|---|---|---|---|---|---|']
    for i in sorted(ISSUES, key=lambda x: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].index(x['severity'])):
        L.append(f"| {i['id']} | {i['severity']} | **{i['status']}** | {i['file']} | {i['problem']} | {i['evidence']} | {i['status_evidence']} |")
    L += ['', 'No CRITICAL issue was found: nothing was fabricated, no result failed to reproduce, and nothing unvalidated is deployed. Missing scripts: none. Failed training runs: none. Data leakage: none found. '
          'Not fixable in code (labels, licence, independent data, raw bands): I-03, I-04, I-07, I-10.', '',
          '## O. Production readiness decision and completion score', '', f"**Production decision: {production}.** No model beats chance on unseen districts, the safety layer has gaps, deep artifacts are incomplete, nothing is integrated, and the data licence limits shipping. "
          f"**Overall status: {overall}.**", '', '| Category (weight) | Score | Basis |', '|---|---|---|']
    for k, (w, s, b) in rubric.items():
        L.append(f'| {k} | {s * 100:.0f}% | {b} |')
    L += [f"| **Engineering completion (weighted)** | **{engineering:.0f}%** | sum of weight x score |", f"| **ML validation / production readiness** | **0%** | {beat_chance} of 3 tasks with an eligible model; none beats chance |", '',
          '## Answers', '',
          f"1. **Was the complete training process successful?** The process ran end to end twice (the second time after the fixes, on an idle machine) and reproduced exactly: 49 of 49 models trained, 0 failed. It did not produce a usable model: every model is at chance.",
          f"2. **How many models were actually trained?** {c['models_trained_ok']} (10 classical + 2 baselines on 3 tasks, minus 2 not-applicable; 5 deep on 3 tasks). 15 distinct algorithms on up to 3 tasks.",
          f"3. **How many passed independent validation?** {c['reproduced_exactly']} reproduced exactly; **0** passed the validation bar (beat chance on unseen data). One (tcn, Healthy vs Problem) is nominally above chance on the test split alone (balanced accuracy {next(x['test_balanced_accuracy'] for x in above_on_test):.3f}, lower bound {next(x['ci95_lower'] for x in above_on_test):.3f}); about 2 of 45 are expected by chance, and it fails validation and held-out.",
          f"4. **Highest verified accuracy?** SVM and the majority baseline, test accuracy 0.821 (health_binary): both answer \"Healthy\" for everything. Next: " + ', '.join(f"{r['model']} {r['accuracy']:.3f} (balanced accuracy {r['balanced_accuracy']:.3f})" for r in sorted((r for r in real if r['task'] == 'health_binary' and r['accuracy'] < 0.82), key=lambda r: -r['accuracy'])[:3]) + ". Accuracy is not meaningful here: no model beats the always-Healthy answer on balanced accuracy.",
          f"5. **Best Macro F1?** {winners['health_binary']['highest_test_macro_f1']['model']} {winners['health_binary']['highest_test_macro_f1']['value']:.3f} on test (Healthy vs Problem), 95% interval {winners['health_binary']['highest_test_macro_f1']['ci95'][0]:.3f} to {winners['health_binary']['highest_test_macro_f1']['ci95'][1]:.3f}; {winners['health_binary']['highest_test_macro_f1']['note']}.",
          '6. **Fastest model?** Among real models: the decision tree and logistic regression (about 0.2 ms per field, verified). Fast, but with no skill.',
          f"7. **Actual inference speed?** Single-field p50 on this CPU, verified: {min(r['p50_ms_verified'] for r in real):.2f} to {max(r['p50_ms_verified'] for r in real):.1f} ms across the 15 algorithms (most between 0.2 and 4 ms; random forest and extra trees 17 to 28 ms). Batch throughput {min(r['throughput_verified'] for r in real):,.0f} to {max(r['throughput_verified'] for r in real):,.0f} fields per second.",
          '8. **Reliable on unseen farms and districts?** No. Held-out districts and the other season average about 0.50 balanced accuracy (chance 0.50) for the health tasks.',
          '9. **Does the backend use the newly trained model?** No.',
          f"10. **Is CHM ready for production?** The existing NDVI rule app works as before, but there is no validated satellite crop-health model: **{production}**.",
          '11. **What remains incomplete?** Backend integration (by design: no model qualifies and the licence is evaluation-only), an independent test set, severity labels, raw bands for NDWI / EVI, and the licence answer. Fixed since the first verification: the safety layer, self-contained deep artifacts, clean timings, nested held-out tuning, the real app-rule baseline, the integration tests. See sections M and N.']
    return '\n'.join(L) + '\n'


(ROOT / 'docs/ml/FINAL_VERIFICATION_REPORT.md').write_text(md(), encoding='utf-8')
print(f'engineering completion {engineering:.1f}%  status {overall}  production {production}')
print('wrote reports/ml/verification_results.json and docs/ml/FINAL_VERIFICATION_REPORT.md')
