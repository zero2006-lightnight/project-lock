import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = "http://localhost:3104";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) { const { resolve } = this.pending.get(msg.id); this.pending.delete(msg.id); resolve(msg.result); }
      if (msg.method === "Runtime.exceptionThrown") this.errors.push("exception");
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", () => rej(new Error("x"))); });
    return new CDP(ws);
  }
  send(m, p = {}) {
    const id = ++this.id;
    return new Promise((res) => { this.pending.set(id, { resolve: res }); this.ws.send(JSON.stringify({ id, method: m, params: p })); });
  }
  async eval(e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.value; }
  async waitFor(e, ms = 60000) {
    const s = Date.now();
    while (Date.now() - s < ms) { try { if (await this.eval(e)) return; } catch {} await sleep(600); }
    throw new Error("timeout");
  }
  close() { this.ws.close(); }
}
async function main() {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--window-size=1500,1000", "--remote-debugging-port=9354",
     `--user-data-dir=${join(root, "scripts", ".chrome-hf-" + Date.now())}`, "about:blank"], { stdio: "ignore" });
  let cdp;
  try {
    for (let i = 0; i < 40; i++) {
      try { await fetch("http://127.0.0.1:9354/json/version").then((r) => r.json()); break; }
      catch { await sleep(250); }
    }
    const t = await fetch("http://127.0.0.1:9354/json/new?" + encodeURIComponent(APP + "/login"), { method: "PUT" }).then((r) => r.json());
    cdp = await CDP.connect(t.webSocketDebuggerUrl);
    console.log("CDP OK");
    await cdp.send("Runtime.enable");
    await cdp.waitFor(`document.querySelector('#email') !== null`);
    console.log("LOGIN FORM OK");
    await cdp.eval(`(() => {
      const e = document.getElementById('email'), p = document.getElementById('password');
      e.focus(); document.execCommand('insertText', false, 'demo@studypilot.app');
      p.focus(); document.execCommand('insertText', false, 'demo1234');
      document.querySelector('form').requestSubmit(); return true;
    })()`);
    await cdp.waitFor(`location.pathname !== '/login'`);
    console.log("LOGGED IN");

    // BUG 1: syllabus subject rail switches content
    await cdp.eval(`location.href = ${JSON.stringify(APP + "/app/syllabus")}; true`);
    await cdp.waitFor(`document.body.innerText.includes('Selected subject')`);
    await sleep(2000);
    const s1 = await cdp.eval(`document.querySelector('h2')?.textContent ?? null`);
    const rails = await cdp.eval(`[...document.querySelectorAll('button')].filter(b => b.textContent.includes('topics')).map(b => b.textContent.slice(0, 40)).join(' || ')`);
    console.log("BUG1 selected:", JSON.stringify(s1), "| rail:", JSON.stringify(rails.slice(0, 160)));
    // click second subject button if present
    const switched = await cdp.eval(`(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => /\\d+% · \\d+\\/\\d+ topics/.test(b.textContent));
      if (btns.length < 2) return 'single-subject';
      btns[1].click();
      return 'clicked';
    })()`);
    await sleep(1500);
    const s2 = await cdp.eval(`document.querySelectorAll('h2')[0]?.textContent ?? null`);
    console.log("BUG1 switch:", switched, "→", JSON.stringify(s2), "| changed:", s1 !== s2);

    // BUG 2: import locked.pdf via API route → password message only
    console.log("BUG2 covered at pipeline level (locked→password, garbage→unreadable, uni→parsed)");

    // BUG 3: image upload via materials dropzone (PNG)
    const up = await cdp.eval(`(() => {
      const input = document.querySelector('input[type="file"]');
      return input ? (input.accept || 'no-accept') : 'NO-INPUT';
    })()`);
    console.log("BUG3 file input:", up);
    console.log("ERRORS:", cdp.errors.length ? cdp.errors : "none");
  } finally { try { cdp?.close(); } catch {} chrome.kill(); }
}
main().catch((e) => { console.error("QA FAILURE:", e.message); process.exitCode = 1; });
