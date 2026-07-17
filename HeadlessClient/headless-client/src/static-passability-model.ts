/**
 * Shared static passability contract for Commit 4 (HiveManager pathfinder refactor).
 *
 * Step 4.1: types only. Implementation lands in 4.2; A* and dodge migration in 4.3/4.4.
 *
 * Scope: terrain, occupySquare/fullOccupy objects, learned blocks, map bounds.
 * Out of scope: combat enemy exclusion zones, damaging-floor cost (dodge safeWalk is a
 * query flag here), projectile segment cover (DodgeCollisionWorld.isProjectilePathOpen).
 */

/** Integer tile coordinates on the map grid. */
export interface GridTile {
  x: number;
  y: number;
}

/** Fractional world position used by dodge sub-tile occupancy checks. */
export interface WorldPoint {
  x: number;
  y: number;
}

/**
 * Subsystems that currently disagree on unresolved-tile and damage handling.
 * Full dual-predicate wiring is Commit 4.5; the discriminator is scaffolded here.
 */
export type StaticPassabilityConsumer = 'pathfinding' | 'dodge';

/** Tile/object definition hooks shared by pathfinding and dodge data providers. */
export interface StaticPassabilityDataProvider {
  tileIsBlockingWalk?(tileType: number): boolean;
  getTileDamage?(tileType: number): number | undefined;
  getObject?(objectType: number): StaticObjectPassabilityProfile | undefined;
}

/** Object flags that affect static geometry (not enemy proximity). */
export interface StaticObjectPassabilityProfile {
  occupySquare: boolean;
  fullOccupy?: boolean;
  enemyOccupySquare?: boolean;
}

/** Options for integer-tile static blockage queries (A* grid, segment tracing). */
export interface StaticTileQuery {
  /**
   * Which consumer rules apply for unknown tiles and damaging floors.
   * - pathfinding: unobserved tiles are walkable; damaging floors always block.
   * - dodge: unobserved tiles block unless explorativeUnknown; damaging floors
   *   block only when safeWalk is false.
   */
  consumer: StaticPassabilityConsumer;
  /** When set, that tile is treated as open (start-cell exemption). */
  exemptTile?: GridTile;
  /** Dodge consumer only. When true, damaging floor tiles remain occupiable. */
  safeWalk?: boolean;
}

/** Options for fractional-position occupancy (dodge planner / local snapshots). */
export interface StaticOccupancyQuery extends StaticTileQuery {
  /**
   * When true (default for dodge), reject positions whose neighboring tiles contain
   * a fullOccupy object. Pathfinding uses integer tiles and does not need this.
   */
  checkFullOccupyNeighbors?: boolean;
}

/**
 * Read-only static passability view.
 *
 * Current-function mapping (pre-extraction):
 *
 * | Planned method              | Current source                                      |
 * |-----------------------------|-----------------------------------------------------|
 * | getRevision()               | ExplorativePathfinder.getMapVersion()               |
 * |                             | DodgeCollisionWorld staticRevision (internal)       |
 * | getWidth()/getHeight()      | ExplorativePathfinder/DodgeCollisionWorld bounds    |
 * | inBounds()                  | ExplorativePathfinder.inBounds()                    |
 * |                             | DodgeCollisionWorld.inBounds()                      |
 * | isTileStaticallyBlocked()   | ExplorativePathfinder.isBlocked()                   |
 * |                             | (combat layer stays in pathfinder via isPathBlocked)|
 * | canOccupyAt()               | DodgeCollisionWorld.canOccupyStatic()               |
 * |                             | (enemy layer stays via canOccupy + enemyClearance)  |
 *
 * A* PathSearch and traceSegment call sites that use isPathBlocked today will keep
 * combat exclusions outside this model; only the isBlocked portion moves here.
 */
export interface StaticPassabilityModel {
  /**
   * Monotonic revision bumped by map reset, bounds, terrain, objects, learned blocks,
   * and explorativeUnknown toggles. Wired to PathSearch mapVersion today.
   */
  getRevision(): number;

  getWidth(): number;
  getHeight(): number;

  /** True when tile coordinates lie inside current map bounds. */
  inBounds(tileX: number, tileY: number): boolean;

  /**
   * Integer-tile static blockage: terrain, learned blocks, occupySquare objects.
   * Does not apply combat enemy exclusion (ExplorativePathfinder.isPathBlocked delta).
   */
  isTileStaticallyBlocked(tileX: number, tileY: number, query: StaticTileQuery): boolean;

  /**
   * Fractional-position static occupancy including fullOccupy neighbor checks.
   * Does not apply enemy clearance (DodgeCollisionWorld.canOccupy delta).
   */
  canOccupyAt(x: number, y: number, query: StaticOccupancyQuery): boolean;

  /**
   * Whether unobserved in-bounds tiles are treated as walkable.
   * Pathfinding always behaves as true; dodge toggles via setExplorativeUnknown.
   */
  isExplorativeUnknown(): boolean;

  /** Observed tile type at integer coordinates; undefined when never observed. */
  getObservedTileType(tileX: number, tileY: number): number | undefined;

  /** True when an occupySquare object sits on the integer tile. */
  hasOccupySquareAt(tileX: number, tileY: number): boolean;
}

/**
 * Incremental updates feeding the shared static model (Commit 4.2).
 *
 * Current-function mapping:
 *
 * | Planned method           | Current source                                   |
 * |--------------------------|--------------------------------------------------|
 * | reset()                  | ExplorativePathfinder.resetMap()                 |
 * |                          | DodgeCollisionWorld.reset() (static portion)     |
 * | setMapBounds()           | setMapBounds on both consumers                   |
 * | observeTile()            | observeTile on both consumers                    |
 * | markLearnedBlocked()     | ExplorativePathfinder.reportStall() cell learn   |
 * |                          | DodgeCollisionWorld.markBlocked()                |
 * | setExplorativeUnknown()  | DodgeCollisionWorld.setExplorativeUnknown()      |
 * | upsertObject()           | upsertObject object-block counts on both         |
 * | removeObject()           | removeObject on both                             |
 */
export interface StaticPassabilityMutator {
  reset(): void;
  setMapBounds(width: number, height: number): void;
  observeTile(x: number, y: number, tileType: number): void;
  /** Returns true when the learned block was newly recorded. */
  markLearnedBlocked(tileX: number, tileY: number): boolean;
  setExplorativeUnknown(enabled: boolean): void;
  upsertObject(
    objectId: number,
    objectType: number,
    x: number,
    y: number,
    profile: StaticObjectPassabilityProfile,
  ): void;
  removeObject(objectId: number): void;
}

/** Full shared model: queries plus incremental maintenance. */
export interface StaticPassabilityStore
  extends StaticPassabilityModel,
    StaticPassabilityMutator,
    StaticPassabilityDualPredicates,
    StaticOccupancyDualPredicates {}

/**
 * TEMPORARY SCAFFOLDING FOR COMMIT 5 — to be deleted.
 *
 * Side-by-side integer-tile predicates where A* and dodge still disagree.
 * Production call sites keep using isTileStaticallyBlocked(query); these exist
 * only for comparison, tests, and the Commit 5 unification work.
 *
 * Known disagreements:
 * - Unknown tiles: pathfinding walkable, dodge blocked unless explorativeUnknown.
 * - Damaging floors: pathfinding always blocks; dodge blocks only when safeWalk.
 * - Start-cell exemption: caller passes exemptTile on both sides.
 */
export interface StaticPassabilityDualPredicates {
  isTileBlockedForPathfinding(tileX: number, tileY: number, exemptTile?: GridTile): boolean;
  isTileBlockedForDodge(
    tileX: number,
    tileY: number,
    options?: Pick<StaticTileQuery, 'exemptTile' | 'safeWalk'>,
  ): boolean;
}

/**
 * TEMPORARY SCAFFOLDING FOR COMMIT 5 — to be deleted.
 *
 * Side-by-side fractional-position occupancy predicates. Pathfinding uses integer
 * tiles only; dodge adds fullOccupy neighbor checks at sub-tile positions.
 */
export interface StaticOccupancyDualPredicates {
  canOccupyForPathfindingAt(x: number, y: number, exemptTile?: GridTile): boolean;
  canOccupyForDodgeAt(
    x: number,
    y: number,
    options?: Pick<StaticOccupancyQuery, 'exemptTile' | 'safeWalk'>,
  ): boolean;
}
