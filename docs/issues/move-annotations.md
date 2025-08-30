## Issue: Human-readable Annotations (Symbols and Notes)

### Problem
Current report shows CAPS1 tags (Best/Excellent/Good/Inaccuracy/Mistake/Blunder), but human-readable annotations (e.g., !?, ??) and short textual notes are missing or inconsistent.

### Goals
- Map CAPS1 tags and mate-aware situations to standard symbolic annotations (NAG-like): !, !!, !?, ?!, ?, ??.
- Optional: add one-line textual notes per move (e.g., "Only move", "Missed win", "Blunder: dropped piece").
- Keep eval bar unchanged; surface annotations in the move list and export.

### Scope
- Deterministic mapping from tags/metrics to symbols.
- Annotation badges in UI and in exported/returned data.
- Optional PGN export with NAG codes (future).

### Mapping Spec (initial)
- Blunder → "??"
- Mistake → "?"
- Inaccuracy → "?!"
- Good → "!"
- Excellent → "!!" (only when CPL ≤ 30 and agreement=true or onlyMove=true)
- Best → "!" (default), upgraded to "!!" when CPL ≤ 10 and agreement=true
- Special cases:
  - Only move (onlyMove=true) → append " (only)"
  - Missed forced mate (best is mate but played isn’t) → force "??" and note "missed mate"

### UI Changes
- Report page: show symbol next to SAN; tooltip with brief note.
- Legend explaining symbol meanings.

### API Changes
- `/api/report/latest/details` add per-move: `symbol: string`, `note?: string`.
- (Optional) add `nag?: number` codes for future PGN export.

### Acceptance Criteria
- For a curated PGN with known blunders/mistakes, symbols match expectations ≥ 95% of time.
- Only-move cases labeled with "(only)".
- Missed mate cases labeled as "??" with note "missed mate".
- UI shows symbols without degrading performance; tooltips present.

### Tasks
1) Details API: add `symbol`/`note` fields using mapping above.
2) UI: render symbols next to SAN; add tooltip with note; add legend.
3) Tests: snapshot symbols on fixtures; ensure mapping is stable.
4) (Optional) PGN export with NAG.

### Open Questions
- Do we want more nuanced symbols for "!" vs "!!" thresholds?
- Include complexity/difficulty in notes (e.g., "hard only move")?


