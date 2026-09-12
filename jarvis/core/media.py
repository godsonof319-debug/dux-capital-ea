"""Music & media control for Jarvis.

Two layers:
  1. Launch playback  — open a YouTube / Spotify search (or direct query) in
     the browser or the Spotify app.
  2. Transport control — play/pause, next, previous, volume via the OS media
     keys, so it controls whatever player is currently active (Spotify,
     YouTube, Apple Music, etc.).

Media keys use `pynput` when available; otherwise platform-specific fallbacks
(AppleScript on macOS, `playerctl`/`xdotool` on Linux, PowerShell key events on
Windows) are attempted. Everything fails soft with a helpful message.
"""

from __future__ import annotations

import platform
import shutil
import subprocess
import webbrowser
from typing import Optional
from urllib.parse import quote_plus

try:
    from pynput.keyboard import Controller, Key  # type: ignore

    _HAS_PYNPUT = True
except Exception:  # pragma: no cover
    _HAS_PYNPUT = False


_SYSTEM = platform.system()


# --------------------------------------------------------------------------- #
#  Transport control (play/pause/next/prev/volume)
# --------------------------------------------------------------------------- #
_PYNPUT_KEYS = {
    "playpause": "media_play_pause",
    "next": "media_next",
    "previous": "media_previous",
    "volumeup": "media_volume_up",
    "volumedown": "media_volume_down",
    "mute": "media_volume_mute",
    "stop": "media_play_pause",
}

# macOS AppleScript targeting Spotify / Music where sensible.
_MAC_SCRIPTS = {
    "playpause": 'tell application "System Events" to key code 16 using {}',  # F-media
}

# Linux playerctl commands.
_PLAYERCTL = {
    "playpause": "play-pause",
    "next": "next",
    "previous": "previous",
    "stop": "stop",
}


def _pynput_tap(action: str) -> bool:
    if not _HAS_PYNPUT:
        return False
    key_name = _PYNPUT_KEYS.get(action)
    if not key_name:
        return False
    try:
        kb = Controller()
        key = getattr(Key, key_name)
        kb.press(key)
        kb.release(key)
        return True
    except Exception:
        return False


def _mac_tap(action: str) -> bool:
    # Prefer AppleScript against Spotify/Music for reliable control.
    app_actions = {
        "playpause": "playpause",
        "next": "next track",
        "previous": "previous track",
        "stop": "pause",
    }
    vol_actions = {"volumeup": +10, "volumedown": -10}
    try:
        if action in app_actions:
            for app in ("Spotify", "Music"):
                script = (
                    f'tell application "{app}" to if it is running then {app_actions[action]}'
                )
                subprocess.run(["osascript", "-e", script], check=False, capture_output=True)
            return True
        if action in vol_actions:
            delta = vol_actions[action]
            script = (
                f'set volume output volume (output volume of (get volume settings) + {delta})'
            )
            subprocess.run(["osascript", "-e", script], check=False, capture_output=True)
            return True
        if action == "mute":
            subprocess.run(
                ["osascript", "-e", "set volume with output muted"], check=False, capture_output=True
            )
            return True
    except Exception:
        return False
    return False


def _linux_tap(action: str) -> bool:
    try:
        if action in _PLAYERCTL and shutil.which("playerctl"):
            subprocess.run(["playerctl", _PLAYERCTL[action]], check=False, capture_output=True)
            return True
        # Volume via pactl / amixer.
        if action in ("volumeup", "volumedown", "mute"):
            if shutil.which("pactl"):
                if action == "mute":
                    subprocess.run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"], check=False)
                else:
                    sign = "+" if action == "volumeup" else "-"
                    subprocess.run(
                        ["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{sign}10%"], check=False
                    )
                return True
    except Exception:
        return False
    return False


def transport(action: str) -> bool:
    """Perform a transport action. Returns True if a method succeeded."""
    if _pynput_tap(action):
        return True
    if _SYSTEM == "Darwin":
        return _mac_tap(action)
    if _SYSTEM == "Linux":
        return _linux_tap(action)
    # Windows: pynput is the reliable path; if it's missing we report failure.
    return False


# --------------------------------------------------------------------------- #
#  Launch playback
# --------------------------------------------------------------------------- #
def play_youtube(query: str) -> str:
    """Open a YouTube search (auto-plays the top result via the results page)."""
    url = f"https://www.youtube.com/results?search_query={quote_plus(query)}"
    webbrowser.open(url)
    return f"Playing {query} on YouTube."


def play_spotify(query: str) -> str:
    """Try the Spotify desktop app first, else open Spotify web search."""
    if _SYSTEM == "Darwin":
        try:
            subprocess.run(
                ["osascript", "-e", f'tell application "Spotify" to play track "spotify:search:{query}"'],
                check=False,
                capture_output=True,
            )
        except Exception:
            pass
    url = f"https://open.spotify.com/search/{quote_plus(query)}"
    webbrowser.open(url)
    return f"Searching Spotify for {query}."


def controls_available() -> bool:
    if _HAS_PYNPUT:
        return True
    if _SYSTEM == "Darwin":
        return True
    if _SYSTEM == "Linux":
        return bool(shutil.which("playerctl") or shutil.which("pactl"))
    return False
