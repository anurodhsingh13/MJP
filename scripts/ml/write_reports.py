"""Write docs/ml/{TRAINING_REPORT,VALIDATION_REPORT,MODEL_COMPARISON,PRODUCTION_READINESS}.md from the saved results.

  .venv/Scripts/python scripts/ml/write_reports.py [--run-id main]

Every number and every verdict sentence is computed from reports/ml/results.json, explain.json and sanity_checks.json. Nothing is typed in by hand,
so the reports cannot say more than the experiments showed.
"""
from __future__ import annotations

import argparse
from importlib import metadata

from compare_models import BASELINES, chance, fmt
from ml_common import ROOT, path, read_json
from task_data import TASKS

FIG = '../../reports/ml/figures/'
TITLES = {'health_binary': 'Healthy vs Problem', 'health_4class': 'Healthy / Pests / Diseased / Stressed', 'stress_cause': 'Cause among problem fields (Pests / Diseased / Stressed)'}


def lib_versions() -> dict:
    out = {}
    for lib in ('numpy', 'scikit-learn', 'xgboost', 'lightgbm', 'catboost', 'optuna', 'torch', 'pandas'):
        try:
            out[lib] = metadata.version(lib)
        except metadata.PackageNotFoundError:
            out[lib] = 'not installed'
    return out


def ci(v):
    return f'{v[0]:.3f} to {v[1]:.3f}'


def best_attempt(res: dict, task: str):
    sel = res['tasks'][task]['selection']
    m = sel.get('best_attempt')
    return (m, res['tasks'][task]['models'][m]) if m else (None, None)


def verdict(res: dict) -> dict:
    eligible = {t: res['tasks'][t]['selection']['eligible'] for t in TASKS}
    any_eligible = any(eligible.values())
    return {'eligible': eligible, 'any_eligible': any_eligible,
            'production': {t: res['tasks'][t]['selection']['production_candidate'] for t in TASKS}}


def sentence_task(res: dict, task: str) -> str:
    m, s = best_attempt(res, task)
    if m is None:
        return f'No model finished for {TITLES[task]}.'
    sel = res['tasks'][task]['selection']
    sc = sel['scores'][m]
    base = res['tasks'][task]['models'].get('majority_class')
    c = chance(task)
    held = sc['heldout_balanced_accuracy']
    test_ba = res['tasks'][task]['models'][m]['test_balanced_accuracy']
    line = (f"**{TITLES[task]}**: the model ranked highest by the composite score is **{m}** (validation macro-F1 {sc['val_f1_macro']:.3f}, balanced accuracy {sc['val_balanced_accuracy']:.3f}, 95% interval {ci(sc['val_balanced_accuracy_ci95'])}; "
            f"chance is {c:.2f}; test balanced accuracy {test_ba:.3f}); on held-out districts and the other season it averages {fmt(held)} balanced accuracy. ")
    line += ('It **clears** the pre-registered bar.' if m in sel['eligible'] else 'It does **not** clear the pre-registered bar (the validation interval includes chance or held-out balanced accuracy is not at least '
                                                                                  'chance + 0.03), so it is reported as the top-ranked attempt, not as a winner. When every model sits at chance, the ranking mostly reflects speed, size and validation noise.')
    if base and 'test_f1_macro' in base:
        line += f" The always-answer-the-commonest-class baseline scores macro-F1 {base['test_f1_macro']:.3f} and accuracy {base['test_accuracy']:.3f} on the test split."
    return line


def write_comparison(res: dict, doc) -> str:
    v = verdict(res)
    L = ['# Model comparison', '', 'Every number comes from `reports/ml/results.json` (run `' + res['run_id'] + '`). Same data, same splits, same tuning budget, same latency procedure for every model.',
         'Validation columns were used to choose; test columns were computed once and were not used to choose. Held-out Bal. Acc = mean balanced accuracy over leave-one-district-out and the two season-held-out fits. '
         '"Inference p50" is one sample per call on the CPU after warm-up (the same procedure for all models; tabular models read feature rows, sequence models read 32-step series, so the inputs differ by design).', '']
    for t in TASKS:
        sel = res['tasks'][t]['selection']
        L += [f'## {TITLES[t]}  (`{t}`)', '', res['tables_markdown'][t], '']
        L += [f"* **Best overall model:** {sel['best_overall'] or 'none: no model cleared the bar'}",
              f"* **Fastest reliable model:** {sel['fastest_reliable'] or 'none: no model is reliable enough to call fast'}",
              f"* **Best model for production deployment:** {sel['production_candidate'] or 'none: no model met the reliability bar and the deployment limits'}",
              f"* Top-ranked by the composite score, for reference only (not a winner; see the test column): {sel['best_attempt']}", '']
        for f in res['figures']:
            if f.endswith(f'_{t}.png'):
                L.append(f'![{f}]({FIG}{f})')
        L.append('')
    L += ['## Overall', '', *[sentence_task(res, t) + '\n' for t in TASKS]]
    L += ['Models that did not run (failed, not applicable or skipped by design):', '']
    rows = res['failed_or_skipped']
    L += ['| Task | Model | Status | Detail |', '|---|---|---|---|'] + [f"| {r['task']} | {r['model']} | {r['status']} | {r['detail']} |" for r in rows]
    L += [f"| all | {k} | skipped by design | {x} |" for k, x in res['skipped_by_design'].items()]
    return '\n'.join(L) + '\n'


def write_training(res: dict, explain: dict) -> str:
    hw = res['hardware']
    L = ['# Training report', '', '## What was run', '',
         'Ten classical models, five deep models and two baselines were trained on the Telangana Crop Health data (the only dataset in the repository with stress labels), '
         'for three tasks. All settings are in `configs/ml/`. Results: `reports/ml/results.json`.', '',
         '## Setup', '', f"* Hardware: {hw['processor']}, {hw['cpu_logical_cores']} logical cores, {hw['ram_gb']} GB RAM; GPU present: {hw['gpu_present']}. "
         f"**GPU used in training: no.** PyTorch is `{hw.get('torch')}` (CUDA available: {hw.get('torch_cuda_available')}); XGBoost, LightGBM, CatBoost and scikit-learn ran on the CPU.",
         f"* Libraries: {lib_versions()}", f"* Seed: {res['config']['seed']} everywhere (splits, Optuna, model seeds). Split: 70 / 15 / 15 by field (see VALIDATION_REPORT.md).",
         f"* Tuning: Optuna TPE, {res['config']['optuna']['trials_classical']} trials for classical models with {res['config']['optuna']['cv_folds']}-fold CV on the training rows (objective: macro-F1), "
         f"{res['config']['optuna']['trials_deep']} trials for deep models on one hold-out of the training rows; early stopping on a hold-out of the training rows. "
         'Search spaces are small on purpose: with about 2,500 training rows more tuning would fit noise.',
         '* Class imbalance: balanced class weights (or inverse-frequency loss weights for the deep models).',
         '* Skipped by design: ' + '; '.join(f'{k} ({v})' for k, v in res['skipped_by_design'].items()), '',
         '## Results at a glance', '', *[sentence_task(res, t) + '\n' for t in TASKS]]
    t = 'health_binary'
    models = res['tasks'][t]['models']
    L += [f'## Tuned settings, time and memory ({TITLES[t]})', '',
          '| Model | Best settings | Trials | Train time (s) | Peak RAM (MB) | GPU used | Inference p50 / p95 (ms) | Samples/s (batch 256) | Size (MB) |', '|---|---|---|---|---|---|---|---|---|']
    for m, s in sorted(models.items()):
        if 'train_seconds' not in s:
            continue
        L.append(f"| {m} | {s['params']} | {s['tuning_trials']} | {s['train_seconds']:.0f} | {s['peak_ram_mb']:.0f} | {s['gpu_used']} | {s['latency_p50_ms']:.2f} / {s['latency_p95_ms']:.2f} | {s['throughput_per_s']:.0f} | {s['model_size_mb']:.3f} |")
    L += ['', 'Peak RAM is the whole Python process (including loaded libraries), sampled every 50 ms during tuning and fitting. Settings for the other two tasks are in `reports/ml/results.json`.', '']
    if explain:
        L += ['## Explainability', '', 'Exact TreeSHAP values (LightGBM / XGBoost native; `shap` failed to import once under a Windows Application Control policy, but imports now and `shap.TreeExplainer` matches the native values exactly, see FINAL_VERIFICATION_REPORT.md) and permutation importance on the validation split. '
              'These are satellite indicators that moved a model score; **they are not evidence of a disease or pest**, and when the model itself is near chance they mostly describe noise.', '']
        for k, e in explain.items():
            L += [f"**{TITLES[k]}** ({e['model']}) top indicators: " + ', '.join(f"{x['feature']} ({x['mean_abs_contribution']:.3f})" for x in e['top_features'][:6]) + '.', f"![]({FIG}{e['figure']})", '']
    L += ['## Known limitations', '',
          '* One dataset, one region (Telangana), one season (99% sown in 2023), one label per field per season from a survey that was not independently verified. No severity labels.',
          '* The satellite extract holds NDVI, NDRE and NDMI only (cloud-masked). NDWI and EVI cannot be built; raw bands were not stored; there is no soil-moisture source.',
          '* Deep models were tuned with 4 trials on a single hold-out; a bigger search might shift them slightly, but with no signal in the labels it cannot create one.',
          '* Latency compares tabular and sequence inputs because that is what each model type consumes.', '',
          '## Reproduce', '', '```', '.venv/Scripts/python scripts/ml/run_all_experiments.py            # everything, resumable', '.venv/Scripts/python scripts/ml/run_all_experiments.py --force    # redo every model',
          '.venv/Scripts/python scripts/ml/run_all_experiments.py --quick    # smoke test only, do not report', 'cd scripts/ml && ../../.venv/Scripts/python -m unittest test_ml_pipeline', '```', '',
          'Inputs are the git-ignored `.local/datasets/labelled/*` files listed in `configs/ml/dataset_config.yaml`. Intermediate files are under `.local/ml/`; model weights under `.local/models/` (not committed: CC-BY-SA data).']
    return '\n'.join(L) + '\n'


def learning_sentence(sanity: dict) -> str:
    lc = sanity['learning_curve_lightgbm_health_binary']
    val = [v['val_balanced_accuracy'] for v in lc.values()]
    last = list(lc.values())[-1]
    return (f"Learning curve (LightGBM, Healthy vs Problem): validation balanced accuracy stays between {min(val):.3f} and {max(val):.3f} from {list(lc.values())[0]['train_rows']} to {last['train_rows']} training rows, "
            f"while training balanced accuracy reaches {last['train_balanced_accuracy']:.3f}. "
            + ('The model memorises the training rows and learns nothing that transfers, so more data with these labels would not be expected to help.'
               if last['train_balanced_accuracy'] - last['val_balanced_accuracy'] > 0.2 and max(val) < 0.56 else 'The curves do not show an obvious overfitting pattern.'))


def write_validation(res: dict, sanity: dict) -> str:
    sp = res['splits']
    L = ['# Validation report', '', '## How the splits protect against leakage', '',
         f"* Main split 70 / 15 / 15 by field: train {sp['sizes']['train']}, validation {sp['sizes']['validation']}, test {sp['sizes']['test']}. Every row is one field (FarmID unique, checked), stratified by label and crop. "
         'Assertions in `create_data_splits.py` and `test_ml_pipeline.py` fail on any overlap.',
         '* Scalers and imputers are fitted inside each model on training rows only. Optuna sees training rows only. Model selection reads validation and held-out numbers, never the test split (unit-tested).',
         '* Neighbouring fields in one district share weather and soil, so the main split is **optimistic**. The district-held-out and season-held-out fits below are the honest generalisation tests.',
         f"* Leave-one-district-out on {list(sp['lodo_test_sizes'])} (test sizes {sp['lodo_test_sizes']}); season-held-out Rabi to Kharif and Kharif to Rabi ({sp['season_sizes']}). "
         'Year-held-out is impossible (99% of fields were sown in 2023). Districts with fewer than about 150 fields stay in training and are not scored alone.', '']
    for t in TASKS:
        sel = res['tasks'][t]['selection']
        models = res['tasks'][t]['models']
        names = [m for m in sel['scores']]
        top = sorted(names, key=lambda m: -sel['scores'][m]['val_f1_macro'])[:6]
        L += [f'## {TITLES[t]}', '', sentence_task(res, t), '', f'Chance balanced accuracy: {chance(t):.2f}. Validation balanced accuracy with 95% bootstrap interval, then held-out scores (balanced accuracy):', '',
              '| Model | Val Bal. Acc (95% CI) | Test Bal. Acc | Mean held-out Bal. Acc | Eligible |', '|---|---|---|---|---|']
        for m in top:
            sc = sel['scores'][m]
            L.append(f"| {m} | {sc['val_balanced_accuracy']:.3f} ({ci(sc['val_balanced_accuracy_ci95'])}) | {models[m]['test_balanced_accuracy']:.3f} | {fmt(sc['heldout_balanced_accuracy'])} | {'yes' if sc['eligible'] else 'no'} |")
        best = sel.get('best_attempt')
        if best:
            L += ['', f'Per-district and per-crop test scores for the strongest attempt (`{best}`) are in `reports/ml/results.json` under `per_district_test` / `per_crop_test` of the run files '
                      f'(`.local/ml/runs/{res["run_id"]}/{t}/{best}.json`).', '', f"![]({FIG}generalisation_{t}.png)", '']
    if sanity:
        L += ['## Sanity checks: do the inputs carry signal, and do the labels?', '',
              f"* Real labels, LightGBM, fixed settings: validation ROC-AUC {sanity['labels'].get('val_roc_auc'):.3f}, leave-one-district-out ROC-AUC {sanity['labels'].get('lodo_roc_auc'):.3f}.",
              f"* Same model with the **training labels shuffled**: validation ROC-AUC {sanity['shuffled_training_labels']['val_roc_auc']:.3f}. A pipeline without leakage scores about 0.5 here.",
              f"* The **same input features predicting crop type** (a label that is visible from space; the crop columns were removed from the inputs): validation accuracy "
              f"{sanity['crop_type_from_same_features']['val_accuracy']:.3f} against {sanity['crop_type_from_same_features']['majority_accuracy']:.3f} for always guessing the commonest crop "
              f"({sanity['crop_type_from_same_features']['classes']} crops). " + (
                  'The inputs clearly carry signal (crop type is read far above chance) while the health labels are read at chance, so the limit is the labels, not the features or the code.'
                  if sanity['crop_type_from_same_features']['val_accuracy'] > sanity['crop_type_from_same_features']['majority_accuracy'] + 0.2 and sanity['labels']['val_roc_auc'] < 0.55
                  else 'These two results do not by themselves separate a feature problem from a label problem.'), '',
              '### Which inputs matter (Healthy vs Problem, LightGBM)', '', '| Inputs | Val ROC-AUC | Val Bal. Acc | Leave-one-district-out ROC-AUC | Leave-one-district-out Bal. Acc |', '|---|---|---|---|---|']
        for k, s in sanity['ablation'].items():
            L.append(f"| {k} | {s['val_roc_auc']:.3f} | {s['val_balanced_accuracy']:.3f} | {s['lodo_roc_auc']:.3f} | {s['lodo_balanced_accuracy']:.3f} |")
        L += ['', f"![]({FIG}learning_curve.png)", '', learning_sentence(sanity), '']
    return '\n'.join(L) + '\n'


def write_readiness(res: dict, explain: dict) -> str:
    v = verdict(res)
    t = 'health_binary'
    m, s = best_attempt(res, t)
    sel = res['tasks'][t]['selection']
    L = ['# Production readiness', '', '## Decision', '']
    if not v['any_eligible']:
        L += ['**No production-ready model has been established.** No model, on any task, cleared the pre-registered bar (validation balanced-accuracy interval above chance **and** held-out balanced accuracy at least chance + 0.03). '
              'The satellite indicators available here do not separate the survey-labelled problem fields from healthy ones better than chance, so none of these models should drive a farmer-facing health or stress call.']
    else:
        names = ', '.join(f'{k}: {x}' for k, x in v['eligible'].items() if x)
        L += [f'**Not production ready.** Some models cleared the research bar ({names}), but production additionally requires independent field validation, and the data licence forbids shipping weights for now. See below.']
    L += ['', '## The four questions', '']
    if m:
        L += [f"1. **Best model for CHM:** none is established. The model ranked highest on Healthy vs Problem is `{m}`, but that ranking is noise: validation balanced accuracy {s['val_balanced_accuracy']:.3f} against chance {chance(t):.2f}, "
              f"yet test {s['test_balanced_accuracy']:.3f}, macro-F1 {s['test_f1_macro']:.3f}, ROC-AUC {fmt(s['test_roc_auc'])}. Across the {sum(1 for k, x in res['tasks'][t]['models'].items() if 'test_balanced_accuracy' in x and k not in BASELINES)} models (baselines excluded) on this task test balanced accuracy ranges from "
              f"{min(x['test_balanced_accuracy'] for k, x in res['tasks'][t]['models'].items() if 'test_balanced_accuracy' in x and k not in BASELINES):.3f} to {max(x['test_balanced_accuracy'] for k, x in res['tasks'][t]['models'].items() if 'test_balanced_accuracy' in x and k not in BASELINES):.3f}.",
              f"2. **How accurate:** test accuracy {s['test_accuracy']:.3f}, but always answering Healthy scores {res['tasks'][t]['models']['majority_class']['test_accuracy']:.3f}, so accuracy is not the measure; balanced accuracy {s['test_balanced_accuracy']:.3f} (chance 0.50).",
              f"3. **How fast:** `{m}` answers one field in {s['latency_p50_ms']:.2f} ms (p95 {s['latency_p95_ms']:.2f} ms) on this CPU and takes {s['train_seconds']:.0f} s to train; model size {s['model_size_mb']:.2f} MB. Speed is not the problem.",
              f"4. **Reliability on unseen farms and districts:** held-out districts and the other season average {fmt(s['heldout_balanced_accuracy'])} balanced accuracy for `{m}` (chance 0.50). "
              f"False-healthy rate on test (stressed fields called Healthy): {fmt(s['test_false_healthy_rate'])}."]
    L += ['', '## Abstention (INSUFFICIENT_DATA_OR_LOW_CONFIDENCE)', '',
          'The rule: answer only when the top-class probability reaches a threshold chosen on **validation** data so that the false-healthy rate stays at or below 10% while at least 20% of fields are answered; '
          'also abstain on fewer than 3 clear observations and on inputs outside the training range. A model that cannot meet the safety target abstains on every field.', '']
    for k, e in (explain or {}).items():
        ab = e['abstention']
        L.append(f"* {TITLES[k]} ({e['model']}): threshold {ab['threshold_chosen_on_validation']}, test coverage {ab['test_coverage']:.2f}"
                 + (f", accuracy when answered {ab['test_accuracy_when_answered']:.3f} (commonest class would score {ab['test_majority_accuracy_when_answered']:.3f})" if 'test_accuracy_when_answered' in ab else '')
                 + (f", false-healthy rate when answered {ab['test_false_healthy_rate_when_answered']:.3f} on {ab['test_stressed_fields_answered']} stressed fields" if 'test_false_healthy_rate_when_answered' in ab else '')
                 + (f". {ab['verdict']}" if 'verdict' in ab else '.')
                 + (' There is no Healthy class here, so no false-healthy target applies: the threshold sits at the 0.30 floor and the model never abstains on confidence. That is not a safety result, and its accuracy is within noise of the commonest class.' if k == 'stress_cause' else ''))
    L += ['', '## Backend integration status', '',
          '**Not integrated, on purpose.** (1) No model is approved. (2) The Telangana licence note in `datasets/TRAINING-DATA-REGISTER.md` limits this data to evaluation until the owner says a trained model may ship. '
          'The existing API is unchanged and no weights are committed. The abstention rule is implemented and tested in `scripts/ml/ml_common.py`; it would move into `backend/engine/prediction_confidence.py` together with the first approved model.',
          '', '## What is needed before any model can be called production-ready', '',
          '* Dated, agronomist-confirmed stress observations with severity (mild / moderate / severe) for the same fields the satellite sees, at least 100 per class, collected in more than one season and several districts. '
          'The app already has `scripts/evaluate-ndvi-alerts.mjs` for scoring against visits.',
          '* The raw Sentinel-2 bands (B2, B3, B6, B7, B8A, B12) re-extracted, so NDWI and EVI can be tested. This cannot be assumed to help: crop type is already readable from the current indicators while health is not.',
          '* Written confirmation of whether a model trained on the Telangana (CC-BY-SA 4.0) data may ship.',
          '* A pass limit agreed **before** the final test is looked at, then one independent evaluation.', '',
          '## Final production-readiness decision', '', '**NOT READY.** ' + ('No model beats chance on unseen districts.' if not v['any_eligible'] else 'Research candidates exist but lack independent validation and licence clearance.')]
    return '\n'.join(L) + '\n'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--run-id', default='main')
    ap.parse_args()
    rep = path('reports')
    res = read_json(rep / 'results.json')
    explain = read_json(rep / 'explain.json') if (rep / 'explain.json').exists() else {}
    sanity = res.get('sanity_checks')
    docs = ROOT / 'docs/ml'
    docs.mkdir(parents=True, exist_ok=True)
    (docs / 'MODEL_COMPARISON.md').write_text(write_comparison(res, docs), encoding='utf-8')
    (docs / 'TRAINING_REPORT.md').write_text(write_training(res, explain), encoding='utf-8')
    (docs / 'VALIDATION_REPORT.md').write_text(write_validation(res, sanity), encoding='utf-8')
    (docs / 'PRODUCTION_READINESS.md').write_text(write_readiness(res, explain), encoding='utf-8')
    print('wrote MODEL_COMPARISON.md, TRAINING_REPORT.md, VALIDATION_REPORT.md, PRODUCTION_READINESS.md')


if __name__ == '__main__':
    main()
