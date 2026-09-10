import { createHash, randomBytes } from "node:crypto";
import Database from "better-sqlite3";
const db = new Database("data/studypilot.db");
const user = db.prepare("select id from users where email='demo@studypilot.app'").get();
const tok = randomBytes(32).toString("hex");
db.prepare("insert into sessions (id, user_id, token_hash, expires_at) values (?,?,?,?)").run(
  `dbg-${Date.now()}`, user.id, createHash("sha256").update(tok).digest("hex"), new Date(Date.now() + 86400000).toISOString(),
);
db.close();
const r = await fetch("http://localhost:3104/app/syllabus", { headers: { Cookie: `sp_session=${tok}` }, redirect: "manual" });
const t = await r.text();
console.log("status:", r.status, "len:", t.length);
console.log("has Selected subject:", t.includes("Selected subject"));
console.log("has Syllabus:", t.includes("Syllabus"));
console.log("turbulence:", t.includes("Turbulence"));
