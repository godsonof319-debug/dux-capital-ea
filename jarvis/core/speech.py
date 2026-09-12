"""Voice input (speech-to-text) and output (text-to-speech) for Jarvis.

Everything here degrades gracefully:
  * If pyttsx3 isn't installed, speaking falls back to printing text.
  * If SpeechRecognition / PyAudio / a microphone aren't available,
    listening falls back to reading typed input from the keyboard.

This means Jarvis is always usable, even on a machine with no audio stack.
"""

from __future__ import annotations

import sys
from typing import Optional

from .config import config

# ---- Optional TTS engine (pyttsx3) ----
try:
    import pyttsx3  # type: ignore

    _HAS_TTS = True
except Exception:  # pragma: no cover
    _HAS_TTS = False

# ---- Optional STT engine (SpeechRecognition + PyAudio) ----
try:
    import speech_recognition as sr  # type: ignore

    _HAS_SR = True
except Exception:  # pragma: no cover
    _HAS_SR = False


# ANSI colors for a nicer console experience.
class C:
    RESET = "\033[0m"
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    MAGENTA = "\033[95m"
    GREY = "\033[90m"
    BOLD = "\033[1m"


class VoiceEngine:
    """Handles TTS and STT with graceful fallbacks."""

    def __init__(self) -> None:
        self.voice_enabled = config.VOICE_ENABLED and _HAS_TTS
        self._engine = None
        self._recognizer = None
        self._mic_available = False

        if self.voice_enabled:
            self._init_tts()

        if _HAS_SR:
            self._init_stt()

    # ------------------------------------------------------------------ TTS
    def _init_tts(self) -> None:
        try:
            self._engine = pyttsx3.init()
            self._engine.setProperty("rate", config.TTS_RATE)
            self._engine.setProperty("volume", config.TTS_VOLUME)
            if config.TTS_VOICE:
                for v in self._engine.getProperty("voices"):
                    haystack = f"{getattr(v, 'name', '')} {getattr(v, 'id', '')}".lower()
                    if config.TTS_VOICE.lower() in haystack:
                        self._engine.setProperty("voice", v.id)
                        break
        except Exception as exc:  # pragma: no cover
            print(f"{C.YELLOW}[voice] TTS init failed ({exc}); using text output.{C.RESET}")
            self.voice_enabled = False
            self._engine = None

    def speak(self, text: str) -> None:
        """Say `text` aloud (and always echo it to the console)."""
        if not text:
            return
        print(f"{C.CYAN}{C.BOLD}{config.ASSISTANT_NAME}:{C.RESET} {C.CYAN}{text}{C.RESET}")
        if self.voice_enabled and self._engine is not None:
            try:
                self._engine.say(text)
                self._engine.runAndWait()
            except Exception:  # pragma: no cover
                pass

    # ------------------------------------------------------------------ STT
    def _init_stt(self) -> None:
        try:
            self._recognizer = sr.Recognizer()
            self._recognizer.dynamic_energy_threshold = True
            self._recognizer.pause_threshold = 0.8
            # Probe for a microphone without crashing if none exists.
            try:
                sr.Microphone()  # will raise if PyAudio/mic missing
                self._mic_available = True
            except Exception:
                self._mic_available = False
        except Exception:  # pragma: no cover
            self._recognizer = None
            self._mic_available = False

    @property
    def can_listen(self) -> bool:
        return _HAS_SR and self._mic_available and self._recognizer is not None

    def listen(self, prompt: str = "Listening...") -> Optional[str]:
        """Capture one utterance from the mic, or fall back to typed input.

        Returns the recognized text (lowercased-safe original) or None if
        nothing was understood.
        """
        if not self.can_listen:
            return self._typed_input()

        try:
            with sr.Microphone() as source:
                print(f"{C.GREY}[{prompt}]{C.RESET}")
                self._recognizer.adjust_for_ambient_noise(source, duration=0.4)
                audio = self._recognizer.listen(source, timeout=8, phrase_time_limit=12)
        except sr.WaitTimeoutError:
            return None
        except Exception:
            return self._typed_input()

        try:
            text = self._recognizer.recognize_google(audio)
            print(f"{C.GREEN}You: {text}{C.RESET}")
            return text
        except sr.UnknownValueError:
            return None
        except sr.RequestError:
            self.speak("Speech service is unavailable. Please type your command.")
            return self._typed_input()

    def _typed_input(self) -> Optional[str]:
        try:
            text = input(f"{C.GREEN}You (type): {C.RESET}").strip()
            return text or None
        except (EOFError, KeyboardInterrupt):
            return "exit"

    # ------------------------------------------------------------------ status
    def status_line(self) -> str:
        tts = "on" if self.voice_enabled else "off (text)"
        stt = "mic" if self.can_listen else "keyboard"
        return f"voice={tts}, input={stt}"
