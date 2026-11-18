#!/usr/bin/env python3
"""Crop-type model from Sentinel-2 field statistics (AgriFieldNet India, CC-BY-4.0).

One sample = one agricultural field. Features are statistics of the 12 Sentinel-2 bands (and NDVI/NDWI/NDMI) over the
field's labelled pixels. Chips (not fields) are the unit of splitting, so neighbouring fields that share the same scene
never land in different splits; a field that crosses several chips is merged into one sample first.

Honest scope: the dataset is a single Sentinel-2 snapshot per chip from 2022 in four Indian states. The score on the
held-out chips is NOT the accuracy the app would have on another season or date.

Citation: Radiant Earth Foundation & IDinsight (2022), AgriFieldNet Competition Dataset v1.0, DOI 10.34911/rdnt.wu92p1.
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import rasterio
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.model_selection import GroupShuffleSplit

ROOT = Path(__file__).resolve().parents[2]
BANDS = ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B8A", "B09", "B11", "B12"]
CROPS = {1: "Wheat", 2: "Mustard", 3: "Lentil", 4: "No crop/Fallow", 5: "Green pea", 6: "Sugarcane", 8: "Garlic",
         9: "Maize", 13: "Gram", 14: "Coriander", 15: "Potato", 16: "Bersem", 36: "Rice"}
SEED = 42


def chip_ids(raw: Path) -> list[str]:
    pattern = re.compile(r"ref_agrifieldnet_competition_v1_labels_train_([0-9a-f]{5})\.tif$")
    return sorted(m.group(1) for p in (raw / "train_labels").iterdir() if (m := pattern.search(p.name)))


def read(path: Path) -> np.ndarray:
    with rasterio.open(path) as source:
        return source.read(1)


def collect_fields(raw: Path) -> tuple[dict[int, list[np.ndarray]], dict[int, list[int]], dict[int, str]]:
    """Pixels, crop labels and first chip id for every field across all chips."""
    pixels: dict[int, list[np.ndarray]] = {}
    crops: dict[int, list[int]] = {}
    first_chip: dict[int, str] = {}
    for chip in chip_ids(raw):
        folder = raw / "source" / f"ref_agrifieldnet_competition_v1_source_{chip}"
        bands = np.stack([read(folder / f"ref_agrifieldnet_competition_v1_source_{chip}_{band}_10m.tif") for band in BANDS]).astype(np.float32)
        crop = read(raw / "train_labels" / f"ref_agrifieldnet_competition_v1_labels_train_{chip}.tif")
        field = read(raw / "train_labels" / f"ref_agrifieldnet_competition_v1_labels_train_{chip}_field_ids.tif")
        for field_id in np.unique(field):
            if field_id == 0:
                continue
            mask = field == field_id
            labels = crop[mask]
            labels = labels[labels > 0]
            if labels.size == 0:
                continue
            fid = int(field_id)
            pixels.setdefault(fid, []).append(bands[:, mask].T)
            crops.setdefault(fid, []).extend(int(v) for v in labels)
            first_chip.setdefault(fid, chip)
    return pixels, crops, first_chip


def features(pixel_matrix: np.ndarray) -> np.ndarray:
    """pixel_matrix: (pixels, 12 bands). Statistics of bands and of three normalised-difference indices."""
    eps = 1e-6
    b = {name: pixel_matrix[:, i] for i, name in enumerate(BANDS)}
    ndvi = (b["B8A"] - b["B04"]) / (b["B8A"] + b["B04"] + eps)
    ndwi = (b["B03"] - b["B8A"]) / (b["B03"] + b["B8A"] + eps)
    ndmi = (b["B8A"] - b["B11"]) / (b["B8A"] + b["B11"] + eps)
    stack = np.column_stack([pixel_matrix, ndvi, ndwi, ndmi])
    parts = [stack.mean(0), stack.std(0), np.percentile(stack, 10, axis=0), np.percentile(stack, 50, axis=0), np.percentile(stack, 90, axis=0)]
    return np.concatenate(parts + [np.array([np.log1p(len(pixel_matrix))])])


def metrics(y_true, y_pred, names: list[str], labels: list[int]) -> dict:
    precision, recall, f1, support = precision_recall_fscore_support(y_true, y_pred, labels=labels, zero_division=0)
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "macro_f1": round(float(f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0)), 4),
        "per_class": {names[i]: {"precision": round(float(precision[i]), 3), "recall": round(float(recall[i]), 3), "f1": round(float(f1[i]), 3), "support": int(support[i])} for i in range(len(labels))},
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=labels).tolist(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, default=ROOT / ".local/datasets/agrifieldnet/raw")
    parser.add_argument("--output", type=Path, default=ROOT / ".local/models/agrifieldnet-run1")
    args = parser.parse_args()
    if args.output.exists():
        print(f"{args.output} exists; refusing to overwrite", file=sys.stderr)
        return 2
    started = time.monotonic()
    pixels, crops, first_chip = collect_fields(args.raw)
    field_ids = sorted(pixels)
    X = np.stack([features(np.concatenate(pixels[f])) for f in field_ids])
    y_raw = np.array([int(np.bincount(crops[f]).argmax()) for f in field_ids])
    groups = np.array([first_chip[f] for f in field_ids])
    labels_present = sorted(set(y_raw.tolist()))
    index = {crop: i for i, crop in enumerate(labels_present)}
    y = np.array([index[v] for v in y_raw])
    names = [CROPS.get(crop, str(crop)) for crop in labels_present]
    print(f"fields={len(field_ids)} chips={len(set(groups))} features={X.shape[1]} classes={len(names)} ({time.monotonic() - started:.0f}s)", file=sys.stderr, flush=True)

    outer = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=SEED)
    train_val, test = next(outer.split(X, y, groups))
    inner = GroupShuffleSplit(n_splits=1, test_size=0.1765, random_state=SEED)  # 15% of the total as validation
    tr_i, va_i = next(inner.split(X[train_val], y[train_val], groups[train_val]))
    train, validation = train_val[tr_i], train_val[va_i]
    assert not (set(groups[train]) & set(groups[validation]) or set(groups[train]) & set(groups[test]) or set(groups[validation]) & set(groups[test])), "chip leakage"
    label_ids = list(range(len(names)))

    def fit(**kwargs):
        model = HistGradientBoostingClassifier(class_weight="balanced", random_state=SEED, early_stopping=False, **kwargs)
        model.fit(X[train], y[train])
        return model

    # Choose the setting on the validation chips only; the test chips are scored once, at the end.
    grid = [dict(max_iter=150, learning_rate=0.08, max_leaf_nodes=15), dict(max_iter=300, learning_rate=0.05, max_leaf_nodes=31), dict(max_iter=400, learning_rate=0.04, max_leaf_nodes=15, l2_regularization=1.0)]
    scores = []
    best, best_f1 = None, -1.0
    for params in grid:
        model = fit(**params)
        score = f1_score(y[validation], model.predict(X[validation]), average="macro", zero_division=0)
        scores.append({"params": params, "validation_macro_f1": round(float(score), 4)})
        print(f"  {params} validation macro-F1 {score:.4f}", file=sys.stderr, flush=True)
        if score > best_f1:
            best, best_f1, best_params = model, score, params

    majority = int(np.bincount(y[train]).argmax())
    result = {
        "dataset": "AgriFieldNet Competition Dataset v1.0 (Radiant Earth Foundation & IDinsight, 2022, CC-BY-4.0, DOI 10.34911/rdnt.wu92p1)",
        "unit": "field", "split_by": "chip (first chip of each field)", "seed": SEED,
        "counts": {"fields": len(field_ids), "train": len(train), "validation": len(validation), "test": len(test)},
        "classes": names,
        "class_counts_total": {names[i]: int((y == i).sum()) for i in label_ids},
        "hyperparameter_search_on_validation": scores, "chosen": best_params,
        "validation": metrics(y[validation], best.predict(X[validation]), names, label_ids),
        "test": metrics(y[test], best.predict(X[test]), names, label_ids),
        "baseline_majority_class_test_accuracy": round(float((y[test] == majority).mean()), 4),
        "software": {"python": sys.version.split()[0], "scikit_learn": sklearn.__version__},
        "warning": "Single-date Sentinel-2 chips from 2022 in UP, Rajasthan, Odisha and Bihar. Not validated on other seasons, dates, states or the app's own fields.",
    }
    args.output.mkdir(parents=True)
    joblib.dump({"model": best, "classes": names, "class_codes": labels_present, "bands": BANDS}, args.output / "model.joblib")
    (args.output / "evaluation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"test_accuracy": result["test"]["accuracy"], "test_macro_f1": result["test"]["macro_f1"], "majority_baseline": result["baseline_majority_class_test_accuracy"], "seconds": round(time.monotonic() - started)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
