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
- 📚 **Portal tab** — a native **LMS dashboard** for the Moodle-based IUM
  e-Learning site. Students sign in with **their own credentials**; the backend
  exchanges them for a token via Moodle's **official Web Services** and shows
  their **courses, course materials (with downloads), assignments, and upcoming
  events**. See "LMS integration" below for the security model.
- 🌐 **Browser tab** — an **in-app browser (webview)** with real browser chrome
  (back / forward / reload / home), an editable **address bar**, and quick-link
  bookmarks stepping from the **IUM Portal** (elearn.ium.edu.na) to the
  **official IUM website** (ium.edu.na) and the **portal login**. A loading
  spinner and a graceful "open in a new tab" fallback handle sites that block
  embedding.

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

## 📚 LMS integration (Moodle) — how it works & security

The **Portal** tab is a legitimate Moodle client. It uses **Moodle's official
Web Services API** — the same mechanism the official Moodle Mobile app uses.

**The security model (important):**

1. The student enters **their own** username + password in the Portal tab.
2. The browser sends them **once** to our backend, which calls Moodle's
   `/login/token.php` to obtain a **per-user token**.
3. That token is stored **server-side only**, keyed to an opaque random session
   id. The browser only ever holds the session id — **never the Moodle token,
   and never the password again**.
4. Every data call (courses, assignments, grades, files) uses the server-side
   token, so the browser only ever receives **that student's own** data.
5. File downloads are **proxied through the backend** so the token isn't exposed
   in file URLs.

**What this project deliberately does NOT do:**

- ❌ No hardcoded API keys, tokens, or service-account secrets.
- ❌ No password formulas / no harvesting or storing of student passwords.
- ❌ No attempt to bypass authentication or embedding protections.

**Requirements for live data:** the Moodle site must have **Web Services**
enabled with the **mobile service** turned on (the default on most Moodle
installs). If a school has disabled it, login fails cleanly with a message —
nothing is bypassed. Point the app at any Moodle site with `LMS_URL` in `.env`
(defaults to `https://elearn.ium.edu.na`).

> Note: this is the correct, authorized-integration approach. For a production
> deployment at a university, the institution would typically also provide an
> official API/SSO arrangement; this client works with standard Moodle Web
> Services out of the box and respects whatever the site permits.

### LMS API (backend routes)

| Route | Returns |
| --- | --- |
| `POST /api/lms/login` | Exchanges credentials for a server-side session. |
| `POST /api/lms/logout` | Ends the session, drops the token. |
| `GET /api/lms/me` | Current student profile. |
| `GET /api/lms/courses` | Enrolled courses. |
| `GET /api/lms/courses/:id/contents` | Sections, modules, and files. |
| `GET /api/lms/courses/:id/grades` | Grades for a course. |
| `GET /api/lms/assignments` | Assignments across courses (soonest due first). |
| `GET /api/lms/calendar` | Upcoming events. |
| `GET /api/lms/download?url=…` | Proxies a course file (token stays server-side). |

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
