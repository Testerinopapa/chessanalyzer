import { NextRequest, NextResponse } from "next/server";
import { getBookMoves } from "@/lib/opening";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fen = searchParams.get('fen');
    if (!fen) return NextResponse.json({ error: 'Missing fen' }, { status: 400 });
    const entry = getBookMoves(fen);
    if (!entry) return NextResponse.json({ ok: false });
    return NextResponse.json({ ok: true, ...entry });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}


