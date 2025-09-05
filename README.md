# ♟️ ChessAnalyzer — Play, Analyze, and Review with Flair ✨

ChessAnalyzer is a modern Next.js + TypeScript app for analyzing chess games with Stockfish. It features CAPS1‑style grading, engaging UI, per‑move annotations, and shareable post‑match reports. Analyze live games you play in the app or import PGNs with a click. 💡

## 🚀 Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the app.

### 🧠 Engine

Install Stockfish on your system (CI uses `apt-get install stockfish`). The app auto‑detects `STOCKFISH_PATH` or common locations. Logs are written to `logs/app.log`. 🔧🗂️

### 💾 Database

Development uses SQLite (`prisma/dev.db`). Ensure `DATABASE_URL="file:./prisma/dev.db"` in `.env`.

Optional: For production, you can point Prisma to Postgres by setting `DATABASE_URL` accordingly.

### 🧰 Commands

- `npm run dev`: start dev server
- `npm run build`: build
- `npm run start`: start prod server
- `npm run test:caps1`: run CAPS1 smoke/snapshot tests
- `npm run test:caps1:stability`: run stability checks (variance ≤ 3%)

## ✨ Features

- CAPS1‑style grading: mate‑aware CPL, tags (Best→Blunder), engine agreement, only‑move detection 🧮
- Per‑move symbols/notes (!!, ?, ?!, ??) and PVs in detailed reports 📝
- Aggregates: ACPL/accuracy per side and by phase (opening/middlegame/endgame) 📊
- Opening book integration for early plies via `/api/opening` 📚
- Analyze via PGN imports or games played in‑app; supports forfeits and timed modes ⏱️
- Dark mode with theme toggle and clean, accessible UI 🌗
- Puzzle mode with difficulty/motif filters and hinting 🧩
- Health check for engine availability ✅

## 🔌 API Endpoints

- `POST /api/analyze` → { bestmove, info, book? }
  - Body: `{ fen, depth?, elo?, limitStrength?, multiPv? }`
- `POST /api/report/generate` → saves report
  - Body: `{ fens?, sans?, pgn?, startFen?, depth?, elo?, multiPv?, result? }`
- `GET /api/report/latest` → latest saved report
- `GET /api/report/latest/details` → CAPS1 per‑move + aggregates
- `GET /api/report/[id]` → fetch report by id
- `GET /api/analyses` | `POST /api/analyses` → saved analyses (graphs)
- `GET /api/puzzles` | `GET /api/puzzles/random` | `POST /api/puzzles/attempt`
- `GET /api/opening?fen=...` → opening book entry
- `GET /api/health/engine` → engine health

See `src/app/api/**` for full handlers.

## 🧱 Tech Stack
- Next.js 15 (App Router) + React 19 ⚛️
- TypeScript 🧷
- Tailwind CSS v4 (custom CSS variables for themes) 🎨
- Prisma ORM + SQLite (dev) / Postgres (optional prod) 🗄️
- Stockfish (external engine) ♟️
- chessops, react‑chessboard libraries

## 🖥️ UI Highlights
- Sticky header with navigation and theme toggle
- Card‑based layout for clarity; accessible focus states
- Eval bar and interactive graphs with click‑to‑scrub
- Annotated move list with severity badges and symbols

## 🔄 CI

GitHub Actions runs lint/build and CAPS1 tests on push/PR (`.github/workflows/ci.yml`). 🧪

## 📄 License

MIT

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font).

## 🙌 Contributing
PRs welcome! Please run `npm run lint` and ensure tests pass. Open an issue for ideas/bugs/enhancements.

## 🧾 Logging
Application logs are written to `logs/` (e.g., `logs/app.log`) and include engine health and analysis traces.
