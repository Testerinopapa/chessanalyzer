import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import { logger } from "@/lib/logger";

type AnalyzeRequest = {
	fen: string;
	depth?: number;
	elo?: number;
	limitStrength?: boolean;
};

type EngineInfo = {
	depth?: number;
	seldepth?: number;
	multipv?: number;
	score?: { type: "cp" | "mate"; value: number };
	nodes?: number;
	nps?: number;
	timeMs?: number;
	pv?: string[];
};

function parseInfoLine(line: string): EngineInfo | null {
	// Example: info depth 12 seldepth 18 multipv 1 score cp 23 nodes 12345 nps 100000 time 120 pv e2e4 e7e5 g1f3
	if (!line.startsWith("info ")) return null;
	const parts = line.trim().split(/\s+/);
	const info: EngineInfo = {};
	for (let i = 1; i < parts.length; i++) {
		const key = parts[i];
		if (key === "depth") {
			info.depth = Number(parts[++i]);
		} else if (key === "seldepth") {
			info.seldepth = Number(parts[++i]);
		} else if (key === "multipv") {
			info.multipv = Number(parts[++i]);
		} else if (key === "score") {
			const type = parts[++i] as "cp" | "mate";
			const value = Number(parts[++i]);
			info.score = { type, value };
		} else if (key === "nodes") {
			info.nodes = Number(parts[++i]);
		} else if (key === "nps") {
			info.nps = Number(parts[++i]);
		} else if (key === "time") {
			info.timeMs = Number(parts[++i]);
		} else if (key === "pv") {
			info.pv = parts.slice(i + 1);
			break;
		}
	}
	return info;
}

function isExecutable(p: string): boolean {
	try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}

function findStockfishBinary(): string | null {
	// Allow explicit override via env
	const envPath = process.env.STOCKFISH_PATH;
	if (envPath && isExecutable(envPath)) return envPath;
	// Common locations; in Docker we'll add /usr/bin/stockfish
	const candidates = [
		"/usr/bin/stockfish",
		"/usr/local/bin/stockfish",
		"/usr/games/stockfish",
	];
	for (const c of candidates) {
		if (fs.existsSync(c) && isExecutable(c)) return c;
	}
	// Fallback to PATH name
	return "stockfish";
}

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

	const bin = findStockfishBinary();
	if (!bin) {
		return NextResponse.json({ error: "Stockfish binary not found on server" }, { status: 503 });
	}

	const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	logger.info({ reqId, fen, depth }, "analysis:start");

	return new Promise<NextResponse>((resolve) => {
		const engine = spawn(bin);
		logger.debug({ reqId, bin, pid: engine.pid }, "stockfish:spawned");
		let bestmove: string | null = null;
		const infoLines: string[] = [];
		let bestInfo: EngineInfo | null = null;
		const stopTimer = setTimeout(() => {
			try {
				engine.stdin.write("stop\n");
				engine.stdin.write("quit\n");
				engine.kill();
			} catch {}
		}, Math.max(5, Math.min(depth * 1000, 20000)));

		engine.on("error", (err) => {
			logger.error({ err: String(err) }, "stockfish:spawn_error");
			clearTimeout(stopTimer);
			resolve(NextResponse.json({ error: "Failed to start Stockfish" }, { status: 503 }));
		});

		let sawUciOk = false;
		let sawReadyOk = false;
		let sentIsReady = false;
		const waitForReady: Promise<boolean> = new Promise((resolveReady) => {
			const readyTimeout = setTimeout(() => {
				logger.warn({ reqId }, "stockfish:ready_timeout");
				resolveReady(false);
			}, 8000);
			engine.stdout.on("data", (chunk: Buffer) => {
				const text = chunk.toString("utf8");
				for (const line of text.split(/\r?\n/)) {
					if (!line) continue;
					if (line === "uciok") {
						sawUciOk = true;
						if (!sentIsReady) {
							try { engine.stdin.write("isready\n"); sentIsReady = true; } catch {}
						}
					}
					if (line === "readyok") sawReadyOk = true;
					if (sawUciOk && sawReadyOk) {
						clearTimeout(readyTimeout);
						logger.debug({ reqId }, "stockfish:ready_ok");
						return resolveReady(true);
					}
				}
			});
		});

		engine.stdout.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			for (const line of text.split(/\r?\n/)) {
				if (!line) continue;
				if (line.startsWith("info ")) {
					infoLines.push(line);
					const parsed = parseInfoLine(line);
					if (parsed && (parsed.multipv === undefined || parsed.multipv === 1)) {
						bestInfo = parsed;
					}
				}
				if (line.startsWith("bestmove ")) {
					bestmove = line.split(" ")[1];
					try {
						clearTimeout(stopTimer);
						engine.stdin.write("quit\n");
					} catch {}
				}
			}
		});

		engine.stderr.on("data", (chunk: Buffer) => {
			logger.warn({ reqId, err: chunk.toString("utf8") }, "stockfish:stderr");
		});


		engine.on("close", (code, signal) => {
			logger.info({ reqId, code, signal, bestmove, info: bestInfo }, "analysis:done");
			resolve(NextResponse.json({ reqId, bestmove, info: bestInfo ?? null, raw: infoLines.slice(-10) }));
		});

		// UCI protocol: send uci first; wait for uciok -> send isready
		engine.stdin.write("uci\n");
		waitForReady.then((ok) => {
			if (!ok) {
				clearTimeout(stopTimer);
				logger.error({ reqId }, "stockfish:not_ready");
				return resolve(NextResponse.json({ error: "Stockfish not ready" }, { status: 503 }));
			}
			try {
				logger.debug({ reqId, fen, depth }, "stockfish:go");
				if (limitStrength) {
					engine.stdin.write(`setoption name UCI_LimitStrength value true\n`);
					if (elo !== undefined) engine.stdin.write(`setoption name UCI_Elo value ${elo}\n`);
				}
				engine.stdin.write(`position fen ${fen}\n`);
				engine.stdin.write(`go depth ${depth}\n`);
			} catch (err) {
				logger.error({ reqId, err: String(err) }, "stockfish:write_error");
				clearTimeout(stopTimer);
				return resolve(NextResponse.json({ error: "Stockfish write failed" }, { status: 503 }));
			}
		});
		// Stop after a reasonable timeout to avoid runaway processes

	});
}


