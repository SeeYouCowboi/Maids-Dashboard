"""Shared text utilities for token estimation.

Provides CJK-aware token counting used by scene_packet, lorebook_engine,
and dashboard_backend.  Zero external dependencies.
"""

from __future__ import annotations


def is_cjk(char: str) -> bool:
    """Return True if *char* falls within a CJK / kana Unicode block."""
    code = ord(char)
    return (
        0x4E00 <= code <= 0x9FFF or    # CJK Unified Ideographs
        0x3400 <= code <= 0x4DBF or    # CJK Unified Ideographs Extension A
        0x20000 <= code <= 0x2A6DF or  # CJK Unified Ideographs Extension B
        0x2A700 <= code <= 0x2B73F or  # CJK Unified Ideographs Extension C
        0x2B740 <= code <= 0x2B81F or  # CJK Unified Ideographs Extension D
        0x3000 <= code <= 0x303F or    # CJK Symbols and Punctuation
        0xFF00 <= code <= 0xFFEF or    # Halfwidth and Fullwidth Forms
        0x3040 <= code <= 0x309F or    # Hiragana
        0x30A0 <= code <= 0x30FF       # Katakana
    )


def estimate_tokens(text: str, *, safety_margin: float = 0.0) -> int:
    """Estimate token count for *text*.

    Algorithm: CJK characters count as ``len // 2``, all others as
    ``len // 4``.  An optional *safety_margin* (e.g. ``0.1`` for 10 %)
    inflates the result.

    Args:
        text: Input string.
        safety_margin: Fractional multiplier added on top (0.0 = none).

    Returns:
        Estimated token count (always >= 0).
    """
    if not text:
        return 0
    cjk_count = sum(1 for c in text if is_cjk(c))
    other_count = len(text) - cjk_count
    tokens = (cjk_count // 2) + (other_count // 4)
    if safety_margin:
        tokens = int(tokens * (1.0 + safety_margin))
    return tokens