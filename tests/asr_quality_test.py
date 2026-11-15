import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))
from asr_quality import score_transcript  # noqa: E402


class AsrQualityTests(unittest.TestCase):
    def test_perfect_transcript_is_zero_error_after_normalization(self):
        result = score_transcript(" Hello   WORLD ", "hello world")
        self.assertEqual(result["cer"], 0.0)
        self.assertEqual(result["wer"], 0.0)
        self.assertEqual(result["reference_words"], 2)
        self.assertEqual(result["hypothesis_words"], 2)

    def test_character_and_word_errors_are_reported_without_text(self):
        result = score_transcript("cat sat", "cat dog")
        self.assertEqual(result["wer"], 0.5)
        self.assertGreater(result["cer"], 0.0)
        self.assertNotIn("cat sat", json.dumps(result))
        self.assertNotIn("cat dog", json.dumps(result))

    def test_empty_reference_has_defined_error_rate(self):
        self.assertEqual(score_transcript("", "")["cer"], 0.0)
        self.assertEqual(score_transcript("", "audio")["wer"], 1.0)


if __name__ == "__main__":
    unittest.main()
