/* Visual QA for the calendar — drives headless Chrome over raw CDP (no deps).
   Usage: node scripts/visual-qa.mjs [port]   (expects the app already running) */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = process.argv[2] || "3000";
const APP = `http://localhost:${APP_PORT}`;
const CDP_PORT = "9333";
const SHOTS = join(root, "scripts", ".shots");
mkdirSync(SHOTS, { recursive: true });

const CHROME =
  process.env.CHROME_PATH ||
  (existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${opts?.method ?? "GET"} ${url} → ${res.status}`);
  return res.json();
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    this.dragData = null;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === "Input.dragIntercepted" && msg.params?.dragData) {
        this.dragData = msg.params.dragData;
        return;
      }
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
    const res = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(res.data, "base64"));
    console.log("  📸", name + ".png");
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

const step = (s) => console.log("\n▶", s);

async function main() {
  // sanity: app is up
  const ok = await fetch(APP + "/login").then((r) => r.ok).catch(() => false);
  if (!ok) throw new Error("app not reachable — start it first (npm start)");

  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1500,1000",
    "--hide-scrollbars",
    "--remote-debugging-port=" + CDP_PORT,
    "--user-data-dir=" + join(root, "scripts", ".chrome-profile"),
    "about:blank",
  ], { stdio: "ignore" });

  // wait for debugger
  let version;
  for (let i = 0; i < 40; i++) {
    try {
      version = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error("Chrome CDP did not start");

  const target = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(APP + "/login")}`, { method: "PUT" });
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });

  try {
    step("demo login");
    await cdp.waitFor(`document.querySelector('#email') !== null`, 15000, "login form");
    await cdp.eval(`(() => {
      const fill = document.querySelector('[data-demo-fill]') ?? [...document.querySelectorAll('button')].find(b => b.textContent.includes('Try the demo'));
      if (fill) fill.click();
      const form = document.querySelector('form');
      const email = document.getElementById('email');
      const pw = document.getElementById('password');
      email.value = 'demo@studypilot.app';
      pw.value = 'demo1234';
      form.requestSubmit();
      return true;
    })()`);
    await cdp.waitFor(`location.pathname.startsWith('/app')`, 20000, "redirect to /app");
    console.log("  signed in, path =", await cdp.eval("location.pathname"));

    step("open calendar (month view)");
    await cdp.eval(`location.href = ${JSON.stringify(APP + "/app/calendar")}; true`);
    await cdp.waitFor(`document.querySelector('h1')?.textContent === 'Calendar'`, 20000, "calendar heading");
    await cdp.waitFor(`document.querySelectorAll('[data-item-id]').length > 0`, 15000, "plan chips");
    const meta = await cdp.eval(`({
      chips: document.querySelectorAll('[data-item-id]').length,
      cells: document.querySelectorAll('[data-date]').length,
      monthLabel: [...document.querySelectorAll('p')].find(p => /(January|February|March|April|May|June|July|August|September|October|November|December) \\d{4}/.test(p.textContent))?.textContent ?? '?',
      toggle: [...document.querySelectorAll('[role=tab]')].map(b => b.textContent.trim()),
    })`);
    console.log("  month grid:", JSON.stringify(meta));
    await sleep(400);
    await cdp.shot("calendar-month-light");

    step("dark mode");
    await cdp.eval(`document.documentElement.classList.add('dark'); true`);
    await sleep(250);
    await cdp.shot("calendar-month-dark");
    await cdp.eval(`document.documentElement.classList.remove('dark'); true`);

    step("week view");
    await cdp.eval(`[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Week').click(); true`);
    await sleep(300);
    await cdp.shot("calendar-week");
    await cdp.eval(`[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Month').click(); true`);
    await sleep(300);

    step("drag-and-drop (browser-intercepted drag)");
    await cdp.send("Input.setInterceptDrags", { enabled: true }).catch(() => {});
    const info = await cdp.eval(`(() => {
      const chip = document.querySelector('[data-item-id]');
      if (!chip) return null;
      const src = chip.closest('[data-date]');
      const id = chip.getAttribute('data-item-id');
      const cells = [...document.querySelectorAll('[data-date]')];
      const target = cells.find(c => c !== src && !c.querySelector('[data-item-id]')) ?? cells.find(c => c !== src);
      if (!target) return null;
      const center = (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
      return { id, src: src.getAttribute('data-date'), target: target.getAttribute('data-date'), from: center(chip), to: center(target) };
    })()`);
    if (!info) {
      console.log("  no movable chip found — drag test skipped");
    } else {
      console.log("  dragging", info.id.slice(0, 8), `from ${info.src} → ${info.target}`);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: info.from.x, y: info.from.y });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: info.from.x, y: info.from.y, button: "left", buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 14; i++) {
        const t = i / 14;
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: info.from.x + (info.to.x - info.from.x) * t,
          y: info.from.y + (info.to.y - info.from.y) * t,
          button: "left",
          buttons: 1,
        });
        await sleep(35);
      }
      // wait for the browser to intercept the drag
      cdp.dragData = null;
      for (let i = 0; i < 25 && !cdp.dragData; i++) await sleep(120);
      const dragData = cdp.dragData;
      if (dragData) {
        const d = (type) => cdp.send("Input.dispatchDragEvent", { type, x: info.to.x, y: info.to.y, dragData });
        await d("dragEnter");
        await sleep(80);
        await d("dragOver");
        await sleep(80);
        await d("drop");
        await sleep(2500); // server action + optimistic update
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: info.to.x, y: info.to.y, button: "left", buttons: 0, clickCount: 1 });
        const after = await cdp.eval(`(() => {
          const t = document.querySelector('[data-date="${info.target}"]');
          const s = document.querySelector('[data-date="${info.src}"]');
          return { onTarget: t ? t.querySelectorAll('[data-item-id]').length : -1, onSource: s ? s.querySelectorAll('[data-item-id]').length : -1 };
        })()`);
        console.log("  after drop →", JSON.stringify(after));
        const movedOk = after.onTarget > 0 && after.onSource < 2;
        console.log(movedOk ? "  ✓ item visibly moved to the target day" : "  ✗ drag did not move the item");
        if (movedOk) await cdp.shot("calendar-after-drop");
      } else {
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: info.to.x, y: info.to.y, button: "left", buttons: 0, clickCount: 1 });
        console.log("  browser never intercepted the drag — cannot automate DnD in this headless build");
      }
    }

    await sleep(300);
    console.log("\n▶ console errors:", cdp.errors.length ? cdp.errors : "none");
    const shots = (await import("node:fs")).readdirSync(SHOTS).filter((f) => f.endsWith(".png"));
    console.log("screenshots:", shots.join(", "));
  } finally {
    cdp.close();
    chrome.kill();
  }
}

main().catch((e) => {
  console.error("QA failed:", e.message);
  process.exit(1);
});
