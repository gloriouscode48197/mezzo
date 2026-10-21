import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createZoneAnnouncer, ANNOUNCE_HOLD_MS, ZONE_LABELS } from './zone-announcer.js';

// Minimal fake clock: timers fire only when advance() passes their due time.
function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  return {
    setTimeoutFn: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimeoutFn: (t) => timers.delete(t),
    advance(ms) {
      now += ms;
      for (const [k, t] of [...timers]) {
        if (t.at <= now) { timers.delete(k); t.fn(); }
      }
    },
  };
}

describe('createZoneAnnouncer — debounced live region', () => {
  let clock;
  let heard;
  let announcer;
  beforeEach(() => {
    clock = fakeClock();
    heard = [];
    announcer = createZoneAnnouncer({ announce: (t) => heard.push(t), setTimeoutFn: clock.setTimeoutFn, clearTimeoutFn: clock.clearTimeoutFn });
  });

  it('uses the four canonical labels', () => {
    assert.deepEqual([...ZONE_LABELS], ['Listening', 'Within range', 'Approaching end of range', 'Outside range']);
  });

  it('never announces moves between Listening, Within range, and Approaching end of range', () => {
    for (const z of [0, 1, 2, 1, 0, 2]) { announcer.update(z); clock.advance(ANNOUNCE_HOLD_MS * 2); }
    assert.deepEqual(heard, []);
  });

  it('announces entering Outside range only after it has held about a second', () => {
    announcer.update(3);
    clock.advance(ANNOUNCE_HOLD_MS - 1);
    assert.deepEqual(heard, []);
    clock.advance(1);
    assert.deepEqual(heard, ['Outside range']);
  });

  it('says nothing for an Outside range that ends before the hold', () => {
    announcer.update(3);
    clock.advance(ANNOUNCE_HOLD_MS / 2);
    announcer.update(2);
    clock.advance(ANNOUNCE_HOLD_MS * 3);
    assert.deepEqual(heard, []);
  });

  it('announces leaving Outside range after the hold, with the zone current at that moment', () => {
    announcer.update(3);
    clock.advance(ANNOUNCE_HOLD_MS);
    announcer.update(2);
    clock.advance(300);
    announcer.update(1);
    clock.advance(ANNOUNCE_HOLD_MS);
    assert.deepEqual(heard, ['Outside range', 'Within range']);
  });

  it('restarts the hold when Outside range is re-entered, so flicker at the edge stays quiet', () => {
    for (let i = 0; i < 6; i++) {
      announcer.update(3); clock.advance(ANNOUNCE_HOLD_MS * 0.6);
      announcer.update(2); clock.advance(ANNOUNCE_HOLD_MS * 0.3);
    }
    assert.deepEqual(heard, []);
  });

  it('at most about one announcement per second under constant change', () => {
    for (let t = 0; t < 10_000; t += 100) { announcer.update(t % 400 < 200 ? 3 : 2); clock.advance(100); }
    assert.ok(heard.length <= 10);
  });

  it('reset() forgets everything for a new session', () => {
    announcer.update(3); clock.advance(ANNOUNCE_HOLD_MS);
    announcer.reset();
    announcer.update(2); clock.advance(ANNOUNCE_HOLD_MS * 2);
    assert.deepEqual(heard, ['Outside range']); // nothing extra: the new session starts "not outside"
  });
});
