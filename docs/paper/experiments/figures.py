"""Render IEEE single-column figures from the experiment JSON. Usage: python -I figures.py <engine_json> <proxy_json> <outdir>"""
import json, sys, collections
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plt.rcParams.update({'font.family': 'serif', 'font.size': 8, 'axes.labelsize': 8, 'legend.fontsize': 7,
                     'xtick.labelsize': 7, 'ytick.labelsize': 7, 'axes.spines.top': False, 'axes.spines.right': False,
                     'pdf.fonttype': 42})
eng, proxy, out = json.load(open(sys.argv[1])), json.load(open(sys.argv[2])), sys.argv[3]
W = 3.4  # IEEE column width in inches

# Fig. 3 - cloud sweep
g = collections.defaultdict(list)
for r in eng['e1']: g[r['cloud']].append(r)
c = np.array(sorted(g)) * 100
cov = [np.mean([r['coverage'] for r in g[k] if r['status'] == 200]) if any(r['status'] == 200 for r in g[k]) else 0 for k in sorted(g)]
acc = [100 * np.mean([r['accepted'] for r in g[k]]) for k in sorted(g)]
err = [max([abs(r['ndvi'] - r['truth_all']) for r in g[k] if r['status'] == 200], default=np.nan) for k in sorted(g)]
fig, ax = plt.subplots(figsize=(W, 2.45))
ax.plot(c, cov, 'o-', ms=3, color='#1f5fa8', label='Valid boundary coverage (%)')
ax.step(c, acc, where='mid', color='#2e8b57', lw=1.4, label='Scenes accepted (%)')
ax.axhline(70, ls='--', lw=.8, color='grey'); ax.text(62, 73, '$C_{min}$ = 70%', fontsize=6.5, color='grey')
ax.set_xlabel('Cloud-masked share of field (%)'); ax.set_ylabel('Percent'); ax.set_ylim(-3, 105)
ax2 = ax.twinx(); ax2.plot(c, err, 's:', ms=2.5, color='#b5452b', label=r'max $|\overline{NDVI}-\overline{NDVI}_{true}|$')
ax2.set_ylabel('Absolute NDVI error', color='#b5452b'); ax2.tick_params(axis='y', colors='#b5452b'); ax2.spines['right'].set_visible(True)
h1, l1 = ax.get_legend_handles_labels(); h2, l2 = ax2.get_legend_handles_labels()
fig.legend(h1 + h2, l1 + l2, loc='upper center', ncol=2, frameon=False, bbox_to_anchor=(0.5, 1.0), fontsize=6.3)
fig.tight_layout(rect=(0, 0, 1, 0.80)); fig.savefig(f'{out}/fig_cloud_sweep.pdf'); plt.close(fig)

# Fig. 4 - stressed patch sweep
g = collections.defaultdict(list)
for r in eng['e2']: g[round(r['patch'], 2)].append(r)
p = np.array(sorted(g)) * 100
chg = [np.mean([r['change'] for r in g[k]]) for k in sorted(g)]
flag = [100 * np.mean([r['flagged'] for r in g[k]]) for k in sorted(g)]
aff = [100 * np.mean([r['affected'] for r in g[k]]) for k in sorted(g)]
fig, ax = plt.subplots(figsize=(W, 2.45))
ax.plot(p, p, ':', color='grey', lw=.8, label='Ideal anomaly area')
ax.plot(p, aff, 'o-', ms=3, color='#7b3fa0', label=r'Flagged area, $1.5\sigma$ rule (%)')
ax.step(p, flag, where='mid', color='#2e8b57', lw=1.4, label=r'Two-date flag rate, $\Delta\leq-0.10$ (%)')
ax.set_xlabel('True stressed share of field (%)'); ax.set_ylabel('Percent'); ax.set_ylim(-3, 105)
ax2 = ax.twinx(); ax2.plot(p, chg, 's--', ms=2.5, color='#b5452b', label=r'Mean $\Delta$NDVI')
ax2.set_ylabel(r'Field-mean $\Delta$NDVI', color='#b5452b'); ax2.tick_params(axis='y', colors='#b5452b'); ax2.spines['right'].set_visible(True)
h1, l1 = ax.get_legend_handles_labels(); h2, l2 = ax2.get_legend_handles_labels()
fig.legend(h1 + h2, l1 + l2, loc='upper center', ncol=2, frameon=False, bbox_to_anchor=(0.5, 1.0), fontsize=6.3)
fig.tight_layout(rect=(0, 0, 1, 0.80)); fig.savefig(f'{out}/fig_patch_sweep.pdf'); plt.close(fig)

# Fig. 5 - proxy circularity
cv = proxy['grouped_cv']
names = ['composite_only', 'all_features', 'without_any_ndvi_derived', 'without_ndvi_ndre_evi', 'context_only', 'majority_class']
labels = ['Composite only', 'All 12 features', 'No NDVI-derived', 'No NDVI/NDRE/EVI', 'Weather/soil only', 'Majority class']
vals = [cv[n]['accuracy'] * 100 for n in names]
fig, ax = plt.subplots(figsize=(W, 1.9))
bars = ax.barh(labels[::-1], vals[::-1], color=['#999999', '#c9a227', '#1f5fa8', '#1f5fa8', '#1f5fa8', '#b5452b'])
for b, v in zip(bars, vals[::-1]): ax.text(v + 1, b.get_y() + b.get_height() / 2, f'{v:.1f}', va='center', fontsize=6.5)
ax.set_xlim(0, 110); ax.set_xlabel('Location-grouped 5-fold CV accuracy (%)')
fig.tight_layout(); fig.savefig(f'{out}/fig_proxy_circularity.pdf'); plt.close(fig)
print('ok')
