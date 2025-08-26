import { NextRequest, NextResponse } from "next/server";
import { EnginePool } from "@/lib/enginePool";
import { prisma } from "@/lib/db";
import { parseFen } from "chessops/fen";
import { setupPosition } from "chessops/variant";
import { parseSan } from "chessops/san";
import type { Move, Role } from "chessops";
import { isNormal } from "chessops";
import { FILE_NAMES, RANK_NAMES } from "chessops";
import { squareFile, squareRank } from "chessops/util";
import { logger } from "@/lib/logger";

type GenerateRequest = {
  fens: string[];
  sans: string[];
  depth?: number;
  elo?: number | null;
  debug?: boolean;
};

function scoreToCp(s: { type: "cp" | "mate"; value: number } | undefined): number | null {
  if (!s) return null;
  if (s.type === "cp") return s.value;
  return (s.value >= 0 ? 1 : -1) * 10000;
}

function tagFromCpl(cpl: number): string {
  const ad = Math.max(0, cpl);
  if (ad <= 30) return "Best";
  if (ad <= 70) return "Excellent";
  if (ad <= 150) return "Good";
  if (ad <= 300) return "Inaccuracy";
  if (ad <= 600) return "Mistake";
  return "Blunder";
}

function moveToUci(m: Move): string | null {
  if (!isNormal(m)) return null;
  const from = `${FILE_NAMES[squareFile(m.from)]}${RANK_NAMES[squareRank(m.from)]}`;
  const to = `${FILE_NAMES[squareFile(m.to)]}${RANK_NAMES[squareRank(m.to)]}`;
  const promo = (m as { promotion?: Role }).promotion;
  if (promo) {
    const letter = promo === "knight" ? "n" : promo === "bishop" ? "b" : promo === "rook" ? "r" : "q";
    return `${from}${to}${letter}`;
  }
  return `${from}${to}`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as GenerateRequest;
  const fens = Array.isArray(body.fens) ? body.fens : [];
  const sans = Array.isArray(body.sans) ? body.sans : [];
  const depth = body.depth ?? 12;
  const elo = body.elo ?? null;
  const debug = !!body.debug;
  if (!fens.length || sans.length !== fens.length) {
    return NextResponse.json({ error: "Invalid fens/sans" }, { status: 400 });
  }

  const evals: number[] = [];
  const cpls: number[] = [];
  const bestIsMateArr: boolean[] = [];
  const playedIsMateArr: boolean[] = [];
  const bestMateValArr: number[] = [];
  const playedMateValArr: number[] = [];
  const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  for (let i = 0; i < fens.length; i++) {
    // Post-move (played) eval for graphing
    const post = await EnginePool.analyze({ fen: fens[i], depth, elo: elo ?? undefined, limitStrength: elo != null });
    const postCp = scoreToCp(post.info?.score) ?? 0;
    evals.push(postCp);

    // Pre-move position
    const preFen = i === 0 ? INITIAL_FEN : fens[i-1];

    // Derive played move UCI from SAN and pre position
    let playedUci: string | null = null;
    try {
      const setupRes = parseFen(preFen);
      if (setupRes.isOk) {
        const posRes = setupPosition("chess", setupRes.unwrap());
        if (posRes.isOk) {
          const pos = posRes.unwrap();
          const mv = parseSan(pos, sans[i]);
          if (mv) {
            playedUci = moveToUci(mv as Move);
          }
        }
      }
    } catch {}

    // Best eval from pre-move position (side to move)
    const preBest = await EnginePool.analyze({ fen: preFen, depth, elo: elo ?? undefined, limitStrength: elo != null });
    const preBestCp = scoreToCp(preBest.info?.score) ?? 0;
    const bestIsMate = preBest.info?.score?.type === "mate";
    const bestMateVal = bestIsMate ? (preBest.info!.score as { type: "mate"; value: number }).value : 0;

    // Played eval from pre-move position restricted to the played move
    let prePlayedCp = preBestCp; // fallback
    let playedIsMate = false; let playedMateVal = 0;
    if (playedUci) {
      const prePlayed = await EnginePool.analyze({ fen: preFen, depth, elo: elo ?? undefined, limitStrength: elo != null, searchMoves: [playedUci] });
      prePlayedCp = scoreToCp(prePlayed.info?.score) ?? preBestCp;
      playedIsMate = prePlayed.info?.score?.type === "mate";
      playedMateVal = playedIsMate ? (prePlayed.info!.score as { type: "mate"; value: number }).value : 0;
    }

    // Side-aware centipawn loss (CPL)
    const cpl = Math.max(0, preBestCp - prePlayedCp);
    cpls.push(cpl);
    bestIsMateArr.push(!!bestIsMate);
    playedIsMateArr.push(!!playedIsMate);
    bestMateValArr.push(bestMateVal);
    playedMateValArr.push(playedMateVal);
    if (debug) {
      logger.info({
        ply: i+1,
        san: sans[i],
        preFen,
        playedUci,
        preBest: preBest.info?.score,
        prePlayed: playedUci ? prePlayedCp : null,
        preBestCp,
        prePlayedCp,
        cpl,
        bestIsMate,
        bestMateVal,
        playedIsMate,
        playedMateVal,
        postCp,
      }, "report:generate_cpl_debug");
    }
  }

  const tags: string[] = [];
  for (let i = 0; i < cpls.length; i++) {
    // Mate-aware: if best had mate and played doesn't, or increases mate distance, mark Blunder
    if (bestIsMateArr[i]) {
      if (!playedIsMateArr[i]) { tags.push("Blunder"); continue; }
      // If both mate: if best is mate in N and played is mate in M with |M| > |N|, it's worse
      if (Math.abs(playedMateValArr[i]) > Math.abs(bestMateValArr[i])) { tags.push("Blunder"); continue; }
    }
    tags.push(tagFromCpl(cpls[i]));
  }

  // Accuracy from CPL: 100 - avg(CPL)/8 pawns, clamped 0..100
  let sumCplPawns = 0;
  for (let i = 0; i < cpls.length; i++) sumCplPawns += Math.abs(cpls[i] / 100);
  const avgCpl = cpls.length > 0 ? sumCplPawns / cpls.length : 0;
  const accuracy = Math.max(0, Math.min(100, 100 - (avgCpl / 8) * 100));

  const pgn = "[Result \"*\"]\n"; // placeholder; future: reconstruct full PGN
  const created = await prisma.report.create({ data: {
    pgn,
    depth,
    elo: elo ?? undefined,
    fens: JSON.stringify(fens),
    sans: JSON.stringify(sans),
    evals: JSON.stringify(evals),
    tags: JSON.stringify(tags),
    accuracy,
  }});

  return NextResponse.json({ id: created.id });
}


