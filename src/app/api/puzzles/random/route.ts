import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const motif = searchParams.get("motif");
  const where = motif ? { motifs: { contains: motif } } : {};
  const total = await prisma.puzzle.count({ where });
  if (total === 0) return NextResponse.json(null); // return 200 with no content instead of 404
  const skip = Math.floor(Math.random() * total);
  const rows = await prisma.puzzle.findMany({ where, skip, take: 1, orderBy: { createdAt: "desc" } });
  return NextResponse.json(rows[0] ?? null);
}


