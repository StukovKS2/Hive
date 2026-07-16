import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConditionEffectBits, GotoAckPacket, GotoPacket, MovePacket, NewTickPacket, Packet, PlayerData } from 'realmlib';
import { Client } from '../src/client';
import { DodgeJumpLimiter } from '../src/dodge-jump-limiter';

interface MovementClientState {
  pos: { x: number; y: number };
  posKnown: boolean;
  serverPos: { x: number; y: number } | undefined;
  player: PlayerData | undefined;
  lastFrameTime: number;
  lastLocalMovementAt: number;
  objectId: number;
  dodgeJumpLimiter: DodgeJumpLimiter;
  io: { send(packet: Packet): void };
  time(): number;
  updateLocalFrame(now: number): void;
  handleGoto(packet: GotoPacket): void;
  handleNewTick(packet: NewTickPacket): void;
  sendMove(packet: NewTickPacket, now: number): void;
  updateStatuses(packet: NewTickPacket): boolean;
  nexusImmediately(reason?: string): boolean;
}

test('direct walking integrates continuously on local frames without auto-dodge', () => {
  const client = movementClient();
  const state = client as unknown as MovementClientState;

  assert.equal(client.moveTo({ x: 10, y: 0 }, 0.1), true);
  state.lastLocalMovementAt = 1000;
  state.updateLocalFrame(1016);
  const firstFrameX = state.pos.x;
  state.updateLocalFrame(1032);

  assert.ok(firstFrameX > 0.15 && firstFrameX < 0.16);
  assert.ok(state.pos.x > 0.30 && state.pos.x < 0.31);
  assert.equal(state.pos.y, 0);
});

test('NEWTICK reports the latest local frame without re-integrating from stale server position', () => {
  const client = movementClient();
  const state = client as unknown as MovementClientState;
  const sent: Packet[] = [];
  Object.assign(state, {
    pos: { x: 0.5, y: 0 },
    serverPos: { x: 0, y: 0 },
    lastFrameTime: 1000,
    lastLocalMovementAt: 1192,
    io: { send: (packet: Packet) => sent.push(packet) },
    time: () => 1200,
  });
  client.moveTo({ x: 10, y: 0 }, 0.1);

  const tick = new NewTickPacket();
  tick.tickId = 7;
  tick.tickTime = 200;
  tick.serverRealTimeMS = 5000;
  tick.statuses = [];
  state.handleNewTick(tick);

  assert.deepEqual(state.pos, { x: 0.5, y: 0 });
  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof MovePacket);
  assert.equal(sent[0].tickId, 7);
  assert.equal(sent[0].time, 5000);
  assert.equal(sent[0].records.length, 1);
  assert.equal(sent[0].records[0].time, 1192);
  assert.deepEqual(
    { x: sent[0].records[0].x, y: sent[0].records[0].y },
    { x: 0.5, y: 0 },
  );
});

test('NEWTICK sends no movement after authoritative HP triggers autonexus', () => {
  const client = movementClient();
  const state = client as unknown as MovementClientState;
  const sent: Packet[] = [];
  let nexusCalls = 0;
  const monitor = (client as unknown as { autoNexus: {
    reset(hp: number, maxHp: number): void;
    setSafeMap(safe: boolean): void;
    applyDamage(amount: number, source: 'server'): boolean;
  } }).autoNexus;
  monitor.reset(250, 1000);
  monitor.setSafeMap(false);
  Object.assign(state, {
    io: { send: (packet: Packet) => sent.push(packet) },
    nexusImmediately: () => { nexusCalls++; return true; },
    updateStatuses: () => monitor.applyDamage(50, 'server'),
  });

  const tick = new NewTickPacket();
  tick.tickId = 8;
  tick.tickTime = 200;
  tick.serverRealTimeMS = 5200;
  tick.statuses = [];
  state.handleNewTick(tick);

  assert.equal(nexusCalls, 1);
  assert.equal(sent.length, 0);
});

test('dodge jump is reported only through the next normal MOVE record', () => {
  const client = movementClient();
  const state = client as unknown as MovementClientState;
  const sent: Packet[] = [];
  Object.assign(state, {
    pos: { x: 1.23, y: 0.41 },
    lastLocalMovementAt: 1100,
    io: { send: (packet: Packet) => sent.push(packet) },
  });
  assert.equal(state.dodgeJumpLimiter.commit(
    1000,
    { x: 0, y: 0 },
    { x: 1.23, y: 0.41 },
    1.5,
  ), false, 'initial learned limit should reject a jump above one tile');
  assert.equal(state.dodgeJumpLimiter.commit(
    1000,
    { x: 0.23, y: 0.41 },
    { x: 1.23, y: 0.41 },
    1.5,
  ), true);
  client.moveTo({ x: 10, y: 0.41 }, 0.1);
  state.updateLocalFrame(1116);
  assert.deepEqual(state.pos, { x: 1.23, y: 0.41 }, 'walking must wait for the jump MOVE');

  const tick = new NewTickPacket();
  tick.tickId = 9;
  tick.serverRealTimeMS = 6000;
  state.sendMove(tick, 1200);

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof MovePacket);
  assert.deepEqual(
    { x: sent[0].records[0].x, y: sent[0].records[0].y },
    { x: 1.23, y: 0.41 },
  );
  assert.equal(state.dodgeJumpLimiter.getState(1200).status, 'awaiting_confirmation');
});

test('bleeding is predicted between server ticks and can trigger autonexus', () => {
  const client = movementClient();
  const state = client as unknown as MovementClientState;
  let nexusCalls = 0;
  const monitor = (client as unknown as { autoNexus: {
    reset(hp: number, maxHp: number): void;
    setSafeMap(safe: boolean): void;
  } }).autoNexus;
  monitor.reset(201, 1000);
  monitor.setSafeMap(false);
  state.player!.condition = ConditionEffectBits.BLEEDING;
  state.lastLocalMovementAt = 1000;
  Object.assign(state, {
    nexusImmediately: () => { nexusCalls++; return true; },
  });

  state.updateLocalFrame(1034);
  state.updateLocalFrame(1068);

  assert.equal(nexusCalls, 1);
  assert.equal(client.getAutoNexusState().lastTriggerSource, 'condition');
});

test('self GOTO rebases local and authoritative position after teleporting', () => {
  const client = movementClient();
  const state = client as unknown as MovementClientState;
  const sent: Packet[] = [];
  Object.assign(state, {
    objectId: 42,
    pos: { x: 10, y: 20 },
    serverPos: { x: 10, y: 20 },
    lastFrameTime: 1234,
    io: { send: (packet: Packet) => sent.push(packet) },
  });

  const correction = new GotoPacket();
  correction.objectId = 42;
  correction.position.x = 80.5;
  correction.position.y = 92.25;
  state.handleGoto(correction);

  assert.deepEqual(client.getPosition(), { x: 80.5, y: 92.25 });
  assert.deepEqual(client.getServerPosition(), { x: 80.5, y: 92.25 });
  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof GotoAckPacket);
  assert.equal(sent[0].time, 1234);
});

function movementClient(): Client {
  const client = new Client({
    alias: 'movement-loop-test',
    accessToken: '',
    clientToken: '',
    charId: 1,
    needsNewChar: false,
    host: '127.0.0.1',
  });
  Object.assign(client as unknown as MovementClientState, {
    pos: { x: 0, y: 0 },
    posKnown: true,
    serverPos: { x: 0, y: 0 },
    player: {
      spd: 75,
      spdBoost: 0,
      condition: 0,
      condition2: 0,
      inventory: [],
    } as unknown as PlayerData,
    io: { send: (_packet: Packet) => undefined },
  });
  return client;
}
