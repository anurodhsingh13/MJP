"""E3: label circularity in the AgroSense spectral-proxy benchmark (research-only data in the repo).
Usage: python -I proxy_circularity.py <csv> <out_json>"""
import json, sys
import numpy as np, pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold
from sklearn.metrics import accuracy_score, f1_score

df = pd.read_csv(sys.argv[1])
out = {'rows': len(df), 'locations': int(df.location_id.nunique()), 'seasons': int(df.season.nunique()),
       'labels': df.crop_stress_label.value_counts().to_dict()}

# 1) Does the documented composite + tertiles reproduce the label?
comp = 0.5 * df.ndvi + 0.3 * df.ndre + 0.2 * df.evi
def tertile(series):
    q1, q2 = series.quantile([1/3, 2/3])
    return np.where(series <= q1, 'Diseased', np.where(series <= q2, 'Stressed', 'Healthy'))
recon = {'global': float((tertile(comp) == df.crop_stress_label).mean())}
for key in ('season', 'season_type', 'crop_type'):
    lab = pd.Series(index=df.index, dtype=object)
    for _, idx in df.groupby(key).groups.items():
        lab.loc[idx] = tertile(comp.loc[idx])
    recon[f'per_{key}'] = float((lab == df.crop_stress_label).mean())
out['composite_reconstruction_agreement'] = recon

# 2) Location-grouped CV with progressively removed label-defining inputs.
spectral = ['ndvi', 'evi', 'ndwi', 'ndre', 'lai', 'bsi', 'ndvi_std', 'ndvi_min', 'ndvi_max']
context = ['temp_celsius', 'rainfall_mm', 'soil_moisture']
sets = {'all_features': spectral + context,
        'without_ndvi_ndre_evi': [c for c in spectral if c not in ('ndvi', 'ndre', 'evi')] + context,
        'without_any_ndvi_derived': ['ndwi', 'lai', 'bsi'] + context,
        'context_only': context,
        'composite_only': ['__comp']}
df['__comp'] = comp
y = df.crop_stress_label.values
groups = df.location_id.values
cv = GroupKFold(n_splits=5)
scores = {}
for name, cols in sets.items():
    X = df[cols].values
    pred = np.empty(len(y), dtype=object)
    for tr, te in cv.split(X, y, groups):
        model = RandomForestClassifier(n_estimators=300, random_state=42, n_jobs=-1).fit(X[tr], y[tr])
        pred[te] = model.predict(X[te])
    scores[name] = {'n_features': len(cols), 'accuracy': round(accuracy_score(y, pred), 4),
                    'macro_f1': round(f1_score(y, pred, average='macro'), 4)}
majority = df.crop_stress_label.value_counts(normalize=True).max()
scores['majority_class'] = {'accuracy': round(float(majority), 4)}
out['grouped_cv'] = scores
out['corr_with_composite'] = {c: round(float(np.corrcoef(df[c], comp)[0, 1]), 3) for c in ['lai', 'ndwi', 'bsi', 'ndvi_min', 'ndvi_max']}
json.dump(out, open(sys.argv[2], 'w'), indent=1)
print(json.dumps(out, indent=1))
