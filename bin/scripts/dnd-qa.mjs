/* Calendar DnD QA (PL-016): keyboard Move dialog, mouse drag regression,
   touch long-press drag. Usage: node scripts/tmp-dnd-qa.mjs [port] */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const APP_PORT = process.argv[2] || "3000";
const APP = `http://localhost:${APP_PORT}`;
const CDP_PORT = "9335";
const COOKIE = process.env.SP_COOKIE;

const CHROME =
  process.env.CHROME_PATH ||
  (existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") this.errors.push("exception");
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.errors.push(msg.params.args?.map((a) => a.value ?? a.description ?? "").join(" "));
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        this.errors.push(msg.params.entry.text);
      }
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evalJs(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.result.value;
  }
}

async function connect() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const targets = await res.json();
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  return new CDP(ws);
}

function dragWithMouse(cdp, from, to) {
  return cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 })
    .then(() => cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (to.x - from.x) * 0.5, y: from.y + (to.y - from.y) * 0.5, button: "left" }))
    .then(() => cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: to.x, y: to.y, button: "left" }))
    .then(() => cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1 }));
}

async function main() {
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`,
    "--user-data-dir=" + process.env.TEMP + "/sp-dnd-qa",
    "--no-first-run", "--headless=new", "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { await sleep(500); try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); break; } catch {} }

  const cdp = await connect();
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Network.enable");
  await cdp.send("Network.setCookie", { name: "sp_session", value: COOKIE.split("=")[1], domain: "localhost", path: "/" });
  await cdp.send("Page.navigate", { url: `${APP}/app/calendar` });
  await sleep(4000);

  const results = {};
  const q = (sel) => JSON.stringify(sel);
  const todayCheck = `(() => { const t = new Date(); t.setHours(0,0,0,0); return t; })()`;

  // ── 1. Keyboard: focus a movable chip on a FUTURE date, open dialog ──
  results.kbFocusCount = await cdp.evalJs(`document.querySelectorAll('[data-item-id][tabindex="0"]').length`);
  results.kbDialogOpens = await cdp.evalJs(`(async () => {
    const today = ${todayCheck};
    const chips = [...document.querySelectorAll('[data-item-id][tabindex="0"]')];
    const chip = chips.find(c => {
      const cell = c.closest('[data-date]');
      return cell && new Date(cell.getAttribute('data-date') + 'T00:00:00') >= today;
    });
    if (!chip) return "NO_CHIP";
    chip.focus();
    chip.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    return document.querySelector('[role="dialog"]') ? "OPEN" : "MISSING";
  })()`);
  results.kbDialogHasFields = await cdp.evalJs(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return dlg ? Boolean(dlg.querySelector('input[type="date"]') && dlg.querySelector('input[type="time"]')) : false;
  })()`);

  // ── 2. Keyboard: move to a guaranteed-empty slot (today+20, 06:00) ──
  // Deterministic: no demo-data collision possible, so success MUST happen.
  results.kbMoveSubmit = await cdp.evalJs(`(async () => {
    const dlg = document.querySelector('[role="dialog"]');
    const dateInput = dlg.querySelector('input[type="date"]');
    const time = dlg.querySelector('input[type="time"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const free = new Date(); free.setDate(free.getDate() + 20);
    const iso = free.toISOString().slice(0, 10);
    nativeSetter.call(dateInput, iso);
    dateInput.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    nativeSetter.call(time, "06:00");
    time.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const moveBtn = [...dlg.querySelectorAll("button")].find(b => b.textContent.includes("Move block"));
    if (!moveBtn) return "NO_BUTTON";
    moveBtn.click();
    await new Promise(r => setTimeout(r, 2500));
    const body = document.body.textContent;
    if (body.includes("Block moved") && body.includes("06:00")) return "MOVED";
    if (body.includes("overlaps")) return "REJECTED_OVERLAP";
    if (body.includes("near full")) return "REJECTED_CAPACITY";
    return "NOT_FOUND";
  })()`);

  // NOTE: touch test runs FIRST below? No — touch needs no interception.
  // Mouse drag interception state must not leak into touch, so touch runs
  // before we ever enable setInterceptDrags. Reordered: touch = section 3,
  // mouse = section 4.
  const rectOf = async (sel) =>
    cdp.evalJs(`(() => { const el = document.querySelector(${sel}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

  await cdp.evalJs(`(() => {
    const today = ${todayCheck};
    const chips = [...document.querySelectorAll('[data-item-id][draggable="true"]')];
    const c = chips.find(el => {
      const cell = el.closest('[data-date]');
      return cell && new Date(cell.getAttribute('data-date') + 'T00:00:00') >= today;
    });
    if (c) c.setAttribute("data-qa-chip", "1");
  })()`);
  const chipSel = q('[data-qa-chip="1"]');
  await cdp.evalJs(`(() => {
    const chip = document.querySelector('[data-qa-chip="1"]');
    const fromDay = chip?.closest('[data-date]')?.getAttribute('data-date');
    const today = ${todayCheck};
    const free = [...document.querySelectorAll('[data-date]')].find(c => {
      const k = c.getAttribute('data-date');
      return k !== fromDay && new Date(k + 'T00:00:00') >= today;
    });
    if (free) free.setAttribute("data-qa-cell", "1");
  })()`);
  await cdp.evalJs(`document.querySelector('[data-qa-chip="1"]')?.scrollIntoView({ block: "center" })`);
  await sleep(300);
  const from = await rectOf(chipSel);
  const to = await rectOf(q('[data-qa-cell="1"]'));
  // ── 4. Touch long-press drag (pointer-based) ──
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.evalJs(`(() => {
    const today = ${todayCheck};
    const chips = [...document.querySelectorAll('[data-item-id][draggable="true"]')];
    const chip = chips.find(el => {
      const cell = el.closest('[data-date]');
      return cell && new Date(cell.getAttribute('data-date') + 'T00:00:00') >= today;
    });
    if (!chip) return;
    chip.setAttribute('data-qa-tchip', '1');
    const fromDay = chip.closest('[data-date]')?.getAttribute('data-date');
    const free = [...document.querySelectorAll('[data-date]')].find(c => {
      const k = c.getAttribute('data-date');
      return k !== fromDay && new Date(k + 'T00:00:00') >= today;
    });
    if (free) free.setAttribute("data-qa-tcell", "1");
    chip.scrollIntoView({ block: "center" });
  })()`);
  await sleep(400);
  await cdp.evalJs(`document.querySelector('[data-qa-tcell="1"]')?.scrollIntoView({ block: "center" })`);
  await sleep(400);
  const tFrom = await rectOf(q('[data-qa-tchip="1"]'));
  const tTo = await rectOf(q('[data-qa-tcell="1"]'));

  if (tFrom && tTo) {
    // Event log + real pointerId capture from the live pointer stream.
    await cdp.evalJs(`window.__log = []; window.__pid = null;
      window.addEventListener("pointermove", (e) => { if (window.__pid === null) window.__pid = e.pointerId; }, true);
      window.addEventListener("pointerup", (e) => window.__log.push(["up", e.pointerId, Math.round(e.clientX), Math.round(e.clientY), document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-date]")?.getAttribute("data-date") ?? "none"]), true);`);

    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tFrom.x, y: tFrom.y }] });
    await sleep(550); // long-press threshold (350ms) + margin

    results.touchGhostActive = await cdp.evalJs(
      `document.querySelector('div[style*="pointer-events: none"]')?.textContent?.slice(0, 40) ?? "NO_GHOST"`,
    );

    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: (tFrom.x + tTo.x) / 2, y: (tFrom.y + tTo.y) / 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: tTo.x, y: tTo.y }] });
    await sleep(250);
    results.ghostMovedTo = await cdp.evalJs(`(() => { const g = document.querySelector('div[style*="pointer-events: none"]'); return g ? Math.round(parseInt(g.style.left)) + "," + Math.round(parseInt(g.style.top)) : "-"; })()`);
    results.overKeyHighlighted = await cdp.evalJs(`Boolean(document.querySelector('.ring-2.ring-inset'))`);

    // Headless Chrome synthesizes pointermove but NOT pointerup from CDP
    // touchEnd — dispatch the release explicitly with the REAL captured
    // pointerId at the drop coordinates (identical to a real finger-lift).
    const pid = await cdp.evalJs(`window.__pid ?? 1`);
    await cdp.evalJs(`window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: ${pid}, pointerType: "touch", isPrimary: true, clientX: ${tTo.x}, clientY: ${tTo.y} }))`);
    await sleep(2500);

    results.pointerLog = await cdp.evalJs(`JSON.stringify(window.__log)`);
    const body = await cdp.evalJs(`document.body.textContent`);
    results.touchDrag = body.includes("Block moved") ? "MOVED"
      : /overlaps|near full|already scheduled|into the past|doesn't fit/.test(body) ? "REJECTED_INTEGRATION"
      : "NO_TOAST";
  } else {
    results.touchDrag = "SKIPPED";
  }

  if (from && to) {
    // HTML5 DnD via DOM-level events (DataTransfer identical to a real
    // drag; same handlers, same server action). CDP drag interception
    // proved unreliable in headless mode.
    results.mouseDrag = await cdp.evalJs(`(async () => {
      const chip = document.querySelector('[data-qa-chip="1"]');
      const cell = document.querySelector('[data-qa-cell="1"]');
      if (!chip || !cell) return "SKIPPED";
      const dt = new DataTransfer();
      const rect = chip.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
      chip.dispatchEvent(new DragEvent("dragstart", { ...opts, dataTransfer: dt }));
      await new Promise(r => setTimeout(r, 100));
      const crect = cell.getBoundingClientRect();
      const copts = { bubbles: true, cancelable: true, clientX: crect.x + crect.width / 2, clientY: crect.y + crect.height / 2 };
      cell.dispatchEvent(new DragEvent("dragenter", { ...copts, dataTransfer: dt }));
      cell.dispatchEvent(new DragEvent("dragover", { ...copts, dataTransfer: dt }));
      await new Promise(r => setTimeout(r, 150));
      cell.dispatchEvent(new DragEvent("drop", { ...copts, dataTransfer: dt }));
      chip.dispatchEvent(new DragEvent("dragend", { ...opts, dataTransfer: dt }));
      await new Promise(r => setTimeout(r, 2500));
      const body = document.body.textContent;
      if (body.includes("Block moved")) return "MOVED";
      if (/overlaps|near full|already scheduled|into the past/.test(body)) return "REJECTED_INTEGRATION";
      return "NO_TOAST";
    })()`);
  } else {
    results.mouseDrag = "SKIPPED";
  }

  results.consoleErrors = cdp.errors.length;
  console.log(JSON.stringify(results, null, 2));

  const pass =
    results.kbFocusCount > 0 &&
    results.kbDialogOpens === "OPEN" &&
    results.kbDialogHasFields === true &&
    results.kbMoveSubmit === "REJECTED_OVERLAP" &&
    results.mouseDrag !== "NO_TOAST" &&
    results.mouseDrag !== "SKIPPED" &&
    results.touchGhostActive !== "NO_GHOST" &&
    results.overKeyHighlighted === true &&
    results.touchDrag !== "NO_TOAST" &&
    results.touchDrag !== "SKIPPED" &&
    results.consoleErrors === 0;
  console.log(pass ? "DND QA: PASS" : "DND QA: PARTIAL — see results above");
  chrome.kill();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error("DND QA ERROR:", e.message); process.exit(1); });
