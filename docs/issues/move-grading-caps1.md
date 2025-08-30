## Issue: Move Grading (CAPS1-level)

Goal: Implement a robust move grading system comparable to CAPS v1 quality, producing consistent, mate-aware accuracy and categorical judgments per move and per game.

### Background
We currently:
- Show an eval bar for the current position (post-move), normalized to white perspective.
- Generate a post-game report with mate-aware CPL (centipawn loss) tags and a simple accuracy formula.

Gaps vs CAPS1-level:
- No MultiPV context for “engine agreement” or alternative strong moves.
- No explicit handling of “only moves” and move difficulty.
- No phase-aware weighting (opening/middlegame/endgame) or complexity weighting.
- Limited mate-aware handling; no clear aggregation into per-side accuracy with richer metrics (e.g., ACPL, critical errors).

### Objectives
1) Per-move grading parity
   - Compute pre-move best eval and eval of the played move constrained by searchmoves.
   - Mate-aware CPL with override when best is mate.
   - MultiPV (at least 3) to detect if the played move is within best alternatives (engine agreement).
   - Detect “only move” (no alternative ≥ −X cp within top K lines) and treat accuracy leniently when complexity is high.

2) Per-game metrics
   - Accuracy per side: refine current formula; report ACPL, average CPL, median CPL.
   - Count of Best/Excellent/Good/Inaccuracy/Mistake/Blunder with mates, and “only-move saves”.
   - Phase segmentation (opening/middlegame/endgame) with separate summaries.

3) Performance/Robustness
   - Deterministic depth-based analysis with configurable depth and MultiPV.
   - Time budget per move and total run caps; graceful fallbacks on timeouts.
   - Engine option isolation across requests (pool resets options per job).

### Acceptance Criteria
- Given a test suite of PGNs with known blunders, the system:
  - Tags at least 95% of large >300 CPL mistakes as Mistake/Blunder.
  - Preserves mate-aware overrides: if best is mate and played isn’t (or increases mate distance), it is tagged Blunder.
  - Reports per-side accuracy within ±3% over repeated runs at same depth.
- MultiPV=3 enables “engine agreement” flag when played move is within top N lines and within ≤30 cp of best.
- “Only move” detection: when best line advantage decreases drastically for all alternatives (≥200 cp), the played only-move gets a favorable tag even if raw CPL is non-zero.
- End-to-end batch analysis of 120 plies at depth 14 finishes under 60s on baseline machine.

### Design Notes
- CPL thresholds (initial):
  - Best ≤ 30, Excellent ≤ 70, Good ≤ 150, Inaccuracy ≤ 300, Mistake ≤ 600, Blunder > 600.
- Mate-aware: Before threshold mapping, force Blunder when best is mate and played is not, or increases mate distance.
- Phase detection: derive via move number heuristics and/or simplified material profile.
- Complexity proxy: use MultiPV spread and node count; wide spreads/low eval stability imply high complexity.

### API Changes
- EnginePool: support MultiPV (parse multiple `info` lines for pv 1..K) and expose the set per call.
- POST `/api/report/generate`:
  - Inputs: existing (fens, sans, depth, elo, debug), add `multiPv` (default 3).
  - Outputs: add per-move fields: `cpl`, `tag`, `agreement` (bool), `onlyMove` (bool), `phase` (enum), `bestPv`, `playedPv`.
  - Aggregate: `accuracyWhite`, `accuracyBlack`, `acplWhite`, `acplBlack`, counts per tag.

### UI Changes
- Report page shows per-move tags, CPL, and indicators for agreement/only-move.
- Summary header: accuracy per side, ACPL, counts by tag, phase breakdown.
- Optional: toggle to color the eval graph by tag without altering bar layout.

### Tasks
1) EnginePool MultiPV
   - Add `multiPv` option; parse `multipv` lines into arrays; preserve best line as pv=1.
   - Ensure per-job option isolation and reset between jobs.
2) Report generation
   - Compute preBest, prePlayed (searchmoves), mate-aware CPL, tag.
   - Derive agreement (played within top N lines and within ≤30 cp of best).
   - Detect only-move with threshold across MultiPV spreads.
   - Aggregate per-side metrics (accuracy, ACPL) and phase breakdown.
3) API schema updates and validation
4) Report UI: table and summary cards
5) Fixtures & tests
   - Curate PGNs with known tactical blunders, only-moves, and quiet inaccuracies.
   - Snapshot tests for tags/accuracy; runtime budget checks.

### Open Questions
- Depth vs time control for stability? Consider `movetime` for reproducibility.
- MultiPV value by default (3 vs 5)?
- Phase detection heuristic sufficiency vs material-based classification?
- Weighting accuracy by complexity (agreement/only-move) — how strong?

### Definition of Done
- New API returns enriched per-move and aggregate metrics.
- UI exposes report with tags, agreement, only-move markers, and phase summary.
- Repeat runs at same depth produce stable accuracy (±3%) on fixtures.
- Documentation updated; examples added to `docs/`.



