🔍 Rubric for Labeling Chess Moves by Evaluation

(centipawn = 1/100 of a pawn, positive = White advantage, negative = Black advantage)

Best Move

Played move’s eval ≈ engine’s top choice (within ~20–30 cp).

Equivalently good if multiple moves have same eval.

Excellent / Great Move

Played move is close to best (within ~50–70 cp).

No meaningful swing in evaluation.

Good Move

Played move is slightly worse than best (70–150 cp difference).

Still keeps position stable.

Inaccuracy

Played move drops evaluation by ~0.15–0.30 pawns (150–300 cp).

“Soft” error, doesn’t immediately change the outcome.

Mistake

Drop in evaluation of ~0.3–0.6 pawns (300–600 cp).

A serious move that worsens chances.

Blunder

Drop in evaluation > 0.6 pawns (600+ cp) or turns a winning position into losing.

For mate scores: missing/allowing a forced mate counts as a blunder regardless of centipawns.

Brilliant Move (Chess.com-specific “feel-good” label, not strict engine logic)

Typically: a move that sacrifices material but leads to a strong forced continuation (engine best).

Example: Sacrificing a queen that forces mate or wins back material.

Harder to automate — requires checking sacrifice + engine-best + swing to your favor.

⚖️ Implementation Notes

Mate scores: If engine eval = #N (mate in N), that overrides centipawn thresholds.

Side-aware: Make sure to check whether the drop hurts the player to move or just shifts eval closer to 0 (e.g., if you’re losing badly, an “inaccuracy” might not matter much).

Consistency: Chess.com and Lichess each have slightly different thresholds — you’ll want to decide how strict to be.

✅ Quick Test Rubric

For each move, calculate:

delta = (eval_after_move - eval_best_move_for_player)


Then check against thresholds:

|delta| ≤ 30 cp → Best

|delta| ≤ 70 cp → Excellent

|delta| ≤ 150 cp → Good

|delta| ≤ 300 cp → Inaccuracy

|delta| ≤ 600 cp → Mistake

|delta| > 600 cp → Blunder

(special handling for Brilliant & Mate scores)