/* Assessment workspace QA — drives headless Chrome over raw CDP (no deps).
   Verifies the Exams tabs render, Quiz/Summary panes mount, mobile (390px)
   has zero horizontal overflow, and no console errors appear.
   DOM-level only: no AI quota is spent.
   Usage: node scripts/assess-qa.mjs   (boots its own server on :3200) */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = process.argv[2] || "3210";
const APP = `http://localhost:${APP_PORT}`;
const CDP_PORT = "9340";
const PROFILE_D = join(root, "scripts", `.chrome-assess-d-${process.pid}`);
const PROFILE_M = join(root, "scripts", `.chrome-assess-m-${process.pid}`);
const rmDir = async (p) => {
  try { (await import("node:fs")).rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
};

async function launchChrome(cdpPort, profile) {
  await rmDir(profile);
  const proc = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=390,844",
    "--hide-scrollbars",
    "--remote-debugging-port=" + cdpPort,
    "--user-data-dir=" + profile,
    "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    try {
      await fetchJson(`http://127.0.0.1:${cdpPort}/json/version`);
      return proc;
    } catch {
      await sleep(250);
    }
  }
  try { proc.kill(); } catch { /* already gone */ }
  throw new Error("Chrome CDP did not start");
}

// Never hang silently: overall watchdog kills stalled runs.
const watchdog = setTimeout(() => {
  console.error("ASSESS QA FAILURE: global timeout");
  process.exit(2);
}, 240000);
watchdog.unref?.();

const CHROME =
  process.env.CHROME_PATH ||
  (existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${opts?.method ?? "GET"} ${url} -> ${res.status}`);
  return res.json();
}

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
  async waitFor(expr, timeoutMs = 15000, label = expr) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.eval(expr)) return;
      await sleep(250);
    }
    throw new Error(`timeout waiting for: ${label}`);
  }
  close() {
    this.ws.close();
  }
}

const checks = [];
const check = (name, cond, extra = "") => {
  checks.push({ name, ok: Boolean(cond) });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [nextBin, "start", "-p", APP_PORT], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: APP_PORT },
});
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${APP}/login`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error("server did not start");
}

try {
  await waitForServer();
  let chrome = await launchChrome(CDP_PORT, PROFILE_D);

  const newTarget = async (url, w = 390, h = 844) => {
    const target = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    const cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    return cdp;
  };

  // Desktop pass: login + tabs present
  let cdp = await newTarget(`${APP}/login`, 1280, 900);
  await cdp.waitFor(`document.getElementById('email') !== null`, 20000, "login form");
  await cdp.eval(`(() => {
    const fill = document.querySelector('[data-demo-fill]') ?? [...document.querySelectorAll('button')].find(b => b.textContent.includes('Try the demo'));
    if (fill) fill.click();
    const email = document.getElementById('email');
    const pw = document.getElementById('password');
    for (const [el, val] of [[email, 'demo@studypilot.app'], [pw, 'demo1234']]) {
      el.focus();
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.querySelector('form').requestSubmit();
    return true;
  })()`);
  await cdp.waitFor(`location.pathname.startsWith('/app')`, 20000, "post-login app");
  await cdp.eval(`location.href = '${APP}/app/exams'`);
  await cdp.waitFor(`document.body.textContent.includes('Summary Practice')`, 20000, "assessment tabs");
  check("exams tabs render (Overview/Quiz/Summary)", true);
  const overviewHas = await cdp.eval(`document.body.textContent.includes('Readiness blends')`);
  check("overview preserved", overviewHas === true);

  // Quiz pane mounts (exact tab match + selected-state retry)
  const clickTab = async (name, marker, timeoutMs = 15000) => {
    await cdp.waitFor(
      `(async () => {
        const el = [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === '${name}');
        if (!el) return false;
        el.scrollIntoView({ block: 'nearest' });
        el.click();
        await new Promise(r => setTimeout(r, 400));
        return el.getAttribute('aria-selected') === 'true' && ${marker};
      })()`,
      timeoutMs,
      `tab ${name}`,
    );
  };
  await clickTab("Quiz", `document.getElementById('quiz-material') !== null`);
  const quizLabels = await cdp.eval(`document.body.textContent.includes('Generate quiz') && document.body.textContent.includes('Questions')`);
  check("quiz pane mounts with config", quizLabels === true);

  // Summary pane mounts: material box + prompt creation (write/upload
  // answer tabs appear after the AI question is generated).
  await clickTab("Summary Practice", `document.getElementById('summary-material') !== null`);
  const sumLabels = await cdp.eval(`document.body.textContent.includes('Create my question') && document.body.textContent.includes('in your own words')`);
  check("summary pane mounts with prompt creation", sumLabels === true);
  const desktopErrors = cdp.errors.length;
  check("no console errors (desktop)", desktopErrors === 0, desktopErrors ? cdp.errors.slice(0, 2).join(" | ") : "");
  cdp.close();

  // Mobile pass at 390px: separate browser + profile, so log in again first.
  cdp.close();
  try { chrome.kill(); } catch { /* already gone */ }
  await rmDir(PROFILE_D);
  chrome = await launchChrome(CDP_PORT, PROFILE_M);
  cdp = await newTarget(`${APP}/login`, 390, 844);
  await cdp.waitFor(`document.getElementById('email') !== null`, 20000, "login form (mobile)");
  await cdp.eval(`(() => {
    const fill = document.querySelector('[data-demo-fill]') ?? [...document.querySelectorAll('button')].find(b => b.textContent.includes('Try the demo'));
    if (fill) fill.click();
    const email = document.getElementById('email');
    const pw = document.getElementById('password');
    for (const [el, val] of [[email, 'demo@studypilot.app'], [pw, 'demo1234']]) {
      el.focus();
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.querySelector('form').requestSubmit();
    return true;
  })()`);
  await cdp.waitFor(`location.pathname.startsWith('/app')`, 20000, "post-login app (mobile)");
  await cdp.eval(`location.href = '${APP}/app/exams'`);
  await cdp.waitFor(`document.body.textContent.includes('Summary Practice')`, 20000, "exams mobile");
  for (const tab of ["Quiz", "Summary Practice", "Overview"]) {
    await clickTab(tab, `document.getElementById('${tab === "Quiz" ? "quiz" : tab === "Overview" ? "no-such-id" : "summary"}-material') !== null || '${tab}' === 'Overview'`);
    await sleep(400);
    const overflow = await cdp.eval(`document.documentElement.scrollWidth - window.innerWidth`);
    check(`mobile overflow 0px (${tab}, 390px)`, overflow <= 0, `overflow=${overflow}px`);
  }
  const mobileErrors = cdp.errors.length;
  check("no console errors (mobile)", mobileErrors === 0, mobileErrors ? cdp.errors.slice(0, 2).join(" | ") : "");
  cdp.close();

  try { chrome.kill(); } catch { /* already gone */ }
  await rmDir(PROFILE_D);
  await rmDir(PROFILE_M);
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exitCode = 1;
} catch (err) {
  console.error("ASSESS QA FAILURE:", err.message);
  process.exitCode = 1;
} finally {
  server.kill();
  await rmDir(PROFILE_D);
  await rmDir(PROFILE_M);
}
