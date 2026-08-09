#!/usr/bin/env python3
"""Regression tests for .github/scripts/high-risk-match.py."""

import base64
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT_PATH = REPO_ROOT / ".github" / "scripts" / "high-risk-match.py"
LIVE_POLICY_PATH = REPO_ROOT / ".github" / "high-risk-paths.txt"


def run_matcher(
    paths: list[str] | None = None,
    glob_file: str | Path | None = None,
    glob_content: str | None = None,
    raw_stdin: str | bytes | None = None,
    extra_args: list[str] | None = None,
) -> tuple[int, str]:
    """Helper to invoke high-risk-match.py as a subprocess.

    Base64-encodes path strings onto their own lines (or uses raw_stdin),
    runs high-risk-match.py as a subprocess, and returns (exit_code, stderr).
    """
    if glob_content is not None:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as tf:
            tf.write(glob_content)
            temp_path = Path(tf.name)
        try:
            return run_matcher(
                paths=paths,
                glob_file=temp_path,
                raw_stdin=raw_stdin,
                extra_args=extra_args,
            )
        finally:
            if temp_path.exists():
                temp_path.unlink()

    if raw_stdin is not None:
        input_bytes = (
            raw_stdin.encode("utf-8") if isinstance(raw_stdin, str) else raw_stdin
        )
    elif paths is not None:
        lines = [
            base64.b64encode(p.encode("utf-8")).decode("ascii") + "\n" for p in paths
        ]
        input_bytes = "".join(lines).encode("utf-8")
    else:
        input_bytes = b""

    cmd = [sys.executable, str(SCRIPT_PATH)]
    if extra_args is not None:
        cmd.extend(extra_args)
    elif glob_file is not None:
        cmd.append(str(glob_file))

    res = subprocess.run(
        cmd,
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(REPO_ROOT),
    )
    return res.returncode, res.stderr.decode("utf-8", errors="replace")


class TestHighRiskMatch(unittest.TestCase):
    """Test suite for high-risk-match.py."""

    # -------------------------------------------------------------------------
    # A. Historical Fail-Open Defects (Must all return exit 1)
    # -------------------------------------------------------------------------

    def test_defect1_double_star_matches_zero_directories(self) -> None:
        """Historical defect 1: ** must match ZERO directories.

        Bash [[ ]] required at least one intervening directory, so a credential
        file sitting directly under src/ escaped when matched against
        packages/@prismalens/*/src/**/crypto/**.
        """
        glob_content = "packages/@prismalens/*/src/**/crypto/**\n"
        # Zero intervening directories case (direct under src/)
        code1, stderr1 = run_matcher(
            paths=["packages/@prismalens/foo/src/crypto/key.ts"],
            glob_content=glob_content,
        )
        self.assertEqual(
            code1,
            1,
            f"Zero-directory depth path should match as high risk. Stderr: {stderr1}",
        )

        # One directory deeper case
        code2, stderr2 = run_matcher(
            paths=["packages/@prismalens/foo/src/sub/crypto/key.ts"],
            glob_content=glob_content,
        )
        self.assertEqual(
            code2,
            1,
            f"One-directory deeper path should match as high risk. Stderr: {stderr2}",
        )

    def test_defect2_whitespace_in_filename_is_content(self) -> None:
        """Historical defect 2: Whitespace in a filename is CONTENT, not noise.

        An earlier version .strip()ped paths, so the trailing space vanished
        and the ? no longer had a character to match.
        """
        glob_content = "**/*secret?\n"
        path_with_space = "packages/foo/mysecret "
        code, stderr = run_matcher(
            paths=[path_with_space], glob_content=glob_content
        )
        self.assertEqual(
            code,
            1,
            f"Path with trailing space should match glob ending in '?'. Stderr: {stderr}",
        )

    def test_defect3_line_feed_inside_path_does_not_split(self) -> None:
        """Historical defect 3: A line feed inside a path must not split it.

        As raw newline-delimited text, packages/@prismalens/foo/src/a\\nb/crypto/key.ts
        split into packages/@prismalens/foo/src/a and b/crypto/key.ts, and neither
        matched the glob. Base64 transport preserves the newline inside the single record.
        """
        glob_content = "packages/@prismalens/*/src/**/crypto/**\n"
        newline_path = "packages/@prismalens/foo/src/a\nb/crypto/key.ts"

        # Assertion 1: Unsplit single path containing line feed matches high risk
        code1, stderr1 = run_matcher(
            paths=[newline_path], glob_content=glob_content
        )
        self.assertEqual(
            code1,
            1,
            f"Path containing embedded line feed should match high risk. Stderr: {stderr1}",
        )

        # Assertion 2: Two separate split fragments do NOT match (exit 0)
        code2, stderr2 = run_matcher(
            paths=["packages/@prismalens/foo/src/a", "b/crypto/key.ts"],
            glob_content=glob_content,
        )
        self.assertEqual(
            code2,
            0,
            f"Split fragments should NOT match high risk. Stderr: {stderr2}",
        )

    def test_defect4_unencoded_raw_text_stdin_is_high_risk(self) -> None:
        """Historical defect 4: A record that is not valid base64 must be high risk, not skipped.

        If a future producer regresses to raw unencoded paths, it must fail loudly
        (exit 1) rather than quietly classifying everything as harmless.

        THE GLOB DELIBERATELY DOES NOT MATCH THE PATH. An earlier version of this
        test fed `.github/workflows/ci.yml` against `.github/**`, which returns
        exit 1 either way — because the record was rejected, or because a matcher
        reading raw paths simply matched it. That test could not fail, and it did
        not fail when the transport was broken on purpose. Here exit 1 can only
        come from the decode being rejected, so the assertion on stderr pins the
        reason rather than trusting the exit code alone.
        """
        glob_content = "packages/backend/**\n"
        code, stderr = run_matcher(
            raw_stdin=".github/workflows/ci.yml\n", glob_content=glob_content
        )
        self.assertEqual(
            code,
            1,
            f"Unencoded raw path on stdin must return exit 1 (high risk). Stderr: {stderr}",
        )
        self.assertIn(
            "glob matching failed",
            stderr,
            f"Exit 1 must come from rejecting the record, not from an incidental "
            f"glob match. Stderr: {stderr}",
        )

    def test_defect5_invalid_utf8_base64_record_is_high_risk(self) -> None:
        """Historical defect 5: Valid base64 encoding that is not valid UTF-8 must be high risk.

        An undecodable payload raises ValueError and must return exit 1.
        """
        glob_content = ".github/**\n"
        invalid_utf8_b64 = base64.b64encode(b"\xff\xfe").decode("ascii") + "\n"
        code, stderr = run_matcher(
            raw_stdin=invalid_utf8_b64, glob_content=glob_content
        )
        self.assertEqual(
            code,
            1,
            f"Invalid UTF-8 base64 payload must return exit 1 (high risk). Stderr: {stderr}",
        )

    # -------------------------------------------------------------------------
    # B. Fail-Closed on Every Unanswerable Question (Must all return exit 1)
    # -------------------------------------------------------------------------

    def test_unanswerable_glob_file_does_not_exist(self) -> None:
        """Fail-closed: Non-existent glob file must return exit 1."""
        code, stderr = run_matcher(
            paths=["packages/foo/index.ts"],
            glob_file="/tmp/non_existent_glob_policy_12345.txt",
        )
        self.assertEqual(
            code,
            1,
            f"Non-existent glob file must return exit 1. Stderr: {stderr}",
        )

    def test_unanswerable_glob_file_empty_or_comments_only(self) -> None:
        """Fail-closed: Glob file with only comments and blank lines returns exit 1."""
        empty_glob_content = "# Comment 1\n\n  # Comment 2\n  \n"
        code, stderr = run_matcher(
            paths=["packages/foo/index.ts"], glob_content=empty_glob_content
        )
        self.assertEqual(
            code,
            1,
            f"Empty policy file must return exit 1. Stderr: {stderr}",
        )

    def test_unanswerable_wrong_argument_count(self) -> None:
        """Fail-closed: Calling matcher with wrong argument count returns non-zero exit."""
        # No arguments
        code_no_args, stderr_no_args = run_matcher(extra_args=[])
        self.assertNotEqual(
            code_no_args,
            0,
            f"Script called with no args must fail non-zero. Stderr: {stderr_no_args}",
        )

        # Extra arguments
        code_extra_args, stderr_extra_args = run_matcher(
            extra_args=[str(LIVE_POLICY_PATH), "extra_arg"]
        )
        self.assertNotEqual(
            code_extra_args,
            0,
            f"Script called with extra args must fail non-zero. Stderr: {stderr_extra_args}",
        )

    # -------------------------------------------------------------------------
    # C. Genuine Negatives (Must all return exit 0)
    # -------------------------------------------------------------------------

    def test_genuine_negatives_against_live_policy(self) -> None:
        """Genuine negative: Unmatched safe paths against live policy file return exit 0."""
        paths = ["packages/frontend/src/App.tsx", "README.md"]
        code, stderr = run_matcher(paths=paths, glob_file=LIVE_POLICY_PATH)
        self.assertEqual(
            code,
            0,
            f"Safe paths should return exit 0 against live policy. Stderr: {stderr}",
        )

    def test_empty_stdin_against_live_policy(self) -> None:
        """Genuine negative: Empty stdin against live policy file returns exit 0."""
        code, stderr = run_matcher(paths=[], glob_file=LIVE_POLICY_PATH)
        self.assertEqual(
            code,
            0,
            f"Empty stdin should return exit 0 against live policy. Stderr: {stderr}",
        )

    def test_blank_lines_in_stdin_ignored(self) -> None:
        """Genuine negative: Blank lines in stdin are ignored rather than treated as paths."""
        code, stderr = run_matcher(
            raw_stdin="\n  \n\t\n", glob_content="packages/backend/**\n"
        )
        self.assertEqual(
            code,
            0,
            f"Blank lines in stdin should return exit 0. Stderr: {stderr}",
        )

    # -------------------------------------------------------------------------
    # D. Two Assertions Against Live Policy File (Must both return exit 1)
    # -------------------------------------------------------------------------

    def test_live_policy_ci_workflow_high_risk(self) -> None:
        """Live policy assertion: .github/workflows/ci.yml must match live policy as high risk."""
        code, stderr = run_matcher(
            paths=[".github/workflows/ci.yml"], glob_file=LIVE_POLICY_PATH
        )
        self.assertEqual(
            code,
            1,
            f".github/workflows/ci.yml must match live policy. Stderr: {stderr}",
        )

    def test_live_policy_engine_src_run_high_risk(self) -> None:
        """Live policy assertion: packages/@prismalens/engine/src/run.ts must match live policy as high risk."""
        code, stderr = run_matcher(
            paths=["packages/@prismalens/engine/src/run.ts"],
            glob_file=LIVE_POLICY_PATH,
        )
        self.assertEqual(
            code,
            1,
            f"packages/@prismalens/engine/src/run.ts must match live policy. Stderr: {stderr}",
        )


if __name__ == "__main__":
    unittest.main()
