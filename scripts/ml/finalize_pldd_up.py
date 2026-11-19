#!/usr/bin/env python3
"""Finish a PLDD-UP training run whose final step (test evaluation + model.pth) did not complete.

This happened when persistent data-loader workers kept ~11 GB of RAM and scikit-learn could not allocate memory at the
end of run 3. `best-checkpoint.pth` (selected on validation loss during training) and the per-epoch log are intact, so
this script re-does only the final step with the same code and writes the same files as train_pldd_up.py.
It never overwrites existing results.
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import numpy as np
import sklearn
import torch
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, precision_recall_fscore_support
from torch.utils.data import DataLoader

from train_pldd_up import CLASSES, DATASET_ID, MEAN, STD, LeafDataset, build_model, load_cache, load_manifest

ROOT = Path(__file__).resolve().parents[2]
EPOCH_LINE = re.compile(r"epoch (\d+)/(\d+)\s+train_loss=([\d.]+) train_acc=([\d.]+)\s+val_loss=([\d.]+) val_acc=([\d.]+)\s+elapsed=(\d+)s")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True, help="model directory containing best-checkpoint.pth")
    parser.add_argument("--log", type=Path, required=True, help="stderr log of the training run (per-epoch lines)")
    parser.add_argument("--manifest", type=Path, default=ROOT / ".local/datasets/up/pldd-up/processed/training-manifest.json")
    parser.add_argument("--source", type=Path, default=ROOT / ".local/datasets/up/pldd-up/extracted")
    parser.add_argument("--cache", type=Path, default=ROOT / ".local/datasets/up/pldd-up/processed/cache-224")
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    run = args.run
    for name in ("evaluation.json", "model.pth", "model-metadata.json"):
        if (run / name).exists():
            print(f"{run / name} already exists; refusing to overwrite", file=sys.stderr)
            return 2
    config = json.loads((run / "training-config.json").read_text(encoding="utf-8"))
    rows = [m.groups() for m in map(EPOCH_LINE.match, args.log.read_text(encoding="utf-8").splitlines()) if m]
    if len(rows) != config["epochs"]:
        print(f"Log has {len(rows)} epoch lines but the run was configured for {config['epochs']}", file=sys.stderr)
        return 2
    history = {
        "train_loss": [float(r[2]) for r in rows], "train_accuracy": [float(r[3]) for r in rows],
        "validation_loss": [float(r[4]) for r in rows], "validation_accuracy": [float(r[5]) for r in rows],
    }
    checkpoint = torch.load(run / "best-checkpoint.pth", map_location="cpu", weights_only=False)
    best_epoch = history["validation_loss"].index(min(history["validation_loss"])) + 1
    if checkpoint["epoch"] != best_epoch:
        print(f"Checkpoint epoch {checkpoint['epoch']} != best epoch in log {best_epoch}", file=sys.stderr)
        return 2

    manifest, samples = load_manifest(args.manifest)
    cache_index = load_cache(args.cache, manifest, samples)
    test_rows = [s for s in samples if s["split"] == "test"]
    loader = DataLoader(LeafDataset(test_rows, args.source, False, args.cache, cache_index), batch_size=64, shuffle=False, num_workers=args.workers)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_model().to(device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    actual, predicted = [], []
    with torch.inference_mode():
        for images, labels in loader:
            predicted.extend(model(images.to(device)).argmax(dim=1).cpu().tolist())
            actual.extend(labels.tolist())

    ids = list(range(len(CLASSES)))
    class_metrics = classification_report(actual, predicted, labels=ids, target_names=CLASSES, output_dict=True, zero_division=0)
    precision, recall, f1, _ = precision_recall_fscore_support(actual, predicted, labels=ids, average=None, zero_division=0)
    evaluation = {
        "dataset_id": DATASET_ID, "test_samples": len(actual), "accuracy": accuracy_score(actual, predicted),
        "macro_precision": float(np.mean(precision)), "macro_recall": float(np.mean(recall)), "macro_f1": float(np.mean(f1)),
        "per_class": class_metrics, "confusion_matrix": confusion_matrix(actual, predicted, labels=ids).tolist(),
        "test_split_counts": config["split_counts"]["test"],
        "warning": "Research evaluation only; not a validated commercial diagnostic.",
    }
    manifest_digest = hashlib.sha256(args.manifest.read_bytes()).hexdigest()
    torch.save({
        "dataset_id": DATASET_ID, "model_version": "pldd-up-mobilenet-v2-experimental-1", "architecture": "mobilenet_v2", "classes": CLASSES,
        "normalization_mean": MEAN, "normalization_std": STD, "training_manifest_sha256": manifest_digest,
        "source_manifest_sha256": manifest["source_manifest_sha256"], "model_state_dict": checkpoint["model_state_dict"],
    }, run / "model.pth")
    metadata = {
        "dataset_id": DATASET_ID, "model_version": "pldd-up-mobilenet-v2-experimental-1", "architecture": "mobilenet_v2", "trained": True,
        "recovered_final_step": True,
        "recovery_note": "Training completed all epochs; the final evaluation step ran out of memory and was re-run from best-checkpoint.pth with finalize_pldd_up.py.",
        "training_manifest_sha256": manifest_digest, "source_manifest_sha256": manifest["source_manifest_sha256"],
        "model_sha256": hashlib.sha256((run / "model.pth").read_bytes()).hexdigest(),
        "training_duration_seconds": float(rows[-1][6]), "evaluation": evaluation,
        "software_versions": {"scikit_learn": sklearn.__version__, "torch": torch.__version__},
    }
    (run / "evaluation.json").write_text(json.dumps(evaluation, indent=2) + "\n", encoding="utf-8")
    (run / "training-history.json").write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")
    (run / "model-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    cm = evaluation["confusion_matrix"]
    print(json.dumps({"test_accuracy": round(evaluation["accuracy"], 4), "macro_f1": round(evaluation["macro_f1"], 4),
                      "diseased_called_healthy": f"{cm[1][0] + cm[2][0]}/{sum(cm[1]) + sum(cm[2])}"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
