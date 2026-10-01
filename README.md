# StudyPilot

A study-planning application for organizing subjects, syllabi, deadlines, and study sessions.

## Overview

StudyPilot builds and updates study plans from a student's subjects, syllabus, availability, and exam dates. The application includes progress tracking and optional AI-assisted study tools; local planning features use a deterministic scheduling engine.

## Features

- Subject, syllabus, exam, and task management
- Daily plans, calendar views, and study-session rescheduling
- Focus sessions and progress summaries
- Optional AI chat, quiz, flashcard, and study-material tools

## Tech Stack

- **Application:** Next.js 16, React 19, TypeScript
- **Data:** Drizzle ORM, SQLite (`better-sqlite3`)
- **UI and validation:** Tailwind CSS, Zod
- **Testing:** Vitest

## Getting Started

Use Node.js 20.9 or later with npm. From the repository root:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The app creates its local SQLite database and applies migrations on startup. AI provider keys are optional and can be configured through `.env.example`.

Run the available checks with:

```bash
npm test
npm run typecheck
```

## Architecture

The Next.js App Router contains the public and authenticated screens. Server-side actions use a Drizzle-backed SQLite database, while scheduling and rescheduling logic lives in `src/lib/engine/`.

## Author

Pasupuleti Neeraj

[GitHub](https://github.com/zero2006-lightnight) | [LinkedIn](https://www.linkedin.com/in/pasupuleti-neeraj-b0698a3a7)