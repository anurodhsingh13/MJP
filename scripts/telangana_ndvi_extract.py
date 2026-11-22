"""Pull Sentinel-2 NDVI time series for a stratified sample of Telangana Crop Health fields.

Uses the same collection, cloud classes and NDVI formula as backend/engine/earth_engine.py
(S2_SR_HARMONIZED, reflectance x 0.0001, SCL classes 0,1,2,3,8,9,10,11 masked) and the
same authentication (ADC without quota project).

  .venv/Scripts/python scripts/telangana_ndvi_extract.py [--per-class 150 --healthy 300 --min-ha 0.3]

Output (git-ignored): .local/datasets/labelled/telangana-ndvi/{sample.csv,ndvi.csv}
Resumable: fields already present in ndvi.csv are skipped.
"""
import argparse, csv, os, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path

import random
from types import SimpleNamespace
from pyproj import Transformer
from shapely import wkt
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / '.local/datasets/labelled/zindi-telangana-crop-health/files/Train.csv'
OUT = ROOT / '.local/datasets/labelled/telangana-ndvi'
if '--full' in sys.argv:
    sys.argv.remove('--full'); OUT = ROOT / '.local/datasets/labelled/telangana-s2-full'; FULL = True
else:
    FULL = False
INVALID_SCL = (0, 1, 2, 3, 8, 9, 10, 11)
LEAD_DAYS = 35  # image history before sowing (the app's alert looks 30 days back)


def load_env():
    for line in (ROOT / '.env.local').read_text(encoding='utf-8').splitlines():
        if line.startswith('EARTH_ENGINE_PROJECT_ID='):
            return line.split('=', 1)[1].strip().strip('"')
    sys.exit('EARTH_ENGINE_PROJECT_ID missing in .env.local')


def sample_fields(per_class, healthy, min_ha, seed=7):
    to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:32644', always_xy=True).transform
    pool = {}
    with open(SRC, newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            g = wkt.loads(r['geometry'])
            ha = transform(to_utm, g).area / 10000
            if ha < min_ha:
                continue
            pool.setdefault(r['category'], []).append(SimpleNamespace(
                FarmID=int(r['FarmID']), category=r['category'], Crop=r['Crop'], Season=r['Season'], geom=g, area_ha=ha,
                sdate=datetime.strptime(r['SDate'].split()[0], '%Y-%m-%d').strftime('%Y-%m-%d'),
                hdate=datetime.strptime(r['HDate'].split()[0], '%Y-%m-%d').strftime('%Y-%m-%d')))
    rng = random.Random(seed)
    out = []
    for cat, n in (('Healthy', healthy), ('Pests', per_class), ('Diseased', per_class), ('Stressed', per_class)):
        out += pool[cat] if FULL else rng.sample(pool[cat], min(n, len(pool[cat])))
    return sorted(out, key=lambda r: r.sdate)


def init_ee(project):
    import ee, google.auth
    creds, _ = google.auth.default()
    ee.Initialize(credentials=creds.with_quota_project(None), project=project)
    return ee


def extract_chunk(ee, rows):
    out = []
    for row in rows:
        geom = ee.Geometry(row.geom.__geo_interface__)
        start = (datetime.fromisoformat(row.sdate) - timedelta(days=LEAD_DAYS)).strftime('%Y-%m-%d')
        end = (datetime.fromisoformat(row.hdate) + timedelta(days=2)).strftime('%Y-%m-%d')
        col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterDate(start, end).filterBounds(geom)

        def per_image(img):
            scl = img.select('SCL')
            ok = scl.mask()
            for c in INVALID_SCL:
                ok = ok.And(scl.neq(c))
            refl = img.select(['B4', 'B5', 'B8', 'B11']).multiply(0.0001)
            def nd(a, b, name):
                den = refl.select(a).add(refl.select(b))
                return refl.select(a).subtract(refl.select(b)).divide(den).updateMask(den.neq(0)).rename(name).updateMask(ok)
            ind = nd('B8', 'B4', 'ndvi').addBands(nd('B8', 'B5', 'ndre')).addBands(nd('B8', 'B11', 'ndmi'))
            red = ee.Reducer.mean().combine(ee.Reducer.count(), '', True).combine(ee.Reducer.stdDev(), '', True)
            st = ind.reduceRegion(red, geom, 10, maxPixels=4_000_000, tileScale=2)
            return ee.Feature(None, {'date': img.date().format('YYYY-MM-dd'), 'tile': img.get('MGRS_TILE'),
                                     'mean': st.get('ndvi_mean'), 'count': st.get('ndvi_count'), 'std': st.get('ndvi_stdDev'),
                                     'ndre': st.get('ndre_mean'), 'ndmi': st.get('ndmi_mean')})

        data = col.map(per_image).getInfo()
        for f in data['features']:
            p = f['properties']
            out.append((row.FarmID, p['date'], p.get('tile'), p.get('mean'), p.get('count') or 0, round(row.area_ha * 100), p.get('std'), p.get('ndre'), p.get('ndmi')))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--per-class', type=int, default=150)
    ap.add_argument('--healthy', type=int, default=300)
    ap.add_argument('--min-ha', type=float, default=0.3)
    ap.add_argument('--chunk', type=int, default=10)
    ap.add_argument('--workers', type=int, default=6)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    s = sample_fields(a.per_class, a.healthy, a.min_ha)
    with open(OUT / 'sample.csv', 'w', newline='') as fh:
        w0 = csv.writer(fh); w0.writerow(['FarmID', 'category', 'Crop', 'Season', 'sdate', 'hdate', 'area_ha'])
        w0.writerows([[r.FarmID, r.category, r.Crop, r.Season, r.sdate, r.hdate, round(r.area_ha, 3)] for r in s])
    from collections import Counter
    print('sample', dict(Counter(r.category for r in s)), flush=True)
    ee = init_ee(load_env())
    path, idp = OUT / 'ndvi.csv', OUT / 'done_ids.csv'
    done = set(int(x) for x in idp.read_text().split()[1:]) if idp.exists() else set()
    todo = [r for r in s if r.FarmID not in done]
    chunks = [todo[i:i + a.chunk] for i in range(0, len(todo), a.chunk)]
    new = not path.exists()
    t0 = time.time()
    with open(path, 'a', newline='') as fh, open(idp, 'a', newline='') as dh:
        w, dw = csv.writer(fh), csv.writer(dh)
        if new:
            w.writerow(['FarmID', 'date', 'tile', 'ndvi', 'valid_px', 'total_px', 'ndvi_std', 'ndre', 'ndmi'])
        if not done:
            dw.writerow(['FarmID'])
        def job(c):
            for attempt in range(4):
                try:
                    return c, extract_chunk(ee, c)
                except Exception as e:  # EE quota / transient
                    err = e; time.sleep(5 * (attempt + 1))
            return c, err
        with ThreadPoolExecutor(a.workers) as ex:
            futs = [ex.submit(job, c) for c in chunks]
            for i, fu in enumerate(as_completed(futs), 1):
                c, r = fu.result()
                if isinstance(r, Exception):
                    print('chunk failed', c[0].FarmID, str(r)[:150], flush=True); continue
                w.writerows(r); fh.flush()
                dw.writerows([[x.FarmID] for x in c]); dh.flush()
                print(f'{i}/{len(chunks)} chunks, {len(r)} rows, {time.time()-t0:.0f}s', flush=True)


if __name__ == '__main__':
    main()
