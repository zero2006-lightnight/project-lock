# StudyPilot Fallback Runbook

This document is the emergency recovery path for StudyPilot. Use it when the app stops starting, the database appears damaged, tests fail after an environment change, or an AI/browser workflow breaks.

The goal is to recover the project without destroying the local database, environment settings, migration history, or useful diagnostic evidence.

## 1. Stop and preserve evidence

Before deleting or resetting anything:

1. Stop any running development or production server with `Ctrl+C`.
2. Copy the exact error message, including the first stack trace and the command that produced it.
3. Check the current working directory:

```powershell
Get-Location
```

It should be:

```text
C:\Users\aKris\Downloads\Project-lock
```

4. Check the repository state. Do not reset or discard user changes:

```powershell
git status --short
```

5. Make a dated backup before database or dependency repair:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force -Path "backups\$stamp" | Out-Null
Copy-Item "data\studypilot.db" "backups\$stamp\studypilot.db" -ErrorAction SilentlyContinue
Copy-Item ".env" "backups\$stamp\.env" -ErrorAction SilentlyContinue
Copy-Item "package-lock.json" "backups\$stamp\package-lock.json" -ErrorAction SilentlyContinue
```

Never commit `.env`, API keys, or a personal SQLite database.

## 2. Confirm the basic environment

StudyPilot expects Node.js and npm. Confirm their versions:

```powershell
node --version
npm --version
```

The project was developed with a current Node.js release. If Node is missing, install the current LTS release, reopen the terminal, and run the checks again.

Confirm the important project files exist:

```powershell
Test-Path package.json
Test-Path next.config.ts
Test-Path drizzle.config.ts
Test-Path src\lib\db\index.ts
Test-Path drizzle
```

If any of these return `False`, stop. The project folder is incomplete or the terminal is in the wrong directory.

## 3. First recovery attempt: reinstall and validate

Run these commands in order:

```powershell
npm install
npm run typecheck
npm run lint
npm test
```

If these pass, start the app:

```powershell
npm run dev
```

Open `http://localhost:3000`.

For the first browser check, use the demo sign-in button. The demo account is:

```text
demo@studypilot.app
 demo1234
```

There should be no space before `demo1234`; it is shown on a separate line only for readability.

## 4. If dependency installation is broken

Use the least destructive repair first.

### 4.1 Clear npm's cache metadata

```powershell
npm cache verify
npm install
```

### 4.2 Rebuild native dependencies

`better-sqlite3` is a native dependency. If it fails to load after a Node.js upgrade:

```powershell
npm rebuild better-sqlite3
npm run typecheck
npm test
```

### 4.3 Reinstall dependencies from the lockfile

Only do this after backing up `.env` and the database:

```powershell
Remove-Item -Recurse -Force node_modules
npm ci
```

Use `npm ci` when `package-lock.json` is present. Do not delete `package-lock.json` to make installation easier; that can change the dependency graph.

## 5. If the app will not start

Run the development server directly and preserve the first error:

```powershell
npm run dev
```

Common causes:

- **Port 3000 is already in use.** Stop the old process or start another port:

```powershell
npm run dev -- --port 3001
```

Then open `http://localhost:3001`.

- **A stale Next.js process is holding the port.** Find it:

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object OwningProcess
```

Inspect the process before stopping it:

```powershell
Get-Process -Id <PID>
```

- **Build output is stale.** Stop the server and remove only the generated `.next` directory:

```powershell
Remove-Item -Recurse -Force .next
npm run dev
```

- **TypeScript or lint failure.** Run the failing check alone:

```powershell
npm run typecheck
npm run lint
```

Fix the first actionable error before investigating later errors.

## 6. Database recovery

The default database is SQLite at:

```text
data\studypilot.db
```

Drizzle migrations are stored in:

```text
drizzle\
```

The app applies migrations when the database client initializes. Do not manually edit the SQLite file while the app is running.

### 6.1 Database exists but the app reports missing tables

1. Stop the app.
2. Confirm the migration files exist:

```powershell
Get-ChildItem drizzle -File
```

3. Start the app again. The normal database initialization applies the checked-in migrations.
4. If the error remains, save the error and database backup before doing anything destructive.

Do not generate a new migration just because the app reports a runtime problem. `npm run db:generate` is for intentional schema changes and can create unrelated migration files.

### 6.2 Database is corrupted or cannot be opened

Preserve it first:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item "data\studypilot.db" "data\studypilot.db.corrupt-$stamp"
```

Then choose one path:

- **Try to preserve user data:** keep the copied database and investigate the SQLite error before resetting.
- **Reset local demo data:** delete only the live database, then restart the app:

```powershell
Remove-Item "data\studypilot.db"
npm run dev
```

The app should recreate the database and demo data on first use. This destroys local app data in the live database, so only do it after making the backup.

### 6.3 Demo data is missing or stale

With the app stopped or running locally, reseed the demo account:

```powershell
npm run seed
```

This is intended for the demo user. It does not restore arbitrary personal account data.

## 7. Environment and AI fallback

The app is designed to work without an AI API key. If AI configuration is broken, local deterministic responses should still support core study planning and basic chat intents.

Inspect the example configuration:

```powershell
Get-Content .env.example
```

Create or repair the local environment file without committing it:

```powershell
Copy-Item .env.example .env -ErrorAction SilentlyContinue
```

The default local database setting is:

```text
DATABASE_URL=file:./data/studypilot.db
```

Keep API keys out of source control. If a key was exposed, revoke it at the provider immediately and remove it from `.env` and any logs.

For offline recovery:

1. Temporarily remove or comment out provider API keys in `.env`.
2. Restart `npm run dev`.
3. Test login, onboarding, Today, syllabus, tasks, calendar, and focus mode.
4. Treat AI-only failures separately from core application failures.

AI-only features may require a configured provider key, including richer tutor responses and some generated quizzes, flashcards, mind maps, or Tuning answers.

## 8. Test and quality recovery

Run checks from narrowest to broadest:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

If a single test fails, run the relevant file:

```powershell
npx vitest run tests\engine.test.ts
```

Available focused test files include:

- `tests\engine.test.ts` for planning and rescheduling logic
- `tests\stats.test.ts` for progress calculations
- `tests\security.test.ts` for rate limits, request keys, and guards
- `tests\study.test.ts` for study-aid and scheduling behavior
- `tests\tuning.test.ts` and `tests\tuning-intelligence.test.ts` for Tuning
- `tests\ai-chain.test.ts` for AI routing and provider behavior
- `tests\syllabus-parse.test.ts` for syllabus parsing

A browser or AI QA script can fail because of environment, port, authentication state, or missing keys even when unit tests pass. Treat those as separate categories.

## 9. Production-style verification

When development mode works but deployment behavior is suspect:

```powershell
npm run build
npm start
```

In another terminal, run the smoke test:

```powershell
node scripts\smoke.mjs
```

Stop the production server with `Ctrl+C` after the check.

Optional checks:

```powershell
node scripts\flow-qa.mjs
node scripts\visual-qa.mjs
```

The AI QA script needs a working provider key:

```powershell
node scripts\ai-qa.mjs
```

Do not interpret a missing-key AI failure as proof that the deterministic app is broken.

## 10. Authentication and browser symptoms

### Login immediately returns to `/login`

Check these in order:

1. Use `http://localhost:3000` for local testing.
2. Clear cookies for the local site.
3. Restart the server.
4. Confirm the database is writable.
5. Try the demo sign-in.

When testing over a LAN address, cookie behavior can differ from localhost. Behind a TLS-terminating proxy, make sure the proxy forwards `x-forwarded-proto: https`.

### Personal data appears to be missing

Confirm that you signed into the same account that created it. Flashcards, mind maps, chat sessions, and tuning materials are account-scoped.

### Onboarding crashes or has no plan

Try the demo account first. If the demo works, the issue is likely input-specific. Confirm that the account has at least one subject and topic before expecting a generated plan.

## 11. Safe reset ladder

Use the smallest reset that addresses the symptom:

1. Refresh the browser and clear site cookies.
2. Restart `npm run dev`.
3. Remove `.next` and restart.
4. Run `npm install` or `npm ci` after backing up local files.
5. Run `npm run seed` for demo data.
6. Back up and remove `data\studypilot.db` to recreate local data.
7. Only after preserving evidence, investigate code or migration changes.

Never jump directly to deleting the database or resetting Git. A reset can hide the cause and destroy recoverable data.

## 12. What to collect before asking for help

Include:

- The command that failed.
- The first complete error and stack trace.
- Output from `node --version` and `npm --version`.
- Whether `npm run typecheck`, `npm run lint`, and `npm test` pass.
- Whether the problem occurs with `.env` AI keys removed.
- Whether the demo account reproduces it.
- Whether the issue survives a fresh `.next` directory.
- The result of `git status --short`.

Do not include passwords, API keys, session cookies, or the contents of `.env`.

## 13. Last-resort clean-room recovery

If the working tree is damaged but the repository itself is still available:

1. Copy `data\studypilot.db`, `.env`, and any uncommitted source files to a separate backup folder.
2. Clone or copy a clean project checkout into a new directory.
3. Run `npm ci`.
4. Restore `.env` manually, keeping secrets out of Git.
5. Restore the database only after the clean app starts successfully.
6. Run `npm run typecheck`, `npm run lint`, and `npm test`.
7. Start the app and verify the demo account before restoring personal data.

Do not overwrite the original folder until the clean-room copy has passed its checks.

## Recovery checklist

- [ ] Error and command recorded
- [ ] Git status checked
- [ ] Database and `.env` backed up
- [ ] Node.js and npm confirmed
- [ ] `npm install` or `npm ci` completed
- [ ] Typecheck passed
- [ ] Lint passed
- [ ] Unit tests passed
- [ ] App opened at the local URL
- [ ] Demo sign-in verified
- [ ] Database reset only if necessary
- [ ] Secrets excluded from logs and commits
