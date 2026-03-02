import logging

logger = logging.getLogger(__name__)


DEFAULT_THRESHOLDS = {
    "max_maid_messages": 20,
    "drift_threshold": 0.7,
}


def classify_delegation(run: dict, world: dict, branch: dict, thresholds: dict = None) -> str:
    """
    Classify who should handle this turn.
    
    Args:
        run: Dict with keys: content, trace_id, message_count
        world: Dict with keys: drift_score
        branch: Dict with keys: quality_gate_failures
        thresholds: Optional override for default thresholds
    
    Returns: "maid", "user", or "canon"
    """
    if thresholds is None:
        thresholds = DEFAULT_THRESHOLDS
    
    # Rule 1: CANON_EMERGENCY in content
    if "CANON_EMERGENCY" in run.get("content", ""):
        return "canon"
    
    # Rule 2: More than 10 canon_conflict events
    trace_id = run.get("trace_id")
    if trace_id and isinstance(trace_id, dict):
        event_log = trace_id.get("event_log", [])
        canon_conflicts = sum(1 for event in event_log if event.get("kind") == "canon_conflict")
        if canon_conflicts > 10:
            return "canon"
    
    # Rule 3: message_count exceeds threshold
    if run.get("message_count", 0) > thresholds["max_maid_messages"]:
        return "user"
    
    # Rule 4: drift_score exceeds threshold
    if world.get("drift_score", 0) > thresholds["drift_threshold"]:
        return "user"
    
    # Rule 5: 2+ consecutive quality gate failures
    if branch.get("quality_gate_failures", 0) >= 2:
        return "user"
    
    # Rule 6: Default to maid
    return "maid"
