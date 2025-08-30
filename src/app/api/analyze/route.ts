import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { EnginePool } from "@/lib/enginePool";
import { getBookMoves } from "@/lib/opening";


type AnalyzeRequest = {
	fen: string;
	depth?: number;
	elo?: number;
	limitStrength?: boolean;
	multiPv?: number;
};

export async function POST(req: NextRequest) {
	let body: AnalyzeRequest | undefined;
	try {
		body = (await req.json()) as AnalyzeRequest;
	} catch {
		body = undefined;
	}
	let fen = body?.fen;
	const depth = body?.depth ?? 12;
	const elo = typeof body?.elo === "number" ? Math.max(1350, Math.min(2850, Math.floor(body!.elo))) : undefined;
	const limitStrength = body?.limitStrength ?? (elo !== undefined);
	const multiPv = Math.max(1, Math.min(10, body?.multiPv ?? 1));
	if (!fen || typeof fen !== "string") {
		return NextResponse.json({ error: "Missing fen" }, { status: 400 });
	}
	if (fen === "startpos") {
		fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
	}

	const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	logger.info({ reqId, fen, depth, elo, limitStrength, multiPv }, "analysis:pool_start");
	try {
		// Opening book (if available)
		try {
			const entry = getBookMoves(fen);
			if (entry) {
				const top = [...entry.moves].sort((a,b)=>b.weight-a.weight)[0];
				return NextResponse.json({
					bestmove: top?.uci ?? null,
					info: { depth: 0, multipv: 1, score: { type: 'cp', value: 0 }, pv: entry.moves.map(m=>m.uci) },
					book: { eco: entry.eco, name: entry.name, moves: entry.moves }
				});
			}
		} catch {}
		const result = await EnginePool.analyze({ fen, depth, elo, limitStrength, multiPv });
		return NextResponse.json(result);
	} catch (e) {
		logger.error({ reqId, err: String(e) }, "analysis:pool_error");
		return NextResponse.json({ error: "Engine unavailable" }, { status: 503 });
	}
}


