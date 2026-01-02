"""
Safe file system operations for PrismaLens Worker.

Read-only file system tools that replace FileScopeMCP.
"""

import json
from pathlib import Path
from typing import Any

from google.adk.tools.function_tool import FunctionTool

from .base import SafeTool


class FileReadTool(SafeTool):
    """
    Safe, read-only file system operations.
    Replaces FileScopeMCP.
    """

    def list_directory(self, path: str = ".") -> str:
        """
        List contents of a directory.

        Args:
            path: Relative path to list (default: root of workspace)

        Returns:
            JSON string of directory contents
        """
        try:
            target_path = self.validate_path(path)

            if not target_path.is_dir():
                return f"Error: '{path}' is not a directory."

            items = []
            for item in target_path.iterdir():
                # Skip hidden files/dirs
                if item.name.startswith("."):
                    continue

                info = {
                    "name": item.name,
                    "type": "directory" if item.is_dir() else "file",
                    "path": str(item.relative_to(self.base_dir)),
                }
                items.append(info)

            # Sort by type (dirs first) then name
            items.sort(key=lambda x: (x["type"] != "directory", x["name"]))
            return json.dumps(items, indent=2)

        except Exception as e:
            return f"Error listing directory '{path}': {str(e)}"

    def read_file(self, path: str, line_start: int = 1, line_end: int = -1) -> str:
        """
        Read content of a file safely.

        Args:
            path: Relative path to file
            line_start: Starting line (1-based index)
            line_end: Ending line (-1 for end of file)

        Returns:
            File content string
        """
        try:
            target_path = self.validate_path(path)

            if not target_path.is_file():
                return f"Error: '{path}' is not a file."

            # Basic check for binary files
            try:
                with open(target_path, "r", encoding="utf-8") as f:
                    lines = f.readlines()
            except UnicodeDecodeError:
                return f"Error: '{path}' appears to be a binary file."

            total_lines = len(lines)

            # Adjust indices
            start_idx = max(0, line_start - 1)
            if line_end == -1:
                end_idx = total_lines
            else:
                end_idx = min(total_lines, line_end)

            if start_idx >= total_lines:
                return f"Error: Line start {line_start} is beyond file end {total_lines}."

            content = "".join(lines[start_idx:end_idx])

            # Add metadata header
            header = (
                f"# File: {path}\n# Lines: {start_idx+1}-{end_idx} of {total_lines}\n"
            )
            return header + "-" * 40 + "\n" + content

        except Exception as e:
            return f"Error reading file '{path}': {str(e)}"

    def get_file_info(self, path: str) -> str:
        """Get file metadata (size, modification time)."""
        try:
            target_path = self.validate_path(path)
            stat = target_path.stat()

            info = {
                "name": target_path.name,
                "path": str(target_path.relative_to(self.base_dir)),
                "size_bytes": stat.st_size,
                "modified_time": stat.st_mtime,
                "is_dir": target_path.is_dir(),
            }
            return json.dumps(info, indent=2)
        except Exception as e:
            return f"Error getting info for '{path}': {str(e)}"


def create_file_tools(base_dir: str) -> list[FunctionTool]:
    """Factory to create FunctionTools for file operations."""
    tool_instance = FileReadTool(base_dir)

    return [
        FunctionTool(tool_instance.list_directory),
        FunctionTool(tool_instance.read_file),
        FunctionTool(tool_instance.get_file_info),
    ]
