"""
Base class for safe, read-only tools.
"""

from pathlib import Path


class SafeTool:
    """Base class for safe, read-only tools."""

    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir).resolve()

    def validate_path(self, path: str) -> Path:
        """
        Validate that a path is within the base directory and exists.
        Raises ValueError if path is unsafe or does not exist.
        """
        try:
            target_path = (self.base_dir / path).resolve()

            # Check for path traversal prevention
            if not str(target_path).startswith(str(self.base_dir)):
                raise ValueError(
                    f"Access denied: Path '{path}' is outside the allowed directory."
                )

            return target_path

        except Exception as e:
            raise ValueError(f"Invalid path '{path}': {str(e)}")

    def is_safe_path(self, path: str) -> bool:
        """Check if path is safe without raising exception."""
        try:
            self.validate_path(path)
            return True
        except ValueError:
            return False
