# 🤖 JARVIS Web — Browser Voice Assistant

A powerful, fully-functional **web app** version of JARVIS. It runs in any modern
browser, **talks and listens** using the built-in Web Speech API (no installs,
no drivers), and keeps your API keys safe on a small Node/Express backend.

Inspired by Iron Man's J.A.R.V.I.S. and styled to match the DUX Capital neon
aesthetic.

---

## ✨ Features

- 🎙️ **Voice in & out** — tap the glowing orb (or the 🎤 button) and speak;
  Jarvis replies out loud. Toggle voice output with 🔊/🔇.
- 💬 **AI conversation** — free-form answers via OpenAI (key stays server-side).
- 🧮 **Built-in skills** (instant, offline, in the browser):
  time · date · math · timers/reminders · notes (saved in your browser) ·
  coin flip · dice · jokes · web search · open sites · play music.
- 🌦️ **Live weather** (via the server) and 📚 **Wikipedia** lookups.
- 📱 **Responsive** — works on desktop and mobile.
- 🕹️ **Suggestion chips** to get started fast.

> **Browser support:** voice input uses the Web Speech API, best in
> **Chrome/Edge** (and Safari). If a browser lacks it, Jarvis automatically
> switches to type-only — everything still works.

---

## 🚀 Quick start

```bash
cd jarvis-web
npm install

# optional: enable AI + weather
cp .env.example .env      # then add your keys

npm start                 # → http://localhost:3000
```

Open the URL, allow microphone access, and start talking.

---

## ⚙️ Configuration (`.env`)

All optional — the app runs with built-in commands even with an empty config.

| Key | Purpose |
| --- | --- |
| `PORT` | Server port (default `3000`). |
| `OPENAI_API_KEY` | Enables smart AI conversation. |
| `OPENAI_MODEL` | Model name (default `gpt-4o-mini`). |
| `ASSISTANT_NAME` / `USER_NAME` | Persona names. |
| `OPENWEATHER_API_KEY` | Enables live weather. |
| `DEFAULT_CITY` / `WEATHER_UNITS` | Weather defaults (`metric`/`imperial`). |

Keys live **only on the server** — the browser never sees them; it calls
`/api/chat` and `/api/weather`, which the server proxies.

---

## 🗣️ Things to try

- "What time is it?" · "What's the date?"
- "What is 15% of 240" · "Calculate 12 * (3 + 4)"
- "Weather in Tokyo"
- "Who is Nikola Tesla" · "Tell me about black holes"
- "Set a timer for 2 minutes" · "Remind me to stretch in 30 seconds"
- "Take a note buy milk" · "Read my notes"
- "Play lofi beats" · "Play Bohemian Rhapsody on spotify"
- "Open github" · "Search for pasta recipes"
- "Flip a coin" · "Roll a d20" · "Tell me a joke"
- Anything else → answered by the AI brain (needs a key).

---

## 🧱 Project structure

```
jarvis-web/
├── server.js          # Express backend: AI, weather, wiki proxy + static host
├── package.json
├── .env.example       # copy to .env
└── public/
    ├── index.html     # app shell
    ├── styles.css     # neon UI
    └── app.js         # voice I/O, orb, chat, client-side skills
```

## 🧩 How it works

- **Skills run in the browser** first (fast, private) via a router in `app.js`.
- Only **AI chat, weather, and Wikipedia** hit the server, so your keys and any
  paid API calls stay controlled server-side.
- Conversation memory is kept per browser session on the server; notes are saved
  in `localStorage`.

Built with Node, Express, and the Web Speech API. Say *"Jarvis, tell me a joke."*
