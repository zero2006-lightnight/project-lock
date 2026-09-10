/**
 * Smoke test for the built app (run after `npm run build`).
 * Boots `next start`, checks public pages, creates a real session row for the
 * demo user, and verifies authenticated pages render with seeded data.
 *
 *   node scripts/smoke.mjs
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

const PORT = 3100;
const BASE = process.env.BASE_URL ?? `http://localhost:${PORT}`;

function makeToken() {
  let t = "";
  const chars = "abcdef0123456789";
  for (let i = 0; i < 64; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

async function get(path, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual",
  });
  return { status: res.status, text: await res.text(), location: res.headers.get("location") };
}

const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(PORT) },
});
let out = "";
server.stdout.on("data", (d) => (out += d));
server.stderr.on("data", (d) => (out += d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    await wait(1000);
  }
  throw new Error("Server did not start:\n" + out.slice(-2000));
}

// Create an authenticated session for the demo user directly in SQLite.
function createSessionCookie() {
  const db = new Database("data/studypilot.db");
  const user = db.prepare("select id from users where email = 'demo@studypilot.app'").get();
  if (!user) throw new Error("Demo user missing — run `npm run seed` first");
  const token = makeToken();
  const hash = createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 86400000).toISOString();
  db.prepare("insert into sessions (id, user_id, token_hash, expires_at) values (?, ?, ?, ?)").run(
    `smoke-${Date.now()}`,
    user.id,
    hash,
    expires,
  );
  db.close();
  return `sp_session=${token}`;
}

const checks = [];
const check = (name, cond, extra = "") => {
  checks.push({ name, ok: Boolean(cond), extra });
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

try {
  await waitForServer();

  const home = await get("/");
  check("landing page", home.status === 200 && home.text.includes("StudyPilot") && home.text.includes("Build my study plan"));

  const login = await get("/login");
  check("login page", login.status === 200 && login.text.includes("demo@studypilot.app"));

  const appNoAuth = await get("/app");
  check("unauthenticated /app redirects", appNoAuth.status === 307 || appNoAuth.status === 302, String(appNoAuth.status));

  const cookie = createSessionCookie();

  const app = await get("/app", cookie);
  check("dashboard renders", app.status === 200 && app.text.includes("streak") && app.text.includes("Today's plan"), String(app.status));

  const today = await get("/app/today", cookie);
  check("today page", today.status === 200 && today.text.includes("planned"));

  const syllabus = await get("/app/syllabus", cookie);
  check("syllabus page", syllabus.status === 200 && syllabus.text.includes("Syllabus"));

  const exams = await get("/app/exams", cookie);
  check("exams page", exams.status === 200 && exams.text.includes("Readiness blends"), exams.status === 200 ? "missing exam content" : `status ${exams.status}`);
  check("exams assessment tabs", exams.status === 200 && exams.text.includes("Summary Practice"), "quiz/summary workspace");

  const tasks = await get("/app/tasks", cookie);
  check("tasks page", tasks.status === 200);

  const calendar = await get("/app/calendar", cookie);
  check("calendar page", calendar.status === 200 && calendar.text.includes("Study block"));

  const chat = await get("/app/chat", cookie);
  check("chat page", chat.status === 200 && chat.text.includes("Pilot"));

  const focus = await get("/app/focus", cookie);
  check("focus page", focus.status === 200 && focus.text.includes("Focus Mode"));

  const progress = await get("/app/progress", cookie);
  check(
    "progress page",
    progress.status === 200 && progress.text.includes("Total study time"),
    progress.status === 200 ? `missing metrics, len=${progress.text.length}` : `status ${progress.status}`,
  );

  const achievements = await get("/app/achievements", cookie);
  check("achievements page", achievements.status === 200 && achievements.text.includes("unlocked"));

  const settings = await get("/app/settings", cookie);
  check("settings page", settings.status === 200 && settings.text.includes("AI provider"));

  const tuning = await get("/app/tuning", cookie);
  check("tuning page", tuning.status === 200 && tuning.text.includes("Tuning"), tuning.status === 200 ? "missing tuning content" : `status ${tuning.status}`);

  const flashcards = await get("/app/flashcards", cookie);
  check("flashcards page", flashcards.status === 200 && flashcards.text.includes("Flashcards"), flashcards.status === 200 ? "missing flashcards content" : `status ${flashcards.status}`);

  const mindmaps = await get("/app/mindmaps", cookie);
  check("mindmaps page", mindmaps.status === 200 && mindmaps.text.includes("Mind Maps"), mindmaps.status === 200 ? "missing mindmaps content" : `status ${mindmaps.status}`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log("\n── server output ──\n" + out.slice(-5000));
    process.exitCode = 1;
  }
} catch (err) {
  console.error("SMOKE FAILURE:", err.message);
  process.exitCode = 1;
} finally {
  server.kill();
}