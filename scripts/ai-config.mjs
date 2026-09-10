/* AI config manager: snapshot / restore / status / probe.
 *
 *   node scripts/ai-config.mjs snapshot [label]  — copy .env to a timestamped backup
 *   node scripts/ai-config.mjs restore <file>    — restore .env from a backup (rollback)
 *   node scripts/ai-config.mjs status            — show keyed providers + priority (never values)
 *   node scripts/ai-config.mjs probe             — live-check each keyed provider endpoint
 *
 * Rollback story: snapshot is taken before any AI change; `restore` puts the
 * last-known-good .env back in one command (restart the dev server after).
 * Per-request rollback is automatic: the provider chain fails over to the
 * next keyed provider, then to the deterministic local engine.
 * Secrets are NEVER printed by any command.
 */
import { copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(root, ".env");

function loadEnvFile(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, eq).trim()] = v;
  }
  return env;
}

const env = loadEnvFile(ENV_PATH);
const cmd = process.argv[2];
const arg = process.argv[3];

const PROVIDERS = [
  { id: "openrouter", keyVar: "OPENROUTER_API_KEY", modelVar: "OPENROUTER_MODEL", defModel: "openai/gpt-4o-mini" },
  { id: "grok", keyVar: "GROK_API_KEY", modelVar: "GROK_MODEL", defModel: "grok-3-mini" },
  { id: "gemini", keyVar: "GEMINI_API_KEY", modelVar: "GEMINI_MODEL", defModel: "gemini-2.0-flash" },
];

function priority() {
  return (env.AI_PRIORITY || "openrouter,grok,gemini").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

if (cmd === "snapshot") {
  if (!existsSync(ENV_PATH)) {
    console.error("No .env found — nothing to snapshot.");
    process.exit(1);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = arg ? `-${arg.replace(/[^a-z0-9-_]/gi, "")}` : "";
  const dest = join(root, `.env.ai-backup${label}-${stamp}`);
  copyFileSync(ENV_PATH, dest);
  console.log(`Snapshot written: ${dest.split(/[\\/]/).pop()}`);
} else if (cmd === "restore") {
  if (!arg) {
    const backups = readdirSync(root).filter((f) => f.startsWith(".env.ai-backup")).sort();
    console.error(`Usage: node scripts/ai-config.mjs restore <file>\nAvailable: ${backups.join(", ") || "none"}`);
    process.exit(1);
  }
  const src = join(root, arg.split(/[\\/]/).pop());
  if (!existsSync(src)) {
    console.error(`Backup not found: ${arg}`);
    process.exit(1);
  }
  copyFileSync(ENV_PATH, join(root, `.env.ai-pre-restore-${Date.now()}`));
  copyFileSync(src, ENV_PATH);
  console.log(`Restored .env from ${arg} (pre-restore state kept as .env.ai-pre-restore-*). Restart the dev server.`);
} else if (cmd === "status") {
  console.log(`priority: ${priority().join(" → ")}`);
  for (const p of PROVIDERS) {
    const key = env[p.keyVar] || "";
    console.log(`${p.id}: ${key ? `key set (${key.length} chars)` : "no key"} · model ${env[p.modelVar] || p.defModel}`);
  }
  console.log(`legacy AI_*: ${env.AI_API_KEY ? "key set" : "no key"} · provider ${env.AI_PROVIDER || "openai"} · model ${env.AI_MODEL || "gpt-4o-mini"}`);
  const backups = readdirSync(root).filter((f) => f.startsWith(".env.ai-backup")).sort();
  console.log(`backups: ${backups.join(", ") || "none"}`);
} else if (cmd === "probe") {
  const results = [];
  if (env.OPENROUTER_API_KEY) {
    const t0 = Date.now();
    try {
      const r = await fetch("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` } });
      results.push(`openrouter: ${r.ok ? `OK (${Date.now() - t0}ms)` : `FAIL http ${r.status}`}`);
    } catch (e) {
      results.push(`openrouter: FAIL ${e.message}`);
    }
  } else results.push("openrouter: skipped (no key)");
  if (env.GROK_API_KEY) {
    const t0 = Date.now();
    try {
      const r = await fetch("https://api.x.ai/v1/models", { headers: { Authorization: `Bearer ${env.GROK_API_KEY}` } });
      results.push(`grok: ${r.ok ? `OK (${Date.now() - t0}ms)` : `FAIL http ${r.status}`}`);
    } catch (e) {
      results.push(`grok: FAIL ${e.message}`);
    }
  } else results.push("grok: skipped (no key)");
  if (env.GEMINI_API_KEY) {
    const t0 = Date.now();
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`);
      results.push(`gemini: ${r.ok ? `OK (${Date.now() - t0}ms)` : `FAIL http ${r.status}`}`);
    } catch (e) {
      results.push(`gemini: FAIL ${e.message}`);
    }
  } else results.push("gemini: skipped (no key)");
  console.log(results.join("\n"));
  if (results.some((r) => r.includes("FAIL"))) process.exitCode = 1;
} else {
  console.error("Usage: node scripts/ai-config.mjs <snapshot|restore|status|probe>");
  process.exit(1);
}
