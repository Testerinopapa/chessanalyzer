import { streamPgnGamesFromZst, type PgnFilter } from "../src/lib/lichessStream";

function parseArgs(argv: string[]) {
  const out: { file: string; limit: number; filter: PgnFilter } = {
    file: "/root/ChessAnalyzer/chessanalyzer/lichess_db_standard_rated_2025-08.pgn.zst",
    limit: 3,
    filter: {},
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (!a.startsWith("--")) {
      if (!out.file) out.file = a; else out.limit = parseInt(a, 10) || out.limit;
      continue;
    }
    const [k, vRaw] = a.replace(/^--/, "").split("=");
    const v = vRaw ?? "";
    if (k === "file") out.file = v;
    else if (k === "limit") out.limit = parseInt(v, 10) || out.limit;
    else if (k === "rated") out.filter.ratedOnly = v === "false" ? false : true;
    else if (k === "variant") out.filter.variant = v || "Standard";
    else if (k === "minElo") out.filter.minElo = parseInt(v, 10);
    else if (k === "maxElo") out.filter.maxElo = parseInt(v, 10);
    else if (k === "tc") out.filter.timeControlRegex = new RegExp(v);
  }
  return out;
}

async function main() {
  const { file, limit, filter } = parseArgs(process.argv);
  let i = 0;
  for await (const pgn of streamPgnGamesFromZst(file, filter)) {
    console.log(`=== GAME ${++i} ===\n${pgn}\n`);
    if (i >= limit) break;
  }
}

void main();


