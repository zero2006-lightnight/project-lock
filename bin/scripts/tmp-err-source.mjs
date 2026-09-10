/* Identify the 500 + script-tag warning sources. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME =
  process.env.CHROME_PATH ||
  (existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 300), "| loc:", m.location()?.url);
});
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 300), "| stack:", (e.stack || "").split("\n")[1] || ""));
page.on("response", (r) => {
  if (r.status() >= 400) console.log("HTTP", r.status(), r.url());
});
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.fill("#email", "demo@studypilot.app");
await page.fill("#password", "demo1234");
await page.click("button[type=submit]");
await page.waitForURL("**/app**", { timeout: 20000 });
await page.goto("http://localhost:3000/app/syllabus", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await browser.close();
