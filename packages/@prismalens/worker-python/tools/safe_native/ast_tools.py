"""
Safe AST analysis operations for PrismaLens Worker.

Wrapper around ast-grep (sg) binary. Replaces ast-grep MCP.
"""

import json
import os
import subprocess
import tempfile
from typing import Any

from google.adk.tools.function_tool import FunctionTool

from .base import SafeTool


class AstGrepTool(SafeTool):
    """
    Safe wrapper around ast-grep (sg) binary.
    Replaces ast-grep MCP.
    """

    def scan_pattern(self, pattern: str, language: str) -> str:
        """
        Scan for a code pattern using ast-grep.

        Args:
            pattern: The code pattern to find (e.g. 'function $NAME() { $$$ }')
            language: The language to scan (e.g. 'python', 'javascript', 'typescript')

        Returns:
            JSON string of matches.
        """
        try:
            # Construct sg command safely
            cmd = [
                "sg",
                "scan",
                "--pattern",
                pattern,
                "--lang",
                language,
                "--json",
            ]

            # Run subprocess
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=self.base_dir,
                timeout=20,  # Slightly higher timeout for AST parsing
            )

            if result.returncode > 1:
                return f"Error running scan: {result.stderr}"

            try:
                matches = json.loads(result.stdout)
            except json.JSONDecodeError:
                return "No matches found (or invalid output)."

            if not matches:
                return "No matches found."

            return self._format_results(matches)

        except subprocess.TimeoutExpired:
            return "Error: Scan timed out."
        except Exception as e:
            return f"Error executing scan: {str(e)}"

    def inspect_ast(self, code_snippet: str, language: str) -> str:
        """
        Visualize the AST structure of a code snippet.
        Useful for designing patterns.

        Args:
           code_snippet: The code to analyze (will be written to temp file)
           language: Language identifier
        """
        try:
            # Create temp file for the snippet
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=f".{language}", delete=False
            ) as f:
                f.write(code_snippet)
                temp_path = f.name

            # Run sg ast
            cmd = ["sg", "ast", temp_path, "--lang", language]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

            # Cleanup
            os.unlink(temp_path)

            if result.returncode != 0:
                return f"Error generating AST: {result.stderr}"

            return result.stdout

        except Exception as e:
            return f"Error inspecting AST: {str(e)}"

    def _format_results(self, matches: list[dict]) -> str:
        """Format list of match dicts into a readable string."""
        lines = [f"Found {len(matches)} structural matches:"]

        for m in matches[:20]:
            lines.append(f"\nFile: {m.get('file', 'unknown')}")
            lines.append(
                f"  Lines: {m['range']['start']['line']}-{m['range']['end']['line']}"
            )
            lines.append(f"  Code: {m['text'][:200]}...")  # Truncate long code

            # Show metavariables if any
            if "meta" in m and m["meta"]:
                lines.append(f"  Variables: {json.dumps(m['meta'])}")

        if len(matches) > 20:
            lines.append(f"\n... and {len(matches) - 20} more matches.")

        return "\n".join(lines)


def create_ast_tools(base_dir: str) -> list[FunctionTool]:
    """Factory to create FunctionTools for AST operations."""
    tool_instance = AstGrepTool(base_dir)

    return [
        FunctionTool(tool_instance.scan_pattern),
        FunctionTool(tool_instance.inspect_ast),
    ]
