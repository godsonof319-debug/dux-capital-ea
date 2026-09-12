# 🤖 JARVIS — Personal Voice Assistant

A powerful, fully-functional desktop voice assistant written in Python, inspired
by Iron Man's J.A.R.V.I.S. It **listens**, **talks back**, runs a set of built-in
**task commands**, and can hold an **open AI conversation** when you plug in an
OpenAI API key.

Everything degrades gracefully: no microphone? It reads typed input. No TTS
engine? It prints its replies. No AI key? It still runs all built-in commands.
So it works on *any* machine, right out of the box.

---

## ✨ Features

| Category | What you can say |
| --- | --- |
| 🕐 Time & date | *"what time is it"*, *"what's the date"* |
| 🧮 Math | *"what is 12 * (3 + 4)"*, *"calculate 45 divided by 9"* |
| 🌦️ Weather | *"weather"*, *"what's the weather in Tokyo"* *(needs free API key)* |
| 📚 Knowledge | *"who is Nikola Tesla"*, *"tell me about black holes"* (Wikipedia) |
| 🔎 Web | *"search for best pizza recipe"*, *"google python tutorials"* |
| 🌐 Open sites | *"open youtube"*, *"open github"*, *"go to wikipedia"* |
| 💻 Open apps | *"open calculator"*, *"open notepad"*, *"open terminal"* |
| 📝 Notes | *"take a note buy milk"*, *"read my notes"*, *"clear notes"* |
| ⏲️ Timers | *"set a timer for 5 minutes"*, *"remind me to stretch in 30 seconds"* |
| 🖥️ System | *"system info"*, *"battery"*, *"cpu"* *(needs psutil)* |
| 🎲 Fun | *"flip a coin"*, *"roll a d20"*, *"tell me a joke"* |
| 💬 Chat | Anything else → answered by the AI brain *(needs API key)* |
| 🚪 Exit | *"exit"*, *"goodbye"*, *"shut down"* |

---

## 🚀 Quick start

```bash
cd jarvis

# 1. (Recommended) create a virtual environment
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure (optional but recommended)
cp .env.example .env      # Windows: copy .env.example .env
#   then edit .env and add your OpenAI / OpenWeather keys

# 4. Run
python jarvis.py
```

That's it. Speak or type a command when prompted.

---

## 🎛️ Run modes

```bash
python jarvis.py                  # interactive: speak OR type each command
python jarvis.py --wake           # hands-free: say the wake word first
python jarvis.py --text           # text-only (disable spoken output)
python jarvis.py --once "weather" # run one command and exit (great for scripts)
```

In **wake mode**, say the wake word (default `jarvis`) and then your command —
or say them together: *"jarvis, what's the weather"*.

---

## ⚙️ Configuration (`.env`)

Copy `.env.example` → `.env` and edit. All keys are optional; sensible defaults
apply.

| Key | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Enables smart, free-form conversation. Get one at platform.openai.com. |
| `OPENAI_MODEL` | Model name (default `gpt-4o-mini`). |
| `ASSISTANT_NAME` | What the assistant calls itself (default `Jarvis`). |
| `USER_NAME` | What it calls you (default `Sir`). |
| `WAKE_WORD` | Wake word for `--wake` mode (default `jarvis`). |
| `VOICE_ENABLED` | `1` to speak aloud, `0` for text only. |
| `TTS_RATE` / `TTS_VOLUME` / `TTS_VOICE` | Voice tuning. |
| `OPENWEATHER_API_KEY` | Enables live weather. Free at openweathermap.org. |
| `DEFAULT_CITY` / `WEATHER_UNITS` | Weather defaults (`metric` or `imperial`). |

---

## 🔌 Installing the microphone (PyAudio)

Voice input needs PyAudio. If `pip install pyaudio` fails:

- **Windows:** `pip install pipwin && pipwin install pyaudio`
- **macOS:** `brew install portaudio && pip install pyaudio`
- **Linux (Debian/Ubuntu):** `sudo apt install portaudio19-dev python3-pyaudio && pip install pyaudio`

No microphone? No problem — Jarvis automatically falls back to keyboard input.

---

## 🧱 Project structure

```
jarvis/
├── jarvis.py            # entry point / CLI
├── requirements.txt
├── .env.example         # copy to .env
├── core/
│   ├── config.py        # settings & .env loading
│   ├── speech.py        # text-to-speech + speech-to-text (with fallbacks)
│   ├── brain.py         # OpenAI conversation (offline fallback included)
│   ├── skills.py        # all built-in task commands
│   └── assistant.py     # orchestration + main loops
└── data/                # notes and local state (git-ignored)
```

## 🧩 Extending Jarvis

Add a method to `core/skills.py` that returns a string when it matches (or
`None` to pass), then register it in `Skills.__init__`'s `self.handlers` list.
The assistant tries skills in order and falls back to the AI brain if none match.

---

Made with ❤️ in Python. Say *"jarvis, tell me a joke"* to get started.
