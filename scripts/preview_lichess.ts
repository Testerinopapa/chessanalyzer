import { streamPgnGamesFromZst } from "@/lib/lichessStream";

async function main() {
  const file = process.argv[2] || "/root/ChessAnalyzer/chessanalyzer/lichess_db_standard_rated_2025-08.pgn.zst";
  const limit = parseInt(process.argv[3] || "3", 10);
  let i = 0;
  for await (const pgn of streamPgnGamesFromZst(file)) {
    console.log(`=== GAME ${++i} ===\n${pgn}\n`);
    if (i >= limit) break;
  }
}

void main();


