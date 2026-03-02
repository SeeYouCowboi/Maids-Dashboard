import pytest

from delegation_classifier import classify_delegation


class TestClassifyDelegation:
    """Tests for all 6 classification rules."""
    
    # Rule 1: CANON_EMERGENCY in content -> canon
    def test_canon_emergency_returns_canon(self):
        run = {"content": "This is a CANON_EMERGENCY alert", "trace_id": {}, "message_count": 5}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "canon"
    
    def test_canon_emergency_case_sensitive(self):
        run = {"content": "canon_emergency lowercase", "trace_id": {}, "message_count": 5}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "maid"  # Should NOT match (case sensitive)
    
    # Rule 2: More than 10 canon_conflict events -> canon
    def test_canon_conflicts_returns_canon(self):
        event_log = [{"kind": "canon_conflict"} for _ in range(11)]
        run = {"content": "normal", "trace_id": {"event_log": event_log}, "message_count": 5}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "canon"
    
    def test_exactly_10_canon_conflicts_not_canon(self):
        event_log = [{"kind": "canon_conflict"} for _ in range(10)]
        run = {"content": "normal", "trace_id": {"event_log": event_log}, "message_count": 5}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "maid"  # "more than 10" means 11+
    
    # Rule 3: message_count > max_maid_messages -> user
    def test_exceeds_message_threshold_returns_user(self):
        run = {"content": "normal", "trace_id": {}, "message_count": 25}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "user"
    
    def test_at_message_threshold_not_user(self):
        run = {"content": "normal", "trace_id": {}, "message_count": 20}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "maid"  # 20 is NOT > 20
    
    def test_custom_message_threshold(self):
        run = {"content": "normal", "trace_id": {}, "message_count": 15}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 0}
        thresholds = {"max_maid_messages": 10, "drift_threshold": 0.7}
        
        result = classify_delegation(run, world, branch, thresholds)
        assert result == "user"
    
    # Rule 4: drift_score > drift_threshold -> user
    def test_exceeds_drift_threshold_returns_user(self):
        run = {"content": "normal", "trace_id": {}, "message_count": 5}
        world = {"drift_score": 0.8}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "user"
    
    def test_at_drift_threshold_not_user(self):
        run = {"content": "normal", "trace_id": {}, "message_count": 5}
        world = {"drift_score": 0.7}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "maid"  # 0.7 is NOT > 0.7
    
    def test_custom_drift_threshold(self):
        run = {"content": "normal", "trace_id": {}, "message_count": 5}
        world = {"drift_score": 0.5}
        branch = {"quality_gate_failures": 0}
        thresholds = {"max_maid_messages": 20, "drift_threshold": 0.3}
        
        result = classify_delegation(run, world, branch, thresholds)
        assert result == "user"
    
    # Rule 5: quality_gate_failures >= 2 -> user
    def test_two_consecutive_failures_returns_user(self):
        run = {"content": "normal", "trace_id": {}, "message_count": 5}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 2}
        
        result = classify_delegation(run, world, branch)
        assert result == "user"
    
    def test_one_failure_not_user(self):
        run = {"content": "normal", "trace_id": {}, "message_count": 5}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 1}
        
        result = classify_delegation(run, world, branch)
        assert result == "maid"
    
    def test_zero_failures_not_user(self):
        run = {"content": "normal", "trace_id": {}, "message_count": 5}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "maid"
    
    # Rule 6: Default to maid
    def test_default_returns_maid(self):
        run = {"content": "normal task", "trace_id": {"event_log": []}, "message_count": 5}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "maid"
    
    def test_empty_inputs_returns_maid(self):
        run = {"content": "", "trace_id": {}, "message_count": 0}
        world = {"drift_score": 0}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "maid"
    
    # Priority: canon rules take precedence
    def test_canon_before_user_rules(self):
        """CANON_EMERGENCY should return canon even if other rules would trigger user."""
        run = {"content": "CANON_EMERGENCY", "trace_id": {}, "message_count": 100}
        world = {"drift_score": 1.0}
        branch = {"quality_gate_failures": 5}
        
        result = classify_delegation(run, world, branch)
        assert result == "canon"
    
    def test_canon_conflicts_before_user_rules(self):
        """Canon conflicts should return canon even if other rules would trigger user."""
        event_log = [{"kind": "canon_conflict"} for _ in range(15)]
        run = {"content": "normal", "trace_id": {"event_log": event_log}, "message_count": 100}
        world = {"drift_score": 1.0}
        branch = {"quality_gate_failures": 5}
        
        result = classify_delegation(run, world, branch)
        assert result == "canon"
    
    # Missing keys handling
    def test_missing_content_key(self):
        run = {"trace_id": {}, "message_count": 5}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "maid"
    
    def test_missing_trace_id(self):
        run = {"content": "normal", "message_count": 5}
        world = {"drift_score": 0.1}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "maid"
    
    def test_missing_drift_score(self):
        run = {"content": "normal", "trace_id": {}, "message_count": 5}
        world = {}
        branch = {"quality_gate_failures": 0}
        
        result = classify_delegation(run, world, branch)
        assert result == "maid"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
