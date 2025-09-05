import fs from "fs";
import path from "path";

const input = process.argv[2] || path.join(process.cwd(), "motifs.md");
const outFile = process.argv[3] || path.join(process.cwd(), "docs", "motifs_by_difficulty.md");

const EASY = new Set([
  "mateIn1", "oneMove",
  "hangingPiece", "trappedPiece",
  "fork", "pin", "skewer",
  "backRankMate", "arabianMate", "bodenMate", "hookMate", "doubleBishopMate",
  "attackingF2F7",
  "advantage", "equality",
]);

const MEDIUM = new Set([
  "mateIn2", "mateIn3",
  "discoveredAttack", "deflection", "attraction", "clearance",
  "intermezzo", "interference", "xRayAttack", "doubleCheck",
  "capturingDefender",
  "promotion", "advancedPawn",
  "exposedKing", "kingsideAttack", "queensideAttack",
  // endgame subtypes are treated as PHASE (not difficulty drivers)
]);

const HARD = new Set([
  // direct
  "zugzwang", "quietMove", "defensiveMove",
  // meta amplifiers (we list separately too)
  "crushing", "veryLong", "master", "masterVsMaster", "superGM",
]);

function classify(token: string): "easy"|"medium"|"hard"|"meta"|"phase"|"uncategorized" {
  if (!token) return "uncategorized";
  if (EASY.has(token)) return "easy";
  if (MEDIUM.has(token)) return "medium";
  if (HARD.has(token)) return token === "zugzwang" ? "hard" : "meta";
  if (/^mateIn(\d+)$/.test(token)) {
    const n = parseInt(token.replace("mateIn", ""), 10);
    if (n <= 1) return "easy"; if (n <= 3) return "medium"; return "hard";
  }
  if (token === "opening" || token === "middlegame" || token === "endgame") return "phase";
  if (/^(queen|rook|bishop|knight|pawn)Endgame$/i.test(token) || token === "queenRookEndgame") return "phase";
  if (token === "long" || token === "veryLong" || token === "master" || token === "masterVsMaster" || token === "superGM") return "meta";
  return "uncategorized";
}

function uniqueTokensFromFile(text: string): string[] {
  const raw = text.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  const set = new Set<string>();
  for (const t of raw) set.add(t);
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}

function run() {
  if (!fs.existsSync(input)) {
    console.error(`Input not found: ${input}`);
    process.exit(1);
  }
  const text = fs.readFileSync(input, "utf8");
  const tokens = uniqueTokensFromFile(text);
  const groups: Record<string, Set<string>> = {
    easy: new Set(), medium: new Set(), hard: new Set(), meta: new Set(), phase: new Set(), uncategorized: new Set(),
  };
  for (const t of tokens) {
    const g = classify(t);
    groups[g].add(t);
  }
  const lines: string[] = [];
  lines.push("# Motifs grouped by difficulty\n");
  const emit = (title: string, set: Set<string>) => {
    lines.push(`## ${title}`);
    const list = Array.from(set).sort((a,b)=>a.localeCompare(b));
    if (list.length === 0) { lines.push("(none)\n"); return; }
    for (const t of list) lines.push(`- ${t}`);
    lines.push("");
  };
  emit("Easy", groups.easy);
  emit("Medium", groups.medium);
  emit("Hard", groups.hard);
  emit("Meta (amplifiers)", groups.meta);
  emit("Phase", groups.phase);
  emit("Uncategorized", groups.uncategorized);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, lines.join("\n"), "utf8");
  console.log(`Wrote ${outFile}`);
}

run();


