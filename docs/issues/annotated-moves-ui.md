## Issue: Improve "Annotated moves" UI

### Problem
The current annotated moves list is dense and hard to scan. Symbols/tags/badges and PV blocks can feel cluttered, and important moves (blunders, only-moves) don’t stand out enough.

### Goals
- Increase scannability and visual hierarchy of annotated moves.
- Make critical moves immediately obvious (color, emphasis, icons).
- Keep information density reasonable while preserving detail on demand (tooltips/collapsible PVs).

### Scope
- Visual/UX improvements for the annotated list on `/report/latest` only.
- No change to grading logic or data shape.

### Design Ideas
- Two-line item per move:
  - Line 1: move number + SAN + symbol (e.g., !!, ??) + tag badge + small badges (agrees/only) + eval (cp).
  - Line 2 (muted, collapsible): short note + best/played PVs (truncate with expand).
- Color accents by severity: Best/Excellent (green/blue), Inaccuracy (amber), Mistake (orange), Blunder (red).
- Emphasize selected move and allow keyboard navigation (↑/↓).
- Add a compact legend above the list and a filter (e.g., show only Mistakes/Blunders).

### Acceptance Criteria
- Moves with tag Mistake/Blunder are visually distinct (color and/or icon) and quickly discoverable.
- Notes and PVs are hidden by default on non-selected items; expand on selection/hover.
- Legend and optional filters present; performance remains smooth for 150+ plies.
- Mobile view (≤ 375px) remains readable and navigable.

### Tasks
1) Layout
   - Convert list items to two-line layout with clearer spacing and typography.
   - Add severity-based color accents and icons.
2) Interactions
   - Collapse PVs/notes by default; show for selected move; add expand/collapse control.
   - Keyboard navigation (↑/↓) to move selection.
   - Optional filter chips: All, Only blunders, ≤ Good, etc.
3) Legend & badges
   - Place a concise legend above the list.
   - Standardize badges (agrees/only) appearance/spacing.
4) Mobile polish
   - Ensure wrapping/truncation; test on narrow widths.
5) QA
   - Visual pass across themes; check long PVs and long notes; verify performance on large games.

### Open Questions
- Do we want a separate panel for “critical moves” with only Mistakes/Blunders?
- Persist user filters/expanded states between loads?


