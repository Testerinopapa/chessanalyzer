import { makeOpponentPolicy } from "@/lib/policies/opponent";
import { makeTimePolicy } from "@/lib/policies/time";
import { makeAssistancePolicy } from "@/lib/policies/assistance";
import { makeEnginePolicy } from "@/lib/policies/engine";
import { makeConstraintsPolicy } from "@/lib/policies/constraints";

export type ModeConfig = {
  opponent: 'human'|'engine'|'enginevengine';
  time?: { whiteMs: number; blackMs: number; incrementMs?: number } | null;
  assistance?: { hints?: boolean; blunderWarn?: boolean; onlyMoveTag?: boolean } | null;
  engine?: { depth?: number; elo?: number | null; multiPv?: number } | null;
  constraints?: { openingLine?: string[]; puzzleFen?: string; puzzleSolutionPv?: string[] } | null;
};

export function composePolicies(cfg: ModeConfig) {
  const opponent = makeOpponentPolicy(cfg.opponent);
  const time = makeTimePolicy(cfg.time ?? null);
  const assistance = makeAssistancePolicy(cfg.assistance ?? null);
  const engine = makeEnginePolicy(cfg.engine ?? null);
  const constraints = makeConstraintsPolicy(cfg.constraints ?? null);
  return { opponent, time, assistance, engine, constraints };
}


