import type { OpponentKind, OpponentPolicy, Side } from "@/lib/policies/types";

export function makeOpponentPolicy(kind: OpponentKind): OpponentPolicy {
  return {
    shouldEngineMove({ turn, playerColor }: { turn: Side; playerColor: Side }): boolean {
      if (kind === 'enginevengine') return true;
      if (kind === 'engine') return turn !== playerColor;
      return false;
    },
  };
}


