"""One loader for the three prediction tasks, so every model sees exactly the same rows, classes and splits."""
from __future__ import annotations

from types import SimpleNamespace

import numpy as np

from ml_common import path, read_json

TASKS = {
    'health_binary': {'classes': ['Healthy', 'Problem'], 'healthy': 'Healthy'},
    'health_4class': {'classes': ['Healthy', 'Pests', 'Diseased', 'Stressed'], 'healthy': 'Healthy'},
    'stress_cause': {'classes': ['Pests', 'Diseased', 'Stressed'], 'healthy': None},
}


def load_task(task: str) -> SimpleNamespace:
    spec = TASKS[task]
    z = np.load(path('features') / 'telangana.npz', allow_pickle=True)
    splits = read_json(path('features') / 'splits.json')
    label = z['label']
    keep = np.ones(len(label), bool) if task != 'stress_cause' else label != 'Healthy'
    local = np.full(len(label), -1)
    local[keep] = np.arange(keep.sum())

    def sub(rows):                       # global row numbers -> row numbers inside this task's subset
        rows = np.asarray(rows, int)
        rows = rows[keep[rows]]
        return local[rows]

    lab = label[keep]
    if task == 'health_binary':
        y = np.where(lab == 'Healthy', 0, 1)
    else:
        y = np.array([spec['classes'].index(l) for l in lab])
    td = SimpleNamespace(
        name=task, classes=spec['classes'], healthy=spec['healthy'], y=y,
        healthy_index=None if spec['healthy'] is None else spec['classes'].index(spec['healthy']),
        X=z['X'][keep], seq=z['seq'][keep], static=z['static'][keep], feature_names=[str(n) for n in z['feature_names']],
        crop=z['crop'][keep], district=z['district'][keep], season=z['season'][keep], n_clear=z['n_clear'][keep], ids=z['ids'][keep],
        train=sub(splits['main']['train']), val=sub(splits['main']['validation']), test=sub(splits['main']['test']),
        lodo={d: {'train': sub(s['train']), 'test': sub(s['test'])} for d, s in splits['lodo'].items()},
        season_split={k: {'train': sub(s['train']), 'test': sub(s['test'])} for k, s in splits['season'].items()},
    )
    return td
