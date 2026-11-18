#!/usr/bin/env python3
"""Train and evaluate the isolated experimental PLDD-UP image classifier."""

import argparse
import hashlib
import io
import json
import random
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import sklearn
import torch
import torchvision
from PIL import Image, ImageOps
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, precision_recall_fscore_support
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms


ROOT = Path(__file__).resolve().parents[2]
DATASET_ID = "pldd-up-potato-leaf-disease"
CLASSES = ["Healthy", "Early Blight", "Late Blight"]
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]


class RandomJpeg:
    """Re-encode as a low-quality JPEG, like a compressed messaging-app photo."""

    def __init__(self, probability: float = 0.4, quality: tuple[int, int] = (15, 60)):
        self.probability, self.quality = probability, quality

    def __call__(self, image: Image.Image) -> Image.Image:
        if random.random() >= self.probability:
            return image
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=random.randint(*self.quality))
        buffer.seek(0)
        return Image.open(buffer).convert("RGB")


class LeafDataset(Dataset):
    def __init__(self, samples: list[dict[str, Any]], source_root: Path, train: bool,
                 cache_dir: Path | None = None, cache_index: dict[str, int] | None = None,
                 strong_augment: bool = False):
        augmentation = [
            transforms.Resize((224, 224)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomRotation(10),
            transforms.ColorJitter(brightness=0.15, contrast=0.15, saturation=0.1),
        ]
        if strong_augment:
            # Field phone-photo problems: dim/glare, washed-out colour, blur, compression, off-centre framing, rotation.
            augmentation = [
                transforms.Resize((224, 224)),
                transforms.RandomResizedCrop(224, scale=(0.5, 1.0), ratio=(0.8, 1.25)),
                transforms.RandomHorizontalFlip(),
                transforms.RandomVerticalFlip(),
                transforms.RandomRotation(40),
                transforms.ColorJitter(brightness=0.5, contrast=0.4, saturation=0.6, hue=0.03),
                transforms.RandomApply([transforms.GaussianBlur(9, sigma=(0.1, 3.0))], p=0.4),
                RandomJpeg(),
            ]
        evaluation = [transforms.Resize((224, 224))]
        self.transform = transforms.Compose(
            (augmentation if train else evaluation) +
            [transforms.ToTensor(), transforms.Normalize(MEAN, STD)]
        )
        self.samples = samples
        self.source_root = source_root
        self.class_to_index = {name: index for index, name in enumerate(CLASSES)}
        # Pre-resized 224x224 images (see cache_pldd_up.py). The array is opened lazily inside each worker process.
        self.cache_file = (cache_dir / "images.npy") if cache_dir is not None else None
        self.cache_index = cache_index
        self._cache_array = None

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        sample = self.samples[index]
        if self.cache_file is not None:
            if self._cache_array is None:
                self._cache_array = np.load(self.cache_file, mmap_mode="r")
            pixels = np.array(self._cache_array[self.cache_index[sample["relative_path"]]])
            return self.transform(Image.fromarray(pixels)), self.class_to_index[sample["label"]]
        path = (self.source_root / sample["relative_path"]).resolve()
        if self.source_root.resolve() not in path.parents:
            raise ValueError("Training manifest path escapes the image root")
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            return self.transform(image), self.class_to_index[sample["label"]]


def load_manifest(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("dataset_id") != DATASET_ID or manifest.get("classes") != CLASSES:
        raise ValueError("Training manifest does not describe the expected PLDD-UP classes")
    if manifest.get("validation", {}).get("valid") is not True:
        raise ValueError("Inventory validation did not pass; rebuild the dataset inventory before training")
    source_manifest_hash = manifest.get("source_manifest_sha256")
    if not isinstance(source_manifest_hash, str) or len(source_manifest_hash) != 64:
        raise ValueError("Training manifest is missing the source manifest checksum")
    samples = manifest.get("images")
    if not isinstance(samples, list) or not samples:
        raise ValueError("Training manifest has no images")
    seen_groups: dict[str, str] = {}
    seen_hashes: dict[str, str] = {}
    for sample in samples:
        split = sample.get("split")
        label = sample.get("label")
        group = sample.get("duplicate_group")
        digest = sample.get("sha256")
        if split not in ("train", "validation", "test") or label not in CLASSES:
            raise ValueError("Training manifest contains an invalid split or class label")
        if not isinstance(group, str) or not isinstance(digest, str) or len(digest) != 64:
            raise ValueError("Training manifest image is missing duplicate or checksum metadata")
        if group in seen_groups and seen_groups[group] != split:
            raise ValueError(f"Duplicate group {group} crosses dataset splits")
        if digest in seen_hashes and seen_hashes[digest] != split:
            raise ValueError(f"Exact duplicate checksum {digest} crosses dataset splits")
        seen_groups[group] = split
        seen_hashes[digest] = split
    for split in ("train", "validation", "test"):
        if not any(sample["split"] == split for sample in samples):
            raise ValueError(f"Training manifest has an empty {split} split")
    return manifest, samples


def build_model():
    model = models.mobilenet_v2(weights=None)
    model.classifier[1] = nn.Linear(model.last_channel, len(CLASSES))
    return model


def verify_source_files(samples: list[dict[str, Any]], source_root: Path):
    root = source_root.resolve()
    for sample in samples:
        path = (root / sample["relative_path"]).resolve()
        if root not in path.parents:
            raise ValueError("Training manifest path escapes the image root")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != sample["sha256"]:
            raise ValueError(f"Image checksum changed since inventory: {sample['relative_path']}")


def load_cache(cache_dir: Path, manifest: dict[str, Any], samples: list[dict[str, Any]]) -> dict[str, int]:
    """Check that the pre-resized image cache belongs to exactly this verified inventory."""
    index = json.loads((cache_dir / "index.json").read_text(encoding="utf-8"))
    if index.get("size") != 224 or index.get("source_manifest_sha256") != manifest["source_manifest_sha256"]:
        raise ValueError("Image cache does not match the source manifest; rebuild it")
    position = {path: i for i, path in enumerate(index["relative_paths"])}
    for sample in samples:
        i = position.get(sample["relative_path"])
        if i is None or index["sha256"][i] != sample["sha256"]:
            raise ValueError(f"Image cache is missing or stale for {sample['relative_path']}")
    array = np.load(cache_dir / "images.npy", mmap_mode="r")
    if array.shape != (index["count"], 224, 224, 3) or array.dtype != np.uint8:
        raise ValueError("Image cache array has an unexpected shape")
    return position


def train(
    manifest_path: Path,
    source_root: Path,
    output: Path,
    epochs: int = 10,
    batch_size: int = 32,
    learning_rate: float = 0.001,
    seed: int = 42,
    device_name: str | None = None,
    workers: int = 0,
    cache_dir: Path | None = None,
    cosine: bool = False,
    strong_augment: bool = False,
) -> dict[str, Any]:
    if epochs < 1 or batch_size < 1 or learning_rate <= 0:
        raise ValueError("Epochs and batch size must be positive, and learning rate must be greater than zero")
    torch.manual_seed(seed)
    np.random.seed(seed)
    random.seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    device = torch.device(device_name or ("cuda" if torch.cuda.is_available() else "cpu"))
    manifest, samples = load_manifest(manifest_path)
    if source_root.resolve() == output.resolve() or source_root.resolve() in output.resolve().parents:
        raise ValueError("Model outputs must be outside the extracted source tree")
    cache_index = None
    if cache_dir is not None:
        # The cache was built from checksum-verified originals and is matched to the manifest here.
        cache_index = load_cache(cache_dir, manifest, samples)
    else:
        verify_source_files(samples, source_root)
    grouped = {
        split: [sample for sample in samples if sample["split"] == split]
        for split in ("train", "validation", "test")
    }
    for split, rows in grouped.items():
        missing = sorted(set(CLASSES) - {row["label"] for row in rows})
        if missing:
            raise ValueError(f"{split} split is missing classes: {', '.join(missing)}")

    output.mkdir(parents=True, exist_ok=False)
    configuration = {
        "dataset_id": DATASET_ID,
        "source_manifest_sha256": manifest["source_manifest_sha256"],
        "architecture": "torchvision.mobilenet_v2",
        "software_versions": {
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "torchvision": torchvision.__version__,
            "scikit_learn": sklearn.__version__,
        },
        "pretrained_weights": False,
        "pretrained_reason": "No weights were downloaded; training starts from random initialization.",
        "image_size": [224, 224],
        "normalization_mean": MEAN,
        "normalization_std": STD,
        "augmentation": (["resized_crop_0.5-1", "flips", "rotation_40", "colour_jitter_strong", "blur_p0.4", "jpeg_q15-60_p0.4"] if strong_augment else ["horizontal_flip", "rotation_degrees_10", "color_jitter_train_only"]),
        "seed": seed,
        "epochs": epochs,
        "batch_size": batch_size,
        "learning_rate": learning_rate,
        "device": str(device),
        "image_cache": str(cache_dir) if cache_dir is not None else None,
        "lr_schedule": "cosine_annealing_to_zero" if cosine else "constant",
        "split_counts": {
            split: {label: sum(row["label"] == label for row in rows) for label in CLASSES}
            for split, rows in grouped.items()
        },
        "imbalance_ratio": round(
            max(configuration_count for configuration_count in (
                sum(row["label"] == label for row in grouped["train"]) for label in CLASSES
            )) / min(
                sum(row["label"] == label for row in grouped["train"]) for label in CLASSES
            ), 4
        ),
    }
    (output / "training-config.json").write_text(json.dumps(configuration, indent=2) + "\n", encoding="utf-8")
    train_loader = DataLoader(
        LeafDataset(grouped["train"], source_root, True, cache_dir, cache_index, strong_augment),
        batch_size=batch_size, shuffle=True, num_workers=workers, persistent_workers=workers > 0,
    )
    validation_loader = DataLoader(
        LeafDataset(grouped["validation"], source_root, False, cache_dir, cache_index),
        batch_size=batch_size, shuffle=False, num_workers=workers, persistent_workers=workers > 0,
    )
    test_loader = DataLoader(
        LeafDataset(grouped["test"], source_root, False, cache_dir, cache_index),
        batch_size=batch_size, shuffle=False, num_workers=workers, persistent_workers=workers > 0,
    )
    model = build_model().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs) if cosine else None
    criterion = nn.CrossEntropyLoss()
    history = {"train_loss": [], "train_accuracy": [], "validation_loss": [], "validation_accuracy": []}
    started = time.monotonic()
    best_loss = float("inf")
    best_state: dict[str, torch.Tensor] | None = None

    def evaluate(loader: DataLoader, with_gradients: bool):
        model.train(with_gradients)
        total_loss, total, correct = 0.0, 0, 0
        for images, labels in loader:
            images, labels = images.to(device), labels.to(device)
            if with_gradients:
                optimizer.zero_grad(set_to_none=True)
            with torch.set_grad_enabled(with_gradients):
                logits = model(images)
                loss = criterion(logits, labels)
                if with_gradients:
                    loss.backward()
                    optimizer.step()
            total_loss += loss.item() * labels.size(0)
            correct += (logits.argmax(dim=1) == labels).sum().item()
            total += labels.size(0)
        return total_loss / total, correct / total

    for _ in range(epochs):
        train_loss, train_accuracy = evaluate(train_loader, True)
        validation_loss, validation_accuracy = evaluate(validation_loader, False)
        history["train_loss"].append(train_loss)
        history["train_accuracy"].append(train_accuracy)
        history["validation_loss"].append(validation_loss)
        history["validation_accuracy"].append(validation_accuracy)
        if scheduler is not None:
            scheduler.step()
        print(f"epoch {len(history['train_loss'])}/{epochs}  train_loss={train_loss:.4f} train_acc={train_accuracy:.4f}  val_loss={validation_loss:.4f} val_acc={validation_accuracy:.4f}  elapsed={time.monotonic() - started:.0f}s", file=sys.stderr, flush=True)
        if validation_loss < best_loss:
            best_loss = validation_loss
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
            torch.save({
                "epoch": len(history["train_loss"]),
                "validation_loss": validation_loss,
                "model_state_dict": best_state,
            }, output / "best-checkpoint.pth")

    if best_state is None:
        raise RuntimeError("Training did not produce a validation checkpoint")
    model.load_state_dict(best_state)
    model.eval()
    actual_labels, predictions = [], []
    with torch.inference_mode():
        for images, labels in test_loader:
            logits = model(images.to(device))
            predictions.extend(logits.argmax(dim=1).cpu().tolist())
            actual_labels.extend(labels.tolist())

    class_metrics = classification_report(
        actual_labels, predictions, labels=list(range(len(CLASSES))),
        target_names=CLASSES, output_dict=True, zero_division=0,
    )
    precision, recall, f1, _ = precision_recall_fscore_support(
        actual_labels, predictions, labels=list(range(len(CLASSES))), average=None, zero_division=0,
    )
    evaluation = {
        "dataset_id": DATASET_ID,
        "test_samples": len(actual_labels),
        "accuracy": accuracy_score(actual_labels, predictions),
        "macro_precision": float(np.mean(precision)),
        "macro_recall": float(np.mean(recall)),
        "macro_f1": float(np.mean(f1)),
        "per_class": class_metrics,
        "confusion_matrix": confusion_matrix(
            actual_labels, predictions, labels=list(range(len(CLASSES)))
        ).tolist(),
        "test_split_counts": configuration["split_counts"]["test"],
        "warning": "Research evaluation only; not a validated commercial diagnostic.",
    }
    duration = time.monotonic() - started
    manifest_digest = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    torch.save({
        "dataset_id": DATASET_ID,
        "model_version": "pldd-up-mobilenet-v2-experimental-1",
        "architecture": "mobilenet_v2",
        "classes": CLASSES,
        "normalization_mean": MEAN,
        "normalization_std": STD,
        "training_manifest_sha256": manifest_digest,
        "source_manifest_sha256": manifest["source_manifest_sha256"],
        "model_state_dict": best_state,
    }, output / "model.pth")
    model_hash = hashlib.sha256((output / "model.pth").read_bytes()).hexdigest()
    metadata = {
        "dataset_id": DATASET_ID,
        "model_version": "pldd-up-mobilenet-v2-experimental-1",
        "architecture": "mobilenet_v2",
        "trained": True,
        "training_manifest_sha256": manifest_digest,
        "source_manifest_sha256": manifest["source_manifest_sha256"],
        "model_sha256": model_hash,
        "training_duration_seconds": round(duration, 2),
        "evaluation": evaluation,
        "limitations": [
            "Field-collected leaf photographs from Mainpuri, Etawah and Jaswantnagar only.",
            "Not satellite-matched field labels or live crop-health observations.",
            "Experimental classification probabilities are not diagnostic confidence.",
            "Not validated across all Uttar Pradesh districts or potato varieties.",
        ],
    }
    (output / "evaluation.json").write_text(json.dumps(evaluation, indent=2) + "\n", encoding="utf-8")
    (output / "training-history.json").write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")
    (output / "model-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        figure, axes = plt.subplots(1, 2, figsize=(10, 4))
        axes[0].plot(history["train_loss"], label="Train")
        axes[0].plot(history["validation_loss"], label="Validation")
        axes[0].set_title("Loss")
        axes[1].plot(history["train_accuracy"], label="Train")
        axes[1].plot(history["validation_accuracy"], label="Validation")
        axes[1].set_title("Accuracy")
        for axis in axes:
            axis.set_xlabel("Epoch")
            axis.legend()
        figure.tight_layout()
        figure.savefig(output / "learning-curves.png", dpi=150)
        plt.close(figure)
    except ImportError:
        print("matplotlib is unavailable; JSON learning curves were still written.", file=sys.stderr)
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / ".local/datasets/up/pldd-up/processed/training-manifest.json")
    parser.add_argument("--source", type=Path, default=ROOT / ".local/datasets/up/pldd-up/extracted")
    parser.add_argument("--output", type=Path, default=ROOT / ".local/models/pldd-up")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--workers", type=int, default=4, help="Data-loading processes (0 = main process only)")
    parser.add_argument("--strong-augment", action="store_true", help="Phone-photo style augmentation (blur, glare, JPEG, crop, rotation)")
    parser.add_argument("--cosine", action="store_true", help="Cosine learning-rate decay over the run")
    parser.add_argument("--cache", type=Path, default=None, help="Pre-resized image cache from cache_pldd_up.py (much faster)")
    args = parser.parse_args()
    try:
        result = train(args.manifest, args.source, args.output, args.epochs, args.batch_size,
                       args.learning_rate, args.seed, workers=args.workers, cache_dir=args.cache, cosine=args.cosine, strong_augment=args.strong_augment)
    except (OSError, ValueError, RuntimeError) as error:
        print(json.dumps({"trained": False, "error": str(error)}, indent=2), file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
