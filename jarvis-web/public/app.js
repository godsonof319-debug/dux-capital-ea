/* JARVIS Web — front-end logic.
   Handles voice input/output (Web Speech API), the animated orb, the chat UI,
   client-side skills, and calls to the server for AI, weather, and Wikipedia. */

(() => {
  "use strict";

  // ------------------------------------------------------------ DOM refs
  const el = {
    chat: document.getElementById("chat"),
    input: document.getElementById("input"),
    composer: document.getElementById("composer"),
    micBtn: document.getElementById("micBtn"),
    orbMicBtn: document.getElementById("orb"),
    muteBtn: document.getElementById("muteBtn"),
    clearBtn: document.getElementById("clearBtn"),
    orb: document.getElementById("orb"),
    orbHint: document.getElementById("orbHint"),
    suggestions: document.getElementById("suggestions"),
    brandName: document.getElementById("brandName"),
    chipAI: document.getElementById("chipAI"),
    chipVoice: document.getElementById("chipVoice"),
    wakeChip: document.getElementById("wakeChip"),
    installChip: document.getElementById("installChip"),
    footNote: document.getElementById("footNote"),
  };

  // ------------------------------------------------------------ state
  const state = {
    assistantName: "Jarvis",
    userName: "Sir",
    aiOnline: false,
    weatherOnline: false,
    defaultCity: "Windhoek",
    voiceOut: true,
    sessionId: "s_" + Math.random().toString(36).slice(2),
    pendingNote: false,
    listening: false,
    wakeOn: false,
    wakeActive: false, // true while capturing a command after the wake word
    busy: false, // thinking or speaking
  };
  const WAKE_RE = /\b(hey )?jarvis\b/i;

  const notes = JSON.parse(localStorage.getItem("jarvis_notes") || "[]");
  const saveNotes = () =>
    localStorage.setItem("jarvis_notes", JSON.stringify(notes));

  // ------------------------------------------------------------ chat UI
  function addMsg(text, who) {
    const div = document.createElement("div");
    div.className = "msg " + who;
    if (who === "bot") {
      const w = document.createElement("span");
      w.className = "who";
      w.textContent = state.assistantName;
      div.appendChild(w);
      div.appendChild(document.createTextNode(text));
    } else if (who === "system") {
      div.textContent = text;
    } else {
      div.textContent = text;
    }
    el.chat.appendChild(div);
    el.chat.scrollTop = el.chat.scrollHeight;
    return div;
  }

  // ------------------------------------------------------------ orb state
  function setOrb(mode, hint) {
    el.orb.classList.remove("listening", "thinking", "speaking");
    if (mode) el.orb.classList.add(mode);
    if (hint !== undefined) el.orbHint.textContent = hint;
  }

  // ------------------------------------------------------------ TTS
  let voices = [];
  function loadVoices() {
    voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  }
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function speak(text) {
    if (!state.voiceOut || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.03;
      u.pitch = 1.0;
      // Prefer a clear English voice.
      const pick =
        voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|arthur/i.test(v.name)) ||
        voices.find((v) => /en/i.test(v.lang)) ||
        voices[0];
      if (pick) u.voice = pick;
      // Pause the wake listener while speaking so Jarvis doesn't hear itself.
      wake.pause();
      u.onstart = () => setOrb("speaking", "Speaking…");
      u.onend = () => {
        setOrb(state.wakeOn ? null : null, state.wakeOn ? `Listening for “hey ${state.assistantName.toLowerCase()}”` : "Tap the orb and speak");
        wake.resume();
      };
      u.onerror = () => wake.resume();
      window.speechSynthesis.speak(u);
    } catch (_) {
      wake.resume();
    }
  }

  // ------------------------------------------------------------ respond
  async function botSay(text) {
    addMsg(text, "bot");
    speak(text);
  }

  async function handleInput(raw) {
    const text = (raw || "").trim();
    if (!text) return;
    addMsg(text, "user");

    // Waiting for a note body?
    if (state.pendingNote) {
      state.pendingNote = false;
      notes.push({ text, ts: new Date().toISOString() });
      saveNotes();
      return botSay(`Noted. You now have ${notes.length} note${notes.length === 1 ? "" : "s"}.`);
    }

    state.busy = true;
    setOrb("thinking", "Thinking…");
    try {
      const reply = await route(text);
      if (reply === null) return; // handled asynchronously
      await botSay(reply);
    } catch (err) {
      await botSay("Something went wrong: " + err.message);
    } finally {
      state.busy = false;
      // If not speaking, restore the idle hint (wake-aware).
      if (!el.orb.classList.contains("speaking")) {
        setOrb(null, state.wakeOn ? `Listening for “hey ${state.assistantName.toLowerCase()}”` : "Tap the orb and speak");
      }
    }
  }

  // ------------------------------------------------------------ skills router
  const EXIT = /^(exit|quit|goodbye|good bye|bye|shut down|shutdown)\.?$/i;

  async function route(text) {
    const t = text.toLowerCase().trim();
    const low = t.replace(/[.!?]+$/, "");

    if (EXIT.test(low)) return `Until next time, ${state.userName}.`;
    if (/^(reset|clear memory|forget everything)$/.test(low)) {
      await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId }),
      });
      return "Conversation memory cleared.";
    }

    // ---- time / date ----
    if (/\btime\b/.test(t) && !/\btimes\b|\btimer\b/.test(t)) {
      return "It's " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + ".";
    }
    if (/\b(date|what day|today('|’)?s date)\b/.test(t)) {
      return "Today is " + new Date().toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" }) + ".";
    }

    // ---- math ----
    const calc = tryMath(t);
    if (calc !== null) return calc;

    // ---- timer ----
    const timer = tryTimer(t);
    if (timer !== null) return timer;

    // ---- weather ----
    if (/\b(weather|temperature|forecast|how hot|how cold)\b/.test(t)) {
      let city = state.defaultCity;
      const m = text.match(/\b(?:in|for|at)\s+([a-zA-Z\s]+)$/);
      if (m) city = m[1].trim();
      const r = await fetch("/api/weather?city=" + encodeURIComponent(city));
      const data = await r.json();
      return data.ok ? data.text : data.message;
    }

    // ---- notes ----
    const noteRes = tryNotes(text, t);
    if (noteRes !== null) return noteRes;

    // ---- media (open in a new tab) ----
    const media = tryMedia(text, t);
    if (media !== null) return media;

    // ---- open sites ----
    const open = tryOpen(text, t);
    if (open !== null) return open;

    // ---- web search ----
    const search = text.match(/^\s*(?:search|google|look up|find)\s+(.*)/i);
    if (search && search[1].trim()) {
      const q = search[1].trim().replace(/[?.]+$/, "");
      window.open("https://www.google.com/search?q=" + encodeURIComponent(q), "_blank");
      return "Searching the web for " + q + ".";
    }

    // ---- wikipedia ----
    const wiki = text.match(/(?:wikipedia|who is|who was|what is a|tell me about)\s+(.*)/i);
    if (wiki && wiki[1].trim()) {
      const q = wiki[1].trim().replace(/[?.]+$/, "");
      const r = await fetch("/api/wiki?q=" + encodeURIComponent(q));
      const data = await r.json();
      if (data.ok) return data.text;
      // fall through to AI if wiki fails
    }

    // ---- fun ----
    if (/\b(flip a coin|heads or tails|toss a coin)\b/.test(t)) return Math.random() < 0.5 ? "Heads." : "Tails.";
    const dice = t.match(/\broll\b.*?(?:(\d+)\s*(?:sided|side)|d(\d+))?/);
    if (/\broll\b.*\b(die|dice|d\d+)\b/.test(t)) {
      const sides = dice && (dice[1] || dice[2]) ? parseInt(dice[1] || dice[2], 10) : 6;
      const s = Math.max(2, Math.min(sides, 1000));
      return `You rolled a ${1 + Math.floor(Math.random() * s)} on a ${s}-sided die.`;
    }
    if (/\b(joke|make me laugh|something funny)\b/.test(t)) return randJoke();

    // ---- identity / help ----
    if (/\b(your name|who are you|what are you)\b/.test(t))
      return `I am ${state.assistantName}, your personal assistant, ${state.userName}.`;
    if (/\b(what can you do|help|commands|capabilities)\b/.test(t))
      return "I can tell the time and date, do math, check the weather, look things up on Wikipedia, search the web, open sites, play music, take notes, set timers, tell jokes, and chat with you. Just ask.";

    // ---- greetings (quick offline replies) ----
    if (/^(hi|hello|hey|greetings|yo)\b/.test(t)) return `Hello ${state.userName}. How can I help?`;
    if (/how are you/.test(t)) return "Operating at full capacity, thank you.";
    if (/thank/.test(t)) return "You're welcome.";

    // ---- AI fallback ----
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, sessionId: state.sessionId }),
    });
    const data = await r.json();
    return data.ok ? data.text : data.message;
  }

  // ------------------------------------------------------------ skill helpers
  function tryMath(t) {
    let c = t.replace(/^\s*(?:hey\s+)?(?:jarvis[,\s]+)?(?:calculate|compute|what\s+is|what's|whats|how much is|solve)\s*/i, "").trim();
    c = c.replace(/\bplus\b/g, "+").replace(/\bminus\b/g, "-")
         .replace(/\b(?:times|multiplied by)\b/g, "*").replace(/\b(?:divided by|over)\b/g, "/")
         .replace(/x/g, "*").replace(/×/g, "*").replace(/÷/g, "/").replace(/\^/g, "**");
    const m = c.match(/[-+*/().\d\s]+/);
    if (!m) return null;
    const expr = m[0].trim();
    if (!/\d/.test(expr) || !/[-+*/]/.test(expr)) return null;
    if (!/^[-+*/().\s\d]+$/.test(expr)) return null;
    try {
      // eslint-disable-next-line no-new-func
      const val = Function('"use strict";return (' + expr + ")")();
      if (typeof val !== "number" || !isFinite(val)) return null;
      const out = Number.isInteger(val) ? val : Math.round(val * 1e6) / 1e6;
      return "That equals " + out + ".";
    } catch {
      return null;
    }
  }

  function tryTimer(t) {
    if (!/\b(timer|remind me|countdown)\b/.test(t)) return null;
    let total = 0;
    const re = /(\d+)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)/g;
    let mm;
    while ((mm = re.exec(t))) {
      const v = parseInt(mm[1], 10);
      if (/^h/.test(mm[2])) total += v * 3600;
      else if (/^m/.test(mm[2])) total += v * 60;
      else total += v;
    }
    if (total <= 0) return "How long should I set the timer for? Try 'set a timer for 5 minutes'.";
    const label = (t.match(/remind me to (.+)/) || [])[1];
    setTimeout(() => {
      const msg = label ? `Time's up. ${label}.` : "Time's up!";
      addMsg(msg, "bot");
      speak(msg);
      try { new Notification(state.assistantName, { body: msg }); } catch (_) {}
    }, total * 1000);
    const parts = [];
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    if (h) parts.push(h + " hour" + (h > 1 ? "s" : ""));
    if (m) parts.push(m + " minute" + (m > 1 ? "s" : ""));
    if (s) parts.push(s + " second" + (s > 1 ? "s" : ""));
    if (window.Notification && Notification.permission === "default") Notification.requestPermission();
    return "Timer set for " + parts.join(", ") + ".";
  }

  function tryNotes(text, t) {
    const add = text.match(/^\s*(?:take a note|note that|remember that|make a note)\s*[:,-]?\s*(.*)/i);
    if (add && add[1].trim()) {
      notes.push({ text: add[1].trim(), ts: new Date().toISOString() });
      saveNotes();
      return `Noted. You now have ${notes.length} note${notes.length === 1 ? "" : "s"}.`;
    }
    if (/^(take a note|note that|remember that|make a note)$/.test(t)) {
      state.pendingNote = true;
      return "What should I note?";
    }
    if (/\b(read (my )?notes|list notes|my notes|show notes)\b/.test(t)) {
      if (!notes.length) return "You have no notes yet.";
      return "Here are your notes: " + notes.map((n, i) => `${i + 1}. ${n.text}`).join("; ");
    }
    if (/\b(clear notes|delete notes|erase notes)\b/.test(t)) {
      const n = notes.length;
      notes.length = 0;
      saveNotes();
      return `Cleared ${n} note${n === 1 ? "" : "s"}.`;
    }
    return null;
  }

  function tryMedia(text, t) {
    if (/\b(pause|resume|next|previous|skip|stop|volume|mute)\b/.test(t) && !/\bplay\b/.test(t)) {
      return "Browser tabs can't be remote-controlled for playback, but I can start music for you — try 'play lofi beats' or 'play <song> on spotify'.";
    }
    const m = text.match(/^\s*play\s+(.*)/i);
    if (!m) return null;
    let q = m[1].trim().replace(/[?.]+$/, "");
    if (!q) return "Play what? Try 'play some jazz on YouTube'.";
    const spotify = /\bon\s+spotify\b/i.test(q);
    q = q.replace(/\s+on\s+(?:spotify|youtube)\b/i, "").replace(/^(?:some|the)\s+/i, "").trim();
    if (!q) return "Play what exactly?";
    if (spotify) {
      window.open("https://open.spotify.com/search/" + encodeURIComponent(q), "_blank");
      return "Searching Spotify for " + q + ".";
    }
    window.open("https://www.youtube.com/results?search_query=" + encodeURIComponent(q), "_blank");
    return "Playing " + q + " on YouTube.";
  }

  function tryOpen(text, t) {
    const m = text.match(/^\s*(?:open|go to|launch)\s+(.*)/i);
    if (!m) return null;
    let target = m[1].trim().toLowerCase().replace(/[.]+$/, "");
    const shortcuts = {
      youtube: "https://youtube.com", google: "https://google.com",
      gmail: "https://mail.google.com", github: "https://github.com",
      twitter: "https://twitter.com", x: "https://x.com",
      reddit: "https://reddit.com", wikipedia: "https://wikipedia.org",
      stackoverflow: "https://stackoverflow.com", chatgpt: "https://chat.openai.com",
      maps: "https://maps.google.com",
    };
    let url = shortcuts[target];
    if (!url) {
      if (/\./.test(target) && !/\s/.test(target)) url = target.startsWith("http") ? target : "https://" + target;
      else url = "https://www.google.com/search?q=" + encodeURIComponent(target);
    }
    window.open(url, "_blank");
    return "Opening " + target + ".";
  }

  const JOKES = [
    "Why do programmers prefer dark mode? Because light attracts bugs.",
    "I told my computer I needed a break, and now it won't stop sending me KitKats.",
    "Why did the developer go broke? Because he used up all his cache.",
    "There are 10 kinds of people in the world: those who understand binary and those who don't.",
    "I would tell you a UDP joke, but you might not get it.",
  ];
  const randJoke = () => JOKES[Math.floor(Math.random() * JOKES.length)];

  // ------------------------------------------------------------ STT
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null;
  if (SR) {
    recog = new SR();
    recog.lang = "en-US";
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onresult = (e) => {
      const said = e.results[0][0].transcript;
      state.listening = false;
      handleInput(said);
    };
    recog.onerror = (e) => {
      state.listening = false;
      setOrb(null, state.wakeOn ? `Listening for “hey ${state.assistantName.toLowerCase()}”` : "Tap the orb and speak");
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        addMsg("Microphone access was blocked. You can still type your commands.", "system");
      }
    };
    recog.onend = () => {
      if (state.listening) {
        state.listening = false;
        if (!state.busy) setOrb(null, state.wakeOn ? `Listening for “hey ${state.assistantName.toLowerCase()}”` : "Tap the orb and speak");
      }
      // Resume the wake listener if it was temporarily paused for a one-shot.
      if (state.wakeOn) wake.resume();
    };
  }

  function startListening() {
    if (!recog) {
      addMsg("Voice input isn't supported in this browser — try Chrome or Edge. You can still type.", "system");
      return;
    }
    if (state.listening) { recog.stop(); return; }
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      // Free the mic from the wake listener during a one-shot capture.
      if (state.wakeOn) wake.pause();
      state.listening = true;
      setOrb("listening", "Listening…");
      recog.start();
    } catch (_) {
      state.listening = false;
      if (state.wakeOn) wake.resume();
      setOrb(null, state.wakeOn ? `Listening for “hey ${state.assistantName.toLowerCase()}”` : "Tap the orb and speak");
    }
  }

  // ------------------------------------------------------------ wake word
  // A separate continuous recognizer that listens for "hey jarvis". When it
  // hears the wake word it either handles an inline command ("jarvis, what's
  // the time") or arms a short window to capture the next utterance.
  const wake = (() => {
    let wr = null;
    let running = false;
    let paused = false;
    let armed = false; // capturing a command right after the wake word
    let armTimer = null;

    function build() {
      if (!SR) return null;
      const r = new SR();
      r.lang = "en-US";
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onresult = (e) => {
        let transcript = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          transcript += e.results[i][0].transcript;
        }
        const finalChunk = e.results[e.results.length - 1].isFinal;
        const text = transcript.trim();
        if (!text) return;

        if (armed) {
          if (finalChunk) {
            disarm();
            handleInput(text);
          }
          return;
        }
        if (WAKE_RE.test(text)) {
          const after = text.replace(WAKE_RE, "").replace(/^[\s,.:-]+/, "").trim();
          if (after && finalChunk) {
            // Inline command: "jarvis, what's the weather"
            handleInput(after);
          } else if (finalChunk || after.length === 0) {
            arm();
          }
        }
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setWake(false);
          addMsg("Microphone access is blocked, so hands-free can't run.", "system");
        }
      };
      r.onend = () => {
        // Chrome auto-stops periodically; restart if we still want it on.
        if (running && !paused) {
          try { r.start(); } catch (_) {}
        }
      };
      return r;
    }

    function arm() {
      armed = true;
      setOrb("listening", "Yes? I'm listening…");
      if (state.voiceOut) {
        // quick chirp handled by short prompt only if not busy
      }
      clearTimeout(armTimer);
      armTimer = setTimeout(disarm, 8000);
    }
    function disarm() {
      armed = false;
      clearTimeout(armTimer);
      if (!state.busy) {
        setOrb(null, `Listening for “hey ${state.assistantName.toLowerCase()}”`);
      }
    }

    return {
      supported: () => Boolean(SR),
      start() {
        if (!SR) return false;
        if (!wr) wr = build();
        running = true;
        paused = false;
        try { wr.start(); } catch (_) {}
        return true;
      },
      stop() {
        running = false;
        armed = false;
        clearTimeout(armTimer);
        if (wr) { try { wr.stop(); } catch (_) {} }
      },
      pause() {
        if (!running) return;
        paused = true;
        if (wr) { try { wr.stop(); } catch (_) {} }
      },
      resume() {
        if (!running) return;
        paused = false;
        if (wr) { try { wr.start(); } catch (_) {} }
      },
      isArmed: () => armed,
    };
  })();

  function setWake(on) {
    if (on && !wake.supported()) {
      addMsg("Wake word needs the Web Speech API (Chrome or Edge). You can still tap the orb.", "system");
      return;
    }
    // The one-shot recognizer and the wake recognizer can't both own the mic.
    if (on && state.listening && recog) { try { recog.stop(); } catch (_) {} }
    state.wakeOn = on;
    el.wakeChip.textContent = "wake: " + (on ? "on" : "off");
    el.wakeChip.classList.toggle("active", on);
    if (on) {
      wake.start();
      setOrb(null, `Listening for “hey ${state.assistantName.toLowerCase()}”`);
      addMsg(`Hands-free on. Say “hey ${state.assistantName}” anytime.`, "system");
    } else {
      wake.stop();
      setOrb(null, "Tap the orb and speak");
    }
  }

  // ------------------------------------------------------------ events
  el.composer.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = el.input.value;
    el.input.value = "";
    handleInput(v);
  });
  el.micBtn.addEventListener("click", startListening);
  el.orb.addEventListener("click", startListening);
  el.muteBtn.addEventListener("click", () => {
    state.voiceOut = !state.voiceOut;
    el.muteBtn.textContent = state.voiceOut ? "🔊" : "🔇";
    el.muteBtn.classList.toggle("muted", !state.voiceOut);
    if (!state.voiceOut && window.speechSynthesis) window.speechSynthesis.cancel();
  });
  el.clearBtn.addEventListener("click", () => { el.chat.innerHTML = ""; });
  el.wakeChip.addEventListener("click", () => setWake(!state.wakeOn));

  // ------------------------------------------------------------ tabs (IUM)
  const tabs = document.querySelectorAll(".tab");
  const views = { assistant: document.getElementById("view-assistant"), ium: document.getElementById("view-ium") };
  function switchView(name) {
    tabs.forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    Object.entries(views).forEach(([k, v]) => v && v.classList.toggle("active", k === name));
  }
  tabs.forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));

  // IUM iframe reload + embed-block fallback.
  const iumFrame = document.getElementById("iumFrame");
  const iumFallback = document.getElementById("iumFallback");
  const iumReload = document.getElementById("iumReload");
  if (iumReload && iumFrame) {
    iumReload.addEventListener("click", () => {
      if (iumFallback) iumFallback.hidden = true;
      // eslint-disable-next-line no-self-assign
      iumFrame.src = iumFrame.src;
    });
  }
  // If the portal refuses to be embedded, show the fallback after a grace period.
  if (iumFrame && iumFallback) {
    let loaded = false;
    iumFrame.addEventListener("load", () => { loaded = true; iumFallback.hidden = true; });
    setTimeout(() => { if (!loaded) iumFallback.hidden = false; }, 6000);
  }

  // ------------------------------------------------------------ suggestions
  const SUGGESTIONS = [
    "What time is it?", "Weather in Tokyo", "Tell me a joke",
    "What is 15% of 240", "Play lofi beats", "Who is Nikola Tesla",
    "Set a timer for 1 minute", "Flip a coin",
  ];
  SUGGESTIONS.forEach((s) => {
    const b = document.createElement("button");
    b.textContent = s;
    b.addEventListener("click", () => handleInput(s));
    el.suggestions.appendChild(b);
  });

  // ------------------------------------------------------------ PWA
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (el.installChip) el.installChip.hidden = false;
  });
  if (el.installChip) {
    el.installChip.classList.add("install");
    el.installChip.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      el.installChip.hidden = true;
    });
  }
  window.addEventListener("appinstalled", () => {
    if (el.installChip) el.installChip.hidden = true;
  });
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  // ------------------------------------------------------------ init
  async function init() {
    try {
      const cfg = await (await fetch("/api/config")).json();
      Object.assign(state, {
        assistantName: cfg.assistantName,
        userName: cfg.userName,
        aiOnline: cfg.aiOnline,
        weatherOnline: cfg.weatherOnline,
        defaultCity: cfg.defaultCity,
      });
      el.brandName.textContent = cfg.assistantName.toUpperCase();
    } catch (_) { /* use defaults */ }

    el.chipAI.textContent = "AI: " + (state.aiOnline ? "online" : "offline");
    el.chipAI.classList.add(state.aiOnline ? "on" : "off");
    const voiceOK = Boolean(SR);
    el.chipVoice.textContent = "voice: " + (voiceOK ? "ready" : "type only");
    el.chipVoice.classList.add(voiceOK ? "on" : "off");

    const hour = new Date().getHours();
    const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    botSay(`${part}, ${state.userName}. ${state.assistantName} online and ready.`);
  }

  init();
})();
