"""TimeSen2Crop -> fixed-length features. Each pixel's series (dates differ per tile) is binned into 24 half-month bins over the
agronomic year (1 Sep .. 31 Aug); per bin and band the median of clear observations (Flag==0) is kept, NaN if none.
Output per tile: .local/ml/timesen2crop/<tile>.npz with X (n, 24*9) float32, y (n,) int8."""
import csv, datetime as dt, os, sys, time
import numpy as np
from multiprocessing import Pool

ROOT = '.local/datasets/reference/timesen2crop/TimeSen2Crop/TimeSen2Crop'
OUT = '.local/ml/timesen2crop'
NBINS, NB = 24, 9

def bin_of(date: str) -> int:
    d = dt.datetime.strptime(date, '%Y%m%d').date()
    start = dt.date(d.year if d.month >= 9 else d.year - 1, 9, 1)
    return min(NBINS - 1, int((d - start).days / (365 / NBINS)))

def read_pixel(path: str) -> np.ndarray:
    with open(path, 'rb') as f:
        body = f.read().split(b'\n', 1)[1]
    return np.fromstring(body.replace(b'\n', b','), sep=',', dtype=np.float32).reshape(-1, NB + 1)

def tile_job(args):
    tile, cls, names = args
    return [read_pixel(os.path.join(ROOT, tile, cls, n)) for n in names]

def build_tile(tile: str, pool: Pool) -> tuple[int, float]:
    t0 = time.time()
    dates = [r[0] for r in csv.reader(open(os.path.join(ROOT, tile, 'dates.csv')))][1:]
    bins = np.array([bin_of(d) for d in dates])
    jobs, labels = [], []
    for cls in sorted(os.listdir(os.path.join(ROOT, tile)), key=lambda c: (not c.isdigit(), int(c) if c.isdigit() else 0)):
        cdir = os.path.join(ROOT, tile, cls)
        if not os.path.isdir(cdir): continue
        names = sorted(os.listdir(cdir))
        for i in range(0, len(names), 2000):
            chunk = names[i:i + 2000]; jobs.append((tile, cls, chunk)); labels += [int(cls)] * len(chunk)
    arrays = [a for part in pool.imap(tile_job, jobs) for a in part]
    data = np.stack(arrays)                                    # (n, T, 10)
    assert data.shape[1] == len(dates), (tile, data.shape, len(dates))
    clear = data[:, :, NB] == 0
    X = np.full((data.shape[0], NBINS, NB), np.nan, np.float32)
    for b in range(NBINS):
        cols = np.where(bins == b)[0]
        if not len(cols): continue
        vals = np.where(clear[:, cols, None], data[:, cols, :NB], np.nan)   # (n, k, 9)
        with np.errstate(all='ignore'):
            X[:, b, :] = np.nanmedian(vals, axis=1)
    np.savez_compressed(os.path.join(OUT, f'{tile}.npz'), X=X.reshape(len(X), -1), y=np.array(labels, np.int8))
    return len(labels), time.time() - t0

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    tiles = sys.argv[1:] or sorted(t for t in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT, t)))
    with Pool(max(2, (os.cpu_count() or 4) - 2)) as pool:
        for tile in tiles:
            if os.path.exists(os.path.join(OUT, f'{tile}.npz')): print(tile, 'already built', flush=True); continue
            n, s = build_tile(tile, pool); print(f'{tile}: {n} pixels in {s:.0f}s', flush=True)
