"""Turn the quality-filtered observations into model inputs: a tabular feature matrix and fixed-length sequences.

  .venv/Scripts/python scripts/ml/build_satellite_features.py

Writes .local/ml/features/telangana.npz (git-ignored). No scaling or imputation happens here: that is fitted on training rows
only, inside each model's pipeline, so nothing from validation or test data leaks into a feature statistic.
"""
from __future__ import annotations

import numpy as np

from ml_common import load_config, path, training_config, write_json
from prepare_satellite_data import load_fields
import train_telangana_satellite as legacy   # reuse the existing weather feature code instead of duplicating it

NB = 8                      # phase bins over sowing -> harvest
INDEXES = ('ndvi', 'ndre', 'ndmi')


def temporal_features(f: dict) -> dict:
    t, out = f['t'], {}
    edges = np.linspace(0, 1, NB + 1)
    for name in INDEXES:
        a = f[name]
        ok = ~np.isnan(a)
        for b in range(NB):
            m = (t >= edges[b]) & ((t <= edges[b + 1]) if b == NB - 1 else (t < edges[b + 1])) & ok
            out[f'{name}_p{b}'] = float(a[m].mean()) if m.any() else np.nan
        if ok.any():
            out.update({f'{name}_mean': float(a[ok].mean()), f'{name}_median': float(np.median(a[ok])), f'{name}_min': float(a[ok].min()),
                        f'{name}_max': float(a[ok].max()), f'{name}_std': float(a[ok].std())})
        else:
            out.update({f'{name}_{k}': np.nan for k in ('mean', 'median', 'min', 'max', 'std')})
    v, days = f['ndvi'], f['t'] * f['season_days']
    d = np.diff(v)
    dt = np.maximum(np.diff(days), 1)
    slope = d / dt
    peak = int(v.argmax())
    out.update({
        'ndvi_amplitude': float(v.max() - v.min()), 'peak_phase': float(t[peak]), 'peak_doy': float(f['doy'][peak]),
        'ndvi_auc': float(np.trapezoid(v, t)) if len(t) > 1 else np.nan,
        'growth_rate_max': float(slope.max()) if len(slope) else np.nan,                 # steepest rise per day
        'decline_rate_max': float(-slope.min()) if len(slope) else np.nan,               # steepest fall per day
        'sudden_decline': float(-d.min()) if len(d) else np.nan,                         # largest single fall between observations
        'n_drops_10_30d': int(((-d >= 0.10) & (dt <= 30)).sum()),                        # the app rule's trigger
        'n_low_growing': int(((v < 0.3) & (t > 0.15) & (t < 0.85)).sum()),               # the app rule's other trigger
        'post_peak_decline': float(v[peak] - v[-1]) if peak < len(v) - 1 else 0.0,
        'mid_season_min': float(v[(t > 0.25) & (t < 0.8)].min()) if ((t > 0.25) & (t < 0.8)).any() else np.nan,
        'ndmi_mid': float(np.nanmean(f['ndmi'][(t > 0.25) & (t < 0.8)])) if (((t > 0.25) & (t < 0.8)) & ~np.isnan(f['ndmi'])).any() else np.nan,
        'within_field_std': float(np.nanmean(f['ndvi_std'])) if (~np.isnan(f['ndvi_std'])).any() else np.nan,   # field-level spatial variation
        'n_clear_obs': f['n_clear'], 'clear_fraction': f['n_clear'] / max(f['n_in_season'], 1), 'season_days': f['season_days'], 'area_ha': f['area_ha'],
        'sow_doy_sin': float(np.sin(2 * np.pi * f['doy'][0] / 365)), 'sow_doy_cos': float(np.cos(2 * np.pi * f['doy'][0] / 365)),
    })
    return out


def sequence(f: dict, steps: int) -> np.ndarray:
    """(steps, 4): ndvi, ndre, ndmi interpolated on a fixed normalised-time grid, plus the distance to the nearest real observation."""
    grid = np.linspace(0, 1, steps)
    chans = []
    for name in INDEXES:
        a, ok = f[name], ~np.isnan(f[name])
        chans.append(np.interp(grid, f['t'][ok], a[ok]) if ok.sum() >= 2 else np.full(steps, np.nan))
    gap = np.abs(grid[:, None] - f['t'][None, :]).min(1)
    return np.stack(chans + [gap], 1).astype(np.float32)


def main() -> None:
    cfg, mcfg = load_config('dataset_config')['telangana'], load_config('model_config')
    fields = load_fields()
    crops = sorted({f['crop'] for f in fields})
    rows = []
    for f in fields:
        r = temporal_features(f)
        for c in crops:
            r[f'crop={c}'] = float(f['crop'] == c)
        r['season_rabi'] = float(f['season'] == 'Rabi')
        r.update(legacy.weather_features(f['record']['District'], f['sdate'], f['hdate']) or {})
        rows.append(r)
    names = sorted({k for r in rows for k in r})
    X = np.array([[r.get(k, np.nan) for k in names] for r in rows], dtype=np.float64)
    seq = np.stack([sequence(f, mcfg['sequence_length']) for f in fields])
    static_names = [n for n in names if n.startswith('crop=')] + ['season_rabi']
    static = X[:, [names.index(n) for n in static_names]].astype(np.float32)
    out = path('features') / 'telangana.npz'
    np.savez_compressed(out, X=X, feature_names=np.array(names), seq=seq, static=static, static_names=np.array(static_names),
                        ids=np.array([f['id'] for f in fields]), label=np.array([f['label'] for f in fields]),
                        district=np.array([f['district'] for f in fields]), crop=np.array([f['crop'] for f in fields]),
                        season=np.array([f['season'] for f in fields]), n_clear=np.array([f['n_clear'] for f in fields]))
    miss = np.isnan(X).mean(0)
    write_json(path('reports') / 'feature_summary.json', {
        'fields': len(fields), 'features': len(names), 'sequence_shape': list(seq.shape), 'feature_names': names,
        'weather_features': sum(n.startswith('wx_') for n in names),
        'columns_with_missing_values': {n: float(m) for n, m in zip(names, miss) if m > 0},
        'not_available': {'bands_B2_B3_B6_B7_B8A_B12': 'not extracted', 'NDWI_EVI': 'need B3 / B2, not extracted',
                          'soil_moisture': 'no source in the repository', 'field_record_columns': 'excluded from the main feature set: the app does not have them'}})
    print(f'saved {out}: {X.shape[0]} fields, {X.shape[1]} features, sequences {seq.shape}')


if __name__ == '__main__':
    main()
