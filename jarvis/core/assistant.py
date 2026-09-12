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
    def respond(self, text: str, speak: bool = True) -> tuple[Optional[str], bool]:
        """Process one input and return (reply_text, keep_running).

        This is the single source of truth used by the CLI, the GUI, and the
        hotword loop. When `speak` is True the reply is also voiced/printed via
        the voice engine; when False the caller is responsible for display.
        """
        if not text or not text.strip():
            return None, True
        cleaned = text.strip()
        low = cleaned.lower().strip(" .!?")

        reply: Optional[str]
        keep_running = True

        if low in EXIT_WORDS:
            reply = random.choice(
                [
                    f"Goodbye, {config.USER_NAME}.",
                    "Powering down. Call me when you need me.",
                    "Shutting down. Until next time.",
                ]
            )
            keep_running = False
        elif low in ("reset", "clear memory", "forget everything"):
            self.brain.reset()
            reply = "Conversation memory cleared."
        elif self._pending_note:
            self._pending_note = False
            n = self.skills.notes.add(cleaned)
            reply = f"Noted. You now have {n} note{'s' if n != 1 else ''}."
        else:
            response = self.skills.handle(cleaned)
            if response == "__PROMPT_NOTE__":
                self._pending_note = True
                reply = "What should I note?"
            elif response is not None:
                reply = response
            else:
                # Fall back to the AI brain for open conversation.
                reply = self.brain.think(cleaned)

        if speak and reply is not None:
            self.voice.speak(reply)
        return reply, keep_running

    def process(self, text: str) -> bool:
        """Handle one command (speaking the reply). Returns False to shut down."""
        _, keep_running = self.respond(text, speak=True)
        return keep_running


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
        """Hands-free mode: wait for the wake word, then take a command.

        Prefers the offline Vosk hotword engine (private, no internet). Falls
        back to the online recognizer if Vosk isn't set up.
        """
        self.greet()
        wake = config.WAKE_WORD

        # Try the offline hotword engine first.
        try:
            from .hotword import HotwordListener

            listener = HotwordListener(wake)
        except Exception:
            listener = None

        if listener is not None and listener.available:
            self.voice.speak(f"Offline wake word active. Say '{wake}' to wake me.")
            while True:
                detected = listener.listen_for_wake()
                if not detected:
                    break
                self.voice.speak(
                    random.choice(["Yes?", f"At your service, {config.USER_NAME}.", "Go ahead."])
                )
                command = self.voice.listen(prompt="Listening for your command")
                if command is None:
                    self.voice.speak("I didn't catch that.")
                    continue
                if not self.process(command):
                    break
            return

        if listener is not None and listener.reason_unavailable:
            print(f"{C.GREY}[hotword] offline engine unavailable: "
                  f"{listener.reason_unavailable}{C.RESET}")

        # Fallback: online recognizer polling for the wake word.
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
