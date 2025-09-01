export type AssistancePolicy = {
  hints: boolean;
  blunderWarn: boolean;
  onlyMoveTag: boolean;
};

export function makeAssistancePolicy(cfg?: Partial<AssistancePolicy> | null): AssistancePolicy {
  return {
    hints: !!cfg?.hints,
    blunderWarn: !!cfg?.blunderWarn,
    onlyMoveTag: !!cfg?.onlyMoveTag,
  };
}


