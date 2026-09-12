"""Central configuration for Jarvis.

Reads settings from environment variables (and a .env file if python-dotenv
is installed). Every setting has a sane default so Jarvis runs even with an
empty config.
"""

from __future__ import annotations

import os
from pathlib import Path

# Load .env if python-dotenv is available (optional dependency).
try:
    from dotenv import load_dotenv

    _ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(_ENV_PATH)
except Exception:  # pragma: no cover - dotenv is optional
    pass


def _get_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on", "y"}


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip())
    except (ValueError, AttributeError):
        return default


def _get_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip())
    except (ValueError, AttributeError):
        return default


class Config:
    """Runtime configuration snapshot."""

    # --- Paths ---
    ROOT = Path(__file__).resolve().parent.parent
    DATA_DIR = ROOT / "data"

    # --- AI ---
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
    OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"

    # --- Persona ---
    ASSISTANT_NAME = os.getenv("ASSISTANT_NAME", "Jarvis").strip() or "Jarvis"
    USER_NAME = os.getenv("USER_NAME", "Sir").strip() or "Sir"
    WAKE_WORD = (os.getenv("WAKE_WORD", "jarvis").strip() or "jarvis").lower()

    # --- Voice ---
    VOICE_ENABLED = _get_bool("VOICE_ENABLED", True)
    TTS_RATE = _get_int("TTS_RATE", 185)
    TTS_VOLUME = _get_float("TTS_VOLUME", 1.0)
    TTS_VOICE = os.getenv("TTS_VOICE", "").strip()

    # --- Weather ---
    OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "").strip()
    DEFAULT_CITY = os.getenv("DEFAULT_CITY", "Windhoek").strip() or "Windhoek"
    WEATHER_UNITS = os.getenv("WEATHER_UNITS", "metric").strip() or "metric"

    @classmethod
    def has_ai(cls) -> bool:
        return bool(cls.OPENAI_API_KEY)

    @classmethod
    def has_weather(cls) -> bool:
        return bool(cls.OPENWEATHER_API_KEY)

    @classmethod
    def ensure_dirs(cls) -> None:
        cls.DATA_DIR.mkdir(parents=True, exist_ok=True)


config = Config()
config.ensure_dirs()
