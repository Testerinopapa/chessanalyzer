import { NextRequest, NextResponse } from "next/server";
import { spawn, execFileSync } from "child_process";
import { logger } from "@/lib/logger";

type AnalyzeRequest = {
	fen: string;
	depth?: number;
};

function findStockfishBinary(): string | null {
	// Common locations; in Docker we'll add /usr/bin/stockfish
	const candidates = [
		"/usr/bin/stockfish",
		"/usr/local/bin/stockfish",
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

		engine.stdout.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			for (const line of text.split(/\r?\n/)) {
				if (!line) continue;
				if (line.startsWith("info ")) infoLines.push(line);
				if (line.startsWith("bestmove ")) {
					bestmove = line.split(" ")[1];
				}
			}
		});

		engine.stderr.on("data", (chunk: Buffer) => {
			logger.warn({ err: chunk.toString("utf8") }, "stockfish:stderr");
		});

		engine.on("close", () => {
			logger.info({ bestmove }, "analysis:done");
			resolve(NextResponse.json({ bestmove, info: infoLines.slice(-10) }));
		});

		// UCI protocol
		engine.stdin.write("uci\n");
		engine.stdin.write("isready\n");
		engine.stdin.write(`position fen ${fen}\n`);
		engine.stdin.write(`go depth ${depth}\n`);
		// Stop after a reasonable timeout to avoid runaway processes
		setTimeout(() => {
			try {
				engine.stdin.write("stop\n");
				engine.kill();
			} catch {}
		}, Math.max(3, Math.min(depth * 1000, 15000)));
	});
}


