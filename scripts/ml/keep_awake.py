#!/usr/bin/env python3
"""Keep Windows from sleeping while a long training run is going, without changing any power setting.

Asks Windows to stay awake (SetThreadExecutionState) for as long as this process runs, and exits when the given stop file
appears or after --max-hours. Run 4 lost hours of wall-clock time because the laptop slept mid-training.

    python scripts/ml/keep_awake.py --stop-file .local/ml-logs/run.stop
"""

import argparse
import ctypes
import sys
import time
from pathlib import Path

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stop-file", type=Path, required=True)
    parser.add_argument("--max-hours", type=float, default=6.0)
    args = parser.parse_args()
    if sys.platform != "win32":
        print("Only needed on Windows", file=sys.stderr)
        return 0
    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
    deadline = time.monotonic() + args.max_hours * 3600
    try:
        while time.monotonic() < deadline and not args.stop_file.exists():
            time.sleep(15)
    finally:
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)  # back to normal power behaviour
    return 0


if __name__ == "__main__":
    sys.exit(main())
