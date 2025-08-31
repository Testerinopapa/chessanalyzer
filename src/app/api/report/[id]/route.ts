import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type Ctx = { params: { id: string } } | { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: Ctx) {
  const paramsOrPromise = context.params;
  let id: string | undefined;
  if (typeof (paramsOrPromise as unknown as Promise<unknown>).then === 'function') {
    const awaited = await (paramsOrPromise as Promise<{ id: string }>);
    id = awaited.id;
  } else {
    id = (paramsOrPromise as { id: string }).id;
  }
  if (!id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  const rpt = await prisma.report.findUnique({ where: { id } });
  if (!rpt) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rpt);
}


