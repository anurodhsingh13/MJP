"""Deep models on the Telangana tasks: MLP (tabular), 1D CNN, LSTM, GRU and a temporal CNN (TCN) on the 32-step index sequences.

  .venv/Scripts/python scripts/ml/train_deep_learning_models.py [--tasks ...] [--models ...] [--force]

CPU only: the installed PyTorch is a CPU build, so no GPU is used or claimed (the RTX 4050 is present but idle).
Sequence models read (NDVI, NDRE, NDMI, distance-to-nearest-real-observation) over 32 normalised-time steps and get the crop and
season one-hot vectors at the classifier head. Class imbalance is handled with inverse-frequency loss weights. Early stopping uses a
15% hold-out of the TRAINING rows. A transformer is not trained: see configs/ml/model_config.yaml.
Tuning for the deep models uses one hold-out of the training rows instead of K-fold CV (4 trials) to keep the CPU time reasonable.
"""
from __future__ import annotations

import argparse
import copy
import io
from types import SimpleNamespace

import numpy as np
import torch
import torch.nn as nn
from sklearn.impute import SimpleImputer
from sklearn.metrics import f1_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

from ml_common import load_config
from optimize_hyperparameters import run_study
from task_data import TASKS

torch.set_num_threads(8)


# ------------------------------------------------------------------------------------------------------------------ networks
class Mlp(nn.Module):
    def __init__(self, n_in, n_out, hidden, layers, dropout, **_):
        super().__init__()
        blocks, d = [], n_in
        for _i in range(layers):
            blocks += [nn.Linear(d, hidden), nn.ReLU(), nn.Dropout(dropout)]
            d = hidden
        self.body, self.head = nn.Sequential(*blocks), nn.Linear(d, n_out)

    def forward(self, tab, seq=None, static=None):
        return self.head(self.body(tab))


class Head(nn.Module):
    def __init__(self, d, n_static, n_out, dropout):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(d + n_static, 32), nn.ReLU(), nn.Dropout(dropout), nn.Linear(32, n_out))

    def forward(self, z, static):
        return self.net(torch.cat([z, static], 1))


class Cnn1d(nn.Module):
    def __init__(self, n_static, n_out, channels, dropout, **_):
        super().__init__()
        self.conv = nn.Sequential(nn.Conv1d(4, channels, 5, padding=2), nn.ReLU(), nn.Conv1d(channels, channels * 2, 5, padding=2), nn.ReLU(), nn.AdaptiveAvgPool1d(1))
        self.head = Head(channels * 2, n_static, n_out, dropout)

    def forward(self, tab, seq, static):
        return self.head(self.conv(seq.transpose(1, 2)).squeeze(-1), static)


class Recurrent(nn.Module):
    def __init__(self, cell, n_static, n_out, hidden, layers, dropout, **_):
        super().__init__()
        self.rnn = cell(4, hidden, num_layers=layers, batch_first=True, dropout=dropout if layers > 1 else 0.0)
        self.head = Head(hidden, n_static, n_out, dropout)

    def forward(self, tab, seq, static):
        out, _h = self.rnn(seq)
        return self.head(out[:, -1], static)


class TcnBlock(nn.Module):
    def __init__(self, c_in, c_out, dilation, dropout):
        super().__init__()
        self.pad = 2 * dilation
        self.c1, self.c2 = nn.Conv1d(c_in, c_out, 3, dilation=dilation), nn.Conv1d(c_out, c_out, 3, dilation=dilation)
        self.drop, self.skip = nn.Dropout(dropout), (nn.Conv1d(c_in, c_out, 1) if c_in != c_out else nn.Identity())

    def forward(self, x):
        y = torch.relu(self.c1(nn.functional.pad(x, (self.pad, 0))))        # causal: pad on the left only
        y = self.drop(torch.relu(self.c2(nn.functional.pad(y, (self.pad, 0)))))
        return torch.relu(y + self.skip(x))


class Tcn(nn.Module):
    def __init__(self, n_static, n_out, channels, levels, dropout, **_):
        super().__init__()
        blocks, c = [], 4
        for i in range(levels):
            blocks.append(TcnBlock(c, channels, 2 ** i, dropout))
            c = channels
        self.tcn, self.head = nn.Sequential(*blocks), Head(channels, n_static, n_out, dropout)

    def forward(self, tab, seq, static):
        return self.head(self.tcn(seq.transpose(1, 2))[:, :, -1], static)


def make_net(model: str, params: dict, n_tab: int, n_static: int, n_out: int) -> nn.Module:
    if model == 'mlp':
        return Mlp(n_tab, n_out, **params)
    if model == 'cnn1d':
        return Cnn1d(n_static, n_out, **params)
    if model == 'lstm':
        return Recurrent(nn.LSTM, n_static, n_out, **params)
    if model == 'gru':
        return Recurrent(nn.GRU, n_static, n_out, **params)
    if model == 'tcn':
        return Tcn(n_static, n_out, **params)
    raise KeyError(model)


def space(model: str, t) -> dict:
    p = {'dropout': t.suggest_float('dropout', 0.1, 0.5), 'lr': t.suggest_float('lr', 1e-3, 1e-2, log=True), 'weight_decay': t.suggest_float('weight_decay', 1e-5, 1e-2, log=True)}
    if model == 'mlp':
        p.update(hidden=t.suggest_categorical('hidden', [32, 64, 128]), layers=t.suggest_int('layers', 1, 2))
    elif model == 'cnn1d':
        p.update(channels=t.suggest_categorical('channels', [16, 32, 64]))
    elif model in ('lstm', 'gru'):
        p.update(hidden=t.suggest_categorical('hidden', [16, 32, 64]), layers=t.suggest_int('layers', 1, 2))
    elif model == 'tcn':
        p.update(channels=t.suggest_categorical('channels', [16, 32]), levels=t.suggest_int('levels', 3, 4))
    return p


# --------------------------------------------------------------------------------------------------------------- preprocessing
def prepare(td, rows) -> SimpleNamespace:
    """Scalers fitted on `rows` (training rows) only."""
    imp, sc = SimpleImputer(strategy='median'), StandardScaler()
    sc.fit(imp.fit_transform(td.X[rows]))
    seq = td.seq[rows]
    mean, std = np.nanmean(seq, axis=(0, 1)), np.nanstd(seq, axis=(0, 1)) + 1e-6
    return SimpleNamespace(imp=imp, sc=sc, seq_mean=mean, seq_std=std)


def tensors_from(X, seq, static, prep):
    tab = prep.sc.transform(prep.imp.transform(X))
    seq = np.nan_to_num((seq - prep.seq_mean) / prep.seq_std)                   # NaN (no usable index value) becomes the training mean
    f = lambda a: torch.tensor(np.asarray(a), dtype=torch.float32)
    return f(tab), f(seq), f(static)


def tensors(td, rows, prep):
    return tensors_from(td.X[rows], td.seq[rows], td.static[rows], prep)


def train_net(td, model, params, rows, seed, cfg):
    torch.manual_seed(seed)
    np.random.seed(seed)
    n_out = len(td.classes)
    y_all = td.y[rows]
    fit_rows, es_rows = train_test_split(np.arange(len(rows)), test_size=0.15, stratify=y_all, random_state=seed)
    prep = prepare(td, rows[fit_rows])
    net_params = {k: v for k, v in params.items() if k not in ('lr', 'weight_decay')}
    net = make_net(model, net_params, td.X.shape[1], td.static.shape[1], n_out)
    tab_f, seq_f, st_f = tensors(td, rows[fit_rows], prep)
    tab_e, seq_e, st_e = tensors(td, rows[es_rows], prep)
    y_f, y_e = torch.tensor(y_all[fit_rows]), torch.tensor(y_all[es_rows])
    counts = np.bincount(y_all[fit_rows], minlength=n_out).astype(float)
    loss_fn = nn.CrossEntropyLoss(weight=torch.tensor(len(y_f) / (n_out * np.maximum(counts, 1)), dtype=torch.float32))
    opt = torch.optim.AdamW(net.parameters(), lr=params['lr'], weight_decay=params['weight_decay'])
    best, best_state, bad = float('inf'), None, 0
    g = torch.Generator().manual_seed(seed)
    for _epoch in range(cfg['deep']['max_epochs']):
        net.train()
        order = torch.randperm(len(y_f), generator=g)
        for i in range(0, len(order), cfg['deep']['batch_size']):
            b = order[i:i + cfg['deep']['batch_size']]
            opt.zero_grad()
            loss_fn(net(tab_f[b], seq_f[b], st_f[b]), y_f[b]).backward()
            opt.step()
        net.eval()
        with torch.no_grad():
            v = loss_fn(net(tab_e, seq_e, st_e), y_e).item()
        if v < best - 1e-4:
            best, best_state, bad = v, copy.deepcopy(net.state_dict()), 0
        else:
            bad += 1
            if bad >= cfg['deep']['patience']:
                break
    net.load_state_dict(best_state)
    net.eval()
    return SimpleNamespace(net=net, prep=prep, model=model, params=params, es_loss=best, n_tab=td.X.shape[1], n_static=td.static.shape[1], n_out=n_out)


# ------------------------------------------------------------------------------------------------ interface used by experiment.py
def applicable(model, td):
    return True


def not_applicable_reason(model, td):
    return ''


def tune(td, model, cfg, seed, rows=None, trials=None, timeout=None, cv_folds=None):
    rows = td.train if rows is None else np.asarray(rows)
    tr_i, ho_i = train_test_split(np.arange(len(rows)), test_size=0.2, stratify=td.y[rows], random_state=seed)

    def objective(trial):
        params = space(model, trial)
        fitted = train_net(td, model, params, rows[tr_i], seed, cfg)
        pred = predict(fitted, td, rows[ho_i]).argmax(1)
        return float(f1_score(td.y[rows[ho_i]], pred, average='macro', zero_division=0))

    params, score, trials, secs = run_study(objective, trials or cfg['optuna']['trials_deep'], timeout or cfg['optuna']['timeout_seconds_per_model'], seed)
    if params is None:
        raise RuntimeError('no tuning trial finished inside the time limit')
    return params, score, trials, secs


def fit(td, model, params, rows, seed):
    return train_net(td, model, params, np.asarray(rows), seed, training_cfg())


def predict_arrays(fitted, X, seq, static):
    tab, sq, st = tensors_from(X, seq, static, fitted.prep)
    with torch.no_grad():
        return torch.softmax(fitted.net(tab, sq, st), 1).numpy().astype(float)


def predict(fitted, td, rows):
    return predict_arrays(fitted, td.X[rows], td.seq[rows], td.static[rows])


def gpu_used(model):
    return False


def size_bytes(fitted):
    buf = io.BytesIO()
    torch.save(fitted.net.state_dict(), buf)
    return buf.getbuffer().nbytes


def save(fitted, base):
    """Three files, together a complete model: <name>.pt (weights only, loadable with weights_only=True), <name>.json (architecture and settings) and
    <name>.prep.joblib (the imputer, scaler and sequence statistics fitted on the training rows). `load` rebuilds the model from them."""
    import json
    import joblib
    base.parent.mkdir(parents=True, exist_ok=True)
    torch.save(fitted.net.state_dict(), base.with_suffix('.pt'))
    base.with_suffix('.json').write_text(json.dumps({'model': fitted.model, 'params': fitted.params, 'n_tab': fitted.n_tab, 'n_static': fitted.n_static, 'n_out': fitted.n_out}), encoding='utf-8')
    joblib.dump(fitted.prep, base.with_suffix('.prep.joblib'))


def load(base):
    import json
    import joblib
    meta = json.loads(base.with_suffix('.json').read_text(encoding='utf-8'))
    net_params = {k: v for k, v in meta['params'].items() if k not in ('lr', 'weight_decay')}
    net = make_net(meta['model'], net_params, meta['n_tab'], meta['n_static'], meta['n_out'])
    net.load_state_dict(torch.load(base.with_suffix('.pt'), map_location='cpu', weights_only=True))
    net.eval()
    return SimpleNamespace(net=net, prep=joblib.load(base.with_suffix('.prep.joblib')), model=meta['model'], params=meta['params'], n_tab=meta['n_tab'], n_static=meta['n_static'], n_out=meta['n_out'])


def training_cfg():
    from ml_common import training_config
    return training_config()


def main():
    from experiment import run_one
    ap = argparse.ArgumentParser()
    ap.add_argument('--tasks', nargs='*', default=list(TASKS))
    ap.add_argument('--models', nargs='*', default=None)
    ap.add_argument('--run-id', default='main')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    for task in a.tasks:
        for m in a.models or load_config('model_config')['deep_learning']:
            run_one(task, m, 'deep', a.run_id, a.force)


if __name__ == '__main__':
    main()
