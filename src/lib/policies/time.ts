import type { TimePolicy } from "@/lib/policies/types";

export function makeTimePolicy(cfg?: { whiteMs: number; blackMs: number; incrementMs?: number } | null): TimePolicy {
  if (!cfg) return { hasTime: false, whiteMs: 0, blackMs: 0, incrementMs: 0 };
  return {
    hasTime: true,
    whiteMs: cfg.whiteMs,
    blackMs: cfg.blackMs,
    incrementMs: cfg.incrementMs ?? 0,
  };
}


