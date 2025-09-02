import { streamPgnGamesFromZst } from "../src/lib/lichessStream";
import { parsePgn, startingPosition } from "chessops/pgn";
import { parseFen, makeFen } from "chessops/fen";
import { setupPosition } from "chessops/variant";
import { parseSan } from "chessops/san";
import type { Move } from "chessops";
import { isNormal } from "chessops";
import { prisma } from "../src/lib/db";
import { EnginePool } from "../src/lib/enginePool";

function scoreToCp(s: { type: "cp" | "mate"; value: number } | undefined): number | null {
  if (!s) return null;
  if (s.type === "cp") return s.value;
  return (s.value >= 0 ? 1 : -1) * 10000;
}

async function analyzeOnlyMove(fen: string, depth = 12): Promise<{ only: boolean; bestmove?: string; pv?: string[] } | null> {
  const res = await EnginePool.analyze({ fen, depth, multiPv: 2 });
  const infos = (res.infos ?? []).slice(0, 2);
  if (infos.length < 2) return { only: true, bestmove: res.bestmove ?? undefined, pv: res.info?.pv };
  const sc0 = scoreToCp(infos[0]?.score) ?? 0;
  const sc1 = scoreToCp(infos[1]?.score) ?? -99999;
  const only = Math.abs(sc0 - sc1) > 30; // small window
  return { only, bestmove: res.bestmove ?? undefined, pv: infos[0]?.pv };
}

async function analyzeMateInN(fen: string, depth = 12): Promise<{ mate: boolean; pv?: string[] } | null> {
  const res = await EnginePool.analyze({ fen, depth, multiPv: 1 });
  if (res.info?.score?.type === "mate") return { mate: true, pv: res.info?.pv };
  return { mate: false };
}

async function main() {
  const file = process.argv[2] || "/root/ChessAnalyzer/chessanalyzer/lichess_db_standard_rated_2025-08.pgn.zst";
  const source = process.argv[3] || "lichess-2025-08";
  const limit = parseInt(process.argv[4] || "50", 10);
  let seen = 0, saved = 0;
  for await (const pgn of streamPgnGamesFromZst(file, { ratedOnly: true })) {
    try {
      const games = parsePgn(pgn);
      if (games.length === 0) continue;
      const game = games[0];
      const startRes = startingPosition(game.headers);
      if (startRes.isErr) continue;
      const pos = startRes.unwrap();
      const sres = setupPosition("chess", pos);
      if (sres.isErr) continue;
      const position = sres.unwrap();
      for (const node of game.moves.mainline()) {
        const mv = parseSan(position, node.san) as unknown as Move | undefined;
        if (!mv || !isNormal(mv)) break;
        // Before playing the move, the side to move is the puzzle side
        const fen = makeFen(position.toSetup());
        // Simple motifs: mate-in-N or only-move
        const mate = await analyzeMateInN(fen, 12);
        if (mate?.mate) {
          await prisma.puzzle.create({ data: {
            fen,
            sideToMove: (position.toSetup().turn as "white"|"black") ?? "white",
            solutionPv: JSON.stringify(mate.pv ?? []),
            motifs: JSON.stringify(["mate"]),
            source,
          }});
          saved++;
          break;
        }
        const only = await analyzeOnlyMove(fen, 12);
        if (only?.only && only.bestmove) {
          await prisma.puzzle.create({ data: {
            fen,
            sideToMove: (position.toSetup().turn as "white"|"black") ?? "white",
            solutionPv: JSON.stringify(only.pv ?? []),
            motifs: JSON.stringify(["only-move"]),
            source,
          }});
          saved++;
          break;
        }
        position.play(mv);
      }
      seen++;
      if (seen >= limit) break;
    } catch {}
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ seen, saved }));
}

void main();


