import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "20", 10)));
  const motifs = searchParams.get("motif");
  const where = motifs ? { motifs: { contains: motifs } } : {};
  const items = await prisma.puzzle.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json(items);
}



