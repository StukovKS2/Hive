import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AoeAckPacket,
  AoePacket,
  AllyShootPacket,
  ChangeAllyShootPacket,
  ConditionEffectBits,
  ConditionEffectBits2,
  CreateSuccessPacket,
  EnemyShootPacket,
  Packet,
  PlayerData,
  ServerPlayerShootPacket,
  ShowEffectPacket,
  ShootAckPacket,
  VisualEffect,
} from 'realmlib';
import { Client } from '../src/client';
import type { CombatProjectileDefinition } from '../src/combat-tracker';
import { ClientEvent } from '../src/events';
import { ThrownAoeTracker } from '../src/predictive-auto-dodge';

test('enemy and owned player shoots send a one-count SHOOTACK', () => {
  const { client, sent } = harness();
  const enemy = new EnemyShootPacket();
  enemy.ownerId = 20;
  invoke(client, 'handleEnemyShoot', enemy);

  const own = new ServerPlayerShootPacket();
  own.ownerId = 10;
  invoke(client, 'handleServerPlayerShoot', own);

  assert.equal(sent.length, 2);
  for (const packet of sent) {
    assert.ok(packet instanceof ShootAckPacket);
    assert.equal(packet.time, 123);
    assert.equal(packet.ackCount, 1);
  }
});

test('another player SERVERPLAYERSHOOT is not acknowledged', () => {
  const { client, sent } = harness();
  const other = new ServerPlayerShootPacket();
  other.ownerId = 99;

  invoke(client, 'handleServerPlayerShoot', other);

  assert.equal(sent.length, 0);
});

test('other-player viewer projectiles are render-only and clear when disabled', () => {
  const definition: CombatProjectileDefinition = {
    speed: 10000,
    lifetimeMs: 1000,
    multiHit: false,
    passesCover: false,
    amplitude: 0,
    frequency: 1,
    magnitude: 3,
    wavy: false,
    parametric: false,
    boomerang: false,
    acceleration: 0,
    accelerationDelay: 0,
    speedClamp: -1,
  };
  const client = new Client({
    alias: 'viewer-test',
    accessToken: '',
    clientToken: '',
    charId: 1,
    needsNewChar: false,
    host: '127.0.0.1',
    combatData: {
      getProjectile: () => definition,
      getObject: () => undefined,
    },
  });
  const sent: Packet[] = [];
  Object.assign(client as unknown as Record<string, unknown>, {
    io: { send: (packet: Packet) => sent.push(packet) },
    objectId: 10,
    time: () => 456,
  });
  const other = new ServerPlayerShootPacket();
  other.ownerId = 99;
  other.containerType = 1234;
  other.bulletId = 7;
  other.damage = 80;
  other.startingPos.x = 3;
  other.startingPos.y = 4;
  other.angle = Math.PI / 2;
  other.spellBomb = true;
  other.bulletCount = 3;
  other.bulletAngle = 0.2;

  invoke(client, 'handleServerPlayerShoot', other);
  assert.deepEqual(client.getViewerProjectiles(), []);

  client.setViewerOtherProjectilesEnabled(true);
  invoke(client, 'handleServerPlayerShoot', other);

  assert.equal(sent.length, 0);
  assert.deepEqual(client.getViewerProjectiles().map((projectile) => ({
    side: projectile.side,
    ownerId: projectile.ownerId,
    bulletId: projectile.bulletId,
    startX: projectile.startX,
    startY: projectile.startY,
    angle: projectile.angle,
  })), [
    { side: 'other', ownerId: 99, bulletId: 7, startX: 3, startY: 4, angle: Math.PI / 2 },
    { side: 'other', ownerId: 99, bulletId: 8, startX: 3, startY: 4, angle: Math.PI / 2 + 0.2 },
    { side: 'other', ownerId: 99, bulletId: 9, startX: 3, startY: 4, angle: Math.PI / 2 + 0.4 },
  ]);

  client.setViewerOtherProjectilesEnabled(false);
  assert.deepEqual(client.getViewerProjectiles(), []);

  const state = client as unknown as { objects: Map<number, { objectId: number; type: number; x: number; y: number }> };
  state.objects.set(55, { objectId: 55, type: 0x0300, x: 8, y: 9 });
  const ally = new AllyShootPacket();
  ally.ownerId = 55;
  ally.containerType = 1234;
  ally.bulletId = 12;
  ally.angle = 0.75;
  client.setViewerOtherProjectilesEnabled(true);
  invoke(client, 'handleAllyShoot', ally);
  assert.deepEqual(client.getViewerProjectiles().map((projectile) => ({
    ownerId: projectile.ownerId,
    bulletId: projectile.bulletId,
    startX: projectile.startX,
    startY: projectile.startY,
    angle: projectile.angle,
  })), [{ ownerId: 55, bulletId: 12, startX: 8, startY: 9, angle: 0.75 }]);
  assert.equal(sent.length, 0);
});

test('AOE is acknowledged with the current client time and local player position', () => {
  const { client, sent } = harness();
  invoke(client, 'handleAoe', new AoePacket());

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof AoeAckPacket);
  assert.equal(sent[0].time, 456);
  assert.deepEqual({ x: sent[0].position.x, y: sent[0].position.y }, { x: 4, y: 6 });
});

test('AOE is retained briefly for the viewer with its server radius and color', () => {
  const { client } = harness();
  const aoe = new AoePacket();
  aoe.pos.x = 8.5;
  aoe.pos.y = 12.25;
  aoe.radius = 3.75;
  aoe.damage = 120;
  aoe.effect = 38;
  aoe.duration = 1.5;
  aoe.origType = 0x1234;
  aoe.color = 0xff3366;
  aoe.armorPiercing = true;

  invoke(client, 'handleAoe', aoe);

  assert.deepEqual(client.getViewerAoes(), [{
    id: 1,
    x: 8.5,
    y: 12.25,
    radius: 3.75,
    damage: 120,
    effect: 38,
    duration: 1.5,
    origType: 0x1234,
    color: 0xff3366,
    armorPiercing: true,
    startTime: 456,
    lifetimeMs: 750,
  }]);

  Object.assign(client as unknown as Record<string, unknown>, { time: () => 1207 });
  assert.deepEqual(client.getViewerAoes(), []);
});

test('thrown AOEs are exposed to the viewer as pending landing telegraphs', () => {
  const { client } = harness();
  Object.assign(client as unknown as Record<string, unknown>, {
    thrownAoes: new ThrownAoeTracker(),
  });
  const effect = new ShowEffectPacket();
  effect.effectType = VisualEffect.THROW_PROJECTILE;
  effect.pos1.x = 8.5;
  effect.pos1.y = 12.25;
  effect.color = 0xff3366;
  effect.duration = 0.8;

  invoke(client, 'handleShowEffect', effect);

  assert.deepEqual(client.getViewerAoes(), [{
    id: -1,
    x: 8.5,
    y: 12.25,
    radius: 1,
    damage: 0,
    effect: 0,
    duration: 0,
    origType: 0,
    color: 0xff424c,
    armorPiercing: false,
    startTime: 456,
    lifetimeMs: 800,
    pending: true,
    landingTime: 1256,
  }]);

  Object.assign(client as unknown as Record<string, unknown>, { time: () => 1256 });
  const landed = new AoePacket();
  landed.pos.x = 8.5;
  landed.pos.y = 12.25;
  landed.radius = 2.5;
  landed.color = 0xff3366;
  invoke(client, 'handleAoe', landed);

  const visible = client.getViewerAoes();
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.pending, undefined);
  assert.equal(visible[0]?.radius, 2.5);
});

test('AOE without a player is acknowledged at zero even if stale position state remains', () => {
  const { client, sent } = harness();
  Object.assign(client as unknown as Record<string, unknown>, {
    player: undefined,
    pos: { x: 99, y: 100 },
  });

  invoke(client, 'handleAoe', new AoePacket());

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof AoeAckPacket);
  assert.deepEqual({ x: sent[0].position.x, y: sent[0].position.y }, { x: 0, y: 0 });
});

test('AOE collision and acknowledgement use the same local position', () => {
  const { client, sent, player } = harness();
  const damage: number[] = [];
  client.on(ClientEvent.DamageTaken, (event) => damage.push(event.amount));
  Object.assign(client as unknown as Record<string, unknown>, {
    serverPos: { x: 100, y: 100 },
  });
  const aoe = new AoePacket();
  aoe.pos.x = 4;
  aoe.pos.y = 6;
  aoe.radius = 1;
  aoe.damage = 25;
  aoe.effect = 38; // Curse

  invoke(client, 'handleAoe', aoe);

  assert.deepEqual(damage, [25]);
  assert.equal(player.condition2 & ConditionEffectBits2.CURSE, ConditionEffectBits2.CURSE);
  assert.ok(sent[0] instanceof AoeAckPacket);
  assert.deepEqual({ x: sent[0].position.x, y: sent[0].position.y }, { x: 4, y: 6 });
});

test('AOE local conditions respect ProdMafia immunity and invincible guards', () => {
  const petrified = harness();
  petrified.player.condition2 = ConditionEffectBits2.PETRIFIED_IMMUNE;
  const petrifyAoe = aoeAtPlayer(35); // Petrified
  invoke(petrified.client, 'handleAoe', petrifyAoe);
  assert.equal(petrified.player.condition2 & ConditionEffectBits2.PETRIFIED, 0);
  assert.equal(petrified.sent.length, 1);

  const invincible = harness();
  invincible.player.condition = ConditionEffectBits.INVINCIBLE;
  invoke(invincible.client, 'handleAoe', aoeAtPlayer(38)); // Curse
  assert.equal(invincible.player.condition2 & ConditionEffectBits2.CURSE, 0);
  assert.equal(invincible.sent.length, 1);
});

test('map entry sends Exalt-compatible ally-shoot preference', () => {
  const { client, sent } = harness();
  const created = new CreateSuccessPacket();
  created.objectId = 42;

  invoke(client, 'handleCreateSuccess', created);

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof ChangeAllyShootPacket);
  assert.equal(sent[0].toggle, 0);
});

test('AOE autonexus returns before acknowledgement and local condition application', () => {
  const { client, sent, player } = harness();
  const monitor = (client as unknown as { autoNexus: {
    reset(hp: number, maxHp: number): void;
    setSafeMap(safe: boolean): void;
  } }).autoNexus;
  monitor.reset(100, 100);
  monitor.setSafeMap(false);
  client.configureAutoNexus({ enabled: true, thresholdPercent: 50 });
  const aoe = aoeAtPlayer(38); // Curse
  aoe.damage = 60;

  invoke(client, 'handleAoe', aoe);

  assert.equal(sent.some((packet) => packet instanceof AoeAckPacket), false);
  assert.equal(player.condition2 & ConditionEffectBits2.CURSE, 0);
  assert.equal(client.getAutoNexusState().lastTriggerSource, 'aoe');
});

function harness(): { client: Client; sent: Packet[]; player: PlayerData } {
  const client = new Client({
    alias: 'test',
    accessToken: '',
    clientToken: '',
    charId: 1,
    needsNewChar: false,
    host: '127.0.0.1',
  });
  const sent: Packet[] = [];
  const player = {
    hp: 100,
    maxHP: 100,
    mp: 100,
    def: 0,
    condition: 0,
    condition2: 0,
  } as PlayerData;
  Object.assign(client as unknown as Record<string, unknown>, {
    io: { send: (packet: Packet) => sent.push(packet) },
    objectId: 10,
    lastFrameTime: 123,
    time: () => 456,
    posKnown: true,
    pos: { x: 4, y: 6 },
    player,
  });
  return { client, sent, player };
}

function aoeAtPlayer(effect: number): AoePacket {
  const aoe = new AoePacket();
  aoe.pos.x = 4;
  aoe.pos.y = 6;
  aoe.radius = 1;
  aoe.damage = 25;
  aoe.effect = effect;
  return aoe;
}

function invoke(client: Client, method: string, packet: Packet): void {
  (client as unknown as Record<string, (value: Packet) => void>)[method](packet);
}
