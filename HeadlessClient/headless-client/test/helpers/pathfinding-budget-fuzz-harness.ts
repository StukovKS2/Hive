import assert from 'node:assert/strict';
import type { GoldenPathfindingCase } from '../fixtures/golden-pathfinding-cases';
import { GOLDEN_PATHFINDING_CASES } from '../fixtures/golden-pathfinding-cases';
import {
  assertPathfindingResultsEqual,
  runSyncBaseline,
  type PathfindingEquivalenceResult,
} from './pathfinding-equivalence-harness';
import type { GoldenPathResult } from './golden-pathfinding-runner';
import { runGoldenPathfindingCase } from './golden-pathfinding-runner';
import {
  generatePathfindingMap,
  createPathfinderFromFixture,
  type GeneratePathfindingMapOptions,
  type PathfindingMapFixture,
} from './pathfinding-map-generator';

/** Per-step maxNodes caps for incremental step({ maxNodes, maxMs: Infinity }) driving. */
export type BudgetSliceSchedule = number[];

export interface BudgetFuzzPathfindingInput {
  id: string;
  fixture: PathfindingMapFixture;
  mode?: GoldenPathfindingCase['mode'];
  combat?: GoldenPathfindingCase['combat'];
  setup?: GoldenPathfindingCase['setup'];
}

export interface GenerateBudgetSliceScheduleOptions {
  seed: number;
  /** Inclusive lower bound on schedule length. */
  minLength?: number;
  /** Inclusive upper bound on schedule length. */
  maxLength?: number;
  /** Inclusive minimum budget per slice. */
  minBudget?: number;
  /** Inclusive maximum budget per slice. */
  maxBudget?: number;
}

export interface BudgetFuzzHarnessOptions {
  /** When true (default), skip incremental and record skipReason instead of throwing. */
  skipIncremental?: boolean;
}

export interface BudgetFuzzRunResult {
  caseId: string;
  schedule: BudgetSliceSchedule;
  baseline: PathfindingEquivalenceResult;
  incremental?: PathfindingEquivalenceResult;
  incrementalSkipped: boolean;
  skipReason?: string;
}

export class BudgetFuzzIncrementalNotImplementedError extends Error {
  constructor() {
    super('Incremental budget-slice pathfinder is not implemented until Commit 2/3');
    this.name = 'BudgetFuzzIncrementalNotImplementedError';
  }
}

const DEFAULT_MIN_LENGTH = 4;
const DEFAULT_MAX_LENGTH = 24;
const DEFAULT_MIN_BUDGET = 1;
const DEFAULT_MAX_BUDGET = 64;

/**
 * Deterministic pseudo-random budget-slice schedule from a seed.
 * Commit 3 fuzz tests will sweep many schedules per fixture to prove slice
 * boundaries do not change the final planned path.
 */
export function generateBudgetSliceSchedule(
  options: GenerateBudgetSliceScheduleOptions,
): BudgetSliceSchedule {
  const {
    seed,
    minLength = DEFAULT_MIN_LENGTH,
    maxLength = DEFAULT_MAX_LENGTH,
    minBudget = DEFAULT_MIN_BUDGET,
    maxBudget = DEFAULT_MAX_BUDGET,
  } = options;

  assert.ok(minLength >= 1, 'minLength must be at least 1');
  assert.ok(maxLength >= minLength, 'maxLength must be >= minLength');
  assert.ok(minBudget >= 1, 'minBudget must be at least 1');
  assert.ok(maxBudget >= minBudget, 'maxBudget must be >= minBudget');

  const rng = mulberry32(seed);
  const length = minLength + Math.floor(rng() * (maxLength - minLength + 1));
  const span = maxBudget - minBudget + 1;
  const schedule: BudgetSliceSchedule = [];

  for (let index = 0; index < length; index++) {
    schedule.push(minBudget + Math.floor(rng() * span));
  }

  return schedule;
}

/** Generate `count` schedules with distinct derived seeds from one base seed. */
export function generateBudgetSliceSchedules(
  count: number,
  baseSeed: number,
  options: Omit<GenerateBudgetSliceScheduleOptions, 'seed'> = {},
): BudgetSliceSchedule[] {
  assert.ok(count >= 1, 'count must be at least 1');
  return Array.from({ length: count }, (_, index) =>
    generateBudgetSliceSchedule({ ...options, seed: deriveScheduleSeed(baseSeed, index) }),
  );
}

export function budgetFuzzInputFromGoldenCase(testCase: GoldenPathfindingCase): BudgetFuzzPathfindingInput {
  return {
    id: testCase.id,
    fixture: testCase.fixture,
    mode: testCase.mode,
    combat: testCase.combat,
    setup: testCase.setup,
  };
}

export function createProceduralBudgetFuzzInput(
  seed: number,
  mapOptions: Partial<Omit<GeneratePathfindingMapOptions, 'seed'>> = {},
): BudgetFuzzPathfindingInput {
  const fixture = generatePathfindingMap({
    width: 32,
    height: 24,
    ...mapOptions,
    seed,
  });
  return {
    id: `procedural-${seed}`,
    fixture,
  };
}

/** Sync one-shot baseline for golden or procedural inputs. */
export function runBudgetFuzzBaseline(input: BudgetFuzzPathfindingInput): GoldenPathResult {
  if (isGoldenCaseId(input.id)) {
    const goldenCase = GOLDEN_PATHFINDING_CASES.find((entry) => entry.id === input.id);
    if (goldenCase) {
      return runSyncBaseline(goldenCase);
    }
  }
  return runPathfindingOnInput(input);
}

/**
 * Incremental driver: loop step({ maxNodes: schedule[i], maxMs: Infinity }) until
 * found/no_path, then return the same shape as runBudgetFuzzBaseline().
 */
export function runIncrementalWithBudgetSchedule(
  input: BudgetFuzzPathfindingInput,
  schedule: BudgetSliceSchedule,
): GoldenPathResult {
  assert.ok(schedule.length > 0, 'schedule must contain at least one maxNodes cap');
  const pathfinder = createPathfinderFromFixture(input.fixture);

  if (input.mode === 'combat') {
    const combat = input.combat!;
    pathfinder.setCombatTarget(combat.target, combat.range, combat.primaryEnemyId);
  } else {
    pathfinder.setTarget(input.fixture.goal, 0.2);
  }

  if (input.setup === 'learned-blocked-at-start') {
    pathfinder.next(input.fixture.start);
    pathfinder.reportStall(input.fixture.start);
  }

  const rawTiles = pathfinder.runPathSearchToCompletion(input.fixture.start, schedule);
  return {
    rawPath: rawTiles ?? [],
    noPath: rawTiles === undefined,
    replanned: false,
  };
}

/**
 * Given fixture input + maxNodes schedule: run sync baseline, optionally run
 * incremental driver with step({ maxNodes, maxMs: Infinity }), assert equal.
 */
export function runBudgetFuzzCase(
  input: BudgetFuzzPathfindingInput,
  schedule: BudgetSliceSchedule,
  options: BudgetFuzzHarnessOptions = {},
): BudgetFuzzRunResult {
  const { skipIncremental = true } = options;
  const baseline = runBudgetFuzzBaseline(input);

  if (skipIncremental) {
    return {
      caseId: input.id,
      schedule,
      baseline,
      incrementalSkipped: true,
      skipReason: 'Incremental comparison skipped by caller',
    };
  }

  const incremental = runIncrementalWithBudgetSchedule(input, schedule);
  assertPathfindingResultsEqual(baseline, incremental, input.id);
  return {
    caseId: input.id,
    schedule,
    baseline,
    incremental,
    incrementalSkipped: false,
  };
}

export function* iterateGoldenBudgetFuzzInputs(): Generator<BudgetFuzzPathfindingInput> {
  for (const testCase of GOLDEN_PATHFINDING_CASES) {
    yield budgetFuzzInputFromGoldenCase(testCase);
  }
}

function runPathfindingOnInput(input: BudgetFuzzPathfindingInput): GoldenPathResult {
  const pseudoCase: GoldenPathfindingCase = {
    id: input.id,
    specialCase: 'budget-fuzz procedural',
    fixture: input.fixture,
    expectedRawPath: [],
    mode: input.mode,
    combat: input.combat,
    setup: input.setup,
  };
  return runGoldenPathfindingCase(pseudoCase);
}

function isGoldenCaseId(id: string): boolean {
  return GOLDEN_PATHFINDING_CASES.some((entry) => entry.id === id);
}

function deriveScheduleSeed(baseSeed: number, index: number): number {
  return (baseSeed + Math.imul(index + 1, 0x9e37_79b9)) >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
