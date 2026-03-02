"""Drift detection and reconciliation for MAIDS dashboard."""

import logging
from typing import Any

logger = logging.getLogger(__name__)

from typing import Any

def compute_drift_score(snapshot_before: dict, snapshot_after: dict, events: list) -> float:
    """Calculate drift score 0.0-1.0 based on snapshot changes.
    
    Args:
        snapshot_before: Initial snapshot dict with 'facts', 'entities', 'plot', 'confidence'
        snapshot_after: Updated snapshot dict with same structure
        events: List of event dicts with 'type', 'fact_id', etc.
    
    Returns:
        Drift score between 0.0 (no change) and 1.0 (complete change)
    """
    # Extract data from snapshots
    facts_before = snapshot_before.get('facts', {})
    facts_after = snapshot_after.get('facts', {})
    entities_before = snapshot_before.get('entities', {})
    entities_after = snapshot_after.get('entities', {})
    plot_before = snapshot_before.get('plot')
    plot_after = snapshot_after.get('plot')
    
    # Weights
    w1, w2, w3, w4 = 0.3, 0.3, 0.2, 0.2
    
    # 1. Fact churn: count facts_added + facts_retired / total_facts
    facts_before_ids = set(facts_before.keys())
    facts_after_ids = set(facts_after.keys())
    facts_added = len(facts_after_ids - facts_before_ids)
    facts_retired = len(facts_before_ids - facts_after_ids)
    total_facts = max(len(facts_before_ids), 1)
    churn = (facts_added + facts_retired) / total_facts
    
    # 2. Entity turnover: count entities_added + entities_removed / total_entities
    entities_before_ids = set(entities_before.keys())
    entities_after_ids = set(entities_after.keys())
    entities_added = len(entities_after_ids - entities_before_ids)
    entities_removed = len(entities_before_ids - entities_after_ids)
    total_entities = max(len(entities_before_ids), 1)
    turnover = (entities_added + entities_removed) / total_entities
    
    # 3. Plot distance: 0.1 per hop (max 0.3)
    plot_score = 0.0
    if plot_before and plot_after and plot_before != plot_after:
        # Calculate hop distance (simple string comparison for now)
        plot_distance = abs(hash(str(plot_before)) - hash(str(plot_after))) % 10
        plot_score = min(0.3, plot_distance * 0.1)
    
    # 4. Confidence drop: average confidence decrease of changed facts (0.0-0.2)
    confidence_drop = 0.0
    changed_facts = facts_before_ids & facts_after_ids
    if changed_facts:
        total_confidence_drop = 0.0
        for fact_id in changed_facts:
            conf_before = facts_before[fact_id].get('confidence', 1.0)
            conf_after = facts_after[fact_id].get('confidence', 1.0)
            if conf_before > conf_after:
                total_confidence_drop += (conf_before - conf_after)
        avg_confidence_drop = total_confidence_drop / len(changed_facts)
        confidence_drop = min(0.2, avg_confidence_drop * 0.2)
    
    # Calculate final score
    score = w1 * churn + w2 * turnover + w3 * plot_score + w4 * confidence_drop
    return min(1.0, score)


def reconcile_snapshots(base: dict, overlay: dict, strategy: str) -> dict:
    """Merge two snapshots using the specified strategy.
    
    Args:
        base: Base snapshot dict
        overlay: Overlay snapshot dict  
        strategy: One of "overlay_wins", "base_wins", "max_confidence", "latest_timestamp"
    
    Returns:
        New snapshot dict with reconciled values
    """
    result = {}
    
    # Get all keys from both snapshots
    all_keys = set(base.keys()) | set(overlay.keys())
    
    for key in all_keys:
        base_val = base.get(key)
        overlay_val = overlay.get(key)
        
        if base_val is None:
            result[key] = overlay_val
        elif overlay_val is None:
            result[key] = base_val
        elif strategy == "overlay_wins":
            result[key] = overlay_val
        elif strategy == "base_wins":
            result[key] = base_val
        elif strategy == "max_confidence":
            base_conf = base_val.get('confidence', 0.0) if isinstance(base_val, dict) else 0.0
            overlay_conf = overlay_val.get('confidence', 0.0) if isinstance(overlay_val, dict) else 0.0
            result[key] = base_val if base_conf >= overlay_conf else overlay_val
        elif strategy == "latest_timestamp":
            base_ts = base_val.get('timestamp', 0) if isinstance(base_val, dict) else 0
            overlay_ts = overlay_val.get('timestamp', 0) if isinstance(overlay_val, dict) else 0
            result[key] = base_val if base_ts >= overlay_ts else overlay_val
        else:
            # Default to overlay_wins
            result[key] = overlay_val
    
    return result


def suggest_resolution(conflict: dict, snapshots: list) -> dict:
    """Suggest resolution for a conflict between snapshots.
    
    Args:
        conflict: Dict with 'base', 'overlay', and optionally 'reason'
        snapshots: List of historical snapshots for context
    
    Returns:
        Dict with 'resolution_type', 'reason', 'confidence'
    """
    base = conflict.get('base', {})
    overlay = conflict.get('overlay', {})
    
    # Analyze the conflict
    base_facts = base.get('facts', {})
    overlay_facts = overlay.get('facts', {})
    
    base_entities = base.get('entities', {})
    overlay_entities = overlay.get('entities', {})
    
    # Calculate confidence scores for each
    base_conf = sum(f.get('confidence', 0) for f in base_facts.values()) / max(len(base_facts), 1)
    overlay_conf = sum(f.get('confidence', 0) for f in overlay_facts.values()) / max(len(overlay_facts), 1)
    
    # Check timestamps if available
    base_ts = base.get('timestamp', 0)
    overlay_ts = overlay.get('timestamp', 0)
    
    # Decision logic
    # Decision logic - use timestamps if we have any history
    if len(snapshots) >= 1:
        # Have history - use overlay if it's newer
        if overlay_ts > base_ts:
            return {
                "resolution_type": "auto_overlay",
                "reason": f"Overlay is newer (ts={overlay_ts}) than base (ts={base_ts})",
                "confidence": 0.8
            }
        else:
            return {
                "resolution_type": "auto_base", 
                "reason": f"Base is newer (ts={base_ts}) than overlay (ts={overlay_ts})",
                "confidence": 0.8
            }
    
    # No history or same timestamp - use confidence
    if overlay_conf > base_conf * 1.2:
        return {
            "resolution_type": "auto_overlay",
            "reason": f"Overlay has higher confidence ({overlay_conf:.2f} vs {base_conf:.2f})",
            "confidence": 0.7
        }
    elif base_conf > overlay_conf * 1.2:
        return {
            "resolution_type": "auto_base",
            "reason": f"Base has higher confidence ({base_conf:.2f} vs {overlay_conf:.2f})",
            "confidence": 0.7
        }
    
    # Similar confidence - suggest manual
    return {
        "resolution_type": "manual",
        "reason": f"Conflicts have similar confidence (base={base_conf:.2f}, overlay={overlay_conf:.2f}) and no clear history",
        "confidence": 0.5
    }
