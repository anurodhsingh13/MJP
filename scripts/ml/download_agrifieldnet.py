#!/usr/bin/env python3
"""Download the AgriFieldNet Competition Dataset (CC-BY-4.0, ~330 MB) from Source Cooperative.

Resumable: a file that already exists with the listed size is skipped, and every file's size is checked at the end.
Citation required by the licence: Radiant Earth Foundation & IDinsight (2022), AgriFieldNet Competition Dataset v1.0,
DOI 10.34911/rdnt.wu92p1.
"""

import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://data.source.coop/radiantearth/"
PREFIX = "agrifieldnet-competition/"


def fetch(job):
    key, size, destination = job
    target = destination / key[len(PREFIX):]
    if target.exists() and target.stat().st_size == size:
        return "skipped"
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    for attempt in range(6):
        try:
            with urllib.request.urlopen(BASE + key, timeout=60) as response:
                data = response.read()
            if len(data) != size:
                raise IOError(f"size {len(data)} != listed {size}")
            partial.write_bytes(data)
            partial.replace(target)
            return "downloaded"
        except Exception:  # noqa: BLE001 - retry any transient network error
            time.sleep(1.5 * (attempt + 1))
    return "failed"


def main() -> int:
    keys_file = ROOT / ".local/datasets/agrifieldnet/keys.json"
    destination = ROOT / ".local/datasets/agrifieldnet/raw"
    keys = [(key, size) for key, size in json.loads(keys_file.read_text(encoding="utf-8")) if not key.endswith("/")]
    jobs = [(key, size, destination) for key, size in keys]
    started = time.monotonic()
    counts = {"downloaded": 0, "skipped": 0, "failed": 0}
    with ThreadPoolExecutor(16) as pool:
        for done, result in enumerate(pool.map(fetch, jobs), start=1):
            counts[result] += 1
            if done % 1000 == 0 or done == len(jobs):
                print(f"{done}/{len(jobs)} {counts} {time.monotonic() - started:.0f}s", file=sys.stderr, flush=True)
    bad = [key for key, size in keys if not (destination / key[len(PREFIX):]).exists() or (destination / key[len(PREFIX):]).stat().st_size != size]
    print(json.dumps({"files": len(keys), **counts, "size_mismatch_or_missing": len(bad)}))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
