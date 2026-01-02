"""GitHub integration provider."""

import httpx
from typing import Any, Optional
from datetime import datetime, timedelta

from google.adk.tools import FunctionTool

from .base import BaseProvider, IntegrationContext


class GitHubProvider(BaseProvider):
    """
    GitHub integration provider.

    Provides tools for:
    - Getting recent commits
    - Searching code
    - Getting file contents
    - Getting pull request information
    - Getting repository information
    """

    name = "github"

    def __init__(self, context: IntegrationContext):
        super().__init__(context)
        self.base_url = "https://api.github.com"
        self.organization = context.get_config("organization")
        self.repositories = context.get_config("repositories", [])
        self.default_branch = context.get_config("defaultBranch", "main")

    def _get_headers(self) -> dict[str, str]:
        """Get headers for GitHub API requests."""
        token = self.get_token()
        return {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def health_check(self) -> bool:
        """Check GitHub API connectivity."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/user",
                    headers=self._get_headers(),
                    timeout=10.0,
                )
                return response.status_code == 200
        except Exception as e:
            self.logger.error(f"GitHub health check failed: {e}")
            return False

    def get_tools(self) -> list[FunctionTool]:
        """Get ADK tools for GitHub integration."""
        return [
            FunctionTool(self.get_recent_commits),
            FunctionTool(self.search_code),
            FunctionTool(self.get_file_content),
            FunctionTool(self.get_recent_deployments),
            FunctionTool(self.get_pull_requests),
        ]

    async def get_recent_commits(
        self,
        repo: Optional[str] = None,
        branch: Optional[str] = None,
        since_hours: int = 24,
        limit: int = 10,
    ) -> dict[str, Any]:
        """
        Get recent commits from a GitHub repository.

        Args:
            repo: Repository in owner/repo format (uses default if not provided)
            branch: Branch name (uses default_branch if not provided)
            since_hours: Get commits from the last N hours
            limit: Maximum number of commits to return

        Returns:
            Dict with commits list and metadata
        """
        repo = repo or (self.repositories[0] if self.repositories else None)
        if not repo:
            return {"error": "No repository specified", "commits": []}

        branch = branch or self.default_branch
        since = (datetime.utcnow() - timedelta(hours=since_hours)).isoformat() + "Z"

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/repos/{repo}/commits",
                    headers=self._get_headers(),
                    params={
                        "sha": branch,
                        "since": since,
                        "per_page": limit,
                    },
                    timeout=30.0,
                )

                if response.status_code != 200:
                    return {
                        "error": f"GitHub API error: {response.status_code}",
                        "commits": [],
                    }

                commits_data = response.json()
                commits = [
                    {
                        "sha": c["sha"][:7],
                        "full_sha": c["sha"],
                        "message": c["commit"]["message"].split("\n")[0],
                        "author": c["commit"]["author"]["name"],
                        "date": c["commit"]["author"]["date"],
                        "url": c["html_url"],
                    }
                    for c in commits_data
                ]

                return {
                    "repository": repo,
                    "branch": branch,
                    "since_hours": since_hours,
                    "count": len(commits),
                    "commits": commits,
                }

        except Exception as e:
            self.logger.error(f"Failed to get commits: {e}")
            return {"error": str(e), "commits": []}

    async def search_code(
        self,
        query: str,
        repo: Optional[str] = None,
        path: Optional[str] = None,
        language: Optional[str] = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        """
        Search for code in GitHub repositories.

        Args:
            query: Search query string
            repo: Repository to search in (owner/repo format)
            path: Path filter (e.g., "src/")
            language: Language filter (e.g., "python", "typescript")
            limit: Maximum results to return

        Returns:
            Dict with search results
        """
        # Build search query
        search_query = query
        if repo:
            search_query += f" repo:{repo}"
        elif self.repositories:
            # Search in configured repositories
            repo_filter = " ".join(f"repo:{r}" for r in self.repositories[:3])
            search_query += f" {repo_filter}"

        if path:
            search_query += f" path:{path}"
        if language:
            search_query += f" language:{language}"

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/search/code",
                    headers=self._get_headers(),
                    params={
                        "q": search_query,
                        "per_page": limit,
                    },
                    timeout=30.0,
                )

                if response.status_code != 200:
                    return {
                        "error": f"GitHub API error: {response.status_code}",
                        "results": [],
                    }

                data = response.json()
                results = [
                    {
                        "repository": item["repository"]["full_name"],
                        "path": item["path"],
                        "name": item["name"],
                        "url": item["html_url"],
                        "score": item.get("score", 0),
                    }
                    for item in data.get("items", [])
                ]

                return {
                    "query": search_query,
                    "total_count": data.get("total_count", 0),
                    "count": len(results),
                    "results": results,
                }

        except Exception as e:
            self.logger.error(f"Failed to search code: {e}")
            return {"error": str(e), "results": []}

    async def get_file_content(
        self,
        path: str,
        repo: Optional[str] = None,
        ref: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Get the content of a file from a repository.

        Args:
            path: Path to the file
            repo: Repository in owner/repo format
            ref: Git reference (branch, tag, commit SHA)

        Returns:
            Dict with file content and metadata
        """
        repo = repo or (self.repositories[0] if self.repositories else None)
        if not repo:
            return {"error": "No repository specified", "content": None}

        ref = ref or self.default_branch

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/repos/{repo}/contents/{path}",
                    headers=self._get_headers(),
                    params={"ref": ref},
                    timeout=30.0,
                )

                if response.status_code == 404:
                    return {"error": f"File not found: {path}", "content": None}

                if response.status_code != 200:
                    return {
                        "error": f"GitHub API error: {response.status_code}",
                        "content": None,
                    }

                data = response.json()

                # Handle file content (base64 encoded)
                if data.get("encoding") == "base64":
                    import base64
                    content = base64.b64decode(data["content"]).decode("utf-8")
                else:
                    content = data.get("content", "")

                return {
                    "repository": repo,
                    "path": path,
                    "ref": ref,
                    "sha": data.get("sha"),
                    "size": data.get("size"),
                    "content": content,
                    "url": data.get("html_url"),
                }

        except Exception as e:
            self.logger.error(f"Failed to get file content: {e}")
            return {"error": str(e), "content": None}

    async def get_recent_deployments(
        self,
        repo: Optional[str] = None,
        environment: Optional[str] = None,
        limit: int = 5,
    ) -> dict[str, Any]:
        """
        Get recent deployments for a repository.

        Args:
            repo: Repository in owner/repo format
            environment: Filter by environment name
            limit: Maximum deployments to return

        Returns:
            Dict with deployments list
        """
        repo = repo or (self.repositories[0] if self.repositories else None)
        if not repo:
            return {"error": "No repository specified", "deployments": []}

        try:
            async with httpx.AsyncClient() as client:
                params = {"per_page": limit}
                if environment:
                    params["environment"] = environment

                response = await client.get(
                    f"{self.base_url}/repos/{repo}/deployments",
                    headers=self._get_headers(),
                    params=params,
                    timeout=30.0,
                )

                if response.status_code != 200:
                    return {
                        "error": f"GitHub API error: {response.status_code}",
                        "deployments": [],
                    }

                deployments_data = response.json()
                deployments = []

                for d in deployments_data:
                    # Get deployment status
                    status_response = await client.get(
                        f"{self.base_url}/repos/{repo}/deployments/{d['id']}/statuses",
                        headers=self._get_headers(),
                        params={"per_page": 1},
                        timeout=10.0,
                    )

                    status = "unknown"
                    if status_response.status_code == 200:
                        statuses = status_response.json()
                        if statuses:
                            status = statuses[0].get("state", "unknown")

                    deployments.append({
                        "id": d["id"],
                        "ref": d.get("ref"),
                        "sha": d.get("sha", "")[:7],
                        "environment": d.get("environment"),
                        "created_at": d.get("created_at"),
                        "status": status,
                        "creator": d.get("creator", {}).get("login"),
                    })

                return {
                    "repository": repo,
                    "count": len(deployments),
                    "deployments": deployments,
                }

        except Exception as e:
            self.logger.error(f"Failed to get deployments: {e}")
            return {"error": str(e), "deployments": []}

    async def get_pull_requests(
        self,
        repo: Optional[str] = None,
        state: str = "all",
        limit: int = 10,
    ) -> dict[str, Any]:
        """
        Get recent pull requests for a repository.

        Args:
            repo: Repository in owner/repo format
            state: Filter by state (open, closed, all)
            limit: Maximum PRs to return

        Returns:
            Dict with pull requests list
        """
        repo = repo or (self.repositories[0] if self.repositories else None)
        if not repo:
            return {"error": "No repository specified", "pull_requests": []}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/repos/{repo}/pulls",
                    headers=self._get_headers(),
                    params={
                        "state": state,
                        "per_page": limit,
                        "sort": "updated",
                        "direction": "desc",
                    },
                    timeout=30.0,
                )

                if response.status_code != 200:
                    return {
                        "error": f"GitHub API error: {response.status_code}",
                        "pull_requests": [],
                    }

                prs_data = response.json()
                prs = [
                    {
                        "number": pr["number"],
                        "title": pr["title"],
                        "state": pr["state"],
                        "author": pr["user"]["login"],
                        "created_at": pr["created_at"],
                        "updated_at": pr["updated_at"],
                        "merged_at": pr.get("merged_at"),
                        "url": pr["html_url"],
                        "base_branch": pr["base"]["ref"],
                        "head_branch": pr["head"]["ref"],
                    }
                    for pr in prs_data
                ]

                return {
                    "repository": repo,
                    "state": state,
                    "count": len(prs),
                    "pull_requests": prs,
                }

        except Exception as e:
            self.logger.error(f"Failed to get pull requests: {e}")
            return {"error": str(e), "pull_requests": []}
