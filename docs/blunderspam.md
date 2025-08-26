Most Likely Causes of This Bug
The problem is almost certainly not with the chess engine itself (like Stockfish), but with how your code interprets the engine's output and assigns labels.

1. Absolute vs. Relative Threshold Bug (Most Likely Cause)
This is the prime suspect. Your logic is probably using an absolute threshold instead of a relative one.

Incorrect (Absolute) Logic: if abs(current_evaluation) > 5.0: then label_move("Blunder")

Why it's wrong: This would label every single move as a blunder once the evaluation exceeds 5.0, regardless of whether the move was good or bad for that position. This perfectly matches your output.

Correct (Relative) Logic: You must calculate the difference in evaluation (Δ, delta) caused by the move.

delta = eval_after_move - eval_before_move

If it's Black's move, you might need to flip the sign: delta = - (eval_after_move - eval_before_move) to see the change from Black's perspective.

Then apply the threshold to this delta:

if delta < -200: label_move("Blunder")

if delta > 200: label_move("Brilliant") / "Great"

(where 200 = 2.00 pawns)

Your output suggests you are applying the blunder threshold to the position's evaluation instead of the move's impact on the evaluation.

2. Side-to-Move Context Bug
You must always judge a move from the perspective of the player who made it.

A move that changes the evaluation from -7.51 (bad for Black) to -8.38 (even worse for Black) is a blunder by Black.

A move that changes the evaluation from -7.51 to -7.73 is a good move by Black (it slightly improves their position, or at least doesn't make it catastrophically worse).

If your code loses track of who made the move, it can mislabel everything.

3. Mate Score Misinterpretation
As discussed in the previous answer, if the engine outputs a "mate" score (e.g., mate -6) and your code misinterprets it as a large numerical value (e.g., -600.00), it will easily exceed any absolute threshold you have for blunders. If the position is a forced mate, almost every move is a blunder (except the one that delays it the longest), but the evaluations would be extreme (like -100.00, not -8.38).

How to Fix It: Step-by-Step
Store Evaluations Correctly: For each move, store two evaluations:

eval_before (the evaluation of the position before the move was played)

eval_after (the evaluation of the position after the move was played)

Calculate the Delta (Δ) Correctly:

python
# Pseudocode for calculating the impact of a move
if player_moved == "white":
    delta = eval_after - eval_before
else: # player_moved == "black"
    delta = eval_before - eval_after # Flip the perspective
Apply Thresholds to the Delta:

python
# Standard thresholds (can be adjusted)
if delta < -200:
    label = "Blunder"
elif delta < -100:
    label = "Mistake"
elif delta > 200:
    label = "Brilliant"
elif delta > 100:
    label = "Great"
else:
    label = "Good" # or "Book", "Excellent", etc.
Test with a Known Game: Analyze a simple game where you know the outcome (e.g., Fool's Mate). Check if the delta calculation correctly identifies the blundering move (1. f3?) and the brilliant move (2. g4??).

Conclusion:

The odds of this pattern happening in a real game are zero. It is unequivocally a bug in your analysis code. The most probable culprit is that you are using the absolute evaluation of the position to label the move, instead of using the change in evaluation (delta) caused by the move. Fixing this logic will immediately make your analyzer accurate and reliable.