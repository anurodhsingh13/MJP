# Model-training scripts (offline research, not part of the app runtime)

Nothing here is imported by the API, the engine or the frontend. Data and models live in the git-ignored `.local/`.
Read `datasets/TRAINING-DATA-REGISTER.md` before adding any dataset: only licences recorded there as allowed may be used.

## Environment

A separate virtual environment keeps the GPU build of PyTorch away from the app's engine:

```powershell
py -3.11 -m venv .venv-ml
.venv-ml\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
.venv-ml\Scripts\python.exe -m pip install pillow numpy scikit-learn matplotlib rasterio joblib
```

`requirements-ml.txt` lists the versions the reported results were produced with. On a slow connection download the
torch wheel with `curl -C -` and `pip install <file>.whl` (pip's own resume gave up after DNS errors).

## 1. Potato leaf photos (PLDD-UP, CC BY 4.0)

```powershell
# one-time: verify originals and resize to 224x224 (the source photos are up to 3000x4496; decoding them each epoch left the GPU idle)
.venv-ml\Scripts\python.exe scripts\ml\cache_pldd_up.py
# train (40 epochs, ~35 min on an RTX 4050); use a NEW --output each time
.venv-ml\Scripts\python.exe scripts\ml\train_pldd_up.py --epochs 40 --batch-size 64 --workers 8 --cosine --strong-augment --cache .local\datasets\up\pldd-up\processed\cache-224 --output .local\models\pldd-up-runN
# how fragile is it on phone-quality photos?
.venv-ml\Scripts\python.exe scripts\ml\robustness_pldd_up.py --model .local\models\pldd-up-runN\model.pth
# confidence calibration + "not sure" threshold chosen on validation only, then scored on test
.venv-ml\Scripts\python.exe scripts\ml\calibrate_pldd_up.py --model .local\models\pldd-up-runN\model.pth --output .local\models\pldd-up-runN\calibration.json
# photo-quality gate -> classifier -> "not sure" rule, end to end
.venv-ml\Scripts\python.exe scripts\ml\pipeline_pldd_up.py --model .local\models\pldd-up-runN\model.pth --calibration .local\models\pldd-up-runN\calibration.json
```

`prepare_pldd_up.py` builds the leakage-safe inventory/splits (duplicate groups never cross splits). It was already run;
its outputs are in `.local/datasets/up/pldd-up/processed/`.

## 2. Crop type from Sentinel-2 (AgriFieldNet India, CC-BY-4.0)

```powershell
.venv-ml\Scripts\python.exe scripts\ml\list_agrifieldnet.py .local\datasets\agrifieldnet\keys.json   # lists the public bucket, no download
.venv-ml\Scripts\python.exe scripts\ml\download_agrifieldnet.py                                       # ~330 MB, resumable
.venv-ml\Scripts\python.exe scripts\ml\train_agrifieldnet.py                                          # field-level model, split by chip
```

## Rules these scripts follow

* Hyper-parameters and thresholds are chosen on the validation split only; test is scored once per final model.
* Model outputs never overwrite an existing directory.
* Source images are checksum-verified against the inventory before any cache or training.
* A score on a public test split is not field accuracy; see `docs/research/ML-TRAINING-REPORT-2026-11.md`.

## 4. Satellite crop-health model comparison (Telangana labels) - one command

```powershell
.venv\Scripts\python.exe scripts\ml\run_all_experiments.py            # audit, features, splits, 15 models + 2 baselines x 3 tasks, reports (resumable)
.venv\Scripts\python.exe scripts\ml\run_all_experiments.py --force    # redo every model
cd scripts\ml; ..\..\.venv\Scripts\python.exe -m unittest test_ml_pipeline
```

Needs `xgboost lightgbm catboost optuna pandas pyyaml psutil` in `.venv` (`shap` is optional: XGBoost / LightGBM native TreeSHAP is used and was verified equal to it). CPU only.
Settings: `configs/ml/*.yaml` (selection rules were fixed before results were read). Reports: `docs/ml/` and `reports/ml/results.json`. Artifacts: `.local/ml/`, `.local/models/` (not committed: CC-BY-SA data, evaluation only).
Result on 2026-11-24: no model beats chance on Healthy vs Problem, so none is production ready; see `docs/ml/PRODUCTION_READINESS.md`.
