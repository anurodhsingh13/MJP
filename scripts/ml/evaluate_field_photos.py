#!/usr/bin/env python3
"""Score the research model on real, expert-labelled field photos (one folder per class).

This is the number that matters before any app integration: public test splits come from other farms and cameras.
Photos are used exactly as a farmer would send them: the app's photo-quality gate runs on the original photo, then the
image is resized to 224x224 (as in training), then the temperature-scaled "not sure" rule from calibration.json applies.

    python scripts/ml/evaluate_field_photos.py --photos D:/field-photos --model .local/models/pldd-up-run4/model.pth \
        --calibration .local/models/pldd-up-run4/calibration.json

Folder names must be exactly the model's classes: Healthy, Early Blight, Late Blight. Nothing here is used for training
and no photo is copied or uploaded; the report holds file names only (no photo content, no GPS).
"""

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps
from torchvision import transforms

from calibrate_pldd_up import load_model
from pipeline_pldd_up import gate_issues
from robustness_pldd_up import CLASSES, MEAN, STD

SUFFIXES = {".jpg", ".jpeg", ".png"}
MIN_PER_CLASS = 30  # below this, per-class numbers are shown but flagged as too few to trust


def wilson(successes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    if total == 0:
        return (0.0, 1.0)
    p = successes / total
    denominator = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denominator
    margin = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return (max(0.0, centre - margin), min(1.0, centre + margin))


def interval(successes: int, total: int) -> str:
    low, high = wilson(successes, total)
    return f"{successes / total * 100:.1f}% (95% range {low * 100:.0f}-{high * 100:.0f}%, n={total})" if total else "n/a (no photos)"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--photos", type=Path, required=True, help="folder with one sub-folder per class")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--calibration", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=None, help="write the JSON report here (outside the photo folder)")
    args = parser.parse_args()

    folders = {p.name: p for p in args.photos.iterdir() if p.is_dir()}
    unknown = sorted(set(folders) - set(CLASSES))
    if unknown:
        print(f"Unknown class folders: {unknown}. Expected: {CLASSES}", file=sys.stderr)
        return 2
    files = [(path, CLASSES.index(name)) for name, folder in folders.items() for path in sorted(folder.rglob("*")) if path.suffix.lower() in SUFFIXES]
    if not files:
        print("No photos found.", file=sys.stderr)
        return 2

    calibration = json.loads(args.calibration.read_text(encoding="utf-8"))
    temperature, threshold = calibration["temperature"], calibration["threshold"]
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_model(args.model, device)
    to_tensor = transforms.Compose([transforms.Resize((224, 224)), transforms.ToTensor(), transforms.Normalize(MEAN, STD)])

    labels, preds, confidences, gate_ok, unreadable, names = [], [], [], [], [], []
    for path, label in files:
        try:
            with Image.open(path) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
        except Exception:  # noqa: BLE001
            unreadable.append(path.name)
            continue
        issues = gate_issues(image)
        with torch.no_grad():
            probabilities = torch.softmax(model(to_tensor(image).unsqueeze(0).to(device)).cpu() / temperature, 1)[0]
        labels.append(label)
        preds.append(int(probabilities.argmax()))
        confidences.append(float(probabilities.max()))
        gate_ok.append(not issues)
        names.append(path.name)
    labels, preds, confidences, gate_ok = map(np.array, (labels, preds, confidences, gate_ok))
    answered = gate_ok & (confidences >= threshold)
    sick = labels > 0

    print(f"\n{len(labels)} photos scored ({len(unreadable)} unreadable). Classes: " + ", ".join(f"{c} {int((labels == i).sum())}" for i, c in enumerate(CLASSES)))
    thin = [c for i, c in enumerate(CLASSES) if (labels == i).sum() < MIN_PER_CLASS]
    if thin:
        print(f"WARNING: fewer than {MIN_PER_CLASS} photos for {thin}; their numbers are too uncertain to rely on.")
    report = {
        "photos": int(len(labels)), "unreadable": unreadable,
        "class_counts": {c: int((labels == i).sum()) for i, c in enumerate(CLASSES)},
        "too_few_photos_for": thin,
        "accuracy_if_every_photo_were_answered": interval(int((preds == labels).sum()), len(labels)),
        "diseased_called_healthy_if_every_photo_were_answered": interval(int(((preds == 0) & sick).sum()), int(sick.sum())),
        "gate_pass": interval(int(gate_ok.sum()), len(labels)),
        "answered_after_gate_and_not_sure_rule": interval(int(answered.sum()), len(labels)),
        "accuracy_when_answered": interval(int((preds[answered] == labels[answered]).sum()), int(answered.sum())),
        "diseased_called_healthy_when_answered": interval(int(((preds == 0) & sick & answered).sum()), int((sick & answered).sum())),
        "confusion_matrix_rows_true_cols_predicted": [[int(((labels == t) & (preds == p)).sum()) for p in range(len(CLASSES))] for t in range(len(CLASSES))],
        "classes": CLASSES,
        "wrong_files_when_answered": [names[i] for i in np.where(answered & (preds != labels))[0]],
        "acceptance_reference": "Declared integration criterion: diseased-called-Healthy within the agreed limit (research limit used so far: 1.0%) on the app's own photos, with enough photos per class that the 95% range is narrow.",
    }
    for key, value in report.items():
        if key not in ("classes", "wrong_files_when_answered", "unreadable", "acceptance_reference"):
            print(f"{key:58s} {value}")
    if args.output:
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"report written to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
