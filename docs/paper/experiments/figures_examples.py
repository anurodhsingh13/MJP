"""Two real-data example figures for the paper (E6).

  fig_example_series.pdf  one real field's Sentinel-2 NDVI series with the app's gate and the independent reference mask
  fig_masked_field.pdf    pixel-level view of one real field on one date: true colour, NDVI, SCL mask, Cloud Score+

Usage: .venv/Scripts/python.exe -W ignore docs/paper/experiments/figures_examples.py <outdir> [FarmID]
Needs Earth Engine (same authentication as the extraction scripts) for the pixel example only.
"""
import csv, json, os, sys
from collections import defaultdict
from datetime import date
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from shapely import wkt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
out = sys.argv[1]; FID = sys.argv[2] if len(sys.argv) > 2 else '1327654'
IMG = ROOT / '.local/datasets/labelled/telangana-mask-validation/images.csv'
TRAIN = ROOT / '.local/datasets/labelled/zindi-telangana-crop-health/files/Train.csv'
plt.rcParams.update({'font.family': 'serif', 'font.size': 8, 'axes.labelsize': 8, 'legend.fontsize': 6.6, 'xtick.labelsize': 7, 'ytick.labelsize': 7,
                     'axes.spines.top': False, 'axes.spines.right': False, 'pdf.fonttype': 42})

def save(fig, name):
    fig.savefig(f'{out}/{name}.pdf')
    if os.environ.get('PREVIEW_DIR'): fig.savefig(f"{os.environ['PREVIEW_DIR']}/{name}.png", dpi=170)
    plt.close(fig)

rows = [r for r in csv.DictReader(open(IMG, encoding='utf-8')) if r['FarmID'] == FID and r['f_scl'] != '' and r['f_cs'] != '' and r['cs_mean'] != '']
cnt = defaultdict(int)
for r in rows:
    if float(r['f_scl']) >= .7 and r['ndvi_scl'] != '': cnt[r['tile']] += 1
tile = max(cnt, key=cnt.get)
rows = sorted([r for r in rows if r['tile'] == tile], key=lambda r: r['date'])
meta = {k: rows[0][k] for k in ('area_ha', 'crop', 'label')}
d = [date.fromisoformat(r['date']) for r in rows]; x = np.array([(a - d[0]).days for a in d])
fscl = np.array([float(r['f_scl']) for r in rows]); fcs = np.array([float(r['f_cs']) for r in rows]); csm = np.array([float(r['cs_mean']) for r in rows])
nd = np.array([float(r['ndvi_scl']) if r['ndvi_scl'] != '' else np.nan for r in rows])
acc = (fscl >= .7) & ~np.isnan(nd); strong = acc & (csm < .30)
ai = np.where(acc)[0]
fig, axs = plt.subplots(2, 1, figsize=(3.45, 3.5), sharex=True, gridspec_kw={'height_ratios': [2.2, 1]})
ax = axs[0]
ax.scatter(x[~acc & ~np.isnan(nd)], nd[~acc & ~np.isnan(nd)], s=10, facecolors='none', edgecolors='#9a9a9a', lw=.7, label='Rejected by gate (clear share < 70%)')
ax.plot(x[acc], nd[acc], '-', color='#2e8b57', lw=.9, alpha=.8)
ax.scatter(x[acc], nd[acc], s=10, color='#2e8b57', zorder=3, label='Accepted (clear share $\\geq$ 70%)')
ax.scatter(x[strong], nd[strong], s=44, marker='o', facecolors='none', edgecolors='#1f5fa8', lw=1.3, zorder=4, label='Accepted, but Cloud Score+ mean < 0.3')
first = True
for a, b in zip(ai, ai[1:]):
    if 0 < x[b] - x[a] <= 30 and nd[b] - nd[a] <= -.10:
        ax.plot([x[a], x[b]], [nd[a], nd[b]], '-', color='#b5452b', lw=2.0, zorder=2, label='Decline rule fires ($\\Delta\\leq-0.10$)' if first else None); first = False
ax.set_ylabel('Field-mean NDVI'); ax.legend(frameon=False, loc='upper left', bbox_to_anchor=(0.0, 0.98), fontsize=5.9)
ax.set_title(f"(a) Real field: {meta['crop']}, {float(meta['area_ha']):.2f} ha, survey label ``{meta['label']}''", fontsize=7, loc='left')
ax = axs[1]
ax.plot(x, 100 * fscl, '-', color='#2e8b57', lw=.9, label="Clear share, app's SCL mask")
ax.plot(x, 100 * fcs, '-', color='#1f5fa8', lw=.9, label='Clear share, Cloud Score+ ($\\geq$ 0.6)')
ax.axhline(70, ls='--', lw=.8, color='grey'); ax.text(x.min(), 73, '$C_{min}$', fontsize=6.3, color='grey', ha='left')
ax.set_ylabel('Clear (%)'); ax.set_xlabel(f'Days since {d[0].isoformat()}'); ax.legend(frameon=False, loc='lower right', fontsize=5.9, ncol=1, bbox_to_anchor=(1.0, 0.02)); ax.set_ylim(-5, 108)
fig.tight_layout(); save(fig, 'fig_example_series')
print('series figure:', FID, tile, len(rows), 'images,', int(acc.sum()), 'accepted,', int(strong.sum()), 'strongly unclear accepted')

# ------------------------------------------------------------------ pixel-level example (Earth Engine)
def pick_date():
    """Across the whole sample: a large field with partial masking by the app's mask where the reference broadly agrees."""
    best = None
    for r in csv.DictReader(open(IMG, encoding='utf-8')):
        if r['f_scl'] == '' or r['f_cs'] == '': continue
        fs, fc = float(r['f_scl']), float(r['f_cs']); area = float(r['area_ha'])
        if area >= 1.5 and 0.35 < fs < 0.85 and abs(fs - fc) < 0.12 and int(float(r['n_all'])) > 120:
            sc = min(fs, 1 - fs) * min(area, 3)
            if best is None or sc > best[0]: best = (sc, r['date'], fs, fc, r['FarmID'], r['tile'], r['area_ha'], r['crop'])
    return best
sel = pick_date()
if sel is None:
    print('no partial-cloud date for this field; pixel example skipped'); sys.exit(0)
_, day, fs, fc, FID, tile, area_px, crop_px = sel
meta = dict(area_ha=area_px, crop=crop_px, label='')
import ee, google.auth
project = next(l.split('=', 1)[1].strip().strip('"') for l in (ROOT / '.env.local').read_text(encoding='utf-8').splitlines() if l.startswith('EARTH_ENGINE_PROJECT_ID='))
creds, _ = google.auth.default(); ee.Initialize(credentials=creds.with_quota_project(None), project=project)
poly = None
for r in csv.DictReader(open(TRAIN, newline='', encoding='utf-8')):
    if r['FarmID'] == FID: poly = wkt.loads(r['geometry']); break
minx, miny, maxx, maxy = poly.bounds; pad = 0.0004
region = ee.Geometry.Rectangle([minx - pad, miny - pad, maxx + pad, maxy + pad])
d0 = ee.Date(day)
s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterDate(d0, d0.advance(1, 'day')).filterBounds(region).filter(ee.Filter.eq('MGRS_TILE', tile))
cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED')
img = s2.linkCollection(cs, ['cs_cdf']).first()
proj = img.select('B4').projection()
stack = img.select(['B4', 'B3', 'B2', 'B8', 'SCL', 'cs_cdf']).addBands(ee.Image.pixelLonLat().reproject(proj))
arr = stack.toFloat().sampleRectangle(region=region, defaultValue=-1).getInfo()['properties']
A = {k: np.array(arr[k], dtype=float) for k in ('B4', 'B3', 'B2', 'B8', 'SCL', 'cs_cdf', 'longitude', 'latitude')}
lon, lat = A['longitude'], A['latitude']
red, grn, blu, nir, scl, csd = (A[k] for k in ('B4', 'B3', 'B2', 'B8', 'SCL', 'cs_cdf'))
ndvi = (nir - red) / (nir + red + 1e-9)
invalid = np.isin(scl, [0, 1, 2, 3, 8, 9, 10, 11]); ref_clear = csd >= 0.6
rgb = np.clip(np.dstack([red, grn, blu]) * 0.0001 / 0.3, 0, 1) ** 0.8
good = (lon > 0) & (lat > 0)
ext = [lon[good].min(), lon[good].max(), lat[good].min(), lat[good].max()]
px, py = poly.exterior.xy
fig, axs = plt.subplots(1, 4, figsize=(7.1, 2.0))
panels = [('(a) True colour', rgb, None, None),
          ('(b) NDVI, unmasked', ndvi, 'RdYlGn', (-.2, 1)),
          ("(c) App's SCL mask", np.where(invalid, 0, 1), matplotlib.colors.ListedColormap(['#c9c9c9', '#7bbf7b']), (0, 1)),
          ('(d) Cloud Score+ $\\geq$ 0.6', np.where(ref_clear, 1, 0), matplotlib.colors.ListedColormap(['#c9c9c9', '#7bbf7b']), (0, 1))]
for ax, (title, data, cmap, lim) in zip(axs, panels):
    ax.imshow(data, extent=ext, cmap=cmap, vmin=lim[0] if lim else None, vmax=lim[1] if lim else None, interpolation='nearest', aspect='auto')
    ax.plot(px, py, '-', color='#b5452b', lw=1.0); ax.set_xticks([]); ax.set_yticks([]); ax.set_title(title, fontsize=7)
    for sp in ax.spines.values(): sp.set_visible(False)
fig.suptitle(f"One real field ({float(meta['area_ha']):.2f} ha), {day}, tile {tile}: SCL clear {100*fs:.0f}%, Cloud Score+ clear {100*fc:.0f}%. Grey = masked, green = kept; red outline = field boundary.", fontsize=6.4, y=0.02, va='bottom')
fig.tight_layout(rect=(0, 0.08, 1, 1)); save(fig, 'fig_masked_field')
print('pixel figure:', day, 'scl clear', round(fs, 2), 'cs clear', round(fc, 2), 'grid', ndvi.shape)
