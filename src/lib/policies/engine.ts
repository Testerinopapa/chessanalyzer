export type EnginePolicy = {
  depth: number;
  elo?: number | null;
  multiPv: number;
};

export function makeEnginePolicy(cfg?: Partial<EnginePolicy> | null): EnginePolicy {
  return {
    depth: cfg?.depth ?? 12,
    elo: cfg?.elo ?? null,
    multiPv: Math.max(1, Math.min(10, cfg?.multiPv ?? 1)),
  };
}


