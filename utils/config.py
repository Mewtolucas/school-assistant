"""Configuration management - save/load user settings to JSON."""

import json
import os
from pathlib import Path

CONFIG_DIR = Path.home() / ".school_assistant"
CONFIG_FILE = CONFIG_DIR / "config.json"

DEFAULTS = {
    "api_key": "",
    "model": "claude-sonnet-4-5-20250514",
    "temperature": 0.3,
    "window": {
        "x": 100,
        "y": 100,
        "width": 350,
        "height": 600,
    },
    "appearance": {
        "theme": "light",
        "opacity": 1.0,
        "font_size": "medium",
    },
    "screenshot": {
        "delay": 0,
        "quality": "medium",
        "include_cursor": False,
        "sound": False,
    },
    "privacy": {
        "save_history": True,
    },
    "summary_length": "standard",
    "extract_key_terms": False,
}

MODEL_CHOICES = {
    "Claude Sonnet 4.5 (Balanced)": "claude-sonnet-4-5-20250514",
    "Claude Opus 4.5 (Most Capable)": "claude-opus-4-5-20250514",
    "Claude Haiku 3.5 (Fastest)": "claude-3-5-haiku-20241022",
}

QUALITY_MAP = {
    "low": 40,
    "medium": 70,
    "high": 95,
}


def _ensure_dir():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def load_config() -> dict:
    """Load configuration from disk, merging with defaults."""
    _ensure_dir()
    config = json.loads(json.dumps(DEFAULTS))  # deep copy
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r") as f:
                saved = json.load(f)
            _deep_merge(config, saved)
        except (json.JSONDecodeError, OSError):
            pass
    # Also check .env for API key
    if not config["api_key"]:
        config["api_key"] = os.getenv("ANTHROPIC_API_KEY", "")
    return config


def save_config(config: dict):
    """Persist configuration to disk."""
    _ensure_dir()
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def _deep_merge(base: dict, override: dict):
    """Recursively merge override into base."""
    for key, value in override.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
