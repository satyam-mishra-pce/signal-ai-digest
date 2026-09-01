import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("signal_pipeline", Path(__file__).parents[1] / "scripts/pipeline.py")
pipeline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pipeline)


class PipelineTests(unittest.TestCase):
    def test_normalize_preserves_thread_quote_and_media(self):
        row = {
            "id": "123",
            "createdAt": "Mon Aug 31 10:00:00 +0000 2026",
            "author": {"username": "poteto", "name": "Poteto", "profilePicture": "https://img/avatar.jpg"},
            "text": "Claude Code now supports background agents",
            "url": "https://x.com/poteto/status/123",
            "conversationId": "100",
            "isReply": True,
            "inReplyToId": "100",
            "inReplyToUsername": "ClaudeDevs",
            "isQuoteStatus": True,
            "media": [{
                "id": "m1", "type": "video", "mediaUrl": "https://pbs.twimg.com/poster.jpg",
                "width": 1280, "height": 720,
                "videoVariants": [
                    {"contentType": "video/mp4", "bitrate": 256000, "url": "https://video/low.mp4"},
                    {"contentType": "video/mp4", "bitrate": 832000, "url": "https://video/high.mp4"},
                ],
            }],
            "quotedTweet": {
                "id": "99", "createdAt": "Mon Aug 31 09:00:00 +0000 2026",
                "author": {"username": "bcherny", "name": "Boris"}, "text": "Shipping today",
            },
        }
        record = pipeline.normalize(row)
        self.assertEqual(record["conversationId"], "100")
        self.assertEqual(record["inReplyToId"], "100")
        self.assertEqual(record["type"], "reply")
        self.assertEqual(record["media"][0]["playbackUrl"], "https://video/high.mp4")
        self.assertEqual(record["quotedPost"]["author"], "bcherny")

    def test_plain_repost_without_authored_text_is_not_ai_signal(self):
        record = {"text": "RT", "id": "1"}
        self.assertIsNone(pipeline.topic_for(record))

    def test_topic_assignment_requires_ai_and_topic_evidence(self):
        self.assertEqual(
            pipeline.topic_for({"text": "Claude Code added background subagents and a persistent agent loop"}),
            "agent-harnesses",
        )
        self.assertIsNone(pipeline.topic_for({"text": "My favorite model train arrived today"}))

    def test_week_starts_on_monday(self):
        start, end = pipeline.weekly_bounds("2026-08-31T10:00:00+00:00")
        self.assertEqual(start.isoformat(), "2026-08-31")
        self.assertEqual(end.isoformat(), "2026-09-06")


if __name__ == "__main__":
    unittest.main()
