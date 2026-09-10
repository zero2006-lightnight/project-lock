/* LLM-path E2E QA — drives headless Chrome over raw CDP (no deps).
   Sends tutor / quiz / flashcard prompts through the real /app/chat UI and
   asserts the replies came from the connected provider (not the offline
   fallback), plus checks the Settings AI panel and console errors.
   Usage: node scripts/ai-qa.mjs [port]   (start the app first, with .env keyed) */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = process.argv[2] || "3000";
const APP = `http://localhost:${APP_PORT}`;
const CDP_PORT = "9336";
const SHOTS = join(root, "scripts", ".shots", "ai");
mkdirSync(SHOTS, { recursive: true });
const CHROME =
  process.env.CHROME_PATH ||
  (existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") this.errors.push(msg.params.exceptionDetails?.exception?.description || "exceptionThrown");
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") this.errors.push(msg.params.args?.map((a) => a.value ?? a.description ?? "").join(" "));
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") this.errors.push(msg.params.entry.text);
    });
  }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", () => rej(new Error("CDP connect failed"))); }); return new CDP(ws); }
  send(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression) { const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result?.value; }
  async shot(name) { const res = await this.send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(res.data, "base64")); console.log("  📸", name + ".png"); }
  async waitFor(expr, timeoutMs = 15000, label = expr) {
    const start = Date.now(); let lastErr;
    while (Date.now() - start < timeoutMs) { try { if (await this.eval(expr)) return; } catch (e) { lastErr = e; } await sleep(300); }
    throw new Error(`timeout waiting for: ${label}${lastErr ? ` (${lastErr.message})` : ""}`);
  }
  close() { this.ws.close(); }
}

const step = (s) => console.log("\n▶", s);
const pass = (s) => console.log("  ✓", s);
const fail = (s) => { console.log("  ✗", s); process.exitCode = 1; };

async function main() {
  const reachable = await fetch(APP + "/login").then((r) => r.ok).catch(() => false);
  if (!reachable) throw new Error("app not reachable — start it first (npm start)");

  // Fresh browser state every run — a stored session cookie would make
  // /login auto-redirect to /app and the login step would never see the form.
  const profileDir = join(root, "scripts", ".chrome-profile");
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* locked by a zombie chrome */ }
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--window-size=1400,900", "--hide-scrollbars", "--remote-debugging-port=" + CDP_PORT, "--user-data-dir=" + profileDir, "about:blank"], { stdio: "ignore" });
  let cdp;
  try {
    let version;
    for (let i = 0; i < 40; i++) { try { version = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json()); break; } catch { await sleep(250); } }
    if (!version) throw new Error("Chrome CDP did not start");
    const target = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(APP + "/login")}`, { method: "PUT" }).then((r) => r.json());
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable"); await cdp.send("Page.enable"); await cdp.send("Log.enable");

    step("login");
    await cdp.waitFor(`document.querySelector('#email') !== null`, 15000, "login form");
    await cdp.eval(`(() => { const e = document.getElementById('email'); const p = document.getElementById('password'); e.value='demo@studypilot.app'; p.value='demo1234'; document.querySelector('form').requestSubmit(); return true; })()`);
    await cdp.waitFor(`location.pathname !== '/login'`, 20000, "auth redirect");
    await sleep(700);
    await cdp.eval(`location.href = ${JSON.stringify(APP + "/app/chat")}; true`);
    await cdp.waitFor(`document.querySelector('textarea[aria-label="Message Pilot"]') !== null`, 20000, "chat composer");
    await sleep(1500); // hydration
    // Let persisted history finish rendering before counting bubbles: wait for
    // the bubble count to hold steady for 2 consecutive seconds.
    {
      let last = -1, stable = 0;
      for (let i = 0; i < 30 && stable < 2; i++) {
        const n = await cdp.eval(`document.querySelectorAll('.rounded-bl-md').length`);
        stable = n === last ? stable + 1 : 0;
        last = n;
        await sleep(1000);
      }
    }
    pass("signed in, chat composer ready");

    /** Ground-truth reply reader: poll the DB for a NEW persisted assistant row. */
    const db = new Database(join(root, "data", "studypilot.db"), { readonly: true });
    const lastReplyAt = () => db
      .prepare("SELECT created_at, content FROM chat_messages WHERE role = 'assistant' ORDER BY created_at DESC LIMIT 1")
      .get();

    const sendAndRead = async (prompt) => {
      // Free-tier providers throttle bursts; pause so a 429 doesn't fail the next check.
      await sleep(12000);
      const before = lastReplyAt();
      await cdp.eval(`(() => {
        const el = document.querySelector('textarea[aria-label="Message Pilot"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(prompt)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await sleep(200);
      await cdp.eval(`document.querySelector('button[aria-label="Send message"]').click(); true`);
      // Single poll loop against GROUND TRUTH (the DB): a new persisted
      // assistant row after `before` proves the whole secured pipeline ran —
      // action → rate limit → guard → router → provider → validation → persist.
      // The DOM toast is watched as a secondary signal for provider errors.
      let toastText = "";
      const outcome = await (async () => {
        const start = Date.now();
        while (Date.now() - start < 120000) {
          const row = lastReplyAt();
          if (row && (!before || row.created_at > before.created_at)) return "bubble";
          const toast = await cdp.eval(`document.querySelector('[role="alert"]')?.innerText || ""`).catch(() => "");
          if (toast && !toastText) toastText = toast;
          await sleep(1000);
        }
        return "timeout";
      })();
      if (outcome === "bubble") {
        const row = lastReplyAt();
        return { count: -1, last: row?.content ?? "" };
      }
      if (toastText) return { count: -1, last: `ERROR TOAST: ${toastText}` };
      throw new Error("timeout waiting for: assistant reply (no new DB row)");
      await sleep(600);
      const bubbles = await cdp.eval(`[...document.querySelectorAll('.rounded-bl-md')].map((b) => b.innerText.trim())`);
      const last = bubbles[bubbles.length - 1] ?? "";
      return { count: bubbles.length, last };
    };

    const offlineMarkers = /offline engine mode|connect an AI provider|AI provider.*Settings|one-line setup/i;

    step("tutor — explain normalization");
    const tutor = await sendAndRead("Explain normalization in DBMS, with an example of 1NF to BCNF");
    const tutorOk = tutor.last.length > 200 && !offlineMarkers.test(tutor.last) && /(normal|1nf|2nf|3nf|bcnf|functional dependency|decompos)/i.test(tutor.last);
    console.log("  reply preview:", tutor.last.replace(/\n+/g, " · ").slice(0, 220));
    if (tutorOk) pass(`tutor replied with a real explanation (${tutor.last.length} chars)`);
    else fail("tutor reply looks like the offline fallback or is too short");
    await cdp.shot("chat-tutor");

    step("quiz — quiz me on DBMS transactions");
    const quiz = await sendAndRead("Quiz me on DBMS transactions");
    const quizQ = (quiz.last.match(/\d+[.)]/g) ?? []).length;
    const quizOk = quiz.last.length > 150 && !offlineMarkers.test(quiz.last) && quiz.last.includes("?") && quizQ >= 2;
    console.log("  reply preview:", quiz.last.replace(/\n+/g, " · ").slice(0, 220), `| questions detected: ${quizQ}`);
    if (quizOk) pass(`quiz generated with ${quizQ} numbered questions`);
    else fail("quiz reply not recognized as a question set");
    await cdp.shot("chat-quiz");

    step("flashcards — create flashcards for normalization");
    const cards = await sendAndRead("Create flashcards for normalization");
    const fb = /\bfront\b/i.test(cards.last) && /\bback\b/i.test(cards.last);
    const qa = (cards.last.match(/\bq\b\s*:/gi) ?? []).length >= 2 && (cards.last.match(/\ba\b\s*:/gi) ?? []).length >= 2;
    const cardOk = cards.last.length > 150 && !offlineMarkers.test(cards.last) && (fb || qa);
    console.log("  reply preview:", cards.last.replace(/\n+/g, " · ").slice(0, 220));
    console.log("  format →", fb ? "Front/Back" : qa ? "Q/A pairs" : "unrecognized");
    if (cardOk) pass("flashcards generated with a recognizable card structure");
    else fail("flashcard reply not recognized (no Front/Back or Q/A pairs)");
    await cdp.shot("chat-flashcards");

    step("settings AI panel");
    await cdp.eval(`location.href = ${JSON.stringify(APP + "/app/settings")}; true`);
    await cdp.waitFor(`document.body.innerText.toLowerCase().includes('ai provider')`, 20000, "AI provider panel");
    const settingsText = await cdp.eval(`document.body.innerText`);
    const connected = /qwen\/qwen3\.8-27b|openai|groq|built-in engine mode/i.test(settingsText);
    console.log("  settings AI row sample:", settingsText.slice(settingsText.toLowerCase().indexOf("ai provider"), settingsText.toLowerCase().indexOf("ai provider") + 160).replace(/\n+/g, " · "));
    if (/built-in engine mode/i.test(settingsText)) fail("Settings still reports built-in engine mode — provider not active");
    else if (connected) pass("Settings shows the connected provider + model");
    else fail("could not confirm provider status in Settings");

    console.log("\n▶ console/page errors:", cdp.errors.length ? cdp.errors : "none");
    if (cdp.errors.length) process.exitCode = 2;
    console.log("screenshots →", SHOTS);
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
  }
}

main().catch((e) => { console.error("AI QA failed:", e.message); process.exit(1); });
