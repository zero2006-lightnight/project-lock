/* Full UI review via Playwright — captures every route in light/dark on
   desktop + mobile and audits overflow, console errors and tap targets.
   Usage: node scripts/ui-review.mjs [port]   (app must be running) */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = process.argv[2] || "3000";
const APP = `http://localhost:${APP_PORT}`;
const OUT = join(root, "scripts", ".shots", "review");
mkdirSync(OUT, { recursive: true });

const CHROME =
  process.env.CHROME_PATH ||
  (existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe");

const ROUTES = [
  { path: "/", label: "landing", auth: false },
  { path: "/login", label: "login", auth: false },
  { path: "/signup", label: "signup", auth: false },
  { path: "/app", label: "dashboard", auth: true },
  { path: "/app/today", label: "today", auth: true },
  { path: "/app/calendar", label: "calendar", auth: true },
  { path: "/app/syllabus", label: "syllabus", auth: true },
  { path: "/app/subjects", label: "subjects", auth: true },
  { path: "/app/exams", label: "exams", auth: true },
  { path: "/app/tasks", label: "tasks", auth: true },
  { path: "/app/chat", label: "chat", auth: true },
  { path: "/app/focus", label: "focus", auth: true },
  { path: "/app/progress", label: "progress", auth: true },
  { path: "/app/achievements", label: "achievements", auth: true },
  { path: "/app/settings", label: "settings", auth: true },
];

const audit = { captures: [], consoleErrors: {}, overflows: {}, smallTargets: {} };
const errorsSeen = new Map();
function trackErrors(page, key) {
  const onErr = (msg) => {
    const list = errorsSeen.get(key) ?? [];
    list.push(typeof msg === "string" ? msg : msg);
    errorsSeen.set(key, list);
  };
  page.on("console", (m) => m.type() === "error" && onErr(m.text()));
  page.on("pageerror", (e) => onErr(`pageerror: ${e.message}`));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// 1. Log in as the demo student
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
trackErrors(page, "login");
await page.fill("#email", "demo@studypilot.app");
await page.fill("#password", "demo1234");
await Promise.all([
  page.waitForURL("**/app**", { timeout: 20000 }),
  page.locator("form button[type=submit]").first().click(),
]);
await page.waitForTimeout(800);
console.log("✓ logged in →", page.url());

async function setTheme(t) {
  await page.evaluate((tt) => {
    const w = window;
    if (typeof w.__spSetTheme === "function") w.__spSetTheme(tt);
    else document.documentElement.classList.toggle("dark", tt === "dark");
    return true;
  }, t);
  await page.waitForTimeout(250);
}

async function capture(route, theme, vpLabel) {
  const key = `${route.label}__${theme}`;
  const file = join(OUT, `${route.label}--${theme}--${vpLabel}.png`);
  const errorsBefore = errorsSeen.get(key)?.length ?? 0;
  await page.goto(`${APP}${route.path}`, { waitUntil: "networkidle" });
  await setTheme(theme);
  await page.waitForTimeout(route.label === "dashboard" || route.label === "progress" ? 1400 : 700); // charts settle
  await page.screenshot({ path: file, fullPage: true });
  const metrics = await page.evaluate(() => {
    const de = document.documentElement;
    const targets = [...document.querySelectorAll("button, a[href], [role='button']")]
      .filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.visibility !== "hidden" && s.display !== "none" && r.width > 4 && r.height > 0;
      })
      .map((el) => ({ tag: el.tagName, cls: (el.className || "").toString().slice(0, 60), h: Math.round(el.getBoundingClientRect().height) }))
      .filter((x) => x.h < 32)
      .slice(0, 12);
    return {
      overflow: Math.max(0, de.scrollWidth - de.clientWidth),
      smallTargets: targets,
      h1: document.querySelectorAll("h1").length,
    };
  });
  const newErrors = (errorsSeen.get(key) ?? []).slice(errorsBefore);
  audit.captures.push({ ...key ? { route: route.label, theme } : {}, file, overflow: metrics.overflow });
  if (metrics.overflow > 0) (audit.overflows[route.label] ??= {})[theme] = metrics.overflow;
  if (newErrors.length) audit.consoleErrors[`${route.label} (${theme})`] = newErrors.slice(0, 5);
  if (metrics.smallTargets.length) audit.smallTargets[`${route.label} (${theme})`] = metrics.smallTargets;
  console.log(`  📸 ${route.label.padEnd(12)} ${theme.padEnd(5)} ${vpLabel.padEnd(6)} overflow=${metrics.overflow}px targets<32px:${metrics.smallTargets.length}`);
}

// 2. Desktop captures, light + dark
for (const route of ROUTES) {
  await capture(route, "light", "desktop");
}
for (const route of ROUTES.filter((r) => r.auth)) {
  await capture(route, "dark", "desktop");
}
await capture({ path: "/", label: "landing", auth: false }, "dark", "desktop");

// 3. Mobile captures (light) for the app's core screens + landing/login
await page.setViewportSize({ width: 390, height: 844 });
for (const label of ["dashboard", "today", "calendar", "chat", "focus", "exams"]) {
  const route = ROUTES.find((r) => r.label === label);
  await capture(route, "light", "mobile");
}
for (const label of ["landing", "login"]) {
  const route = ROUTES.find((r) => r.label === label);
  await capture(route, "light", "mobile");
}

// 4. Dark mobile for dashboard (the most dense screen)
await capture(ROUTES.find((r) => r.label === "dashboard"), "dark", "mobile");

await browser.close();
writeFileSync(join(OUT, "audit.json"), JSON.stringify(audit, null, 2));
const errCount = Object.keys(audit.consoleErrors).length;
const overCount = Object.keys(audit.overflows).length;
console.log(`\nDone. ${audit.captures.length} captures → ${OUT}`);
console.log(`routes with console errors: ${errCount} | routes with horizontal overflow: ${overCount}`);
