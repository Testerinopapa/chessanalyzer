export type GameModeId =
  | 'hotseat'
  | 'engine'
  | 'enginevengine'
  | 'puzzle'
  | 'openingTrainer'
  | 'timedBlitz';

export type AssistanceConfig = {
  hints: boolean;
  blunderWarn: boolean;
  onlyMoveTag: boolean;
};

export type TimeControl = {
  whiteMs: number;
  blackMs: number;
  incrementMs?: number;
};

export type EngineConfig = {
  depth: number;
  elo?: number | null;
  multiPv?: number;
};

export type ConstraintsConfig = {
  openingLine?: string[];
  puzzleFen?: string;
  puzzleSolutionPv?: string[];
};

export type GameRules = {
  id: GameModeId;
  label: string;
  opponent: 'human' | 'engine' | 'enginevengine';
  assistance: AssistanceConfig;
  time?: TimeControl;
  engine?: EngineConfig;
  constraints?: ConstraintsConfig;
};

export const GAME_MODES_PRESETS: Record<GameModeId, GameRules> = {
  hotseat: {
    id: 'hotseat',
    label: 'Hotseat',
    opponent: 'human',
    assistance: { hints: false, blunderWarn: false, onlyMoveTag: false },
  },
  engine: {
    id: 'engine',
    label: 'Vs Engine',
    opponent: 'engine',
    assistance: { hints: false, blunderWarn: true, onlyMoveTag: true },
    engine: { depth: 12, elo: null, multiPv: 2 },
  },
  enginevengine: {
    id: 'enginevengine',
    label: 'Engine vs Engine',
    opponent: 'enginevengine',
    assistance: { hints: false, blunderWarn: false, onlyMoveTag: false },
    engine: { depth: 12, elo: null, multiPv: 1 },
  },
  puzzle: {
    id: 'puzzle',
    label: 'Puzzle',
    opponent: 'human',
    assistance: { hints: true, blunderWarn: true, onlyMoveTag: true },
    constraints: {},
  },
  openingTrainer: {
    id: 'openingTrainer',
    label: 'Opening Trainer',
    opponent: 'human',
    assistance: { hints: true, blunderWarn: true, onlyMoveTag: true },
    constraints: {},
  },
  timedBlitz: {
    id: 'timedBlitz',
    label: 'Blitz 5+0',
    opponent: 'engine',
    assistance: { hints: false, blunderWarn: false, onlyMoveTag: false },
    time: { whiteMs: 300000, blackMs: 300000 },
    engine: { depth: 10, elo: 1800, multiPv: 1 },
  },
};


