import {
  ExplorativePathfinder,
  PathfindingDataProvider,
} from '../../src/explorative-pathfinder';

export const PATHFINDING_MAP_TERRAIN = {
  WALKABLE: 0,
  BLOCKING: 9,
  DAMAGING: 10,
} as const;

export const PATHFINDING_MAP_OBJECTS = {
  BLOCKING: 100,
  NON_BLOCKING_ENEMY: 101,
} as const;

export const UNREACHABLE_POCKET_512_SEED = 0x512_0001;

export interface PathfindingMapTile {
  x: number;
  y: number;
  type: number;
}

export interface PathfindingMapObject {
  id: number;
  type: number;
  x: number;
  y: number;
}

export interface PathfindingMapFixture {
  seed: number;
  width: number;
  height: number;
  start: { x: number; y: number };
  goal: { x: number; y: number };
  /** Sparse tiles. Unlisted cells are walkable. */
  tiles: PathfindingMapTile[];
  objects: PathfindingMapObject[];
  scenario?: string;
}

export interface GeneratePathfindingMapOptions {
  seed: number;
  width: number;
  height: number;
  blockDensity?: number;
  damagingDensity?: number;
  objectDensity?: number;
  start?: { x: number; y: number };
  goal?: { x: number; y: number };
}

export function createPathfindingTestData(): PathfindingDataProvider {
  return {
    getObject: (type) => type === PATHFINDING_MAP_OBJECTS.BLOCKING
      ? { occupySquare: true }
      : type === PATHFINDING_MAP_OBJECTS.NON_BLOCKING_ENEMY
        ? { occupySquare: false, isEnemy: true, hasProjectiles: true }
        : undefined,
    tileIsBlockingWalk: (type) => type === PATHFINDING_MAP_TERRAIN.BLOCKING,
    getTileDamage: (type) => type === PATHFINDING_MAP_TERRAIN.DAMAGING ? 100 : undefined,
  };
}

export function generatePathfindingMap(options: GeneratePathfindingMapOptions): PathfindingMapFixture {
  const {
    seed,
    width,
    height,
    blockDensity = 0.15,
    damagingDensity = 0,
    objectDensity = 0,
  } = options;
  const rng = mulberry32(seed);
  const tiles: PathfindingMapTile[] = [];
  const objects: PathfindingMapObject[] = [];
  const start = options.start ?? { x: 0.5, y: 0.5 };
  const goal = options.goal ?? { x: width - 1.5, y: height - 1.5 };
  const startTile = tileCoord(start);
  const goalTile = tileCoord(goal);
  let nextObjectId = 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((x === startTile.x && y === startTile.y) || (x === goalTile.x && y === goalTile.y)) {
        continue;
      }
      const blockRoll = rng();
      if (blockRoll < blockDensity) {
        tiles.push({ x, y, type: PATHFINDING_MAP_TERRAIN.BLOCKING });
        continue;
      }
      if (damagingDensity > 0 && rng() < damagingDensity) {
        tiles.push({ x, y, type: PATHFINDING_MAP_TERRAIN.DAMAGING });
        continue;
      }
      if (objectDensity > 0 && rng() < objectDensity) {
        objects.push({
          id: nextObjectId++,
          type: PATHFINDING_MAP_OBJECTS.BLOCKING,
          x: x + 0.5,
          y: y + 0.5,
        });
      }
    }
  }

  return {
    seed,
    width,
    height,
    start,
    goal,
    tiles,
    objects,
  };
}

/**
 * Large open map with a goal sealed inside a one-cell pocket.
 * Reproduces the 512×512 unreachable search that floods the whole component.
 */
export function createUnreachablePocket512Fixture(): PathfindingMapFixture {
  const width = 512;
  const height = 512;
  const pocket = { x: 400, y: 400 };
  const tiles: PathfindingMapTile[] = [];

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      tiles.push({
        x: pocket.x + dx,
        y: pocket.y + dy,
        type: PATHFINDING_MAP_TERRAIN.BLOCKING,
      });
    }
  }

  return {
    seed: UNREACHABLE_POCKET_512_SEED,
    width,
    height,
    start: { x: 0.5, y: 0.5 },
    goal: { x: pocket.x + 0.5, y: pocket.y + 0.5 },
    tiles,
    objects: [],
    scenario: 'unreachable-pocket-512',
  };
}

export function createPathfinderFromFixture(
  fixture: PathfindingMapFixture,
  data: PathfindingDataProvider = createPathfindingTestData(),
): ExplorativePathfinder {
  const pathfinder = new ExplorativePathfinder(data);
  applyPathfindingMapFixture(pathfinder, fixture);
  return pathfinder;
}

export function applyPathfindingMapFixture(
  pathfinder: ExplorativePathfinder,
  fixture: PathfindingMapFixture,
): void {
  pathfinder.setMapBounds(fixture.width, fixture.height);
  for (const tile of fixture.tiles) {
    pathfinder.observeTile(tile.x, tile.y, tile.type);
  }
  for (const object of fixture.objects) {
    pathfinder.upsertObject(object.id, object.type, object.x, object.y);
  }
}

export function fixtureTileType(fixture: PathfindingMapFixture, x: number, y: number): number {
  return fixture.tiles.find((tile) => tile.x === x && tile.y === y)?.type
    ?? PATHFINDING_MAP_TERRAIN.WALKABLE;
}

export function serializePathfindingMapFixture(fixture: PathfindingMapFixture): string {
  const tiles = [...fixture.tiles]
    .sort((left, right) => left.y - right.y || left.x - right.x || left.type - right.type)
    .map((tile) => `${tile.x},${tile.y}:${tile.type}`);
  const objects = [...fixture.objects]
    .sort((left, right) => left.id - right.id)
    .map((object) => `${object.id}@${object.x},${object.y}:${object.type}`);
  return [
    fixture.scenario ?? 'generated',
    fixture.seed,
    `${fixture.width}x${fixture.height}`,
    `start=${fixture.start.x},${fixture.start.y}`,
    `goal=${fixture.goal.x},${fixture.goal.y}`,
    `tiles=${tiles.join('|')}`,
    `objects=${objects.join('|')}`,
  ].join(';');
}

function tileCoord(point: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.floor(point.x), y: Math.floor(point.y) };
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
