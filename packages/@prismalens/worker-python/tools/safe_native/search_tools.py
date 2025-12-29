"""
Safe text search operations for PrismaLens Worker.

Wrapper around ripgrep (rg) binary. Replaces RipgrepMCP.
"""

import json
import subprocess
from typing import Any, Optional

from google.adk.tools.function_tool import FunctionTool

from .base import SafeTool


class RipgrepTool(SafeTool):
    """
    Safe wrapper around ripgrep (rg) binary.
    Replaces RipgrepMCP.
    """

    def search(
        self,
        query: str,
        path: str = ".",
        glob: Optional[str] = None,
        context_lines: int = 0,
    ) -> str:
        """
        Search for a text pattern in files.

        Args:
            query: The text or regex to search for.
            path: The directory or file to search in (relative to workspace).
            glob: Optional glob pattern to filter files (e.g., "*.py").
            context_lines: Number of lines to show before and after match (default 0).

        Returns:
            JSON string of matches.
        """
        try:
            target_path = self.validate_path(path)

            # Construct rg command safely
            # We do NOT allow arbitrary flags from user input to prevent injection
            cmd = [
                "rg",
                "--json",  # Output JSON for parsing
                "--line-number",  # Ensure line numbers
                "--with-filename",  # Ensure filenames
                "--color",
                "never",  # No color codes
                "--smart-case",  # Smart case sensitivity
                "--max-columns",
                "500",  # Limit long lines
            ]

            if context_lines > 0:
                # Limit context to reasonable amount
                ctx = min(10, max(0, context_lines))
                cmd.extend(["-C", str(ctx)])

            if glob:
                # Validate glob basic safety (though rg handles this well)
                cmd.extend(["--glob", glob])

            # Add patterns and path
            cmd.append(query)
            cmd.append(str(target_path))

            # Run subprocess
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=self.base_dir,
                timeout=10,  # Reasonable timeout
            )

            if result.returncode > 1:
                # rg returns 2 on error
                return f"Error running search: {result.stderr}"

            output_lines = result.stdout.strip().split("\n")

            # Parse JSON output from rg
            matches = []
            for line in output_lines:
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    if data["type"] == "match":
                        matches.append(self._format_match(data))
                except json.JSONDecodeError:
                    continue

            if not matches:
                return "No matches found."

            # Format output nicely for the agent
            return self._format_results_text(matches)

        except subprocess.TimeoutExpired:
            return "Error: Search timed out."
        except Exception as e:
            return f"Error executing search: {str(e)}"

    def search_and_preview(self, query: str, path: str = ".") -> str:
        """
        Composite Tool: Run search and return matches WITH context.
        Designed to save API calls.
        Forces context_lines=2.
        """
        return self.search(query, path, context_lines=2)

    def _format_match(self, data: dict) -> dict:
        """Extract relevant fields from rg match object."""
        # rg structure: { type: match, data: { path: {text}, lines: {text}, line_number: int, submatches: [] } }
        match_data = data["data"]
        file_path = match_data["path"]["text"]
        line_num = match_data["line_number"]
        content = match_data["lines"]["text"].strip()

        return {"file": file_path, "line": line_num, "content": content}

    def _format_results_text(self, matches: list[dict]) -> str:
        """Format list of match dicts into a readable string for LLM."""
        lines = [f"Found {len(matches)} matches:"]

        # Group by file for readability
        files_map: dict[str, list[dict]] = {}
        for m in matches:
            if m["file"] not in files_map:
                files_map[m["file"]] = []
            files_map[m["file"]].append(m)

        for fname, fmatches in files_map.items():
            lines.append(f"\nFile: {fname}")
            for m in fmatches[:20]:  # Limit matches per file to avoid context explosion
                lines.append(f"  {m['line']}: {m['content']}")
            if len(fmatches) > 20:
                lines.append(f"  ... and {len(fmatches) - 20} more matches in this file.")

        return "\n".join(lines)


def create_search_tools(base_dir: str) -> list[FunctionTool]:
    """Factory to create FunctionTools for search operations."""
    tool_instance = RipgrepTool(base_dir)

    return [
        FunctionTool(tool_instance.search),
        FunctionTool(tool_instance.search_and_preview),
    ]
