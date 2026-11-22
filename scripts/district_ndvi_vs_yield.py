"""Does Sentinel-2 NDVI track crop condition? Compare district-level season NDVI with government district yield.

  .venv/Scripts/python scripts/district_ndvi_vs_yield.py

NDVI: Sentinel-2 SR harmonized, SCL cloud mask, monthly median, mean over cropland pixels (ESA WorldCover 2021 class 40)
in each Uttar Pradesh district (FAO GAUL 2015 level 2). Yield: DES / UPAG district yield (India Data Portal, ODC-By),
.local/datasets/yield/raw/cropwise-area-production-yield-upag.csv. Wheat = Rabi (Dec-Mar), rice = Kharif (Aug-Oct).
Output: .local/datasets/yield/district_ndvi.csv and printed correlations.
"""
import csv, difflib, json, re, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
ROOT = Path(__file__).resolve().parents[1]
Y = ROOT / '.local/datasets/yield'
CACHE = Y / 'district_ndvi.csv'
INVALID = (0, 1, 2, 3, 8, 9, 10, 11)
SEASON = {'Wheat': ('Rabi', [12, 1, 2, 3]), 'Rice': ('Kharif', [8, 9, 10])}
YEARS = range(2019, 2025)  # season start year (DES '2019-2020' = 2019)

def env():
    for l in (ROOT / '.env.local').read_text(encoding='utf-8').splitlines():
        if l.startswith('EARTH_ENGINE_PROJECT_ID='): return l.split('=', 1)[1].strip().strip('"')
norm = lambda s: re.sub(r'[^a-z]', '', s.lower())

def extract():
    import ee, google.auth
    c, _ = google.auth.default(); ee.Initialize(credentials=c.with_quota_project(None), project=env())
    gaul = ee.FeatureCollection('FAO/GAUL/2015/level2').filter(ee.Filter.eq('ADM1_NAME', 'Uttar Pradesh'))
    names = gaul.aggregate_array('ADM2_NAME').getInfo(); print('GAUL UP districts', len(names), flush=True)
    crop = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map').eq(40)
    def month_img(y, m):
        start = ee.Date.fromYMD(y, m, 1)
        def prep(img):
            scl = img.select('SCL'); ok = scl.mask()
            for k in INVALID: ok = ok.And(scl.neq(k))
            n = img.select('B8').multiply(0.0001).subtract(img.select('B4').multiply(0.0001)).divide(img.select('B8').multiply(0.0001).add(img.select('B4').multiply(0.0001)))
            return n.rename('ndvi').updateMask(ok)
        col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterDate(start, start.advance(1, 'month')).filterBounds(gaul.geometry()).map(prep)
        return col.median().updateMask(crop)
    jobs = []
    for crop_name, (_, months) in SEASON.items():
        for y in YEARS:
            for m in months: jobs.append((crop_name, y, m if m >= 6 or crop_name == 'Rice' else m, y if m >= 6 else y + 1))
    def run(j):
        cn, y, m, cal = j
        for a in range(4):
            try:
                img = month_img(cal, m)
                r = img.reduceRegions(gaul, ee.Reducer.mean(), 250, tileScale=8).select(['ADM2_NAME', 'mean'], retainGeometry=False).getInfo()
                return [(cn, y, m, f['properties']['ADM2_NAME'], f['properties'].get('mean')) for f in r['features']]
            except Exception as e:
                err = str(e)[:100]
        print('failed', j, err, flush=True); return []
    rows = []
    with ThreadPoolExecutor(6) as ex:
        for i, r in enumerate(ex.map(run, jobs), 1):
            rows += r; print(f'{i}/{len(jobs)}', flush=True)
    with open(CACHE, 'w', newline='') as fh:
        w = csv.writer(fh); w.writerow(['crop', 'year', 'month', 'district', 'ndvi']); w.writerows(rows)

def analyse():
    nd = {}
    for r in csv.DictReader(open(CACHE)):
        if r['ndvi'] not in ('', 'None'): nd.setdefault((r['crop'], int(r['year']), r['district']), []).append(float(r['ndvi']))
    gnames = sorted({k[2] for k in nd})
    yld = {}
    for r in csv.DictReader(open(Y / 'raw/cropwise-area-production-yield-upag.csv', encoding='utf-8')):
        if r['state_name'] == 'Uttar Pradesh' and r['crop_name'] in SEASON and r['season'] == SEASON[r['crop_name']][0]:
            try: yld[(r['crop_name'], int(r['year'][:4]), r['district_name'])] = (float(r['yield']), float(r['area']))
            except ValueError: pass
    # match GAUL to DES names
    des = sorted({k[2] for k in yld}); mp = {}
    for g in gnames:
        m = difflib.get_close_matches(norm(g), [norm(d) for d in des], n=1, cutoff=0.85)
        if m: mp[g] = next(d for d in des if norm(d) == m[0])
    print('districts matched', len(mp), 'of', len(gnames), '(unmatched dropped: new/renamed districts)')
    for crop in SEASON:
        X, Yv, D, YR = [], [], [], []
        for (c, y, g), v in nd.items():
            if c != crop or g not in mp or (crop, y, mp[g]) not in yld: continue
            need = len(SEASON[crop][1])
            if len(v) < max(2, need - 1): continue
            yy, ar = yld[(crop, y, mp[g])]
            if yy <= 0 or ar < 1: continue
            X.append(max(v)); Yv.append(yy); D.append(g); YR.append(y)
        X, Yv, D, YR = map(np.array, (X, Yv, D, YR))
        if len(X) < 20: print(crop, 'too few', len(X)); continue
        rr = lambda a, b: float(np.corrcoef(a, b)[0, 1])
        # within-district anomaly: subtract each district's mean across years
        ax, ay = X.copy(), Yv.copy()
        for g in set(D): m = D == g; ax[m] -= X[m].mean(); ay[m] -= Yv[m].mean()
        # within-year: subtract each year's mean across districts (spatial pattern)
        sx, sy = X.copy(), Yv.copy()
        for y in set(YR): m = YR == y; sx[m] -= X[m].mean(); sy[m] -= Yv[m].mean()
        rng = np.random.default_rng(0); idx = np.arange(len(X)); bs = [rr(ax[i], ay[i]) for i in (rng.choice(idx, len(idx)) for _ in range(500))]
        print(f'{crop}: n={len(X)} district-years | r(all)={rr(X, Yv):.2f} | r(year-to-year within district)={rr(ax, ay):.2f} (95% {np.percentile(bs, 2.5):.2f} to {np.percentile(bs, 97.5):.2f}) | r(district differences within a year)={rr(sx, sy):.2f}')

if __name__ == '__main__':
    if '--skip-extract' not in sys.argv: extract()
    analyse()
