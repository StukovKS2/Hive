import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MovementController } from '../src/movement-controller';

test('MovementController steps from authoritative server position when available', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 10, y: 0 }, 0.1);
  const update = movement.update(
    {
      localPos: { x: 9, y: 0 },
      serverPos: { x: 0, y: 0 },
      playerSpeed: 0,
      playerSpeedBoost: 0,
    },
    1000,
  );

  assert.equal(update.reached, undefined);
  assert.ok(update.pos.x > 3.9 && update.pos.x < 4.1);
  assert.equal(update.pos.y, 0);
});

test('MovementController emits reached target and clears target state', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 1, y: 1 }, 0.1);
  const update = movement.update(
    {
      localPos: { x: 0, y: 0 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    1000,
  );

  assert.deepEqual(update.reached, { x: 1, y: 1 });
  assert.equal(movement.hasTarget(), false);
});

test('MovementController waits for authoritative position before confirming a waypoint', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 1, y: 0 }, 0.1);

  const predicted = movement.update(
    {
      localPos: { x: 0, y: 0 },
      serverPos: { x: 0, y: 0 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    1000,
  );
  assert.deepEqual(predicted.pos, { x: 1, y: 0 });
  assert.equal(predicted.reached, undefined);
  assert.equal(movement.hasTarget(), true);

  const confirmed = movement.update(
    {
      localPos: predicted.pos,
      serverPos: { x: 1, y: 0 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    100,
  );
  assert.deepEqual(confirmed.reached, { x: 1, y: 0 });
  assert.equal(movement.hasTarget(), false);
});

test('MovementController applies a local dodge velocity without clearing navigation intent', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 10, y: 0 }, 0.1);
  const update = movement.update(
    {
      localPos: { x: 2, y: 2 },
      serverPos: { x: 1, y: 1 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    100,
    { integrateFromLocal: true, velocityOverride: { x: 0, y: 0.005 } },
  );

  assert.deepEqual(update.pos, { x: 2, y: 2.5 });
  assert.equal(movement.hasTarget(), true);
  assert.deepEqual(movement.getTarget(), { x: 10, y: 0, threshold: 0.1 });
});

test('MovementController can track path stalls while dodge owns safe goal movement', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 10, y: 0 }, 0.1);
  const snapshot = {
    localPos: { x: 0, y: 0 },
    serverPos: { x: 0, y: 0 },
    playerSpeed: 75,
    playerSpeedBoost: 0,
  };

  const initial = movement.update(snapshot, 100, {
    velocityOverride: { x: 0.0096, y: 0 },
    trackTargetProgress: true,
  });
  assert.equal(initial.stalled, undefined);
  const stalled = movement.update(snapshot, 3100, {
    velocityOverride: { x: 0.0096, y: 0 },
    trackTargetProgress: true,
  });
  assert.deepEqual(stalled.stalled, { distance: 10 });
});

test('MovementController can dodge from standstill without creating a walk target', () => {
  const movement = new MovementController();
  const update = movement.update(
    {
      localPos: { x: 2, y: 2 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    100,
    { integrateFromLocal: true, velocityOverride: { x: -0.005, y: 0 } },
  );

  assert.deepEqual(update.pos, { x: 1.5, y: 2 });
  assert.equal(movement.hasTarget(), false);
});

test('MovementController applies a dodge jump without integrating it as velocity', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 10, y: 2 }, 0.1);
  const update = movement.update(
    {
      localPos: { x: 2, y: 2 },
      serverPos: { x: 1.5, y: 2 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    16,
    { positionOverride: { x: 3.23, y: 2.41 } },
  );

  assert.deepEqual(update.pos, { x: 3.23, y: 2.41 });
  assert.equal(movement.hasTarget(), true);
  assert.deepEqual(movement.getTarget(), { x: 10, y: 2, threshold: 0.1 });
});
