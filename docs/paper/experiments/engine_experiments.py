"""Controlled experiments that drive the real TerraScope /calculate-indices endpoint.

E1: cloud-fraction sweep -> valid coverage, NDVI error, acceptance under default policy.
E2: stressed-patch sweep -> anomaly-area recall/precision and two-date decline flag rate.
Usage: python -I engine_experiments.py <repo_root> <out_json>
"""
import json, os, sys, tempfile
import numpy as np

repo, out = sys.argv[1], sys.argv[2]
sys.path.insert(0, repo)
import rasterio
from rasterio.transform import from_origin
from fastapi.testclient import TestClient
from backend.engine.main import app

client = TestClient(app)
N, PIX, X0, Y0 = 120, 0.0001, 77.2, 28.6          # 120x120 grid, ~11 m pixels
POLY = {"type": "Polygon", "coordinates": [[[77.201, 28.599], [77.211, 28.599], [77.211, 28.589],
                                             [77.201, 28.589], [77.201, 28.599]]]}
MIN_COV, MIN_PIX, DECLINE = 70, 10, 0.10           # shared/evidence.ts defaultPolicy

def write(path, arr):
    with rasterio.open(path, 'w', driver='GTiff', height=N, width=N, count=1, dtype=arr.dtype,
                       crs='EPSG:4326', transform=from_origin(X0, Y0, PIX, PIX)) as dst:
        dst.write(arr, 1)

def field_mask():
    rows, cols = np.mgrid[0:N, 0:N]
    lon, lat = X0 + (cols + .5) * PIX, Y0 - (rows + .5) * PIX
    return (lon > 77.201) & (lon < 77.211) & (lat < 28.599) & (lat > 28.589)

INSIDE = field_mask()

def scene(ndvi, scl, d):
    red = np.full((N, N), 0.08, np.float32)
    nir = (red * (1 + ndvi) / (1 - ndvi)).astype(np.float32)   # exact inverse of NDVI
    paths = [os.path.join(d, n) for n in ('red.tif', 'nir.tif', 'scl.tif')]
    write(paths[0], red); write(paths[1], nir); write(paths[2], scl.astype(np.uint8))
    r = client.post('/calculate-indices', json={'redUrl': paths[0], 'nirUrl': paths[1], 'sclUrl': paths[2],
                                                 'polygonGeojson': POLY})
    return r.status_code, (r.json() if r.status_code == 200 else None)

def cloud_blobs(rng, frac):
    """Spatially clustered clouds: threshold a smoothed noise field to hit the target fraction."""
    if frac <= 0: return np.zeros((N, N), bool)
    noise = rng.normal(size=(N, N))
    k = np.ones(15) / 15
    for axis in (0, 1):
        noise = np.apply_along_axis(lambda v: np.convolve(v, k, 'same'), axis, noise)
    return noise >= np.quantile(noise[INSIDE], 1 - frac)

def e1(rng, reps=10):
    rows = []
    for frac in np.round(np.arange(0, 1.0001, .05), 2):
        for rep in range(reps):
            ndvi = np.clip(rng.normal(0.62, 0.06, (N, N)), -.9, .95)
            clouds = cloud_blobs(rng, frac)
            scl = np.where(clouds, 9, 4)                           # 9 = cloud high probability, 4 = vegetation
            with tempfile.TemporaryDirectory() as d:
                code, res = scene(ndvi, scl, d)
            clear = INSIDE & ~clouds
            truth = float(ndvi[clear].mean()) if clear.any() else None
            if res:
                accepted = res['validCoverage'] >= MIN_COV and res['validPixels'] >= MIN_PIX
                rows.append({'cloud': float(frac), 'rep': rep, 'status': code, 'coverage': res['validCoverage'],
                             'pixels': res['validPixels'], 'ndvi': res['ndvi'], 'truth_clear': truth,
                             'truth_all': float(ndvi[INSIDE].mean()), 'accepted': accepted})
            else:
                rows.append({'cloud': float(frac), 'rep': rep, 'status': code, 'accepted': False})
    return rows

def e2(rng, reps=10):
    rows = []
    for frac in np.round(np.arange(0, .61, .05), 2):
        for rep in range(reps):
            base = np.clip(rng.normal(0.70, 0.05, (N, N)), -.9, .95)
            later = np.clip(base + rng.normal(0, 0.02, (N, N)), -.9, .95)
            patch = np.zeros((N, N), bool)
            if frac > 0:   # square stressed patch inside the field covering `frac` of its area
                ys, xs = np.where(INSIDE); side = int(round(np.sqrt(frac * INSIDE.sum())))
                y0, x0 = ys.min() + rng.integers(0, ys.ptp() - side + 2), xs.min() + rng.integers(0, xs.ptp() - side + 2)
                patch[y0:y0 + side, x0:x0 + side] = True; patch &= INSIDE
                later = np.where(patch, np.clip(later - 0.30, -.9, .95), later)
            scl = np.full((N, N), 4)
            with tempfile.TemporaryDirectory() as d:
                _, r0 = scene(base, scl, d)
            with tempfile.TemporaryDirectory() as d:
                _, r1 = scene(later, scl, d)
            true_frac = float(patch.sum() / INSIDE.sum())
            change = r1['ndvi'] - r0['ndvi']
            rows.append({'patch': true_frac, 'rep': rep, 'change': round(change, 4),
                         'flagged': change <= -DECLINE, 'affected': r1['affectedCoverage'] / 100})
    return rows

rng = np.random.default_rng(42)
result = {'grid': N, 'field_pixels': int(INSIDE.sum()), 'policy': [MIN_COV, MIN_PIX, DECLINE],
          'e1': e1(rng), 'e2': e2(rng)}
json.dump(result, open(out, 'w'), indent=1)
print('field pixels', result['field_pixels'], 'e1 rows', len(result['e1']), 'e2 rows', len(result['e2']))
