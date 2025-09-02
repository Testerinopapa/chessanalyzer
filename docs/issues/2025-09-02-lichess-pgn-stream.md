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

## Lichess PGN dump structure (what we can leverage)
- File format: `.pgn.zst` – plain PGN compressed with Zstandard; no container beyond zstd.
- Game separation: each game is a PGN block with headers in square brackets, followed by movetext, and separated by one or more blank lines.
- Common headers available per game:
  - `[Event]`, `[Site]`, `[Date]`, `[Round]`, `[White]`, `[Black]`, `[Result]`
  - Rating fields: `[WhiteElo]`, `[BlackElo]` (may be `?` if unknown)
  - Time control: `[TimeControl]` (e.g., `600+0` for 10+0, `180+2` for 3+2, `-` for undefined)
  - Variant and format: `[Variant]` (usually `Standard`), `[UTCDate]`, `[UTCTime]`
  - Termination/reason: `[Termination]` (e.g., `Time forfeit`, `Normal`, `Abandoned`)
  - ECO and openings (when present): `[ECO]`, `[Opening]`, `[Variation]`
  - Speed classification sometimes appears in `[Event]` or tags like `[Mode]`/`[Event]` (`Rated Blitz game`)
- Movetext: standard SAN with comments/NAGs occasionally; result token at end (`1-0`, `0-1`, `1/2-1/2`).

### Implications for streaming/filters
- We can cheaply filter by:
  - Variant == `Standard`
  - Rated vs casual via `[Event]` or presence of `Rated` in event value
  - Elo ranges using `[WhiteElo]`/`[BlackElo]` numeric parsing
  - Time control buckets using `[TimeControl]` seconds and increment
  - Termination reason to prefer clean games (exclude `Abandoned`)
- We should tolerate missing/`?` tags and skip when filters can’t be evaluated.
- Because it’s line-oriented, we can parse headers before collecting full movetext to decide early skipping.

### What we cannot assume
- Not all games have full opening tags or clean headers; header order may vary.
- Some dumps may include comments/annotations; avoid assuming single-line headers only, but they generally are single lines.
- No index; random access is expensive. Streaming is sequential; maintain counters for sampling.
