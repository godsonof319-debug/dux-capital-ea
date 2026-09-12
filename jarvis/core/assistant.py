"""The Assistant: ties together voice, skills, and the AI brain."""

from __future__ import annotations

import datetime as _dt
import random
from typing import Optional

from .brain import Brain
from .config import config
from .skills import Skills
from .speech import C, VoiceEngine

EXIT_WORDS = {"exit", "quit", "goodbye", "good bye", "bye", "shut down", "shutdown", "stop"}


class Assistant:
    def __init__(self) -> None:
        self.voice = VoiceEngine()
        self.brain = Brain()
        self.skills = Skills(self.voice.speak)
        self._pending_note = False

    # ------------------------------------------------------------------ intro
    def greet(self) -> None:
        hour = _dt.datetime.now().hour
        if hour < 12:
            part = "Good morning"
        elif hour < 18:
            part = "Good afternoon"
        else:
            part = "Good evening"
        ai = "online AI" if self.brain.online else "offline mode"
        print()
        print(f"{C.MAGENTA}{C.BOLD}  ╦  ╔═╗╦═╗╦  ╦╦╔═╗{C.RESET}")
        print(f"{C.MAGENTA}{C.BOLD}  ║  ╠═╣╠╦╝╚╗╔╝║╚═╗   {config.ASSISTANT_NAME} v1.0{C.RESET}")
        print(f"{C.MAGENTA}{C.BOLD}  ╚╝ ╩ ╩╩╚═ ╚╝ ╩╚═╝   [{self.voice.status_line()}, {ai}]{C.RESET}")
        print()
        self.voice.speak(
            f"{part}, {config.USER_NAME}. {config.ASSISTANT_NAME} online and ready."
        )

    # ------------------------------------------------------------------ core
    def process(self, text: str) -> bool:
        """Handle one command. Returns False if Jarvis should shut down."""
        if not text:
            return True
        cleaned = text.strip()
        low = cleaned.lower().strip(" .!?")

        if low in EXIT_WORDS:
            self.voice.speak(
                random.choice(
                    [
                        f"Goodbye, {config.USER_NAME}.",
                        "Powering down. Call me when you need me.",
                        "Shutting down. Until next time.",
                    ]
                )
            )
            return False

        if low in ("reset", "clear memory", "forget everything"):
            self.brain.reset()
            self.voice.speak("Conversation memory cleared.")
            return True

        # If we're waiting for the content of a note, capture it now.
        if self._pending_note:
            self._pending_note = False
            n = self.skills.notes.add(cleaned)
            self.voice.speak(f"Noted. You now have {n} note{'s' if n != 1 else ''}.")
            return True

        # Try built-in skills first.
        response = self.skills.handle(cleaned)
        if response == "__PROMPT_NOTE__":
            self._pending_note = True
            return True
        if response is not None:
            self.voice.speak(response)
            return True

        # Fall back to the AI brain for open conversation.
        self.voice.speak(self.brain.think(cleaned))
        return True

    # ------------------------------------------------------------------ loops
    def run_text_loop(self) -> None:
        """Type or speak commands one at a time (default mode)."""
        self.greet()
        running = True
        while running:
            text = self.voice.listen(prompt="Speak or type a command")
            if text is None:
                continue
            running = self.process(text)

    def run_wake_loop(self) -> None:
        """Hands-free mode: wait for the wake word, then take a command."""
        self.greet()
        wake = config.WAKE_WORD
        self.voice.speak(f"Say '{wake}' to wake me.")
        while True:
            heard = self.voice.listen(prompt=f"Waiting for wake word '{wake}'")
            if heard is None:
                continue
            low = heard.lower()
            if low.strip(" .!?") in EXIT_WORDS:
                self.process(low)
                break
            if wake in low:
                # The wake word may be followed by an inline command.
                after = low.split(wake, 1)[1].strip(" ,.-")
                if after:
                    if not self.process(after):
                        break
                    continue
                self.voice.speak(random.choice(["Yes?", f"At your service, {config.USER_NAME}.", "Go ahead."]))
                command = self.voice.listen(prompt="Listening for your command")
                if command is None:
                    self.voice.speak("I didn't catch that.")
                    continue
                if not self.process(command):
                    break

    def run_once(self, text: str) -> None:
        """Execute a single command (used by `--once "..."`)."""
        self.process(text)
