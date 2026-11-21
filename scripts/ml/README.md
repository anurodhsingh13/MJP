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
