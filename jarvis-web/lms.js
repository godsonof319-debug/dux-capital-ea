// JARVIS Web — Moodle LMS integration (legitimate, credential-based).
//
// This talks to a Moodle site (e.g. IUM's elearn.ium.edu.na) using Moodle's
// OFFICIAL Web Services API — the same mechanism the official Moodle Mobile app
// uses. There are NO hardcoded secrets and NO password formulas:
//
//   1. The student submits THEIR OWN username + password to our backend.
//   2. We exchange those for a per-user token via /login/token.php.
//   3. The token is stored SERVER-SIDE only, keyed to an opaque session id.
//   4. All data calls use that token; the browser never sees it.
//
// For this to return live data, the Moodle site must have Web Services enabled
// and the "Moodle mobile web service" turned on (it is, by default, on most
// Moodle installs). If a school disables it, login will fail cleanly with a
// message — we never try to bypass anything.

import crypto from "node:crypto";

// The Moodle mobile service shortname is standard across Moodle installs.
const MOBILE_SERVICE = "moodle_mobile_app";

// Server-side session store: sessionId -> { base, token, user, created }
const store = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

function newSessionId() {
  return "lms_" + crypto.randomBytes(24).toString("hex");
}

function pruneSessions() {
  const now = Date.now();
  for (const [id, s] of store) {
    if (now - s.created > SESSION_TTL_MS) store.delete(id);
  }
}
setInterval(pruneSessions, 1000 * 60 * 30).unref?.();

function normalizeBase(url) {
  let u = (url || "").trim().replace(/\/+$/, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// Low-level: call a Moodle web service function with a token.
async function callFunction(base, token, wsfunction, params = {}) {
  const url = new URL(base + "/webservice/rest/server.php");
  const body = new URLSearchParams({
    wstoken: token,
    wsfunction,
    moodlewsrestformat: "json",
    ...flatten(params),
  });
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await resp.json().catch(() => null);
  if (data && data.exception) {
    const err = new Error(data.message || "Moodle API error");
    err.moodle = data;
    throw err;
  }
  return data;
}

// Moodle expects array/object params flattened like a[0][id]=5.
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === "object") flatten(v, key, out);
    else if (v !== undefined) out[key] = String(v);
  }
  return out;
}

// ---------------------------------------------------------------- public API

// Exchange the student's own credentials for a token.
export async function login(rawBase, username, password) {
  const base = normalizeBase(rawBase);
  if (!base) throw new Error("No LMS URL configured.");
  const url = new URL(base + "/login/token.php");
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username,
        password,
        service: MOBILE_SERVICE,
      }),
    });
  } catch {
    throw new Error(
      `Couldn't reach the LMS at ${new URL(base).host}. Check the LMS_URL and your connection.`
    );
  }
  const data = await resp.json().catch(() => null);
  if (!data) throw new Error("The LMS did not respond correctly.");
  if (data.error) {
    // Moodle returns a friendly-ish error (e.g. invalid login, WS disabled).
    throw new Error(data.error);
  }
  if (!data.token) throw new Error("Login failed: no token returned.");

  // Fetch the user profile so we can greet them and get their userid.
  let user = null;
  try {
    const info = await callFunction(base, data.token, "core_webservice_get_site_info");
    user = {
      id: info.userid,
      fullname: info.fullname,
      username: info.username,
      sitename: info.sitename,
      userpictureurl: info.userpictureurl,
    };
  } catch {
    /* profile is optional */
  }

  const sessionId = newSessionId();
  store.set(sessionId, { base, token: data.token, user, created: Date.now() });
  return { sessionId, user };
}

function requireSession(sessionId) {
  const s = store.get(sessionId);
  if (!s) {
    const err = new Error("Your LMS session expired. Please log in again.");
    err.code = "NO_SESSION";
    throw err;
  }
  return s;
}

export function logout(sessionId) {
  store.delete(sessionId);
}

export function getUser(sessionId) {
  return store.get(sessionId)?.user || null;
}

// The student's enrolled courses.
export async function getCourses(sessionId) {
  const s = requireSession(sessionId);
  const uid = s.user?.id;
  if (!uid) throw new Error("Missing user id; please log in again.");
  const courses = await callFunction(s.base, s.token, "core_enrol_get_users_courses", {
    userid: uid,
  });
  return (courses || []).map((c) => ({
    id: c.id,
    shortname: c.shortname,
    fullname: c.fullname,
    progress: c.progress ?? null,
    startdate: c.startdate,
    enddate: c.enddate,
  }));
}

// Contents (sections + modules + files) of one course.
export async function getCourseContents(sessionId, courseId) {
  const s = requireSession(sessionId);
  const sections = await callFunction(s.base, s.token, "core_course_get_contents", {
    courseid: courseId,
  });
  // Append the token to file URLs so the client can download via our proxy.
  return (sections || []).map((sec) => ({
    id: sec.id,
    name: sec.name,
    summary: sec.summary,
    modules: (sec.modules || []).map((m) => ({
      id: m.id,
      name: m.name,
      modname: m.modname,
      modicon: m.modicon,
      url: m.url || null,
      description: m.description || "",
      contents: (m.contents || []).map((f) => ({
        type: f.type,
        filename: f.filename,
        filesize: f.filesize,
        mimetype: f.mimetype,
        timemodified: f.timemodified,
        fileurl: f.fileurl, // proxied for download (token added server-side)
      })),
    })),
  }));
}

// Assignments across the student's courses.
export async function getAssignments(sessionId) {
  const s = requireSession(sessionId);
  const data = await callFunction(s.base, s.token, "mod_assign_get_assignments");
  const out = [];
  for (const course of data?.courses || []) {
    for (const a of course.assignments || []) {
      out.push({
        id: a.id,
        cmid: a.cmid,
        course: course.fullname,
        courseid: course.id,
        name: a.name,
        duedate: a.duedate,
        allowsubmissionsfromdate: a.allowsubmissionsfromdate,
        intro: a.intro,
      });
    }
  }
  // Soonest due first (0 = no due date, push to the end).
  out.sort((x, y) => (x.duedate || Infinity) - (y.duedate || Infinity));
  return out;
}

// Grades for a course.
export async function getGrades(sessionId, courseId) {
  const s = requireSession(sessionId);
  const uid = s.user?.id;
  const data = await callFunction(s.base, s.token, "gradereport_user_get_grade_items", {
    courseid: courseId,
    userid: uid,
  });
  const table = data?.usergrades?.[0]?.gradeitems || [];
  return table.map((g) => ({
    itemname: g.itemname,
    itemtype: g.itemtype,
    grade: g.gradeformatted,
    range: g.rangeformatted,
    percentage: g.percentageformatted,
    feedback: g.feedback,
  }));
}

// Upcoming calendar events.
export async function getCalendar(sessionId) {
  const s = requireSession(sessionId);
  const data = await callFunction(s.base, s.token, "core_calendar_get_calendar_upcoming_view").catch(
    () => null
  );
  const events = data?.events || [];
  return events.map((e) => ({
    id: e.id,
    name: e.name,
    timestart: e.timestart,
    course: e.course?.fullname || null,
    url: e.url || null,
  }));
}

// Stream a Moodle file through our backend so the token stays server-side.
export async function proxyFile(sessionId, fileUrl, res) {
  const s = requireSession(sessionId);
  // Only allow files from the same Moodle host we're logged into.
  let target;
  try {
    target = new URL(fileUrl);
  } catch {
    throw new Error("Invalid file URL.");
  }
  const baseHost = new URL(s.base).host;
  if (target.host !== baseHost) throw new Error("Refusing to fetch a file from another host.");

  // Moodle file URLs accept the token via the `token` query param.
  target.searchParams.set("token", s.token);
  const upstream = await fetch(target);
  if (!upstream.ok) throw new Error("File download failed (" + upstream.status + ").");

  const ct = upstream.headers.get("content-type");
  const cd = upstream.headers.get("content-disposition");
  if (ct) res.setHeader("Content-Type", ct);
  if (cd) res.setHeader("Content-Disposition", cd);
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.send(buf);
}
