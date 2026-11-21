#!/usr/bin/env python3
"""Resize every PLDD-UP training image once to 224x224 and store them in one uint8 array.

Why: the source photos are up to 3000x4496 pixels. Decoding them every epoch (3 images/s) keeps the GPU idle. The
training pipeline's first step is already `Resize((224, 224))`, so caching exactly that result changes nothing about
what the model sees; it only removes repeated decoding.

Safety: each original file's SHA-256 is checked against the verified inventory while it is read, the cache is written
outside the extracted source tree, and an existing cache is never overwritten.
"""

import argparse
import hashlib
import json
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SIZE = 224


def load_one(job):
    index, path, expected_sha256 = job
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError(f"Image checksum changed since inventory: {path.name}")
    import io
    with Image.open(io.BytesIO(data)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB").resize((SIZE, SIZE), Image.BILINEAR)
    return index, np.asarray(image, dtype=np.uint8)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / ".local/datasets/up/pldd-up/processed/training-manifest.json")
    parser.add_argument("--source", type=Path, default=ROOT / ".local/datasets/up/pldd-up/extracted")
    parser.add_argument("--output", type=Path, default=ROOT / ".local/datasets/up/pldd-up/processed/cache-224")
    parser.add_argument("--workers", type=int, default=10)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    if manifest.get("validation", {}).get("valid") is not True:
        print("Inventory validation did not pass", file=sys.stderr)
        return 2
    source = args.source.resolve()
    output = args.output.resolve()
    if source == output or source in output.parents:
        print("The cache must be written outside the extracted source tree", file=sys.stderr)
        return 2
    if output.exists():
        print(f"{output} already exists; refusing to overwrite", file=sys.stderr)
        return 2
    samples = manifest["images"]
    jobs = []
    for index, sample in enumerate(samples):
        path = (source / sample["relative_path"]).resolve()
        if source not in path.parents:
            print("Manifest path escapes the image root", file=sys.stderr)
            return 2
        jobs.append((index, path, sample["sha256"]))

    output.mkdir(parents=True)
    array = np.lib.format.open_memmap(output / "images.npy", mode="w+", dtype=np.uint8, shape=(len(samples), SIZE, SIZE, 3))
    started = time.monotonic()
    done = 0
    with Pool(args.workers) as pool:
        for index, pixels in pool.imap_unordered(load_one, jobs, chunksize=8):
            array[index] = pixels
            done += 1
            if done % 1000 == 0 or done == len(jobs):
                print(f"{done}/{len(jobs)} images  {time.monotonic() - started:.0f}s", file=sys.stderr, flush=True)
    array.flush()
    index_document = {
        "size": SIZE,
        "count": len(samples),
        "source_manifest_sha256": manifest["source_manifest_sha256"],
        "relative_paths": [sample["relative_path"] for sample in samples],
        "sha256": [sample["sha256"] for sample in samples],
        "resample": "PIL BILINEAR (same as torchvision Resize on a PIL image)",
    }
    (output / "index.json").write_text(json.dumps(index_document), encoding="utf-8")
    print(json.dumps({"cached": len(samples), "seconds": round(time.monotonic() - started), "path": str(output)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
