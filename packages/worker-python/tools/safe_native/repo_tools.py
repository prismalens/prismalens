"""
Safe repository operations for PrismaLens Worker.

Tools for cloning and updating GitHub repositories.
"""

import re
import subprocess
from typing import Any

from google.adk.tools.function_tool import FunctionTool

from config.settings import settings

from .base import SafeTool


class RepoCloneTool(SafeTool):
    """
    Safe tool for cloning and updating GitHub repositories.
    Uses GITHUB_TOKEN for authentication.
    """

    def ensure_repo_locally(self, repository_name: str) -> str:
        """
        Ensures a GitHub repository is present locally and up-to-date.
        If missing, it clones it. If present, it pulls latest changes.

        Args:
            repository_name: Format 'owner/repo' (e.g., 'google/adk')

        Returns:
            Status message indicating success or failure.
        """
        # 1. Validate Repository Name
        if not re.match(r"^[a-zA-Z0-9_\-]+/[a-zA-Z0-9_\-\.]+$", repository_name):
            return "Error: Invalid repository name format. Expected 'owner/repo'."

        # 2. Prepare Paths
        try:
            # Structure: local_git_workspace/owner/repo to support multi-org future
            repo_path = self.base_dir / repository_name
            owner, repo_name = repository_name.split("/")
        except ValueError:
            return "Error: Invalid repository name format. Expected 'owner/repo'."

        # 3. Get Auth Token
        token = settings.get("GITHUB_TOKEN", "")
        if not token:
            return (
                "Error: GITHUB_TOKEN not found in configuration. "
                "Cannot clone private repos."
            )

        # 4. Construct Authenticated URL
        # CAUTION: Token handling. We avoid printing this URL to logs.
        auth_url = f"https://oauth2:{token}@github.com/{repository_name}.git"

        # 5. Clone or Pull
        try:
            if repo_path.exists():
                # Repo exists - Pull
                result = subprocess.run(
                    ["git", "pull"],
                    cwd=repo_path,
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                if result.returncode != 0:
                    return f"Failed to update repo {repository_name}: {result.stderr}"
                return f"Successfully updated {repository_name} at {repo_path}"
            else:
                # Repo missing - Clone
                # Ensure parent directory exists (e.g. 'owner')
                repo_path.parent.mkdir(parents=True, exist_ok=True)

                result = subprocess.run(
                    ["git", "clone", auth_url, str(repo_path)],
                    capture_output=True,
                    text=True,
                    timeout=120,
                )

                if result.returncode != 0:
                    # Scrub token from error message just in case git leaks it
                    safe_stderr = result.stderr.replace(token, "******")
                    return f"Failed to clone {repository_name}: {safe_stderr}"

                return f"Successfully cloned {repository_name} to {repo_path}"

        except subprocess.TimeoutExpired:
            return f"Operation timed out for {repository_name}"
        except Exception as e:
            return f"System error processing {repository_name}: {str(e)}"


def create_repo_tools(base_dir: str) -> list[FunctionTool]:
    """Factory to create FunctionTools for Repo operations."""
    tool_instance = RepoCloneTool(base_dir)

    return [FunctionTool(tool_instance.ensure_repo_locally)]
