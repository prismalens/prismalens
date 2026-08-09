#!/usr/bin/env python3
"""Regression tests for producer-consumer transport integrity."""

import base64
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
REVIEW_EVIDENCE_PATH = REPO_ROOT / ".github" / "scripts" / "review-evidence.sh"
REVIEW_ADMIT_PATH = REPO_ROOT / ".github" / "workflows" / "review-admit.yml"
MATCHER_SCRIPT_PATH = REPO_ROOT / ".github" / "scripts" / "high-risk-match.py"


def extract_jq_expr(file_path: Path) -> str | None:
    """Extract `--jq '...'` expression containing `previous_filename` from a file."""
    if not file_path.exists():
        return None
    content = file_path.read_text(encoding="utf-8")
    pattern = r"--jq\s+['\"]([^'\"]*previous_filename[^'\"]*)['\"]"
    match = re.search(pattern, content)
    return match.group(1) if match else None


class TestProducerTransport(unittest.TestCase):
    """Test suite for producer/consumer transport consistency."""

    def test_producer_jq_expressions_match(self) -> None:
        """Guards producer drift: review-evidence.sh and review-admit.yml must use identical @base64 jq expressions."""
        expr_sh = extract_jq_expr(REVIEW_EVIDENCE_PATH)
        expr_yml = extract_jq_expr(REVIEW_ADMIT_PATH)

        if expr_sh is None:
            self.skipTest(
                f"Could not locate --jq expression containing previous_filename in {REVIEW_EVIDENCE_PATH.name}"
            )
        if expr_yml is None:
            self.skipTest(
                f"Could not locate --jq expression containing previous_filename in {REVIEW_ADMIT_PATH.name}"
            )

        self.assertIn(
            "@base64",
            expr_sh,
            "JQ expression in review-evidence.sh must contain @base64 filter",
        )
        self.assertIn(
            "@base64",
            expr_yml,
            "JQ expression in review-admit.yml must contain @base64 filter",
        )
        self.assertEqual(
            expr_sh,
            expr_yml,
            f"JQ expressions in {REVIEW_EVIDENCE_PATH.name} and {REVIEW_ADMIT_PATH.name} must be identical",
        )

    @unittest.skipUnless(
        shutil.which("jq") is not None, "jq binary required for round-trip test"
    )
    def test_jq_roundtrip_transport(self) -> None:
        """Round-trip test: Pipe canned JSON pull-request file list through producer jq expression into matcher."""
        expr = extract_jq_expr(REVIEW_EVIDENCE_PATH)
        if expr is None:
            self.skipTest("Cannot run round-trip test without extracted jq expression")

        # Canned GitHub PR files endpoint JSON response
        newline_filename = "packages/@prismalens/foo/src/a\nb/crypto/key.ts"
        old_filename = "packages/@prismalens/foo/src/old_crypto/key.ts"
        new_filename = "packages/@prismalens/foo/src/new_location/key.ts"

        payload = [
            {"filename": "packages/frontend/src/App.tsx"},
            {
                "filename": new_filename,
                "previous_filename": old_filename,
            },
            {"filename": newline_filename},
        ]
        json_input = json.dumps(payload)

        # Pipe JSON through extracted jq expression
        jq_proc = subprocess.run(
            ["jq", "-r", expr],
            input=json_input.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )

        jq_output_bytes = jq_proc.stdout
        lines = [
            line.strip()
            for line in jq_output_bytes.decode("ascii").splitlines()
            if line.strip()
        ]

        # Assert decode results
        decoded_set = {base64.b64decode(line).decode("utf-8") for line in lines}

        self.assertIn(
            old_filename,
            decoded_set,
            "Rename's previous_filename must be present in the decoded path set",
        )
        self.assertIn(
            newline_filename,
            decoded_set,
            "Filename containing newline must decode back byte-identical to what went in",
        )

        # Pipe jq output directly into high-risk-match.py as stdin
        glob_content = "packages/@prismalens/*/src/**/crypto/**\n"
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as tf:
            tf.write(glob_content)
            temp_glob_path = Path(tf.name)

        try:
            matcher_proc = subprocess.run(
                [sys.executable, str(MATCHER_SCRIPT_PATH), str(temp_glob_path)],
                input=jq_output_bytes,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=str(REPO_ROOT),
            )
            self.assertEqual(
                matcher_proc.returncode,
                1,
                f"Piping jq output into matcher must report high risk (exit 1). Stderr: {matcher_proc.stderr.decode('utf-8')}",
            )
        finally:
            if temp_glob_path.exists():
                temp_glob_path.unlink()


if __name__ == "__main__":
    unittest.main()
