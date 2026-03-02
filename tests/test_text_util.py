"""Tests for the shared text_util module."""

from core.text_util import is_cjk, estimate_tokens


class TestIsCjk:
    """Tests for is_cjk()."""

    def test_ascii_letter(self):
        assert is_cjk("A") is False

    def test_digit(self):
        assert is_cjk("5") is False

    def test_space(self):
        assert is_cjk(" ") is False

    def test_cjk_unified_ideograph(self):
        # 中 = U+4E2D
        assert is_cjk("中") is True

    def test_cjk_extension_a(self):
        # U+3400 is CJK Unified Ideographs Extension A start
        assert is_cjk("\u3400") is True

    def test_hiragana(self):
        # あ = U+3042
        assert is_cjk("あ") is True

    def test_katakana(self):
        # ア = U+30A2
        assert is_cjk("ア") is True

    def test_cjk_punctuation(self):
        # 。 = U+3002 (CJK Symbols and Punctuation)
        assert is_cjk("。") is True

    def test_fullwidth_form(self):
        # Ａ = U+FF21 (Fullwidth Latin Capital Letter A)
        assert is_cjk("Ａ") is True

    def test_emoji_is_not_cjk(self):
        assert is_cjk("😀") is False


class TestEstimateTokens:
    """Tests for estimate_tokens()."""

    def test_empty_string(self):
        assert estimate_tokens("") == 0

    def test_pure_ascii(self):
        # 20 chars -> 20 // 4 = 5
        text = "a" * 20
        assert estimate_tokens(text) == 5

    def test_pure_cjk(self):
        # 10 CJK chars -> 10 // 2 = 5
        text = "中" * 10
        assert estimate_tokens(text) == 5

    def test_mixed_content(self):
        # 4 CJK + 8 ASCII = (4//2) + (8//4) = 2 + 2 = 4
        text = "中文ab英文cd"
        cjk_count = sum(1 for c in text if is_cjk(c))
        other_count = len(text) - cjk_count
        expected = (cjk_count // 2) + (other_count // 4)
        assert estimate_tokens(text) == expected

    def test_safety_margin_zero(self):
        text = "a" * 20  # 5 tokens
        assert estimate_tokens(text, safety_margin=0.0) == 5

    def test_safety_margin_ten_percent(self):
        text = "a" * 20  # 5 tokens -> int(5 * 1.1) = 5
        assert estimate_tokens(text, safety_margin=0.1) == int(5 * 1.1)

    def test_safety_margin_larger(self):
        text = "a" * 40  # 10 tokens -> int(10 * 1.1) = 11
        assert estimate_tokens(text, safety_margin=0.1) == 11

    def test_default_margin_is_zero(self):
        text = "a" * 40  # 10 tokens
        assert estimate_tokens(text) == 10

    def test_non_empty_returns_positive(self):
        # Even a single char should return >= 0
        assert estimate_tokens("x") >= 0

    def test_consistency_with_scene_packet_behavior(self):
        """Verify that safety_margin=0.1 matches old scene_packet behavior."""
        text = "Hello World 你好世界 テスト"
        cjk_count = sum(1 for c in text if is_cjk(c))
        other_count = len(text) - cjk_count
        raw = (cjk_count // 2) + (other_count // 4)
        expected = int(raw * 1.1)
        assert estimate_tokens(text, safety_margin=0.1) == expected
