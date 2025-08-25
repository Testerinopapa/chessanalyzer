import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { EnginePool } from "@/lib/enginePool";

type AnalyzeRequest = {
	fen: string;
	depth?: number;
	elo?: number;
	limitStrength?: boolean;
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
	if (!fen || typeof fen !== "string") {
		return NextResponse.json({ error: "Missing fen" }, { status: 400 });
	}
	if (fen === "startpos") {
		fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
	}

	const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	logger.info({ reqId, fen, depth, elo, limitStrength }, "analysis:pool_start");
	try {
		const result = await EnginePool.analyze({ fen, depth, elo, limitStrength });
		return NextResponse.json(result);
	} catch (e) {
		logger.error({ reqId, err: String(e) }, "analysis:pool_error");
		return NextResponse.json({ error: "Engine unavailable" }, { status: 503 });
	}
}


