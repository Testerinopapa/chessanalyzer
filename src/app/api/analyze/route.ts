import { NextRequest, NextResponse } from "next/server";
import { spawn, execFileSync } from "child_process";
import { logger } from "@/lib/logger";

type AnalyzeRequest = {
	fen: string;
	depth?: number;
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

function findStockfishBinary(): string | null {
	// Allow explicit override via env
	const envPath = process.env.STOCKFISH_PATH;
	if (envPath) {
		try {
			execFileSync(envPath, ["uci"], { timeout: 1000 });
			return envPath;
		} catch {}
	}
	// Common locations; in Docker we'll add /usr/bin/stockfish
	const candidates = [
		"/usr/bin/stockfish",
		"/usr/local/bin/stockfish",
		"/usr/games/stockfish",
		"stockfish",
	];
	for (const candidate of candidates) {
		try {
			execFileSync(candidate, ["uci"], { timeout: 1000 });
			return candidate;
		} catch {}
	}
	return null;
}

export async function POST(req: NextRequest) {
	const body = (await req.json()) as AnalyzeRequest;
	const { fen, depth = 12 } = body;
	if (!fen || typeof fen !== "string") {
		return NextResponse.json({ error: "Missing fen" }, { status: 400 });
	}

	const bin = findStockfishBinary();
	if (!bin) {
		return NextResponse.json({ error: "Stockfish binary not found on server" }, { status: 503 });
	}

	logger.info({ fen, depth }, "analysis:start");

	return new Promise<NextResponse>((resolve) => {
		const engine = spawn(bin);
		let bestmove: string | null = null;
		const infoLines: string[] = [];
		let bestInfo: EngineInfo | null = null;
		const stopTimer = setTimeout(() => {
			try {
				engine.stdin.write("stop\n");
				engine.stdin.write("quit\n");
				engine.kill();
			} catch {}
		}, Math.max(3, Math.min(depth * 1000, 15000)));

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
			logger.warn({ err: chunk.toString("utf8") }, "stockfish:stderr");
		});

		engine.on("close", () => {
			logger.info({ bestmove, info: bestInfo }, "analysis:done");
			resolve(NextResponse.json({ bestmove, info: bestInfo ?? null, raw: infoLines.slice(-10) }));
		});

		// UCI protocol
		engine.stdin.write("uci\n");
		engine.stdin.write("isready\n");
		engine.stdin.write(`position fen ${fen}\n`);
		engine.stdin.write(`go depth ${depth}\n`);
		// Stop after a reasonable timeout to avoid runaway processes

	});
}


