"""E6: validate the Sentinel-2 cloud mask against an independent product, and measure edge-pixel effects on small fields.

For a size-stratified random sample of the Telangana fields (real polygons), every Sentinel-2 L2A image in the crop
season is summarised with Earth Engine. Per field and image we record
  f_scl     fraction of the field that the app's mask keeps (SCL classes 0,1,2,3,8,9,10,11 removed)
  f_cs      fraction of the field that Cloud Score+ (cs_cdf >= T) calls clear (an independent, learned cloud/shadow/haze score)
  f_both    fraction clear under both
  ndvi_scl  field-mean NDVI under the app's mask      ndvi_both  field-mean NDVI under both masks
  ndvi_inner, f_scl_inner  the same app-masked NDVI over the polygon shrunk by 10 m (one pixel), i.e. without edge pixels

  .venv/Scripts/python.exe docs/paper/experiments/gee_mask_edge_validation.py [--per-bin 80] [--seed 5]

Resumable; output (git-ignored): .local/datasets/labelled/telangana-mask-validation/images.csv
Same authentication as scripts/telangana_ndvi_extract.py (Application Default Credentials, no quota project).
"""
import argparse, csv, sys, time, random
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from shapely import wkt

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / '.local/datasets/labelled/zindi-telangana-crop-health/files/Train.csv'
SAMPLE = ROOT / '.local/datasets/labelled/telangana-s2-full/sample.csv'
OUT = ROOT / '.local/datasets/labelled/telangana-mask-validation'
INVALID_SCL = (0, 1, 2, 3, 8, 9, 10, 11)
CS_T = 0.60                       # Cloud Score+ recommended middle threshold (0.5 relaxed .. 0.65 strict); sensitivity is reported later
BINS = [(0.3, 0.4), (0.4, 0.6), (0.6, 1.0), (1.0, 2.0), (2.0, 1e9)]


def load_env():
    for line in (ROOT / '.env.local').read_text(encoding='utf-8').splitlines():
        if line.startswith('EARTH_ENGINE_PROJECT_ID='):
            return line.split('=', 1)[1].strip().strip('"')
    sys.exit('EARTH_ENGINE_PROJECT_ID missing in .env.local')


def init_ee(project):
    import ee, google.auth
    creds, _ = google.auth.default()
    ee.Initialize(credentials=creds.with_quota_project(None), project=project)
    return ee


def choose(per_bin, seed):
    area = {int(r['FarmID']): float(r['area_ha']) for r in csv.DictReader(open(SAMPLE, encoding='utf-8'))}
    geoms = {}
    with open(SRC, newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            fid = int(r['FarmID'])
            if fid in area:
                geoms[fid] = (wkt.loads(r['geometry']), r['SDate'].split()[0], r['HDate'].split()[0], r['Crop'], r['category'])
    rng = random.Random(seed); picks = []
    for lo, hi in BINS:
        pool = sorted(f for f, a in area.items() if lo <= a < hi)
        for fid in rng.sample(pool, min(per_bin, len(pool))):
            g, sd, hd, crop, cat = geoms[fid]
            picks.append(dict(fid=fid, area=area[fid], geom=g, sdate=sd, hdate=hd, crop=crop, label=cat))
    return picks


def extract_field(ee, f):
    geom = ee.Geometry(f['geom'].__geo_interface__)
    inner = geom.buffer(-10)                         # one Sentinel-2 pixel inward
    start = (datetime.fromisoformat(f['sdate']) - timedelta(days=35)).strftime('%Y-%m-%d')
    end = (datetime.fromisoformat(f['hdate']) + timedelta(days=2)).strftime('%Y-%m-%d')
    s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterDate(start, end).filterBounds(geom)
    cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED')
    col = s2.linkCollection(cs, ['cs', 'cs_cdf'])

    def per_image(img):
        scl = img.select('SCL'); ok = scl.mask()
        for c in INVALID_SCL:
            ok = ok.And(scl.neq(c))
        refl = img.select(['B4', 'B8']).multiply(0.0001)
        den = refl.select('B8').add(refl.select('B4'))
        ndvi = refl.select('B8').subtract(refl.select('B4')).divide(den).updateMask(den.neq(0)).rename('ndvi')
        csclear = img.select('cs_cdf').gte(CS_T).unmask(0)
        both = ok.And(csclear)
        stack = (ndvi.updateMask(ok).rename('ndvi_scl')
                 .addBands(ndvi.updateMask(both).rename('ndvi_both'))
                 .addBands(ok.unmask(0).rename('f_scl')).addBands(csclear.rename('f_cs')).addBands(both.unmask(0).rename('f_both'))
                 .addBands(img.select('cs_cdf').unmask(0).rename('cs_mean'))
                 .addBands(img.select('cs_cdf').gte(0.5).unmask(0).rename('f_cs50')).addBands(img.select('cs_cdf').gte(0.65).unmask(0).rename('f_cs65')))
        full = stack.reduceRegion(ee.Reducer.mean().combine(ee.Reducer.count(), '', True), geom, 10, maxPixels=4_000_000, tileScale=2)
        inn = stack.select(['ndvi_scl', 'f_scl']).reduceRegion(ee.Reducer.mean().combine(ee.Reducer.count(), '', True), inner, 10, maxPixels=4_000_000, tileScale=2)
        return ee.Feature(None, {'date': img.date().format('YYYY-MM-dd'), 'tile': img.get('MGRS_TILE'),
                                 'ndvi_scl': full.get('ndvi_scl_mean'), 'n_scl': full.get('ndvi_scl_count'), 'ndvi_both': full.get('ndvi_both_mean'), 'n_both': full.get('ndvi_both_count'),
                                 'f_scl': full.get('f_scl_mean'), 'f_cs': full.get('f_cs_mean'), 'f_both': full.get('f_both_mean'), 'cs_mean': full.get('cs_mean_mean'),
                                 'f_cs50': full.get('f_cs50_mean'), 'f_cs65': full.get('f_cs65_mean'), 'n_all': full.get('f_scl_count'),
                                 'ndvi_inner': inn.get('ndvi_scl_mean'), 'n_inner': inn.get('ndvi_scl_count'), 'f_scl_inner': inn.get('f_scl_mean'), 'n_all_inner': inn.get('f_scl_count')})
    rows = []
    for ft in col.map(per_image).getInfo()['features']:
        p = ft['properties']
        rows.append([f['fid'], f['area'], f['crop'], f['label'], p['date'], p.get('tile'), p.get('n_all'), p.get('n_all_inner'),
                     p.get('f_scl'), p.get('f_cs'), p.get('f_both'), p.get('cs_mean'), p.get('f_cs50'), p.get('f_cs65'),
                     p.get('ndvi_scl'), p.get('n_scl'), p.get('ndvi_both'), p.get('n_both'), p.get('ndvi_inner'), p.get('n_inner'), p.get('f_scl_inner')])
    return rows


HEADER = ['FarmID', 'area_ha', 'crop', 'label', 'date', 'tile', 'n_all', 'n_all_inner', 'f_scl', 'f_cs', 'f_both', 'cs_mean', 'f_cs50', 'f_cs65',
          'ndvi_scl', 'n_scl', 'ndvi_both', 'n_both', 'ndvi_inner', 'n_inner', 'f_scl_inner']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--per-bin', type=int, default=80); ap.add_argument('--seed', type=int, default=5)
    ap.add_argument('--workers', type=int, default=6); ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    picks = choose(a.per_bin, a.seed)
    if a.limit: picks = picks[:a.limit]
    path, idp = OUT / 'images.csv', OUT / 'done_ids.txt'
    done = set(int(x) for x in idp.read_text().split()) if idp.exists() else set()
    todo = [p for p in picks if p['fid'] not in done]
    print(f'{len(picks)} fields chosen, {len(todo)} to do', flush=True)
    ee = init_ee(load_env()); t0 = time.time(); new = not path.exists()
    with open(path, 'a', newline='') as fh, open(idp, 'a') as dh:
        w = csv.writer(fh)
        if new: w.writerow(HEADER)
        def job(f):
            err = None
            for attempt in range(4):
                try: return f, extract_field(ee, f)
                except Exception as e: err = e; time.sleep(5 * (attempt + 1))
            return f, err
        with ThreadPoolExecutor(a.workers) as ex:
            futs = [ex.submit(job, f) for f in todo]
            for i, fu in enumerate(as_completed(futs), 1):
                f, r = fu.result()
                if isinstance(r, Exception): print('field failed', f['fid'], str(r)[:160], flush=True); continue
                w.writerows(r); fh.flush(); dh.write(f"{f['fid']}\n"); dh.flush()
                if i % 10 == 0 or i == len(todo): print(f'{i}/{len(todo)} fields, {time.time()-t0:.0f}s', flush=True)


if __name__ == '__main__':
    main()
