"""Download NASA POWER daily weather (T2M, T2M_MAX, PRECTOTCORR, RH2M, ALLSKY_SFC_SW_DWN) at each Telangana district centroid.
NASA POWER data are public domain (NASA open data). Output: .local/datasets/labelled/telangana-weather/<district>.json"""
import csv, json, time, urllib.request
from collections import defaultdict
from pathlib import Path
from shapely import wkt
ROOT = Path(__file__).resolve().parents[1]
src = ROOT / '.local/datasets/labelled/zindi-telangana-crop-health/files/Train.csv'
out = ROOT / '.local/datasets/labelled/telangana-weather'; out.mkdir(parents=True, exist_ok=True)
pts = defaultdict(list)
for r in csv.DictReader(open(src, encoding='utf-8')):
    c = wkt.loads(r['geometry']).centroid; pts[r['District']].append((c.x, c.y))
for d, v in pts.items():
    lon = sum(p[0] for p in v) / len(v); lat = sum(p[1] for p in v) / len(v)
    url = ('https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MAX,PRECTOTCORR,RH2M,ALLSKY_SFC_SW_DWN'
           f'&community=AG&longitude={lon:.3f}&latitude={lat:.3f}&start=20221101&end=20241231&format=JSON')
    f = out / f'{d}.json'
    if f.exists(): continue
    for a in range(4):
        try:
            data = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'crop-research'}), timeout=120))
            f.write_text(json.dumps({'lon': lon, 'lat': lat, 'p': data['properties']['parameter']})); print(d, 'ok', flush=True); break
        except Exception as e:
            print(d, 'retry', str(e)[:80], flush=True); time.sleep(5)
