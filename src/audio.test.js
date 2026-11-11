/**
 * AudioProcessor's microphone lifecycle (2026-11-10): Mezzo never listens
 * while the Companion is closed, so a getUserMedia() request that is still
 * waiting when release() runs must stop its stream when it arrives, and two
 * overlapping requests must share one stream (a second would replace the
 * first, which could then never be stopped).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// audio.js (via _timing-debug.js) reads window.location at load, and builds
// its pipeline from window.AudioContext.
class FakeNode { connect() {} disconnect() {} }
class FakeAudioContext {
  createAnalyser() { return Object.assign(new FakeNode(), { fftSize: 2048, smoothingTimeConstant: 0, getFloatTimeDomainData() {} }); }
  createMediaStreamSource() { return new FakeNode(); }
  createBiquadFilter() { return Object.assign(new FakeNode(), { type: '', frequency: { value: 0 }, Q: { value: 0 } }); }
  close() {}
}
globalThis.window = { location: { search: '' }, AudioContext: FakeAudioContext };

function fakeStream() {
  const track = { kind: 'audio', readyState: 'live', stop() { this.readyState = 'ended'; } };
  return { track, getTracks: () => [track] };
}

/** getUserMedia that waits until the test resolves it. */
let requests;
/** Node's own navigator is read-only; replace it. */
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}
function installSlowMic() {
  requests = [];
  setNavigator({
    mediaDevices: {
      getUserMedia: () => new Promise((resolve) => {
        const stream = fakeStream();
        requests.push({ stream, arrive: () => resolve(stream) });
      }),
    },
  });
}

const { AudioProcessor } = await import('./audio.js');
const quiet = () => {}; // audio.js logs every step
const log = console.log;
const error = console.error;

describe('AudioProcessor: no microphone left open', () => {
  beforeEach(() => {
    installSlowMic();
    console.log = quiet;
    console.error = quiet;
  });
  afterEach(() => {
    console.log = log;
    console.error = error;
  });

  it('release() while the request is still waiting: the stream is stopped when it arrives, and acquire() fails with AbortError', async () => {
    const audio = new AudioProcessor();
    const acquiring = audio.acquire();
    audio.release();
    requests[0].arrive();
    await assert.rejects(acquiring, { name: 'AbortError' });
    assert.equal(requests[0].stream.track.readyState, 'ended');
    assert.equal(audio.isMicrophoneActive, false);
    assert.equal(audio.mediaStream, null);
  });

  it('a fresh acquire() after that release starts a new request and keeps its stream', async () => {
    const audio = new AudioProcessor();
    const first = audio.acquire();
    audio.release();
    const second = audio.acquire();
    assert.equal(requests.length, 2);
    requests[0].arrive();
    requests[1].arrive();
    await assert.rejects(first, { name: 'AbortError' });
    await second;
    assert.equal(requests[0].stream.track.readyState, 'ended');
    assert.equal(requests[1].stream.track.readyState, 'live');
    assert.equal(audio.isMicrophoneActive, true);
    audio.release();
    assert.equal(requests[1].stream.track.readyState, 'ended');
  });

  it('overlapping acquire() calls share one request, so release() stops every track', async () => {
    const audio = new AudioProcessor();
    const a = audio.acquire();
    const b = audio.acquire();
    assert.equal(requests.length, 1);
    requests[0].arrive();
    await Promise.all([a, b]);
    assert.equal(audio.isMicrophoneActive, true);
    audio.release();
    assert.equal(requests[0].stream.track.readyState, 'ended');
  });

  it('a denied request rejects, and the next acquire() asks again', async () => {
    setNavigator({ mediaDevices: { getUserMedia: () => Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })) } });
    const audio = new AudioProcessor();
    await assert.rejects(audio.acquire(), { name: 'NotAllowedError' });
    assert.equal(audio.pendingAcquire, null);
    installSlowMic();
    const again = audio.acquire();
    assert.equal(requests.length, 1);
    requests[0].arrive();
    await again;
    assert.equal(audio.isMicrophoneActive, true);
    audio.release();
  });
});
