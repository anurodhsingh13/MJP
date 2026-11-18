#!/usr/bin/env python3
"""How much does the PLDD-UP classifier degrade on lower-quality phone photos?

Re-scores the held-out TEST images after typical field-photo problems (dim light, glare, blur, heavy JPEG compression,
off-centre framing, rotation). This is a cheap stress test, not a substitute for photos from other farms.
"""

import argparse
import io
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageEnhance, ImageFilter
from torchvision import models, transforms

ROOT = Path(__file__).resolve().parents[2]
CLASSES = ["Healthy", "Early Blight", "Late Blight"]
MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]


def jpeg(image: Image.Image, quality: int) -> Image.Image:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    buffer.seek(0)
    return Image.open(buffer).convert("RGB")


def crop(image: Image.Image) -> Image.Image:
    w, h = image.size
    return image.crop((int(w * .25), int(h * .25), int(w * .95), int(h * .95))).resize((w, h), Image.BILINEAR)


PERTURBATIONS = {
    "none (as trained)": lambda im: im,
    "dim light (x0.5)": lambda im: ImageEnhance.Brightness(im).enhance(0.5),
    "glare (x1.7)": lambda im: ImageEnhance.Brightness(im).enhance(1.7),
    "blur (radius 3)": lambda im: im.filter(ImageFilter.GaussianBlur(3)),
    "heavy JPEG (q=15)": lambda im: jpeg(im, 15),
    "off-centre crop": crop,
    "rotated 40 degrees": lambda im: im.rotate(40, resample=Image.BILINEAR),
    "low colour (x0.3)": lambda im: ImageEnhance.Color(im).enhance(0.3),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True, help="model.pth from train_pldd_up.py")
    parser.add_argument("--manifest", type=Path, default=ROOT / ".local/datasets/up/pldd-up/processed/training-manifest.json")
    parser.add_argument("--cache", type=Path, default=ROOT / ".local/datasets/up/pldd-up/processed/cache-224")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = models.mobilenet_v2(weights=None)
    model.classifier[1] = torch.nn.Linear(model.last_channel, len(CLASSES))
    state = torch.load(args.model, map_location="cpu", weights_only=False)
    model.load_state_dict(state["model_state_dict"] if isinstance(state, dict) and "model_state_dict" in state else state)
    model.eval().to(device)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    index = json.loads((args.cache / "index.json").read_text(encoding="utf-8"))
    position = {p: i for i, p in enumerate(index["relative_paths"])}
    array = np.load(args.cache / "images.npy", mmap_mode="r")
    test = [s for s in manifest["images"] if s["split"] == "test"]
    labels = np.array([CLASSES.index(s["label"]) for s in test])
    to_tensor = transforms.Compose([transforms.ToTensor(), transforms.Normalize(MEAN, STD)])
    rows = {}
    for name, perturb in PERTURBATIONS.items():
        predictions = []
        for start in range(0, len(test), 128):
            batch = [to_tensor(perturb(Image.fromarray(np.array(array[position[s["relative_path"]]])))) for s in test[start:start + 128]]
            with torch.no_grad():
                predictions.extend(model(torch.stack(batch).to(device)).argmax(1).cpu().tolist())
        predictions = np.array(predictions)
        sick = labels > 0
        rows[name] = {"accuracy": round(float((predictions == labels).mean()), 4),
                      "diseased_called_healthy_percent": round(float(((predictions == 0) & sick).sum() / sick.sum() * 100), 2)}
        print(f"{name:22s} accuracy {rows[name]['accuracy']:.4f}   diseased called Healthy {rows[name]['diseased_called_healthy_percent']:.2f}%", flush=True)
    if args.output:
        args.output.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
