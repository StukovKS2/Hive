import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyPathfindingMapFixture,
  createPathfinderFromFixture,
  createPathfindingTestData,
  createUnreachablePocket512Fixture,
  fixtureTileType,
  generatePathfindingMap,
  PATHFINDING_MAP_TERRAIN,
  serializePathfindingMapFixture,
  UNREACHABLE_POCKET_512_SEED,
} from './helpers/pathfinding-map-generator';
import { ExplorativePathfinder } from '../src/explorative-pathfinder';

test('generatePathfindingMap is deterministic for the same seed', () => {
  const options = {
    seed: 0xdecaf_bad,
    width: 32,
    height: 24,
    blockDensity: 0.2,
    damagingDensity: 0.05,
    objectDensity: 0.03,
  };
  const first = generatePathfindingMap(options);
  const second = generatePathfindingMap(options);

  assert.equal(serializePathfindingMapFixture(first), serializePathfindingMapFixture(second));
  assert.notEqual(first.tiles.length, 0);
  assert.ok(first.objects.length > 0);
});

test('generatePathfindingMap changes layout when the seed changes', () => {
  const base = {
    width: 32,
    height: 24,
    blockDensity: 0.2,
  };
  const left = generatePathfindingMap({ ...base, seed: 1 });
  const right = generatePathfindingMap({ ...base, seed: 2 });

  assert.notEqual(
    serializePathfindingMapFixture(left),
    serializePathfindingMapFixture(right),
  );
});

test('applyPathfindingMapFixture configures bounds, terrain, and objects', () => {
  const fixture = generatePathfindingMap({
    seed: 42,
    width: 12,
    height: 8,
    blockDensity: 0.25,
    objectDensity: 0.1,
  });
  const pathfinder = new ExplorativePathfinder(createPathfindingTestData());
  applyPathfindingMapFixture(pathfinder, fixture);

  assert.equal(pathfinder.setTarget(fixture.goal, 0.2), true);
  const step = pathfinder.next(fixture.start);
  assert.notDeepEqual(step, {}, 'configured bounds must allow navigation to run');
  assert.equal(
    fixtureTileType(fixture, 0, 0),
    PATHFINDING_MAP_TERRAIN.WALKABLE,
  );
  assert.ok(fixture.tiles.some((tile) => tile.type === PATHFINDING_MAP_TERRAIN.BLOCKING));
  assert.ok(fixture.objects.length > 0);
});

test('createUnreachablePocket512Fixture is deterministic and sealed', () => {
  const first = createUnreachablePocket512Fixture();
  const second = createUnreachablePocket512Fixture();

  assert.equal(first.seed, UNREACHABLE_POCKET_512_SEED);
  assert.equal(first.width, 512);
  assert.equal(first.height, 512);
  assert.equal(first.scenario, 'unreachable-pocket-512');
  assert.equal(serializePathfindingMapFixture(first), serializePathfindingMapFixture(second));
  assert.equal(first.tiles.length, 8);

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      assert.equal(
        fixtureTileType(first, 400 + dx, 400 + dy),
        PATHFINDING_MAP_TERRAIN.BLOCKING,
      );
    }
  }
  assert.equal(fixtureTileType(first, 400, 400), PATHFINDING_MAP_TERRAIN.WALKABLE);
});

test('512×512 unreachable pocket reports no path after the search completes', () => {
  const fixture = createUnreachablePocket512Fixture();
  const pathfinder = createPathfinderFromFixture(fixture);

  pathfinder.setTarget(fixture.goal, 0.2);
  const result = pathfinder.next(fixture.start);

  assert.equal(result.noPath, true);
  assert.equal(result.replanned, true);
  assert.equal(pathfinder.hasTarget(), true);
});
