// JARVIS Web — Admin side (your OWN application's content).
//
// This is separate from the Moodle LMS integration. It manages resources that
// belong to *your* app: uploaded module materials, announcements, and download
// stats. Data is stored on the server (JSON metadata + files on disk).
//
// Auth model: a single admin passphrase (ADMIN_PASSWORD in .env) is exchanged
// for a short-lived server-side session token. No passwords are hardcoded; if
// ADMIN_PASSWORD is unset, the admin API is disabled entirely.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

let DATA_DIR = "";
let UPLOAD_DIR = "";
let DB_FILE = "";
let ADMIN_PASSWORD = "";

const sessions = new Map(); // token -> created ms
const SESSION_TTL = 1000 * 60 * 60 * 6; // 6 hours

let db = { modules: [], resources: [], announcements: [] };

export function init({ dataDir, adminPassword }) {
  DATA_DIR = dataDir;
  UPLOAD_DIR = path.join(dataDir, "uploads");
  DB_FILE = path.join(dataDir, "admin-db.json");
  ADMIN_PASSWORD = (adminPassword || "").trim();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  load();
}

export function enabled() {
  return Boolean(ADMIN_PASSWORD);
}

function load() {
  try {
    if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    db = { modules: [], resources: [], announcements: [] };
  }
  db.modules ||= [];
  db.resources ||= [];
  db.announcements ||= [];
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fsp.writeFile(DB_FILE, JSON.stringify(db, null, 2)).catch(() => {});
  }, 50);
}

const id = () => crypto.randomBytes(9).toString("hex");

// ---------------------------------------------------------------- auth
export function login(password) {
  if (!enabled()) throw httpErr(403, "Admin is not configured on this server.");
  if (password !== ADMIN_PASSWORD) throw httpErr(401, "Incorrect admin password.");
  const token = "adm_" + crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now());
  return token;
}

export function logout(token) {
  sessions.delete(token);
}

export function requireAdmin(token) {
  const created = sessions.get(token);
  if (!created || Date.now() - created > SESSION_TTL) {
    sessions.delete(token);
    throw httpErr(401, "Admin session expired. Please log in again.");
  }
  return true;
}

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// ---------------------------------------------------------------- modules
export function listModules() {
  return db.modules.map((m) => ({
    ...m,
    resourceCount: db.resources.filter((r) => r.moduleId === m.id).length,
  }));
}

export function addModule({ code, title }) {
  if (!title) throw httpErr(400, "Module title is required.");
  const m = { id: id(), code: (code || "").trim(), title: title.trim(), created: Date.now() };
  db.modules.push(m);
  save();
  return m;
}

export function updateModule(moduleId, { code, title }) {
  const m = db.modules.find((x) => x.id === moduleId);
  if (!m) throw httpErr(404, "Module not found.");
  if (code !== undefined) m.code = code.trim();
  if (title !== undefined) m.title = title.trim();
  save();
  return m;
}

export function deleteModule(moduleId) {
  const idx = db.modules.findIndex((x) => x.id === moduleId);
  if (idx === -1) throw httpErr(404, "Module not found.");
  // Remove the module's resources + files too.
  const orphans = db.resources.filter((r) => r.moduleId === moduleId);
  for (const r of orphans) removeFile(r.storedName);
  db.resources = db.resources.filter((r) => r.moduleId !== moduleId);
  db.modules.splice(idx, 1);
  save();
  return { ok: true };
}

// ---------------------------------------------------------------- resources
export function listResources(moduleId) {
  let rows = db.resources;
  if (moduleId) rows = rows.filter((r) => r.moduleId === moduleId);
  return rows
    .slice()
    .sort((a, b) => b.created - a.created)
    .map((r) => ({
      id: r.id,
      moduleId: r.moduleId,
      title: r.title,
      filename: r.filename,
      size: r.size,
      mimetype: r.mimetype,
      created: r.created,
      downloads: r.downloads || 0,
    }));
}

export function addResource({ moduleId, title, file }) {
  const mod = db.modules.find((x) => x.id === moduleId);
  if (!mod) throw httpErr(400, "Choose a valid module for this resource.");
  if (!file) throw httpErr(400, "No file was uploaded.");
  const storedName = id() + path.extname(file.originalname || file.filename || "");
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), file.buffer);
  const r = {
    id: id(),
    moduleId,
    title: (title || file.originalname || "Untitled").trim(),
    filename: file.originalname || storedName,
    storedName,
    size: file.size ?? file.buffer.length,
    mimetype: file.mimetype || "application/octet-stream",
    created: Date.now(),
    downloads: 0,
  };
  db.resources.push(r);
  save();
  return listResources().find((x) => x.id === r.id);
}

export function deleteResource(resourceId) {
  const idx = db.resources.findIndex((x) => x.id === resourceId);
  if (idx === -1) throw httpErr(404, "Resource not found.");
  removeFile(db.resources[idx].storedName);
  db.resources.splice(idx, 1);
  save();
  return { ok: true };
}

// Returns { stream-able path, meta } and bumps the download counter.
export function getResourceFile(resourceId, { count = true } = {}) {
  const r = db.resources.find((x) => x.id === resourceId);
  if (!r) throw httpErr(404, "Resource not found.");
  const full = path.join(UPLOAD_DIR, r.storedName);
  if (!fs.existsSync(full)) throw httpErr(404, "File is missing on the server.");
  if (count) {
    r.downloads = (r.downloads || 0) + 1;
    save();
  }
  return { path: full, filename: r.filename, mimetype: r.mimetype };
}

function removeFile(storedName) {
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, storedName));
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------- announcements
export function listAnnouncements() {
  return db.announcements.slice().sort((a, b) => b.created - a.created);
}

export function addAnnouncement({ title, body }) {
  if (!title && !body) throw httpErr(400, "An announcement needs a title or body.");
  const a = { id: id(), title: (title || "").trim(), body: (body || "").trim(), created: Date.now() };
  db.announcements.push(a);
  save();
  return a;
}

export function deleteAnnouncement(annId) {
  const idx = db.announcements.findIndex((x) => x.id === annId);
  if (idx === -1) throw httpErr(404, "Announcement not found.");
  db.announcements.splice(idx, 1);
  save();
  return { ok: true };
}

// ---------------------------------------------------------------- stats
export function stats() {
  const totalDownloads = db.resources.reduce((s, r) => s + (r.downloads || 0), 0);
  const top = db.resources
    .slice()
    .sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
    .slice(0, 5)
    .map((r) => ({ title: r.title, filename: r.filename, downloads: r.downloads || 0 }));
  return {
    modules: db.modules.length,
    resources: db.resources.length,
    announcements: db.announcements.length,
    totalDownloads,
    topDownloads: top,
  };
}

// ---------------------------------------------------------------- public (student-facing)
// Read-only catalog for students: modules with their resources + announcements.
export function publicCatalog() {
  return {
    modules: db.modules.map((m) => ({
      id: m.id,
      code: m.code,
      title: m.title,
      resources: db.resources
        .filter((r) => r.moduleId === m.id)
        .sort((a, b) => b.created - a.created)
        .map((r) => ({
          id: r.id,
          title: r.title,
          filename: r.filename,
          size: r.size,
          mimetype: r.mimetype,
          downloads: r.downloads || 0,
        })),
    })),
    announcements: listAnnouncements(),
  };
}
