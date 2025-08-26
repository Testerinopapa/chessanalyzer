import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const latest = await prisma.report.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!latest) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(latest);
}


