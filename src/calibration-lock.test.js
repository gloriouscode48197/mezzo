/**
 * Mezzo Cross-Tab Calibration Lock Unit Tests
 *
 * Run with: node --test src/calibration-lock.test.js
 *
 * Two tabs are simulated by two createCalibrationLock() instances sharing
 * one in-memory storage mock (never the real localStorage) and a fake
 * clock/scheduler — no real cross-tab timing, no real localStorage, no real
 * setInterval (every test injects a fake one, even where timing isn't the
 * point, so a forgotten release() can never leave a real interval keeping
 * the test process alive) — fully deterministic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { createCalibrationLock } from './calibration-lock.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

/** Fake setInterval/clearInterval — tests advance time and flush manually
 *  rather than waiting on real timers. */
function createFakeScheduler() {
  const pending = new Map();
  let nextId = 1;
  return {
    setIntervalFn: (fn) => {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clearIntervalFn: (id) => { pending.delete(id); },
    /** Fires every still-registered interval callback once. */
    tick() {
      for (const fn of pending.values()) fn();
    },
    activeCount: () => pending.size,
  };
}

function makeClock(startMs = 1_000_000) {
  let value = startMs;
  return { now: () => value, advance: (ms) => { value += ms; } };
}

/** Always injects a fake scheduler (its own by default) — real setInterval
 *  is never exercised anywhere in this file. */
function makeLock({ storage, tabId, now, scheduler } = {}) {
  const sched = scheduler ?? createFakeScheduler();
  return createCalibrationLock({
    storage,
    tabId,
    now,
    setIntervalFn: sched.setIntervalFn,
    clearIntervalFn: sched.clearIntervalFn,
  });
}

describe('acquire', () => {
  it('succeeds when the lock is free', () => {
    const lock = makeLock({ storage: createMemoryStorage(), tabId: 'tab-a' });
    assert.strictEqual(lock.acquire(), true);
    assert.strictEqual(lock.isHeldByThisTab(), true);
    lock.release();
  });

  it('a second tab is rejected while the first genuinely holds it', () => {
    const storage = createMemoryStorage();
    const a = makeLock({ storage, tabId: 'tab-a' });
    const b = makeLock({ storage, tabId: 'tab-b' });

    assert.strictEqual(a.acquire(), true);
    assert.strictEqual(b.acquire(), false);
    assert.strictEqual(b.isHeldByThisTab(), false);
    assert.strictEqual(b.isHeldElsewhere(), true);
    a.release();
  });

  it('the same tab re-acquiring its own lock is always allowed (idempotent)', () => {
    const storage = createMemoryStorage();
    const a = makeLock({ storage, tabId: 'tab-a' });
    assert.strictEqual(a.acquire(), true);
    assert.strictEqual(a.acquire(), true);
    a.release();
  });

  it('a second tab can acquire once the first releases', () => {
    const storage = createMemoryStorage();
    const a = makeLock({ storage, tabId: 'tab-a' });
    const b = makeLock({ storage, tabId: 'tab-b' });

    a.acquire();
    a.release();
    assert.strictEqual(b.acquire(), true);
    b.release();
  });
});

describe('staleness / abandoned-owner recovery', () => {
  it('a lock untouched past STALE_AFTER_MS is treated as abandoned and can be reclaimed', () => {
    const storage = createMemoryStorage();
    const clock = makeClock();
    const a = makeLock({ storage, tabId: 'tab-a', now: clock.now });
    const b = makeLock({ storage, tabId: 'tab-b', now: clock.now });

    assert.strictEqual(a.acquire(), true);
    // Tab A "crashes" — never releases, never heartbeats again.
    clock.advance(20_000); // past the 15s staleness window
    assert.strictEqual(b.acquire(), true, 'a live tab must be able to recover an abandoned lock');
    b.release();
  });

  it('a lock still within the staleness window is NOT reclaimable, even close to the boundary', () => {
    const storage = createMemoryStorage();
    const clock = makeClock();
    const a = makeLock({ storage, tabId: 'tab-a', now: clock.now });
    const b = makeLock({ storage, tabId: 'tab-b', now: clock.now });

    a.acquire();
    clock.advance(10_000); // well under 15s
    assert.strictEqual(b.acquire(), false);
    a.release();
  });

  it('a heartbeating tab never goes stale even across a span longer than STALE_AFTER_MS', () => {
    const storage = createMemoryStorage();
    const clock = makeClock();
    const scheduler = createFakeScheduler();
    const a = makeLock({ storage, tabId: 'tab-a', now: clock.now, scheduler });
    const b = makeLock({ storage, tabId: 'tab-b', now: clock.now });

    a.acquire();
    // Simulate six heartbeat ticks spread across 30s of elapsed time —
    // longer than STALE_AFTER_MS, but each tick refreshes acquiredAt.
    for (let i = 0; i < 6; i++) {
      clock.advance(5000);
      scheduler.tick();
    }
    assert.strictEqual(b.acquire(), false, 'the actively-heartbeating tab must still hold it');
    a.release();
  });

  it('stopping the heartbeat (via release) lets the lock go stale normally afterward', () => {
    const storage = createMemoryStorage();
    const scheduler = createFakeScheduler();
    const a = makeLock({ storage, tabId: 'tab-a', scheduler });

    a.acquire();
    assert.strictEqual(scheduler.activeCount(), 1);
    a.release();
    assert.strictEqual(scheduler.activeCount(), 0, 'release() must stop the heartbeat interval, not just clear the record');
  });
});

describe('release', () => {
  it('clears this tab\'s own lock', () => {
    const storage = createMemoryStorage();
    const a = makeLock({ storage, tabId: 'tab-a' });
    a.acquire();
    a.release();
    assert.strictEqual(a.isHeldByThisTab(), false);
    assert.strictEqual(storage.getItem('mezzoCalibrationLock'), null);
  });

  it('is a safe no-op when this tab never held it', () => {
    const lock = makeLock({ storage: createMemoryStorage(), tabId: 'tab-a' });
    assert.doesNotThrow(() => lock.release());
  });

  it('never clears a lock a different tab currently holds', () => {
    const storage = createMemoryStorage();
    const a = makeLock({ storage, tabId: 'tab-a' });
    const b = makeLock({ storage, tabId: 'tab-b' });

    a.acquire();
    // b never actually acquired (a holds it) — releasing must not touch a's lock.
    b.release();
    assert.strictEqual(a.isHeldByThisTab(), true);
    assert.notStrictEqual(storage.getItem('mezzoCalibrationLock'), null);
    a.release();
  });

  it('does not clear a DIFFERENT tab\'s lock even if this tab\'s own record went stale and was reclaimed', () => {
    const storage = createMemoryStorage();
    const clock = makeClock();
    const a = makeLock({ storage, tabId: 'tab-a', now: clock.now });
    const b = makeLock({ storage, tabId: 'tab-b', now: clock.now });

    a.acquire();
    clock.advance(20_000);
    b.acquire(); // reclaims the now-stale lock from A

    a.release(); // A's late cleanup call — must not clobber B's now-active lock
    assert.strictEqual(b.isHeldByThisTab(), true);
    assert.strictEqual(b.isHeldElsewhere(), false);
    b.release();
  });
});

describe('lock record contents', () => {
  it('never stores anything beyond a tab id and a timestamp — no audio data, no calibration samples, no profile content', () => {
    const storage = createMemoryStorage();
    const a = makeLock({ storage, tabId: 'tab-a', now: () => 12345 });
    a.acquire();
    const raw = JSON.parse(storage.getItem('mezzoCalibrationLock'));
    assert.deepStrictEqual(Object.keys(raw).sort(), ['acquiredAt', 'tabId']);
    assert.strictEqual(raw.tabId, 'tab-a');
    assert.strictEqual(raw.acquiredAt, 12345);
    a.release();
  });
});

describe('constructor', () => {
  it('degrades to an always-allow no-op without a storage dependency — fails open, never blocks a calibration attempt', () => {
    const lock = createCalibrationLock({ storage: undefined });
    assert.strictEqual(lock.acquire(), true);
    assert.strictEqual(lock.isHeldByThisTab(), false);
    assert.strictEqual(lock.isHeldElsewhere(), false);
    assert.doesNotThrow(() => lock.release());
  });

  it('defaults to a fresh random tabId per instance when none is given', () => {
    const storage = createMemoryStorage();
    const a = makeLock({ storage });
    const b = makeLock({ storage });
    assert.notStrictEqual(a.getTabId(), b.getTabId());
  });
});
