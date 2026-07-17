import assert from 'node:assert/strict';
import type { GoldenPathfindingCase } from '../fixtures/golden-pathfinding-cases';
import { GOLDEN_PATHFINDING_CASES } from '../fixtures/golden-pathfinding-cases';
import {
  runGoldenPathfindingCase,
  type GoldenPathResult,
} from './golden-pathfinding-runner';

/** Comparable output from sync baseline or incremental runToCompletion(). */
export type PathfindingEquivalenceResult = GoldenPathResult;

export interface IncrementalPathfinderRunOptions {
  /** Per-step expansion budget when driving incremental search (Commit 3). */
  budgetPerStep?: number;
}

export class IncrementalPathfinderNotImplementedError extends Error {
  constructor() {
    super('Incremental pathfinder runToCompletion is not implemented until Commit 2/3');
    this.name = 'IncrementalPathfinderNotImplementedError';
  }
}

/** Sync one-shot baseline: current aStar() via next() + getPlannedTiles(). */
export function runSyncBaseline(testCase: GoldenPathfindingCase): PathfindingEquivalenceResult {
  return runGoldenPathfindingCase(testCase);
}

/**
 * Stub for future incremental PathSearch.runToCompletion() driver.
 * Commit 2/3 will loop step(budget) until found/no_path and return the same shape as runSyncBaseline().
 */
export function runIncrementalToCompletion(
  _testCase: GoldenPathfindingCase,
  _options?: IncrementalPathfinderRunOptions,
): PathfindingEquivalenceResult {
  throw new IncrementalPathfinderNotImplementedError();
}

export function assertPathfindingResultsEqual(
  baseline: PathfindingEquivalenceResult,
  incremental: PathfindingEquivalenceResult,
  caseId: string,
): void {
  assert.equal(
    incremental.noPath,
    baseline.noPath,
    `${caseId}: noPath mismatch (sync=${baseline.noPath}, incremental=${incremental.noPath})`,
  );
  if (baseline.noPath) {
    return;
  }
  assert.deepEqual(
    incremental.rawPath,
    baseline.rawPath,
    `${caseId}: raw tile path mismatch between sync baseline and incremental runToCompletion`,
  );
}

export interface PathfindingEquivalenceRunResult {
  caseId: string;
  baseline: PathfindingEquivalenceResult;
  incremental?: PathfindingEquivalenceResult;
  incrementalSkipped: boolean;
  skipReason?: string;
}

export interface PathfindingEquivalenceHarnessOptions {
  /** When true (default), skip incremental and record skipReason instead of throwing. */
  skipIncremental?: boolean;
  incrementalOptions?: IncrementalPathfinderRunOptions;
}

/**
 * Given a golden fixture: run sync baseline, optionally run incremental stub, assert equal.
 * Default mode skips incremental until Commit 2/3 wires runIncrementalToCompletion().
 */
export function runPathfindingEquivalenceCase(
  testCase: GoldenPathfindingCase,
  options: PathfindingEquivalenceHarnessOptions = {},
): PathfindingEquivalenceRunResult {
  const { skipIncremental = true, incrementalOptions } = options;
  const baseline = runSyncBaseline(testCase);

  if (skipIncremental) {
    return {
      caseId: testCase.id,
      baseline,
      incrementalSkipped: true,
      skipReason: 'Incremental pathfinder not implemented until Commit 2/3',
    };
  }

  const incremental = runIncrementalToCompletion(testCase, incrementalOptions);
  assertPathfindingResultsEqual(baseline, incremental, testCase.id);
  return {
    caseId: testCase.id,
    baseline,
    incremental,
    incrementalSkipped: false,
  };
}

export function* iterateGoldenPathfindingEquivalenceCases(): Generator<GoldenPathfindingCase> {
  for (const testCase of GOLDEN_PATHFINDING_CASES) {
    yield testCase;
  }
}

export function runAllGoldenPathfindingEquivalenceCases(
  options?: PathfindingEquivalenceHarnessOptions,
): PathfindingEquivalenceRunResult[] {
  return GOLDEN_PATHFINDING_CASES.map((testCase) =>
    runPathfindingEquivalenceCase(testCase, options),
  );
}
