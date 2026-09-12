"""Built-in task 'skills' for Jarvis.

Each skill is a small handler that recognizes a set of intents and returns a
spoken response string. The Assistant tries skills first (fast, offline,
deterministic) and only falls back to the AI brain when nothing matches.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import platform
import random
import re
import subprocess
import threading
import time as _time
import webbrowser
from pathlib import Path
from typing import Callable, List, Optional, Tuple
from urllib.parse import quote_plus

from .config import config
from . import media

try:
    import requests  # type: ignore

    _HAS_REQUESTS = True
except Exception:  # pragma: no cover
    _HAS_REQUESTS = False

try:
    import psutil  # type: ignore

    _HAS_PSUTIL = True
except Exception:  # pragma: no cover
    _HAS_PSUTIL = False


# A handler takes the raw text and returns a response string, or None if it
# doesn't apply to that text.
Handler = Callable[[str], Optional[str]]


# --------------------------------------------------------------------------- #
#  Notes storage
# --------------------------------------------------------------------------- #
class NoteStore:
    def __init__(self) -> None:
        self.path: Path = config.DATA_DIR / "notes.json"
        self._notes: List[dict] = self._load()

    def _load(self) -> List[dict]:
        if self.path.exists():
            try:
                return json.loads(self.path.read_text(encoding="utf-8"))
            except Exception:
                return []
        return []

    def _save(self) -> None:
        self.path.write_text(json.dumps(self._notes, indent=2), encoding="utf-8")

    def add(self, text: str) -> int:
        self._notes.append(
            {"text": text, "ts": _dt.datetime.now().isoformat(timespec="seconds")}
        )
        self._save()
        return len(self._notes)

    def all(self) -> List[dict]:
        return list(self._notes)

    def clear(self) -> int:
        n = len(self._notes)
        self._notes = []
        self._save()
        return n


# --------------------------------------------------------------------------- #
#  Skills registry
# --------------------------------------------------------------------------- #
class Skills:
    def __init__(self, speak: Callable[[str], None]) -> None:
        self.speak = speak
        self.notes = NoteStore()
        self.handlers: List[Handler] = [
            self.skill_timer,
            self.skill_media,
            self.skill_time,
            self.skill_date,
            self.skill_calculate,
            self.skill_weather,
            self.skill_wikipedia,
            self.skill_search_web,
            self.skill_open_site,
            self.skill_open_app,
            self.skill_notes,
            self.skill_system_info,
            self.skill_flip_coin,
            self.skill_roll_dice,
            self.skill_joke,
            self.skill_identity,
        ]

    def handle(self, text: str) -> Optional[str]:
        """Return a response from the first matching skill, else None."""
        for handler in self.handlers:
            try:
                result = handler(text)
            except Exception as exc:  # keep Jarvis alive on skill errors
                result = f"That command hit an error: {exc}"
            if result is not None:
                return result
        return None

    # ---------------------------------------------------------------- helpers
    @staticmethod
    def _match(text: str, *keywords: str) -> bool:
        t = text.lower()
        return any(k in t for k in keywords)

    # ---------------------------------------------------------------- skills
    def skill_timer(self, text: str) -> Optional[str]:
        t = text.lower()
        if not re.search(r"\b(?:timer|remind me|countdown)\b", t):
            return None
        # Parse durations like "5 minutes", "30 seconds", "1 hour and 20 minutes".
        total = 0
        for value, unit in re.findall(r"(\d+)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)", t):
            v = int(value)
            if unit.startswith(("hour", "hr")):
                total += v * 3600
            elif unit.startswith(("min",)):
                total += v * 60
            else:
                total += v
        if total <= 0:
            return "How long should I set the timer for? Try 'set a timer for 5 minutes'."

        # Extract an optional label after "to" / "for ... to".
        label_match = re.search(r"remind me to (.+)", t)
        label = label_match.group(1).strip(" .") if label_match else "Timer"

        def _worker() -> None:
            _time.sleep(total)
            self.speak(f"Time's up. {label}." if label != "Timer" else "Time's up!")

        threading.Thread(target=_worker, daemon=True).start()

        mins, secs = divmod(total, 60)
        hrs, mins = divmod(mins, 60)
        pretty = []
        if hrs:
            pretty.append(f"{hrs} hour{'s' if hrs != 1 else ''}")
        if mins:
            pretty.append(f"{mins} minute{'s' if mins != 1 else ''}")
        if secs:
            pretty.append(f"{secs} second{'s' if secs != 1 else ''}")
        return f"Timer set for {', '.join(pretty)}."

    def skill_time(self, text: str) -> Optional[str]:
        t = text.lower()
        # Match the word "time" but not "times"/"timer", and skip arithmetic.
        if re.search(r"\btime\b", t) and not re.search(r"\btimes\b|\btimer\b", t):
            now = _dt.datetime.now()
            return f"It's {now.strftime('%I:%M %p').lstrip('0')}."
        return None

    def skill_date(self, text: str) -> Optional[str]:
        if self._match(text, "date", "day is it", "what day", "today"):
            now = _dt.datetime.now()
            return f"Today is {now.strftime('%A, %B %d, %Y')}."
        return None

    def skill_calculate(self, text: str) -> Optional[str]:
        t = text.lower()
        # Strip common lead-ins so "what is 12 * (3 + 4)" -> "12 * (3 + 4)".
        cleaned = re.sub(
            r"^\s*(?:hey\s+)?(?:jarvis[,\s]+)?"
            r"(?:calculate|compute|what\s+is|what's|whats|how much is|solve)\s*",
            "",
            t,
        ).strip(" ?.")
        # Normalize operator words/symbols.
        cleaned = re.sub(r"\bplus\b", "+", cleaned)
        cleaned = re.sub(r"\bminus\b", "-", cleaned)
        cleaned = re.sub(r"\b(?:times|multiplied by)\b", "*", cleaned)
        cleaned = re.sub(r"\b(?:divided by|over)\b", "/", cleaned)
        cleaned = (
            cleaned.replace("x", "*")
            .replace("×", "*")
            .replace("÷", "/")
            .replace("^", "**")
        )
        # Grab the arithmetic portion.
        expr_match = re.search(r"[-+*/().\d\s]+", cleaned)
        if expr_match is None:
            return None
        expr = expr_match.group(0).strip()
        # Must contain a digit AND at least one operator to be a calculation.
        if not re.search(r"\d", expr) or not re.search(r"[-+*/]", expr):
            return None
        if not re.fullmatch(r"[-+*/().\s\d]+", expr):
            return None
        try:
            value = eval(expr, {"__builtins__": {}}, {})  # safe: chars whitelisted
        except Exception:
            return None
        if isinstance(value, float):
            if value.is_integer():
                value = int(value)
            else:
                value = round(value, 6)
        return f"That equals {value}."

    def skill_weather(self, text: str) -> Optional[str]:
        if not self._match(text, "weather", "temperature", "forecast", "how hot", "how cold"):
            return None
        if not _HAS_REQUESTS:
            return "I need the 'requests' package to check the weather."
        if not config.has_weather():
            return (
                "Add an OpenWeather API key to your .env to enable weather. "
                "You can get one free at openweathermap.org."
            )
        # Try to extract a city after 'in'.
        city = config.DEFAULT_CITY
        m = re.search(r"\b(?:in|for|at)\s+([a-zA-Z\s]+)$", text.strip())
        if m:
            city = m.group(1).strip()
        try:
            resp = requests.get(
                "https://api.openweathermap.org/data/2.5/weather",
                params={
                    "q": city,
                    "appid": config.OPENWEATHER_API_KEY,
                    "units": config.WEATHER_UNITS,
                },
                timeout=10,
            )
            data = resp.json()
            if resp.status_code != 200:
                return f"I couldn't get weather for {city}: {data.get('message', 'unknown error')}."
            desc = data["weather"][0]["description"]
            temp = round(data["main"]["temp"])
            feels = round(data["main"]["feels_like"])
            unit = "°C" if config.WEATHER_UNITS == "metric" else "°F"
            return (
                f"It's {temp}{unit} in {data['name']} with {desc}, "
                f"feels like {feels}{unit}."
            )
        except Exception as exc:
            return f"Weather lookup failed: {exc}"

    def skill_wikipedia(self, text: str) -> Optional[str]:
        if not self._match(text, "wikipedia", "who is", "what is a", "tell me about"):
            return None
        query = re.sub(
            r".*?(?:wikipedia|who is|what is a|tell me about)\s*",
            "",
            text,
            flags=re.IGNORECASE,
        ).strip(" ?.")
        if not query:
            return None
        try:
            import wikipedia  # type: ignore

            summary = wikipedia.summary(query, sentences=2, auto_suggest=True)
            return summary
        except Exception:
            if _HAS_REQUESTS:
                try:
                    resp = requests.get(
                        "https://en.wikipedia.org/api/rest_v1/page/summary/"
                        + quote_plus(query),
                        timeout=10,
                        headers={"User-Agent": "Jarvis/1.0"},
                    )
                    if resp.status_code == 200:
                        extract = resp.json().get("extract")
                        if extract:
                            return extract
                except Exception:
                    pass
            return None  # let the AI brain try

    def skill_search_web(self, text: str) -> Optional[str]:
        m = re.match(r"\s*(?:search|google|look up|find)\s+(.*)", text, re.IGNORECASE)
        if not m:
            return None
        query = m.group(1).strip(" ?.")
        if not query:
            return None
        url = f"https://www.google.com/search?q={quote_plus(query)}"
        try:
            webbrowser.open(url)
            return f"Searching the web for {query}."
        except Exception:
            return f"Here's a search link: {url}"

    def skill_open_site(self, text: str) -> Optional[str]:
        m = re.match(r"\s*(?:open|go to|launch)\s+(.*)", text, re.IGNORECASE)
        if not m:
            return None
        target = m.group(1).strip().lower().rstrip(".")
        shortcuts = {
            "youtube": "https://youtube.com",
            "google": "https://google.com",
            "gmail": "https://mail.google.com",
            "github": "https://github.com",
            "twitter": "https://twitter.com",
            "x": "https://x.com",
            "reddit": "https://reddit.com",
            "wikipedia": "https://wikipedia.org",
            "stackoverflow": "https://stackoverflow.com",
            "chatgpt": "https://chat.openai.com",
            "maps": "https://maps.google.com",
        }
        # Named app? let the app-opener handle it (return None here).
        known_apps = {"notepad", "calculator", "calc", "terminal", "cmd", "explorer", "finder"}
        if target in known_apps:
            return None
        url = shortcuts.get(target)
        if url is None:
            if "." in target and " " not in target:
                url = target if target.startswith("http") else f"https://{target}"
            else:
                url = f"https://www.google.com/search?q={quote_plus(target)}"
        try:
            webbrowser.open(url)
            return f"Opening {target}."
        except Exception:
            return f"Here's the link: {url}"

    def skill_open_app(self, text: str) -> Optional[str]:
        m = re.match(r"\s*(?:open|launch|start)\s+(.*)", text, re.IGNORECASE)
        if not m:
            return None
        app = m.group(1).strip().lower().rstrip(".")
        system = platform.system()
        table = {
            "Windows": {
                "notepad": "notepad",
                "calculator": "calc",
                "calc": "calc",
                "terminal": "cmd",
                "cmd": "cmd",
                "explorer": "explorer",
                "paint": "mspaint",
            },
            "Darwin": {
                "notepad": "TextEdit",
                "calculator": "Calculator",
                "calc": "Calculator",
                "terminal": "Terminal",
                "finder": "Finder",
                "safari": "Safari",
            },
            "Linux": {
                "terminal": "x-terminal-emulator",
                "calculator": "gnome-calculator",
                "calc": "gnome-calculator",
                "files": "nautilus",
                "text editor": "gedit",
            },
        }
        apps = table.get(system, {})
        if app not in apps:
            return None
        cmd = apps[app]
        try:
            if system == "Windows":
                os.startfile(cmd)  # type: ignore[attr-defined]
            elif system == "Darwin":
                subprocess.Popen(["open", "-a", cmd])
            else:
                subprocess.Popen([cmd])
            return f"Launching {app}."
        except Exception as exc:
            return f"I couldn't open {app}: {exc}"

    def skill_notes(self, text: str) -> Optional[str]:
        t = text.lower().strip()
        # Add note
        m = re.match(r"\s*(?:take a note|note that|remember that|make a note)\s*[:,-]?\s*(.*)", text, re.IGNORECASE)
        if m and m.group(1).strip():
            n = self.notes.add(m.group(1).strip())
            return f"Noted. You now have {n} note{'s' if n != 1 else ''}."
        if t in ("take a note", "note that", "remember that", "make a note"):
            self.speak("What should I note?")
            return "__PROMPT_NOTE__"  # handled by assistant loop
        # Read notes
        if self._match(t, "read notes", "read my notes", "list notes", "my notes", "show notes"):
            notes = self.notes.all()
            if not notes:
                return "You have no notes yet."
            lines = [f"{i + 1}. {nt['text']}" for i, nt in enumerate(notes)]
            return "Here are your notes: " + "; ".join(lines)
        # Clear notes
        if self._match(t, "clear notes", "delete notes", "erase notes"):
            n = self.notes.clear()
            return f"Cleared {n} note{'s' if n != 1 else ''}."
        return None

    def skill_system_info(self, text: str) -> Optional[str]:
        if not self._match(text, "system", "cpu", "memory", "ram", "battery", "disk", "how's my computer"):
            return None
        parts = []
        parts.append(f"OS: {platform.system()} {platform.release()}")
        if _HAS_PSUTIL:
            try:
                parts.append(f"CPU at {psutil.cpu_percent(interval=0.3):.0f} percent")
                vm = psutil.virtual_memory()
                parts.append(f"memory at {vm.percent:.0f} percent")
                batt = psutil.sensors_battery()
                if batt is not None:
                    plugged = "charging" if batt.power_plugged else "on battery"
                    parts.append(f"battery {batt.percent:.0f} percent, {plugged}")
            except Exception:
                pass
        else:
            parts.append("install psutil for CPU, memory, and battery details")
        return ". ".join(parts) + "."

    def skill_media(self, text: str) -> Optional[str]:
        t = text.lower().strip()

        # --- Transport controls (check these before "play <song>") ---
        transport_map = [
            (r"\b(pause|hold on)\b.*\b(music|song|playback|track|it)\b|\bpause\b$|^pause\b", "playpause"),
            (r"\b(resume|unpause|continue)\b.*\b(music|song|playback|track)\b", "playpause"),
            (r"\b(next|skip)\b.*\b(song|track)\b|\b(next track|skip song|skip this)\b|\bskip\b$|^next\b", "next"),
            (r"\b(previous|last|go back)\b.*\b(song|track)\b|\bprevious track\b|^previous\b", "previous"),
            (r"\b(stop)\b.*\b(music|song|playback)\b", "stop"),
            (r"\b(turn|volume)\b.*\bup\b|\bvolume up\b|\blouder\b", "volumeup"),
            (r"\b(turn|volume)\b.*\bdown\b|\bvolume down\b|\bquieter\b|\blower the volume\b", "volumedown"),
            (r"\b(mute|unmute)\b", "mute"),
        ]
        is_playback_launch = bool(
            re.search(r"\bplay\b", t)
            and not re.search(r"\b(pause|resume|unpause)\b", t)
        )
        if not is_playback_launch:
            for pattern, action in transport_map:
                if re.search(pattern, t):
                    if media.transport(action):
                        labels = {
                            "playpause": "Toggled playback.",
                            "next": "Skipping to the next track.",
                            "previous": "Going to the previous track.",
                            "stop": "Stopping playback.",
                            "volumeup": "Turning it up.",
                            "volumedown": "Turning it down.",
                            "mute": "Toggled mute.",
                        }
                        return labels.get(action, "Done.")
                    if not media.controls_available():
                        return (
                            "I can't control media on this system yet. Install "
                            "'pynput' (pip install pynput) to enable media keys."
                        )
                    return "I tried, but no active media player responded."

        # --- Launch playback ---
        # Bare "play" / "resume" -> resume playback.
        if re.fullmatch(r"\s*(?:play|resume|unpause)\s*", t):
            if media.transport("playpause"):
                return "Resuming playback."
            if not media.controls_available():
                return "Install 'pynput' (pip install pynput) to enable playback control."
            return "Nothing seems to be paused."
        # "play X on spotify" / "play X on youtube" / "play X"
        m = re.match(r"\s*play\s+(.*)", text, re.IGNORECASE)
        if m:
            query = m.group(1).strip(" .?")
            if not query:
                # bare "play" -> resume playback
                if media.transport("playpause"):
                    return "Resuming playback."
                return "Play what? Try 'play some jazz on YouTube'."
            on_spotify = bool(re.search(r"\bon\s+spotify\b", query, re.IGNORECASE))
            on_youtube = bool(re.search(r"\bon\s+youtube\b", query, re.IGNORECASE))
            # Strip the trailing "on <service>" from the query.
            query = re.sub(r"\s+on\s+(?:spotify|youtube)\b", "", query, flags=re.IGNORECASE).strip()
            # Strip a leading "some"/"the" for nicer phrasing.
            query = re.sub(r"^(?:some|the)\s+", "", query, flags=re.IGNORECASE).strip()
            if not query:
                return "Play what exactly?"
            try:
                if on_spotify:
                    return media.play_spotify(query)
                return media.play_youtube(query)  # default player
            except Exception as exc:
                return f"I couldn't start playback: {exc}"
        return None

    def skill_flip_coin(self, text: str) -> Optional[str]:
        if self._match(text, "flip a coin", "flip coin", "heads or tails", "toss a coin"):
            return random.choice(["Heads.", "Tails."])
        return None

    def skill_roll_dice(self, text: str) -> Optional[str]:
        if re.search(r"\broll\b.*\b(?:die|dice|d\d+)\b", text.lower()):
            m = re.search(r"(\d+)\s*(?:sided|side)|d(\d+)", text.lower())
            if m:
                sides = int(m.group(1) or m.group(2))
            else:
                sides = 6
            sides = max(2, min(sides, 1000))
            return f"You rolled a {random.randint(1, sides)} on a {sides}-sided die."
        return None

    def skill_joke(self, text: str) -> Optional[str]:
        if not self._match(text, "joke", "make me laugh", "something funny"):
            return None
        jokes = [
            "Why do programmers prefer dark mode? Because light attracts bugs.",
            "I told my computer I needed a break, and now it won't stop sending me KitKats.",
            "Why did the developer go broke? Because he used up all his cache.",
            "There are 10 kinds of people in the world: those who understand binary and those who don't.",
            "I would tell you a UDP joke, but you might not get it.",
        ]
        return random.choice(jokes)

    def skill_identity(self, text: str) -> Optional[str]:
        t = text.lower()
        if self._match(t, "your name", "who are you", "what are you"):
            return f"I am {config.ASSISTANT_NAME}, your personal assistant, {config.USER_NAME}."
        if self._match(t, "what can you do", "help", "commands", "capabilities"):
            return (
                "I can tell the time and date, do math, check the weather, look "
                "things up on Wikipedia, search the web, open apps and websites, "
                "play music and control playback, take notes, report system info, "
                "tell jokes, and chat with you. Just ask."
            )
        return None
