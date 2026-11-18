#!/usr/bin/env python3
"""List the public AgriFieldNet bucket on Source Cooperative and print counts/sizes per folder (no download)."""

import json
import re
import sys
import urllib.parse
import urllib.request
from collections import defaultdict

BASE = "https://data.source.coop/radiantearth"
PREFIX = "agrifieldnet-competition/"


def page(token: str | None):
    query = {"list-type": "2", "prefix": PREFIX, "max-keys": "1000"}
    if token:
        query["continuation-token"] = token
    with urllib.request.urlopen(f"{BASE}?{urllib.parse.urlencode(query)}", timeout=60) as response:
        return response.read().decode("utf-8")


def main() -> int:
    keys: list[tuple[str, int]] = []
    token = None
    while True:
        body = page(token)
        for match in re.finditer(r"<Contents><Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", body, re.S):
            keys.append((match.group(1), int(match.group(2))))
        truncated = "<IsTruncated>true</IsTruncated>" in body
        found = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", body)
        if not truncated or not found:
            break
        token = found.group(1)
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for key, size in keys:
        folder = key[len(PREFIX):].split("/")[0] or "(root)"
        totals[folder][0] += 1
        totals[folder][1] += size
    print(json.dumps({folder: {"files": n, "megabytes": round(total / 1e6, 1)} for folder, (n, total) in sorted(totals.items())}, indent=1))
    print("example keys:")
    for key, size in keys[:3] + keys[len(keys) // 2:len(keys) // 2 + 3]:
        print(" ", key, size)
    if len(sys.argv) > 1:
        with open(sys.argv[1], "w", encoding="utf-8") as handle:
            json.dump(keys, handle)
    return 0


if __name__ == "__main__":
    sys.exit(main())
