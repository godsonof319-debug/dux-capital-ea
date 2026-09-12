"""A desktop GUI window for Jarvis, built on tkinter (no extra pip deps).

Features:
  * Scrolling chat transcript (you vs. Jarvis), color-coded.
  * Text entry + Send button.
  * 🎤 Speak button — captures one voice command (uses the VoiceEngine).
  * Hands-free toggle — offline wake-word listening in the background (Vosk),
    falling back to nothing if Vosk isn't configured.
  * All heavy work runs on worker threads so the UI never freezes.

tkinter ships with standard Python on Windows and macOS. On Linux install it
with `sudo apt install python3-tk`.
"""

from __future__ import annotations

import queue
import threading
from typing import Optional

from .assistant import Assistant
from .config import config

try:
    import tkinter as tk
    from tkinter import scrolledtext

    _HAS_TK = True
except Exception:  # pragma: no cover
    _HAS_TK = False


# Neon-on-dark palette for the Jarvis aesthetic.
BG = "#0A0612"
PANEL = "#150C22"
TEXT = "#F4EEFA"
MUTED = "#A99BC2"
PINK = "#F14BB2"
PINK2 = "#FF8AD4"
PURPLE = "#9B5DE5"
GREEN = "#3FE0A5"


def gui_available() -> bool:
    return _HAS_TK


class JarvisGUI:
    def __init__(self, assistant: Optional[Assistant] = None) -> None:
        if not _HAS_TK:
            raise RuntimeError(
                "tkinter is not available. Install it (Linux: sudo apt install "
                "python3-tk) or run Jarvis in the terminal instead."
            )
        # Force text-mode speak-through-GUI: the assistant still voices replies
        # if TTS is enabled, but we always render them in the window too.
        self.assistant = assistant or Assistant()
        self._ui_queue: "queue.Queue[tuple[str, str]]" = queue.Queue()
        self._listening_hotword = False
        self._hotword_thread: Optional[threading.Thread] = None
        self._stop_hotword = threading.Event()

        self._build_window()
        self._poll_ui_queue()
        self._append("system", f"{config.ASSISTANT_NAME} online. Type a message, "
                               f"press 🎤 to speak, or enable hands-free.")

    # ------------------------------------------------------------------ build
    def _build_window(self) -> None:
        self.root = tk.Tk()
        self.root.title(f"{config.ASSISTANT_NAME} — Personal Assistant")
        self.root.geometry("640x680")
        self.root.configure(bg=BG)
        self.root.minsize(480, 460)

        # Header
        header = tk.Frame(self.root, bg=BG)
        header.pack(fill="x", padx=18, pady=(16, 8))
        tk.Label(
            header, text=f"◆ {config.ASSISTANT_NAME.upper()}",
            font=("Segoe UI", 20, "bold"), fg=PINK, bg=BG,
        ).pack(side="left")
        self.status_var = tk.StringVar(value=self._status_text())
        tk.Label(
            header, textvariable=self.status_var,
            font=("Consolas", 9), fg=MUTED, bg=BG,
        ).pack(side="right", pady=(10, 0))

        # Transcript
        self.log = scrolledtext.ScrolledText(
            self.root, wrap="word", state="disabled",
            bg=PANEL, fg=TEXT, insertbackground=TEXT,
            font=("Segoe UI", 11), relief="flat", padx=14, pady=12,
            borderwidth=0,
        )
        self.log.pack(fill="both", expand=True, padx=18, pady=8)
        self.log.tag_config("you", foreground=GREEN, font=("Segoe UI", 11, "bold"))
        self.log.tag_config("you_msg", foreground=TEXT)
        self.log.tag_config("jarvis", foreground=PINK2, font=("Segoe UI", 11, "bold"))
        self.log.tag_config("jarvis_msg", foreground=TEXT)
        self.log.tag_config("system", foreground=MUTED, font=("Segoe UI", 9, "italic"))

        # Input row
        row = tk.Frame(self.root, bg=BG)
        row.pack(fill="x", padx=18, pady=(4, 8))

        self.entry = tk.Entry(
            row, bg=PANEL, fg=TEXT, insertbackground=PINK,
            font=("Segoe UI", 12), relief="flat",
        )
        self.entry.pack(side="left", fill="x", expand=True, ipady=8, padx=(0, 8))
        self.entry.bind("<Return>", lambda _e: self._on_send())
        self.entry.focus_set()

        self.send_btn = tk.Button(
            row, text="Send", command=self._on_send,
            bg=PINK, fg="#1a0a14", activebackground=PINK2,
            font=("Segoe UI", 11, "bold"), relief="flat", padx=16, cursor="hand2",
        )
        self.send_btn.pack(side="left", padx=(0, 6))

        self.mic_btn = tk.Button(
            row, text="🎤", command=self._on_mic,
            bg=PURPLE, fg="#ffffff", activebackground="#B07FF0",
            font=("Segoe UI", 12, "bold"), relief="flat", padx=12, cursor="hand2",
        )
        self.mic_btn.pack(side="left")

        # Footer controls
        footer = tk.Frame(self.root, bg=BG)
        footer.pack(fill="x", padx=18, pady=(0, 14))
        self.hotword_var = tk.BooleanVar(value=False)
        self.hotword_chk = tk.Checkbutton(
            footer, text=f"Hands-free (say '{config.WAKE_WORD}')",
            variable=self.hotword_var, command=self._toggle_hotword,
            bg=BG, fg=MUTED, selectcolor=PANEL, activebackground=BG,
            activeforeground=PINK2, font=("Segoe UI", 10),
            highlightthickness=0, cursor="hand2",
        )
        self.hotword_chk.pack(side="left")
        tk.Button(
            footer, text="Clear", command=self._clear_log,
            bg=PANEL, fg=MUTED, activebackground="#241533",
            font=("Segoe UI", 9), relief="flat", padx=10, cursor="hand2",
        ).pack(side="right")

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _status_text(self) -> str:
        ai = "AI: online" if self.assistant.brain.online else "AI: offline"
        return f"{self.assistant.voice.status_line()} · {ai}"

    # ------------------------------------------------------------------ chat io
    def _append(self, who: str, message: str) -> None:
        self.log.configure(state="normal")
        if who == "you":
            self.log.insert("end", "You  ", "you")
            self.log.insert("end", message + "\n\n", "you_msg")
        elif who == "jarvis":
            self.log.insert("end", f"{config.ASSISTANT_NAME}  ", "jarvis")
            self.log.insert("end", message + "\n\n", "jarvis_msg")
        else:
            self.log.insert("end", message + "\n\n", "system")
        self.log.configure(state="disabled")
        self.log.see("end")

    def _clear_log(self) -> None:
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

    def _poll_ui_queue(self) -> None:
        """Drain messages posted from worker threads onto the UI thread."""
        try:
            while True:
                who, msg = self._ui_queue.get_nowait()
                if who == "__quit__":
                    self.root.destroy()
                    return
                if who == "__mic_done__":
                    self.mic_btn.configure(text="🎤", state="normal")
                    continue
                self._append(who, msg)
        except queue.Empty:
            pass
        self.root.after(80, self._poll_ui_queue)

    def _post(self, who: str, msg: str) -> None:
        self._ui_queue.put((who, msg))

    # ------------------------------------------------------------------ actions
    def _on_send(self) -> None:
        text = self.entry.get().strip()
        if not text:
            return
        self.entry.delete(0, "end")
        self._append("you", text)
        threading.Thread(target=self._respond, args=(text,), daemon=True).start()

    def _respond(self, text: str) -> None:
        reply, keep_running = self.assistant.respond(text, speak=True)
        if reply:
            self._post("jarvis", reply)
        if not keep_running:
            self._post("__quit__", "")

    def _on_mic(self) -> None:
        if not self.assistant.voice.can_listen:
            self._append("system", "No microphone available. Type your command instead.")
            return
        self.mic_btn.configure(text="…", state="disabled")
        threading.Thread(target=self._mic_worker, daemon=True).start()

    def _mic_worker(self) -> None:
        text = self.assistant.voice.listen(prompt="Listening")
        self._ui_queue.put(("__mic_done__", ""))
        if not text:
            self._post("system", "I didn't catch that.")
            return
        self._post("you", text)
        self._respond(text)

    # ------------------------------------------------------------------ hotword
    def _toggle_hotword(self) -> None:
        if self.hotword_var.get():
            self._start_hotword()
        else:
            self._stop_hotword_thread()

    def _start_hotword(self) -> None:
        try:
            from .hotword import HotwordListener
        except Exception:
            self._append("system", "Hotword engine unavailable.")
            self.hotword_var.set(False)
            return
        listener = HotwordListener(config.WAKE_WORD)
        if not listener.available:
            self._append("system", f"Hands-free unavailable: {listener.reason_unavailable}")
            self.hotword_var.set(False)
            return
        self._stop_hotword.clear()
        self._append("system", f"Hands-free on. Say '{config.WAKE_WORD}'…")

        def _loop() -> None:
            while not self._stop_hotword.is_set():
                detected = listener.listen_for_wake(should_stop=self._stop_hotword.is_set)
                if not detected:
                    break
                self._post("system", "Wake word detected — listening…")
                cmd = self.assistant.voice.listen(prompt="Listening")
                if cmd:
                    self._post("you", cmd)
                    self._respond(cmd)
                else:
                    self._post("system", "I didn't catch that.")

        self._hotword_thread = threading.Thread(target=_loop, daemon=True)
        self._hotword_thread.start()

    def _stop_hotword_thread(self) -> None:
        self._stop_hotword.set()
        self._append("system", "Hands-free off.")

    # ------------------------------------------------------------------ lifecycle
    def _on_close(self) -> None:
        self._stop_hotword.set()
        self.root.destroy()

    def run(self) -> None:
        # Voice the greeting in the window.
        self._post("jarvis", f"Hello {config.USER_NAME}. How can I help?")
        self.root.mainloop()
