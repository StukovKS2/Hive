import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DodgeJumpLimiter } from '../src/dodge-jump-limiter';

test('dodge jump limiter starts at one tile and spends a continuous distance allowance', () => {
  const limiter = new DodgeJumpLimiter();
  assert.equal(limiter.getState(1000).allowance, 1);
  assert.equal(limiter.commit(1000, { x: 5, y: 5 }, { x: 5.73, y: 5 }), true);
  assert.equal(limiter.getState(1000).status, 'awaiting_move');
  limiter.markSent(1050, { x: 5.73, y: 5 });
  assert.equal(limiter.getState(1050).status, 'awaiting_confirmation');
  limiter.observeAuthoritative(1250, { x: 5.72, y: 5 });
  const confirmed = limiter.getState(1250);
  assert.equal(confirmed.lastOutcome, 'confirmed');
  assert.equal(confirmed.status, 'recovering');
  assert.equal(confirmed.allowance, 0);
  assert.equal(limiter.getState(1750).allowance, 1);
});

test('confirmed jumps cautiously raise the learned ceiling to at most 1.5 tiles', () => {
  const limiter = new DodgeJumpLimiter();
  let now = 1000;
  for (let index = 0; index < 12; index++) {
    const allowance = limiter.getState(now).allowance;
    assert.ok(allowance >= 1);
    assert.equal(limiter.commit(now, { x: 0, y: 0 }, { x: 1, y: 0 }), true);
    limiter.markSent(now + 20, { x: 1, y: 0 });
    limiter.observeAuthoritative(now + 220, { x: 1, y: 0 });
    now += 1200;
  }
  assert.equal(limiter.getState(now).learnedMaxDistance, 1.5);
});

test('authoritative correction reduces distance and imposes backoff', () => {
  const limiter = new DodgeJumpLimiter();
  assert.equal(limiter.commit(1000, { x: 0, y: 0 }, { x: 1, y: 0 }), true);
  limiter.markSent(1020, { x: 1, y: 0 });
  limiter.observeAuthoritative(1400, { x: 0.05, y: 0 });
  const corrected = limiter.getState(1400);
  assert.equal(corrected.status, 'backoff');
  assert.equal(corrected.lastOutcome, 'corrected');
  assert.equal(corrected.learnedMaxDistance, 0.8);
  assert.equal(corrected.allowance, 0);
  assert.equal(limiter.consumeCorrectionRebase(), true);
  assert.equal(limiter.consumeCorrectionRebase(), false);
});

test('a suspicious disconnect applies a stronger learned-distance penalty', () => {
  const limiter = new DodgeJumpLimiter();
  assert.equal(limiter.commit(1000, { x: 0, y: 0 }, { x: 1, y: 0 }), true);
  limiter.markSent(1020, { x: 1, y: 0 });
  assert.equal(limiter.noteDisconnect(1300), true);
  const state = limiter.getState(1300);
  assert.equal(state.lastOutcome, 'disconnect');
  assert.equal(state.learnedMaxDistance, 0.65);
  assert.equal(state.status, 'backoff');
});

test('an unconfirmed jump remains frozen until an authoritative position arrives', () => {
  const limiter = new DodgeJumpLimiter();
  assert.equal(limiter.commit(1000, { x: 0, y: 0 }, { x: 1, y: 0 }), true);
  limiter.markSent(1020, { x: 1, y: 0 });
  assert.equal(limiter.getState(3000).status, 'awaiting_confirmation');
  limiter.observeAuthoritative(3000, { x: 0, y: 0 });
  assert.equal(limiter.getState(3000).status, 'backoff');
  assert.equal(limiter.consumeCorrectionRebase(), true);
});

test('jump recovery uses a legitimate zero-millisecond clock origin', () => {
  const limiter = new DodgeJumpLimiter();
  assert.equal(limiter.commit(0, { x: 0, y: 0 }, { x: 0.5, y: 0 }), true);
  limiter.markSent(20, { x: 0.5, y: 0 });
  limiter.observeAuthoritative(100, { x: 0.5, y: 0 });
  assert.equal(limiter.getState(750).status, 'ready');
  assert.equal(limiter.getState(750).allowance, 1);
});
