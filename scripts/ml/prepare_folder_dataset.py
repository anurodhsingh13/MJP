#!/usr/bin/env python3
"""Inventory and leakage-safe split for any "one folder per class" image dataset.

Writes the same training-manifest.json schema as prepare_pldd_up.py so cache_pldd_up.py and train_pldd_up.py work unchanged.

* every file is read once: SHA-256, decode check (Pillow), size and a 64-bit difference hash;
* exact duplicates (same SHA-256) and near duplicates (difference-hash Hamming distance <= 4) form groups;
* groups whose members carry different labels are dropped (label conflict) and listed in the report;
* groups, never single images, are assigned to train / validation / test (about 70/15/15, balanced per class), so a
  duplicate can never sit on both sides of a split. The publisher's own split is ignored on purpose and compared.
Near-identical photos of the same leaf that differ by more than the hash threshold can still straddle splits; the report says so.
"""

import argparse
import hashlib
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}
NEAR_DUPLICATE_FRACTION = 0.02  # of the 1,024 hash bits; overridden by --near-duplicate-fraction
HASH_BITS = 32 * 32
RATIOS = {"train": 0.70, "validation": 0.15, "test": 0.15}


def dhash(image: Image.Image) -> np.ndarray:
    """1,024-bit difference hash (33x32 grey). A 64-bit hash made different leaves on a black background look identical."""
    small = np.asarray(image.convert("L").resize((33, 32), Image.LANCZOS), dtype=np.int16)
    return np.packbits((small[:, 1:] > small[:, :-1]).flatten())


_POPCOUNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint16)


def hamming_matrix(hashes: np.ndarray) -> np.ndarray:
    n = len(hashes)
    matrix = np.zeros((n, n), dtype=np.uint16)
    for i in range(n):
        matrix[i] = _POPCOUNT[np.bitwise_xor(hashes, hashes[i])].sum(axis=1)
    return matrix


class Union:
    def __init__(self, n: int):
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def join(self, a: int, b: int) -> None:
        self.parent[self.find(a)] = self.find(b)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="extracted dataset root")
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--output", type=Path, required=True, help="new directory for the manifest and report")
    parser.add_argument("--rename", default="", help='label renames, e.g. "control=Healthy,diseased=Leaf rust"')
    parser.add_argument("--licence", default="")
    parser.add_argument("--attribution", default="")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--near-duplicate-fraction", type=float, default=NEAR_DUPLICATE_FRACTION,
                        help="fraction of the 1,024 hash bits that may differ for two photos to count as near duplicates (negative = exact duplicates only)")
    args = parser.parse_args()
    if args.output.exists():
        print(f"{args.output} exists; refusing to overwrite", file=sys.stderr)
        return 2
    source = args.source.resolve()
    renames = dict(pair.split("=", 1) for pair in args.rename.split(",") if "=" in pair)

    records, unreadable = [], []
    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        label = renames.get(path.parent.name, path.parent.name)
        data = path.read_bytes()
        try:
            with Image.open(path) as image:
                image.load()
                image = ImageOps.exif_transpose(image)
                width, height = image.size
                records.append({"relative_path": path.relative_to(source).as_posix(), "label": label, "sha256": hashlib.sha256(data).hexdigest(),
                                "width": width, "height": height, "hash": dhash(image),
                                "publisher_split": next((p for p in path.relative_to(source).parts if p in ("train", "val", "validation", "test")), None)})
        except Exception as error:  # noqa: BLE001
            unreadable.append({"file": path.name, "error": str(error)[:80]})
    classes = sorted({r["label"] for r in records})
    union = Union(len(records))
    by_sha: dict[str, int] = {}
    for i, r in enumerate(records):
        if r["sha256"] in by_sha:
            union.join(i, by_sha[r["sha256"]])
        else:
            by_sha[r["sha256"]] = i
    exact_groups = len({union.find(i) for i in range(len(records))})
    if args.near_duplicate_fraction >= 0:
        distances = hamming_matrix(np.stack([r["hash"] for r in records]))
        limit = int(args.near_duplicate_fraction * HASH_BITS)
        for i, j in np.argwhere(np.triu(distances <= limit, k=1)):
            union.join(int(i), int(j))
    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(len(records)):
        groups[union.find(i)].append(i)

    dropped, kept = [], []
    for members in groups.values():
        labels = {records[i]["label"] for i in members}
        (dropped if len(labels) > 1 else kept).append(members)

    # Balanced greedy assignment of whole groups to splits.
    rng = random.Random(args.seed)
    rng.shuffle(kept)
    kept.sort(key=lambda g: -len(g))
    totals = Counter(records[g[0]]["label"] for g in kept for _ in g)
    assigned = {s: Counter() for s in RATIOS}
    split_of: dict[int, str] = {}
    for g in kept:
        label = records[g[0]]["label"]
        best = max(RATIOS, key=lambda s: RATIOS[s] * totals[label] - assigned[s][label])
        for i in g:
            split_of[i] = best
        assigned[best][label] += len(g)

    group_ids = {}
    for k, members in enumerate(sorted((m for m in groups.values()), key=min)):
        for i in members:
            group_ids[i] = f"g{k:05d}"
    images = [{"relative_path": records[i]["relative_path"], "label": records[i]["label"], "split": split_of[i], "sha256": records[i]["sha256"],
               "duplicate_group": group_ids[i], "width": records[i]["width"], "height": records[i]["height"]} for i in sorted(split_of)]
    counts = {s: {c: sum(1 for im in images if im["split"] == s and im["label"] == c) for c in classes} for s in RATIOS}
    errors = [f"{s} split is missing {c}" for s in RATIOS for c in classes if counts[s][c] == 0]
    # Does the publisher's own split share duplicate groups across splits? (data-quality finding, not used for splitting)
    publisher_cross = 0
    for members in groups.values():
        publishers = {records[i]["publisher_split"] for i in members if records[i]["publisher_split"]}
        publisher_cross += 1 if len(publishers) > 1 else 0
    source_digest = hashlib.sha256("\n".join(f"{r['relative_path']}:{r['sha256']}" for r in records).encode()).hexdigest()
    manifest = {"dataset_id": args.dataset_id, "classes": classes, "validation": {"valid": not errors and not unreadable, "errors": errors},
                "source_manifest_sha256": source_digest, "licence": args.licence, "attribution": args.attribution, "seed": args.seed, "images": images}
    report = {
        "dataset_id": args.dataset_id, "licence": args.licence, "attribution": args.attribution, "classes": classes,
        "files_found": len(records) + len(unreadable), "unreadable": unreadable, "usable_images": len(images),
        "class_counts": dict(Counter(r["label"] for r in records)),
        "exact_duplicate_groups_with_more_than_one_file": sum(1 for g in groups.values() if len({records[i]["sha256"] for i in g}) < len(g)),
        "duplicate_groups_with_more_than_one_image": sum(1 for g in groups.values() if len(g) > 1),
        "label_conflict_groups_dropped": len(dropped), "images_dropped_for_label_conflict": sum(len(g) for g in dropped),
        "publisher_split_groups_crossing_splits": publisher_cross, "split_counts": counts,
        "near_duplicate_fraction": args.near_duplicate_fraction,
        "limits": ["Near-duplicate detection is a 1,024-bit difference hash; other photos of the same leaf can still straddle splits.",
                   "Scores on this split are not accuracy on other farms, cameras or seasons."],
    }
    args.output.mkdir(parents=True)
    (args.output / "training-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (args.output / "validation-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("usable_images", "class_counts", "duplicate_groups_with_more_than_one_image", "label_conflict_groups_dropped",
                                              "publisher_split_groups_crossing_splits", "split_counts")}, indent=1))
    return 0 if manifest["validation"]["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
