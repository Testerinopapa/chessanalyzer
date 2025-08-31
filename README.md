ChessAnalyzer is a Next.js + TypeScript app for analyzing chess games with Stockfish, CAPS1‑style grading, and a clean UI. It supports analyzing locally played games and PGN imports, with post‑match reports, blunder detection, and opening book integration.

## Getting Started

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

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Engine

Install Stockfish on your system (CI uses `apt-get install stockfish`). The app auto‑detects `STOCKFISH_PATH` or common locations. Logs are written to `logs/app.log`.

### Database

Development uses SQLite (`prisma/dev.db`). Ensure `DATABASE_URL="file:./prisma/dev.db"` in `.env`.

### Commands

- `npm run dev`: start dev server
- `npm run build`: build
- `npm run start`: start prod server
- `npm run test:caps1`: run CAPS1 smoke/snapshot tests
- `npm run test:caps1:stability`: run stability checks (variance ≤ 3%)

## Features

- CAPS1‑style grading: mate‑aware CPL, tags (Best..Blunder), engine agreement, only‑move detection
- Per‑move symbols/notes (!!, ??, etc.) and PVs in the report
- Aggregates: ACPL/accuracy per side and per phase (opening/middlegame/endgame)
- Opening book: local JSON book for early plies; `/api/opening` endpoint
- Analyze via PGN or locally played games; supports forced results (forfeit)
- Dark mode with theme toggle; improved annotated moves UI

## API

- `POST /api/analyze` → { bestmove, info, book? }
  - Body: `{ fen, depth?, elo?, limitStrength?, multiPv? }`
- `POST /api/report/generate` → saves report
  - Body: `{ fens?, sans?, pgn?, startFen?, depth?, elo?, multiPv?, result? }`
- `GET /api/report/latest` → latest saved report
- `GET /api/report/latest/details` → CAPS1 per‑move + aggregates
- `GET /api/opening?fen=...` → opening book entry

## CI

GitHub Actions runs lint/build and CAPS1 tests on push/PR (`.github/workflows/ci.yml`).

## License

MIT

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
