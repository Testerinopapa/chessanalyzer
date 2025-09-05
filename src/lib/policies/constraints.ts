export type ConstraintsPolicy = {
  openingLine?: string[];
  puzzleFen?: string;
  puzzleSolutionPv?: string[];
};

export function makeConstraintsPolicy(cfg?: Partial<ConstraintsPolicy> | null): ConstraintsPolicy {
  return {
    openingLine: cfg?.openingLine,
    puzzleFen: cfg?.puzzleFen,
    puzzleSolutionPv: cfg?.puzzleSolutionPv,
  };
}


