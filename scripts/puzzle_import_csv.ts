import { spawn } from "child_process";
import fs from "fs";
import readline from "readline";
import { prisma } from "../src/lib/db";
import { logger } from "../src/lib/logger";

type CsvRow = {
  puzzleId: string;
  fen: string;
  moves: string[]; // UCI moves
  rating: number;
  rd: number;
  popularity: number;
  nbPlays: number;
  themes: string[];
  gameUrl: string;
  openingTags: string;
};

function parseCsvLine(line: string): CsvRow | null {
  // Columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
  const parts = line.split(",");
  if (parts.length < 10) return null;
  const puzzleId = parts[0];
  const fen = parts[1];
  const movesStr = parts[2];
  const rating = parseInt(parts[3] || "0", 10);
  const rd = parseInt(parts[4] || "0", 10);
  const popularity = parseInt(parts[5] || "0", 10);
  const nbPlays = parseInt(parts[6] || "0", 10);
  // The remaining fields (7..end) contain Themes (with commas), GameUrl, OpeningTags.
  const rest = parts.slice(7).join(",");
  const lastComma = rest.lastIndexOf(",");
  if (lastComma < 0) return null;
  const openingTags = rest.slice(lastComma + 1);
  const rest2 = rest.slice(0, lastComma);
  const lastComma2 = rest2.lastIndexOf(",");
  if (lastComma2 < 0) return null;
  const gameUrl = rest2.slice(lastComma2 + 1);
  const themesStr = rest2.slice(0, lastComma2);
  const moves = movesStr.trim().split(/\s+/).filter(Boolean);
  const themes = themesStr.trim().split(/\s*,\s*/).filter(Boolean);
  return { puzzleId, fen, moves, rating, rd, popularity, nbPlays, themes, gameUrl, openingTags };
}

async function main() {
  const file = process.argv[2] || "/root/ChessAnalyzer/chessanalyzer/lichess_db_puzzle.csv.zst";
  const source = process.argv[3] || "lichess-puzzle";
  const limit = parseInt(process.argv[4] || "500", 10);
  const minRating = parseInt(process.argv[5] || "0", 10);
  const maxRating = parseInt(process.argv[6] || "9999", 10);
  const motifFilter = (process.argv[7] || "").trim(); // e.g., "mateIn1" or contains substring
  if (!fs.existsSync(file)) {
    // eslint-disable-next-line no-console
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  logger.info({ file, source, limit, minRating, maxRating, motifFilter }, "puzzle_import:start");
  const proc = spawn("zstd", ["-dc", file], { stdio: ["ignore", "pipe", "inherit"] });
  const rl = readline.createInterface({ input: proc.stdout });
  let imported = 0; let read = 0; let skipped = 0;
  const started = Date.now();
  for await (const lineRaw of rl) {
    const line = String(lineRaw);
    if (!line || line.startsWith("PuzzleId,")) continue; // header
    read++;
    const row = parseCsvLine(line.trim());
    if (!row) { skipped++; continue; }
    if (row.rating < minRating || row.rating > maxRating) { skipped++; continue; }
    if (motifFilter && !row.themes.some(t => t.includes(motifFilter))) { skipped++; continue; }
    try {
      const sideToMove = row.fen.includes(" w ") ? "white" : row.fen.includes(" b ") ? "black" : "white";
      // Deduplicate by (fen + first 3 moves) to avoid exact repeats
      const keyMoves = row.moves.slice(0, 3);
      const existing = await (prisma as any).puzzle.findFirst({ where: { fen: row.fen, solutionPv: JSON.stringify(keyMoves) } });
      if (existing) { skipped++; continue; }
      await (prisma as any).puzzle.create({ data: {
        fen: row.fen,
        sideToMove,
        solutionPv: JSON.stringify(row.moves),
        motifs: JSON.stringify(row.themes),
        source: `${source}:${row.puzzleId}`,
        rating: row.rating,
      }});
      imported++;
    } catch {
      skipped++;
    }
    if (imported >= limit) break;
    if ((read % 1000) === 0 || (imported % 100) === 0) {
      const elapsed = (Date.now() - started) / 1000;
      const rate = read > 0 ? read / elapsed : 0;
      logger.info({ read, imported, skipped, ratePerSec: rate.toFixed(2) }, "puzzle_import:progress");
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ read, imported, skipped, ratePerSec: rate.toFixed(2) }));
    }
  }
  const elapsed = (Date.now() - started) / 1000;
  logger.info({ read, imported, skipped, elapsedSec: elapsed.toFixed(1) }, "puzzle_import:done");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ read, imported, skipped, elapsedSec: elapsed.toFixed(1) }));
}

void main();



