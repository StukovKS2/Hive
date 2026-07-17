import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GOLDEN_PATHFINDING_CASES } from './fixtures/golden-pathfinding-cases';
import {
  budgetFuzzInputFromGoldenCase,
  createProceduralBudgetFuzzInput,
  generateBudgetSliceSchedule,
  generateBudgetSliceSchedules,
  iterateGoldenBudgetFuzzInputs,
  runBudgetFuzzBaseline,
  runBudgetFuzzCase,
  runIncrementalWithBudgetSchedule,
} from './helpers/pathfinding-budget-fuzz-harness';

const INCREMENTAL_SKIPPED_BY_DEFAULT = 'Incremental comparison skipped by caller';
const BASELINE_SCHEDULE_SEED = 0xb0d9_f00d;

test('generateBudgetSliceSchedule is deterministic for the same seed', () => {
  const options = { seed: 0xdecaf_bad, minLength: 6, maxLength: 12, minBudget: 2, maxBudget: 48 };
  const first = generateBudgetSliceSchedule(options);
  const second = generateBudgetSliceSchedule(options);

  assert.deepEqual(first, second);
  assert.ok(first.length >= options.minLength);
  assert.ok(first.length <= options.maxLength);
  for (const budget of first) {
    assert.ok(budget >= options.minBudget);
    assert.ok(budget <= options.maxBudget);
  }
});

test('generateBudgetSliceSchedule changes when the seed changes', () => {
  const base = { minLength: 8, maxLength: 16, minBudget: 1, maxBudget: 32 };
  const left = generateBudgetSliceSchedule({ ...base, seed: 1 });
  const right = generateBudgetSliceSchedule({ ...base, seed: 2 });

  assert.notDeepEqual(left, right);
});

test('generateBudgetSliceSchedules returns distinct derived schedules', () => {
  const schedules = generateBudgetSliceSchedules(4, 0x512_f00d, { minLength: 4, maxLength: 8 });
  assert.equal(schedules.length, 4);
  const serialized = schedules.map((schedule) => schedule.join(','));
  assert.equal(new Set(serialized).size, serialized.length);
});

test('budget fuzz harness iterates every golden-path fixture', () => {
  const harnessIds = [...iterateGoldenBudgetFuzzInputs()].map((entry) => entry.id);
  const fixtureIds = GOLDEN_PATHFINDING_CASES.map((entry) => entry.id);
  assert.deepEqual(harnessIds, fixtureIds);
});

for (const testCase of GOLDEN_PATHFINDING_CASES) {
  const input = budgetFuzzInputFromGoldenCase(testCase);
  const schedule = generateBudgetSliceSchedule({ seed: BASELINE_SCHEDULE_SEED });

  test(`budget fuzz baseline: ${testCase.id} (${testCase.specialCase})`, () => {
    const result = runBudgetFuzzCase(input, schedule);

    assert.equal(result.caseId, testCase.id);
    assert.equal(result.incrementalSkipped, true);
    assert.equal(result.skipReason, INCREMENTAL_SKIPPED_BY_DEFAULT);
    assert.equal(result.incremental, undefined);
    assert.ok(result.schedule.length > 0);

    if (testCase.expectedNoPath) {
      assert.equal(result.baseline.noPath, true, `${testCase.id} should report no path`);
      return;
    }

    assert.equal(result.baseline.noPath, false, `${testCase.id} should find a path`);
    assert.deepEqual(
      result.baseline.rawPath,
      testCase.expectedRawPath,
      `${testCase.id} sync baseline must match the golden fixture`,
    );
  });

  test(
    `budget fuzz incremental matches sync: ${testCase.id}`,
    () => {
      runBudgetFuzzCase(input, schedule, { skipIncremental: false });
    },
  );
}

test('budget fuzz baseline smoke: procedural map from generator', () => {
  const input = createProceduralBudgetFuzzInput(0xdec0_d001, {
    width: 20,
    height: 16,
    blockDensity: 0.12,
    objectDensity: 0.04,
  });
  const schedule = generateBudgetSliceSchedule({ seed: BASELINE_SCHEDULE_SEED });
  const result = runBudgetFuzzCase(input, schedule);

  assert.equal(result.caseId, input.id);
  assert.equal(result.incrementalSkipped, true);
  assert.equal(result.skipReason, INCREMENTAL_SKIPPED_BY_DEFAULT);
  assert.ok(result.schedule.length > 0);
  assert.equal(typeof result.baseline.noPath, 'boolean');
});

test('budget fuzz incremental matches sync: procedural map', () => {
  const input = createProceduralBudgetFuzzInput(0xdec0_d002, {
    width: 24,
    height: 20,
    blockDensity: 0.1,
  });
  const schedule = generateBudgetSliceSchedule({ seed: BASELINE_SCHEDULE_SEED });
  runBudgetFuzzCase(input, schedule, { skipIncremental: false });
});

test('runIncrementalWithBudgetSchedule matches sync baseline for open-horizontal', () => {
  const testCase = GOLDEN_PATHFINDING_CASES.find((entry) => entry.id === 'open-horizontal')!;
  const input = budgetFuzzInputFromGoldenCase(testCase);
  const schedule = generateBudgetSliceSchedule({ seed: 1 });
  const baseline = runBudgetFuzzBaseline(input);
  const incremental = runIncrementalWithBudgetSchedule(input, schedule);
  assert.equal(incremental.noPath, baseline.noPath);
  assert.deepEqual(incremental.rawPath, baseline.rawPath);
});

test('runBudgetFuzzBaseline matches golden runner for fixture inputs', () => {
  const testCase = GOLDEN_PATHFINDING_CASES.find((entry) => entry.id === 'open-horizontal')!;
  const input = budgetFuzzInputFromGoldenCase(testCase);
  const baseline = runBudgetFuzzBaseline(input);

  assert.equal(baseline.noPath, false);
  assert.deepEqual(baseline.rawPath, testCase.expectedRawPath);
});
