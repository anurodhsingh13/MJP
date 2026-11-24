"""Train a 16-class crop-type classifier on TimeSen2Crop pixel series (features from timesen2crop_features.py).
Evaluation is spatial: three whole tiles are never seen in training (test A); 2019_33UVP is the same area as 33UVP but a different
year (test B). Class ids are used as-is: the record shipped here has no class names."""
import json, os, time, warnings
import joblib, numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, f1_score, confusion_matrix, recall_score

warnings.filterwarnings('ignore')
D = '.local/ml/timesen2crop'
TEST_TILES = ['33UWQ', '32TQT', '33TXN']          # unseen locations
YEAR_TILE = '2019_33UVP'                          # unseen year
CAP = 40000                                       # per-class cap in training (rare classes keep all)

def load(name):
    z = np.load(f'{D}/{name}.npz'); return z['X'], z['y'].astype(int)

tiles = sorted(f[:-4] for f in os.listdir(D) if f.endswith('.npz'))
train_tiles = [t for t in tiles if t not in TEST_TILES + [YEAR_TILE]]
print('train tiles', train_tiles, '\ntest A tiles', TEST_TILES, '\ntest B', YEAR_TILE, flush=True)
Xs, ys = zip(*(load(t) for t in train_tiles)); X, y = np.vstack(Xs), np.concatenate(ys)
rng = np.random.default_rng(0)
keep = np.concatenate([rng.permutation(np.where(y == c)[0])[:CAP] for c in np.unique(y)])
Xtr, ytr = X[keep], y[keep]
print(f'train pool {len(y):,} pixels -> {len(ytr):,} after per-class cap {CAP}', flush=True)
del X, y, Xs, ys

t0 = time.time()
model = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.1, max_leaf_nodes=63, l2_regularization=1.0, early_stopping=False, random_state=0)
model.fit(Xtr, ytr)
print(f'trained in {(time.time() - t0) / 60:.1f} min', flush=True)

def evaluate(label, Xt, yt, majority):
    pred = model.predict(Xt)
    out = {'pixels': int(len(yt)), 'accuracy': float(accuracy_score(yt, pred)), 'macro_f1': float(f1_score(yt, pred, average='macro')),
           'majority_class_accuracy': float(np.mean(yt == majority)),
           'per_class_recall': {int(c): float(r) for c, r in zip(np.unique(yt), recall_score(yt, pred, average=None, labels=np.unique(yt)))}}
    cm = confusion_matrix(yt, pred, labels=np.arange(16)); np.fill_diagonal(cm, 0)
    top = np.dstack(np.unravel_index(np.argsort(-cm.ravel())[:5], cm.shape))[0]
    out['top_confusions_true_to_pred'] = [[int(a), int(b), int(cm[a, b])] for a, b in top]
    print(f"\n[{label}] pixels={out['pixels']:,}  accuracy={out['accuracy']:.3f}  macro-F1={out['macro_f1']:.3f}  (always-majority={out['majority_class_accuracy']:.3f})", flush=True)
    print('  recall per class:', {k: round(v, 2) for k, v in out['per_class_recall'].items()}, flush=True)
    return out

majority = int(np.bincount(ytr).argmax())
results = {'train_tiles': train_tiles, 'train_pixels': int(len(ytr)), 'tests': {}}
XA, yA = zip(*(load(t) for t in TEST_TILES)); XA, yA = np.vstack(XA), np.concatenate(yA)
results['tests']['A_unseen_tiles'] = evaluate('A: unseen tiles ' + ','.join(TEST_TILES), XA, yA, int(np.bincount(yA).argmax()))
for t in TEST_TILES:
    Xt, yt = load(t); results['tests'][f'A_{t}'] = evaluate(f'A: tile {t}', Xt, yt, int(np.bincount(yt).argmax()))
XB, yB = load(YEAR_TILE); results['tests']['B_other_year_same_area'] = evaluate('B: 2019_33UVP (other year)', XB, yB, int(np.bincount(yB).argmax()))
joblib.dump(model, f'{D}/model.joblib'); json.dump(results, open(f'{D}/results.json', 'w'), indent=1)
print('\nsaved model and results to', D, flush=True)
