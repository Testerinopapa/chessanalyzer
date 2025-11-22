import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { EnginePool } from "@/lib/enginePool";
import { parseFen, makeFen } from "chessops/fen";
import { setupPosition } from "chessops/variant";
import { parseUci } from "chessops/util";
import type { Move } from "chessops";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const reqId = `puzzle-random-${Date.now()}`;
  const { searchParams } = new URL(req.url);
  const motif = searchParams.get("motif");
  const difficulty = searchParams.get("difficulty"); // easy|medium|hard
  let minRating = parseInt(searchParams.get("minRating") || "NaN", 10);
  let maxRating = parseInt(searchParams.get("maxRating") || "NaN", 10);
  
  // Rating presets - contiguous ranges with no gaps
  const RATING_PRESETS = {
    easy: { min: 0, max: 1400 },
    medium: { min: 1400, max: 2000 },
    hard: { min: 2000, max: 10000 },
  } as const;
  
  if (!Number.isFinite(minRating) || !Number.isFinite(maxRating)) {
    if (difficulty === "easy") { minRating = RATING_PRESETS.easy.min; maxRating = RATING_PRESETS.easy.max; }
    else if (difficulty === "medium") { minRating = RATING_PRESETS.medium.min; maxRating = RATING_PRESETS.medium.max; }
    else if (difficulty === "hard") { minRating = RATING_PRESETS.hard.min; maxRating = RATING_PRESETS.hard.max; }
    else { minRating = 0; maxRating = 10000; }
  }
  
  // Validate rating range
  if (minRating < 0 || maxRating > 10000 || minRating > maxRating) {
    logger.warn({ reqId, minRating, maxRating }, "puzzle:random:invalid_rating_range");
    return NextResponse.json(
      { error: "Invalid rating range", minRating, maxRating },
      { status: 400 }
    );
  }
  
  logger.debug({ reqId, motif, difficulty, minRating, maxRating }, "puzzle:random:params");
  
  // Build base where clause
  let where: { rating: { gte: number; lte: number }; motifs?: { contains: string } } = { rating: { gte: minRating, lte: maxRating } };
  
  if (motif) {
    // Motifs are stored as JSON arrays like ["advantage","endgame","short"]
    // Based on testing, the unquoted pattern works better for SQLite JSON search
    // The unquoted pattern matches the motif as a substring in the JSON string
    where.motifs = { contains: motif };
    logger.debug({ reqId, motif, searchPattern: motif }, "puzzle:random:motif_search");
  }
  
  const total = await prisma.puzzle.count({ where });
  logger.debug({ reqId, total, where }, "puzzle:random:count");
  
  if (total === 0) {
    logger.warn({ reqId, where, motif }, "puzzle:random:no_puzzles");
    return NextResponse.json(null);
  }

  // Helpers
  const scoreToCp = (s: { type: "cp"|"mate"; value: number } | undefined): number | null => {
    if (!s) return null;
    if (s.type === "cp") return s.value;
    return (s.value >= 0 ? 1 : -1) * 10000;
  };
  const applyUciPlies = (fen: string, moves: string[], count: number): string | null => {
    try {
      const setupRes = parseFen(fen);
      if (setupRes.isErr) {
        logger.debug({ reqId, fen, error: setupRes.unwrap() }, "puzzle:random:applyUciPlies:parseFen_failed");
        return null;
      }
      const posRes = setupPosition("chess", setupRes.unwrap());
      if (posRes.isErr) {
        logger.debug({ reqId, fen, error: posRes.unwrap() }, "puzzle:random:applyUciPlies:setupPosition_failed");
        return null;
      }
      const pos = posRes.unwrap();
      const limit = Math.min(count, moves.length);
      for (let i = 0; i < limit; i++) {
        const mv = parseUci(moves[i]) as Move | undefined;
        if (!mv || !pos.isLegal(mv)) {
          logger.debug({ reqId, fen, move: moves[i], index: i, isLegal: pos.isLegal(mv || {} as Move) }, "puzzle:random:applyUciPlies:illegal_move");
          return null;
        }
        pos.play(mv);
      }
      return makeFen(pos.toSetup());
    } catch (err) {
      logger.debug({ reqId, fen, error: err instanceof Error ? err.message : String(err) }, "puzzle:random:applyUciPlies:exception");
      return null;
    }
  };

  // Try up to N random samples to satisfy policy
  // If a specific motif is requested, try more attempts since we're filtering
  const baseAttempts = Math.min(25, Math.max(5, Math.floor(Math.sqrt(total))));
  const attempts = motif ? Math.min(50, baseAttempts * 2) : baseAttempts;
  logger.debug({ reqId, attempts, total, hasMotifFilter: !!motif }, "puzzle:random:starting_selection");
  for (let i = 0; i < attempts; i++) {
    const skip = Math.floor(Math.random() * total);
    const rows = await prisma.puzzle.findMany({ where, skip, take: 1, orderBy: { createdAt: "desc" } });
    const pz = rows[0];
    if (!pz) {
      logger.debug({ reqId, attempt: i + 1, skip }, "puzzle:random:no_puzzle_at_skip");
      continue;
    }
    logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id, fen: pz.fen, rating: pz.rating }, "puzzle:random:testing_puzzle");
    
    // parse PV
    let pv: string[] = [];
    try { 
      pv = JSON.parse(pz.solutionPv) as string[]; 
    } catch (err) {
      logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id, error: err instanceof Error ? err.message : String(err), solutionPv: pz.solutionPv }, "puzzle:random:parse_pv_failed");
      pv = [];
    }
    if (pv.length === 0) {
      logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id }, "puzzle:random:empty_pv");
      continue;
    }
    
    const isMateTheme = (() => {
      try { 
        const ms = JSON.parse(pz.motifs) as string[]; 
        const hasMate = ms.some(m => m === "mate" || m.startsWith("mateIn"));
        logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id, motifs: ms, isMateTheme: hasMate }, "puzzle:random:mate_check");
        return hasMate;
      } catch (err) {
        logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id, error: err instanceof Error ? err.message : String(err) }, "puzzle:random:parse_motifs_failed");
        return false;
      }
    })();

    // Determine start side and last mover
    let startTurn: "white"|"black" = "white";
    try { 
      const pr = parseFen(pz.fen); 
      if (pr.isOk) startTurn = pr.unwrap().turn as "white"|"black";
    } catch (err) {
      logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id, fen: pz.fen, error: err instanceof Error ? err.message : String(err) }, "puzzle:random:parse_fen_failed");
    }
    const lastMover: "white"|"black" = (pv.length % 2 === 1) ? startTurn : (startTurn === "white" ? "black" : "white");
    logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id, startTurn, lastMover, pvLength: pv.length, sideToMove: pz.sideToMove }, "puzzle:random:turn_analysis");

    if (isMateTheme) {
      // Solver is sideToMove; enforce solver is the side that mates
      const expectedSolver = pz.sideToMove === "black" ? "black" : "white";
      if (lastMover !== expectedSolver) {
        logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id, lastMover, expectedSolver }, "puzzle:random:mate_side_mismatch");
        continue;
      }
      logger.info({ reqId, attempt: i + 1, puzzleId: pz.id }, "puzzle:random:mate_puzzle_selected");
      return NextResponse.json(pz);
    }

    // Non-mate policy: after first two PV plies, solver eval should not drop below -0.5 pawns
    // If we have a motif filter and we're running out of attempts, be more lenient
    const afterTwo = applyUciPlies(pz.fen, pv, 2);
    if (!afterTwo) {
      logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id }, "puzzle:random:apply_two_plies_failed");
      continue;
    }
    logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id, afterTwoFen: afterTwo }, "puzzle:random:analyzing_position");
    try {
      const res = await EnginePool.analyze({ fen: afterTwo, depth: 8, multiPv: 1 });
      const cp = scoreToCp(res.info?.score);
      logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id, cp, score: res.info?.score }, "puzzle:random:engine_eval");
      if (cp == null) {
        logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id }, "puzzle:random:no_eval");
        continue;
      }
      // After two plies, it's again solver's turn; cp is from side-to-move perspective
      // If we have a motif filter and are near the end of attempts, be more lenient (allow up to -100cp)
      const threshold = (motif && i >= attempts * 0.7) ? -100 : -50;
      if (cp >= threshold) {
        logger.info({ reqId, attempt: i + 1, puzzleId: pz.id, cp, threshold }, "puzzle:random:non_mate_puzzle_selected");
        return NextResponse.json(pz);
      } else {
        logger.debug({ reqId, attempt: i + 1, puzzleId: pz.id, cp, threshold }, "puzzle:random:eval_too_low");
      }
    } catch (err) {
      logger.warn({ reqId, attempt: i + 1, puzzleId: pz.id, error: err instanceof Error ? err.message : String(err) }, "puzzle:random:engine_analysis_failed");
      // If engine fails and we have a motif filter, still try to return the puzzle if it's valid
      if (motif && i >= attempts * 0.8) {
        logger.info({ reqId, attempt: i + 1, puzzleId: pz.id }, "puzzle:random:returning_puzzle_despite_engine_failure");
        return NextResponse.json(pz);
      }
      continue;
    }
  }

  // No valid sample found after quality checks
  // If we have a motif filter, try one more time with a random puzzle (no quality checks)
  if (motif && total > 0) {
    logger.debug({ reqId, motif }, "puzzle:random:fallback_to_any_puzzle_with_motif");
    const skip = Math.floor(Math.random() * total);
    const rows = await prisma.puzzle.findMany({ where, skip, take: 1, orderBy: { createdAt: "desc" } });
    const pz = rows[0];
    if (pz) {
      // Verify it has a valid PV
      try {
        const pv = JSON.parse(pz.solutionPv) as string[];
        if (pv.length > 0) {
          logger.info({ reqId, puzzleId: pz.id, motif }, "puzzle:random:returning_puzzle_without_quality_check");
          return NextResponse.json(pz);
        }
      } catch {
        // Invalid PV, continue to return null
      }
    }
  }
  
  logger.warn({ reqId, attempts, total, motif }, "puzzle:random:no_valid_puzzle_found");
  return NextResponse.json(null);
}


