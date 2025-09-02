import { streamPgnGamesFromZst } from "../src/lib/lichessStream";
import { parsePgn, startingPosition } from "chessops/pgn";
import { parseFen, makeFen } from "chessops/fen";
import { setupPosition } from "chessops/variant";
import { parseSan } from "chessops/san";
import type { Move } from "chessops";
import { isNormal } from "chessops";
import { parseUci } from "chessops/util";
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

function materialScoreFromFen(fen: string): number {
  // Compute simple material (p=1,n=3,b=3,r=5,q=9) using board part of fen
  const board = fen.split(" ")[0];
  const values: Record<string, number> = { p:1, n:3, b:3, r:5, q:9 };
  let score = 0;
  for (const ch of board) {
    if (/[PNBRQ]/.test(ch)) score += values[ch.toLowerCase()] ?? 0;
    else if (/[pnbrq]/.test(ch)) score -= values[ch] ?? (values[ch.toLowerCase()] ?? 0);
  }
  return score * 100; // centipawns
}

async function analyzeBestAt(fen: string, depth = 12, multiPv = 1) {
  return EnginePool.analyze({ fen, depth, multiPv });
}

function applyUciPliesAndMaterialDelta(fen: string, pv: string[] | undefined, plies = 2): number {
  if (!pv || pv.length === 0) return 0;
  try {
    const setupRes = parseFen(fen);
    if (setupRes.isErr) return 0;
    const posRes = setupPosition("chess", setupRes.unwrap());
    if (posRes.isErr) return 0;
    const pos = posRes.unwrap();
    const startMat = materialScoreFromFen(fen);
    const limit = Math.min(plies, pv.length);
    for (let i = 0; i < limit; i++) {
      const mv = parseUci(pv[i]) as Move | undefined;
      if (!mv || !pos.isLegal(mv)) break;
      pos.play(mv);
    }
    const endFen = makeFen(pos.toSetup());
    const endMat = materialScoreFromFen(endFen);
    return endMat - startMat; // positive = winning material for side to move
  } catch {
    return 0;
  }
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
      const setup = startRes.unwrap();
      const sres = setupPosition("chess", setup as any);
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
          await (prisma as any).puzzle.create({ data: {
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
          const matGain = applyUciPliesAndMaterialDelta(fen, only.pv, 2);
          const motifs: string[] = ["only-move"]; if (matGain >= 200) motifs.push("win-material");
          await (prisma as any).puzzle.create({ data: {
            fen,
            sideToMove: (position.toSetup().turn as "white"|"black") ?? "white",
            solutionPv: JSON.stringify(only.pv ?? []),
            motifs: JSON.stringify(motifs),
            source,
          }});
          saved++;
          break;
        }
        // Blunder-refutation: look ahead one ply and check eval swing
        const preBest = await analyzeBestAt(fen, 10);
        const preCp = scoreToCp(preBest.info?.score) ?? 0;
        position.play(mv);
        const afterFen = makeFen(position.toSetup());
        const postBest = await analyzeBestAt(afterFen, 10);
        const postCp = scoreToCp(postBest.info?.score) ?? 0;
        const swing = postCp - preCp; // from side-to-move perspective (white positive)
        if (swing <= -300) {
          // The played move worsened eval by >= 3 pawns; refutation is bestmove at pre position
          const refPv = preBest.info?.pv ?? [];
          const matGain = applyUciPliesAndMaterialDelta(fen, refPv, 2);
          const motifs: string[] = ["blunder-refutation"]; if (matGain >= 200) motifs.push("win-material");
          await (prisma as any).puzzle.create({ data: {
            fen,
            sideToMove: (fen.includes(" w ") ? "white" : "black"),
            solutionPv: JSON.stringify(refPv),
            motifs: JSON.stringify(motifs),
            source,
          }});
          saved++;
          break;
        }
      }
      seen++;
      if (seen >= limit) break;
    } catch {}
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ seen, saved }));
}

void main();


