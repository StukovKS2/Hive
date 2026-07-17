import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENEMY_AVOID_RADIUS } from '../src/dodge-collision-world';
import { GOLDEN_PATHFINDING_CASES } from './fixtures/golden-pathfinding-cases';
import { runGoldenPathfindingCase } from './helpers/golden-pathfinding-runner';
import { createPathfinderFromFixture } from './helpers/pathfinding-map-generator';

for (const testCase of GOLDEN_PATHFINDING_CASES) {
  test(`golden aStar path: ${testCase.id} (${testCase.specialCase})`, () => {
    const result = runGoldenPathfindingCase(testCase);

    if (testCase.expectedNoPath) {
      assert.equal(result.noPath, true, `${testCase.id} should report no path`);
      return;
    }

    assert.equal(result.noPath, false, `${testCase.id} should find a path`);
    assert.equal(result.replanned, true, `${testCase.id} should replan on first next()`);
    assert.deepEqual(
      result.rawPath,
      testCase.expectedRawPath,
      `${testCase.id} raw A* tile path must match the checked-in fixture`,
    );
  });
}

test('golden learned-blocked records the stalled vector cell', () => {
  const testCase = GOLDEN_PATHFINDING_CASES.find((entry) => entry.id === 'learned-blocked-cell')!;
  const pathfinder = createPathfinderFromFixture(testCase.fixture);
  pathfinder.setTarget(testCase.fixture.goal, 0.2);
  pathfinder.next(testCase.fixture.start);

  assert.deepEqual(pathfinder.reportStall(testCase.fixture.start), { x: 1, y: 2 });
});

test('golden corner-cutting fixture never diagonally cuts blocked corners', () => {
  const testCase = GOLDEN_PATHFINDING_CASES.find((entry) => entry.id === 'corner-cutting-prevention')!;
  const pathfinder = createPathfinderFromFixture(testCase.fixture);
  pathfinder.setTarget(testCase.fixture.goal, 0.2);
  pathfinder.next(testCase.fixture.start);

  const blocked = new Set(testCase.fixture.tiles.map((tile) => `${tile.x},${tile.y}`));
  let previous = {
    x: Math.floor(testCase.fixture.start.x),
    y: Math.floor(testCase.fixture.start.y),
  };
  for (const tile of pathfinder.getPlannedTiles()) {
    const dx = tile.x - previous.x;
    const dy = tile.y - previous.y;
    if (dx !== 0 && dy !== 0) {
      assert.equal(blocked.has(`${previous.x + dx},${previous.y}`), false);
      assert.equal(blocked.has(`${previous.x},${previous.y + dy}`), false);
    }
    previous = tile;
  }
});

test('golden combat retreat increases distance from the exclusion center', () => {
  const testCase = GOLDEN_PATHFINDING_CASES.find((entry) => entry.id === 'combat-retreat-exclusion')!;
  const pathfinder = createPathfinderFromFixture(testCase.fixture);
  const combat = testCase.combat!;
  pathfinder.setCombatTarget(combat.target, combat.range, combat.primaryEnemyId);
  pathfinder.next(testCase.fixture.start);

  const startDistance = distance(testCase.fixture.start, combat.target);
  let previousDistance = startDistance;
  for (const tile of pathfinder.getPlannedTiles()) {
    const tileDistance = distance(tileCenter(tile), combat.target);
    assert.ok(tileDistance > previousDistance);
    previousDistance = tileDistance;
  }
  assert.ok(previousDistance >= combat.range.minimumDistance);
});

test('golden combat enemy avoidance keeps tiles outside ENEMY_AVOID_RADIUS', () => {
  const testCase = GOLDEN_PATHFINDING_CASES.find((entry) => entry.id === 'combat-enemy-avoid-radius')!;
  const pathfinder = createPathfinderFromFixture(testCase.fixture);
  const combat = testCase.combat!;
  pathfinder.setCombatTarget(combat.target, combat.range, combat.primaryEnemyId);
  pathfinder.next(testCase.fixture.start);

  const blockingEnemy = testCase.fixture.objects.find((object) => object.id === 71)!;
  for (const tile of pathfinder.getPlannedTiles()) {
    assert.ok(distance(tileCenter(tile), blockingEnemy) >= ENEMY_AVOID_RADIUS - 1e-9);
  }
});

test('golden blocked-goal nearby fallback stops one tile away from the blocked destination', () => {
  const testCase = GOLDEN_PATHFINDING_CASES.find((entry) => entry.id === 'blocked-goal-nearby-fallback')!;
  const pathfinder = createPathfinderFromFixture(testCase.fixture);
  pathfinder.setTarget(testCase.fixture.goal, 0.2);
  pathfinder.next(testCase.fixture.start);

  assert.deepEqual(pathfinder.getPlannedTiles(), testCase.expectedRawPath);
  const endpoint = pathfinder.getRemainingPath().at(-1)!;
  assert.equal(
    Math.max(
      Math.abs(endpoint.x - testCase.fixture.goal.x),
      Math.abs(endpoint.y - testCase.fixture.goal.y),
    ),
    1,
  );
});

test('golden unknown cells match the fully observed open-map route', () => {
  const unknown = GOLDEN_PATHFINDING_CASES.find((entry) => entry.id === 'unknown-cells-traversable')!;
  const open = GOLDEN_PATHFINDING_CASES.find((entry) => entry.id === 'open-horizontal')!;
  assert.deepEqual(
    runGoldenPathfindingCase(unknown).rawPath,
    runGoldenPathfindingCase(open).rawPath,
  );
});

test('golden start-tile exemption allows planning from blocked start cells', () => {
  for (const id of ['start-tile-exempt-object', 'start-tile-exempt-terrain'] as const) {
    const testCase = GOLDEN_PATHFINDING_CASES.find((entry) => entry.id === id)!;
    const pathfinder = createPathfinderFromFixture(testCase.fixture);
    pathfinder.setTarget(testCase.fixture.goal, 0.2);
    const step = pathfinder.next(testCase.fixture.start);
    assert.equal(step.noPath, undefined);
    assert.ok(pathfinder.getPlannedTiles().length > 0);
  }
});

function tileCenter(tile: { x: number; y: number }): { x: number; y: number } {
  return { x: tile.x + 0.5, y: tile.y + 0.5 };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
