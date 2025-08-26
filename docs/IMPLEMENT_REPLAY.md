## Post‑Match Replay, Eval Graph, and Key Moments

This document outlines the concrete implementation steps to add a full replay experience to the post‑match report page, similar to chess.com’s review.

### Goals
- Board replay with move navigation and keyboard support.
- Eval graph linked to plies (click to jump; hover to preview).
- Key moments list (blunders, missed wins, best moves, critical swings).
- Smooth, zero‑jank experience using the already generated `Report`.

### Data the UI consumes
- `Report` (already persisted):
  - `fens: string[]` – position after each ply
  - `sans: string[]` – SAN for each ply
  - `evals: number[]` – cp eval for each ply
  - `tags: string[]` – per‑ply labels
  - `depth: number`, `elo?: number`, `accuracy: number`

No additional server calls are needed beyond fetching the report.

### API and routing
- Keep `GET /api/report/latest` (exists).
- Optional: `GET /api/report/:id` for future deep-linking.
- Page route plan:
  - `app/report/[id]/page.tsx` – detail page (future)
  - `app/report/latest/page.tsx` – current entry point

### UI/UX additions on `/report/latest`
1) Board replay
   - Add `react-chessboard` to the report page.
   - Local state: `ply: number` (0..N-1)
   - Render board with `position={fens[ply] === startpos ? undefined : fens[ply]}`.
   - Controls:
     - Buttons: `|<` (0), `<` (ply-1), `>` (ply+1), `>|` (N-1)
     - Keyboard: Left/Right arrows
     - Click on move list row sets `ply`.
   - Last‑move highlight: compute from consecutive FENs or re-parse SAN for that ply (optional).

2) Eval graph
   - Render the existing SVG graph, reusing the mapping used in the main page (`cp → y` clamped to ±800cp).
   - The current `ply` is rendered as an emphasized dot.
   - Click on the graph moves the `ply`.
   - Optional hover: show tooltip with `(ply, eval, SAN)` and soft-highlight move.

3) Key moments
   - Build from `tags` and eval swings:
     - Include all non-empty `tags[i]`.
     - Also include large absolute deltas (e.g., ≥ 150cp) even if tag is empty.
   - Sort by importance (Blunder/Missed Win > Mistake > Inaccuracy) and then by absolute delta.
   - UI: a right-hand list or a section under summary; each item is a link that sets `ply`.

### State and interactions
- `const [ply, setPly] = useState(0)`
- Derived:
  - `currentEval = evals[ply]`
  - `currentSan = sans[ply]`
  - `currentTag = tags[ply]`
- Side effects:
  - On `ply` change, update board and focus selected move row.

### Components (suggested split)
- `ReportBoard.tsx` – board + controls
- `ReportEvalGraph.tsx` – graph + click/hover handlers
- `ReportKeyMoments.tsx` – list of key moments
- `ReportSummary.tsx` – accuracy, depth/elo, counts of blunders/mistakes/inaccuracies

### Styling / details
- Graph y‑axis: cp scaled to ±800; 0 line in the middle.
- Key moments badges: color codes per severity.
- Maintain mobile responsiveness (board above controls; graph collapses below).

### Minimal implementation plan
1) `/report/latest` page: fetch report → lift `ply` state → render summary stubs.
2) Add board with basic controls and move list click‐to‐seek.
3) Add eval graph with click‑to‑seek; highlight current `ply`.
4) Compute key moments array from `tags` + deltas and render it as links.
5) Polish: keyboard navigation, hover tooltip, last‑move highlight.

### Edge cases
- Empty report or mismatched array lengths: show fallback message.
- Mate lines (huge cp): clamp display but show `M` label near the bar/graph.
- Very long games: virtualize move list (optional later).

### Follow‑ups (optional)
- Export: PGN with inline comments derived from `tags` and evals.
- Deep link: `/report/:id?ply=NN` with `URLSearchParams` sync.
- Compare vs alternate lines (MultiPV) by re‑running batch with `multipv>1` (later).


