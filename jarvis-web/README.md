# 🤖 JARVIS Web — Browser Voice Assistant

A powerful, fully-functional **web app** version of JARVIS. It runs in any modern
browser, **talks and listens** using the built-in Web Speech API (no installs,
no drivers), and keeps your API keys safe on a small Node/Express backend.

Inspired by Iron Man's J.A.R.V.I.S. with a neon aesthetic.

---

## ✨ Features

- 🎙️ **Voice in & out** — tap the glowing orb (or the 🎤 button) and speak;
  Jarvis replies out loud. Toggle voice output with 🔊/🔇.
- 🗣️ **"Hey Jarvis" wake word** — flip the **wake** chip on for continuous
  hands-free listening; say *"Hey Jarvis, what's the weather"* with no tapping.
- 📲 **Installable PWA** — install to your phone/desktop home screen and launch
  it like a native app; the shell works offline.
- 💬 **AI conversation** — free-form answers via OpenAI (key stays server-side).
- 🧮 **Built-in skills** (instant, offline, in the browser):
  time · date · math · timers/reminders · notes (saved in your browser) ·
  coin flip · dice · jokes · web search · open sites · play music.
- 🌦️ **Live weather** (via the server) and 📚 **Wikipedia** lookups.
- 📱 **Responsive** — works on desktop and mobile.
- 🕹️ **Suggestion chips** to get started fast.
- 🎓 **IUM tab** — a second tab that embeds the **International University of
  Management** e-Learning portal (elearn.ium.edu.na) with reload / open-in-new-tab
  controls and a graceful fallback link if the site blocks embedding.

> **Browser support:** voice input uses the Web Speech API, best in
> **Chrome/Edge** (and Safari). If a browser lacks it, Jarvis automatically
> switches to type-only — everything still works.
>
> **HTTPS note:** browsers only grant microphone access on `localhost` or over
> **HTTPS**. Locally you're fine; when deployed, use one of the hosts below
> (they all provide HTTPS automatically).

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

## 🗣️ Wake word ("Hey Jarvis")

Click the **wake** chip in the top bar (or say it's on). Jarvis then listens
continuously and activates when it hears **"Hey Jarvis"** (or just "Jarvis").
You can speak the command in the same breath — *"Jarvis, set a timer for two
minutes"* — or say the wake word alone and Jarvis will prompt and capture your
next sentence. It automatically pauses its own listening while speaking so it
never triggers on itself.

> Needs the Web Speech API (Chrome/Edge desktop work best). The mic must be
> allowed. Some browsers throttle very long continuous sessions; Jarvis
> auto-restarts the recognizer to keep listening.

## 📲 Install as an app (PWA)

- **Desktop (Chrome/Edge):** click the **⤓ install** chip, or the install icon
  in the address bar.
- **iOS Safari:** Share → *Add to Home Screen*.
- **Android Chrome:** menu → *Install app*.

The app shell (HTML/CSS/JS/icons) is cached by a service worker, so it loads
instantly and opens offline (built-in skills keep working; AI/weather need a
connection).

## 🚀 Deploy it publicly

The repo ships with ready-to-use configs:

- **Render** — `render.yaml` blueprint. On render.com: *New → Blueprint →* pick
  this repo, then add `OPENAI_API_KEY` / `OPENWEATHER_API_KEY` as secrets.
  Health check: `/api/health`.
- **Railway** — `railway.json`. Create a project from the repo; set env vars in
  the dashboard. (Set the root directory to `jarvis-web`.)
- **Docker / anywhere** — `Dockerfile` included:
  ```bash
  docker build -t jarvis-web ./jarvis-web
  docker run -p 3000:3000 --env-file jarvis-web/.env jarvis-web
  ```

Any Node host works too (Fly.io, Heroku, a VPS): run `npm install && npm start`
with the env vars set. HTTPS is required for the microphone on remote hosts —
all the platforms above provide it automatically.

## 🧱 Project structure

```
jarvis-web/
├── server.js          # Express backend: AI, weather, wiki proxy + static host
├── package.json
├── Dockerfile         # container image
├── render.yaml        # Render blueprint
├── railway.json       # Railway config
├── .env.example       # copy to .env
└── public/
    ├── index.html     # app shell (PWA meta + manifest)
    ├── styles.css     # neon UI
    ├── app.js         # voice I/O, wake word, orb, chat, client-side skills
    ├── manifest.webmanifest
    ├── sw.js          # service worker (offline shell cache)
    └── icons/         # PWA icons (192, 512, maskable)
```

## 🧩 How it works

- **Skills run in the browser** first (fast, private) via a router in `app.js`.
- Only **AI chat, weather, and Wikipedia** hit the server, so your keys and any
  paid API calls stay controlled server-side.
- Conversation memory is kept per browser session on the server; notes are saved
  in `localStorage`.

Built with Node, Express, and the Web Speech API. Say *"Jarvis, tell me a joke."*
