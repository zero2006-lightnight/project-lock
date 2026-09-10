import { createHash } from "node:crypto";
import Database from "better-sqlite3";

const db = new Database("data/studypilot.db");
const user = db.prepare("select id from users where email = 'demo@studypilot.app'").get();
let t = "";
const chars = "abcdef0123456789";
for (let i = 0; i < 64; i++) t += chars[Math.floor(Math.random() * chars.length)];
const hash = createHash("sha256").update(t).digest("hex");
const expires = new Date(Date.now() + 86400000).toISOString();
db.prepare("insert into sessions (id, user_id, token_hash, expires_at) values (?, ?, ?, ?)").run(
  `sess-${Date.now()}`,
  user.id,
  hash,
  expires,
);
db.close();
console.log(`sp_session=${t}`);