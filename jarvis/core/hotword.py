"""Offline always-listening hotword detection using Vosk.

Vosk runs a small speech model entirely on-device — no internet, no API key —
so Jarvis can listen for its wake word continuously and privately. Once the
wake word is heard, control is handed back to the assistant, which then
captures the actual command (using whichever STT the VoiceEngine provides).

If Vosk, sounddevice, or a model are unavailable, `HotwordListener.available`
is False and the caller should fall back to the standard wake loop.

Setup:
    pip install vosk sounddevice
    # download a small model, e.g.:
    #   https://alphacephei.com/vosk/models  (vosk-model-small-en-us-0.15)
    # unzip it and point JARVIS at it via VOSK_MODEL_PATH in .env,
    # or drop it in jarvis/models/ and Jarvis will auto-detect it.
"""

from __future__ import annotations

import json
import os
import queue
from pathlib import Path
from typing import Callable, Optional

from .config import config

try:
    import sounddevice as sd  # type: ignore
    import vosk  # type: ignore

    _HAS_VOSK = True
except Exception:  # pragma: no cover
    _HAS_VOSK = False


def _find_model_path() -> Optional[Path]:
    """Locate a Vosk model directory from env or the models/ folder."""
    env_path = os.getenv("VOSK_MODEL_PATH", "").strip()
    if env_path and Path(env_path).is_dir():
        return Path(env_path)
    models_dir = config.ROOT / "models"
    if models_dir.is_dir():
        # A Vosk model dir contains an 'am' subfolder; pick the first match.
        for child in sorted(models_dir.iterdir()):
            if child.is_dir() and (child / "am").exists():
                return child
        # Otherwise, if there's exactly one directory, assume it's the model.
        dirs = [c for c in models_dir.iterdir() if c.is_dir()]
        if len(dirs) == 1:
            return dirs[0]
    return None


class HotwordListener:
    """Continuously listens offline and fires a callback on the wake word."""

    def __init__(self, wake_word: Optional[str] = None) -> None:
        self.wake_word = (wake_word or config.WAKE_WORD).lower()
        self.available = False
        self._model = None
        self._reason = ""
        self._samplerate = 16000

        if not _HAS_VOSK:
            self._reason = "vosk/sounddevice not installed (pip install vosk sounddevice)"
            return
        model_path = _find_model_path()
        if model_path is None:
            self._reason = (
                "no Vosk model found — download one from alphacephei.com/vosk/models "
                "and set VOSK_MODEL_PATH or drop it in jarvis/models/"
            )
            return
        try:
            vosk.SetLogLevel(-1)
            self._model = vosk.Model(str(model_path))
            self.available = True
        except Exception as exc:  # pragma: no cover
            self._reason = f"failed to load Vosk model: {exc}"

    @property
    def reason_unavailable(self) -> str:
        return self._reason

    def listen_for_wake(self, should_stop: Optional[Callable[[], bool]] = None) -> bool:
        """Block until the wake word is detected. Returns True on detection,
        False if `should_stop()` requested a stop first."""
        if not self.available:
            return False

        rec = vosk.KaldiRecognizer(self._model, self._samplerate)
        rec.SetWords(False)
        q: "queue.Queue[bytes]" = queue.Queue()

        def _callback(indata, frames, time_info, status):  # noqa: ANN001
            q.put(bytes(indata))

        with sd.RawInputStream(
            samplerate=self._samplerate,
            blocksize=8000,
            dtype="int16",
            channels=1,
            callback=_callback,
        ):
            while True:
                if should_stop is not None and should_stop():
                    return False
                try:
                    data = q.get(timeout=0.5)
                except queue.Empty:
                    continue
                heard = ""
                if rec.AcceptWaveform(data):
                    heard = json.loads(rec.Result()).get("text", "")
                else:
                    heard = json.loads(rec.PartialResult()).get("partial", "")
                if self.wake_word in heard.lower():
                    return True
