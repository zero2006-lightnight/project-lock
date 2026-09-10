/* Dialog motion check: open Import syllabus dialog, screenshot, Escape-close. */
import { chromium } from "playwright-core";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "scripts", ".shots", "motion2");
mkdirSync(OUT, { recursive: true });

const CHROME =
  process.env.CHROME_PATH ||
  (existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.fill("#email", "demo@studypilot.app");
await page.fill("#password", "demo1234");
await page.click("button[type=submit]");
await page.waitForURL("**/app**", { timeout: 20000 });
await page.goto("http://localhost:3000/app/syllabus", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /import syllabus/i }).click();
await page.getByRole("dialog").waitFor({ timeout: 10000 });
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, "dialog-open.png") });
// Escape must close + restore focus without errors
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
const dialogGone = (await page.getByRole("dialog").count()) === 0;
console.log("dialog closed via Escape:", dialogGone);
// nav pill visible on dashboard
await page.goto("http://localhost:3000/app", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "dashboard-nav.png") });
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
if (!dialogGone) process.exitCode = 1;
