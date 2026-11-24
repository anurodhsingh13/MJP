"""Tests for the parts of the model comparison that protect against fooling ourselves.

  .venv/Scripts/python -m unittest scripts/ml/test_ml_pipeline.py   (run from the repository root, or: cd scripts/ml && python -m unittest test_ml_pipeline)
"""
import copy
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ml_common import INSUFFICIENT, apply_abstention, choose_confidence_threshold, compute_metrics, path, training_config  # noqa: E402
from compare_models import select_models  # noqa: E402


def fake_result(model, ba, ci_low, held, test_ba=0.99, kind='classical'):
    val = {'f1_macro': ba, 'balanced_accuracy': ba, 'balanced_accuracy_ci95': [ci_low, ba + 0.05], 'stressed_recall': ba, 'false_healthy_rate': 1 - ba, 'recall_macro': ba, 'ece': 0.05}
    return {'task': 'health_binary', 'model': model, 'kind': kind, 'status': 'ok', 'val': val, 'test': {**val, 'balanced_accuracy': test_ba},
            'heldout': {'lodo': {'A': {'balanced_accuracy': held}}, 'season': {}}, 'latency': {'single_median_ms': 1.0}, 'model_size_bytes': 1000}


class Selection(unittest.TestCase):
    cfg = training_config()

    def test_selection_never_reads_the_test_split(self):
        results = [fake_result('a', 0.70, 0.62, 0.66), fake_result('b', 0.60, 0.53, 0.60)]
        altered = copy.deepcopy(results)
        for r in altered:
            r['test'] = {'garbage': True}                       # select_models must not even look
        self.assertEqual(select_models(results, 'health_binary', self.cfg), select_models(altered, 'health_binary', self.cfg))

    def test_baselines_are_never_selected(self):
        results = [fake_result('majority_class', 0.99, 0.98, 0.99), fake_result('xgboost', 0.60, 0.55, 0.60)]
        sel = select_models(results, 'health_binary', self.cfg)
        self.assertNotIn('majority_class', sel['scores'])
        self.assertEqual(sel['best_attempt'], 'xgboost')

    def test_a_model_at_chance_is_not_eligible(self):
        results = [fake_result('lightgbm', 0.52, 0.47, 0.51)]    # CI lower bound under chance 0.5
        sel = select_models(results, 'health_binary', self.cfg)
        self.assertEqual(sel['eligible'], [])
        self.assertIsNone(sel['best_overall'])
        self.assertIsNone(sel['production_candidate'])
        self.assertEqual(sel['best_attempt'], 'lightgbm')        # reported as an attempt, not as a winner

    def test_a_good_generaliser_is_eligible(self):
        results = [fake_result('lightgbm', 0.75, 0.68, 0.70)]
        self.assertEqual(select_models(results, 'health_binary', self.cfg)['eligible'], ['lightgbm'])

    def test_good_validation_but_poor_heldout_is_not_eligible(self):
        results = [fake_result('lightgbm', 0.75, 0.68, 0.50)]    # held-out districts at chance
        self.assertEqual(select_models(results, 'health_binary', self.cfg)['eligible'], [])


class Abstention(unittest.TestCase):
    def test_threshold_is_none_when_no_safe_threshold_exists(self):
        y = np.array([1, 1, 1, 1, 0, 0])
        proba = np.array([[0.9, 0.1]] * 4 + [[0.9, 0.1]] * 2)     # always confidently "healthy" (class 0): every stressed field is missed
        self.assertIsNone(choose_confidence_threshold(proba, y, 0, 0.1, 0.2))

    def test_low_confidence_few_observations_and_out_of_range_abstain(self):
        proba = np.array([[0.55, 0.45], [0.95, 0.05], [0.95, 0.05], [0.95, 0.05]])
        out = apply_abstention(proba, 0.8, ['Healthy', 'Problem'], clear_observations=np.array([9, 9, 2, 9]), min_clear=3, inside_training_range=np.array([True, True, True, False]))
        self.assertEqual(out, [INSUFFICIENT, 'Healthy', INSUFFICIENT, INSUFFICIENT])

    def test_no_threshold_means_always_abstain(self):
        self.assertEqual(apply_abstention(np.array([[0.99, 0.01]]), None, ['Healthy', 'Problem']), [INSUFFICIENT])


class Metrics(unittest.TestCase):
    def test_perfect_and_false_healthy(self):
        y = np.array([0, 0, 1, 1])
        perfect = compute_metrics(y, np.array([[1.0, 0.0], [1.0, 0.0], [0.0, 1.0], [0.0, 1.0]]), ['Healthy', 'Problem'], 'Healthy', boot=20)
        self.assertEqual(perfect['accuracy'], 1.0)
        self.assertEqual(perfect['false_healthy_rate'], 0.0)
        missed = compute_metrics(y, np.array([[1.0, 0.0]] * 4), ['Healthy', 'Problem'], 'Healthy', boot=20)
        self.assertEqual(missed['false_healthy_rate'], 1.0)      # every stressed field called healthy
        self.assertEqual(missed['balanced_accuracy'], 0.5)

    def test_majority_baseline_looks_good_on_accuracy_but_not_balanced_accuracy(self):
        y = np.array([0] * 9 + [1])
        m = compute_metrics(y, np.tile([1.0, 0.0], (10, 1)), ['Healthy', 'Problem'], 'Healthy', boot=20)
        self.assertEqual(m['accuracy'], 0.9)
        self.assertEqual(m['balanced_accuracy'], 0.5)


class Splits(unittest.TestCase):
    @unittest.skipUnless((path('features') / 'telangana.npz').exists(), 'run build_satellite_features.py first')
    def test_splits_do_not_leak(self):
        from create_data_splits import make_splits          # its own assertions raise on any overlap
        s = make_splits()
        self.assertEqual(sum(s['info']['sizes'].values()), s['info']['rows'])


if __name__ == '__main__':
    unittest.main()
