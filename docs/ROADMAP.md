## ChessAnalyzer — Roadmap Options and Review

This document captures the near-term directions we can take, with concrete deliverables, assumptions, risks, and open questions. It’s meant to be a review to catch gaps or AI‑introduced inconsistencies.

### 1) Engine Reliability: Long‑Lived Worker/Pool
- Deliverables
  - Single long‑lived Stockfish process (or a small pool, size = CPU cores) managed server-side
  - In‑memory queue for requests; optional Redis queue for scale
  - Request dedupe (key: fen+depth+elo) and cancelation on stale board state
  - Health endpoint kept (periodic uciok/readyok)
- Assumptions
  - Pool stays stable under expected concurrency (<= low tens of requests/sec)
  - Stockfish options (UCI_Elo, UCI_LimitStrength) can be set per analysis
- Risks
  - Process leaks if not correctly killed on crashes
  - Per-request options must not bleed across sessions (reset engine state)
- Open Questions
  - Do we need multi-variant support (non-standard rules)? If so, per-engine configs
  - Should we add time‑based search (movetime) vs depth for more consistent latency?

### 2) UX Upgrades Around Analysis
- Deliverables
  - Eval bar and last‑move highlight; move sounds
  - “Blunder alerts” from eval deltas; mini annotations (?!, ??)
  - Opening book for first N moves (skip engine early)
  - Export analyzed PGN with comments (score, PV per move)
- Assumptions
  - Users want quick visual cues (blunders, swings) before deep dives
- Risks
  - Over‑annotation noise; keep togglable
- Open Questions
  - Preferred annotation schema (Lichess style vs custom)?
  - Should we support multiple engine lines (MultiPV) now or later?

### 3) Data, Users, and Persistence
- Deliverables
  - Auth (NextAuth) and user analysis history
  - Migrate SQLite → Postgres (dev/prod parity); Prisma schema evolution
  - Shareable short links (hashing or id-based) for analyses
- Assumptions
  - Postgres provided by hosting (Railway/Render/Fly) with backups
- Risks
  - Schema drift; migrations must be gated and reversible
- Open Questions
  - Data retention policy and storage costs for large PGNs/series

### 4) Performance & Infra
- Deliverables
  - Redis cache: FEN→(bestMove, score, pv) with TTL
  - Pre-fetch “Analyze All” in background; streaming updates to UI
  - CI e2e tests for play vs engine + analyze flows (Playwright)
  - Rate limiting per IP (and per route)
- Assumptions
  - Cache hit ratio meaningful on repeated positions
- Risks
  - Cache invalidation when options change (depth, elo); include in key
- Open Questions
  - Need CDN for static assets/wasm later? (if added)

### 5) Observability & Ops
- Deliverables
  - Structured logs with reqId (we already added); basic dashboards
  - Error reporting (Sentry or similar)
  - Engine metrics (time to ready, time to bestmove, timeouts)
- Assumptions
  - Logs shipped in prod; local to `logs/` in dev
- Risks
  - PII in logs; avoid logging PGN text unless necessary

### 6) Security
- Deliverables
  - Input validation (FEN, PGN); request size limits
  - Authz for user resources; CSRF and session hardening
- Open Questions
  - Any need for private analyses or team sharing controls?

### 7) Deployment
- Deliverables
  - PaaS deploy (Railway/Render/Fly) with health checks and secrets
  - Build profile with packaged Stockfish (or apt install on deploy image)
- Risks
  - Different Stockfish versions across environments; pin version

---

## Current State (Summary)
- UI: Analyze (server), PGN navigator, eval graph, Play vs Engine, Elo limit, check highlight, game-over banner
- API: `/api/analyze` with robust UCI handshake, reqId, startpos normalization, strength limiting; `/api/health/engine` readiness
- Persistence: Prisma + SQLite (dev) with `Analysis` model; saves PGN, FENs, series

## Known Gaps / Inconsistencies to Address
- Engine lifecycle still spawn-per-request; pool not implemented yet
- Concurrency: no cancelation/dedupe for in-flight analyze-all
- Rate limiting: not implemented
- Auth: not enabled; history is global
- Export PGN with annotations not implemented
- Tests (e2e) not yet added

## Proposed Priorities (Low Risk → High Impact)
1. Engine pool + request cancelation/dedupe; per-request option isolation
2. Rate limit + request size limit; basic Sentry integration
3. Eval bar, last move highlight, blunder alerts (toggled)
4. Export annotated PGN
5. Auth + Postgres migration + user history
6. Redis cache + prefetch pipeline
7. e2e tests for critical paths (engine health, play vs engine, analyze-all)

## AI Pitfalls to Avoid
- Over-abstracting prematurely (keep modules small and local)
- Silent error swallowing (always surface reqId + message)
- Mixing option state across engine requests (reset per call/pool checkout)
- Annotating everything by default (noise); keep toggles

## Acceptance Checks (Per Feature)
- Engine pool: no missed replies under quick move spam; timeouts logged; zero zombie processes
- Elo limit: engine reports consistent strength across runs at same Elo
- Analyze-all: can be canceled; progress reflected; UI remains responsive
- Export PGN: round-trips (import/export) without data loss

## Open Questions for Stakeholders
- Preferred hosting? Budget for managed Redis/Postgres?
- Mobile-first UI needs (screen real estate for eval graph/bar)?
- Do we need alternative engines (Lc0) or tablebases in near term?


