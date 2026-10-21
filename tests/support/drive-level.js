/**
 * Drives Monitoring with a chosen level, through the real pipeline.
 *
 * Fake media devices can't produce a specific loudness on demand, so this
 * patches, in the opener page (where the Companion's modules run):
 *   - AudioProcessor.calculateRms — returns a synthetic RMS at `levelDb`
 *     relative to the seeded profile's speakingDb, instead of the fake
 *     microphone's signal, whenever a level is set. audio.js's own EMA
 *     smoothing still runs on it, so the session sees a realistic smoothed
 *     level. (processAudioFrame itself is bound per instance in the
 *     constructor, so patching it on the prototype would miss the live
 *     instance; calculateRms is looked up on every frame.)
 *   - MezzoEngine.startMonitoring — ends the start-of-session grace period
 *     immediately, so tests don't wait 5–8 seconds before zones update.
 * Zone classification, the 500ms Outside-range dwell, and everything
 * downstream (session, announcer, Range Ring) run unchanged.
 *
 * Call after openCompanion() (the page must be loaded) and before Start
 * monitoring. Module specifiers must match src/mezzo-session.js's own
 * imports exactly, or the browser loads a second, unpatched copy.
 */

/**
 * @param {import('@playwright/test').Page} page - the opener page
 * @param {{ speakingDb: number }} profile - the seeded profile
 */
export async function installLevelDriver(page, { speakingDb }) {
  await page.evaluate(async (baselineDb) => {
    const { AudioProcessor } = await import('/src/audio.js?v=2');
    const { MezzoEngine } = await import('/src/engine.js?v=5');
    window.__mezzoLevelDb = null;
    const realRms = AudioProcessor.prototype.calculateRms;
    AudioProcessor.prototype.calculateRms = function patchedRms() {
      if (window.__mezzoLevelDb === null) return realRms.call(this);
      return Math.pow(10, (baselineDb + window.__mezzoLevelDb) / 20);
    };
    const realStart = MezzoEngine.prototype.startMonitoring;
    MezzoEngine.prototype.startMonitoring = function patchedStart() {
      realStart.call(this);
      this.gracePeriodActive = false;
      this.graceRemainingMs = 0;
    };
  }, speakingDb);
}

/** Sets the driven level, in dB relative to the profile's calibration
 *  (0 = the calibrated speaking level). null hands back to the microphone. */
export async function setLevelDb(page, levelDb) {
  await page.evaluate((v) => { window.__mezzoLevelDb = v; }, levelDb);
}

/** The engine's zone boundaries for a spread, mirroring src/engine.js's own
 *  constants via its exported multipliers (read in the page, not copied). */
export async function rangeBoundsDb(page, spreadDb) {
  return page.evaluate(async (spread) => {
    const { MezzoEngine } = await import('/src/engine.js?v=5');
    const e = new MezzoEngine();
    e.loadCalibration({ baselineRMS: 0.03, spreadDb: spread });
    return e.getRangeBoundsDb();
  }, spreadDb);
}
