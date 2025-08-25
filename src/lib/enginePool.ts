import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import { logger } from "@/lib/logger";

export type AnalyzeParams = { fen: string; depth: number; elo?: number; limitStrength?: boolean };
export type AnalyzeInfo = { depth?: number; seldepth?: number; multipv?: number; score?: { type: "cp"|"mate"; value: number }; nodes?: number; nps?: number; timeMs?: number; pv?: string[] };
export type AnalyzeResult = { bestmove: string | null; info: AnalyzeInfo | null; raw: string[]; reqId: string };

function isExecutable(p: string): boolean { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }
function findStockfishBinary(): string {
  const envPath = process.env.STOCKFISH_PATH;
  if (envPath && isExecutable(envPath)) return envPath;
  const candidates = ["/usr/bin/stockfish", "/usr/local/bin/stockfish", "/usr/games/stockfish"];
  for (const c of candidates) { if (fs.existsSync(c) && isExecutable(c)) return c; }
  return "stockfish";
}

function parseInfoLine(line: string): AnalyzeInfo | null {
  if (!line.startsWith("info ")) return null;
  const parts = line.trim().split(/\s+/);
  const info: AnalyzeInfo = {};
  for (let i = 1; i < parts.length; i++) {
    const key = parts[i];
    if (key === "depth") info.depth = Number(parts[++i]);
    else if (key === "seldepth") info.seldepth = Number(parts[++i]);
    else if (key === "multipv") info.multipv = Number(parts[++i]);
    else if (key === "score") { const type = parts[++i] as "cp"|"mate"; const value = Number(parts[++i]); info.score = { type, value }; }
    else if (key === "nodes") info.nodes = Number(parts[++i]);
    else if (key === "nps") info.nps = Number(parts[++i]);
    else if (key === "time") info.timeMs = Number(parts[++i]);
    else if (key === "pv") { info.pv = parts.slice(i+1); break; }
  }
  return info;
}

type QueueItem = { params: AnalyzeParams; resolve: (r: AnalyzeResult) => void; reject: (e: Error) => void; reqId: string };

class EnginePoolImpl {
  private engine: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private busy = false;
  private queue: QueueItem[] = [];
  private activeDedupe = new Map<string, { promise: Promise<AnalyzeResult>; ts: number }>();
  private lastStdoutLines: string[] = [];

  public getHealth() {
    return { ready: this.ready, busy: this.busy, pid: this.engine?.pid ?? null, lastStdout: this.lastStdoutLines.slice(-10) };
  }

  private ensureStarted() {
    if (this.engine) return;
    const bin = findStockfishBinary();
    const reqId = `start-${Date.now()}`;
    this.engine = spawn(bin);
    this.ready = false;
    logger.info({ reqId, bin, pid: this.engine.pid }, "enginePool:spawned");

    let sawUciOk = false; let sawReadyOk = false; let sentIsReady = false;
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        this.lastStdoutLines.push(line); if (this.lastStdoutLines.length > 100) this.lastStdoutLines.shift();
        if (line === "uciok") { sawUciOk = true; if (!sentIsReady) { try { this.engine!.stdin.write("isready\n"); sentIsReady = true; } catch {} } }
        if (line === "readyok") sawReadyOk = true;
        if (sawUciOk && sawReadyOk && !this.ready) {
          this.ready = true; logger.info({ reqId }, "enginePool:ready"); this.pump();
        }
      }
    };
    this.engine.stdout.on("data", onData);
    this.engine.stderr.on("data", (c: Buffer) => logger.warn({ err: c.toString("utf8") }, "enginePool:stderr"));
    this.engine.on("error", () => { this.reset(); });
    this.engine.on("close", (code, signal) => { logger.warn({ code, signal }, "enginePool:closed"); this.reset(); });
    try { this.engine.stdin.write("uci\n"); } catch {}
  }

  private reset() {
    this.ready = false; this.busy = false; this.engine = null;
    // Reject all queued items
    while (this.queue.length) { const q = this.queue.shift()!; q.reject(new Error("Engine unavailable")); }
  }

  public analyze(params: AnalyzeParams): Promise<AnalyzeResult> {
    const key = `${params.fen}|d${params.depth}|e${params.elo ?? "-"}`;
    const now = Date.now();
    const existing = this.activeDedupe.get(key);
    if (existing && now - existing.ts < 5000) return existing.promise;
    this.ensureStarted();
    const reqId = `${now}-${Math.random().toString(36).slice(2,8)}`;
    const promise = new Promise<AnalyzeResult>((resolve, reject) => {
      this.queue.push({ params, resolve, reject, reqId }); this.pump();
    });
    this.activeDedupe.set(key, { promise, ts: now });
    return promise;
  }

  private pump() {
    if (!this.ready || this.busy || !this.engine) return;
    const job = this.queue.shift(); if (!job) return;
    this.busy = true;
    const { params, resolve, reject, reqId } = job;
    logger.debug({ reqId, params }, "enginePool:job_start");
    let bestmove: string | null = null; let bestInfo: AnalyzeInfo | null = null; const infoLines: string[] = [];
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        if (line.startsWith("info ")) { infoLines.push(line); const parsed = parseInfoLine(line); if (parsed && (parsed.multipv === undefined || parsed.multipv === 1)) bestInfo = parsed; }
        if (line.startsWith("bestmove ")) { bestmove = line.split(" ")[1]; finish(); }
      }
    };
    const finish = () => {
      try { this.engine!.stdout.off("data", onData); } catch {}
      const result: AnalyzeResult = { bestmove, info: bestInfo, raw: infoLines.slice(-10), reqId };
      logger.info({ reqId, bestmove }, "enginePool:job_done");
      this.busy = false; resolve(result); setImmediate(() => this.pump());
    };
    this.engine.stdout.on("data", onData);
    try {
      if (params.limitStrength) { this.engine.stdin.write(`setoption name UCI_LimitStrength value true\n`); if (params.elo) this.engine.stdin.write(`setoption name UCI_Elo value ${params.elo}\n`); }
      this.engine.stdin.write(`position fen ${params.fen}\n`);
      this.engine.stdin.write(`go depth ${params.depth}\n`);
    } catch (err) {
      try { this.engine.stdout.off("data", onData); } catch {}
      this.busy = false; reject(new Error("Engine write failed")); setImmediate(() => this.pump());
    }
  }
}

// Singleton across hot reloads
declare global {
  var __enginePool: EnginePoolImpl | undefined;
}

export const EnginePool: EnginePoolImpl = (global.__enginePool ??= new EnginePoolImpl());


