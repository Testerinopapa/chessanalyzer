# Game Modes Refactor – Policy Composition + Presets/Overrides

## Summary
Refactor game modes to be composed from small, testable policies (time, opponent, assistance, engine, constraints), with a thin preset layer and per-session overrides. Persist the active configuration (preset + diff) with reports.

## Objectives
- Replace monolithic mode handling with composable policies.
- Keep a few friendly presets (e.g., Hotseat, Vs Engine, Blitz 5+0).
- Allow overrides without forking code paths.
- Persist selected config (preset id + overrides) in saved reports.

## Out of Scope
- Online multiplayer, matchmaking, or server clocks.
- New analysis features beyond wiring into policies.

## Architecture
- Policies
  - TimePolicy: init (whiteMs, blackMs, inc), tick(activeSide), onMove(side), onTimeout(side).
  - OpponentPolicy: who moves when; engine trigger conditions.
  - AssistancePolicy: hints availability, blunder warn flags.
  - EnginePolicy: depth, elo, multiPv; request shaping.
  - ConstraintsPolicy: puzzle/opening gating and scoring.
- Config
  - ModeConfig = { policies: { time?, opponent, assistance?, engine?, constraints? } }
  - Preset: { id, label, config }
  - Overrides: shallow diff applied over preset.config
- Hooks
  - onInit(config)
  - onUserMove(move)
  - onEngineTurn(ctx)
  - onAfterMove(side)
  - onTimeout(side)

## Data Model
- Report.mode: { presetId?: string; overrides?: Partial<ModeConfig> }
- Analysis.mode (optional, same shape)

## Migration Plan
1) Introduce policy types + default implementations.
2) Create presets using policies.
3) Replace current mode logic in page with policy orchestrator.
4) Add persistence of preset + overrides to report generation.
5) Remove legacy `playMode` remnants.

## Tasks
- [ ] Define types: Policy interfaces and ModeConfig (src/types/gameModes.ts)
- [ ] Implement policies: time, opponent, assistance, engine, constraints (src/lib/policies/*)
- [ ] Build presets from policies (src/types/gameModes.ts)
- [ ] Orchestrator hook in page: wires policies + lifecycle (src/app/page.tsx)
- [ ] UI: preset selector + override controls (axes)
- [ ] Persist mode config with reports (API + Prisma fields)
- [ ] Update issue docs and README snippets
- [ ] Tests: unit (policies), e2e (timeouts, engine turns)

## Acceptance Criteria
- Can switch presets and tweak overrides at runtime.
- Timed modes tick and increment; timeout ends game deterministically.
- Engine moves trigger per opponent policy.
- Reports store preset + overrides; can reload a game with the same behavior.

## Risks & Mitigations
- Complexity creep: keep policies small and cohesive; add tests.
- Back-compat: keep old presets mapped to new config shapes.
