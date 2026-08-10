#!/usr/bin/env python3
"""Regression tests for the `review-evidence` LIVENESS predicates (#413).

The gate proves that the assigned reviewer ran to completion on this head, and
nothing about what it said. Two jq clauses in `review-evidence.sh` are the whole
of that decision, and after #413 neither is backed up by a content test any more:

  * branch A accepts a SUBMITTED VERDICT (`APPROVED` / `CHANGES_REQUESTED`) and
    must keep rejecting the implicit `COMMENTED` review GitHub mints around a
    thread reply — the #405 forgery, which anyone who can comment could summon;
  * branch D accepts a marker only at the EXACT head, carry-forward having been
    dropped for that lane.

Both are exercised against the jq text EXTRACTED FROM THE SCRIPT rather than a
copy, for the same reason `test_producer_transport.py` does it: a test that
restates the program it is checking passes forever after the program changes.
"""

import json
from pathlib import Path
import shutil
import subprocess
import unittest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
REVIEW_EVIDENCE_PATH = REPO_ROOT / ".github" / "scripts" / "review-evidence.sh"

HEAD = "a" * 40
OLDER = "b" * 40

REVIEWS_ANCHOR = 'repos/$REPO/pulls/$n/reviews?per_page=100" \''
MARKERS_ANCHOR = 'repos/$REPO/issues/$n/comments?per_page=100" \''


def extract_jq(source: str, anchor: str) -> str:
    """Return the single-quoted jq program that follows `anchor` in the script."""
    start = source.index(anchor) + len(anchor)
    return source[start : source.index("'", start)]


def marker_comment(sha: str, run_id: str, login: str = "github-actions[bot]") -> dict:
    return {
        "user": {"login": login},
        "body": f"<!-- claude-review: {sha} run:{run_id} -->\n\nClaude review ran to completion.\n",
    }


@unittest.skipUnless(shutil.which("jq"), "jq is not installed")
class TestReviewEvidencePredicates(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source = REVIEW_EVIDENCE_PATH.read_text(encoding="utf-8")
        # A MISSING PROGRAM IS THE FAILURE, NOT A REASON TO SKIP: it means the
        # script stopped querying that endpoint, and the predicate this file
        # guards would silently go untested.
        for anchor in (REVIEWS_ANCHOR, MARKERS_ANCHOR):
            if anchor not in source:
                raise AssertionError(
                    f"{REVIEW_EVIDENCE_PATH.name} no longer contains the query anchored on "
                    f"{anchor!r} — the predicate moved and this test must move with it."
                )
        cls.jq_reviews = extract_jq(source, REVIEWS_ANCHOR)
        cls.jq_markers = extract_jq(source, MARKERS_ANCHOR)

    def run_jq(self, program: str, payload: list, args: dict) -> list[str]:
        cmd = ["jq", "-r"]
        for key, value in args.items():
            cmd += ["--arg", key, value]
        cmd.append(program)
        proc = subprocess.run(
            cmd, input=json.dumps(payload), capture_output=True, text=True
        )
        self.assertEqual(proc.returncode, 0, f"jq failed: {proc.stderr}")
        return [line for line in proc.stdout.splitlines() if line.strip()]

    def reviews(self, payload: list) -> list[str]:
        return self.run_jq(self.jq_reviews, payload, {"logins": "coderabbitai[bot]"})

    def markers(self, payload: list) -> list[str]:
        return self.run_jq(
            self.jq_markers,
            payload,
            {
                "pre": "<!-- claude-review:",
                "authors": "github-actions[bot]",
                "head": HEAD,
            },
        )

    # --- branch A ---------------------------------------------------------

    def test_approved_with_empty_body_is_accepted(self) -> None:
        """The #413 case: a clean diff yields APPROVED with an empty body and no comments."""
        self.assertEqual(
            self.reviews(
                [
                    {
                        "user": {"login": "coderabbitai[bot]"},
                        "state": "APPROVED",
                        "commit_id": HEAD,
                        "body": "",
                    }
                ]
            ),
            [f"{HEAD} coderabbitai[bot]"],
            "A reviewer that ran and had nothing to raise must satisfy the gate.",
        )

    def test_commented_reply_wrapper_is_rejected(self) -> None:
        """#405: a thread reply mints a COMMENTED review at the CURRENT head, unread."""
        self.assertEqual(
            self.reviews(
                [
                    {
                        "user": {"login": "coderabbitai[bot]"},
                        "state": "COMMENTED",
                        "commit_id": HEAD,
                        "body": "",
                    }
                ]
            ),
            [],
            "An implicit reply-wrapper review must never satisfy the gate.",
        )

    def test_dismissed_and_pending_are_rejected(self) -> None:
        for state in ("DISMISSED", "PENDING"):
            with self.subTest(state=state):
                self.assertEqual(
                    self.reviews(
                        [
                            {
                                "user": {"login": "coderabbitai[bot]"},
                                "state": state,
                                "commit_id": HEAD,
                                "body": "plenty of text",
                            }
                        ]
                    ),
                    [],
                )

    def test_reviewer_login_is_an_exact_allowlist(self) -> None:
        """`coderabbit-fan` is registrable by anyone on a public repo."""
        self.assertEqual(
            self.reviews(
                [
                    {
                        "user": {"login": "coderabbit-fan"},
                        "state": "APPROVED",
                        "commit_id": HEAD,
                        "body": "",
                    },
                    {
                        "user": {"login": "claude[bot]"},
                        "state": "APPROVED",
                        "commit_id": HEAD,
                        "body": "",
                    },
                ]
            ),
            [],
        )

    def test_verdicts_are_returned_newest_first(self) -> None:
        """first_valid_evidence walks candidates newest-first and budgets compare calls."""
        self.assertEqual(
            self.reviews(
                [
                    {
                        "user": {"login": "coderabbitai[bot]"},
                        "state": "CHANGES_REQUESTED",
                        "commit_id": OLDER,
                        "body": "3 issues",
                    },
                    {
                        "user": {"login": "coderabbitai[bot]"},
                        "state": "APPROVED",
                        "commit_id": HEAD,
                        "body": "",
                    },
                ]
            ),
            [f"{HEAD} coderabbitai[bot]", f"{OLDER} coderabbitai[bot]"],
        )

    # --- branch D ---------------------------------------------------------

    def test_marker_at_head_is_accepted_newest_first(self) -> None:
        self.assertEqual(
            self.markers([marker_comment(HEAD, "222"), marker_comment(HEAD, "333")]),
            [f"{HEAD} 333"],
            "The newest head-bound marker is the one whose run gets verified.",
        )

    def test_marker_at_an_earlier_commit_is_rejected(self) -> None:
        """Carry-forward is branch A only: the Claude lane re-runs on every push."""
        self.assertEqual(self.markers([marker_comment(OLDER, "111")]), [])

    def test_marker_from_an_untrusted_author_is_rejected(self) -> None:
        """Only the workflow's own token can author a marker; a human typing it cannot."""
        self.assertEqual(
            self.markers([marker_comment(HEAD, "999", login="Sumit1993")]), []
        )


if __name__ == "__main__":
    unittest.main()
