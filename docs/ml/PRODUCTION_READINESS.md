# Production readiness

## Decision

**No production-ready model has been established.** No model, on any task, cleared the pre-registered bar (validation balanced-accuracy interval above chance **and** held-out balanced accuracy at least chance + 0.03). The satellite indicators available here do not separate the survey-labelled problem fields from healthy ones better than chance, so none of these models should drive a farmer-facing health or stress call.

## The four questions

1. **Best model for CHM:** none is established. The model ranked highest on Healthy vs Problem is `decision_tree`, but that ranking is noise: validation balanced accuracy 0.568 against chance 0.50, yet test 0.449, macro-F1 0.406, ROC-AUC 0.438. Across the 15 models (baselines excluded) on this task test balanced accuracy ranges from 0.449 to 0.558.
2. **How accurate:** test accuracy 0.463, but always answering Healthy scores 0.821, so accuracy is not the measure; balanced accuracy 0.449 (chance 0.50).
3. **How fast:** `decision_tree` answers one field in 0.10 ms (p95 0.25 ms) on this CPU and takes 3 s to train; model size 0.00 MB. Speed is not the problem.
4. **Reliability on unseen farms and districts:** held-out districts and the other season average 0.503 balanced accuracy for `decision_tree` (chance 0.50). False-healthy rate on test (stressed fields called Healthy): 0.571.

## Abstention (INSUFFICIENT_DATA_OR_LOW_CONFIDENCE)

The rule: answer only when the top-class probability reaches a threshold chosen on **validation** data so that the false-healthy rate stays at or below 10% while at least 20% of fields are answered; also abstain on fewer than 3 clear observations and on inputs outside the training range. A model that cannot meet the safety target abstains on every field.

* Healthy vs Problem (lightgbm): threshold None, test coverage 0.00. no confidence threshold met the safety target on validation, so the model abstains on every field
* Healthy / Pests / Diseased / Stressed (xgboost): threshold None, test coverage 0.00. no confidence threshold met the safety target on validation, so the model abstains on every field
* Cause among problem fields (Pests / Diseased / Stressed) (xgboost): threshold {'threshold': 0.3, 'coverage': 1.0}, test coverage 1.00, accuracy when answered 0.408 (commonest class would score 0.388). There is no Healthy class here, so no false-healthy target applies: the threshold sits at the 0.30 floor and the model never abstains on confidence. That is not a safety result, and its accuracy is within noise of the commonest class.

## Backend integration status

**Not integrated, on purpose.** (1) No model is approved. (2) The Telangana licence note in `datasets/TRAINING-DATA-REGISTER.md` limits this data to evaluation until the owner says a trained model may ship. The existing API is unchanged and no weights are committed. The abstention rule is implemented and tested in `scripts/ml/ml_common.py`; it would move into `backend/engine/prediction_confidence.py` together with the first approved model.

## What is needed before any model can be called production-ready

* Dated, agronomist-confirmed stress observations with severity (mild / moderate / severe) for the same fields the satellite sees, at least 100 per class, collected in more than one season and several districts. The app already has `scripts/evaluate-ndvi-alerts.mjs` for scoring against visits.
* The raw Sentinel-2 bands (B2, B3, B6, B7, B8A, B12) re-extracted, so NDWI and EVI can be tested. This cannot be assumed to help: crop type is already readable from the current indicators while health is not.
* Written confirmation of whether a model trained on the Telangana (CC-BY-SA 4.0) data may ship.
* A pass limit agreed **before** the final test is looked at, then one independent evaluation.

## Final production-readiness decision

**NOT READY.** No model beats chance on unseen districts.
