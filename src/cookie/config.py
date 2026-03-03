"""Configuration and environment loading — single entry point for all config."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_DEFAULT_CONFIG = _PROJECT_ROOT / "config" / "default.yaml"


def init() -> dict[str, Any]:
    """Load .env + YAML config. Call once at startup."""
    # Load .env from project root
    load_dotenv(_PROJECT_ROOT / ".env")
    return load_config()


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    """Load YAML config, merging with defaults."""
    config: dict[str, Any] = {}
    if _DEFAULT_CONFIG.exists():
        config = yaml.safe_load(_DEFAULT_CONFIG.read_text()) or {}
    if path:
        override = yaml.safe_load(Path(path).read_text()) or {}
        _deep_merge(config, override)
    return config


def _deep_merge(base: dict, override: dict) -> None:
    for k, v in override.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v
