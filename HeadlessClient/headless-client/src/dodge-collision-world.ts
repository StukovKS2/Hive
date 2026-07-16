import type { CombatDataProvider, CombatProjectileSnapshot } from './combat-tracker';

interface DodgeObjectRecord {
  key: string;
  x: number;
  y: number;
  occupySquare: boolean;
  fullOccupy: boolean;
  enemyOccupySquare: boolean;
  enemyCandidate: boolean;
}

const INVALID_TILE_TYPE = 0xffff;
/** Hard movement exclusion around confirmed projectile-capable combat enemies, in tiles. */
export const ENEMY_AVOID_RADIUS = 1.3;
/** Outer edge of the nonlinear enemy-proximity cost, in tiles. */
export const ENEMY_SOFT_AVOID_RADIUS = 2.3;
const DISTANCE_EPSILON = 1e-9;
const SNAPSHOT_REUSE_PADDING = 1;

/** Compact collision data sampled from the authoritative dodge world for one local plan. */
export interface LocalDodgeCollisionSnapshot {
  originX: number;
  originY: number;
  resolution: number;
  width: number;
  height: number;
  blocked: Uint8Array;
  damagingFloor: Float32Array;
  enemyDistance: Float32Array;
  revision: number;
}

interface CachedLocalSnapshot {
  centerX: number;
  centerY: number;
  requestedRadius: number;
  staticRevision: number;
  enemyRevision: number;
  snapshot: LocalDodgeCollisionSnapshot;
}

interface EnemyThreatDataProvider {
  getObject(type: number): {
    isEnemy?: boolean;
    hasProjectiles?: boolean;
    subattacks?: ReadonlyArray<{
      patterns: ReadonlyArray<{ projectileId: number }>;
    }>;
  } | undefined;
  getProjectile?(objectType: number, projectileId: number): unknown;
}

/** Distinguishes projectile-capable monsters from inert enemy-tagged map objects. */
export function isEnemyProximityThreat(
  data: EnemyThreatDataProvider,
  objectType: number,
): boolean {
  const definition = data.getObject(objectType);
  if (!definition?.isEnemy) return false;
  if (definition.hasProjectiles !== undefined) return definition.hasProjectiles;
  if (!data.getProjectile) return false;

  const projectileIds = new Set<number>([0]);
  for (const subattack of definition.subattacks ?? []) {
    for (const pattern of subattack.patterns) projectileIds.add(pattern.projectileId);
  }
  for (const projectileId of projectileIds) {
    if (data.getProjectile(objectType, projectileId)) return true;
  }
  return false;
}

/** Incrementally maintained collision view used by predictive auto-dodge. */
export class DodgeCollisionWorld {
  private width = 0;
  private height = 0;
  private explorativeUnknown = false;
  private readonly tiles = new Map<string, number>();
  private readonly learnedBlocked = new Set<string>();
  private readonly objects = new Map<number, DodgeObjectRecord>();
  private readonly occupyCounts = new Map<string, number>();
  private readonly fullOccupyCounts = new Map<string, number>();
  private readonly enemyOccupyCounts = new Map<string, number>();
  private readonly confirmedCombatEnemies = new Set<number>();
  private readonly combatEnemies = new Map<number, { x: number; y: number }>();
  private revision = 0;
  private staticRevision = 0;
  private enemyRevision = 0;
  private cachedSnapshot: CachedLocalSnapshot | undefined;

  constructor(private readonly data: CombatDataProvider) {}

  reset(): void {
    this.width = 0;
    this.height = 0;
    this.explorativeUnknown = false;
    this.tiles.clear();
    this.learnedBlocked.clear();
    this.objects.clear();
    this.occupyCounts.clear();
    this.fullOccupyCounts.clear();
    this.enemyOccupyCounts.clear();
    this.confirmedCombatEnemies.clear();
    this.combatEnemies.clear();
    this.touch(true, true);
  }

  setMapBounds(width: number, height: number): void {
    const nextWidth = Number.isFinite(width) ? Math.max(0, Math.trunc(width)) : 0;
    const nextHeight = Number.isFinite(height) ? Math.max(0, Math.trunc(height)) : 0;
    if (nextWidth === this.width && nextHeight === this.height) return;
    this.width = nextWidth;
    this.height = nextHeight;
    this.touch(true, false);
  }

  observeTile(x: number, y: number, type: number): void {
    const key = tileKey(Math.trunc(x), Math.trunc(y));
    const nextType = Math.trunc(type);
    if (this.tiles.get(key) === nextType) return;
    this.tiles.set(key, nextType);
    this.touch(true, false);
  }

  /** Allows in-bounds, unobserved cells while an exploratory path is active. */
  setExplorativeUnknown(enabled: boolean): void {
    if (this.explorativeUnknown === enabled) return;
    this.explorativeUnknown = enabled;
    this.touch(true, false);
  }

  /** Shares collision cells learned from authoritative pathfinding stalls. */
  markBlocked(x: number, y: number): void {
    const key = tileKey(Math.floor(x), Math.floor(y));
    if (this.learnedBlocked.has(key)) return;
    this.learnedBlocked.add(key);
    this.touch(true, false);
  }

  upsertObject(objectId: number, objectType: number, x: number, y: number): void {
    const previous = this.objects.get(objectId);
    const previousCombat = this.combatEnemies.get(objectId);
    this.removeObjectRecord(objectId, false);
    const definition = this.data.getObject(objectType);
    if (!definition) {
      this.confirmedCombatEnemies.delete(objectId);
      const staticChanged = !!previous && recordAffectsStaticCollision(previous);
      if (staticChanged || previousCombat) this.touch(staticChanged, !!previousCombat);
      return;
    }
    const enemyCandidate = !!definition.isEnemy;
    if (!enemyCandidate) this.confirmedCombatEnemies.delete(objectId);
    const record: DodgeObjectRecord = {
      key: tileKey(Math.floor(x), Math.floor(y)),
      x,
      y,
      occupySquare: !!definition.occupySquare,
      fullOccupy: !!definition.fullOccupy,
      enemyOccupySquare: !!definition.enemyOccupySquare,
      enemyCandidate,
    };
    if (!record.occupySquare && !record.fullOccupy && !record.enemyOccupySquare && !enemyCandidate) {
      const staticChanged = !!previous && recordAffectsStaticCollision(previous);
      if (staticChanged || previousCombat) this.touch(staticChanged, !!previousCombat);
      return;
    }
    this.objects.set(objectId, record);
    if (enemyCandidate && (isEnemyProximityThreat(this.data, objectType)
      || this.confirmedCombatEnemies.has(objectId))) {
      this.combatEnemies.set(objectId, { x, y });
    }
    this.adjust(this.occupyCounts, record.key, record.occupySquare ? 1 : 0);
    this.adjust(this.fullOccupyCounts, record.key, record.fullOccupy ? 1 : 0);
    this.adjust(this.enemyOccupyCounts, record.key, record.enemyOccupySquare ? 1 : 0);
    const nextCombat = this.combatEnemies.get(objectId);
    const staticChanged = staticCollisionChanged(previous, record);
    const enemyChanged = !sameOptionalPosition(previousCombat, nextCombat);
    if (staticChanged || enemyChanged) this.touch(staticChanged, enemyChanged);
  }

  /** Promotes an enemy-tagged object after an authoritative EnemyShoot packet. */
  markEnemyThreat(objectId: number): void {
    const record = this.objects.get(objectId);
    if (!record?.enemyCandidate) return;
    const changed = !this.confirmedCombatEnemies.has(objectId)
      || !this.combatEnemies.has(objectId);
    this.confirmedCombatEnemies.add(objectId);
    this.combatEnemies.set(objectId, { x: record.x, y: record.y });
    if (changed) this.touch(false, true);
  }

  removeObject(objectId: number): void {
    const record = this.objects.get(objectId);
    const combatEnemy = this.combatEnemies.has(objectId);
    const removedRecord = this.removeObjectRecord(objectId, false);
    const removedConfirmation = this.confirmedCombatEnemies.delete(objectId);
    const changed = removedRecord || removedConfirmation;
    if (changed) this.touch(!!record && recordAffectsStaticCollision(record), combatEnemy);
  }

  private removeObjectRecord(objectId: number, notify = true): boolean {
    const record = this.objects.get(objectId);
    if (!record) return false;
    this.objects.delete(objectId);
    this.combatEnemies.delete(objectId);
    this.adjust(this.occupyCounts, record.key, record.occupySquare ? -1 : 0);
    this.adjust(this.fullOccupyCounts, record.key, record.fullOccupy ? -1 : 0);
    this.adjust(this.enemyOccupyCounts, record.key, record.enemyOccupySquare ? -1 : 0);
    if (notify) this.touch(recordAffectsStaticCollision(record), record.enemyCandidate);
    return true;
  }

  canOccupy(x: number, y: number, safeWalk: boolean, avoidEnemies = true): boolean {
    if (!this.canOccupyStatic(x, y, safeWalk)) return false;
    return !avoidEnemies
      || this.enemyClearance(x, y) >= ENEMY_AVOID_RADIUS - DISTANCE_EPSILON;
  }

  /** Monotonic revision for local-snapshot invalidation. */
  getRevision(): number {
    return this.revision;
  }

  /**
   * Samples the incrementally maintained world into numeric arrays. The planner
   * queries these arrays in its hot loop; all source-of-truth decisions remain here.
   */
  createLocalSnapshot(
    center: { x: number; y: number },
    radius: number,
    resolution = 0.1,
  ): LocalDodgeCollisionSnapshot {
    const safeRadius = Number.isFinite(radius) ? Math.max(1, radius) : 1;
    const safeResolution = Number.isFinite(resolution)
      ? Math.min(0.5, Math.max(0.05, resolution))
      : 0.1;
    const cached = this.cachedSnapshot;
    const reusableLayout = !!cached
      && cached.snapshot.resolution === safeResolution
      && cached.requestedRadius >= safeRadius
      && Math.abs(center.x - cached.centerX) <= SNAPSHOT_REUSE_PADDING * 0.5
      && Math.abs(center.y - cached.centerY) <= SNAPSHOT_REUSE_PADDING * 0.5;
    if (reusableLayout
      && cached.staticRevision === this.staticRevision
      && cached.enemyRevision === this.enemyRevision) {
      return cached.snapshot;
    }

    const sampledRadius = safeRadius + SNAPSHOT_REUSE_PADDING;
    const originX = reusableLayout
      ? cached.snapshot.originX
      : Math.floor((center.x - sampledRadius) / safeResolution) * safeResolution;
    const originY = reusableLayout
      ? cached.snapshot.originY
      : Math.floor((center.y - sampledRadius) / safeResolution) * safeResolution;
    const maximumX = Math.ceil((center.x + sampledRadius) / safeResolution) * safeResolution;
    const maximumY = Math.ceil((center.y + sampledRadius) / safeResolution) * safeResolution;
    const width = reusableLayout
      ? cached.snapshot.width
      : Math.max(2, Math.round((maximumX - originX) / safeResolution) + 1);
    const height = reusableLayout
      ? cached.snapshot.height
      : Math.max(2, Math.round((maximumY - originY) / safeResolution) + 1);
    const size = width * height;
    const reuseStatic = reusableLayout && cached.staticRevision === this.staticRevision;
    const blocked = reuseStatic ? cached.snapshot.blocked : new Uint8Array(size);
    const damagingFloor = reuseStatic
      ? cached.snapshot.damagingFloor
      : new Float32Array(size);

    if (!reuseStatic) {
      for (let row = 0; row < height; row++) {
        const y = originY + row * safeResolution;
        for (let column = 0; column < width; column++) {
          const x = originX + column * safeResolution;
          const index = row * width + column;
          blocked[index] = this.canOccupyStatic(x, y, false) ? 0 : 1;
          const type = this.tiles.get(tileKey(Math.floor(x), Math.floor(y)));
          damagingFloor[index] = type === undefined
            ? 0
            : Math.max(0, this.data.getTileDamage?.(type) ?? 0);
        }
      }
    }

    const reuseEnemy = reusableLayout && cached.enemyRevision === this.enemyRevision;
    const enemyDistance = reuseEnemy
      ? cached.snapshot.enemyDistance
      : new Float32Array(size);
    if (!reuseEnemy) {
      const enemies = [...this.combatEnemies.values()];
      if (enemies.length === 0) enemyDistance.fill(Infinity);
      for (let row = 0; row < height && enemies.length > 0; row++) {
        const y = originY + row * safeResolution;
        for (let column = 0; column < width; column++) {
          const x = originX + column * safeResolution;
          const index = row * width + column;
        let nearestSquared = Infinity;
        for (const enemy of enemies) {
          const dx = x - enemy.x;
          const dy = y - enemy.y;
          nearestSquared = Math.min(nearestSquared, dx * dx + dy * dy);
        }
        enemyDistance[index] = Number.isFinite(nearestSquared)
          ? Math.sqrt(nearestSquared)
          : Infinity;
        }
      }
    }

    const snapshot: LocalDodgeCollisionSnapshot = {
      originX,
      originY,
      resolution: safeResolution,
      width,
      height,
      blocked,
      damagingFloor,
      enemyDistance,
      revision: this.revision,
    };
    this.cachedSnapshot = {
      centerX: reusableLayout ? cached.centerX : center.x,
      centerY: reusableLayout ? cached.centerY : center.y,
      requestedRadius: reusableLayout ? cached.requestedRadius : safeRadius,
      staticRevision: this.staticRevision,
      enemyRevision: this.enemyRevision,
      snapshot,
    };
    return snapshot;
  }

  private canOccupyStatic(x: number, y: number, safeWalk: boolean): boolean {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    const key = tileKey(tileX, tileY);
    const type = this.tiles.get(key);
    if (!this.inBounds(tileX, tileY)
      || type === INVALID_TILE_TYPE
      || type === undefined && !this.explorativeUnknown
      || this.learnedBlocked.has(key)
      || type !== undefined && !!this.data.tileIsBlockingWalk?.(type)
      || type !== undefined && safeWalk && (this.data.getTileDamage?.(type) ?? 0) > 0
      || (this.occupyCounts.get(key) ?? 0) > 0) {
      return false;
    }

    const fracX = x - tileX;
    const fracY = y - tileY;
    const minX = fracX < 0.5 ? tileX - 1 : tileX;
    const maxX = fracX > 0.5 ? tileX + 1 : tileX;
    const minY = fracY < 0.5 ? tileY - 1 : tileY;
    const maxY = fracY > 0.5 ? tileY + 1 : tileY;
    for (let neighborX = minX; neighborX <= maxX; neighborX++) {
      for (let neighborY = minY; neighborY <= maxY; neighborY++) {
        if (neighborX === tileX && neighborY === tileY) continue;
        const key = tileKey(neighborX, neighborY);
        const neighborType = this.tiles.get(key);
        if (!this.inBounds(neighborX, neighborY)
          || neighborType === INVALID_TILE_TYPE
          || neighborType === undefined && !this.explorativeUnknown
          || this.learnedBlocked.has(key)
          || (this.fullOccupyCounts.get(key) ?? 0) > 0) {
          return false;
        }
      }
    }
    return true;
  }

  enemyClearance(x: number, y: number): number {
    let clearance = Infinity;
    for (const enemy of this.combatEnemies.values()) {
      const dx = x - enemy.x;
      const dy = y - enemy.y;
      clearance = Math.min(clearance, Math.hypot(dx, dy));
    }
    return clearance;
  }

  isProjectileSegmentOpen(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    projectile: CombatProjectileSnapshot,
  ): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.25));
    for (let step = 1; step <= steps; step++) {
      const ratio = step / steps;
      if (!this.isProjectilePathOpen(fromX + dx * ratio, fromY + dy * ratio, projectile)) {
        return false;
      }
    }
    return true;
  }

  private isProjectilePathOpen(x: number, y: number, projectile: CombatProjectileSnapshot): boolean {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    const key = tileKey(tileX, tileY);
    const type = this.tiles.get(key);
    if (type === undefined || type === INVALID_TILE_TYPE || !this.inBounds(tileX, tileY)) return false;
    if ((this.enemyOccupyCounts.get(key) ?? 0) > 0) return false;
    return projectile.definition.passesCover || (this.occupyCounts.get(key) ?? 0) === 0;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0
      && (this.width === 0 || x < this.width)
      && (this.height === 0 || y < this.height);
  }

  private adjust(counts: Map<string, number>, key: string, delta: number): void {
    if (delta === 0) return;
    const count = (counts.get(key) ?? 0) + delta;
    if (count > 0) counts.set(key, count);
    else counts.delete(key);
  }

  private touch(staticChanged: boolean, enemyChanged: boolean): void {
    if (!staticChanged && !enemyChanged) return;
    this.revision++;
    if (staticChanged) this.staticRevision++;
    if (enemyChanged) this.enemyRevision++;
  }
}

function recordAffectsStaticCollision(record: DodgeObjectRecord): boolean {
  return record.occupySquare || record.fullOccupy || record.enemyOccupySquare;
}

function staticCollisionChanged(
  previous: DodgeObjectRecord | undefined,
  next: DodgeObjectRecord,
): boolean {
  if (!previous) return recordAffectsStaticCollision(next);
  return previous.key !== next.key
      && (recordAffectsStaticCollision(previous) || recordAffectsStaticCollision(next))
    || previous.occupySquare !== next.occupySquare
    || previous.fullOccupy !== next.fullOccupy
    || previous.enemyOccupySquare !== next.enemyOccupySquare;
}

function sameOptionalPosition(
  first: { x: number; y: number } | undefined,
  second: { x: number; y: number } | undefined,
): boolean {
  return !first || !second
    ? first === second
    : first.x === second.x && first.y === second.y;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}
