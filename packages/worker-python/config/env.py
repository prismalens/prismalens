"""
Environment variable utilities with Docker secrets support.

Mirrors the pattern from @prismalens/config TypeScript package.
Supports reading env vars from:
1. Direct environment variables (os.environ['VAR_NAME'])
2. File-based secrets via {VAR_NAME}_FILE pattern (for Docker/K8s)

Example:
    >>> from config.env import read_str_env, read_int_env, read_bool_env
    >>> api_key = read_str_env('GOOGLE_API_KEY', '')
    >>> port = read_int_env('PORT', 3000)
    >>> debug = read_bool_env('DEBUG', False)
"""

import os
from typing import Optional, List


def read_env(name: str) -> Optional[str]:
    """
    Read environment variable with file-based fallback.
    Supports Docker/K8s secrets via {NAME}_FILE pattern.

    Args:
        name: Environment variable name

    Returns:
        Value from env var or file, or None if not found

    Raises:
        ValueError: If file specified by {NAME}_FILE cannot be read
    """
    file_path = os.environ.get(f"{name}_FILE")
    if file_path:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read().strip()
        except (OSError, IOError) as e:
            raise ValueError(f"Failed to read {name} from file {file_path}: {e}")
    return os.environ.get(name)


def read_str_env(name: str, default: str = "") -> str:
    """
    Read string environment variable with default.

    Args:
        name: Environment variable name
        default: Default value if not found

    Returns:
        Environment variable value or default
    """
    return read_env(name) or default


def read_int_env(name: str, default: int) -> int:
    """
    Read integer environment variable with validation.

    Args:
        name: Environment variable name
        default: Default value if not found

    Returns:
        Parsed integer value

    Raises:
        ValueError: If value cannot be parsed as integer
    """
    value = read_env(name)
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError:
        raise ValueError(f"{name} must be a valid integer, got: {value}")


def read_float_env(name: str, default: float) -> float:
    """
    Read float environment variable with validation.

    Args:
        name: Environment variable name
        default: Default value if not found

    Returns:
        Parsed float value

    Raises:
        ValueError: If value cannot be parsed as float
    """
    value = read_env(name)
    if value is None or value == "":
        return default
    try:
        return float(value)
    except ValueError:
        raise ValueError(f"{name} must be a valid number, got: {value}")


def read_bool_env(name: str, default: bool) -> bool:
    """
    Read boolean environment variable.
    Accepts: 'true', '1', 'yes' (case-insensitive) as True

    Args:
        name: Environment variable name
        default: Default value if not found

    Returns:
        Boolean value
    """
    value = read_env(name)
    if value is None or value == "":
        return default
    return value.lower() in ("true", "1", "yes")


def read_list_env(name: str, default: Optional[List[str]] = None) -> List[str]:
    """
    Read comma-separated list environment variable.

    Args:
        name: Environment variable name
        default: Default value if not found

    Returns:
        List of string values
    """
    if default is None:
        default = []
    value = read_env(name)
    if value is None or value == "":
        return default
    return [item.strip() for item in value.split(",") if item.strip()]
