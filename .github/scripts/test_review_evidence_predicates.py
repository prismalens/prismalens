#!/usr/bin/env python3
"""Regression tests for the `review-evidence` LIVENESS predicates (#413).

The gate proves that the assigned reviewer ran to completion on this head, and
nothing about what it said. Three jq clauses in `review-evidence.sh` are the whole
of that decision, and after #413 none is backed up by a content test any more:

  * branch A accepts a SUBMITTED VERDICT (`APPROVED` / `CHANGES_REQUESTED`) and
    must keep rejecting the implicit `COMMENTED` review GitHub mints around a
    thread reply — the #405 forgery, which anyone who can comment could summon;
  * the review-pass predicate corroborates `APPROVED`, which a chat command can
    otherwise mint from nothing, WITHOUT asking the reviewer to have had findings;
  * branch D accepts a marker only at the EXACT head, carry-forward having been
    dropped for that lane.

NOTHING HERE RESTATES THE THING IT CHECKS. Both halves of that rule matter, and
only the first was honoured at first review:

  * the jq PROGRAMS are extracted from the script rather than copied, for the
    reason `test_producer_transport.py` gives — a test that restates the program
    it is checking passes forever after the program changes;
  * the VALUES the programs are driven with — the reviewer allowlist, the marker
    prefix, the marker authors, the review-pass fingerprint — are parsed out of
    the same script source, and the marker fixture is checked against the format
    `claude-code-review.yml` actually mints. Hardcoding those was the same defect
    one level down: rename a constant or reshape the marker and these tests stay
    green while the gate quietly stops matching anything.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import shutil
import subprocess
import unittest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
REVIEW_EVIDENCE_PATH = REPO_ROOT / ".github" / "scripts" / "review-evidence.sh"
REVIEW_WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "claude-code-review.yml"

HEAD = "a" * 40
OLDER = "b" * 40

# Each predicate names itself in a jq comment on its first line. The anchor is
# that name, NOT the API path it is passed to: two of the three query the same
# comments endpoint, so a path anchor silently extracts the wrong program.
REVIEWS_ANCHOR = "# predicate: branch-a-verdict"
REVIEW_PASS_ANCHOR = "# predicate: coderabbit-review-pass"
MARKERS_ANCHOR = "# predicate: claude-marker-at-head"

# What `claude-code-review.yml`'s marker job mints. Asserted against the workflow
# in setUpClass, so a reshaped marker fails here instead of passing silently.
MARKER_TEMPLATE = '"<!-- claude-review: $HEAD_SHA run:$RUN_ID -->"'


def extract_jq(source: str, anchor: str) -> str:
    """Return the jq program that starts at `anchor`, up to its closing quote.

    The programs live in single-quoted shell strings and contain no `'`, so the
    next `'` is the end of the program.
    """
    start = source.index(anchor)
    return source[start : source.index("'", start)]


def shell_default(source: str, name: str) -> str:
    """Return the default in `NAME="${NAME:-default}"` from the script source."""
    match = re.search(
        r'^%s="\$\{%s:-(.*)\}"$' % (re.escape(name), re.escape(name)),
        source,
        re.MULTILINE,
    )
    if match is None:
        raise AssertionError(
            f"{REVIEW_EVIDENCE_PATH.name} no longer declares {name} as an "
            f"overridable constant — this test drives the predicates with it."
        )
    return match.group(1)


@unittest.skipUnless(shutil.which("jq"), "jq is not installed")
class TestReviewEvidencePredicates(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source = REVIEW_EVIDENCE_PATH.read_text(encoding="utf-8")
        # A MISSING PROGRAM IS THE FAILURE, NOT A REASON TO SKIP: it means the
        # script stopped querying that endpoint, and the predicate this file
        # guards would silently go untested.
        for anchor in (REVIEWS_ANCHOR, REVIEW_PASS_ANCHOR, MARKERS_ANCHOR):
            if anchor not in source:
                raise AssertionError(
                    f"{REVIEW_EVIDENCE_PATH.name} no longer contains the predicate anchored on "
                    f"{anchor!r} — the predicate moved and this test must move with it."
                )
        cls.jq_reviews = extract_jq(source, REVIEWS_ANCHOR)
        cls.jq_review_pass = extract_jq(source, REVIEW_PASS_ANCHOR)
        cls.jq_markers = extract_jq(source, MARKERS_ANCHOR)

        cls.reviewer_logins = shell_default(source, "REVIEWER_LOGINS")
        cls.marker_prefix = shell_default(source, "CLAUDE_MARKER_PREFIX")
        cls.marker_authors = shell_default(source, "CLAUDE_MARKER_AUTHORS")
        cls.review_pass_marker = shell_default(source, "CODERABBIT_REVIEW_PASS_MARKER")

        # The fixture below mints a marker body; the workflow is what mints the
        # real one. Tie them together, or the fixture drifts into testing itself.
        workflow = REVIEW_WORKFLOW_PATH.read_text(encoding="utf-8")
        if MARKER_TEMPLATE not in workflow:
            raise AssertionError(
                f"{REVIEW_WORKFLOW_PATH.name} no longer mints {MARKER_TEMPLATE} — the marker "
                f"format changed and `marker_comment` below no longer resembles the real thing."
            )
        if cls.marker_prefix not in MARKER_TEMPLATE:
            raise AssertionError(
                f"CLAUDE_MARKER_PREFIX ({cls.marker_prefix!r}) does not appear in the marker the "
                f"workflow mints ({MARKER_TEMPLATE!r}) — the publisher cannot match it."
            )

    # --- fixtures ---------------------------------------------------------

    def first_login(self) -> str:
        """The allowlist is space-separated; one entry is enough to drive these."""
        return self.reviewer_logins.split(" ")[0]

    def marker_comment(self, sha: str, run_id: str, login: str | None = None) -> dict:
        return {
            "user": {"login": self.marker_authors.split(" ")[0] if login is None else login},
            "body": (
                f"{self.marker_prefix} {sha} run:{run_id} -->\n\n"
                "Claude review ran to completion.\n"
            ),
        }

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
        return self.run_jq(self.jq_reviews, payload, {"logins": self.reviewer_logins})

    def review_pass(self, payload: list) -> list[str]:
        return self.run_jq(
            self.jq_review_pass,
            payload,
            {"authors": self.reviewer_logins, "marker": self.review_pass_marker},
        )

    def markers(self, payload: list) -> list[str]:
        return self.run_jq(
            self.jq_markers,
            payload,
            {
                "pre": self.marker_prefix,
                "authors": self.marker_authors,
                "head": HEAD,
            },
        )

    # --- branch A ---------------------------------------------------------

    def test_approved_with_empty_body_is_accepted(self) -> None:
        """The #413 case: a clean diff yields APPROVED with an empty body and no comments."""
        login = self.first_login()
        self.assertEqual(
            self.reviews(
                [
                    {
                        "user": {"login": login},
                        "state": "APPROVED",
                        "commit_id": HEAD,
                        "body": "",
                    }
                ]
            ),
            [f"{HEAD} APPROVED {login}"],
            "A reviewer that ran and had nothing to raise must satisfy the gate.",
        )

    def test_the_state_is_carried_so_the_shell_can_qualify_approved(self) -> None:
        """APPROVED is corroborated and CHANGES_REQUESTED is not, so the state must survive."""
        login = self.first_login()
        self.assertEqual(
            self.reviews(
                [
                    {
                        "user": {"login": login},
                        "state": "CHANGES_REQUESTED",
                        "commit_id": HEAD,
                        "body": "3 issues",
                    }
                ]
            ),
            [f"{HEAD} CHANGES_REQUESTED {login}"],
        )

    def test_commented_reply_wrapper_is_rejected(self) -> None:
        """#405: a thread reply mints a COMMENTED review at the CURRENT head, unread."""
        self.assertEqual(
            self.reviews(
                [
                    {
                        "user": {"login": self.first_login()},
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
                                "user": {"login": self.first_login()},
                                "state": state,
                                "commit_id": HEAD,
                                "body": "plenty of text",
                            }
                        ]
                    ),
                    [],
                )

    def test_review_without_a_commit_id_is_rejected(self) -> None:
        """A review naming no revision proves nothing about this head.

        Without the `commit_id != null` clause this emits the literal string
        `null`, which `first_valid_evidence` would then compare against the head.
        """
        self.assertEqual(
            self.reviews(
                [
                    {
                        "user": {"login": self.first_login()},
                        "state": "APPROVED",
                        "commit_id": None,
                        "body": "",
                    }
                ]
            ),
            [],
        )

    def test_reviewer_login_is_an_exact_allowlist(self) -> None:
        """`coderabbit-fan` is registrable by anyone on a public repo.

        Derived from the allowlist entry rather than typed, so it stays a
        near-miss of whatever the allowlist actually holds — that is the exact
        shape the old `contains("coderabbit")` test would have accepted.
        """
        near_miss = self.first_login().removesuffix("[bot]") + "-fan"
        self.assertEqual(
            self.reviews(
                [
                    {
                        "user": {"login": near_miss},
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
        login = self.first_login()
        self.assertEqual(
            self.reviews(
                [
                    {
                        "user": {"login": login},
                        "state": "CHANGES_REQUESTED",
                        "commit_id": OLDER,
                        "body": "3 issues",
                    },
                    {
                        "user": {"login": login},
                        "state": "APPROVED",
                        "commit_id": HEAD,
                        "body": "",
                    },
                ]
            ),
            [f"{HEAD} APPROVED {login}", f"{OLDER} CHANGES_REQUESTED {login}"],
        )

    # --- the review-pass corroboration ------------------------------------

    def test_review_pass_is_seen_from_the_walkthrough(self) -> None:
        """A review PASS is what corroborates APPROVED — findings are irrelevant."""
        self.assertEqual(
            self.review_pass(
                [
                    {
                        "user": {"login": self.first_login()},
                        "body": f"<!-- {self.review_pass_marker} -->\n\n## Walkthrough\n",
                    }
                ]
            ),
            ["yes"],
        )

    def test_review_pass_is_not_seen_without_the_walkthrough(self) -> None:
        """A chat reply is not a review pass — this is the summoned-approve case."""
        self.assertEqual(
            self.review_pass(
                [
                    {
                        "user": {"login": self.first_login()},
                        "body": "<!-- This is an auto-generated reply by CodeRabbit -->\n\nApproved.",
                    }
                ]
            ),
            [],
        )

    def test_review_pass_requires_an_allowlisted_author(self) -> None:
        """The marker is public text, so a human can paste it; the author is the control."""
        self.assertEqual(
            self.review_pass(
                [
                    {
                        "user": {"login": "Sumit1993"},
                        "body": f"<!-- {self.review_pass_marker} -->",
                    }
                ]
            ),
            [],
        )

    def test_review_pass_tolerates_a_null_body(self) -> None:
        """The comments API returns `body: null` for a deleted comment."""
        self.assertEqual(
            self.review_pass([{"user": {"login": self.first_login()}, "body": None}]),
            [],
        )

    def test_review_pass_on_an_untouched_pr_is_empty(self) -> None:
        self.assertEqual(self.review_pass([]), [])

    # --- branch D ---------------------------------------------------------

    def test_marker_at_head_is_accepted_newest_first(self) -> None:
        self.assertEqual(
            self.markers(
                [self.marker_comment(HEAD, "222"), self.marker_comment(HEAD, "333")]
            ),
            [f"{HEAD} 333"],
            "The newest head-bound marker is the one whose run gets verified.",
        )

    def test_marker_at_an_earlier_commit_is_rejected(self) -> None:
        """Carry-forward is branch A only: the Claude lane re-runs on every push."""
        self.assertEqual(self.markers([self.marker_comment(OLDER, "111")]), [])

    def test_marker_from_an_untrusted_author_is_rejected(self) -> None:
        """Only the workflow's own token can author a marker; a human typing it cannot."""
        self.assertEqual(
            self.markers([self.marker_comment(HEAD, "999", login="Sumit1993")]), []
        )


if __name__ == "__main__":
    unittest.main()
