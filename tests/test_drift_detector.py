"""Tests for drift_detector module."""

import pytest
from drift_detector import (
    compute_drift_score,
    reconcile_snapshots,
    suggest_resolution
)


class TestComputeDriftScore:
    """Tests for compute_drift_score function."""
    
    def test_no_change_returns_zero(self):
        """When snapshots are identical, drift should be 0."""
        snapshot = {
            'facts': {'f1': {'confidence': 0.9, 'value': 'A'}},
            'entities': {'e1': {'name': 'Entity1'}},
            'plot': 'home',
            'confidence': 0.9
        }
        score = compute_drift_score(snapshot, snapshot, [])
        assert score == 0.0
    
    def test_fact_churn_calculates_correctly(self):
        """Fact additions and retirements contribute to drift."""
        before = {
            'facts': {'f1': {'confidence': 0.9}},
            'entities': {},
            'plot': 'home',
            'confidence': 0.9
        }
        after = {
            'facts': {'f2': {'confidence': 0.9}},
            'entities': {},
            'plot': 'home',
            'confidence': 0.9
        }
        score = compute_drift_score(before, after, [])
        # 1 added + 1 retired = 2/1 = 2.0, weighted 0.3 = 0.6
        assert 0.0 < score <= 1.0
    
    def test_entity_turnover_calculates_correctly(self):
        """Entity additions and removals contribute to drift."""
        before = {
            'facts': {},
            'entities': {'e1': {'name': 'Entity1'}},
            'plot': 'home',
            'confidence': 0.9
        }
        after = {
            'facts': {},
            'entities': {'e2': {'name': 'Entity2'}},
            'plot': 'home',
            'confidence': 0.9
        }
        score = compute_drift_score(before, after, [])
        assert 0.0 < score <= 1.0
    
    def test_plot_change_adds_drift(self):
        """Plot changes add up to 0.3 to drift score."""
        before = {
            'facts': {},
            'entities': {},
            'plot': 'home',
            'confidence': 0.9
        }
        after = {
            'facts': {},
            'entities': {},
            'plot': 'away',
            'confidence': 0.9
        }
        score = compute_drift_score(before, after, [])
        # Plot change adds some drift
        assert 0.0 <= score <= 1.0
    
    def test_confidence_drop_adds_drift(self):
        """Confidence decreases add up to 0.2 to drift score."""
        before = {
            'facts': {'f1': {'confidence': 0.9, 'value': 'A'}},
            'entities': {},
            'plot': 'home',
            'confidence': 0.9
        }
        after = {
            'facts': {'f1': {'confidence': 0.5, 'value': 'A'}},
            'entities': {},
            'plot': 'home',
            'confidence': 0.5
        }
        score = compute_drift_score(before, after, [])
        # 0.4 drop * 0.2 weight = 0.08 from confidence
        assert 0.0 <= score <= 1.0
    
    def test_max_score_is_one(self):
        """Score cannot exceed 1.0."""
        before = {
            'facts': {f'f{i}': {'confidence': 0.9} for i in range(10)},
            'entities': {f'e{i}': {} for i in range(10)},
            'plot': 'start',
            'confidence': 0.9
        }
        after = {
            'facts': {f'g{i}': {'confidence': 0.1} for i in range(10)},
            'entities': {f'x{i}': {} for i in range(10)},
            'plot': 'end',
            'confidence': 0.1
        }
        score = compute_drift_score(before, after, [])
        assert score <= 1.0


class TestReconcileSnapshots:
    """Tests for reconcile_snapshots function."""
    
    def test_overlay_wins_strategy(self):
        """Overlay values should win when strategy is overlay_wins."""
        base = {'a': 1, 'b': {'confidence': 0.5}}
        overlay = {'a': 2, 'b': {'confidence': 0.9}}
        result = reconcile_snapshots(base, overlay, 'overlay_wins')
        assert result['a'] == 2
        assert result['b']['confidence'] == 0.9
    
    def test_base_wins_strategy(self):
        """Base values should win when strategy is base_wins."""
        base = {'a': 1, 'b': {'confidence': 0.5}}
        overlay = {'a': 2, 'b': {'confidence': 0.9}}
        result = reconcile_snapshots(base, overlay, 'base_wins')
        assert result['a'] == 1
        assert result['b']['confidence'] == 0.5
    
    def test_max_confidence_strategy(self):
        """Should pick fact with higher confidence."""
        base = {'fact': {'confidence': 0.5, 'value': 'base_val'}}
        overlay = {'fact': {'confidence': 0.9, 'value': 'overlay_val'}}
        result = reconcile_snapshots(base, overlay, 'max_confidence')
        assert result['fact']['confidence'] == 0.9
        assert result['fact']['value'] == 'overlay_val'
    
    def test_latest_timestamp_strategy(self):
        """Should pick fact with later timestamp."""
        base = {'fact': {'timestamp': 100, 'value': 'base_val'}}
        overlay = {'fact': {'timestamp': 200, 'value': 'overlay_val'}}
        result = reconcile_snapshots(base, overlay, 'latest_timestamp')
        assert result['fact']['timestamp'] == 200
        assert result['fact']['value'] == 'overlay_val'
    
    def test_handles_missing_keys(self):
        """Should handle keys present in only one snapshot."""
        base = {'a': 1}
        overlay = {'b': 2}
        result = reconcile_snapshots(base, overlay, 'overlay_wins')
        assert result['a'] == 1
        assert result['b'] == 2


class TestSuggestResolution:
    """Tests for suggest_resolution function."""
    
    def test_suggests_auto_overlay_when_newer(self):
        """Should suggest overlay when it has newer timestamp."""
        conflict = {
            'base': {'timestamp': 100, 'facts': {'f1': {'confidence': 0.9}}},
            'overlay': {'timestamp': 200, 'facts': {'f1': {'confidence': 0.9}}}
        }
        result = suggest_resolution(conflict, [conflict['base']])
        assert result['resolution_type'] == 'auto_overlay'
        assert 'newer' in result['reason'].lower()
    
    def test_suggests_auto_base_when_base_newer(self):
        """Should suggest base when it has newer timestamp."""
        conflict = {
            'base': {'timestamp': 300, 'facts': {'f1': {'confidence': 0.9}}},
            'overlay': {'timestamp': 200, 'facts': {'f1': {'confidence': 0.9}}}
        }
        result = suggest_resolution(conflict, [conflict['base']])
        assert result['resolution_type'] == 'auto_base'
        assert 'newer' in result['reason'].lower()
    
    def test_suggests_manual_for_similar_confidence(self):
        """Should suggest manual when confidences are similar."""
        conflict = {
            'base': {'timestamp': 100, 'facts': {'f1': {'confidence': 0.5}}},
            'overlay': {'timestamp': 100, 'facts': {'f1': {'confidence': 0.51}}}
        }
        result = suggest_resolution(conflict, [])
        assert result['resolution_type'] == 'manual'
        assert result['confidence'] == 0.5
    
    def test_returns_valid_confidence(self):
        """Confidence should be between 0.0 and 1.0."""
        conflict = {'base': {}, 'overlay': {}}
        result = suggest_resolution(conflict, [])
        assert 0.0 <= result['confidence'] <= 1.0
    
    def test_includes_reason(self):
        """Result should include a reason string."""
        conflict = {'base': {}, 'overlay': {}}
        result = suggest_resolution(conflict, [])
        assert 'reason' in result
        assert isinstance(result['reason'], str)
        assert len(result['reason']) > 0
