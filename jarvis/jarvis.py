#!/usr/bin/env python3
"""JARVIS — a powerful, fully-functional personal voice assistant.

Usage:
    python jarvis.py                 # interactive (speak or type)
    python jarvis.py --gui           # desktop window (chat + mic + hands-free)
    python jarvis.py --wake          # hands-free, offline wake-word mode
    python jarvis.py --text          # force text-only (no voice output)
    python jarvis.py --once "time"   # run a single command and exit

Configuration lives in a `.env` file (copy `.env.example` to `.env`).
"""

from __future__ import annotations

import argparse
import sys

from core.assistant import Assistant
from core.config import config
from core.speech import C


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="jarvis",
        description="JARVIS — your personal voice assistant.",
    )
    p.add_argument(
        "--gui",
        action="store_true",
        help="Launch the desktop GUI window (chat, mic button, hands-free toggle).",
    )
    p.add_argument(
        "--wake",
        action="store_true",
        help="Hands-free mode: wait for the wake word before each command "
        "(offline via Vosk if configured).",
    )
    p.add_argument(
        "--text",
        action="store_true",
        help="Disable spoken output (text only).",
    )
    p.add_argument(
        "--once",
        metavar="COMMAND",
        help="Run a single command, print/speak the result, then exit.",
    )
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    if args.text:
        # Override before the assistant/voice engine initializes fully.
        config.VOICE_ENABLED = False

    try:
        assistant = Assistant()
    except Exception as exc:  # pragma: no cover
        print(f"{C.YELLOW}Failed to start Jarvis: {exc}{C.RESET}", file=sys.stderr)
        return 1

    try:
        if args.once:
            assistant.run_once(args.once)
        elif args.gui:
            try:
                from core.gui import JarvisGUI, gui_available
            except Exception as exc:
                print(f"{C.YELLOW}GUI unavailable: {exc}{C.RESET}", file=sys.stderr)
                return 1
            if not gui_available():
                print(
                    f"{C.YELLOW}tkinter is not installed. On Linux run "
                    f"'sudo apt install python3-tk', or use the terminal mode.{C.RESET}",
                    file=sys.stderr,
                )
                return 1
            JarvisGUI(assistant).run()
        elif args.wake:
            assistant.run_wake_loop()
        else:
            assistant.run_text_loop()
    except KeyboardInterrupt:
        print()
        assistant.voice.speak("Interrupted. Goodbye.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
