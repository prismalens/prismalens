"""
Configuration settings for PrismaLens Worker.

This module provides centralized configuration management for the worker package,
including model settings and external service credentials.

Uses the env.py utilities for Docker secrets support ({VAR_NAME}_FILE pattern).

Note: This is a worker-specific configuration. It does NOT include database
configuration as the worker receives all data from the job queue.
"""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from .env import read_str_env, read_int_env, read_float_env, read_bool_env, read_list_env
from .internal_client import InternalApiClient


@dataclass
class ModelConfig:
    """Model configuration for ADK agents."""

    name: str
    temperature: float = 0.1
    max_tokens: int = 1000
    thinking_budget: Optional[int] = None


@dataclass
class AgentConfig:
    """Configuration for individual agents."""

    model: ModelConfig
    max_retries: int = 3
    timeout_seconds: int = 300


class Settings:
    """Centralized settings management for PrismaLens Worker."""

    def __init__(self) -> None:
        """Initialize settings from environment variables."""
        # Base directory
        self.base_dir = Path(__file__).parent.parent

        # Edition detection
        self.edition = read_str_env("PRISMALENS_EDITION", "COMMUNITY").upper()
        self.is_enterprise = self.edition == "ENTERPRISE"

        # Local git repository path for code analysis
        self.local_git_workspace = read_str_env(
            "PRISMALENS_GIT_WORKSPACE",
            str(self.base_dir / "local_git_workspace"),
        )
        if not os.path.exists(self.local_git_workspace):
            os.makedirs(self.local_git_workspace, exist_ok=True)

        # Redis configuration (for queue mode)
        self.redis_url = read_str_env("REDIS_URL", "redis://localhost:6379/0")

        # Worker mode configuration
        self.worker_mode = read_str_env("PRISMALENS_WORKER_MODE", "regular")
        self.worker_concurrency = read_int_env("PRISMALENS_WORKER_CONCURRENCY", 5)
        self.graceful_shutdown_timeout = read_int_env("PRISMALENS_GRACEFUL_SHUTDOWN_TIMEOUT", 30)
        self.worker_health_port = read_int_env("PRISMALENS_WORKER_HEALTH_PORT", 8081)
        self.worker_job_port = read_int_env("PRISMALENS_WORKER_JOB_PORT", 8082)

        # Default model configuration
        self.default_model = ModelConfig(
            name=read_str_env("PRISMALENS_DEFAULT_MODEL", "gemini-2.0-flash"),
            temperature=0.1,
            max_tokens=1000,
            thinking_budget=512,
        )

        # Agent-specific configurations
        self.agent_configs = {
            "alert_agent": AgentConfig(
                model=ModelConfig(
                    name="gemini-2.0-flash-lite",
                    temperature=0.1,
                    max_tokens=6000,
                    thinking_budget=2000,
                ),
                timeout_seconds=120,
            ),
            "gatherer_agent": AgentConfig(
                model=ModelConfig(
                    name="gemini-2.5-flash-preview-05-20",
                    temperature=0.1,
                    max_tokens=8000,
                    thinking_budget=4000,
                ),
                timeout_seconds=300,
            ),
            "log_retriever_agent": AgentConfig(
                model=ModelConfig(
                    name="gemini-2.5-flash-preview-05-20",
                    temperature=0.1,
                    max_tokens=8000,
                    thinking_budget=4000,
                ),
                timeout_seconds=300,
            ),
            "analyzer_agent": AgentConfig(
                model=ModelConfig(
                    name="gemini-2.0-flash-lite",
                    temperature=0.2,
                    max_tokens=10000,
                    thinking_budget=5000,
                ),
                timeout_seconds=300,
            ),
            "recommender_agent": AgentConfig(
                model=ModelConfig(
                    name="gemini-2.0-flash-lite",
                    temperature=0.3,
                    max_tokens=10000,
                    thinking_budget=5000,
                ),
                timeout_seconds=240,
            ),
        }

        # Google AI configuration (supports _FILE suffix for Docker secrets)
        self.google_api_key = read_str_env("GOOGLE_API_KEY", "")
        self.google_cloud_project = read_str_env("GOOGLE_CLOUD_PROJECT", "")
        self.google_cloud_location = read_str_env("GOOGLE_CLOUD_LOCATION", "us-central1")
        self.use_vertex_ai = read_bool_env("GOOGLE_GENAI_USE_VERTEXAI", False)

        # Toolset configuration
        render_api_token = read_str_env("RENDER_API_TOKEN", "")
        render_owner_id = read_str_env("RENDER_OWNER_ID", "")
        render_resource_id = read_str_env("RENDER_RESOURCE_ID", "")

        self.toolset = {
            "render": {
                "enabled": bool(render_api_token and render_owner_id and render_resource_id),
                "api_token": render_api_token,
                "owner_id": render_owner_id,
                "resource_id": render_resource_id,
                "openapi_url": read_str_env(
                    "RENDER_OPENAPI_URL",
                    "https://api-docs.render.com/openapi/render-public-api-1.json",
                ),
            }
        }

        # Service to repository mapping
        self.service_repo_mapping: dict[str, str] = {}
        mapping_str = read_str_env("PRISMALENS_SERVICE_REPO_MAPPING", "")
        if mapping_str:
            for pair in mapping_str.split(","):
                if ":" in pair:
                    service, repo = pair.split(":", 1)
                    self.service_repo_mapping[service.strip()] = repo.strip()

        # API Rate Limiting / Throttling Configuration
        self.throttling = {
            "enabled": read_bool_env("API_THROTTLING_ENABLED", False),
            "default_delay_seconds": read_float_env("API_THROTTLING_DEFAULT_DELAY", 8.0),
            "agent_specific_delays": {
                "gatherer_agent": read_float_env("API_THROTTLING_GATHERER_DELAY", 8.0)
            },
            "throttled_models": read_list_env(
                "API_THROTTLING_MODELS", ["gemini-2.5-flash-preview-05-20"]
            ),
        }

        # GitHub Token (supports _FILE suffix for Docker secrets)
        self.github_token = read_str_env("GITHUB_TOKEN", "")
        self.github_openapi_url = read_str_env(
            "GITHUB_OPENAPI_URL",
            "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.yaml",
        )

        # Logging configuration
        self.log_level = read_str_env("LOG_LEVEL", "INFO")

        # Internal API configuration
        self.api_url = read_str_env("PRISMALENS_API_URL", "http://localhost:5367")
        self.internal_secret = read_str_env(
            "PRISMALENS_INTERNAL_SECRET", "dev-secret-replace-in-prod"
        )
        self.internal_client = InternalApiClient(self.api_url, self.internal_secret)

        # Initialize LLM credentials
        self.setup_llm_credentials()

    def setup_llm_credentials(self) -> None:
        """Setup LLM credentials, prioritizing Envs then API."""
        # 1. Try Environment Variables first (Legacy/Override)
        if self.google_api_key:
             self.setup_google_env_vars()
             return

        # 2. Try Internal API
        print("Fetching LLM config from Internal API...")
        config = self.internal_client.get_llm_config()
        if config and config.get("apiKey"):
            print(f"Loaded config for provider: {config.get('provider')}")
            # Set env vars for ADK to pick up
            if config.get("provider") == "google":
                self.google_api_key = config.get("apiKey")
                self.setup_google_env_vars()
            else:
                # For LiteLLM / Other providers
                # We set standard env vars that LiteLLM expects
                provider = config.get("provider")
                api_key = config.get("apiKey")
                
                if provider == "openai":
                    os.environ["OPENAI_API_KEY"] = api_key
                elif provider == "anthropic":
                    os.environ["ANTHROPIC_API_KEY"] = api_key
                elif provider == "azure":
                    os.environ["AZURE_API_KEY"] = api_key
                    if config.get("baseUrl"):
                        os.environ["AZURE_API_BASE"] = config.get("baseUrl")
                
                # ADK Model Client factory will need to check this config or env vars
                # Ideally, we should update the default model too if provided
                if config.get("model"):
                    self.default_model.name = config.get("model")

    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value by key."""
        key_lower = key.lower()
        if hasattr(self, key_lower):
            val = getattr(self, key_lower)
            if val is not None:
                return val

        return os.environ.get(key, default)

    def get_agent_config(self, agent_name: str) -> AgentConfig:
        """Get configuration for a specific agent."""
        return self.agent_configs.get(agent_name, AgentConfig(model=self.default_model))

    def get_model_config_dict(self, agent_name: str) -> dict[str, Any]:
        """Get model configuration as dictionary for ADK agent initialization."""
        config = self.get_agent_config(agent_name)
        model_dict: dict[str, Any] = {
            "model": config.model.name,
            "temperature": config.model.temperature,
            "max_tokens": config.model.max_tokens,
        }

        if config.model.thinking_budget is not None:
            model_dict["thinking_budget"] = config.model.thinking_budget

        return model_dict

    def validate_configuration(self) -> bool:
        """Validate that required configuration is present."""
        if not self.google_api_key:
            print("Missing required configuration: GOOGLE_API_KEY")
            return False

        return True

    def validate_worker_mode(self) -> None:
        """
        Validate worker mode configuration.

        Raises:
            ValueError: If mode is invalid or required config is missing
        """
        if self.worker_mode not in ("regular", "queue"):
            raise ValueError(
                f"Invalid worker mode: {self.worker_mode}. "
                f"Valid options are: 'regular', 'queue'"
            )

        if self.worker_mode == "queue" and not self.redis_url:
            raise ValueError(
                "REDIS_URL is required for queue mode. "
                "Set REDIS_URL environment variable."
            )

    def setup_google_env_vars(self) -> None:
        """Helper to set Google specific env vars."""
        if self.use_vertex_ai and self.google_cloud_project:
            os.environ["GOOGLE_CLOUD_PROJECT"] = self.google_cloud_project
            os.environ["GOOGLE_CLOUD_LOCATION"] = self.google_cloud_location
            os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "True"
        else:
            if self.google_api_key:
                os.environ["GOOGLE_API_KEY"] = self.google_api_key

    def setup_google_credentials(self) -> None:
        """Deprecated: Use setup_llm_credentials instead."""
        self.setup_llm_credentials()


# Global settings instance
settings = Settings()
