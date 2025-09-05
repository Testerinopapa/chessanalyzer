import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { puzzleId?: string; timeMs?: number; mistakes?: number; solved?: boolean; rating?: number } | null;
  if (!body || !body.puzzleId) return NextResponse.json({ error: "Missing puzzleId" }, { status: 400 });
  const created = await prisma.puzzleAttempt.create({ data: {
    puzzleId: body.puzzleId,
    timeMs: Math.max(0, Math.floor(body.timeMs ?? 0)),
    mistakes: Math.max(0, Math.floor(body.mistakes ?? 0)),
    solved: !!body.solved,
    rating: body.rating ?? null,
  }});
  return NextResponse.json(created);
}


