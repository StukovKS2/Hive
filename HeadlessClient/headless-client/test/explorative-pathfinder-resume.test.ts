import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExplorativePathfinder } from '../src/explorative-pathfinder';

const BLOCKING_GROUND = 9;

function createPathfinder(width: number, height: number): ExplorativePathfinder {
  const pathfinder = new ExplorativePathfinder({
    getObject: () => undefined,
    tileIsBlockingWalk: (type) => type === BLOCKING_GROUND,
  });
  pathfinder.setMapBounds(width, height);
  return pathfinder;
}

function activeExpansionCount(pathfinder: ExplorativePathfinder): number {
  const active = (pathfinder as unknown as {
    activePathSearch?: { search: { getExpansionCount(): number } };
  }).activePathSearch;
  return active?.search.getExpansionCount() ?? 0;
}

test('beginPathSearch resumes when goal and mapVersion are unchanged', () => {
  const pathfinder = createPathfinder(20, 20);
  const start = { x: 0, y: 0 };
  const goal = { x: 12, y: 0 };
  const budget = { maxNodes: 4, maxMs: Number.POSITIVE_INFINITY };

  const first = pathfinder.beginPathSearch(start, [goal]);
  assert.equal(first.step(budget), 'searching');
  const afterFirstSlice = activeExpansionCount(pathfinder);
  assert.ok(afterFirstSlice >= 4);

  const resumed = pathfinder.beginPathSearch(start, [goal]);
  assert.equal(resumed.step(budget), 'searching');
  assert.ok(activeExpansionCount(pathfinder) > afterFirstSlice);

  while (resumed.status() === 'searching') {
    resumed.step({ maxNodes: Number.POSITIVE_INFINITY, maxMs: Number.POSITIVE_INFINITY });
  }
  assert.equal(resumed.status(), 'found');
  assert.deepEqual(resumed.getPath()?.at(-1), goal);
});

test('beginPathSearch restarts when mapVersion changes', () => {
  const pathfinder = createPathfinder(20, 20);
  const start = { x: 0, y: 0 };
  const goal = { x: 12, y: 0 };
  const budget = { maxNodes: 6, maxMs: Number.POSITIVE_INFINITY };

  const first = pathfinder.beginPathSearch(start, [goal]);
  assert.equal(first.step(budget), 'searching');
  assert.ok(activeExpansionCount(pathfinder) >= 6);

  pathfinder.observeTile(4, 0, BLOCKING_GROUND);

  const restarted = pathfinder.beginPathSearch(start, [goal]);
  assert.equal(restarted.step({ maxNodes: 1, maxMs: Number.POSITIVE_INFINITY }), 'searching');
  assert.equal(activeExpansionCount(pathfinder), 1);
});

test('beginPathSearch restarts when goals change', () => {
  const pathfinder = createPathfinder(20, 20);
  const start = { x: 0, y: 0 };
  const budget = { maxNodes: 5, maxMs: Number.POSITIVE_INFINITY };

  const first = pathfinder.beginPathSearch(start, [{ x: 10, y: 0 }]);
  assert.equal(first.step(budget), 'searching');
  assert.ok(activeExpansionCount(pathfinder) >= 5);

  const restarted = pathfinder.beginPathSearch(start, [{ x: 11, y: 0 }]);
  assert.equal(restarted.step({ maxNodes: 1, maxMs: Number.POSITIVE_INFINITY }), 'searching');
  assert.equal(activeExpansionCount(pathfinder), 1);
});

test('cancelPathSearch drops in-flight state so the next search starts fresh', () => {
  const pathfinder = createPathfinder(20, 20);
  const start = { x: 0, y: 0 };
  const goal = { x: 8, y: 0 };
  const budget = { maxNodes: 5, maxMs: Number.POSITIVE_INFINITY };

  const handle = pathfinder.beginPathSearch(start, [goal]);
  assert.equal(handle.step(budget), 'searching');
  assert.ok(activeExpansionCount(pathfinder) >= 5);

  handle.cancel();
  assert.equal(activeExpansionCount(pathfinder), 0);

  const fresh = pathfinder.beginPathSearch(start, [goal]);
  assert.equal(fresh.step({ maxNodes: 1, maxMs: Number.POSITIVE_INFINITY }), 'searching');
  assert.equal(activeExpansionCount(pathfinder), 1);
});
