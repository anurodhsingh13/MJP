# Repository audit (before the satellite model comparison)

Written 2026-11-24 from the repository and the files on this machine. Sources are named so each statement can be checked.

## 1. What exists, and what is in the app

| Part | State |
|---|---|
| **Product pipeline** | Sentinel-2 (Google Earth Engine, or Earth Search as the open fallback) to NDVI / NDRE / NDMI, then a **rule-based alert** in `shared/evidence.ts` and `shared/advice.ts` (an NDVI drop of at least 0.10 within 30 days, or NDVI below 0.3 while growing). Gemini only turns that evidence into advice and can raise, never lower, the visit decision. **No trained satellite model is in the app.** |
| **Engine** (`backend/engine/main.py`) | FastAPI: index calculation, tiles, overlays, photo quality, and `/classify-potato-leaf`. |
| **Photo model in the app** | An *experimental* potato-leaf classifier (MobileNetV2, `pldd-up-run4`, loaded lazily from `.local/models`, behind a photo-quality gate and a calibrated "not sure" rule) is wired into the scouting photo preview (commit `c84d304`). It is a photo task. It is not a satellite health model, it is labelled "Not a diagnosis", and it has not been validated on this app's field photos. |
| **Research scripts** (`scripts/ml/`) | PLDD-UP photo classifier (5 runs, calibration, robustness), AgriFieldNet crop type, TimeSen2Crop features, Telangana satellite models and an NDVI peer-anomaly test. Report: `docs/research/ML-TRAINING-REPORT-2026-11.md`. |
| **Database / API** | PostgreSQL + PostGIS; observations in `vegetation_indices`. Nothing stores or serves a satellite model prediction. |

## 2. Datasets, labels and licences

Source of truth: `datasets/TRAINING-DATA-REGISTER.md`. See `docs/ml/DATASET_REPORT.md` for counts generated from the files.

| Dataset | Labels | Licence (register) | Usable for satellite health? |
|---|---|---|---|
| Telangana Crop Health Challenge (Zindi / GIZ / ADeX) | Healthy / Pests / Diseased / Stressed, one label per field per season, 7,888 fields | CC-BY-SA 4.0. **Owner accepted share-alike; scope for shipping a trained model not stated, so evaluation only and no shipped weights.** | **Yes, the only one.** 3,725 fields have a Sentinel-2 extract; 3,644 pass the quality rules |
| AgriFieldNet India | Crop type, 7,081 fields | CC-BY-4.0 | No health label. Earlier run: 59.1% accuracy, macro-F1 0.22 |
| TimeSen2Crop | 16 crop types, per pixel, EU, 2017-18 | CC BY 4.0 | No health label |
| PLDD-UP | Potato leaf photos: Healthy / Early / Late blight | CC BY 4.0 | Separate image task; photos have no GPS or date |

## 3. What earlier experiments already showed (not repeated blindly)

* **The app's rule alert has no skill** on 750 labelled Telangana fields: it alerted 81% of problem fields and 82% of healthy fields (AUC 0.454).
* **Gradient boosting on 3,644 fields** (NDVI / NDRE / NDMI phase curves, NASA POWER weather, survey columns): every feature set scored AUC 0.48 to 0.52, district-held-out and random CV, per crop too. The same features predicted crop type at 77% against 30% for the commonest class, so the features were working; the health labels were not readable from them.
* Peer-comparison anomaly on Telangana: AUC 0.49 to 0.51. District NDVI against official yield for 63 UP districts: r 0.01 to 0.2.
* Failed or inconclusive earlier: AgriFieldNet crop type (rare classes at 0.00 F1); Paddy Doctor needs a paid IEEE DataPort subscription; PLDD-UP photos cannot be matched to satellite pixels.

## 4. Data-quality problems that shape the plan

1. **Labels are survey answers**, season-level, undated, and not independently verified. No severity (mild / moderate / severe) exists, so **the four requested severity classes cannot be trained**.
2. **82% of kept fields are Healthy** (2,991 of 3,644). Accuracy is meaningless; balanced accuracy, macro-F1 and false-healthy rate are used.
3. **99% of fields were sown in 2023.** Year-held-out validation is impossible. Season- and district-held-out are the available tests.
4. **Only NDVI, NDRE and NDMI were extracted** (cloud-masked with SCL 0,1,2,3,8,9,10,11). B2, B3, B6, B7, B8A, B12 were not, so NDWI and EVI cannot be computed; no soil-moisture source exists.
5. Fourteen districts appear but seven hold under 150 fields together, so district-level scores exist only for the four largest.
6. `shap` failed to import on the first attempt (Application Control blocked a numba DLL) and imported fine later in the independent verification; XGBoost and LightGBM native TreeSHAP is used, and it matches `shap.TreeExplainer` exactly (difference 0.0). The installed PyTorch is a CPU build, so no GPU is used even though an RTX 4050 is present.

## 5. Strategy chosen

* One honest task family on the only labelled data: Healthy vs Problem, Healthy / Pests / Diseased / Stressed, and the cause among problem fields.
* Every suitable model type on the same rows, features and splits; leakage-safe splits plus district- and season-held-out fits; the test split untouched until selection (unit-tested).
* Selection rules fixed **before** results were read (`configs/ml/training_config.yaml`, `selection:`). Baselines (majority class and the app's NDVI rule) are shown next to every model.
* Sanity checks that say whether the numbers mean anything: shuffled labels, crop type from the same inputs, input-group ablation, learning curve.
* Abstention (`INSUFFICIENT_DATA_OR_LOW_CONFIDENCE`) with its threshold chosen on validation.
* **No backend integration** unless a model clears the bar *and* the data owner clears the licence question. No existing model or file is overwritten.
* A transformer is not trained: 3,644 fields with no detectable signal do not support it.

Outputs: `docs/ml/` (reports), `reports/ml/` (results and figures), `.local/ml/` and `.local/models/` (artifacts; git-ignored).
