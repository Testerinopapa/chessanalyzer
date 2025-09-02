# Puzzle Mode Input – Stream Lichess PGN from .zst

## Summary
Add a streaming reader for the local Lichess monthly dump (`/root/ChessAnalyzer/chessanalyzer/lichess_db_standard_rated_2025-08.pgn.zst`) so we can ingest games incrementally for puzzle generation without loading the full file.

## Goals
- Stream PGNs from the .zst file with minimal memory footprint.
- Provide an async iterator that yields one PGN (string) at a time.
- Allow simple header-based filters (e.g., time control, Elo bounds, termination).
- Make it usable from API routes and scripts.

## Approach
- Use the system `zstd` binary to decompress to stdout and pipe into Node via `child_process.spawn('zstd', ['-dc', file])`.
- Wrap the process stdout with `readline` to buffer one PGN at a time (separated by blank lines after header + movetext).
- Expose a helper: `streamPgnGamesFromZst(filePath): AsyncGenerator<string>`.
- Optionally add a transform to parse headers early and skip unwanted games.

## File Layout
- `src/lib/lichessStream.ts`: streaming helper and optional filtering utilities.
- `scripts/preview_lichess.ts`: small script to print N games for validation.

## Sample API (helper)
```ts
export type PgnFilter = {
  minElo?: number;
  maxElo?: number;
  timeControlRegex?: RegExp;
};

export async function* streamPgnGamesFromZst(filePath: string, filter?: PgnFilter): AsyncGenerator<string>;
```

## Tasks
- [ ] Create `src/lib/lichessStream.ts` with streaming implementation
- [ ] Implement simple header parsing and filtering (optional initial pass)
- [ ] Add `scripts/preview_lichess.ts` to preview first N games
- [ ] Document usage in README (requirements: `zstd` installed)
- [ ] (Optional) Add API endpoint to fetch a sample game for debugging

## Acceptance Criteria
- Can stream and print first 3 games from the .zst file locally without OOM.
- Filtering by header works (e.g., only standard, rated, time control matches rapid/blitz).
- Helper is safe to use in API routes (handles process close/cleanup).

## Notes
- Ensure `zstd` is installed on the host (e.g., `apt-get install -y zstd`).
- Keep streaming pure and side-effect free; puzzle generation will be handled in a separate task.
