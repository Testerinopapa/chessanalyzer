export type Side = 'white' | 'black';

export type OpponentKind = 'human' | 'engine' | 'enginevengine';

export interface OpponentPolicy {
  shouldEngineMove(params: { turn: Side; playerColor: Side }): boolean;
}

export interface TimePolicy {
  hasTime: boolean;
  whiteMs: number;
  blackMs: number;
  incrementMs: number;
}


