import type { GameRules } from "@/types/gameModes";

export function shouldEngineMove(rules: GameRules, turn: "white"|"black", playerColor: "white"|"black"): boolean {
  return (rules.opponent === 'engine' && turn !== playerColor) || rules.opponent === 'enginevengine';
}

export function getEngineParams(rules: GameRules): { depth: number; elo?: number; limitStrength: boolean; multiPv: number } {
  const depth = rules.engine?.depth ?? 12;
  const eloVal = rules.engine?.elo ?? undefined;
  const limitStrength = rules.engine?.elo != null ? true : false;
  const multiPv = Math.max(1, Math.min(10, rules.engine?.multiPv ?? 1));
  return { depth, elo: eloVal ?? undefined, limitStrength, multiPv };
}

export function isMoveAllowed(rules: GameRules, san: string, context: { openingLine?: string[]; idx: number }): boolean {
  if (rules.constraints?.openingLine) {
    const target = rules.constraints.openingLine[context.idx];
    if (target && target !== san) {
      // Allow deviation but consider disallowed for strict trainers; here we just return true to not block
      return true;
    }
  }
  return true;
}


