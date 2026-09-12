"""The AI 'brain' — free-form conversational answers via OpenAI.

If no API key is configured (or the openai package isn't installed), the brain
falls back to a small offline responder so Jarvis still holds a basic
conversation and never hard-crashes.
"""

from __future__ import annotations

from typing import List, Dict

from .config import config

try:
    from openai import OpenAI  # type: ignore

    _HAS_OPENAI = True
except Exception:  # pragma: no cover
    _HAS_OPENAI = False


SYSTEM_PROMPT = (
    "You are {name}, a witty, concise voice assistant inspired by Iron Man's "
    "J.A.R.V.I.S. You address the user as '{user}'. Keep answers short and "
    "conversational (1-3 sentences) since they are spoken aloud. Be helpful, "
    "clever, and to the point. Avoid markdown, lists, or code blocks unless "
    "explicitly asked."
)


class Brain:
    def __init__(self) -> None:
        self._client = None
        self._history: List[Dict[str, str]] = []
        self.online = False

        if config.has_ai() and _HAS_OPENAI:
            try:
                self._client = OpenAI(api_key=config.OPENAI_API_KEY)
                self.online = True
            except Exception:  # pragma: no cover
                self._client = None
                self.online = False

        self._system = {
            "role": "system",
            "content": SYSTEM_PROMPT.format(
                name=config.ASSISTANT_NAME, user=config.USER_NAME
            ),
        }

    def think(self, prompt: str) -> str:
        """Return a conversational reply to `prompt`."""
        if self.online and self._client is not None:
            return self._ask_openai(prompt)
        return self._offline_reply(prompt)

    # ------------------------------------------------------------------ online
    def _ask_openai(self, prompt: str) -> str:
        self._history.append({"role": "user", "content": prompt})
        # Keep only the last ~10 exchanges to bound token usage.
        self._history = self._history[-20:]
        messages = [self._system] + self._history
        try:
            resp = self._client.chat.completions.create(
                model=config.OPENAI_MODEL,
                messages=messages,
                temperature=0.7,
                max_tokens=300,
            )
            answer = (resp.choices[0].message.content or "").strip()
            self._history.append({"role": "assistant", "content": answer})
            return answer or "I'm not sure how to answer that."
        except Exception as exc:  # pragma: no cover
            return f"My AI service had a problem: {exc}"

    # ------------------------------------------------------------------ offline
    def _offline_reply(self, prompt: str) -> str:
        p = prompt.lower().strip()
        greetings = ("hello", "hi", "hey", "greetings")
        if any(p.startswith(g) for g in greetings):
            return f"Hello {config.USER_NAME}. How can I help?"
        if "how are you" in p:
            return "Operating at full capacity, thank you."
        if "who are you" in p or "your name" in p:
            return f"I am {config.ASSISTANT_NAME}, your personal assistant."
        if "thank" in p:
            return "You're welcome."
        if p.endswith("?"):
            return (
                "I can't reach my AI service right now, so I can only handle "
                "built-in commands. Add an OpenAI API key to enable smart answers."
            )
        return (
            "I didn't quite catch a command there. Try 'help' to see what I can do, "
            "or add an AI key for open conversation."
        )

    def reset(self) -> None:
        self._history.clear()
