"""Regression tests for `_guard_open_claims`.

The guard must rewrite only *false completed-open* claims when no open was
confirmed, and must leave legitimate find/offer/list/clarify replies untouched.
Over-broad matching previously nuked correct live-channel replies into a canned
"TV pe title switch nahi hua" failure, so these tests lock the boundary.
"""

from __future__ import annotations

import unittest

from orchestrator.llm.agent import _guard_open_claims

_FAILURE = "TV pe title switch nahi hua"


class GuardOpenClaimsTests(unittest.TestCase):
    def test_confirmed_open_passes_through(self) -> None:
        reply = "Disney Channel khol diya — B dabao play ke liye."
        self.assertEqual(_guard_open_claims(reply, True), reply)

    def test_offer_to_open_is_not_rewritten(self) -> None:
        reply = "Tom and Jerry channel mil gaya — kholun?"
        self.assertEqual(_guard_open_claims(reply, False), reply)

    def test_english_offer_is_not_rewritten(self) -> None:
        reply = "Found the Tom and Jerry channel. Want me to open it?"
        self.assertEqual(_guard_open_claims(reply, False), reply)

    def test_listing_options_is_not_rewritten(self) -> None:
        reply = (
            "Cartoon channels: Disney Channel, Nick Jr., Kartoon Channel. "
            "Kaunsa lagau?"
        )
        self.assertEqual(_guard_open_claims(reply, False), reply)

    def test_plain_found_mention_is_not_rewritten(self) -> None:
        reply = "I found a few cartoon channels in the live lineup."
        self.assertEqual(_guard_open_claims(reply, False), reply)

    def test_false_completed_claim_is_rewritten(self) -> None:
        reply = "Disney Channel khol diya, TV pe dikha raha hai."
        self.assertTrue(_guard_open_claims(reply, False).startswith(_FAILURE))

    def test_false_english_opened_claim_is_rewritten(self) -> None:
        reply = "Opened Disney Channel on the TV — press B to play."
        self.assertTrue(_guard_open_claims(reply, False).startswith(_FAILURE))

    def test_empty_reply_passes_through(self) -> None:
        self.assertEqual(_guard_open_claims("", False), "")


if __name__ == "__main__":
    unittest.main()
