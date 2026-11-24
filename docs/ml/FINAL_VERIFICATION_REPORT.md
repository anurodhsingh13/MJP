# Final verification report

Independent audit of the CHM model-training workflow. Every statement below comes from files read, commands run and models reloaded in this verification. Limit of independence: The same author built and verified this. Independence comes from separate code paths (raw CSV recounts, direct scikit-learn metric calls, artifact reloads), not from a different person, machine or dataset.

## A. Overall completion status

* **Overall status: PARTIAL PASS.** The pipeline was implemented, executed and reproduced, but backend integration is not implemented (deliberately) and no model shows skill.
* **Production decision: NOT READY.**
* **Engineering completion: 71%** (rubric in section O).
* **ML validation / production readiness: 0%.** 0 of 3 tasks have a model that clears the pre-registered bar; no model beats chance on unseen districts. A high engineering score does not make the models valid.
* One caveat stated plainly: on the test split 1 of 45 model-task combinations has a 95% balanced-accuracy interval above chance (health_binary/tcn: test 0.549, lower bound 0.507, validation 0.488, held-out 0.507). About 2 of 45 are expected by chance alone, and it fails the validation / held-out bar, so it is not a finding.

Not FALSE COMPLETION: the earlier claims (49 models trained, none production ready) reproduced exactly. Two wording errors in the reports were found and fixed (I-11, I-12).

## B. Implementation verification

| Component | Status | Evidence |
|---|---|---|
| Repository audit | PASS | docs/ml/REPOSITORY_AUDIT.md (facts checked against code: e.g. potato-leaf model is wired into the app) |
| Dataset audit | PASS | scripts/ml/audit_datasets.py executed; docs/ml/DATASET_REPORT.md; numbers re-derived independently by verify_data.py |
| Satellite feature extraction | PARTIAL | 77 features and 32-step sequences built from NDVI / NDRE / NDMI; B2, B3, B6, B7, B8A, B12, NDWI, EVI and soil moisture are unavailable (I-10) |
| Data preprocessing | PASS | prepare_satellite_data.py: tile choice and clear-observation rules; independent recount 3,644 = 3,644 |
| Leakage-safe data splitting | PASS | verify_data.py: 0 overlapping rows or FarmIDs; held-out district never in training; spatial leakage low |
| Classical ML training | PASS | 10 models + 2 baselines x 3 tasks executed; 34 results, artifacts reloaded and reproduced |
| Deep learning training | PASS | 5 models x 3 tasks executed (15 results); reproduced by refit; artifacts not self-contained (I-02) |
| Hyperparameter optimization | PASS | Optuna ran for every model (12 trials classical, 4 deep); small by design |
| Model evaluation | PASS | 49 results; every metric recomputed independently with zero difference |
| Model comparison | PASS | tables, figures and pre-registered selection; unit test that selection never reads test |
| Explainability | PASS | TreeSHAP additive to 2e-15 and equal to shap.TreeExplainer; but near-chance models (I-15) |
| Prediction confidence / abstention | PARTIAL | rules implemented and unit-tested, but safety tests found real gaps (I-01); no single predict-with-safety function |
| Model export | PARTIAL | classical joblib artifacts reload exactly; deep artifacts incomplete (I-02); no best_* folders or metadata (I-04) |
| Backend integration | NOT IMPLEMENTED | deliberate: no approved model, evaluation-only licence (I-04) |
| Final reports | PASS | all 7 deliverables exist and parse; two wording errors found and fixed (I-11, I-12) |

Scripts created but never executed: none of the 16 new pipeline scripts is unexecuted (`optimize_hyperparameters.py`, `experiment.py`, `task_data.py`, `ml_common.py` run as libraries). Older scripts in `scripts/ml/` (`train_timesen2crop.py`, `make_labelling_sheet.py`, PLDD-UP scripts) are outside this task and were not run here.

## C. Actual training verification

* **49 models trained successfully**, 2 not applicable (the NDVI rule exists only for Healthy vs Problem), **0 failed**. 17 result files per task x 3 tasks = 51 files (49 trained + 2 not applicable).
* Dataset: Telangana Crop Health, 3,644 usable fields of 7,888 labelled. Training rows: health tasks 2,550; cause task 457. Features: 77 (all models read the same table; the 5 sequence models read 32 steps x 4 channels plus crop/season).
* Labels: Healthy vs Problem; Healthy / Pests / Diseased / Stressed; Pests / Diseased / Stressed. Hyperparameter tuning: yes, Optuna, 12 trials (classical) or 4 (deep). Validation: yes. Independent test: the single held test split (no external set exists).
* Transformer: not trained (not eligible: 3,644 fields, no signal). Failed models: none.

Per-model status, tuning trials, rows and durations are in `reports/ml/verification_results.json` (`models`).

## D. Dataset verification (recomputed from the raw files)

* Train.csv rows 7,888; unique FarmIDs 7,888; duplicate rows 0; duplicate geometries 0; invalid labels 0; missing cells: none.
* Labels: {'Healthy': 6506, 'Diseased': 474, 'Pests': 485, 'Stressed': 423} (Healthy 82.5%). Usable fields counted independently: **3644** = the 3644 in the feature file (ids identical: True).
* Splits: {'train': 2550, 'validation': 547, 'test': 547}; overlapping rows 0; overlapping field ids 0; covers all rows True; held-out district never in training True.
* Spatial leakage: median distance from a test field to the nearest training field 372 m; 36% within 250 m. Labels of fields within 250 m of each other agree 71.3% against 70.6% expected by chance, so neighbouring labels are not clustered and spatial leakage of labels is negligible.
* Label reliability: **cannot be verified** (survey answers, one season, no dates). Labels do **not** support severity prediction (none exist). Crop-type accuracy was not counted as health accuracy.
* Licence: CC-BY-SA 4.0, evaluation only, no shipped weights (datasets/TRAINING-DATA-REGISTER.md). Weights are under `.local/models` and not committed.

## E. Independent metric verification

* Labels rebuilt from the raw feature file; metrics recomputed with scikit-learn called directly and separately written Brier / calibration code (`scripts/ml/verify_models.py`).
* **34 classical models**: saved artifact reloaded with its saved preprocessing pipeline; probabilities equal the saved ones to 3.3e-16 and every metric to 6.9e-17 (**VERIFIED_BY_ARTIFACT**).
* **15 deep models**: artifact cannot be reloaded (I-02); re-fitted with the saved settings and seed, probabilities and metrics identical (difference 0.0) (**VERIFIED_BY_REFIT**).
* Metrics from the saved probabilities for all 49 models match the logged numbers exactly; `results.json` equals the per-run files for all 49 (0 mismatches); the deep log (15 models) and classical log (15 models) match the result files (0 mismatches).
* Metrics checked: accuracy, balanced accuracy, precision, recall, macro and weighted F1, ROC-AUC, PR-AUC, confusion matrix, false-positive / false-negative / false-healthy rate, Brier, calibration error. None is UNVERIFIED.
* Limitation: the test split was never used for tuning or selection (unit-tested), but it is the only test set, and its numbers were visible while the reports were written (I-07). Held-out district / season scores are slightly optimistic (I-06).

## F. Accuracy and performance comparison (test split, verified)

Accuracy is shown because it was asked for, but 82% of fields are Healthy, so always answering Healthy scores 0.821. Use balanced accuracy and macro F1.

### Healthy vs Problem (`health_binary`)

| Model | Training status | Accuracy | Balanced Acc. | Macro F1 | Recall (macro) | ROC-AUC | Train time (s, recorded) | Inference p50 (ms, verified) | Model size (MB) |
|---|---|---|---|---|---|---|---|---|---|
| extra_trees | VERIFIED_BY_ARTIFACT | 0.695 | 0.535 | 0.530 | 0.535 | 0.515 | 9 | 17.57 | 2.464 |
| hist_gradient_boosting | VERIFIED_BY_ARTIFACT | 0.682 | 0.523 | 0.518 | 0.523 | 0.506 | 16 | 1.77 | 0.467 |
| lstm | VERIFIED_BY_REFIT | 0.609 | 0.558 | 0.516 | 0.558 | 0.548 | 28 | 0.68 | 0.027 |
| gru | VERIFIED_BY_REFIT | 0.629 | 0.539 | 0.514 | 0.539 | 0.569 | 71 | 1.06 | 0.022 |
| random_forest | VERIFIED_BY_ARTIFACT | 0.702 | 0.499 | 0.499 | 0.499 | 0.502 | 19 | 17.59 | 0.333 |
| xgboost | VERIFIED_BY_ARTIFACT | 0.720 | 0.499 | 0.498 | 0.499 | 0.480 | 16 | 0.66 | 0.475 |
| lightgbm | VERIFIED_BY_ARTIFACT | 0.665 | 0.489 | 0.488 | 0.489 | 0.515 | 11 | 0.48 | 0.236 |
| catboost | VERIFIED_BY_ARTIFACT | 0.607 | 0.497 | 0.483 | 0.497 | 0.467 | 41 | 0.60 | 0.067 |
| mlp | VERIFIED_BY_REFIT | 0.636 | 0.487 | 0.483 | 0.487 | 0.508 | 10 | 0.30 | 0.017 |
| logistic_regression | VERIFIED_BY_ARTIFACT | 0.539 | 0.524 | 0.471 | 0.524 | 0.522 | 3 | 0.21 | 0.004 |
| knn | VERIFIED_BY_ARTIFACT | 0.808 | 0.500 | 0.465 | 0.500 | 0.547 | 3 | 0.42 | 1.521 |
| majority_class (baseline) | VERIFIED_BY_ARTIFACT | 0.821 | 0.500 | 0.451 | 0.500 | 0.500 | 0 | 0.02 | 0.000 |
| svm | VERIFIED_BY_ARTIFACT | 0.821 | 0.500 | 0.451 | 0.500 | 0.483 | 30 | 0.31 | 1.461 |
| cnn1d | VERIFIED_BY_REFIT | 0.508 | 0.493 | 0.444 | 0.493 | 0.507 | 29 | 0.53 | 0.182 |
| decision_tree | VERIFIED_BY_ARTIFACT | 0.463 | 0.449 | 0.406 | 0.449 | 0.438 | 3 | 0.18 | 0.004 |
| tcn | VERIFIED_BY_REFIT | 0.371 | 0.549 | 0.368 | 0.549 | 0.556 | 62 | 1.33 | 0.025 |
| ndvi_rule (baseline) | VERIFIED_BY_ARTIFACT | 0.245 | 0.524 | 0.238 | 0.524 | 0.524 | 0 | 0.05 | 0.000 |

* Highest test accuracy: **svm** 0.821: equal to the always-answer-the-commonest-class baseline: no real skill (baseline 0.821).
* Highest test macro F1: **extra_trees** 0.530 (95% interval 0.480 to 0.565); above the majority baseline's 0.451, but balanced accuracy is 0.535 (95% 0.480 to 0.577), ROC-AUC 0.515, validation balanced accuracy 0.492 and held-out 0.503; it does NOT clear the pre-registered bar, so it is not a demonstrated winner.
* Fastest verified (no skill): decision_tree at 0.18 ms.
* Best overall: none; most reliable: none; best production candidate: none.

### Healthy / Pests / Diseased / Stressed (`health_4class`)

| Model | Training status | Accuracy | Balanced Acc. | Macro F1 | Recall (macro) | ROC-AUC | Train time (s, recorded) | Inference p50 (ms, verified) | Model size (MB) |
|---|---|---|---|---|---|---|---|---|---|
| lightgbm | VERIFIED_BY_ARTIFACT | 0.753 | 0.264 | 0.266 | 0.264 | 0.508 | 40 | 0.47 | 1.715 |
| random_forest | VERIFIED_BY_ARTIFACT | 0.686 | 0.260 | 0.259 | 0.260 | 0.505 | 32 | 17.26 | 1.344 |
| extra_trees | VERIFIED_BY_ARTIFACT | 0.702 | 0.249 | 0.248 | 0.249 | 0.520 | 17 | 17.46 | 4.268 |
| hist_gradient_boosting | VERIFIED_BY_ARTIFACT | 0.726 | 0.248 | 0.246 | 0.248 | 0.492 | 65 | 3.17 | 0.803 |
| catboost | VERIFIED_BY_ARTIFACT | 0.740 | 0.239 | 0.232 | 0.239 | 0.503 | 216 | 0.55 | 1.010 |
| xgboost | VERIFIED_BY_ARTIFACT | 0.548 | 0.236 | 0.231 | 0.236 | 0.490 | 69 | 0.52 | 0.878 |
| knn | VERIFIED_BY_ARTIFACT | 0.821 | 0.250 | 0.225 | 0.250 | 0.506 | 3 | 0.49 | 1.521 |
| majority_class (baseline) | VERIFIED_BY_ARTIFACT | 0.821 | 0.250 | 0.225 | 0.250 | 0.500 | 0 | 0.02 | 0.000 |
| svm | VERIFIED_BY_ARTIFACT | 0.821 | 0.250 | 0.225 | 0.250 | 0.463 | 69 | 0.34 | 1.609 |
| decision_tree | VERIFIED_BY_ARTIFACT | 0.402 | 0.278 | 0.225 | 0.278 | 0.492 | 6 | 0.17 | 0.034 |
| cnn1d | VERIFIED_BY_REFIT | 0.399 | 0.218 | 0.198 | 0.218 | 0.490 | 16 | 0.46 | 0.182 |
| logistic_regression | VERIFIED_BY_ARTIFACT | 0.225 | 0.293 | 0.171 | 0.293 | 0.523 | 6 | 0.19 | 0.006 |
| gru | VERIFIED_BY_REFIT | 0.239 | 0.250 | 0.163 | 0.250 | 0.488 | 39 | 1.08 | 0.023 |
| lstm | VERIFIED_BY_REFIT | 0.188 | 0.261 | 0.140 | 0.261 | 0.517 | 14 | 0.68 | 0.027 |
| tcn | VERIFIED_BY_REFIT | 0.146 | 0.231 | 0.118 | 0.231 | 0.480 | 62 | 1.34 | 0.097 |
| mlp | VERIFIED_BY_REFIT | 0.082 | 0.249 | 0.090 | 0.249 | 0.493 | 2 | 0.28 | 0.012 |
| ndvi_rule | NOT_APPLICABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE |

* Highest test accuracy: **knn** 0.821: equal to the always-answer-the-commonest-class baseline: no real skill (baseline 0.821).
* Highest test macro F1: **lightgbm** 0.266 (95% interval 0.222 to 0.300); above the majority baseline's 0.225, but balanced accuracy is 0.264 (95% 0.230 to 0.294), ROC-AUC 0.508, validation balanced accuracy 0.241 and held-out 0.251; it does NOT clear the pre-registered bar, so it is not a demonstrated winner.
* Fastest verified (no skill): decision_tree at 0.17 ms.
* Best overall: none; most reliable: none; best production candidate: none.

### Cause among problem fields (`stress_cause`)

| Model | Training status | Accuracy | Balanced Acc. | Macro F1 | Recall (macro) | ROC-AUC | Train time (s, recorded) | Inference p50 (ms, verified) | Model size (MB) |
|---|---|---|---|---|---|---|---|---|---|
| hist_gradient_boosting | VERIFIED_BY_ARTIFACT | 0.418 | 0.420 | 0.417 | 0.420 | 0.555 | 65 | 2.74 | 0.361 |
| lightgbm | VERIFIED_BY_ARTIFACT | 0.418 | 0.412 | 0.413 | 0.412 | 0.555 | 14 | 0.43 | 0.547 |
| catboost | VERIFIED_BY_ARTIFACT | 0.418 | 0.412 | 0.411 | 0.412 | 0.524 | 182 | 0.58 | 0.225 |
| random_forest | VERIFIED_BY_ARTIFACT | 0.408 | 0.400 | 0.400 | 0.400 | 0.504 | 18 | 28.29 | 0.821 |
| xgboost | VERIFIED_BY_ARTIFACT | 0.408 | 0.397 | 0.399 | 0.397 | 0.551 | 26 | 0.57 | 0.832 |
| knn | VERIFIED_BY_ARTIFACT | 0.367 | 0.360 | 0.357 | 0.360 | 0.523 | 2 | 3.78 | 0.276 |
| decision_tree | VERIFIED_BY_ARTIFACT | 0.378 | 0.363 | 0.355 | 0.363 | 0.545 | 2 | 0.23 | 0.003 |
| logistic_regression | VERIFIED_BY_ARTIFACT | 0.357 | 0.355 | 0.354 | 0.355 | 0.479 | 3 | 0.19 | 0.006 |
| mlp | VERIFIED_BY_REFIT | 0.367 | 0.353 | 0.349 | 0.353 | 0.480 | 1 | 0.30 | 0.017 |
| extra_trees | VERIFIED_BY_ARTIFACT | 0.347 | 0.348 | 0.346 | 0.348 | 0.481 | 10 | 18.20 | 0.486 |
| lstm | VERIFIED_BY_REFIT | 0.337 | 0.332 | 0.332 | 0.332 | 0.469 | 4 | 0.61 | 0.027 |
| cnn1d | VERIFIED_BY_REFIT | 0.327 | 0.321 | 0.323 | 0.321 | 0.500 | 3 | 0.73 | 0.182 |
| tcn | VERIFIED_BY_REFIT | 0.306 | 0.287 | 0.277 | 0.287 | 0.466 | 9 | 1.18 | 0.032 |
| gru | VERIFIED_BY_REFIT | 0.327 | 0.317 | 0.272 | 0.317 | 0.445 | 11 | 2.56 | 0.047 |
| svm | VERIFIED_BY_ARTIFACT | 0.347 | 0.317 | 0.244 | 0.317 | 0.478 | 8 | 0.18 | 0.286 |
| majority_class (baseline) | VERIFIED_BY_ARTIFACT | 0.388 | 0.333 | 0.186 | 0.333 | 0.500 | 0 | 0.01 | 0.000 |
| ndvi_rule | NOT_APPLICABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE |

* Highest test accuracy: **catboost** 0.418: equal to the always-answer-the-commonest-class baseline: no real skill (baseline 0.388).
* Highest test macro F1: **hist_gradient_boosting** 0.417 (95% interval 0.322 to 0.500); above the majority baseline's 0.186, but balanced accuracy is 0.420 (95% 0.328 to 0.510), ROC-AUC 0.555, validation balanced accuracy 0.344 and held-out 0.317; it does NOT clear the pre-registered bar, so it is not a demonstrated winner.
* Fastest verified (no skill): svm at 0.18 ms.
* Best overall: none; most reliable: none; best production candidate: none.

**Winners:** Best Overall Model: none. Best Crop Health Model: none. Best Stress-Risk Model: none (a weak, unproven hint for the cause task: several tree models reach 0.40 to 0.42 test balanced accuracy against 0.33 chance, but held-out districts give 0.35 and the intervals include chance). Fastest Model: the decision tree and logistic regression (about 0.2 ms per field) but with no skill. Most Reliable Model: none. Best Production Candidate: none.

## G. Training and inference speed

Hardware: AMD64 Family 25 Model 124 Stepping 0, AuthenticAMD, 12 logical cores, 15.2 GB RAM; GPU present: NVIDIA RTX 4050 (6 GB). **GPU used: no.** `torch.cuda.is_available()` = False; GPU utilisation 0.0% before and 0.0% after the benchmark (memory in use 159 to 231 MB cannot come from these models, because PyTorch has no CUDA support here and the tree libraries ran on the CPU). Peak GPU memory for the models: NOT APPLICABLE.

Same procedure for all 49 models: 20 warm-up calls, 200 single-sample calls, then a 256-sample batch x5; CPU; one Python process; tabular models read feature rows and sequence models read 32-step series (inputs differ by design).

| Task | Model | p50 (ms) | p95 (ms) | Samples/s (batch 256) | Peak RAM (MB, process) | Original p50 (ms) |
|---|---|---|---|---|---|---|
| health_binary | majority_class | 0.02 | 0.04 | 7352096 | 598 | 0.00 |
| health_binary | ndvi_rule | 0.05 | 0.07 | 4445988 | 573 | 0.02 |
| health_binary | decision_tree | 0.18 | 0.39 | 601560 | 600 | 0.10 |
| health_binary | logistic_regression | 0.21 | 0.46 | 901599 | 598 | 0.12 |
| health_binary | mlp | 0.30 | 0.54 | 306697 | 573 | 0.64 |
| health_binary | svm | 0.31 | 0.54 | 6580 | 575 | 0.31 |
| health_binary | knn | 0.42 | 0.88 | 92181 | 599 | 0.98 |
| health_binary | lightgbm | 0.48 | 0.89 | 210970 | 598 | 0.54 |
| health_binary | cnn1d | 0.53 | 0.92 | 48353 | 600 | 1.34 |
| health_binary | catboost | 0.60 | 0.84 | 186763 | 572 | 0.55 |
| health_binary | xgboost | 0.66 | 1.46 | 106011 | 575 | 0.44 |
| health_binary | lstm | 0.68 | 1.05 | 115622 | 598 | 1.91 |
| health_binary | gru | 1.06 | 1.81 | 42611 | 593 | 2.46 |
| health_binary | tcn | 1.33 | 2.57 | 45799 | 585 | 1.47 |
| health_binary | hist_gradient_boosting | 1.77 | 2.70 | 81186 | 593 | 2.05 |
| health_binary | extra_trees | 17.57 | 18.69 | 8755 | 602 | 17.10 |
| health_binary | random_forest | 17.59 | 18.94 | 14452 | 574 | 17.25 |

The table shows Healthy vs Problem; all three tasks are in `verification_results.json`. Random forest and extra trees are slowest (about 17 ms) because of multi-core overhead on one-row calls.

Training time re-measured for the final fit of the 15 Healthy-vs-Problem models (tuning time was not re-run): classical models match the recorded values within about 0.2 s; deep models took 1.6 to 2.7x less time than recorded, showing the recorded values were inflated by other processes (I-05). Training time for the other two tasks: NOT RE-MEASURED.

## H. Model artifact verification

* 49 artifacts exist under `.local/models/main/<task>/` (34 `.joblib`, 15 `.pt`). The 34 classical artifacts reload and reproduce exactly. The 15 deep artifacts hold weights only (I-02).
* `.local/models/best_health_model/`, `best_stress_risk_model/` and `model_metadata.json` do not exist (no model was selected). Existing models (PLDD-UP runs) were not touched.
* `reports/ml/results.json` and `verification_results.json` parse as JSON; `results.json` equals the per-run files for all 49 models.

## I. Explainability verification

* `shap` 0.51.0 imports now and `shap.TreeExplainer` equals the native TreeSHAP exactly (difference 0.0). Native TreeSHAP contributions plus bias equal the raw model score: maximum error 2e-15 (LightGBM) and 1.4e-6 (XGBoost).
* The top-5 features in `reports/ml/explain.json` are reproduced exactly for all three tasks. A missing feature is handled (the model predicts; the probability moves 0.02 to 0.05 on average).
* Consistency is poor, as expected for models at chance: permutation-rank correlation between two seeds is 0.45 / 0.75 / 0.71 and with TreeSHAP 0.03 / 0.54 / 0.43 (binary / 4-class / cause). Top features include `clear_fraction` and `area_ha`, which describe observation coverage and field size, not crop condition.
* Example explanations carry the note "satellite indicators that raised this class score; not a diagnosis". Feature importance is **not** evidence of disease.

## J. Prediction safety verification

Seven input kinds through the saved model and the abstention rule as `explain_predictions.py` applies it:

| Case | health_binary (lightgbm) | health_4class (xgboost) | stress_cause (xgboost) |
|---|---|---|---|
| 1 normal healthy field | INSUFFICIENT (p=0.53) | INSUFFICIENT (p=0.28) | Pests (p=0.39) |
| 2 stressed field | INSUFFICIENT (p=0.56) | INSUFFICIENT (p=0.32) | Diseased (p=0.72) |
| 3 missing satellite observations | INSUFFICIENT (p=0.89) | INSUFFICIENT (p=0.51) | INSUFFICIENT (p=0.56) |
| 4 cloud obscured one clear observation | INSUFFICIENT (p=0.54) | INSUFFICIENT (p=0.34) | INSUFFICIENT (p=0.63) |
| 5 invalid numbers inf minus999 1e12 | INSUFFICIENT (p=0.52) | INSUFFICIENT (p=0.49) | Stressed (p=0.88) |
| 6 out of distribution x1000 | INSUFFICIENT (p=0.56) | INSUFFICIENT (p=0.48) | INSUFFICIENT (p=0.60) |
| 7 lowest confidence validation row | INSUFFICIENT (p=0.50) | INSUFFICIENT (p=0.28) | Diseased (p=0.40) |

* **Health tasks: 7 of 7 abstain, but vacuously.** Their validation threshold is `None` (no threshold met the 10% false-healthy target), so they abstain on everything, including a healthy and a stressed field. With all satellite inputs missing the model still returned 0.89 confidence, so abstention comes only from the missing threshold.
* **Stress-cause task: FAIL.** It answered a healthy-profile field ("Pests"), a stressed field ("Diseased", 0.72), and invalid numbers (inf, -inf, -999, 1e12) as "Stressed" at 0.88, and a 0.40-confidence row. It abstained on missing observations only because the caller passed 0 clear observations, and on cloud (1 clear observation) and out-of-distribution (x1000) for the same reason: the safety is in the caller, not in a single prediction function. This is I-01.
* There is no input-validation layer and no single `predict_with_safety` function. Nothing of this is exposed to users, because nothing is integrated.

## K. Backend integration verification

* **The backend does not use any newly trained model.** No reference to the new artifacts or modules exists in `backend/`, `frontend/src` or `shared/` (grep); there is no health or stress prediction route (the API and engine only have the older potato-leaf photo check, which was not part of this work and loads lazily on first use, not at startup).
* Model loading at startup, versioning, prediction endpoint, input validation, output schema, confidence reporting, error handling, database integration: **NOT IMPLEMENTED** (deliberate).
* **Old functionality works:** live `GET /api/health` 200, engine `/health` 200, frontend 200, `GET /api/fields` returns data; the 162-test backend suite, 41 engine tests, type check and production build all exit 0 (below). The uncommitted weather-scheduler change is separate from this ML work.

## L. Automated test results (exact commands and exit codes)

| Name | Command | Exit code | Tests | Pass | Fail | Skipped | Seconds |
|---|---|---|---|---|---|---|---|
| ml_unittest | `bash -c cd scripts/ml && ../../.venv/Scripts/python.exe -m unittest test_ml_pipeline -v` | 0 | 11 | 11 | 0 | 0 | 2 |
| typecheck | `npx tsc -b` | 0 | - | - | - | - | 11 |
| frontend_build | `npx vite --config frontend/vite.config.ts build` | 0 | - | - | - | - | 5 |
| backend_node_tests | `node --import tsx --test backend/api/controllers/assistantController.test.ts backend/api/controllers/faoCalendarController.test.ts backend/api/control...` | 0 | - | - | - | - | 28 |
| launcher_tests | `node --test scripts/local.test.mjs` | 0 | - | - | - | - | 3 |
| engine_pytest | `.venv/Scripts/python.exe -m pytest backend/engine -q -x --no-header -p no:cacheprovider` | 0 | 41 | 41 | 0 | 0 | 8 |

Not counted as passed:

* **backend integration tests (4 tests): SKIPPED.** need a dedicated PostGIS database named chm_integration (the tests assert it); creating a database on your server was not done without asking. Includes the durable-job test that covers backend/api/services/jobs.ts, which the uncommitted weather scheduler touches.
* **launcher database tests (3 tests): SKIPPED.** skipped by the test file in this environment
* **Playwright UI tests (npm run test:ui): NOT EXECUTED.** not run in this verification; they start their own dev servers and browsers
* **ML prediction API tests: NOT APPLICABLE.** there is no health / stress prediction endpoint to test

Totals: 52 tests executed in these suites, 0 skipped; type check and build have no test count. Also run in this verification (not suites): `verify_data.py`, `verify_models.py`, `verify_safety.py`.

## M. Missing deliverables

* backend/engine/satellite_features.py
* backend/engine/crop_health_predictor.py
* backend/engine/stress_risk_predictor.py
* backend/engine/prediction_confidence.py
* backend/engine/model_loader.py
* .local/models/best_health_model/
* .local/models/best_stress_risk_model/
* .local/models/model_metadata.json
* All seven required documents and `reports/ml/results.json` exist, parse and contain genuine results. (`FINAL_VERIFICATION_REPORT.md` and `verification_results.json` are this report.)

## N. Failures and recommended fixes

| ID | Severity | File | Problem | Evidence | Recommended fix |
|---|---|---|---|---|---|
| I-01 | HIGH | scripts/ml/explain_predictions.py (out_of_range); scripts/ml/ml_common.py (choose_confidence_threshold) | The stress-cause model answers on invalid and low-quality inputs, and can output "Diseased". The cause task has no Healthy class, so its confidence threshold falls to the 0.30 floor and it never abstains on confidence; the out-of-range test passes inf / -999 / 1e12 because only 4 of 77 features are outside the range (5% < 20%). | phase_safety.json: stress_cause case 5 (inf, -inf, -999, 1e12) -> "Stressed" at 0.879; case 2 (typical stressed field) -> "Diseased" at 0.717; case 7 (lowest-confidence validation row, p=0.398) -> "Diseased". | Validate inputs before prediction (finite, within physical bounds, enough non-missing features); require a validated accuracy-above-baseline threshold for the cause task or do not serve it; never expose a disease label from satellite data alone. |
| I-02 | HIGH | scripts/ml/train_deep_learning_models.py (save) | The five deep-model artifacts are not self-contained. The .pt file holds weights only; the fitted imputer, scaler and sequence statistics are not saved, so predictions cannot be reproduced from the artifact. | phase_models.json: all 15 deep entries have artifact_reload.loaded = false; they were verified only by re-fitting with the saved settings and seed (probability difference 0.0). | Save the preprocessing objects and architecture next to the weights and add a reload test. |
| I-03 | HIGH | datasets/TRAINING-DATA-REGISTER.md; data labels | The target labels do not support the requested outcome. Telangana labels are season-level survey cause categories with no severity (Mild / Moderate / Severe), no dates, one year (99% sown 2023), and cannot be independently verified. All 49 models score at chance on unseen districts. | phase_data.json (labels, 99% single year); results.json selection.eligible = [] for all 3 tasks; shuffled-label AUC 0.491 vs real 0.499. | Collect dated, agronomist-confirmed severity observations; see PRODUCTION_READINESS.md. |
| I-04 | MEDIUM | backend/engine/{satellite_features,crop_health_predictor,stress_risk_predictor,prediction_confidence,model_loader}.py; .local/models/{best_health_model,best_stress_risk_model,model_metadata.json} | The expected backend modules, "best model" folders and model_metadata.json do not exist. Backend integration was deliberately not done (no approved model; Telangana licence is evaluation-only). | file listing in this report; no reference to any new model in backend/ or frontend/src (grep). | Create them only together with a model that clears validation and licence review. |
| I-05 | MEDIUM | .local/ml/runs/main/*/*.json (latency, train_seconds, peak_ram_mb) | Originally recorded timings were taken while other processes were running (a large directory scan and unit tests), so they are inflated. | Fresh benchmark vs original single-call p50: median ratio 1.57x, maximum 5.15x; deep-model final-fit time 1.6-2.7x higher than the clean re-run (phase_fit_time.json). | Use the verified numbers in this report; re-run the pipeline on an idle machine for the final record. |
| I-06 | MEDIUM | scripts/ml/experiment.py (held-out refits) | Held-out district and season scores are slightly optimistic: the hyperparameters were tuned on main-train rows that include the held-out district's fields, and the refit reuses them. | code path: tune() uses td.train; held-out loops call fit(..., params, s["train"]). | Nested tuning inside each held-out fold. Effect is small here because every model is near chance. |
| I-07 | MEDIUM | reports/ml (test split use) | No genuinely independent test set exists. Test metrics were computed for every model and were visible when the report text was written and during this verification; selection never reads them (unit-tested), but the same 547 fields were reused. | splits.json has one test split; no other labelled satellite dataset is available. | Evaluate once on new, dated field observations collected after the pass limit is agreed. |
| I-08 | MEDIUM | scripts/ml/train_classical_models.py (NdviRule) | The "ndvi_rule" baseline is a feature-based approximation of the app's two triggers, not a replay of shared/evidence.ts (which compares comparable pairs by tile and method). | source inspection; its test AUC 0.524 vs the earlier node replay on 750 fields (0.454). | Replay the real rule through node for the baseline. |
| I-09 | MEDIUM | backend/api/services/platform.integration.test.ts, satellite.integration.test.ts | 4 integration tests were SKIPPED (need a dedicated chm_integration PostGIS database), including the durable-jobs test that covers jobs.ts, which the uncommitted weather scheduler modifies. They are not counted as passed. | backend_node_tests.log: 162 tests, 158 pass, 4 skipped. | Create the integration database and run `npm run test:integration` before committing the scheduler. |
| I-10 | MEDIUM | scripts/ml/build_satellite_features.py | The raw bands B2, B3, B6, B7, B8A, B12 were never extracted, so NDWI and EVI (requested) cannot be computed, and there is no soil-moisture source. | scripts/telangana_ndvi_extract.py selects only B4, B5, B8, B11; feature_summary.json "not_available". | Re-extract the bands for the 3,644 fields. |
| I-11 | MEDIUM | docs/ml/PRODUCTION_READINESS.md:9; scripts/ml/write_reports.py | A report sentence said "across all 16 models"; the task has 15 models (17 with baselines). FIXED during this verification: the count is now computed and baselines are excluded. | results.json health_binary has 17 entries, 15 non-baseline. | Fixed. |
| I-12 | LOW | docs/ml/REPOSITORY_AUDIT.md:40; docs/ml/TRAINING_REPORT.md:50; scripts/ml/explain_predictions.py; scripts/ml/README.md | The documents said `shap` cannot load. It failed on the first import (Application Control, numba DLL) but imports now, and shap.TreeExplainer equals the native TreeSHAP exactly. FIXED. | verify_safety.py output: shap 0.51.0 loads; difference 0.0. | Fixed; the claim now says what was observed. |
| I-13 | LOW | .local/ml/logs/classical.log | The resumed run overwrote the log, so 19 of 34 classical models have no training log line (15 are logged). Their result JSON files are intact and the models were independently reproduced. | log lines found: classical 15, deep 15; mismatches vs result JSON: 0. | Append to logs instead of overwriting. |
| I-14 | LOW | .local/models/main/**/*.joblib | Artifacts are pickles: loading an untrusted file can execute code, and the two baselines need scripts/ml on the Python path to unpickle. Local files only. | joblib load worked only with scripts/ml on sys.path. | Export tree models to a portable format before any serving. |
| I-15 | LOW | scripts/ml/explain_predictions.py | Explanations are unstable and lean on observation-quality proxies. For Healthy vs Problem the permutation ranking agrees between two seeds at only 0.45 (rank correlation) and with TreeSHAP at 0.03; the top features across tasks include clear_fraction and area_ha. | phase_safety.json explainability. | Do not present these as evidence of crop condition; they describe a model at chance. |
| I-16 | LOW | environment | No GPU was used: PyTorch is a CPU build although an RTX 4050 is present. GPU utilisation stayed at 0% during the benchmark. Not a correctness issue. | torch_cuda_available=False; nvidia-smi utilisation 0.0% before and 0.0% after. | Install a CUDA build only if larger models are ever justified. |

No CRITICAL issue was found: nothing was fabricated, no result failed to reproduce, and nothing unvalidated is deployed. Missing scripts: none. Failed training runs: none. Data leakage: none found.

## O. Production readiness decision and completion score

**Production decision: NOT READY.** No model beats chance on unseen districts, the safety layer has gaps, deep artifacts are incomplete, nothing is integrated, and the data licence limits shipping. **Overall status: PARTIAL PASS.**

| Category (weight) | Score | Basis |
|---|---|---|
| Implementation (15%) | 83% | PASS=1, PARTIAL=0.5, else 0 over 15 components |
| Dataset quality (15%) | 67% | 12 checks: unique ids, no duplicates, valid labels, no missing, no cross-split leakage, low spatial label leakage, licence recorded = 7; class imbalance handled 0.5; sample adequacy 0.5; label reliability verifiable 0; labels support the target 0; temporal coverage 0 |
| Actual training (20%) | 91% | 8 checks: all trained 1, per-model data documented 1, durations 0.5 (contaminated), tuning 1, validation 1, test 1, artifacts 0.75 (deep incomplete), failures documented 1 |
| Independent validation (20%) | 68% | 7 checks: metrics reproduced 1, independent metric code 1, test not used for selection 0.75, external independent test set 0, held-out validation done 1, no tuning leakage in held-out 0.5, calibration/abstention validated 0.5 |
| Performance benchmarking (10%) | 72% | 6 checks: fresh benchmark of all 49 1, identical conditions 1, training time re-measured for 15 of 49 models, peak RAM 1, hardware recorded 1, original timings clean 0 |
| Backend integration (10%) | 20% | 10 checks: only existing-API compatibility and frontend build pass; model loading, versioning, endpoint, validation, schema, confidence, error handling, database are not implemented |
| Testing and documentation (10%) | 75% | 7 checks: ML unit tests 1, other suites 1, executed not skipped 0.5 (0 skipped of 52), ML API tests 0 (none exist), deliverables exist 1, numbers accurate 0.75 (2 errors fixed), JSON valid and consistent 1 |
| **Engineering completion (weighted)** | **71%** | sum of weight x score |
| **ML validation / production readiness** | **0%** | 0 of 3 tasks with an eligible model; none beats chance |

## Answers

1. **Was the complete training process successful?** The process ran end to end and reproduced exactly (49 of 49 models trained, 0 failed). It did not produce a usable model: every model is at chance.
2. **How many models were actually trained?** 49 (10 classical + 2 baselines on 3 tasks, minus 2 not-applicable; 5 deep on 3 tasks). 15 distinct algorithms on up to 3 tasks.
3. **How many passed independent validation?** 49 reproduced exactly; **0** passed the validation bar (beat chance on unseen data). One (tcn, Healthy vs Problem) is nominally above chance on the test split alone (balanced accuracy 0.549, lower bound 0.507); about 2 of 45 are expected by chance, and it fails validation and held-out.
4. **Highest verified accuracy?** SVM and the majority baseline, test accuracy 0.821 (health_binary): both answer "Healthy" for everything. Next: knn 0.808 (balanced accuracy 0.500), xgboost 0.720 (balanced accuracy 0.499), random_forest 0.702 (balanced accuracy 0.499). Accuracy is not meaningful here: no model beats the always-Healthy answer on balanced accuracy.
5. **Best Macro F1?** extra_trees 0.530 on test (Healthy vs Problem), 95% interval 0.480 to 0.565; above the majority baseline's 0.451, but balanced accuracy is 0.535 (95% 0.480 to 0.577), ROC-AUC 0.515, validation balanced accuracy 0.492 and held-out 0.503; it does NOT clear the pre-registered bar, so it is not a demonstrated winner.
6. **Fastest model?** Among real models: the decision tree and logistic regression (about 0.2 ms per field, verified). Fast, but with no skill.
7. **Actual inference speed?** Single-field p50 on this CPU, verified: 0.17 to 28.3 ms across the 15 algorithms (most between 0.2 and 4 ms; random forest and extra trees 17 to 28 ms). Batch throughput 6,179 to 901,599 fields per second.
8. **Reliable on unseen farms and districts?** No. Held-out districts and the other season average about 0.50 balanced accuracy (chance 0.50) for the health tasks.
9. **Does the backend use the newly trained model?** No.
10. **Is CHM ready for production?** The existing NDVI rule app works as before, but there is no validated satellite crop-health model: **NOT READY**.
11. **What remains incomplete?** Backend integration and model export (by design), a self-contained deep-model artifact, the safety layer (I-01), clean-machine timings, an independent test set, severity labels, raw bands for NDWI / EVI, the integration-database tests, and the licence answer. See sections M and N.
