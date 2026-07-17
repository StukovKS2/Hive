import type { CombatPathfindingRange } from '../../src/explorative-pathfinder';
import {
  PATHFINDING_MAP_OBJECTS,
  PATHFINDING_MAP_TERRAIN,
  type PathfindingMapFixture,
} from '../helpers/pathfinding-map-generator';

export interface GridPoint {
  x: number;
  y: number;
}

export interface GoldenPathfindingCase {
  id: string;
  /** Which aStar/isBlocked special case this locks in. */
  specialCase: string;
  fixture: PathfindingMapFixture;
  /** Raw tile path from aStar via getPlannedTiles(). */
  expectedRawPath: GridPoint[];
  expectedNoPath?: boolean;
  mode?: 'combat';
  combat?: {
    target: { x: number; y: number };
    range: CombatPathfindingRange;
    primaryEnemyId: number;
  };
  /** Runs after fixture load and before next(). */
  setup?: 'learned-blocked-at-start';
}

const BLOCKING = PATHFINDING_MAP_TERRAIN.BLOCKING;
const DAMAGING = PATHFINDING_MAP_TERRAIN.DAMAGING;
const BLOCKING_OBJECT = PATHFINDING_MAP_OBJECTS.BLOCKING;
const NON_BLOCKING_ENEMY = PATHFINDING_MAP_OBJECTS.NON_BLOCKING_ENEMY;
const INVALID_TILE = 0xffff;

export const GOLDEN_PATHFINDING_CASES: GoldenPathfindingCase[] = [
  {
    id: 'open-horizontal',
    specialCase: 'baseline open map',
    fixture: {
      seed: 0,
      width: 12,
      height: 5,
      start: { x: 0.5, y: 2.5 },
      goal: { x: 8.5, y: 2.5 },
      tiles: [],
      objects: [],
      scenario: 'open-horizontal',
    },
    expectedRawPath: [
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
      { x: 6, y: 2 },
      { x: 7, y: 2 },
      { x: 8, y: 2 },
    ],
  },
  {
    id: 'unknown-cells-traversable',
    specialCase: 'unknown/unobserved cells are not blocked (explorative)',
    fixture: {
      seed: 0,
      width: 12,
      height: 5,
      start: { x: 0.5, y: 2.5 },
      goal: { x: 8.5, y: 2.5 },
      tiles: [
        { x: 0, y: 2, type: 0 },
        { x: 8, y: 2, type: 0 },
      ],
      objects: [],
      scenario: 'unknown-cells-traversable',
    },
    expectedRawPath: [
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
      { x: 6, y: 2 },
      { x: 7, y: 2 },
      { x: 8, y: 2 },
    ],
  },
  {
    id: 'blocking-terrain-column',
    specialCase: 'blocking terrain via tileIsBlockingWalk',
    fixture: {
      seed: 0,
      width: 8,
      height: 8,
      start: { x: 1.5, y: 1.5 },
      goal: { x: 6.5, y: 1.5 },
      tiles: Array.from({ length: 5 }, (_, y) => ({ x: 3, y, type: BLOCKING })),
      objects: [],
      scenario: 'blocking-terrain-column',
    },
    expectedRawPath: [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 2, y: 4 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 3 },
      { x: 6, y: 2 },
      { x: 6, y: 1 },
    ],
  },
  {
    id: 'invalid-tile-type',
    specialCase: 'invalid tile 0xffff blocks traversal',
    fixture: {
      seed: 0,
      width: 10,
      height: 5,
      start: { x: 1.5, y: 2.5 },
      goal: { x: 8.5, y: 2.5 },
      tiles: [{ x: 4, y: 2, type: INVALID_TILE }],
      objects: [],
      scenario: 'invalid-tile-type',
    },
    expectedRawPath: [
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 5, y: 3 },
      { x: 6, y: 2 },
      { x: 7, y: 2 },
      { x: 8, y: 2 },
    ],
  },
  {
    id: 'damaging-terrain',
    specialCase: 'damaging terrain blocks traversal',
    fixture: {
      seed: 0,
      width: 10,
      height: 5,
      start: { x: 1.5, y: 2.5 },
      goal: { x: 8.5, y: 2.5 },
      tiles: [{ x: 4, y: 2, type: DAMAGING }],
      objects: [],
      scenario: 'damaging-terrain',
    },
    expectedRawPath: [
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 5, y: 3 },
      { x: 6, y: 2 },
      { x: 7, y: 2 },
      { x: 8, y: 2 },
    ],
  },
  {
    id: 'corner-cutting-prevention',
    specialCase: 'diagonal corner-cutting prevention',
    fixture: {
      seed: 0,
      width: 8,
      height: 8,
      start: { x: 1.5, y: 1.5 },
      goal: { x: 6.5, y: 1.5 },
      tiles: Array.from({ length: 5 }, (_, y) => ({ x: 3, y, type: BLOCKING })),
      objects: [],
      scenario: 'corner-cutting-prevention',
    },
    expectedRawPath: [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 2, y: 4 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 3 },
      { x: 6, y: 2 },
      { x: 6, y: 1 },
    ],
  },
  {
    id: 'occupy-square-object',
    specialCase: 'OccupySquare objects via objectBlockCounts',
    fixture: {
      seed: 0,
      width: 10,
      height: 5,
      start: { x: 1.5, y: 2.5 },
      goal: { x: 8.5, y: 2.5 },
      tiles: [],
      objects: [{ id: 50, type: BLOCKING_OBJECT, x: 3.5, y: 2.5 }],
      scenario: 'occupy-square-object',
    },
    expectedRawPath: [
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 5, y: 2 },
      { x: 6, y: 2 },
      { x: 7, y: 2 },
      { x: 8, y: 2 },
    ],
  },
  {
    id: 'start-tile-exempt-object',
    specialCase: 'start tile exempt from OccupySquare blocking',
    fixture: {
      seed: 0,
      width: 10,
      height: 10,
      start: { x: 3.5, y: 3.5 },
      goal: { x: 8.5, y: 3.5 },
      tiles: [],
      objects: [{ id: 50, type: BLOCKING_OBJECT, x: 3.5, y: 3.5 }],
      scenario: 'start-tile-exempt-object',
    },
    expectedRawPath: [
      { x: 4, y: 3 },
      { x: 5, y: 3 },
      { x: 6, y: 3 },
      { x: 7, y: 3 },
      { x: 8, y: 3 },
    ],
  },
  {
    id: 'start-tile-exempt-terrain',
    specialCase: 'start tile exempt from blocking terrain',
    fixture: {
      seed: 0,
      width: 10,
      height: 10,
      start: { x: 3.5, y: 3.5 },
      goal: { x: 8.5, y: 3.5 },
      tiles: [{ x: 3, y: 3, type: BLOCKING }],
      objects: [],
      scenario: 'start-tile-exempt-terrain',
    },
    expectedRawPath: [
      { x: 4, y: 3 },
      { x: 5, y: 3 },
      { x: 6, y: 3 },
      { x: 7, y: 3 },
      { x: 8, y: 3 },
    ],
  },
  {
    id: 'learned-blocked-cell',
    specialCase: 'learned blocked cells after stall learning',
    fixture: {
      seed: 0,
      width: 12,
      height: 5,
      start: { x: 0.5, y: 2.5 },
      goal: { x: 8.5, y: 2.5 },
      tiles: [],
      objects: [],
      scenario: 'learned-blocked-cell',
    },
    setup: 'learned-blocked-at-start',
    expectedRawPath: [
      { x: 0, y: 3 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
      { x: 6, y: 2 },
      { x: 7, y: 2 },
      { x: 8, y: 2 },
    ],
  },
  {
    id: 'blocked-goal-nearby-fallback',
    specialCase: 'multi-goal nearbyGoals fallback for blocked destination',
    fixture: {
      seed: 0,
      width: 10,
      height: 10,
      start: { x: 1.5, y: 5.5 },
      goal: { x: 5.5, y: 5.5 },
      tiles: [],
      objects: [{ id: 50, type: BLOCKING_OBJECT, x: 5.5, y: 5.5 }],
      scenario: 'blocked-goal-nearby-fallback',
    },
    expectedRawPath: [
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
    ],
  },
  {
    id: 'tie-break-east-before-north',
    specialCase: 'A* tie-breaking: f, then h, then expansion order',
    fixture: {
      seed: 0,
      width: 6,
      height: 6,
      start: { x: 0.5, y: 0.5 },
      goal: { x: 3.5, y: 3.5 },
      tiles: [{ x: 1, y: 1, type: BLOCKING }],
      objects: [],
      scenario: 'tie-break-east-before-north',
    },
    expectedRawPath: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ],
  },
  {
    id: 'combat-retreat-exclusion',
    specialCase: 'combat-range exclusion with violatesExclusion retreat semantics',
    fixture: {
      seed: 0,
      width: 12,
      height: 8,
      start: { x: 5.5, y: 3.5 },
      goal: { x: 6.5, y: 3.5 },
      tiles: [],
      objects: [{ id: 70, type: NON_BLOCKING_ENEMY, x: 6.5, y: 3.5 }],
      scenario: 'combat-retreat-exclusion',
    },
    mode: 'combat',
    combat: {
      target: { x: 6.5, y: 3.5 },
      range: { minimumDistance: 2.5, preferredDistance: 3, maximumDistance: 3.5 },
      primaryEnemyId: 70,
    },
    expectedRawPath: [
      { x: 4, y: 3 },
      { x: 3, y: 3 },
    ],
  },
  {
    id: 'combat-enemy-avoid-radius',
    specialCase: 'ENEMY_AVOID_RADIUS 1.0 enemy exclusion in isPathBlocked',
    fixture: {
      seed: 0,
      width: 16,
      height: 8,
      start: { x: 0.5, y: 3.5 },
      goal: { x: 11.5, y: 3.5 },
      tiles: [],
      objects: [
        { id: 70, type: NON_BLOCKING_ENEMY, x: 11.5, y: 3.5 },
        { id: 71, type: NON_BLOCKING_ENEMY, x: 5.5, y: 3.5 },
      ],
      scenario: 'combat-enemy-avoid-radius',
    },
    mode: 'combat',
    combat: {
      target: { x: 11.5, y: 3.5 },
      range: { minimumDistance: 3.25, preferredDistance: 3.75, maximumDistance: 4.25 },
      primaryEnemyId: 70,
    },
    expectedRawPath: [
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
      { x: 5, y: 4 },
      { x: 6, y: 4 },
      { x: 7, y: 4 },
    ],
  },
];
