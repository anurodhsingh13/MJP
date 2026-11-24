# Production readiness

## Decision

**No production-ready model has been established.** No model, on any task, cleared the pre-registered bar (validation balanced-accuracy interval above chance **and** held-out balanced accuracy at least chance + 0.03). The satellite indicators available here do not separate the survey-labelled problem fields from healthy ones better than chance, so none of these models should drive a farmer-facing health or stress call.

## The four questions

1. **Best model for CHM:** none is established. The model ranked highest on Healthy vs Problem is `logistic_regression`, but that ranking is noise: validation balanced accuracy 0.542 against chance 0.50, yet test 0.524, macro-F1 0.471, ROC-AUC 0.522. Across the 15 models (baselines excluded) on this task test balanced accuracy ranges from 0.449 to 0.558.
2. **How accurate:** test accuracy 0.539, but always answering Healthy scores 0.821, so accuracy is not the measure; balanced accuracy 0.524 (chance 0.50).
3. **How fast:** `logistic_regression` answers one field in 0.14 ms (p95 0.23 ms) on this CPU and takes 3 s to train; model size 0.00 MB. Speed is not the problem.
4. **Reliability on unseen farms and districts:** held-out districts and the other season average 0.508 balanced accuracy for `logistic_regression` (chance 0.50). False-healthy rate on test (stressed fields called Healthy): 0.500.

## Abstention (INSUFFICIENT_DATA_OR_LOW_CONFIDENCE)

The single prediction function is `scripts/ml/prediction_safety.py` (`predict_with_safety`). It answers only when ALL hold: the model passed the pre-registered validation bar (skill on held-out districts and the other season); the row is valid (finite values, inside a plausible envelope, not too many missing features, at least 3 clear observations, inside the training distribution); and the top-class probability reaches a threshold chosen on **validation** data (health tasks: false-healthy rate at most 10% with at least 20% of fields answered; cause task: the answered fields must beat chance by 0.10 balanced accuracy). Otherwise it returns INSUFFICIENT_DATA_OR_LOW_CONFIDENCE with the reasons. A model that cannot meet its target never answers.

also abstain on fewer than 3 clear observations and on inputs outside the training range. A model that cannot meet the safety target abstains on every field.

* Healthy vs Problem (lightgbm): threshold None, test coverage 0.00. the model did not pass the pre-registered validation bar, so it abstains on every field
* Healthy / Pests / Diseased / Stressed (xgboost): threshold None, test coverage 0.00. the model did not pass the pre-registered validation bar, so it abstains on every field
* Cause among problem fields (Pests / Diseased / Stressed) (xgboost): threshold None, test coverage 0.00. the model did not pass the pre-registered validation bar, so it abstains on every field

## Backend integration status

**Not integrated, on purpose.** (1) No model is approved. (2) The Telangana licence note in `datasets/TRAINING-DATA-REGISTER.md` limits this data to evaluation until the owner says a trained model may ship. The existing API is unchanged and no weights are committed. The safety function is implemented and unit-tested in `scripts/ml/prediction_safety.py`; it would move into `backend/engine/prediction_confidence.py` together with the first approved model.

## What is needed before any model can be called production-ready

* Dated, agronomist-confirmed stress observations with severity (mild / moderate / severe) for the same fields the satellite sees, at least 100 per class, collected in more than one season and several districts. The app already has `scripts/evaluate-ndvi-alerts.mjs` for scoring against visits.
* The raw Sentinel-2 bands (B2, B3, B6, B7, B8A, B12) re-extracted, so NDWI and EVI can be tested. This cannot be assumed to help: crop type is already readable from the current indicators while health is not.
* Written confirmation of whether a model trained on the Telangana (CC-BY-SA 4.0) data may ship.
* A pass limit agreed **before** the final test is looked at, then one independent evaluation.

## Final production-readiness decision

**NOT READY.** No model beats chance on unseen districts.
