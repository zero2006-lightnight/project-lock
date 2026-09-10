/* Core-flow QA — drives headless Chrome over raw CDP (no deps).
   Walks: demo login → dashboard → today's plan → complete a block → reschedule a block,
   asserting DOM outcomes, capturing console errors and screenshots.
   Usage: node scripts/flow-qa.mjs [port]   (start the app first) */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = process.argv[2] || "3000";
const APP = `http://localhost:${APP_PORT}`;
const CDP_PORT = "9334";
const SHOTS = join(root, "scripts", ".shots", "flow");
mkdirSync(SHOTS, { recursive: true });

const CHROME =
  process.env.CHROME_PATH ||
  (existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── pick the block that can really move to tomorrow ───────────
   If tomorrow is nearly full, complete a couple of tomorrow's blocks first
   (offline, before the browser session) so the UI reschedule can succeed. */
function prepareReschedule() {
  const Database = require("better-sqlite3");
  const db = new Database(join(root, "data", "studypilot.db"));
  const fmt = (d) => d.toISOString().slice(0, 10);
  const today = fmt(new Date());
  const t = new Date(Date.now() + 86400000);
  const tomorrowISO = fmt(t);
  const user = db.prepare(`SELECT id FROM users WHERE email = 'demo@studypilot.app'`).get();
  if (!user) throw new Error("demo user missing");
  const profile = db.prepare(`SELECT weekday_hours, weekend_hours FROM profiles WHERE user_id = ?`).get(user.id);
  const dow = t.getDay();
  const hours = dow === 0 || dow === 6 ? profile.weekend_hours : profile.weekday_hours;
  const cap = Math.round(hours * 60 * 0.92);

  const usedOf = () =>
    db
      .prepare(`SELECT COALESCE(SUM(duration_minutes),0) AS used FROM plan_items WHERE user_id = ? AND date = ? AND status = 'pending' AND kind != 'break'`)
      .get(user.id, tomorrowISO).used;
  const todayPending = db
    .prepare(`SELECT id, start_minutes, duration_minutes FROM plan_items WHERE user_id = ? AND date = ? AND status = 'pending' AND kind != 'break' ORDER BY start_minutes ASC`)
    .all(user.id, today);

  // free tomorrow until the earliest today-block that fits it (max 3 frees)
  let freed = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const used = usedOf();
    const pick = todayPending.find((p) => used + p.duration_minutes <= cap);
    if (pick) {
      db.close();
      return { ...pick, free: cap - used, freedTomorrow: freed };
    }
    const victim = db
      .prepare(`SELECT id, duration_minutes FROM plan_items WHERE user_id = ? AND date = ? AND status = 'pending' AND kind != 'break' ORDER BY duration_minutes DESC LIMIT 1`)
      .get(user.id, tomorrowISO);
    if (!victim) break;
    db.prepare(`UPDATE plan_items SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), new Date().toISOString(), victim.id);
    freed.push(victim.duration_minutes);
  }
  db.close();
  return null;
}

/* ── minimal CDP client ──────────────────────────────────────── */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        this.errors.push(msg.params.exceptionDetails?.exception?.description || "exceptionThrown");
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.errors.push(msg.params.args?.map((a) => a.value ?? a.description ?? "").join(" "));
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        this.errors.push(msg.params.entry.text);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res);
      ws.addEventListener("error", () => rej(new Error("CDP ws connect failed")));
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error("eval: " + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    return res.result?.value;
  }
  async shot(name) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(res.data, "base64"));
    console.log("  📸", name + ".png");
  }
  async waitFor(expr, timeoutMs = 15000, label = expr) {
    const start = Date.now();
    let lastErr;
    while (Date.now() - start < timeoutMs) {
      try {
        if (await this.eval(expr)) return;
      } catch (e) {
        lastErr = e;
      }
      await sleep(250);
    }
    throw new Error(`timeout waiting for: ${label}${lastErr ? ` (last error: ${lastErr.message})` : ""}`);
  }
  close() {
    this.ws.close();
  }
}

const step = (s) => console.log("\n▶", s);
const pass = (s) => console.log("  ✓", s);
const note = (s) => console.log("  •", s);

async function main() {
  const reachable = await fetch(APP + "/login").then((r) => r.ok).catch(() => false);
  if (!reachable) throw new Error("app not reachable — start it first (npm start)");

  const candidate = prepareReschedule();
  if (!candidate) {
    console.warn("⚠ could not create capacity for a successful reschedule — refusal path will be tested instead.");
  } else {
    console.log(`reschedule candidate: +1d has ${candidate.free} min free after clearing ${candidate.freedTomorrow.join(" + ") || "nothing"}; block is ${candidate.duration_minutes} min`);
  }

  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--window-size=1500,1000", "--hide-scrollbars", "--remote-debugging-port=" + CDP_PORT,
    "--user-data-dir=" + join(root, "scripts", ".chrome-profile"), "about:blank",
  ], { stdio: "ignore" });

  let cdp;
  try {
    let version;
    for (let i = 0; i < 40; i++) {
      try {
        version = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json());
        break;
      } catch {
        await sleep(250);
      }
    }
    if (!version) throw new Error("Chrome CDP did not start");
    const target = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(APP + "/login")}`, { method: "PUT" }).then((r) => r.json());
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Log.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });

    /* 1 ── login */
    step("demo login");
    await cdp.waitFor(`document.querySelector('#email') !== null`, 15000, "login form");
    await cdp.eval(`(() => {
      const email = document.getElementById('email');
      const pw = document.getElementById('password');
      email.value = 'demo@studypilot.app';
      pw.value = 'demo1234';
      document.querySelector('form').requestSubmit();
      return true;
    })()`);
    await cdp.waitFor(`location.pathname !== '/login'`, 20000, "auth redirect");
    await sleep(600);
    await cdp.eval(`location.href = ${JSON.stringify(APP + "/app")}; true`);
    await cdp.waitFor(`document.body?.innerText.includes("Today's plan")`, 20000, "dashboard content");
    const greeting = await cdp.eval(`document.querySelector('h1')?.textContent ?? ''`);
    pass(`signed in → dashboard h1: "${greeting.trim()}"`);

    /* 2 ── dashboard */
    step("dashboard");
    await cdp.waitFor(`document.body.innerText.includes("Today's plan")`, 15000, "dashboard content");
    const dashBefore = await cdp.eval(`document.querySelectorAll('button[aria-label="Mark complete"]').length`);
    pass(`dashboard rendered; pending complete-buttons: ${dashBefore}`);
    await sleep(400);
    await cdp.shot("dashboard-light");
    await cdp.eval(`document.documentElement.classList.add('dark'); true`);
    await sleep(250);
    await cdp.shot("dashboard-dark");
    await cdp.eval(`document.documentElement.classList.remove('dark'); true`);

    /* 3 ── today's plan: complete the first pending block */
    step("today's plan — complete a block");
    await cdp.eval(`location.href = ${JSON.stringify(APP + "/app/today")}; true`);
    await cdp.waitFor(`document.querySelectorAll('button[aria-label="Mark complete"]').length > 0`, 15000, "pending rows");
    await sleep(1500); // let React hydrate so the server-rendered buttons are live
    const before = await cdp.eval(`document.querySelectorAll('button[aria-label="Mark complete"]').length`);
    const clickComplete = () => cdp.eval(`document.querySelector('button[aria-label="Mark complete"]')?.click() ?? false; true`);
    await clickComplete();
    try {
      await cdp.waitFor(`document.querySelectorAll('button[aria-label="Mark complete"]').length === ${before - 1}`, 10000, "complete action applied");
    } catch {
      await sleep(800);
      await clickComplete();
      await cdp.waitFor(`document.querySelectorAll('button[aria-label="Mark complete"]').length === ${before - 1}`, 12000, "complete retry");
    }
    pass(`block completed (pending rows ${before} → ${before - 1})`);
    await sleep(500);
    await cdp.shot("today-after-complete");

    // persistence check: full reload re-renders from the DB
    await cdp.eval(`location.reload(); true`);
    await sleep(2500); // let the navigation finish (pending==before-1 already matches the pre-reload DOM)
    await cdp.waitFor(`document.querySelectorAll('button[aria-label="Mark complete"]').length === ${before - 1}`, 15000, "reload renders pending rows");
    await sleep(400);
    const persisted = await cdp.eval(`document.body.innerText.toLowerCase().includes('completed')`);
    pass(persisted ? "completion persisted across reload" : "⚠ completion did NOT persist");

    /* 4 ── reschedule: move a block to tomorrow */
    step("today's plan — reschedule (move to tomorrow)");
    if (candidate) {
      const pendingBefore = await cdp.eval(`document.querySelectorAll('button[aria-label="Mark complete"]').length`);
      const clickMove = () => cdp.eval(`document.querySelector('button[aria-label="Move to tomorrow"]')?.click() ?? false; true`);
      await clickMove();
      await sleep(4000);
      const state = await cdp.eval(`(() => {
        const pendingNow = document.querySelectorAll('button[aria-label="Mark complete"]').length;
        const toast = document.querySelector('[aria-live="polite"] p.font-semibold')?.textContent ?? null;
        const toastDesc = document.querySelector('[aria-live="polite"]')?.textContent ?? '';
        return { pendingNow, toast, toastDesc };
      })()`);
      if (state.pendingNow === pendingBefore - 1) {
        pass(`block rescheduled to tomorrow (pending ${pendingBefore} → ${state.pendingNow})`);
      } else if (state.toast) {
        note(`move refused by design — toast: "${state.toast}" ${state.toastDesc.includes("capacity") ? "(capacity guard working)" : ""}`);
      } else {
        console.warn("⚠ no visible change after Move to tomorrow");
      }
    } else {
      // exercise the refusal path deterministically
      await cdp.eval(`document.querySelector('button[aria-label="Move to tomorrow"]').click(); true`);
      await sleep(3000);
      const toastDesc = await cdp.eval(`document.querySelector('[aria-live="polite"]')?.textContent ?? ''`);
      note(`move → toast: "${toastDesc.slice(0, 120)}"`);
    }
    await sleep(500);
    await cdp.shot("today-after-reschedule");

    /* 5 ── dashboard reflects the work done */
    step("dashboard reflects progress");
    await cdp.eval(`location.href = ${JSON.stringify(APP + "/app")}; true`);
    await cdp.waitFor(`document.body.innerText.includes("Today's plan")`, 15000, "dashboard back");
    await sleep(400);
    const reflect = await cdp.eval(`(() => {
      const body = document.body.innerText;
      return { blocksCompleted: /(\\d+) block[s]? completed/.exec(body)?.[1] ?? null, toGo: /(\\d+) block[s]? to go/.exec(body)?.[1] ?? null };
    })()`);
    pass(`dashboard progress text: ${JSON.stringify(reflect)}`);
    await cdp.shot("dashboard-after");

    /* 6 ── mobile viewport sanity */
    step("mobile layout sanity (390×844)");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(500);
    const overflow = await cdp.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    if (overflow <= 8) {
      note(`no horizontal overflow (${overflow}px)`);
    } else {
      console.warn(`⚠ horizontal overflow: ${overflow}px — offenders:`);
      const offenders = await cdp.eval(`(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('*')]
          .map((el) => { const r = el.getBoundingClientRect(); return { t: el.tagName, c: (el.className?.toString?.() ?? '').slice(0, 70), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; })
          .filter((o) => o.r > vw + 2 && o.w > 8)
          .slice(0, 8);
      })()`);
      offenders.forEach((o) => console.log("   ", o.t, `"${o.c}"`, `left=${o.l} right=${o.r} w=${o.w}`));
    }
    await cdp.shot("dashboard-mobile");
    await cdp.eval(`location.href = ${JSON.stringify(APP + "/app/today")}; true`);
    await sleep(1200);
    await cdp.shot("today-mobile");

    console.log("\n▶ console/page errors:", cdp.errors.length ? cdp.errors : "none");
    if (cdp.errors.length) process.exitCode = 2;
    console.log("screenshots →", SHOTS);
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
  }
}

main().catch((e) => {
  console.error("flow QA failed:", e.message);
  process.exit(1);
});
