/**
 * PROTOTYPE — AudioWorklet-based RMS sampler
 *
 * Investigation prototype for docs/monitoring-runtime-investigation.md — not
 * wired into the real app. Runs in the browser's dedicated audio rendering
 * thread (registered via audioContext.audioWorklet.addModule(...)), driven
 * by the Web Audio graph's own render-quantum pull, NOT a setInterval/
 * setTimeout on the main thread — this is what makes it structurally immune
 * to Chrome's background-tab timer throttling: there is no timer to throttle.
 *
 * Computes RMS the same way src/audio.js's calculateRms() does (sum of
 * squares over the buffer, sqrt of the mean), just fed 128-sample render
 * quanta instead of a 2048-sample FFT buffer pulled on a 50ms timer.
 * Accumulates across quanta and posts one summary value roughly every
 * SAMPLE_INTERVAL_MS, to stay comparable to the current cadence rather than
 * flooding the main thread with a message every ~2.7ms (128 samples @ 48kHz).
 */

const SAMPLE_INTERVAL_MS = 50;

class RmsProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sumOfSquares = 0;
    this.sampleCount = 0;
    this.samplesPerReport = null; // computed on first process() call, once we know sampleRate
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0]; // mono
    if (!channel) return true;

    if (this.samplesPerReport === null) {
      this.samplesPerReport = Math.round((sampleRate * SAMPLE_INTERVAL_MS) / 1000);
    }

    for (let i = 0; i < channel.length; i++) {
      const s = channel[i];
      this.sumOfSquares += s * s;
      this.sampleCount++;

      if (this.sampleCount >= this.samplesPerReport) {
        const rms = Math.sqrt(this.sumOfSquares / this.sampleCount);
        this.port.postMessage({ rms, t: currentTime });
        this.sumOfSquares = 0;
        this.sampleCount = 0;
      }
    }

    return true; // keep the processor alive
  }
}

registerProcessor('rms-processor', RmsProcessor);
