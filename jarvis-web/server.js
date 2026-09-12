// JARVIS Web — Express backend.
// Keeps the OpenAI key server-side, proxies weather, exposes a small API the
// browser front-end calls. Everything degrades gracefully with no keys.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import * as lms from "./lms.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  openaiKey: (process.env.OPENAI_API_KEY || "").trim(),
  openaiModel: (process.env.OPENAI_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini",
  assistantName: (process.env.ASSISTANT_NAME || "Jarvis").trim() || "Jarvis",
  userName: (process.env.USER_NAME || "Sir").trim() || "Sir",
  weatherKey: (process.env.OPENWEATHER_API_KEY || "").trim(),
  defaultCity: (process.env.DEFAULT_CITY || "Windhoek").trim() || "Windhoek",
  weatherUnits: (process.env.WEATHER_UNITS || "metric").trim() || "metric",
  // Moodle LMS base URL (e.g. https://elearn.ium.edu.na). Configurable so this
  // works for any Moodle site, not just IUM.
  lmsUrl: (process.env.LMS_URL || "https://elearn.ium.edu.na").trim(),
};

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// --- Simple in-memory conversation store (per-session id from the client) ---
const sessions = new Map();
function getHistory(id) {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
}

const SYSTEM_PROMPT = () =>
  `You are ${CONFIG.assistantName}, a witty, concise voice assistant inspired by ` +
  `Iron Man's J.A.R.V.I.S. You address the user as '${CONFIG.userName}'. Keep ` +
  `answers short and conversational (1-3 sentences) since they are spoken aloud. ` +
  `Be helpful, clever, and to the point. Avoid markdown, lists, or code blocks ` +
  `unless explicitly asked.`;

// ---------------------------------------------------------------- health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ---------------------------------------------------------------- config info
app.get("/api/config", (_req, res) => {
  res.json({
    assistantName: CONFIG.assistantName,
    userName: CONFIG.userName,
    aiOnline: Boolean(CONFIG.openaiKey),
    weatherOnline: Boolean(CONFIG.weatherKey),
    defaultCity: CONFIG.defaultCity,
  });
});

// ---------------------------------------------------------------- weather
app.get("/api/weather", async (req, res) => {
  const city = (req.query.city || CONFIG.defaultCity).toString();
  if (!CONFIG.weatherKey) {
    return res.json({
      ok: false,
      message:
        "Weather isn't configured. Add an OpenWeather API key to the server .env.",
    });
  }
  try {
    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.searchParams.set("q", city);
    url.searchParams.set("appid", CONFIG.weatherKey);
    url.searchParams.set("units", CONFIG.weatherUnits);
    const r = await fetch(url);
    const data = await r.json();
    if (r.status !== 200) {
      return res.json({
        ok: false,
        message: `I couldn't get weather for ${city}: ${data.message || "unknown error"}.`,
      });
    }
    const unit = CONFIG.weatherUnits === "metric" ? "°C" : "°F";
    const text =
      `It's ${Math.round(data.main.temp)}${unit} in ${data.name} with ` +
      `${data.weather[0].description}, feels like ${Math.round(data.main.feels_like)}${unit}.`;
    res.json({ ok: true, text });
  } catch (err) {
    res.json({ ok: false, message: `Weather lookup failed: ${err.message}` });
  }
});

// ---------------------------------------------------------------- wikipedia
app.get("/api/wiki", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json({ ok: false });
  try {
    const r = await fetch(
      "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(q),
      { headers: { "User-Agent": "JarvisWeb/1.0" } }
    );
    if (r.status === 200) {
      const data = await r.json();
      if (data.extract) return res.json({ ok: true, text: data.extract });
    }
    res.json({ ok: false });
  } catch {
    res.json({ ok: false });
  }
});

// ---------------------------------------------------------------- AI chat
app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ ok: false, message: "No message provided." });
  }
  if (!CONFIG.openaiKey) {
    return res.json({
      ok: false,
      offline: true,
      message:
        "My AI service isn't configured, so I can only handle built-in commands. " +
        "Add an OpenAI API key to the server .env for open conversation.",
    });
  }

  const id = (sessionId || "default").toString();
  const history = getHistory(id);
  history.push({ role: "user", content: message });
  while (history.length > 20) history.shift();

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.openaiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.openaiModel,
        temperature: 0.7,
        max_tokens: 300,
        messages: [{ role: "system", content: SYSTEM_PROMPT() }, ...history],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      return res.json({
        ok: false,
        message: `My AI service had a problem: ${data.error?.message || r.statusText}`,
      });
    }
    const answer = (data.choices?.[0]?.message?.content || "").trim();
    history.push({ role: "assistant", content: answer });
    res.json({ ok: true, text: answer || "I'm not sure how to answer that." });
  } catch (err) {
    res.json({ ok: false, message: `AI request failed: ${err.message}` });
  }
});

// Reset a conversation.
app.post("/api/reset", (req, res) => {
  const id = (req.body?.sessionId || "default").toString();
  sessions.delete(id);
  res.json({ ok: true });
});

// ================================================================ LMS (Moodle)
// Legitimate, credential-based integration. The student's own username/password
// are exchanged for a per-user token via Moodle's official Web Services; the
// token is kept SERVER-SIDE and never sent to the browser.

// Reads the opaque LMS session id from the header the client sends.
function lmsSession(req) {
  return (req.get("x-lms-session") || "").trim();
}

function lmsError(res, err) {
  const status = err.code === "NO_SESSION" ? 401 : 400;
  res.status(status).json({ ok: false, message: err.message || "LMS error." });
}

app.get("/api/lms/info", (_req, res) => {
  res.json({ ok: true, lmsUrl: CONFIG.lmsUrl });
});

app.post("/api/lms/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "Enter your username and password." });
  }
  try {
    const { sessionId, user } = await lms.login(CONFIG.lmsUrl, username, password);
    // Return the session id in the body; the client stores it and sends it back
    // in the x-lms-session header. The Moodle token itself never leaves here.
    res.json({ ok: true, sessionId, user });
  } catch (err) {
    lmsError(res, err);
  }
});

app.post("/api/lms/logout", (req, res) => {
  lms.logout(lmsSession(req));
  res.json({ ok: true });
});

app.get("/api/lms/me", (req, res) => {
  const user = lms.getUser(lmsSession(req));
  if (!user) return res.status(401).json({ ok: false, message: "Not logged in." });
  res.json({ ok: true, user });
});

app.get("/api/lms/courses", async (req, res) => {
  try {
    res.json({ ok: true, courses: await lms.getCourses(lmsSession(req)) });
  } catch (err) {
    lmsError(res, err);
  }
});

app.get("/api/lms/courses/:id/contents", async (req, res) => {
  try {
    res.json({ ok: true, sections: await lms.getCourseContents(lmsSession(req), req.params.id) });
  } catch (err) {
    lmsError(res, err);
  }
});

app.get("/api/lms/assignments", async (req, res) => {
  try {
    res.json({ ok: true, assignments: await lms.getAssignments(lmsSession(req)) });
  } catch (err) {
    lmsError(res, err);
  }
});

app.get("/api/lms/courses/:id/grades", async (req, res) => {
  try {
    res.json({ ok: true, grades: await lms.getGrades(lmsSession(req), req.params.id) });
  } catch (err) {
    lmsError(res, err);
  }
});

app.get("/api/lms/calendar", async (req, res) => {
  try {
    res.json({ ok: true, events: await lms.getCalendar(lmsSession(req)) });
  } catch (err) {
    lmsError(res, err);
  }
});

// Single sign-on redirect: mints a Moodle autologin key for THIS student and
// 302-redirects the browser straight into the real site, already logged in.
// The session id comes as a query param because this is a top-level navigation
// (a normal link/window.open, which can't set custom headers). The key is
// short-lived and single-use; the WS token still never leaves the server.
app.get("/api/lms/sso", async (req, res) => {
  const sid = (req.query.s || "").toString();
  const urltogo = (req.query.to || "").toString();
  try {
    const { url } = await lms.getAutologinUrl(sid, urltogo);
    res.redirect(url);
  } catch (err) {
    const status = err.code === "NO_SESSION" ? 401 : 502;
    res
      .status(status)
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>Sign-in</title>` +
          `<body style="font-family:system-ui;background:#160812;color:#f6e9f1;` +
          `display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px">` +
          `<div><h2>Couldn't open the portal signed in</h2>` +
          `<p style="opacity:.8;max-width:34rem">${(err.message || "Please try again.")
            .replace(/[<>&]/g, "")}</p>` +
          `<p><a style="color:#e94bb2" href="${CONFIG.lmsUrl}/login/index.php">Open the login page instead ↗</a></p>` +
          `</div></body>`
      );
  }
});

// Read one module's content (Page HTML, URL link, description) for in-app view.
app.get("/api/lms/courses/:id/modules/:cmid", async (req, res) => {
  try {
    const content = await lms.getModuleContent(
      lmsSession(req),
      req.params.id,
      req.params.cmid,
      (req.query.modname || "").toString()
    );
    res.json({ ok: true, content });
  } catch (err) {
    lmsError(res, err);
  }
});

// Stream a course file through the backend (keeps the token server-side).
app.get("/api/lms/download", async (req, res) => {
  const fileUrl = (req.query.url || "").toString();
  if (!fileUrl) return res.status(400).json({ ok: false, message: "No file URL." });
  try {
    await lms.proxyFile(lmsSession(req), fileUrl, res);
  } catch (err) {
    lmsError(res, err);
  }
});

// ---- Resources bridge: the student's real Moodle materials, grouped by course.
app.get("/api/lms/resources", async (req, res) => {
  try {
    res.json({ ok: true, courses: await lms.getAllResources(lmsSession(req)) });
  } catch (err) {
    lmsError(res, err);
  }
});

// ---- Announcements bridge: posts from each course's announcements forum.
app.get("/api/lms/announcements", async (req, res) => {
  try {
    res.json({ ok: true, announcements: await lms.getAnnouncements(lmsSession(req)) });
  } catch (err) {
    lmsError(res, err);
  }
});

// SPA fallback.
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(CONFIG.port, "0.0.0.0", () => {
  console.log(`\n  ◆ JARVIS Web running on http://0.0.0.0:${CONFIG.port}`);
  console.log(
    `  AI: ${CONFIG.openaiKey ? "online" : "offline (built-in commands only)"} · ` +
      `Weather: ${CONFIG.weatherKey ? "online" : "off"} · ` +
      `LMS: ${CONFIG.lmsUrl}\n`
  );
});
