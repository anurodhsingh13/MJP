"""Figures for the real-imagery experiments (E5-E7). Usage: python -I figures_real.py <outdir>
Reads real_audit_results.json, independent_evidence_results.json, engine_results.json and, when present,
mask_edge_results.json plus the Earth Engine image table."""
import json, sys, collections, csv
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
out = sys.argv[1]
plt.rcParams.update({'font.family': 'serif', 'font.size': 8, 'axes.labelsize': 8, 'legend.fontsize': 6.8, 'xtick.labelsize': 7, 'ytick.labelsize': 7,
                     'axes.spines.top': False, 'axes.spines.right': False, 'pdf.fonttype': 42})
W = 3.4
J = lambda n: json.load(open(HERE / n))
import os
def save(fig, name):
    fig.savefig(f'{out}/{name}.pdf')
    if os.environ.get('PREVIEW_DIR'): fig.savefig(f"{os.environ['PREVIEW_DIR']}/{name}.png", dpi=170)
    plt.close(fig)

# ---------------------------------------------------------------- Fig: real audit (E5) and harvest composite (E7)
ra, ev, eng = J('real_audit_results.json'), J('independent_evidence_results.json'), J('engine_results.json')
inj = ra['injected_stress']['by_share']
fr = sorted(float(k) for k in inj)
real = [100 * inj[str(f) if str(f) in inj else f'{f:g}']['value'] for f in fr]
lo = [100 * inj[str(f) if str(f) in inj else f'{f:g}']['ci95'][0] for f in fr]
hi = [100 * inj[str(f) if str(f) in inj else f'{f:g}']['ci95'][1] for f in fr]
g = collections.defaultdict(list)
for r in eng['e2']: g[round(r['patch'], 2)].append(r)
sx = np.array(sorted(g)); sy = [100 * np.mean([r['flagged'] for r in g[k]]) for k in sorted(g)]
fig, axs = plt.subplots(1, 2, figsize=(7.0, 2.35))
ax = axs[0]
ax.fill_between(np.array(fr) * 100, lo, hi, color='#1f5fa8', alpha=.18, lw=0)
ax.plot(np.array(fr) * 100, real, 'o-', ms=3, color='#1f5fa8', label='Real Sentinel-2 series + injected stress')
ax.step(sx * 100, sy, where='post', color='#b5452b', lw=1.3, label='Synthetic rasters (E2)')
ax.axhline(real[0], ls=':', lw=.8, color='grey'); ax.text(81, real[0] + 4, f'false triggers at no stress: {real[0]:.1f}%', fontsize=6.3, color='grey', ha='right')
ax.set_xlabel('Stressed share of the field (%)  [drop of 0.30 inside]'); ax.set_ylabel('Pairs flagged by the decline rule (%)'); ax.set_ylim(-3, 103); ax.set_xlim(-2, 82)
ax.legend(frameon=False, loc='upper left', bbox_to_anchor=(0.0, 1.02)); ax.set_title('(a)', fontsize=8, loc='left')
ax = axs[1]
comp = ev['harvest_dates']['composite_ndvi_over_season_peak']
x = [(c['days_to_harvest_from'] + c['days_to_harvest_to']) / 2 for c in comp]
ax.fill_between(x, [c['q25'] for c in comp], [c['q75'] for c in comp], color='#2e8b57', alpha=.2, lw=0, label='Interquartile range')
ax.plot(x, [c['median'] for c in comp], 'o-', ms=3, color='#2e8b57', label='Median')
ax.axvline(0, ls='--', lw=.8, color='grey'); ax.text(-2, .74, 'recorded harvest', fontsize=6.3, color='grey', rotation=90, va='bottom', ha='right')
ax.set_xlabel('Days relative to the recorded harvest date'); ax.set_ylabel('NDVI / own season peak'); ax.set_ylim(.2, 1.12)
ax.legend(frameon=False, loc='lower left'); ax.set_title('(b)', fontsize=8, loc='left')
fig.tight_layout(); save(fig, 'fig_real_audit')

# ---------------------------------------------------------------- Figs from the Earth Engine table (E6)
mp = HERE / 'mask_edge_results.json'
img = ROOT / '.local/datasets/labelled/telangana-mask-validation/images.csv'
if mp.exists() and img.exists():
    me = J('mask_edge_results.json')
    rows = [r for r in csv.DictReader(open(img, encoding='utf-8')) if r['f_scl'] != '' and r['f_cs'] != '']
    fs = np.array([float(r['f_scl']) for r in rows]); fc = np.array([float(r['f_cs']) for r in rows])
    acc = [r for r in rows if float(r['f_scl']) >= .7 and r['ndvi_both'] != '' and r['ndvi_scl'] != '']
    dd = np.array([float(r['ndvi_scl']) - float(r['ndvi_both']) for r in acc])
    fig, axs = plt.subplots(1, 2, figsize=(7.0, 2.45))
    ax = axs[0]
    h = ax.hist2d(fs, fc, bins=20, range=[[0, 1], [0, 1]], cmap='Greens', norm=matplotlib.colors.LogNorm())
    ax.plot([0, 1], [0, 1], ':', color='grey', lw=.8); ax.axvline(.7, ls='--', lw=.8, color='#b5452b'); ax.text(.71, .03, '$C_{min}$ = 70%', fontsize=6.3, color='#b5452b')
    ax.set_xlabel("Clear share of field, app's SCL mask"); ax.set_ylabel('Clear share, Cloud Score+ (reference)'); ax.set_title('(a)', fontsize=8, loc='left')
    cb = fig.colorbar(h[3], ax=ax, pad=.02); cb.ax.tick_params(labelsize=6); cb.set_label('field-images', fontsize=6.5)
    ax = axs[1]
    ax.hist(np.clip(dd, -.3, .3), bins=60, color='#1f5fa8', alpha=.85); ax.set_yscale('log')
    ax.axvline(0, color='grey', lw=.8, ls=':')
    ax.set_xlabel('NDVI(app mask) - NDVI(app + reference mask)'); ax.set_ylabel('Accepted field-images'); ax.set_title('(b)', fontsize=8, loc='left')
    fig.tight_layout(); save(fig, 'fig_mask_validation')

    order = [b for b in me['edge_and_size'] if b != '_all']
    removed = [100 * me['edge_and_size'][b]['median_share_of_pixels_removed'] for b in order]
    dis = [100 * me['edge_and_size'][b]['decline_decision_disagrees']['value'] for b in order]
    absd = [100 * me['edge_and_size'][b]['share_abs_difference_over_0p05']['value'] for b in order]
    fig, axs = plt.subplots(1, 2, figsize=(7.0, 2.2))
    ax = axs[0]; xx = np.arange(len(order))
    ax.bar(xx, removed, color='#8c6d1f'); ax.set_xticks(xx); ax.set_xticklabels(order)
    for i, v in enumerate(removed): ax.text(i, v + 1, f'{v:.0f}%', ha='center', fontsize=6.5)
    ax.set_xlabel('Field area (ha)'); ax.set_ylabel('Pixels in the 1-pixel edge ring (%)'); ax.set_ylim(0, max(removed) * 1.25); ax.set_title('(a)', fontsize=8, loc='left')
    ax = axs[1]; w = .38
    ax.bar(xx - w / 2, absd, w, color='#1f5fa8', label=r'NDVI differs by $>0.05$ without edge pixels')
    ax.bar(xx + w / 2, dis, w, color='#b5452b', label='Decline decision changes without edge pixels')
    ax.set_xticks(xx); ax.set_xticklabels(order); ax.set_xlabel('Field area (ha)'); ax.set_ylabel('Share (%)'); ax.legend(frameon=False, loc='upper right'); ax.set_title('(b)', fontsize=8, loc='left')
    ax.set_ylim(0, max(absd + dis) * 1.45)
    fig.tight_layout(); save(fig, 'fig_size_edge')
print('figures written to', out)
