#!/usr/bin/env python3
"""Confidence calibration and an "I am not sure" rule for the PLDD-UP classifier.

1. Temperature scaling is fitted on the VALIDATION split only.
2. A confidence threshold is chosen on VALIDATION so that, among photos the model answers, at most TARGET percent of
   diseased leaves are called Healthy (the costly mistake for a farmer). The validation photos are pooled with the same
   phone-photo problems used below, because a model that is confidently wrong on a blurry photo needs a rule that
   notices it; tuning on clean photos alone picks a threshold that never abstains.
3. The TEST split is then scored once, clean and after typical phone-photo problems, to see how many bad photos the
   rule turns into "retake the photo" instead of a confident wrong answer.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torchvision import models, transforms

from robustness_pldd_up import CLASSES, MEAN, PERTURBATIONS, STD

ROOT = Path(__file__).resolve().parents[2]


def load_model(path: Path, device):
    model = models.mobilenet_v2(weights=None)
    model.classifier[1] = torch.nn.Linear(model.last_channel, len(CLASSES))
    state = torch.load(path, map_location="cpu", weights_only=False)
    model.load_state_dict(state["model_state_dict"] if isinstance(state, dict) and "model_state_dict" in state else state)
    return model.eval().to(device)


def logits_for(model, device, images, perturb):
    to_tensor = transforms.Compose([transforms.ToTensor(), transforms.Normalize(MEAN, STD)])
    out = []
    for start in range(0, len(images), 128):
        batch = [to_tensor(perturb(Image.fromarray(np.array(a)))) for a in images[start:start + 128]]
        with torch.no_grad():
            out.append(model(torch.stack(batch).to(device)).cpu())
    return torch.cat(out)


def fit_temperature(logits: torch.Tensor, labels: torch.Tensor) -> float:
    best, best_loss = 1.0, float("inf")
    for t in np.arange(0.5, 4.01, 0.05):
        loss = torch.nn.functional.cross_entropy(logits / t, labels).item()
        if loss < best_loss:
            best, best_loss = float(t), loss
    return round(best, 2)


def ece(prob: np.ndarray, correct: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (prob > lo) & (prob <= hi)
        if mask.any():
            total += mask.mean() * abs(correct[mask].mean() - prob[mask].mean())
    return float(total)


def answered_stats(prob, pred, labels, threshold):
    keep = prob >= threshold
    sick = labels > 0
    missed = ((pred == 0) & sick & keep).sum()
    return {
        "answered_percent": round(float(keep.mean() * 100), 1),
        "accuracy_when_answered": round(float((pred[keep] == labels[keep]).mean()), 4) if keep.any() else None,
        "diseased_called_healthy_percent_of_answered_diseased": round(float(missed / max(1, (sick & keep).sum()) * 100), 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=ROOT / ".local/datasets/up/pldd-up/processed/training-manifest.json")
    parser.add_argument("--cache", type=Path, default=ROOT / ".local/datasets/up/pldd-up/processed/cache-224")
    parser.add_argument("--target-missed-percent", type=float, default=1.0)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_model(args.model, device)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    index = json.loads((args.cache / "index.json").read_text(encoding="utf-8"))
    position = {p: i for i, p in enumerate(index["relative_paths"])}
    array = np.load(args.cache / "images.npy", mmap_mode="r")

    def split(name):
        rows = [s for s in manifest["images"] if s["split"] == name]
        return [array[position[s["relative_path"]]] for s in rows], np.array([CLASSES.index(s["label"]) for s in rows])

    val_images, val_labels = split("validation")
    test_images, test_labels = split("test")
    identity = PERTURBATIONS["none (as trained)"]
    val_logits = logits_for(model, device, val_images, identity)
    temperature = fit_temperature(val_logits, torch.tensor(val_labels))
    val_prob_all = torch.softmax(val_logits / temperature, 1).numpy()
    val_prob, val_pred = val_prob_all.max(1), val_prob_all.argmax(1)

    # Validation pool = clean + every perturbation of the validation photos (test photos are never used here).
    pool_prob, pool_pred, pool_labels = [val_prob], [val_pred], [val_labels]
    for name, perturb in PERTURBATIONS.items():
        if name == "none (as trained)":
            continue
        probs = torch.softmax(logits_for(model, device, val_images, perturb) / temperature, 1).numpy()
        pool_prob.append(probs.max(1)); pool_pred.append(probs.argmax(1)); pool_labels.append(val_labels)
    pool_prob, pool_pred, pool_labels = np.concatenate(pool_prob), np.concatenate(pool_pred), np.concatenate(pool_labels)

    # Smallest threshold (= most photos answered) that keeps the pooled validation miss rate within the target.
    chosen = 1.0
    for threshold in np.arange(0.34, 1.0001, 0.005):
        stats = answered_stats(pool_prob, pool_pred, pool_labels, threshold)
        if stats["diseased_called_healthy_percent_of_answered_diseased"] <= args.target_missed_percent:
            chosen = float(round(threshold, 3))
            break
    result = {
        "temperature": temperature, "threshold": chosen, "target_missed_percent": args.target_missed_percent,
        "validation_clean": answered_stats(val_prob, val_pred, val_labels, chosen),
        "validation_pooled_with_perturbations": answered_stats(pool_prob, pool_pred, pool_labels, chosen),
        "ece_validation_before": round(ece(torch.softmax(val_logits, 1).numpy().max(1), (torch.softmax(val_logits, 1).numpy().argmax(1) == val_labels)), 4),
        "ece_validation_after": round(ece(val_prob, val_pred == val_labels), 4),
        "test": {},
    }
    for name, perturb in PERTURBATIONS.items():
        probs = torch.softmax(logits_for(model, device, test_images, perturb) / temperature, 1).numpy()
        prob, pred = probs.max(1), probs.argmax(1)
        result["test"][name] = {
            "no_abstention": {"accuracy": round(float((pred == test_labels).mean()), 4),
                              "diseased_called_healthy_percent": round(float(((pred == 0) & (test_labels > 0)).sum() / (test_labels > 0).sum() * 100), 2)},
            "with_abstention": answered_stats(prob, pred, test_labels, chosen),
        }
        w = result["test"][name]["with_abstention"]
        print(f"{name:22s} no-abstain acc {result['test'][name]['no_abstention']['accuracy']:.3f} miss {result['test'][name]['no_abstention']['diseased_called_healthy_percent']:5.2f}%  |  "
              f"answers {w['answered_percent']:5.1f}% of photos, acc {w['accuracy_when_answered']}, miss {w['diseased_called_healthy_percent_of_answered_diseased']}%", flush=True)
    print(f"temperature {temperature}  threshold {chosen}  ECE {result['ece_validation_before']} -> {result['ece_validation_after']}")
    if args.output:
        args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
