import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { EnginePool } from "@/lib/enginePool";
import { parseFen, makeFen } from "chessops/fen";
import { setupPosition } from "chessops/variant";
import { parseSan } from "chessops/san";
import type { Move, Role } from "chessops";
import { isNormal } from "chessops";
import { FILE_NAMES, RANK_NAMES } from "chessops";
import { squareFile, squareRank } from "chessops/util";

type Phase = 'opening' | 'middlegame' | 'endgame';
type PerMove = { ply: number; cpl: number; tag: string; agreement: boolean; onlyMove: boolean; bestPv?: string[]; playedPv?: string[]; phase: Phase; symbol?: string; note?: string };

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

export async function GET() {
  const latest = await prisma.report.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!latest) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let fens: string[] = [];
  let sans: string[] = [];
  try { fens = JSON.parse(latest.fens) as string[]; } catch {}
  try { sans = JSON.parse(latest.sans) as string[]; } catch {}
  if (!fens.length || !sans.length || fens.length !== sans.length) {
    return NextResponse.json({ error: 'Invalid stored report data' }, { status: 400 });
  }
  const depth = latest.depth ?? 12;
  const elo = latest.elo ?? null;
  const multiPv = 2;
  const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  const perMove: PerMove[] = [];
  for (let i = 0; i < fens.length; i++) {
    const preFen = i === 0 ? INITIAL_FEN : fens[i-1];
    const preBest = await EnginePool.analyze({ fen: preFen, depth, elo: elo ?? undefined, limitStrength: elo != null, multiPv });
    const preBestCp = scoreToCp(preBest.info?.score) ?? 0;
    const bestIsMate = preBest.info?.score?.type === "mate";
    const bestMateVal = bestIsMate ? (preBest.info!.score as { type: "mate"; value: number }).value : 0;

    // SAN -> played UCI from pre position
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

    // Fallback: derive played UCI by matching next FEN when SAN parsing fails
    if (!playedUci) {
      const nextFen = fens[i];
      try {
        const setupPre = parseFen(preFen);
        if (setupPre.isOk) {
          // Try all from/to squares and promotions to find a legal move that yields nextFen
          const preSetup = setupPre.unwrap();
          const tryMove = (from: number, to: number, promotion?: Role): string | null => {
            const mv = promotion ? ({ from, to, promotion } as unknown as Move) : ({ from, to } as unknown as Move);
            const posRes = setupPosition("chess", preSetup);
            if (posRes.isErr) return null;
            const pos = posRes.unwrap();
            if (!pos.isLegal(mv)) return null;
            pos.play(mv);
            const f = makeFen(pos.toSetup());
            if (f === nextFen) return moveToUci(mv);
            return null;
          };
          outer: for (let from = 0; from < 64 && !playedUci; from++) {
            for (let to = 0; to < 64 && !playedUci; to++) {
              // Try non-promo first
              playedUci = tryMove(from, to) || null;
              if (playedUci) break outer;
              // Try promotions
              const promos: Role[] = ['queen','rook','bishop','knight'];
              for (const pr of promos) {
                playedUci = tryMove(from, to, pr) || null;
                if (playedUci) break outer;
              }
            }
          }
        }
      } catch {}
    }

    let prePlayedCp = preBestCp;
    let playedIsMate = false; let playedMateVal = 0;
    let playedPv: string[] | undefined;
    if (playedUci) {
      const prePlayed = await EnginePool.analyze({ fen: preFen, depth, elo: elo ?? undefined, limitStrength: elo != null, searchMoves: [playedUci], multiPv });
      prePlayedCp = scoreToCp(prePlayed.info?.score) ?? preBestCp;
      playedIsMate = prePlayed.info?.score?.type === "mate";
      playedMateVal = playedIsMate ? (prePlayed.info!.score as { type: "mate"; value: number }).value : 0;
      if (Array.isArray(prePlayed.info?.pv)) playedPv = prePlayed.info!.pv;
    }

    const cpl = Math.max(0, preBestCp - prePlayedCp);
    // Mate-aware tag
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

    // Agreement/only-move via MultiPV spread
    let agreement = false; let onlyMove = false;
    try {
      const infos = (preBest.infos ?? []).slice(0, multiPv);
      const bestScore = scoreToCp(infos[0]?.score) ?? 0;
      const near = infos.filter(it => {
        const sc = scoreToCp(it.score) ?? -99999;
        return Math.abs(sc - bestScore) <= 30;
      });
      onlyMove = near.length === 1;
      agreement = cpl <= 30;
    } catch {}

    const moveNumber = Math.floor(i / 2) + 1;
    const phase: Phase = moveNumber <= 12 ? 'opening' : moveNumber <= 40 ? 'middlegame' : 'endgame';
    const bestPv = Array.isArray(preBest.info?.pv) ? preBest.info!.pv : undefined;
    // Symbol mapping
    let symbol: string | undefined; let note: string | undefined;
    if (bestIsMate && !playedIsMate) { symbol = '??'; note = 'missed mate'; }
    else if (tag === 'Blunder') symbol = '??';
    else if (tag === 'Mistake') symbol = '?';
    else if (tag === 'Inaccuracy') symbol = '?!';
    else if (tag === 'Excellent') symbol = '!!';
    else if (tag === 'Best' || tag === 'Good') symbol = cpl <= 30 && agreement ? '!!' : '!';
    if (onlyMove) note = note ? `${note}; only move` : 'only move';

    perMove.push({ ply: i+1, cpl, tag, agreement, onlyMove, bestPv, playedPv, phase, symbol, note });
  }

  // Aggregates per side
  const whiteCpls: number[] = [], blackCpls: number[] = [];
  const tagCounts: Record<string, number> = {};
  const phaseAgg: Record<Phase, { whiteCpls: number[]; blackCpls: number[]; tagCounts: Record<string, number> }> = {
    opening: { whiteCpls: [], blackCpls: [], tagCounts: {} },
    middlegame: { whiteCpls: [], blackCpls: [], tagCounts: {} },
    endgame: { whiteCpls: [], blackCpls: [], tagCounts: {} },
  };
  for (const pm of perMove) {
    if (pm.ply % 2 === 1) whiteCpls.push(pm.cpl); else blackCpls.push(pm.cpl);
    tagCounts[pm.tag] = (tagCounts[pm.tag] || 0) + 1;
    const bucket = phaseAgg[pm.phase];
    if (pm.ply % 2 === 1) bucket.whiteCpls.push(pm.cpl); else bucket.blackCpls.push(pm.cpl);
    bucket.tagCounts[pm.tag] = (bucket.tagCounts[pm.tag] || 0) + 1;
  }
  const avg = (arr: number[]) => arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : 0;
  const acplWhite = avg(whiteCpls);
  const acplBlack = avg(blackCpls);
  const accuracyFromCpl = (arr: number[]) => {
    const avgPawns = arr.length ? arr.reduce((a,b)=>a+Math.abs(b/100),0) / arr.length : 0;
    return Math.max(0, Math.min(100, 100 - (avgPawns/8)*100));
  };
  const accuracyWhite = accuracyFromCpl(whiteCpls);
  const accuracyBlack = accuracyFromCpl(blackCpls);

  const perPhase = (ph: Phase) => {
    const p = phaseAgg[ph];
    return {
      acplWhite: avg(p.whiteCpls),
      acplBlack: avg(p.blackCpls),
      accuracyWhite: accuracyFromCpl(p.whiteCpls),
      accuracyBlack: accuracyFromCpl(p.blackCpls),
      tagCounts: p.tagCounts,
    };
  };

  return NextResponse.json({ id: latest.id, perMove, aggregates: { acplWhite, acplBlack, accuracyWhite, accuracyBlack, tagCounts, phases: { opening: perPhase('opening'), middlegame: perPhase('middlegame'), endgame: perPhase('endgame') } } });
}


