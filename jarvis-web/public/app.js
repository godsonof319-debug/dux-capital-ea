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

    // ---- LMS (school portal) ----
    const lmsRes = await tryLms(text, t);
    if (lmsRes !== null) return lmsRes;

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
      return "I can tell the time and date, do math, check the weather, look things up on Wikipedia, search the web, open sites, play music, take notes, set timers, tell jokes, and chat. I'm also linked to your student portal — ask me about your courses, assignments, grades, or what's due this week. Just ask.";

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

  // ---- LMS voice/chat intents ----
  function fmtWhen(ts) {
    if (!ts) return "no due date";
    const d = new Date(ts * 1000);
    const diffDays = Math.round((d - Date.now()) / 86400000);
    const date = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    if (diffDays < 0) return `overdue (was ${date})`;
    if (diffDays === 0) return `today (${date})`;
    if (diffDays === 1) return `tomorrow (${date})`;
    return `${date} (in ${diffDays} days)`;
  }

  async function tryLms(text, t) {
    // Detect an LMS-related question.
    const mentionsLms = /\b(lms|portal|moodle|e-?learn|elearn)\b/.test(t);
    const wantsCourses = /\b(my )?(courses|modules|subjects|classes)\b/.test(t);
    const wantsAssign = /\b(assignment|assignments|homework|due|deadline|submission)s?\b/.test(t);
    const wantsGrades = /\b(grade|grades|mark|marks|result|results|score|scores)\b/.test(t);
    const wantsEvents = /\b(upcoming|calendar|event|events|schedule|what('| i)?s? on)\b/.test(t);
    const wantsLogin = /\b(log ?in|sign ?in|open (the )?(portal|lms))\b/.test(t) && mentionsLms || /\bopen (the )?portal\b/.test(t);

    if (wantsLogin) { lms.focusPortal(); return "Opening the student portal for you."; }

    const isLmsQuery = wantsCourses || wantsAssign || wantsGrades || wantsEvents || (mentionsLms && /\b(show|list|what|check)\b/.test(t));
    if (!isLmsQuery) return null;

    if (!lms.isLoggedIn()) {
      lms.focusPortal();
      return "You'll need to sign in to the student portal first. I've opened it for you.";
    }

    try {
      // Grades
      if (wantsGrades) {
        const cs = await lms.qCourses();
        if (!cs.ok) return cs.message || "I couldn't reach the portal.";
        if (!cs.courses.length) return "You have no courses to show grades for.";
        // If a course name is mentioned, target it; else summarize the first/only.
        let course = cs.courses.find((c) =>
          t.includes((c.shortname || "").toLowerCase()) ||
          (c.fullname && t.includes(c.fullname.toLowerCase().split(/\s+/).slice(0, 2).join(" ")))
        );
        if (!course && cs.courses.length === 1) course = cs.courses[0];
        if (!course) {
          lms.focusPortal();
          return `You have ${cs.courses.length} courses. Open the Grades tab and pick one, or say "grades for" and the course name.`;
        }
        const g = await lms.qGrades(course.id);
        if (!g.ok) return g.message;
        const total = (g.grades || []).find((x) => x.itemtype === "course");
        const items = (g.grades || []).filter((x) => x.itemname && x.grade && x.grade !== "-");
        if (total && total.grade && total.grade !== "-") {
          return `Your overall grade in ${course.shortname} is ${total.grade}${total.percentage && total.percentage !== "-" ? " (" + total.percentage + ")" : ""}.`;
        }
        if (items.length) {
          const top = items.slice(0, 3).map((x) => `${x.itemname}: ${x.grade}`).join("; ");
          return `In ${course.shortname}: ${top}.`;
        }
        return `No grades are posted yet for ${course.shortname}.`;
      }

      // Assignments / what's due
      if (wantsAssign) {
        const a = await lms.qAssignments();
        if (!a.ok) return a.message;
        let list = a.assignments || [];
        if (!list.length) return "You have no assignments listed. Nice.";
        // "this week" filter
        if (/\bthis week\b/.test(t)) {
          const weekEnd = Date.now() + 7 * 86400000;
          list = list.filter((x) => x.duedate && x.duedate * 1000 >= Date.now() && x.duedate * 1000 <= weekEnd);
          if (!list.length) return "Nothing is due this week. You're clear.";
        } else {
          // default: upcoming (not overdue), soonest first
          const upcoming = list.filter((x) => x.duedate && x.duedate * 1000 >= Date.now());
          if (upcoming.length) list = upcoming;
        }
        const top = list.slice(0, 4).map((x) => `${x.name} (${x.course}) — ${fmtWhen(x.duedate)}`).join("; ");
        const more = list.length > 4 ? ` And ${list.length - 4} more.` : "";
        return `You have ${list.length} assignment${list.length === 1 ? "" : "s"}: ${top}.${more}`;
      }

      // Upcoming events
      if (wantsEvents) {
        const e = await lms.qCalendar();
        if (!e.ok) return e.message;
        if (!e.events.length) return "Nothing upcoming on your calendar.";
        const top = e.events.slice(0, 4).map((x) => `${x.name}${x.course ? " (" + x.course + ")" : ""} — ${fmtWhen(x.timestart)}`).join("; ");
        return `Coming up: ${top}.`;
      }

      // Courses
      if (wantsCourses) {
        const c = await lms.qCourses();
        if (!c.ok) return c.message;
        if (!c.courses.length) return "You're not enrolled in any courses.";
        const names = c.courses.slice(0, 6).map((x) => x.fullname).join("; ");
        const more = c.courses.length > 6 ? ` …and ${c.courses.length - 6} more.` : "";
        return `You have ${c.courses.length} course${c.courses.length === 1 ? "" : "s"}: ${names}.${more}`;
      }
    } catch (err) {
      return "I had trouble reaching the portal: " + err.message;
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

  // ------------------------------------------------------------ tabs
  const tabs = document.querySelectorAll(".tab");
  const views = {
    assistant: document.getElementById("view-assistant"),
    portal: document.getElementById("view-portal"),
    resources: document.getElementById("view-resources"),
    ium: document.getElementById("view-ium"),
    admin: document.getElementById("view-admin"),
  };
  function switchView(name) {
    tabs.forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    Object.entries(views).forEach(([k, v]) => v && v.classList.toggle("active", k === name));
    if (name === "portal") lms.onOpen();
    if (name === "resources") resources.onOpen();
    if (name === "admin") adminUI.onOpen();
  }
  tabs.forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));

  // ------------------------------------------------------------ IUM webview
  const wv = (() => {
    const frame = document.getElementById("iumFrame");
    if (!frame) return null;
    const addr = document.getElementById("wvAddress");
    const addrForm = document.getElementById("wvAddressForm");
    const lock = document.getElementById("wvLock");
    const btnBack = document.getElementById("wvBack");
    const btnFwd = document.getElementById("wvFwd");
    const btnReload = document.getElementById("wvReload");
    const btnHome = document.getElementById("wvHome");
    const btnOpen = document.getElementById("wvOpen");
    const loading = document.getElementById("wvLoading");
    const fallback = document.getElementById("iumFallback");
    const fbHost = document.getElementById("wvFallbackHost");
    const fbOpen = document.getElementById("wvFallbackOpen");
    const bookmarks = Array.from(document.querySelectorAll(".wv-bm"));
    const HOME = "https://elearn.ium.edu.na/";

    // Our own history stack (cross-origin iframes hide their internal history).
    const hist = [];
    let idx = -1;
    let loadTimer = null;

    function normalize(input) {
      let u = (input || "").trim();
      if (!u) return null;
      if (!/^https?:\/\//i.test(u)) {
        // treat a lone term as a search, a dotted token as a domain
        if (/\s/.test(u) || !/\./.test(u)) {
          return "https://www.google.com/search?q=" + encodeURIComponent(u);
        }
        u = "https://" + u;
      }
      try { return new URL(u).href; } catch { return null; }
    }

    function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } }

    function syncButtons() {
      btnBack.disabled = idx <= 0;
      btnFwd.disabled = idx >= hist.length - 1;
      const cur = hist[idx] || "";
      addr.value = cur;
      lock.textContent = cur.startsWith("https://") ? "🔒" : "⚠️";
      bookmarks.forEach((b) => b.classList.toggle("active", b.dataset.url === cur));
    }

    function showLoading(on) {
      if (loading) loading.classList.toggle("hidden", !on);
    }

    function load(url, { push = true } = {}) {
      const target = normalize(url);
      if (!target) return;
      if (fallback) fallback.hidden = true;
      showLoading(true);
      if (push) {
        hist.splice(idx + 1); // drop forward entries
        hist.push(target);
        idx = hist.length - 1;
      }
      syncButtons();
      frame.src = target;

      // Detect embed blocking: if onload never fires, assume X-Frame-Options/CSP.
      clearTimeout(loadTimer);
      loadTimer = setTimeout(() => {
        showLoading(false);
        if (fallback) {
          if (fbHost) fbHost.textContent = hostOf(target);
          if (fbOpen) fbOpen.href = target;
          fallback.hidden = false;
        }
      }, 7000);
    }

    frame.addEventListener("load", () => {
      clearTimeout(loadTimer);
      showLoading(false);
      if (fallback) fallback.hidden = true;
    });

    addrForm.addEventListener("submit", (e) => { e.preventDefault(); load(addr.value); addr.blur(); });
    btnReload.addEventListener("click", () => { if (hist[idx]) load(hist[idx], { push: false }); });
    btnHome.addEventListener("click", () => load(HOME));
    btnOpen.addEventListener("click", () => window.open(hist[idx] || HOME, "_blank", "noopener"));
    btnBack.addEventListener("click", () => { if (idx > 0) { idx--; load(hist[idx], { push: false }); } });
    btnFwd.addEventListener("click", () => { if (idx < hist.length - 1) { idx++; load(hist[idx], { push: false }); } });
    bookmarks.forEach((b) => b.addEventListener("click", () => load(b.dataset.url)));

    // Seed history with the initial iframe src.
    hist.push(HOME); idx = 0; syncButtons(); showLoading(true);

    return { load, HOME };
  })();

  // ------------------------------------------------------------ LMS portal
  const lms = (() => {
    const SKEY = "jarvis_lms_session";
    const loginBox = document.getElementById("lmsLogin");
    const dash = document.getElementById("lmsDash");
    const form = document.getElementById("lmsLoginForm");
    const userIn = document.getElementById("lmsUser");
    const passIn = document.getElementById("lmsPass");
    const submit = document.getElementById("lmsSubmit");
    const msg = document.getElementById("lmsMsg");
    const nameEl = document.getElementById("lmsName");
    const siteEl = document.getElementById("lmsSite");
    const avatar = document.getElementById("lmsAvatar");
    const logoutBtn = document.getElementById("lmsLogout");
    const subtabs = document.querySelectorAll(".lms-subtab");
    const panels = {
      courses: document.getElementById("panel-courses"),
      grades: document.getElementById("panel-grades"),
      assignments: document.getElementById("panel-assignments"),
      calendar: document.getElementById("panel-calendar"),
    };
    let sessionId = localStorage.getItem(SKEY) || "";
    let loadedOnce = false;
    const loaded = { courses: false, grades: false, assignments: false, calendar: false };

    if (!form) return { onOpen() {} };

    function h(html) { return html; }
    function esc(s) { return (s || "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

    async function api(path, opts = {}) {
      const headers = Object.assign({ "x-lms-session": sessionId }, opts.headers || {});
      const r = await fetch(path, Object.assign({}, opts, { headers }));
      const data = await r.json().catch(() => ({ ok: false, message: "Bad response." }));
      if (r.status === 401) { showLogin("Your session expired. Please sign in again."); }
      return data;
    }

    function showLogin(text) {
      sessionId = ""; localStorage.removeItem(SKEY);
      loadedOnce = false; loaded.courses = loaded.grades = loaded.assignments = loaded.calendar = false;
      dash.hidden = true; loginBox.hidden = false;
      if (text) { msg.textContent = text; msg.classList.remove("ok"); }
    }
    function showDash(user) {
      loginBox.hidden = true; dash.hidden = false;
      nameEl.textContent = user?.fullname || "Student";
      siteEl.textContent = user?.sitename || "";
      if (user?.userpictureurl) {
        avatar.textContent = "";
        avatar.style.backgroundImage = `url("${user.userpictureurl}")`;
      }
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.textContent = "Signing in…"; msg.classList.remove("ok");
      submit.disabled = true;
      try {
        const r = await fetch("/api/lms/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: userIn.value.trim(), password: passIn.value }),
        });
        const data = await r.json();
        if (!data.ok) { msg.textContent = data.message || "Login failed."; submit.disabled = false; return; }
        sessionId = data.sessionId;
        localStorage.setItem(SKEY, sessionId);
        passIn.value = "";
        msg.textContent = ""; 
        showDash(data.user);
        loadPanel("courses");
      } catch (err) {
        msg.textContent = "Couldn't reach the server: " + err.message;
      } finally {
        submit.disabled = false;
      }
    });

    logoutBtn.addEventListener("click", async () => {
      try { await api("/api/lms/logout", { method: "POST" }); } catch (_) {}
      showLogin("");
      msg.textContent = "You've been signed out."; msg.classList.add("ok");
    });

    subtabs.forEach((t) => t.addEventListener("click", () => {
      subtabs.forEach((x) => x.classList.toggle("active", x === t));
      Object.entries(panels).forEach(([k, p]) => p.classList.toggle("active", k === t.dataset.panel));
      loadPanel(t.dataset.panel);
    }));

    function fmtDate(ts) {
      if (!ts) return "";
      return new Date(ts * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    }
    function dueLabel(ts) {
      if (!ts) return "No due date";
      const diff = ts * 1000 - Date.now();
      const days = Math.round(diff / 86400000);
      const soon = diff > 0 && days <= 3;
      const txt = diff < 0 ? "Overdue · " + fmtDate(ts) : "Due " + fmtDate(ts);
      return `<span class="lms-due ${soon || diff < 0 ? "soon" : ""}">${txt}</span>`;
    }

    async function loadPanel(name) {
      if (loaded[name]) return;
      const panel = panels[name];
      panel.innerHTML = '<div class="lms-loading">Loading…</div>';
      try {
        if (name === "courses") await renderCourses(panel);
        else if (name === "grades") await renderGradesCourseList(panel);
        else if (name === "assignments") await renderAssignments(panel);
        else if (name === "calendar") await renderCalendar(panel);
        loaded[name] = true;
      } catch (err) {
        panel.innerHTML = `<div class="lms-empty">${esc(err.message)}</div>`;
      }
    }

    async function renderCourses(panel) {
      const data = await api("/api/lms/courses");
      if (!data.ok) throw new Error(data.message);
      if (!data.courses.length) { panel.innerHTML = '<div class="lms-empty">No courses found.</div>'; return; }
      panel.innerHTML = "";
      data.courses.forEach((c) => {
        const card = document.createElement("div");
        card.className = "lms-card click";
        const prog = c.progress != null ? `<div class="bar"><span style="width:${Math.round(c.progress)}%"></span></div>` : "";
        card.innerHTML = h(`<h4>${esc(c.fullname)}</h4><div class="meta">${esc(c.shortname)}</div>${prog}`);
        card.addEventListener("click", () => openCourse(panel, c));
        panel.appendChild(card);
      });
    }

    async function openCourse(panel, course) {
      panel.innerHTML = '<div class="lms-loading">Loading course…</div>';
      const data = await api(`/api/lms/courses/${course.id}/contents`);
      if (!data.ok) { panel.innerHTML = `<div class="lms-empty">${esc(data.message)}</div>`; return; }
      panel.innerHTML = "";
      const back = document.createElement("button");
      back.className = "lms-back"; back.textContent = "‹ Back to courses";
      back.addEventListener("click", () => { loaded.courses = false; loadPanel("courses"); });
      panel.appendChild(back);
      const title = document.createElement("div");
      title.className = "lms-card";
      title.innerHTML = `<h4>${esc(course.fullname)}</h4><div class="meta">${esc(course.shortname)}</div>`;
      panel.appendChild(title);

      data.sections.forEach((sec) => {
        if (!sec.modules.length) return;
        const s = document.createElement("div");
        s.className = "lms-section";
        s.innerHTML = `<div class="sname">${esc(sec.name || "Section")}</div>`;
        sec.modules.forEach((m) => {
          const row = document.createElement("div");
          row.className = "lms-mod";
          const icon = m.modicon ? `<img class="micon" src="${esc(m.modicon)}" alt="">` : `<span class="micon">📄</span>`;
          row.innerHTML = `${icon}<span class="mname">${esc(m.name)}</span>`;
          const file = (m.contents || []).find((f) => f.type === "file" && f.fileurl);
          if (file) {
            const a = document.createElement("a");
            a.className = "dl"; a.textContent = "Download";
            a.href = `/api/lms/download?url=${encodeURIComponent(file.fileurl)}`;
            a.setAttribute("download", file.filename || "");
            // send session header via fetch-download to keep token server-side
            a.addEventListener("click", (ev) => { ev.preventDefault(); downloadFile(file); });
            row.appendChild(a);
          } else if (m.url) {
            const a = document.createElement("a");
            a.className = "dl"; a.textContent = "Open"; a.href = m.url; a.target = "_blank"; a.rel = "noopener";
            row.appendChild(a);
          }
          s.appendChild(row);
        });
        panel.appendChild(s);
      });
    }

    async function downloadFile(file) {
      try {
        const r = await fetch(`/api/lms/download?url=${encodeURIComponent(file.fileurl)}`, {
          headers: { "x-lms-session": sessionId },
        });
        if (!r.ok) { alert("Download failed."); return; }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = file.filename || "download";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (err) {
        alert("Download error: " + err.message);
      }
    }

    // Grades: first pick a course, then show its grade items.
    async function renderGradesCourseList(panel) {
      const data = await api("/api/lms/courses");
      if (!data.ok) throw new Error(data.message);
      if (!data.courses.length) { panel.innerHTML = '<div class="lms-empty">No courses found.</div>'; return; }
      panel.innerHTML = "";
      const hint = document.createElement("div");
      hint.className = "meta";
      hint.style.cssText = "padding:2px 2px 8px;color:var(--muted);font-family:var(--font-mono);font-size:11.5px;";
      hint.textContent = "Select a course to view your grades";
      panel.appendChild(hint);
      data.courses.forEach((c) => {
        const card = document.createElement("div");
        card.className = "lms-card click";
        card.innerHTML = h(`<h4>${esc(c.fullname)}</h4><div class="meta">${esc(c.shortname)}</div>`);
        card.addEventListener("click", () => openGrades(panel, c));
        panel.appendChild(card);
      });
    }

    async function openGrades(panel, course) {
      panel.innerHTML = '<div class="lms-loading">Loading grades…</div>';
      const data = await api(`/api/lms/courses/${course.id}/grades`);
      panel.innerHTML = "";
      const back = document.createElement("button");
      back.className = "lms-back"; back.textContent = "‹ Back to courses";
      back.addEventListener("click", () => { loaded.grades = false; loadPanel("grades"); });
      panel.appendChild(back);
      const title = document.createElement("div");
      title.className = "lms-card";
      title.innerHTML = `<h4>${esc(course.fullname)}</h4><div class="meta">${esc(course.shortname)}</div>`;
      panel.appendChild(title);

      if (!data.ok) { panel.insertAdjacentHTML("beforeend", `<div class="lms-empty">${esc(data.message)}</div>`); return; }
      const items = (data.grades || []).filter((g) => g.itemname || g.grade);
      if (!items.length) { panel.insertAdjacentHTML("beforeend", '<div class="lms-empty">No grades available yet.</div>'); return; }

      items.forEach((g) => {
        const isTotal = g.itemtype === "course";
        const card = document.createElement("div");
        card.className = "lms-card";
        if (isTotal) card.style.borderColor = "rgba(63,224,165,.4)";
        const pct = g.percentage && g.percentage !== "-" ? ` · ${esc(g.percentage)}` : "";
        const range = g.range && g.range !== "0–100" ? ` <span style="opacity:.7">/ ${esc(g.range)}</span>` : "";
        card.innerHTML = h(
          `<h4>${esc(g.itemname || (isTotal ? "Course total" : "Item"))}</h4>` +
          `<div class="meta" style="font-size:13px;color:var(--text)">${esc(g.grade || "—")}${range}${pct}</div>` +
          (g.feedback ? `<div class="meta" style="margin-top:6px">${esc(g.feedback.replace(/<[^>]+>/g, ""))}</div>` : "")
        );
        panel.appendChild(card);
      });
    }

    async function renderAssignments(panel) {
      const data = await api("/api/lms/assignments");
      if (!data.ok) throw new Error(data.message);
      if (!data.assignments.length) { panel.innerHTML = '<div class="lms-empty">No assignments found.</div>'; return; }
      panel.innerHTML = "";
      data.assignments.forEach((a) => {
        const card = document.createElement("div");
        card.className = "lms-card";
        card.innerHTML = `<h4>${esc(a.name)}</h4><div class="meta">${esc(a.course)}</div><div class="meta" style="margin-top:6px">${dueLabel(a.duedate)}</div>`;
        panel.appendChild(card);
      });
    }

    async function renderCalendar(panel) {
      const data = await api("/api/lms/calendar");
      if (!data.ok) throw new Error(data.message);
      if (!data.events.length) { panel.innerHTML = '<div class="lms-empty">Nothing upcoming.</div>'; return; }
      panel.innerHTML = "";
      data.events.forEach((e) => {
        const card = document.createElement("div");
        card.className = "lms-card";
        card.innerHTML = `<h4>${esc(e.name)}</h4><div class="meta">${e.course ? esc(e.course) + " · " : ""}${fmtDate(e.timestart)}</div>`;
        panel.appendChild(card);
      });
    }

    async function onOpen() {
      // Configure the login subtitle from the server's LMS URL.
      try {
        const info = await (await fetch("/api/lms/info")).json();
        const host = info.lmsUrl ? new URL(info.lmsUrl).host : "";
        const sub = document.getElementById("lmsSubtitle");
        if (sub && host) sub.textContent = `Sign in to ${host} with your own credentials`;
      } catch (_) {}
      if (loadedOnce) return;
      loadedOnce = true;
      if (sessionId) {
        const me = await api("/api/lms/me");
        if (me.ok) { showDash(me.user); loadPanel("courses"); return; }
      }
      showLogin("");
    }

    // ---- Queries the AI assistant can call ----
    function isLoggedIn() { return Boolean(sessionId); }
    async function qCourses() { return api("/api/lms/courses"); }
    async function qAssignments() { return api("/api/lms/assignments"); }
    async function qCalendar() { return api("/api/lms/calendar"); }
    async function qGrades(courseId) { return api(`/api/lms/courses/${courseId}/grades`); }
    function focusPortal() { switchView("portal"); }

    return { onOpen, isLoggedIn, qCourses, qAssignments, qCalendar, qGrades, focusPortal };
  })();

  // ------------------------------------------------------------ shared helpers
  function escHtml(s) {
    return (s || "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  }

  // ------------------------------------------------------------ Resources (student)
  const resources = (() => {
    const modulesEl = document.getElementById("resModules");
    const announceEl = document.getElementById("resAnnounce");
    const refreshBtn = document.getElementById("resRefresh");
    if (!modulesEl) return { onOpen() {} };
    let loaded = false;

    async function render() {
      modulesEl.innerHTML = '<div class="lms-loading">Loading…</div>';
      announceEl.innerHTML = "";
      let data;
      try {
        data = await (await fetch("/api/resources/catalog")).json();
      } catch (err) {
        modulesEl.innerHTML = `<div class="lms-empty">Couldn't load resources.</div>`;
        return;
      }
      // Announcements
      (data.announcements || []).forEach((a) => {
        const d = document.createElement("div");
        d.className = "ann";
        d.innerHTML = `<h4>📢 ${escHtml(a.title || "Announcement")}</h4>` +
          (a.body ? `<div class="body">${escHtml(a.body)}</div>` : "") +
          `<div class="when">${new Date(a.created).toLocaleString()}</div>`;
        announceEl.appendChild(d);
      });
      // Modules + resources
      const mods = (data.modules || []).filter((m) => m.resources.length);
      if (!mods.length && !(data.announcements || []).length) {
        modulesEl.innerHTML = `<div class="lms-empty">No resources have been published yet.</div>`;
        return;
      }
      modulesEl.innerHTML = "";
      mods.forEach((m) => {
        const wrap = document.createElement("div");
        wrap.className = "res-module";
        wrap.innerHTML = `<div class="rm-title">📘 ${escHtml(m.title)}${m.code ? `<span class="code">${escHtml(m.code)}</span>` : ""}</div>`;
        m.resources.forEach((r) => {
          const row = document.createElement("div");
          row.className = "adm-row";
          row.innerHTML =
            `<div class="info"><strong>${escHtml(r.title)}</strong>` +
            `<div class="meta">${escHtml(r.filename)} · ${fmtSize(r.size)}</div></div>` +
            `<a class="dl" href="/api/resources/${r.id}/download">Download</a>`;
          wrap.appendChild(row);
        });
        modulesEl.appendChild(wrap);
      });
    }

    if (refreshBtn) refreshBtn.addEventListener("click", render);
    return {
      onOpen() { if (!loaded) { loaded = true; render(); } },
      refresh() { render(); },
    };
  })();

  // ------------------------------------------------------------ Admin console
  const adminUI = (() => {
    const TKEY = "jarvis_admin_token";
    const tabBtn = document.getElementById("tabAdmin");
    const loginBox = document.getElementById("admLogin");
    const dash = document.getElementById("admDash");
    const loginForm = document.getElementById("admLoginForm");
    const passIn = document.getElementById("admPass");
    const msg = document.getElementById("admMsg");
    const statLine = document.getElementById("admStatLine");
    const logoutBtn = document.getElementById("admLogout");
    const subtabs = document.querySelectorAll("[data-apanel]");
    if (!loginForm) return { onOpen() {}, revealTab() {} };

    let token = localStorage.getItem(TKEY) || "";
    let modules = [];

    async function api(path, opts = {}) {
      const headers = Object.assign({ "x-admin-token": token }, opts.headers || {});
      const r = await fetch(path, Object.assign({}, opts, { headers }));
      const data = await r.json().catch(() => ({ ok: false, message: "Bad response." }));
      if (r.status === 401) showLogin("Session expired. Please sign in again.");
      return data;
    }
    async function apiJson(path, method, body) {
      return api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }

    function showLogin(text) {
      token = ""; localStorage.removeItem(TKEY);
      dash.hidden = true; loginBox.hidden = false;
      if (text) { msg.textContent = text; }
    }
    function showDash() { loginBox.hidden = true; dash.hidden = false; loadPanel("modules"); loadOverview(); }

    async function revealTab() {
      try {
        const s = await (await fetch("/api/admin/status")).json();
        if (s.enabled && tabBtn) tabBtn.hidden = false;
      } catch (_) {}
    }

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.textContent = "Signing in…";
      const r = await apiJson("/api/admin/login", "POST", { password: passIn.value });
      if (!r.ok) { msg.textContent = r.message || "Login failed."; return; }
      token = r.token; localStorage.setItem(TKEY, token);
      passIn.value = ""; msg.textContent = "";
      showDash();
    });
    logoutBtn.addEventListener("click", async () => { await api("/api/admin/logout", { method: "POST" }); showLogin("Signed out."); });

    subtabs.forEach((t) => t.addEventListener("click", () => {
      subtabs.forEach((x) => x.classList.toggle("active", x === t));
      document.querySelectorAll("#view-admin .lms-panel").forEach((p) => p.classList.remove("active"));
      document.getElementById("apanel-" + t.dataset.apanel).classList.add("active");
      loadPanel(t.dataset.apanel);
    }));

    async function loadOverview() {
      const d = await api("/api/admin/overview");
      if (d.ok) statLine.textContent = `${d.stats.modules} modules · ${d.stats.resources} resources · ${d.stats.totalDownloads} downloads`;
    }

    async function loadPanel(name) {
      if (name === "modules") return renderModules();
      if (name === "resources") return renderResources();
      if (name === "announce") return renderAnnounce();
      if (name === "stats") return renderStats();
    }

    // Modules
    document.getElementById("admModForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = document.getElementById("admModCode").value.trim();
      const title = document.getElementById("admModTitle").value.trim();
      if (!title) return;
      const r = await apiJson("/api/admin/modules", "POST", { code, title });
      if (r.ok) { e.target.reset(); renderModules(); loadOverview(); }
      else alert(r.message);
    });
    async function renderModules() {
      const list = document.getElementById("admModList");
      list.innerHTML = '<div class="lms-loading">Loading…</div>';
      const d = await api("/api/admin/modules");
      if (!d.ok) { list.innerHTML = `<div class="lms-empty">${escHtml(d.message)}</div>`; return; }
      modules = d.modules;
      if (!modules.length) { list.innerHTML = '<div class="lms-empty">No modules yet. Add one above.</div>'; return; }
      list.innerHTML = "";
      modules.forEach((m) => {
        const row = document.createElement("div");
        row.className = "adm-row";
        row.innerHTML = `<div class="info"><strong>${escHtml(m.title)}</strong><div class="meta">${escHtml(m.code || "—")} · ${m.resourceCount} resource${m.resourceCount === 1 ? "" : "s"}</div></div>`;
        const del = document.createElement("button");
        del.className = "del"; del.textContent = "Delete";
        del.addEventListener("click", async () => {
          if (!confirm(`Delete "${m.title}" and its resources?`)) return;
          const r = await api(`/api/admin/modules/${m.id}`, { method: "DELETE" });
          if (r.ok) { renderModules(); loadOverview(); } else alert(r.message);
        });
        row.appendChild(del);
        list.appendChild(row);
      });
    }

    // Resources
    document.getElementById("admResForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const moduleId = document.getElementById("admResModule").value;
      const title = document.getElementById("admResTitle").value.trim();
      const fileEl = document.getElementById("admResFile");
      const rmsg = document.getElementById("admResMsg");
      if (!fileEl.files[0]) { rmsg.textContent = "Choose a file."; return; }
      const fd = new FormData();
      fd.append("moduleId", moduleId);
      fd.append("title", title);
      fd.append("file", fileEl.files[0]);
      rmsg.textContent = "Uploading…";
      const r = await api("/api/admin/resources", { method: "POST", body: fd });
      if (r.ok) { rmsg.textContent = "Uploaded."; e.target.reset(); populateModuleSelect(); renderResources(); loadOverview(); }
      else rmsg.textContent = r.message || "Upload failed.";
    });
    function populateModuleSelect() {
      const sel = document.getElementById("admResModule");
      sel.innerHTML = modules.map((m) => `<option value="${m.id}">${escHtml(m.title)}</option>`).join("") ||
        `<option value="" disabled>Create a module first</option>`;
    }
    async function renderResources() {
      if (!modules.length) { const d = await api("/api/admin/modules"); if (d.ok) modules = d.modules; }
      populateModuleSelect();
      const list = document.getElementById("admResList");
      list.innerHTML = '<div class="lms-loading">Loading…</div>';
      const d = await api("/api/admin/resources");
      if (!d.ok) { list.innerHTML = `<div class="lms-empty">${escHtml(d.message)}</div>`; return; }
      if (!d.resources.length) { list.innerHTML = '<div class="lms-empty">No resources uploaded yet.</div>'; return; }
      list.innerHTML = "";
      d.resources.forEach((r) => {
        const mod = modules.find((m) => m.id === r.moduleId);
        const row = document.createElement("div");
        row.className = "adm-row";
        row.innerHTML =
          `<div class="info"><strong>${escHtml(r.title)}</strong>` +
          `<div class="meta">${escHtml(r.filename)} · ${fmtSize(r.size)}${mod ? " · " + escHtml(mod.title) : ""}</div></div>` +
          `<span class="dl-badge">↓ ${r.downloads}</span>`;
        const del = document.createElement("button");
        del.className = "del"; del.textContent = "Delete";
        del.addEventListener("click", async () => {
          if (!confirm(`Delete "${r.title}"?`)) return;
          const res = await api(`/api/admin/resources/${r.id}`, { method: "DELETE" });
          if (res.ok) { renderResources(); loadOverview(); } else alert(res.message);
        });
        row.appendChild(del);
        list.appendChild(row);
      });
    }

    // Announcements
    document.getElementById("admAnnForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("admAnnTitle").value.trim();
      const body = document.getElementById("admAnnBody").value.trim();
      if (!title && !body) return;
      const r = await apiJson("/api/admin/announcements", "POST", { title, body });
      if (r.ok) { e.target.reset(); renderAnnounce(); loadOverview(); } else alert(r.message);
    });
    async function renderAnnounce() {
      const list = document.getElementById("admAnnList");
      list.innerHTML = '<div class="lms-loading">Loading…</div>';
      const d = await api("/api/admin/overview");
      if (!d.ok) { list.innerHTML = `<div class="lms-empty">${escHtml(d.message)}</div>`; return; }
      const anns = d.announcements || [];
      if (!anns.length) { list.innerHTML = '<div class="lms-empty">No announcements yet.</div>'; return; }
      list.innerHTML = "";
      anns.forEach((a) => {
        const row = document.createElement("div");
        row.className = "adm-row";
        row.innerHTML = `<div class="info"><strong>${escHtml(a.title || "Announcement")}</strong><div class="meta">${escHtml((a.body || "").slice(0, 80))}${(a.body || "").length > 80 ? "…" : ""} · ${new Date(a.created).toLocaleDateString()}</div></div>`;
        const del = document.createElement("button");
        del.className = "del"; del.textContent = "Delete";
        del.addEventListener("click", async () => {
          const r = await api(`/api/admin/announcements/${a.id}`, { method: "DELETE" });
          if (r.ok) { renderAnnounce(); loadOverview(); } else alert(r.message);
        });
        row.appendChild(del);
        list.appendChild(row);
      });
    }

    // Stats
    async function renderStats() {
      const box = document.getElementById("admStats");
      box.innerHTML = '<div class="lms-loading">Loading…</div>';
      const d = await api("/api/admin/overview");
      if (!d.ok) { box.innerHTML = `<div class="lms-empty">${escHtml(d.message)}</div>`; return; }
      const s = d.stats;
      let html = `<div class="stat-grid">
        <div class="stat-box"><div class="n">${s.modules}</div><div class="l">Modules</div></div>
        <div class="stat-box"><div class="n">${s.resources}</div><div class="l">Resources</div></div>
        <div class="stat-box"><div class="n">${s.totalDownloads}</div><div class="l">Downloads</div></div>
        <div class="stat-box"><div class="n">${s.announcements}</div><div class="l">Announcements</div></div>
      </div>`;
      if (s.topDownloads && s.topDownloads.length) {
        html += `<div class="rm-title" style="color:var(--pink-2);margin-bottom:8px">🔥 Most downloaded</div>`;
        s.topDownloads.forEach((r) => {
          html += `<div class="adm-row"><div class="info"><strong>${escHtml(r.title)}</strong><div class="meta">${escHtml(r.filename)}</div></div><span class="dl-badge">↓ ${r.downloads}</span></div>`;
        });
      }
      box.innerHTML = html;
    }

    async function onOpen() {
      if (token) { showDash(); } else { showLogin(""); }
    }

    return { onOpen, revealTab };
  })();

  // ------------------------------------------------------------ suggestions
  const SUGGESTIONS = [
    "What's due this week?", "List my courses", "What are my grades?",
    "What time is it?", "Weather in Tokyo", "Tell me a joke",
    "What is 15% of 240", "Set a timer for 1 minute",
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

    // Reveal the Admin tab only if the server has admin enabled.
    adminUI.revealTab();

    const hour = new Date().getHours();
    const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    botSay(`${part}, ${state.userName}. ${state.assistantName} online and ready.`);
  }

  init();
})();
