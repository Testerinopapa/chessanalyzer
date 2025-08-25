import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import { logger } from "@/lib/logger";
import { EnginePool } from "@/lib/enginePool";

function isExecutable(p: string): boolean {
	try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}

function findStockfish(): string {
	const envPath = process.env.STOCKFISH_PATH;
	if (envPath && isExecutable(envPath)) return envPath;
	const candidates = ["/usr/bin/stockfish", "/usr/local/bin/stockfish", "/usr/games/stockfish"];
	for (const c of candidates) if (fs.existsSync(c) && isExecutable(c)) return c;
	return "stockfish";
}

export async function GET() {
	const reqId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
	const bin = findStockfish();
	try {
		const engine = spawn(bin);
		let uciok = false, readyok = false;
		const timeoutMs = 8000;
		const done = new Promise<boolean>((resolve) => {
			const t = setTimeout(() => resolve(false), timeoutMs);
			engine.stdout.on("data", (chunk: Buffer) => {
				const text = chunk.toString("utf8");
				for (const line of text.split(/\r?\n/)) {
					if (line === "uciok") uciok = true;
					if (line === "readyok") readyok = true;
					if (uciok && readyok) { clearTimeout(t); return resolve(true); }
				}
			});
		});
		engine.stdin.write("uci\n");
		// send isready after uciok seen
		engine.stdout.once("data", () => { try { engine.stdin.write("isready\n"); } catch {} });
		const ok = await done.finally(() => { try { engine.stdin.write("quit\n"); } catch {} });
		const pool = EnginePool.getHealth?.() ?? EnginePool.getHealth?.call(EnginePool);
		if (!ok) return NextResponse.json({ ok: false, reqId, error: "not_ready", pool }, { status: 503 });
		return NextResponse.json({ ok: true, reqId, pool });
	} catch (err) {
		logger.error({ reqId, err: String(err) }, "engine:health_error");
		const pool = EnginePool.getHealth?.() ?? EnginePool.getHealth?.call(EnginePool);
		return NextResponse.json({ ok: false, reqId, error: "spawn_error", pool }, { status: 503 });
	}
}


