import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import readline from "readline";

export type PgnFilter = {
  ratedOnly?: boolean;
  variant?: string; // e.g., "Standard"
  minElo?: number;
  maxElo?: number;
  timeControlRegex?: RegExp; // e.g., /^(300|180)\+\d+$/
};

type HeaderMap = Record<string, string>;

function parseHeaderLine(line: string): [string, string] | null {
  // Example: [WhiteElo "2130"]
  const m = line.match(/^\[(\w+)\s+"([\s\S]*?)"\]$/);
  if (!m) return null;
  return [m[1], m[2]];
}

function headersPassFilter(h: HeaderMap, f?: PgnFilter): boolean {
  if (!f) return true;
  if (f.variant && (h["Variant"] || "Standard") !== f.variant) return false;
  if (f.ratedOnly) {
    const ev = h["Event"] || "";
    if (!/Rated/i.test(ev)) return false;
  }
  if (f.timeControlRegex) {
    const tc = h["TimeControl"] || "-";
    if (!f.timeControlRegex.test(tc)) return false;
  }
  const toInt = (s?: string) => (s && s !== "?" ? parseInt(s, 10) : NaN);
  const we = toInt(h["WhiteElo"]);
  const be = toInt(h["BlackElo"]);
  const hasAny = Number.isFinite(we) || Number.isFinite(be);
  if (f.minElo != null && hasAny) {
    if ((Number.isFinite(we) && we! < f.minElo) && (Number.isFinite(be) && be! < f.minElo)) return false;
  }
  if (f.maxElo != null && hasAny) {
    if ((Number.isFinite(we) && we! > f.maxElo) && (Number.isFinite(be) && be! > f.maxElo)) return false;
  }
  return true;
}

export async function* streamPgnGamesFromZst(filePath: string, filter?: PgnFilter): AsyncGenerator<string> {
  if (!fs.existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
  const proc: ChildProcessWithoutNullStreams = spawn("zstd", ["-dc", filePath], { stdio: ["ignore", "pipe", "inherit"] });
  const rl = readline.createInterface({ input: proc.stdout });

  let buf: string[] = [];
  let headers: HeaderMap = {};
  let inGame = false;
  let inHeader = false;

  const flush = (): string | null => {
    if (!buf.length) return null;
    const game = buf.join("\n").trim();
    buf = [];
    headers = {};
    inGame = false; inHeader = false;
    return game || null;
  };

  for await (const lineRaw of rl) {
    const line = String(lineRaw);
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      // header starts
      if (!inGame) { inGame = true; inHeader = true; }
      const kv = parseHeaderLine(trimmed);
      if (kv) headers[kv[0]] = kv[1];
      buf.push(line);
      continue;
    }
    if (inHeader && trimmed === "") {
      // headers end; decide if we want this game
      inHeader = false;
      // If filter says no, still need to skip to next blank line after movetext.
      if (!headersPassFilter(headers, filter)) {
        // Enter skip mode: still append lines until blank line after movetext
        buf = []; // drop headers
        // Mark that we're in a game but skipping
        inGame = true;
        continue;
      }
      buf.push(line);
      continue;
    }
    if (inGame) {
      buf.push(line);
      // End of game indicated by empty line following movetext
      if (trimmed === "" && buf.length > 1) {
        const out = flush();
        if (out) yield out;
      }
    }
  }
  const out = flush();
  if (out) yield out;

  await new Promise<void>(res => proc.on("close", () => res()));
}


