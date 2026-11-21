#!/usr/bin/env python3
"""End-to-end safety estimate: photo-quality gate -> classifier -> "not sure" rule.

The gate is the app's existing `photo_quality_assessment` (backend/engine/main.py); its thresholds are copied here (the
resolution check is skipped because the cached test images are already 224 px). The classifier threshold and temperature
come from calibrate_pldd_up.py (chosen on validation only). Test photos are scored once per condition.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageFilter, ImageStat
from torchvision import transforms

from calibrate_pldd_up import load_model
from robustness_pldd_up import CLASSES, MEAN, PERTURBATIONS, STD

ROOT = Path(__file__).resolve().parents[2]


def gate_issues(image: Image.Image) -> list[str]:
    """Same checks and thresholds as backend/engine/main.py photo_quality_assessment (minus the resolution check)."""
    sample = image.copy()
    sample.thumbnail((256, 256))
    gray = sample.convert("L")
    stat = ImageStat.Stat(gray)
    brightness, contrast = float(stat.mean[0]), float(stat.stddev[0])
    sharpness = float(ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES)).stddev[0])
    issues = []
    if brightness < 48:
        issues.append("underexposed")
    elif brightness > 220:
        issues.append("overexposed")
    if contrast < 22:
        issues.append("low_contrast")
    if sharpness < 14:
        issues.append("possible_blur")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--calibration", type=Path, required=True, help="calibration.json from calibrate_pldd_up.py")
    parser.add_argument("--manifest", type=Path, default=ROOT / ".local/datasets/up/pldd-up/processed/training-manifest.json")
    parser.add_argument("--cache", type=Path, default=ROOT / ".local/datasets/up/pldd-up/processed/cache-224")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    calibration = json.loads(args.calibration.read_text(encoding="utf-8"))
    temperature, threshold = calibration["temperature"], calibration["threshold"]
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_model(args.model, device)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    index = json.loads((args.cache / "index.json").read_text(encoding="utf-8"))
    position = {p: i for i, p in enumerate(index["relative_paths"])}
    array = np.load(args.cache / "images.npy", mmap_mode="r")
    test = [s for s in manifest["images"] if s["split"] == "test"]
    labels = np.array([CLASSES.index(s["label"]) for s in test])
    sick = labels > 0
    to_tensor = transforms.Compose([transforms.ToTensor(), transforms.Normalize(MEAN, STD)])
    rows = {}
    print(f"{'condition':22s} {'gate passes':>11s} | {'of ALL photos: answered':>24s} {'diseased->healthy':>18s}")
    for name, perturb in PERTURBATIONS.items():
        images = [perturb(Image.fromarray(np.array(array[position[s["relative_path"]]]))) for s in test]
        passed = np.array([not gate_issues(im) for im in images])
        with torch.no_grad():
            probs = torch.cat([torch.softmax(model(torch.stack([to_tensor(im) for im in images[i:i + 128]]).to(device)).cpu() / temperature, 1)
                               for i in range(0, len(images), 128)]).numpy()
        confidence, pred = probs.max(1), probs.argmax(1)
        answered = passed & (confidence >= threshold)
        missed = ((pred == 0) & sick & answered).sum()
        rows[name] = {
            "gate_pass_percent": round(float(passed.mean() * 100), 1),
            "answered_percent_of_all": round(float(answered.mean() * 100), 1),
            "accuracy_when_answered": round(float((pred[answered] == labels[answered]).mean()), 4) if answered.any() else None,
            "diseased_called_healthy_percent_of_answered_diseased": round(float(missed / max(1, (sick & answered).sum()) * 100), 2),
        }
        r = rows[name]
        print(f"{name:22s} {r['gate_pass_percent']:10.1f}% | {r['answered_percent_of_all']:22.1f}% {r['diseased_called_healthy_percent_of_answered_diseased']:17.2f}%", flush=True)
    if args.output:
        args.output.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
