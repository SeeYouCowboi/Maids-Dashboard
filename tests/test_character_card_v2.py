import os
import tempfile
import unittest
import canon.store as canon_store
import rp_assets


TESTS_DIR = os.path.dirname(os.path.abspath(__file__))


class TestCharacterCardV2(unittest.TestCase):
    def __init__(self, methodName: str = "runTest") -> None:
        super().__init__(methodName)
        self._tmp = None
        self.db_path = ""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(dir=TESTS_DIR)
        self.db_path = os.path.join(self._tmp.name, "maids.db")
        canon_store.init_db(self.db_path)

    def tearDown(self) -> None:
        if self._tmp is not None:
            self._tmp.cleanup()

    def test_import_export_roundtrip(self) -> None:
        """Test that importing and exporting a V2 card produces the same data."""
        # Import a V2 card
        v2_card = {
            "spec": "chara_card_v2",
            "name": "Test Character",
            "description": "A test character for unit testing.",
            "personality": "Calm and collected.",
            "scenario": "In a dark fantasy world.",
            "first_mes": "Hello, traveler.",
            "mes_example": "[character] Hello there!",
            "creator_notes": "Test notes.",
            "system_prompt": "You are a character.",
            "post_history_instructions": "Remember past events.",
            "tags": ["fantasy", "test"],
            "creator": "Test Creator",
            "character_version": "1.0",
            "extensions": {"custom_key": "custom_value"},
        }
        
        result = rp_assets.import_character_card_v2(v2_card)
        character_id = result["character_id"]
        
        # Export the card back
        exported = rp_assets.export_character_card_v2(character_id)
        
        # Verify roundtrip data matches
        self.assertEqual(exported["spec"], "chara_card_v2")
        self.assertEqual(exported["name"], "Test Character")
        self.assertEqual(exported["description"], "A test character for unit testing.")
        self.assertEqual(exported["personality"], "Calm and collected.")
        self.assertEqual(exported["scenario"], "In a dark fantasy world.")
        self.assertEqual(exported["first_mes"], "Hello, traveler.")
        self.assertEqual(exported["mes_example"], "[character] Hello there!")
        self.assertEqual(exported["creator_notes"], "Test notes.")
        self.assertEqual(exported["system_prompt"], "You are a character.")
        self.assertEqual(exported["post_history_instructions"], "Remember past events.")
        self.assertEqual(exported["tags"], ["fantasy", "test"])
        self.assertEqual(exported["creator"], "Test Creator")
        self.assertEqual(exported["character_version"], "1.0")
        self.assertEqual(exported["extensions"], {"custom_key": "custom_value"})

    def test_ui_edit_syncs_to_raw(self) -> None:
        """Test that UI edits update both character table and raw_json."""
        # Import a V2 card first
        v2_card = {
            "spec": "chara_card_v2",
            "name": "Original Name",
            "description": "Original description.",
            "personality": "Original personality.",
        }
        
        result = rp_assets.import_character_card_v2(v2_card)
        character_id = result["character_id"]
        
        # Update via UI edit
        updated_fields = {
            "name": "Updated Name",
            "description": "Updated description.",
            "personality": "Updated personality.",
            "scenario": "New scenario.",
        }
        
        rp_assets.update_character_and_raw(character_id, updated_fields)
        
        # Export and verify both tables were updated
        exported = rp_assets.export_character_card_v2(character_id)
        
        self.assertEqual(exported["name"], "Updated Name")
        self.assertEqual(exported["description"], "Updated description.")
        self.assertEqual(exported["personality"], "Updated personality.")
        self.assertEqual(exported["scenario"], "New scenario.")
        
        # Verify original fields are preserved
        self.assertEqual(exported["creator_notes"], "")
        self.assertEqual(exported["tags"], [])

    def test_reject_invalid_spec(self) -> None:
        """Test that invalid spec is rejected."""
        invalid_card = {
            "spec": "chara_card_v1",  # Invalid spec
            "name": "Test Character",
        }
        
        with self.assertRaises(ValueError) as ctx:
            rp_assets.import_character_card_v2(invalid_card)
        
        self.assertIn("chara_card_v2", str(ctx.exception))
        
        # Also test missing spec
        missing_spec_card = {
            "name": "Test Character",
        }
        
        with self.assertRaises(ValueError) as ctx:
            rp_assets.import_character_card_v2(missing_spec_card)
        
        self.assertIn("chara_card_v2", str(ctx.exception))

    def test_export_nonexistent_character_raises(self) -> None:
        """Test that exporting nonexistent character raises KeyError."""
        with self.assertRaises(KeyError):
            rp_assets.export_character_card_v2("nonexistent-id")

    def test_update_nonexistent_character_raises(self) -> None:
        """Test that updating nonexistent character raises KeyError."""
        with self.assertRaises(KeyError):
            rp_assets.update_character_and_raw("nonexistent-id", {"name": "New Name"})


if __name__ == "__main__":
    unittest.main()
