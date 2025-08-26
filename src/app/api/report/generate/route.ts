import { NextRequest, NextResponse } from "next/server";
import { EnginePool } from "@/lib/enginePool";
import { prisma } from "@/lib/db";

type GenerateRequest = {
  fens: string[];
  sans: string[];
  depth?: number;
  elo?: number | null;
};

function scoreToCp(s: { type: "cp" | "mate"; value: number } | undefined): number | null {
  if (!s) return null;
  if (s.type === "cp") return s.value;
  return (s.value >= 0 ? 1 : -1) * 10000;
}

function tagFromDelta(prevCp: number, nextCp: number): string {
  const delta = nextCp - prevCp;
  const ad = Math.abs(delta);
  if (ad >= 300) return delta < 0 ? "Blunder" : "Missed Win";
  if (ad >= 150) return delta < 0 ? "Mistake" : "Good Find";
  if (ad >= 50) return delta < 0 ? "Inaccuracy" : "Improvement";
  return "";
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as GenerateRequest;
  const fens = Array.isArray(body.fens) ? body.fens : [];
  const sans = Array.isArray(body.sans) ? body.sans : [];
  const depth = body.depth ?? 12;
  const elo = body.elo ?? null;
  if (!fens.length || sans.length !== fens.length) {
    return NextResponse.json({ error: "Invalid fens/sans" }, { status: 400 });
  }

  const evals: number[] = [];
  for (let i = 0; i < fens.length; i++) {
    const r = await EnginePool.analyze({ fen: fens[i], depth, elo: elo ?? undefined, limitStrength: elo != null });
    const cp = scoreToCp(r.info?.score) ?? 0;
    evals.push(cp);
  }

  const tags: string[] = [];
  for (let i = 0; i < evals.length; i++) {
    if (i === 0) { tags.push(""); continue; }
    tags.push(tagFromDelta(evals[i-1], evals[i]));
  }

  // naive accuracy: 100 - avg(|delta|)/8 (in pawns), clamped 0..100
  let sumAbs = 0;
  for (let i = 1; i < evals.length; i++) sumAbs += Math.abs((evals[i] - evals[i-1]) / 100);
  const avg = evals.length > 1 ? sumAbs / (evals.length - 1) : 0;
  const accuracy = Math.max(0, Math.min(100, 100 - (avg / 8) * 100));

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


