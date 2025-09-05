import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { EnginePool } from "@/lib/enginePool";
import { parseFen, makeFen } from "chessops/fen";
import { setupPosition } from "chessops/variant";
import { parseUci } from "chessops/util";
import type { Move } from "chessops";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const motif = searchParams.get("motif");
  const difficulty = searchParams.get("difficulty"); // easy|medium|hard
  let minRating = parseInt(searchParams.get("minRating") || "NaN", 10);
  let maxRating = parseInt(searchParams.get("maxRating") || "NaN", 10);
  if (!Number.isFinite(minRating) || !Number.isFinite(maxRating)) {
    if (difficulty === "easy") { minRating = 0; maxRating = 1000; }
    else if (difficulty === "medium") { minRating = 1400; maxRating = 2000; }
    else if (difficulty === "hard") { minRating = 2000; maxRating = 10000; }
    else { minRating = 0; maxRating = 10000; }
  }
  const where: { rating: { gte: number; lte: number }; motifs?: { contains: string } } = { rating: { gte: minRating, lte: maxRating } };
  if (motif) where.motifs = { contains: motif };
  const total = await prisma.puzzle.count({ where });
  if (total === 0) return NextResponse.json(null);

  // Helpers
  const scoreToCp = (s: { type: "cp"|"mate"; value: number } | undefined): number | null => {
    if (!s) return null;
    if (s.type === "cp") return s.value;
    return (s.value >= 0 ? 1 : -1) * 10000;
  };
  const applyUciPlies = (fen: string, moves: string[], count: number): string | null => {
    try {
      const setupRes = parseFen(fen);
      if (setupRes.isErr) return null;
      const posRes = setupPosition("chess", setupRes.unwrap());
      if (posRes.isErr) return null;
      const pos = posRes.unwrap();
      const limit = Math.min(count, moves.length);
      for (let i = 0; i < limit; i++) {
        const mv = parseUci(moves[i]) as Move | undefined;
        if (!mv || !pos.isLegal(mv)) return null;
        pos.play(mv);
      }
      return makeFen(pos.toSetup());
    } catch {
      return null;
    }
  };

  // Try up to N random samples to satisfy policy
  const attempts = Math.min(25, Math.max(5, Math.floor(Math.sqrt(total))));
  for (let i = 0; i < attempts; i++) {
    const skip = Math.floor(Math.random() * total);
    const rows = await prisma.puzzle.findMany({ where, skip, take: 1, orderBy: { createdAt: "desc" } });
    const pz = rows[0]; if (!pz) continue;
    // parse PV
    let pv: string[] = [];
    try { pv = JSON.parse(pz.solutionPv) as string[]; } catch { pv = []; }
    const isMateTheme = (() => {
      try { const ms = JSON.parse(pz.motifs) as string[]; return ms.some(m => m === "mate" || m.startsWith("mateIn")); } catch { return false; }
    })();

    // Determine start side and last mover
    let startTurn: "white"|"black" = "white";
    try { const pr = parseFen(pz.fen); if (pr.isOk) startTurn = pr.unwrap().turn as "white"|"black"; } catch {}
    const lastMover: "white"|"black" = (pv.length % 2 === 1) ? startTurn : (startTurn === "white" ? "black" : "white");

    if (isMateTheme) {
      // Solver is sideToMove; enforce solver is the side that mates
      if (lastMover !== (pz.sideToMove === "black" ? "black" : "white")) continue;
      return NextResponse.json(pz);
    }

    // Non-mate policy: after first two PV plies, solver eval should not drop below -0.5 pawns
    const afterTwo = applyUciPlies(pz.fen, pv, 2);
    if (!afterTwo) continue;
    const res = await EnginePool.analyze({ fen: afterTwo, depth: 8, multiPv: 1 });
    const cp = scoreToCp(res.info?.score);
    if (cp == null) continue;
    // After two plies, it's again solver's turn; cp is from side-to-move perspective
    if (cp >= -50) return NextResponse.json(pz);
  }

  // No valid sample found quickly
  return NextResponse.json(null);
}


