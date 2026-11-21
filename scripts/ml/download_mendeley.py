#!/usr/bin/env python3
"""Download files of a public Mendeley Data record and verify each against the SHA-256 the record publishes.

Only for datasets whose licence is recorded as allowed in datasets/TRAINING-DATA-REGISTER.md. Resumable (HTTP Range), refuses
to overwrite a finished file, and deletes nothing.

    python scripts/ml/download_mendeley.py --dataset th422bg4yd --version 1 --file WheatLeafRust.zip --output .local/datasets/wheat-iari
"""

import argparse
import hashlib
import json
import sys
import time
import urllib.request
from pathlib import Path

API = "https://data.mendeley.com/public-api/datasets/{id}/files?folder_id=root&version={version}"


def get_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, target: Path, size: int) -> None:
    partial = target.with_suffix(target.suffix + ".part")
    for attempt in range(40):
        have = partial.stat().st_size if partial.exists() else 0
        if have == size:
            break
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Range": f"bytes={have}-"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response, partial.open("ab" if have else "wb") as out:
                if response.status == 200 and have:  # server ignored Range: start over
                    out.truncate(0)
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
        except Exception as error:  # noqa: BLE001 - retry on any transient network error
            print(f"  retry {attempt + 1}: {str(error)[:80]}", file=sys.stderr, flush=True)
            time.sleep(min(30, 2 + attempt * 2))
    if not partial.exists() or partial.stat().st_size != size:
        raise RuntimeError(f"incomplete download of {target.name}")
    partial.replace(target)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--version", type=int, default=1)
    parser.add_argument("--file", required=True, help="exact file name in the record")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    files = get_json(API.format(id=args.dataset, version=args.version))
    match = next((f for f in files if f["filename"] == args.file), None)
    if match is None:
        print(f"{args.file} not found; available: {[f['filename'] for f in files]}", file=sys.stderr)
        return 2
    details = match["content_details"]
    size, expected = int(details["size"]), details["sha256_hash"]
    args.output.mkdir(parents=True, exist_ok=True)
    target = args.output / args.file
    if target.exists():
        print(f"{target} already exists; verifying only", file=sys.stderr)
    else:
        print(f"downloading {args.file} ({size / 1e6:.0f} MB)", file=sys.stderr, flush=True)
        download(details["download_url"], target, size)
    actual = sha256_of(target)
    ok = actual == expected
    print(json.dumps({"file": str(target), "bytes": target.stat().st_size, "sha256": actual, "published_sha256": expected, "verified": ok,
                      "doi": f"10.17632/{args.dataset}.{args.version}"}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
