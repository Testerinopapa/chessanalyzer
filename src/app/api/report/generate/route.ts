import { NextRequest, NextResponse } from "next/server";
import { EnginePool } from "@/lib/enginePool";
import { prisma } from "@/lib/db";
import { parseFen, makeFen } from "chessops/fen";
import { setupPosition } from "chessops/variant";
import { parseSan } from "chessops/san";
import type { Move, Role } from "chessops";
import { isNormal } from "chessops";
import { FILE_NAMES, RANK_NAMES } from "chessops";
import { squareFile, squareRank } from "chessops/util";
import { parsePgn, startingPosition } from "chessops/pgn";
import { logger } from "@/lib/logger";


type GenerateRequest = {
  fens: string[];
  sans: string[];
  depth?: number;
  elo?: number | null;
  multiPv?: number;
  debug?: boolean;
  pgn?: string;
  result?: "1-0" | "0-1" | "1/2-1/2";
  startFen?: string;
};

function scoreToCp(s: { type: "cp" | "mate"; value: number } | undefined): number | null {
  if (!s) return null;
  if (s.type === "cp") return s.value;
  return (s.value >= 0 ? 1 : -1) * 10000;
}

function moveToUci(m: Move): string | null {
  if (!isNormal(m)) return null;
  const from = `${FILE_NAMES[squareFile((m as { from: number }).from)]}${RANK_NAMES[squareRank((m as { from: number }).from)]}`;
  const to = `${FILE_NAMES[squareFile((m as { to: number }).to)]}${RANK_NAMES[squareRank((m as { to: number }).to)]}`;
  const promo = (m as { promotion?: Role }).promotion;
  if (promo) {
    const letter = promo === "knight" ? "n" : promo === "bishop" ? "b" : promo === "rook" ? "r" : "q";
    return `${from}${to}${letter}`;
  }
  return `${from}${to}`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as GenerateRequest;
  let fens = Array.isArray(body.fens) ? body.fens : [];
  let sans = Array.isArray(body.sans) ? body.sans : [];
  const depth = body.depth ?? 12;
  const elo = body.elo ?? null;
  const multiPv = Math.max(1, Math.min(10, body.multiPv ?? 3));
  const debug = !!body.debug;
  // If PGN provided, derive fens/sans from it when arrays missing
  if ((!fens.length || !sans.length || fens.length !== sans.length) && typeof body.pgn === 'string' && body.pgn.trim().length > 0) {
    const raw = body.pgn;
    let parsedOk = false;
    try {
      const games = parsePgn(raw);
      if (games.length > 0) {
        const game = games[0];
        const startRes = startingPosition(game.headers);
        if (startRes.isOk) {
          const pos = startRes.unwrap();
          const outSans: string[] = [];
          const outFens: string[] = [];
          for (const node of game.moves.mainline()) {
            const mv = parseSan(pos, node.san);
            if (!mv) break;
            pos.play(mv);
            outSans.push(node.san);
            outFens.push(makeFen(pos.toSetup()));
          }
          if (outSans.length && outSans.length === outFens.length) {
            sans = outSans; fens = outFens; parsedOk = true;
          }
        }
      }
    } catch {}
    // Fallback: naive SAN tokenization if structured PGN parse failed
    if (!parsedOk) {
      try {
        const startPos = body.startFen ? parseFen(body.startFen).unwrap() : defaultPosition("chess");
        // strip headers and results, comments and NAGs
        const cleaned = raw
          .replace(/\{[^}]*\}/g, ' ')  // comments
          .replace(/;.*$/gm, ' ')        // line comments
          .replace(/\(.*?\)/g, ' ')     // variations
          .replace(/\d+\.\.\./g, ' ') // move numbers for black
          .replace(/\d+\./g, ' ')       // move numbers for white
          .replace(/1-0|0-1|1\/2-1\/2|\*/g, ' ') // results
          .replace(/\$\d+/g, ' ')       // NAGs
          .trim();
        const tokens = cleaned.split(/\s+/).filter(Boolean);
        const pos = setupPosition("chess", startPos).unwrap();
        const outSans: string[] = [];
        const outFens: string[] = [];
        for (const san of tokens) {
          const mv = parseSan(pos, san);
          if (!mv) break;
          pos.play(mv);
          outSans.push(san);
          outFens.push(makeFen(pos.toSetup()));
        }
        if (outSans.length && outSans.length === outFens.length) {
          sans = outSans; fens = outFens; parsedOk = true;
        }
      } catch {}
    }
  }

  if (!fens.length || !sans.length) {
    return NextResponse.json({ error: "No moves provided (empty fens/sans and PGN parse failed)" }, { status: 422 });
  }
  if (sans.length !== fens.length) {
    // Be tolerant: trim to the shorter length
    const n = Math.min(sans.length, fens.length);
    fens = fens.slice(0, n);
    sans = sans.slice(0, n);
  }

  const evals: number[] = [];
  const cpls: number[] = [];
  const tags: string[] = [];
  const agreements: boolean[] = [];
  const onlyMoves: boolean[] = [];
  const bestIsMateArr: boolean[] = [];
  const playedIsMateArr: boolean[] = [];
  const bestMateValArr: number[] = [];
  const playedMateValArr: number[] = [];

  const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  for (let i = 0; i < fens.length; i++) {
    const post = await EnginePool.analyze({ fen: fens[i], depth, elo: elo ?? undefined, limitStrength: elo != null, multiPv });
    const postCp = scoreToCp(post.info?.score) ?? 0;
    evals.push(postCp);

    const preFen = i === 0 ? INITIAL_FEN : fens[i-1];

    // Best from pre-move
    const preBest = await EnginePool.analyze({ fen: preFen, depth, elo: elo ?? undefined, limitStrength: elo != null, multiPv });
    const preBestCp = scoreToCp(preBest.info?.score) ?? 0;
    const bestIsMate = preBest.info?.score?.type === "mate";
    const bestMateVal = bestIsMate ? (preBest.info!.score as { type: "mate"; value: number }).value : 0;

    // Derive played UCI from SAN and pre position
    let playedUci: string | null = null;
    try {
      const setupRes = parseFen(preFen);
      if (setupRes.isOk) {
        const posRes = setupPosition("chess", setupRes.unwrap());
        if (posRes.isOk) {
          const pos = posRes.unwrap();
          const mv = parseSan(pos, sans[i]);
          if (mv) playedUci = moveToUci(mv as Move);
        }
      }
    } catch {}

    // Played eval restricted by searchmoves
    let prePlayedCp = preBestCp;
    let playedIsMate = false; let playedMateVal = 0;
    if (playedUci) {
      const prePlayed = await EnginePool.analyze({ fen: preFen, depth, elo: elo ?? undefined, limitStrength: elo != null, searchMoves: [playedUci], multiPv });
      prePlayedCp = scoreToCp(prePlayed.info?.score) ?? preBestCp;
      playedIsMate = prePlayed.info?.score?.type === "mate";
      playedMateVal = playedIsMate ? (prePlayed.info!.score as { type: "mate"; value: number }).value : 0;
    }

    const cpl = Math.max(0, preBestCp - prePlayedCp);
    cpls.push(cpl);
    bestIsMateArr.push(!!bestIsMate);
    playedIsMateArr.push(!!playedIsMate);
    bestMateValArr.push(bestMateVal);
    playedMateValArr.push(playedMateVal);

    // Tag with mate-aware override
    let tag: string;
    if (bestIsMate && !playedIsMate) tag = "Blunder";
    else if (bestIsMate && playedIsMate && Math.abs(playedMateVal) > Math.abs(bestMateVal)) tag = "Blunder";
    else {
      const ad = Math.max(0, cpl);
      if (ad <= 30) tag = "Best";
      else if (ad <= 70) tag = "Excellent";
      else if (ad <= 150) tag = "Good";
      else if (ad <= 300) tag = "Inaccuracy";
      else if (ad <= 600) tag = "Mistake";
      else tag = "Blunder";
    }
    tags.push(tag);

    // Agreement and only-move via MultiPV spread
    try {
      const infos = (preBest.infos ?? []).slice(0, multiPv);
      const bestScore = scoreToCp(infos[0]?.score) ?? 0;
      const near = infos.filter(it => {
        const sc = scoreToCp(it.score) ?? -99999;
        return Math.abs(sc - bestScore) <= 30;
      });
      onlyMoves.push(near.length === 1);
      agreements.push(cpl <= 30);
    } catch {
      onlyMoves.push(false);
      agreements.push(false);
    }

    if (debug) {
      logger.info({ ply: i+1, preBestCp, prePlayedCp, cpl, tag, agreement: agreements[i], onlyMove: onlyMoves[i], playedUci }, "report:debug_move");
    }
  }

  // Accuracy from CPL: 100 - avg(CPL)/8 pawns, clamped 0..100
  let sumCplPawns = 0;
  for (let i = 0; i < cpls.length; i++) sumCplPawns += Math.abs(cpls[i] / 100);
  const avgCpl = cpls.length > 0 ? sumCplPawns / cpls.length : 0;
  const accuracy = Math.max(0, Math.min(100, 100 - (avgCpl / 8) * 100));

  // Determine result from final position, allow override via request
  let resultStr = typeof body.result === 'string' ? body.result : "*";
  try {
    const lastFen = fens[fens.length - 1] ?? INITIAL_FEN;
    const setupRes = parseFen(lastFen);
    if (setupRes.isOk) {
      const posRes = setupPosition("chess", setupRes.unwrap());
      if (posRes.isOk) {
        const pos = posRes.unwrap();
        const ctx = pos.ctx();
        if (pos.isEnd(ctx)) {
          const oc = pos.outcome(ctx);
          if (oc?.winner === "white") resultStr = "1-0";
          else if (oc?.winner === "black") resultStr = "0-1";
          else resultStr = "1/2-1/2";
        }
      }
    }
  } catch {}
  const pgn = `[Result \"${resultStr}\"]\n`;
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

  return NextResponse.json({ id: created.id, perMove: cpls.map((cpl, i) => ({ ply: i+1, cpl, tag: tags[i], agreement: agreements[i] ?? false, onlyMove: onlyMoves[i] ?? false })) });
}


