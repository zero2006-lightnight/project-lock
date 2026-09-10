# StudyPilot

**Your AI-powered study co-pilot.** Plan smarter. Study better. Stay ahead.

StudyPilot turns a student's syllabus, deadlines, and available time into a personalized daily study plan that adapts as they progress — combining a deterministic planning engine, an optional LLM tutor, progress analytics, focus sessions, and tasteful gamification in a premium, dark-mode-ready product UI.

Built as a **complete, working product MVP** — not a prototype. Every screen, action, and flow is functional.

---

## Quick start

```bash
npm install
cp .env.example .env       # defaults work out of the box
npm run dev                # http://localhost:3000
```

The app works with **no configuration at all**:

1. Open http://localhost:3000 — the landing page.
2. Sign in with the **demo account** (button on the login page):
   - `demo@studypilot.app` / `demo1234`
   - The account auto-seeds on first visit with Alex, a realistic CS student: 5 subjects, full syllabus with units/topics, 2 exams, assignments, ~3 weeks of study history, sessions, achievements.
3. Or **Create account** and walk the onboarding wizard — it builds your profile, subjects, syllabus, exams, availability, and generates your first plan.

> On a fresh database the demo data is seeded automatically the first time the app is touched. Run `npm run seed` to (re)seed the demo user manually. Delete `data/studypilot.db` to reset everything.

---

## What's inside

| Area | What it does |
|---|---|
| **Dashboard** (`/app`) | Today's plan with progress ring, study blocks, upcoming deadlines, exam countdown, streak, weekly progress, weak topics, AI recommendation |
| **Today** (`/app/today`) | Full daily timeline; every block can be **started, completed, skipped, or rescheduled** |
| **Syllabus** (`/app/syllabus`) | Subject → unit → topic tree with statuses (Not started / Learning / Completed / Needs revision), progress, strong/weak topics, **PDF import** (AI-parsed or deterministic heuristic fallback) |
| **Subjects** (`/app/subjects`) | Subject cards with progress, exam date, priority, weak areas, trend |
| **Exams** (`/app/exams`) | Countdown, syllabus %, readiness score, weak areas, recommended sessions, **exam preparation roadmap** (learning → practice → revision → mock) |
| **Tasks** (`/app/tasks`) | Assignments/projects/quizzes with deadline, priority, status filters |
| **Calendar** (`/app/calendar`) | **Week + month views** mixing study sessions, tasks, and exams — drag any upcoming study block onto another day to reschedule it (capacity-aware, refuses past days & duplicate topics) |
| **Chat** (`/app/chat`) | StudyPilot AI assistant with full user context, suggested prompts, intent router with structured responses, **token-by-token streaming**, session-based history. Works **with or without an LLM key** |
| **Tuning** (`/app/tuning`) | **Per-subject knowledge bases** — upload PDFs, AI extracts + chunks + embeds them, then answers questions grounded in your materials with Mermaid diagrams, concept maps, and personalized context. Includes a Tuning Intelligence Engine for subject detection, intent classification, and response-strategy selection |
| **Flashcards** (`/app/flashcards`) | AI-generated flashcards from your syllabus or Tuning materials — tap to reveal the answer, rate with Easy / Need practice / Hard, save decks for review, "worth reviewing" chips driven by real signals |
| **Mind Maps** (`/app/mindmaps`) | AI-generated structured mind maps — central topic node with branches fanning left/right, curved connectors, color-coded accents, collapse/expand, zoom. Saved per account |
| **Focus** (`/app/focus`) | Pomodoro / custom timer that records real study sessions when you finish |
| **Progress** (`/app/progress`) | Weekly study time, streak heatmap, subject distribution, completion rate, consistency |
| **Achievements** (`/app/achievements`) | Streaks, task milestones, subject completion, focus-session awards |
| **Settings** (`/app/settings`) | Profile, preferences, notifications, AI provider status, data reset |
| **Onboarding** | 9-step wizard: profile → subjects → syllabus → exams → deadlines → availability → preferences → AI plan generation |
| **Landing page** | Full SaaS landing (hero, how-it-works, features, testimonials, pricing, FAQ, CTA) |
| **Auth** | Email/password (scrypt hashing), secure session cookies, route protection, **Google OAuth** (optional — add `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` from Google Cloud Console and the "Continue with Google" button appears), demo sign-in |

**Every feature has loading, empty, error, and success states.** No dead buttons, no fake functionality.

---

## Architecture

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Drizzle ORM · SQLite (better-sqlite3) · Zod · Recharts · Lucide · date-fns · Vitest

```
src/
├── app/                      # Next.js routes
│   ├── (public)              # landing, login, signup, onboarding  →  /, /login, ...
│   ├── app/                  # authenticated product area            →  /app, /app/today, ...
│   └── layout.tsx            # fonts, theme, toast provider
├── components/
│   ├── ui/                   # design-system atoms (button, card, badge, dialog, …)
│   ├── app/                  # feature components (plan rows, managers, chat, timer, charts)
│   └── auth/
├── lib/
│   ├── ai/                   # provider abstraction + intent router + streaming
│   ├── auth/                 # scrypt hashing, sessions, Google OAuth
│   ├── actions/              # server actions (curriculum, planning, chat, study, tuning, settings)
│   ├── assess/               # quiz/flashcard/mind-map generation schemas
│   ├── db/                   # schema, client, migrations, achievements catalog, demo seed
│   ├── engine/               # deterministic planning engine (pure, testable)
│   ├── security/             # rate limiting, input sanitization, request keying
│   ├── services/             # orchestration: data loading, plans, activity, analytics, chat, extraction
│   ├── study/                # shared study layer: syllabus sources, difficulty contracts, scheduling
│   ├── tuning/               # knowledge bases, embeddings, chunking, retrieval, jobs, intelligence
│   └── dates.ts, utils.ts
├── scripts/                  # seed-demo, smoke test, QA harnesses
└── tests/                    # Vitest unit tests
```

### The engine / AI split (by design)

- **Deterministic core** (`lib/engine/`): topic scoring (deadline urgency, exam proximity, difficulty, weakness, importance, prerequisites, past failures), daily scheduling with preferred-time windows and breaks, missed-task **redistribution across future days without overloading**, exam readiness and phase roadmaps, statistics, and insight generation. Pure functions — fully unit-tested, no LLM involved.
- **AI layer** (`lib/ai/`): a small provider interface (`LocalEngineProvider` + an OpenAI-compatible `LLMProvider`) behind one factory. The **local engine answers every chat intent deterministically** (plan my day, what should I study, am I on track, quiz me on a topic, reschedule…). When `AI_API_KEY` is set, free-form tutor chat, richer explanations, and LLM quiz/flashcard generation light up. Responses stream token-by-token via an SSE route (`/api/chat`).
- LLM outputs are validated against Zod schemas before anything is applied; the LLM can **never** write to the database directly. Core scheduling never depends on the model.

### Tuning system (`lib/tuning/`)

A per-subject **RAG (Retrieval-Augmented Generation)** pipeline that learns from the student's own materials:

- **Knowledge bases** with multi-PDF upload (10 files/req, 15MB limit, PDF-only, deduplication)
- **Extraction + chunking** — heading-aware text splitting with overlap; chunks are embedded per knowledge base (provider embeddings when available, deterministic local fallback)
- **Retrieval** — user+subject-scoped cosine similarity search, authorized progress signals, deterministic composer with honest thin-coverage paths
- **Tuning Intelligence Engine** (`lib/tuning/intelligence/`) — 11 decision modules that run *before* retrieval: subject detection (explicit > workspace > conversation > auto), multi-label classification (15 categories), intent analysis (quick_fact / learn / exam_prep / revise / apply), response-strategy selection (A–F with skeleton plans), visual decision (graphs require real data, never fabricated), subject-map generation from sections + co-occurrence, evidence-based profile notes, context ranking/dedup/capping, validation (uncertainty blocked instead of hallucination), and a full pipeline (decide → retrieve → decide again → generate)
- **Learned preferences** — each Tuning ask records count-only signals; the dashboard shows suggested-stage prefs with a reset control
- **Visual answers** — Mermaid flowcharts, SVG concept maps, structured week graphs; image generation via provider when available, honest fallback without one

### Study Intelligence system (`lib/study/`)

Shared retrieval and generation layer for quizzes, flashcards, and mind maps:

- **Syllabus sources** — ownership-checked, subject/unit/topic scoped, capped, pure builder (unit-tested)
- **Difficulty contracts** — per-level generation rules (easy = broad overview, mixed = standard, hard = stays inside the material)
- **SM-2-lite scheduling** — flashcard review intervals with prompt coercion (moved out of server action for testability)
- **Study-aids renderer** — pure, DB-free renderer (`buildStudyAids`) that produces flashcard + mind-map excerpts for Pilot's context; unit-tested independently of migrations

### Data layer

Normalized relational schema with all core entities: users, profiles, subjects, units, topics, exams, tasks, plan items, study sessions, daily stats, chat conversations/messages, quizzes, flashcards, mind maps, knowledge bases, knowledge documents, knowledge chunks, tuning jobs, tuning preferences, achievements, notifications, settings, AI recommendations.

Runs on **SQLite today; PostgreSQL-ready** — schema is Drizzle with Postgres-portable types; switching means swapping the driver and `DATABASE_URL` (`drizzle.config.ts`, `lib/db/index.ts`) and regenerating migrations.

### Key flows

- **Adaptive rescheduling:** miss a block and StudyPilot recalculates — the topic is redistributed across upcoming days (respecting the daily cap) instead of being silently dropped, with a plain-language explanation of what changed and why.
- **Plan generation:** after onboarding (or on demand), the engine reads availability, exams, and syllabus state to lay out a realistic day-by-day plan.
- **Contextual chat:** `/app/chat` gives the assistant live state (subjects, syllabus progress, upcoming exams/deadlines, today's plan, recent sessions, flashcards, mind maps) so answers are StudyPilot-specific, never a generic ChatGPT clone.
- **Tuning Q&A:** upload subject PDFs → AI extracts, chunks, embeds → ask a question → the Tuning Intelligence Engine detects the subject, classifies the intent, picks a response strategy, retrieves ranked chunks, then generates a grounded answer with visuals when appropriate. Answers cite source knowledge bases.
- **Syllabus quiz:** pick a subject from your existing syllabus → AI generates questions at the chosen difficulty (Easy / Medium / Hard) grounded in the actual topics → answer → receive strengths + weaknesses → retake weak areas.
- **General quiz:** no material needed → AI generates a general-knowledge quiz with honest difficulty grading and the same strength-reporting pipeline.
- **Flashcards:** AI generates teacher-style flashcard sets (varied kinds: definition, example, comparison, application, mechanism, formula, tip) from your syllabus → self-assess with Easy / Need practice / Hard → saved decks with "worth reviewing" driven by real signals.
- **Mind maps:** AI generates a structured tree (central topic → 6 branches → 5 children each, capped) → NotebookLM-style rendering with fanning branches, curved connectors, collapse/expand, zoom.
- **Pilot knows your study aids:** Pilot AI sees your recent flashcards and mind maps in context and can reference them when answering study questions.

---

## Security

- **Auth rate limiting:** login (5 attempts / 15 min per email + 30 / 15 min per IP), signup (5 / hour per IP), Google OAuth callback (10 / 15 min per IP) — all fail-closed with honest retry windows
- **AI chat rate limiting:** 20 messages / 5 min per user (in-memory sliding window; rejected hits never consume budget)
- **Prompt-injection hardening:** control-character stripping, identical-line collapse, `<<<USER_MESSAGE>>>` delimiters, untrusted-input directive in the system prompt
- **Session security:** 32-byte random DB-backed tokens; `Secure` flag derived from real request protocol (not `NODE_ENV`); CSRF state cookies on OAuth
- **Input validation:** all LLM outputs validated against Zod schemas; tuning previews use single-use tokens with TTL

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build + serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (113 tests: engine, stats, security, tuning intelligence, study, syllabus-parse) |
| `npm run lint` | ESLint (0 errors) |
| `npm run seed` | (Re)seed the demo user (idempotent) |
| `npm run db:generate` | Generate Drizzle migrations after schema edits |
| `npm run db:studio` | Drizzle Studio for the SQLite file |
| `node scripts/smoke.mjs` | Headless smoke test — boots the production server and exercises all 18 routes |
| `node scripts/visual-qa.mjs` | Headless-Chrome visual QA of the calendar — light/dark/week screenshots into `scripts/.shots/` |
| `node scripts/flow-qa.mjs` | Headless-Chrome core-flow QA — login, complete a block, reschedule, check persistence |
| `node scripts/ai-qa.mjs` | Headless-Chrome AI-path QA (needs `AI_API_KEY`) — sends tutor, quiz, and flashcard prompts through the real chat UI |

---

## Environment variables

See `.env.example`. The only ones that matter for local development:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | No | `file:./data/studypilot.db` | SQLite file path (Postgres-ready after driver swap) |
| `AI_PRIORITY` | No | `openrouter,grok,gemini` | Failover order — first keyed provider answers, next on failure, local engine last |
| `OPENROUTER_API_KEY` | No | *(empty)* | OpenRouter key — primary real-model provider (chat, embeddings, vision) |
| `OPENROUTER_MODEL` | No | `openai/gpt-4o-mini` | Chat model ID (vendor prefix required, e.g. `qwen/qwen-2.5-7b-instruct`) |
| `OPENROUTER_EMBED_MODEL` | No | `openai/text-embedding-3-small` | Embeddings model for Tuning chunk indexing |
| `GROK_API_KEY` | No | *(empty)* | xAI Grok key (from console.x.ai, OpenAI dialect) |
| `GROK_MODEL` | No | `grok-3-mini` | Grok chat model ID |
| `GEMINI_API_KEY` | No | *(empty)* | Google AI Studio key (native dialect, streaming supported) |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini chat model ID |
| `AI_PROVIDER` | No | *(empty — offline engine)* | Legacy single provider (`openai`/`anthropic`/`gemini`) — kept as last-resort fallback |
| `AI_API_KEY` | No | *(empty)* | Legacy provider key (e.g. Groq free tier still works here) |
| `AI_BASE_URL` | No | *(empty)* | Legacy custom endpoint URL (OpenRouter, Groq, Together, llama.cpp, …) |
| `AI_MODEL` | No | `gpt-4o-mini` | Legacy model name |
| `GOOGLE_CLIENT_ID` | No | *(empty)* | Google OAuth client ID (shows "Continue with Google" when set) |
| `GOOGLE_CLIENT_SECRET` | No | *(empty)* | Google OAuth client secret |
| `NEXT_PUBLIC_APP_URL` | No | `http://localhost:3000` | App origin for absolute links |

---

## Testing

| Layer | What | Count | How |
|---|---|---|---|
| **Unit tests** (`tests/`) | Topic scoring, scheduling, rescheduling, exam roadmap, readiness, stats, security (rate limit + guard + request key), Tuning Intelligence (classify, intent, strategy, visual, subject-map, profile, context, validator, pipeline), study (syllabus sources, difficulty contracts, scheduling, strengths, layoutTree, study-aids), syllabus-parse | 113 | `npm test` |
| **Smoke test** (`scripts/smoke.mjs`) | Boots production server, exercises all routes with real session cookies | 18/18 | `node scripts/smoke.mjs` |
| **CI pipeline** (`.github/workflows/ci.yml`) | lint → typecheck → tests → build → smoke on every push/PR | — | GitHub Actions (Node 24, ubuntu-latest, npm cache) |

---

## Changelog highlights

All changes are documented in `PROJECT-LOCK-CHANGELOG.txt` (22 entries) and tracked in `PROJECT-LOCK-SUGGESTIONS.txt`. Key milestones:

| Entry | What | Status |
|---|---|---|
| #1–#9 | **Foundation MVP** — full product build, mobile grid fix, calendar DnD, real AI provider, onboarding UX, Google OAuth, LAN cookie fix, error boundaries, rate limiting + prompt injection | ✅ Done |
| #10 | Auth endpoint rate limiting (login/signup brute-force defense) | ✅ Done |
| #11 | ESLint debt cleared (20 errors → 0, 39 warnings → 0) + achievements bug fix | ✅ Done |
| #12–#13 | CI pipeline (GitHub Actions) + live run watched to green | ✅ Done |
| #14 | Streaming AI chat (token-by-token via SSE) | ✅ Done |
| #15 | UI redesign (cobalt + cream identity), general-purpose Pilot, syllabus file uploads, session-based chat | ✅ Done |
| #16 | Dead `SESSION_SECRET` configuration removed | ✅ Done |
| #17 | PDF syllabus import (AI parsing + deterministic heuristic fallback + editable preview) | ✅ Done |
| #18 | **Tuning** — per-subject knowledge bases from user PDFs (RAG pipeline: upload → extract → chunk → embed → retrieve → ground answers) | ✅ Done |
| #19 | **PL-025** — Tuning Intelligence Engine (11 decision modules: subject detection, classification, intent, strategy, visual decisions, subject mapping, profiling, context building, validation, pipeline) | ✅ Done |
| #20 | **PL-026** — Study Intelligence (syllabus-based quiz, general quiz, AI flashcards, AI mind maps, shared retrieval layer, difficulty contracts, SM-2-lite scheduling) | ✅ Done |
| #21 | Flashcard answer reveal (explicit Show/Hide), Pilot connected to flashcards + mind maps via `ChatContext.studyAids`, mind maps persisted (table + migration 0007) | ✅ Done |
| #22 | NotebookLM-style mind-map tree (HTML tree layout with fanning branches + curved connectors + collapse/expand + zoom), bulletproof flashcard reveal (3D flip removed → plain conditional panels) | ✅ Done |

---

## Known limitations & next steps

**Troubleshooting:**
- **Signed up but bounced back to /login during onboarding?** You were likely accessing the app over plain HTTP on a LAN IP (e.g. `http://192.168.56.1:3000`). Browsers silently reject `Secure` cookies on non-localhost HTTP, which logged you out mid-onboarding. Fixed: the session cookie is now `Secure` only when the app is actually served over HTTPS. If you host behind a TLS-terminating proxy, make sure it sends `x-forwarded-proto: https`.
- **Flashcards or mind maps show nothing?** Saved cards and maps are **per account** — they are not shared between the demo account and your personal account. Sign in with the account that generated them.
- Dashboard/Today crashing with `Invalid time value` for brand-new accounts (no topics yet → no plan blocks) — also fixed; both pages now fall back gracefully when no plan exists.

**Limitations (MVP):**
- SQLite file DB (by design — single-instance). Postgres migration is a driver/config swap, but not yet executed.
- Calendar drag-and-drop is day-level (move a block to another day at its same time) and uses native HTML5 drag — fine on desktop; touch/keyboard drag is not implemented yet. Study blocks only exist for the rolling window the planner has generated, so far-future month cells stay empty until the plan rolls forward or you drag a block there.
- LLM tutor requires a provider API key; without one, chat is deterministic intent handling.
- Tuning knowledge bases are single-instance (in-process worker); moves to a dedicated worker with Postgres (PL-009).
- Notifications are preference-configurable in settings; push/email delivery not yet wired.
- No OCR for image uploads yet (photo-of-textbook path produces no text — tracked as PL-024).
- Tuning ask panel is stateless (conversation-context resolution is plumbed but idle — tracked as upgrade opportunity).

**The roadmap spec'd for future phases:** Postgres migration, notification delivery, calendar DnD maturity (touch/keyboard), containerized deployment (Dockerfile + compose), password reset, spaced-repetition flashcard scheduling, GitHub OAuth, chat history pagination, landing page demo video, OCR for image uploads, study groups, wearable tracking, offline mode, voice assistant, multi-user deployment.

---

## License

Private project — built for the StudyPilot product. © 2026.
