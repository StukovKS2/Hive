import { EventEmitter } from 'events';
import { Client, ClientEvent, type TrackedObject } from 'headless-client';

import type { GameDataLoader } from '../game-data/GameDataLoader.js';

const HISTORY_CAP = 25;
const MIN_BOSS_HP = 10_000;
const MIN_MINIBOSS_HP = 3_000;

interface DamagePacketLike {
  targetId: number;
  damageAmount: number;
  info: number;
  objectId: number;
}

interface PlayerState {
  objectId: number;
  name: string;
  classType?: number;
  skin?: number;
  tex1?: number;
  tex2?: number;
  damage: number;
  hits: number;
  weaponDamage: number;
  summonDamage: number;
  guardedHits: number;
  guardedDamage: number;
  damageTaken: number;
  hitsTaken: number;
  equipTop: { wpn: number; abl: number; arm: number; rng: number };
}

interface TargetState {
  targetObjectId: number;
  targetType: number;
  targetName: string;
  targetMaxHp: number;
  boss: boolean;
  miniboss: boolean;
  killed: boolean;
  firstHitAt: number;
  lastHitAt: number;
  players: Map<number, PlayerState>;
}

export interface HeadlessDamagePlayer extends Omit<PlayerState, 'equipTop'> {
  pct: string;
  equipTop: PlayerState['equipTop'];
  equipHits: { wpn: number; abl: number; arm: number; rng: number };
}

export interface HeadlessDamageTarget extends Omit<TargetState, 'players'> {
  durationSec: number;
  players: HeadlessDamagePlayer[];
}

export interface HeadlessDamageLive {
  mapName: string;
  startTime: number;
  now: number;
  localPlayerId: number | null;
  targets: HeadlessDamageTarget[];
}

export interface HeadlessDamageRun extends Omit<HeadlessDamageLive, 'now'> {
  endTime: number;
  durationSec: number;
  timestamp: number;
}

export interface HeadlessDamageSnapshot {
  live: HeadlessDamageLive;
  history: HeadlessDamageRun[];
}

export class HeadlessDamageTracker extends EventEmitter {
  private mapName: string;
  private startTime = Date.now();
  private readonly targets = new Map<number, TargetState>();
  private readonly history: HeadlessDamageRun[] = [];
  private notifyTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly client: Client,
    private readonly gameData: GameDataLoader,
  ) {
    super();
    this.mapName = client.getMapName();
    client.on(ClientEvent.MapChange, (mapName) => this.changeMap(mapName));
    client.onPacket('DAMAGE' as never, (packet) => this.onDamage(packet as unknown as DamagePacketLike));
  }

  snapshot(): HeadlessDamageSnapshot {
    return { live: this.serializeLive(), history: this.history.slice() };
  }

  private onDamage(packet: DamagePacketLike): void {
    const targetId = Number(packet.targetId);
    const attackerId = Number(packet.objectId);
    const amount = Number(packet.damageAmount);
    if (!Number.isFinite(targetId) || !Number.isFinite(attackerId) || !Number.isFinite(amount) || amount <= 0) return;

    const targetObject = this.client.getVisibleObject(targetId);
    if (!targetObject || this.gameData.getObjectCategory(targetObject.type) !== 'Enemy') return;

    const attacker = this.resolvePlayer(attackerId);
    if (!attacker) return;

    const target = this.getTarget(targetObject);
    const player = target.players.get(attackerId) ?? this.createPlayer(attacker);
    player.damage += amount;
    player.weaponDamage += amount;
    player.hits += 1;
    target.players.set(attackerId, player);
    target.lastHitAt = Date.now();
    target.killed ||= (Number(packet.info) & 1) !== 0;
    this.scheduleChanged();
  }

  private resolvePlayer(objectId: number): TrackedObject | null {
    if (objectId === this.client.getObjectId()) {
      const player = this.client.getPlayer();
      const pos = this.client.getPosition();
      return player ? { objectId, type: Number(player.class), x: pos.x, y: pos.y, name: player.name, player } : null;
    }
    const object = this.client.getVisibleObject(objectId);
    return object && this.gameData.getObjectCategory(object.type) === 'Player' ? object : null;
  }

  private getTarget(object: TrackedObject): TargetState {
    const existing = this.targets.get(object.objectId);
    if (existing) return existing;
    const def = this.gameData.getObject(object.type);
    const rawMaxHp = Number(object.rawStats?.['0']);
    const maxHp = Number.isFinite(rawMaxHp) && rawMaxHp > 0 ? rawMaxHp : (def?.maxHp ?? 0);
    const now = Date.now();
    const target: TargetState = {
      targetObjectId: object.objectId,
      targetType: object.type,
      targetName: object.name || def?.displayId || def?.id || `0x${object.type.toString(16)}`,
      targetMaxHp: maxHp,
      boss: maxHp >= MIN_BOSS_HP,
      miniboss: maxHp >= MIN_MINIBOSS_HP && maxHp < MIN_BOSS_HP,
      killed: false,
      firstHitAt: now,
      lastHitAt: now,
      players: new Map(),
    };
    this.targets.set(object.objectId, target);
    return target;
  }

  private createPlayer(object: TrackedObject): PlayerState {
    const player = object.player;
    const equipment = player?.inventory?.slice(0, 4) ?? [];
    return {
      objectId: object.objectId,
      name: player?.name || object.name || `Player_${object.objectId}`,
      classType: object.type,
      skin: player?.texture,
      tex1: player?.clothingDye,
      tex2: player?.accessoryDye,
      damage: 0,
      hits: 0,
      weaponDamage: 0,
      summonDamage: 0,
      guardedHits: 0,
      guardedDamage: 0,
      damageTaken: 0,
      hitsTaken: 0,
      equipTop: {
        wpn: Number(equipment[0] ?? -1),
        abl: Number(equipment[1] ?? -1),
        arm: Number(equipment[2] ?? -1),
        rng: Number(equipment[3] ?? -1),
      },
    };
  }

  private serializeTarget(target: TargetState): HeadlessDamageTarget {
    const players = Array.from(target.players.values()).sort((a, b) => b.damage - a.damage);
    const total = players.reduce((sum, player) => sum + player.damage, 0);
    return {
      targetObjectId: target.targetObjectId,
      targetType: target.targetType,
      targetName: target.targetName,
      targetMaxHp: target.targetMaxHp,
      boss: target.boss,
      miniboss: target.miniboss,
      killed: target.killed,
      firstHitAt: target.firstHitAt,
      lastHitAt: target.lastHitAt,
      durationSec: Math.max(0, (target.lastHitAt - target.firstHitAt) / 1000),
      players: players.map((player) => ({
        ...player,
        pct: total > 0 ? ((player.damage / total) * 100).toFixed(1) : '0.0',
        equipHits: { wpn: player.hits, abl: 0, arm: 0, rng: 0 },
      })),
    };
  }

  private serializeLive(): HeadlessDamageLive {
    const targets = Array.from(this.targets.values(), (target) => this.serializeTarget(target));
    targets.sort((a, b) => b.lastHitAt - a.lastHitAt);
    return {
      mapName: this.mapName,
      startTime: this.startTime,
      now: Date.now(),
      localPlayerId: this.client.getObjectId() >= 0 ? this.client.getObjectId() : null,
      targets,
    };
  }

  private changeMap(mapName: string): void {
    const endTime = Date.now();
    if (this.targets.size > 0) {
      const live = this.serializeLive();
      this.history.push({
        mapName: live.mapName,
        startTime: live.startTime,
        endTime,
        durationSec: Math.max(0, (endTime - live.startTime) / 1000),
        timestamp: endTime,
        localPlayerId: live.localPlayerId,
        targets: live.targets,
      });
      if (this.history.length > HISTORY_CAP) this.history.splice(0, this.history.length - HISTORY_CAP);
    }
    this.targets.clear();
    this.mapName = mapName;
    this.startTime = endTime;
    this.scheduleChanged();
  }

  private scheduleChanged(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      this.emit('changed', this.snapshot());
    }, 200);
    this.notifyTimer.unref();
  }
}
