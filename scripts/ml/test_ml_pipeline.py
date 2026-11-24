"""Tests for the parts of the model comparison that protect against fooling ourselves.

  .venv/Scripts/python -m unittest scripts/ml/test_ml_pipeline.py   (run from the repository root, or: cd scripts/ml && python -m unittest test_ml_pipeline)
"""
import copy
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ml_common import INSUFFICIENT, choose_confidence_threshold, compute_metrics, path, training_config  # noqa: E402
from prediction_safety import build_spec, choose_cause_threshold, predict_with_safety, validate_rows  # noqa: E402
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
        proba = np.array([[0.9, 0.1]] * 6)                          # always confidently "healthy" (class 0): every stressed field is missed
        self.assertIsNone(choose_confidence_threshold(proba, y, 0, 0.1, 0.2))

    def test_cause_task_needs_real_skill_or_it_never_answers(self):
        rng = np.random.default_rng(0)
        y = rng.integers(0, 3, 300)
        noise = rng.dirichlet([1, 1, 1], 300)                        # confident-looking but unrelated to y
        self.assertIsNone(choose_cause_threshold(noise, y, 0.10, 0.2))
        good = np.eye(3)[y] * 0.8 + 0.1                              # genuinely informative
        self.assertIsNotNone(choose_cause_threshold(good, y, 0.10, 0.2))


NAMES = ['ndvi_mean', 'ndvi_max', 'wx_rain_sum', 'n_clear_obs', 'area_ha']


class Stub:
    def predict_proba(self, X):
        return np.tile([0.1, 0.9], (len(X), 1))


class RaisingStub:
    def predict_proba(self, X):
        raise RuntimeError('boom')


def spec_for_tests():
    rng = np.random.default_rng(1)
    X = np.column_stack([rng.uniform(0.2, 0.8, 500), rng.uniform(0.5, 0.95, 500), rng.uniform(0, 300, 500), rng.integers(4, 20, 500), rng.uniform(0.3, 3, 500)]).astype(float)
    return build_spec(X, NAMES), X


class PredictionSafety(unittest.TestCase):
    """The single function a service would call: every bad input kind must come back as INSUFFICIENT_DATA_OR_LOW_CONFIDENCE with a reason."""

    def answer(self, row, threshold=0.5, model=None):
        spec, _ = spec_for_tests()
        return predict_with_safety(model or Stub(), np.array([row], float), spec, ['Healthy', 'Problem'], threshold)[0]

    good = [0.5, 0.8, 120.0, 10, 1.0]

    def test_a_normal_row_with_a_validated_threshold_is_answered(self):
        out = self.answer(self.good)
        self.assertEqual(out['answer'], 'Problem')
        self.assertEqual(out['reasons'], [])

    def test_no_validated_threshold_never_answers(self):
        out = self.answer(self.good, threshold=None)
        self.assertEqual(out['answer'], INSUFFICIENT)
        self.assertIn('no_validated_confidence_threshold', out['reasons'])

    def test_low_confidence_abstains(self):
        self.assertIn('low_confidence', self.answer(self.good, threshold=0.95)['reasons'])

    def test_missing_satellite_observations(self):
        out = self.answer([np.nan, np.nan, 120.0, np.nan, 1.0])
        self.assertEqual(out['answer'], INSUFFICIENT)
        self.assertIn('too_many_missing_features', out['reasons'])

    def test_cloud_obscured_one_clear_observation(self):
        out = self.answer([0.5, 0.8, 120.0, 1, 1.0])
        self.assertEqual(out['answer'], INSUFFICIENT)
        self.assertIn('too_few_clear_observations', out['reasons'])          # derived from the row, not passed in by the caller

    def test_invalid_numbers_are_refused_not_answered(self):
        for bad in ([np.inf, 0.8, 120.0, 10, 1.0], [0.5, -np.inf, 120.0, 10, 1.0], [0.5, 0.8, -999.0, 10, 1.0], [0.5, 0.8, 1e12, 10, 1.0]):
            out = self.answer(bad)
            self.assertEqual(out['answer'], INSUFFICIENT, bad)
            self.assertTrue(out['reasons'], bad)

    def test_out_of_distribution_x1000(self):
        self.assertEqual(self.answer([v * 1000 for v in self.good])['answer'], INSUFFICIENT)

    def test_a_model_error_is_an_abstention_not_a_crash(self):
        out = self.answer(self.good, model=RaisingStub())
        self.assertEqual(out['answer'], INSUFFICIENT)
        self.assertIn('model_error:RuntimeError', out['reasons'])

    def test_validate_rows_never_raises_on_garbage(self):
        spec, _ = spec_for_tests()
        self.assertEqual(len(validate_rows(np.array([[np.nan] * 5, [np.inf] * 5, [-1e300] * 5]), spec)), 3)


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


class Artifacts(unittest.TestCase):
    @unittest.skipUnless((path('features') / 'telangana.npz').exists(), 'run build_satellite_features.py first')
    def test_a_deep_model_reloads_from_its_own_files_and_predicts_identically(self):
        import tempfile
        import train_deep_learning_models as deep
        from task_data import load_task
        td = load_task('health_binary')
        cfg = training_config()
        cfg['deep']['max_epochs'] = 3
        fitted = deep.train_net(td, 'gru', {'dropout': 0.2, 'lr': 0.005, 'weight_decay': 1e-4, 'hidden': 16, 'layers': 1}, td.train[:600], 0, cfg)
        with tempfile.TemporaryDirectory() as d:
            base = Path(d) / 'gru'
            deep.save(fitted, base)
            self.assertTrue(all((Path(d) / f'gru{s}').exists() for s in ('.pt', '.json', '.prep.joblib')))
            reloaded = deep.load(base)
            a = deep.predict(fitted, td, td.test[:50])
            b = deep.predict(reloaded, td, td.test[:50])
            self.assertLess(float(np.abs(a - b).max()), 1e-6)


class AppRule(unittest.TestCase):
    def test_alert_means_problem_and_no_decision_is_not_a_hit(self):
        from train_classical_models import AppRuleReplay
        r = AppRuleReplay({'1': 'alert', '2': 'no_alert', '3': 'no_decision'})
        self.assertEqual(r.predict_ids(['1', '2', '3', 'unknown']).argmax(1).tolist(), [1, 0, 0, 0])


if __name__ == '__main__':
    unittest.main()
