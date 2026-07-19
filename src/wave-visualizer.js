/**
 * MezzoWaveVisualizer — canvas-drawn organic contour with propagating wave
 * ripples, replacing the SVG-ring MezzoVoiceCircle. Same public shape as the
 * component it replaces (pure renderer, no audio/zone logic of its own):
 *
 *   const viz = new MezzoWaveVisualizer(containerEl);
 *   viz.update(zone, isSustained);
 *   viz.destroy();
 *
 * Zone map: 0 Quiet (idle) / 1 Within Range / 2 Approaching Range / 3 Outside
 * Range — labeling itself stays the caller's job everywhere it already is;
 * this only ever receives a zone number and a sustained flag.
 *
 * Requires: nothing beyond its own injected CSS — colors are drawn directly
 * in the canvas 2D context (not readable mid-gradient-interpolation from CSS
 * custom properties), so the palette below is a literal, calibrated
 * constant, same precedent as src/hero-ring.js and try-it.html's calibration
 * canvas.
 */

const ZONE_TARGETS = [0, 0.22, 0.54, 0.82];

// Faster rise specifically when easing toward the Outside-of-Range target
// (ZONE_TARGETS[3]) — measured live: with the shared 1.8s rise tau below,
// the ring was still well under half its full visual intensity a full
// second after the (now dwell-confirmed) Outside label committed, on top of
// the confirmation dwell itself in src/engine.js. Only the rising-toward-
// Outside case uses this; de-escalation and every other target keep the
// original shared tau untouched — see the tau selection in _loop() below.
const OUTSIDE_RISE_TAU = 0.9;

// Ring-activation hysteresis (see _draw()'s emergence handling below). The
// activate edge matches r1vis/r2vis's own visibility ramp start exactly, so
// a ring starts emerging the instant it would first become visible at all —
// not partway through its fade-in. The deactivate edge sits a little below
// that, purely so energy hovering right at the boundary can't flicker
// ownership back and forth; it does not change the visible fade (r1vis/r2vis
// are already 0 throughout that narrow band).
const R1_ACTIVATE_E = 0.38, R1_DEACTIVATE_E = 0.35;
const R2_ACTIVATE_E = 0.62, R2_DEACTIVATE_E = 0.59;
const EMERGE_TAU = 0.4; // seconds — how quickly an emerging ring eases to its resting radius

// The canvas is deliberately position:absolute inside a position:relative
// wrapper, not a normal-flow block sized by width:100%/height:100%. A
// canvas's `width`/`height` HTML attributes (its raster resolution, set
// below in _resizeCanvas) are its intrinsic size — left in normal flow,
// that intrinsic size can leak into an ancestor's flex/aspect-ratio sizing
// (confirmed: inside .hero-companion-card's aspect-ratio:1/1 + flex:1
// chain). Since _resizeCanvas sets the attributes FROM the observed
// container size, that leak becomes a real feedback loop — each
// ResizeObserver firing feeds a new size back into the container, which
// feeds back into the observer, growing without bound until it blows past
// Chromium's internal layout size cap. Taking the canvas out of flow with
// position:absolute removes the leak path entirely, independent of DPR.
const COMPONENT_CSS = `
.mezzo-wave {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}
.mezzo-wave-canvas {
  display: block;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
`;

function mapE(e, ...pts) {
  if (e <= pts[0]) return pts[1];
  for (let i = 0; i < pts.length - 3; i += 2) {
    if (e <= pts[i + 2]) {
      const t = (e - pts[i]) / (pts[i + 2] - pts[i]);
      return pts[i + 1] + (pts[i + 3] - pts[i + 1]) * t;
    }
  }
  return pts[pts.length - 1];
}

// Two-stage color ramp, keyed by the shared `ct` (see colorProgressFromEnergy
// below) — NOT the single-stage lerp straight to the app's #C4593A accent
// this used before. ct 0–0.5 blends Quiet/Within Range's muted cream toward
// Approaching's amber; ct 0.5–1 blends that amber toward Outside's brighter
// orange. Deliberately a different, more saturated orange than the app
// accent color — approved mockup calls for rgb(235,105,45) specifically for
// this state, not a reuse of the CTA/hanko color.
const CT_STOP_QUIET = [172, 158, 136];       // Quiet / Within Range — muted cream
const CT_STOP_APPROACHING = [210, 155, 75];  // Approaching End of Range — amber
const CT_STOP_OUTSIDE = [235, 105, 45];      // Outside of Range — bright orange

function rgba(ct, a) {
  const [from, to, localT] = ct <= 0.5
    ? [CT_STOP_QUIET, CT_STOP_APPROACHING, ct / 0.5]
    : [CT_STOP_APPROACHING, CT_STOP_OUTSIDE, (ct - 0.5) / 0.5];
  const r = Math.round(from[0] + (to[0] - from[0]) * localT);
  const g = Math.round(from[1] + (to[1] - from[1]) * localT);
  const b = Math.round(from[2] + (to[2] - from[2]) * localT);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

// Exponential, frame-rate-independent ease toward `target` — same idiom the
// energy/mp0/mp1 smoothing below already uses, factored out since it's now
// also used per-ring for the emergence animation.
function easeToward(current, target, dt, tau) {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

// Canvas safety: every radius that feeds a stroke/arc/gradient call passes
// through this first, so a NaN or non-positive value (e.g. a container not
// yet laid out, giving scale=0) can never reach the canvas API — which is
// exactly the failure mode that previously blanked the canvas (an invalid
// radius reaching createRadialGradient() throws synchronously, and since
// the next frame is already scheduled before _draw() runs, the canvas gets
// cleared and never redrawn on every subsequent frame).
function clampRadius(value) {
  return Number.isFinite(value) && value > 0 ? value : 0.001;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Maps display energy to color progress (0–1), reusing ZONE_TARGETS rather
// than inventing new breakpoints. Flat at 0 through Within Range (e <=
// ZONE_TARGETS[1]) — the earlier single lerp (ct = e / ZONE_TARGETS[3]) put
// Within Range at ct≈0.27, visibly warming a zone the status label treats as
// identical to Quiet (see mezzo-session.js's shared data-zone="0","1" color).
// 0–0.5 covers Within Range -> Approaching; 0.5–1 covers Approaching ->
// Outside, matching the two color-ramp stages in rgba() above.
function colorProgressFromEnergy(e) {
  const within = ZONE_TARGETS[1];
  const approaching = ZONE_TARGETS[2];
  const outside = ZONE_TARGETS[3];

  if (e <= within) {
    return 0;
  }

  if (e <= approaching) {
    const t = (e - within) / (approaching - within);
    return 0.5 * t;
  }

  const t = (e - approaching) / (outside - approaching);
  return 0.5 + 0.5 * t;
}

function contourPath(ctx, cx, cy, dx, dy, r, dpx, p0, p1) {
  ctx.beginPath();
  for (let j = 0; j <= 160; j++) {
    const a = (j / 160) * Math.PI * 2;
    const d = dpx * (0.48 * Math.sin(2 * a + p0) + 0.30 * Math.sin(3 * a + p1) + 0.14 * Math.sin(4 * a - p0 * 0.6 + 0.9) + 0.08 * Math.sin(5 * a + p1 * 0.8 + 2.1));
    const rr = Math.max(3, r + d);
    const x = cx + dx + rr * Math.cos(a), y = cy + dy + rr * Math.sin(a);
    j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export class MezzoWaveVisualizer {
  constructor(container) {
    this.container = container;

    this.zone = 0;
    this.energy = 0;
    this.targetEnergy = 0;
    this.isSustained = false;
    this.sustainedTime = 0;
    this.sessionTime = 0;
    this.breathPhase = 0;
    this.mp0 = 1.1;
    this.mp1 = 2.4;
    this.dr1 = 1.3;
    this.dr2 = 2.7;
    this.orbitPhase = 0;

    // Ring-emergence state — see _draw(). r1Active/r2Active are the
    // hysteresis-gated "does this ring currently own radiation" booleans;
    // r1DisplayRadius/r2DisplayRadius are the actual animated radius each
    // ring eases through while emerging, reset to null on deactivation so
    // the next activation always starts fresh rather than from a stale value.
    this.r1Active = false;
    this.r2Active = false;
    this.r1DisplayRadius = null;
    this.r2DisplayRadius = null;
    this.wavePool = [];
    this.lastWaveSpawn = 0;
    this.lastTime = 0;
    this.rafId = null;

    this._injectCSS();
    this._createDOM();
    this._boundLoop = this._loop.bind(this);
    this._boundResize = this._resizeCanvas.bind(this);
    this._resizeCanvas();
    this.resizeObserver = new ResizeObserver(this._boundResize);
    this.resizeObserver.observe(this.el);
    this.rafId = requestAnimationFrame(this._boundLoop);
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  update(zone, isSustained = false) {
    this.zone = Math.min(3, Math.max(0, zone || 0));
    this.isSustained = !!isSustained;
    this.targetEnergy = ZONE_TARGETS[this.zone];
  }

  destroy() {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }

  // ===========================================================================
  // DOM Setup
  // ===========================================================================

  _injectCSS() {
    const doc = this.container.ownerDocument;
    if (doc.getElementById('mezzo-wave-visualizer-css')) return;
    const style = doc.createElement('style');
    style.id = 'mezzo-wave-visualizer-css';
    style.textContent = COMPONENT_CSS;
    doc.head.appendChild(style);
  }

  _createDOM() {
    const doc = this.container.ownerDocument;
    this.el = doc.createElement('div');
    this.el.className = 'mezzo-wave';
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'mezzo-wave-canvas';
    this.el.appendChild(this.canvas);
    this.container.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d');
  }

  _resizeCanvas() {
    // Capped at 1, not window.devicePixelRatio — a second, independent
    // HiDPI issue from the one addressed by position:absolute above: Chrome
    // has a confirmed compositor bug where a canvas with a large real
    // retina backing store mis-paints/shifts unrelated content elsewhere on
    // the page at 2x+ (same root cause already worked around in
    // src/hero-ring.js). This animation is soft strokes and glow — it
    // doesn't need retina sharpness, so this is a safe trade.
    const dpr = Math.min(window.devicePixelRatio || 1, 1);
    const w = this.el.offsetWidth || 240;
    const h = this.el.offsetHeight || 220;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ===========================================================================
  // Animation Loop
  // ===========================================================================

  _loop(now) {
    this.rafId = requestAnimationFrame(this._boundLoop);
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    // Falling (de-escalation, any target) keeps its original 1.2s tau.
    // Rising keeps the original 1.8s tau UNLESS the rise is specifically
    // toward the Outside-of-Range target, which uses the faster
    // OUTSIDE_RISE_TAU instead — Quiet/Within/Approaching rises are
    // untouched either way.
    const isFalling = this.energy > this.targetEnergy;
    const isRisingTowardOutside = !isFalling && this.targetEnergy === ZONE_TARGETS[3];
    const tau = isFalling ? 1.2 : (isRisingTowardOutside ? OUTSIDE_RISE_TAU : 1.8);
    this.energy += (this.targetEnergy - this.energy) * (1 - Math.exp(-dt / tau));

    if (this.isSustained) {
      this.sustainedTime = Math.min(1, this.sustainedTime + dt);
      this.sessionTime = Math.min(1, this.sessionTime + dt * 0.28);
    } else {
      this.sustainedTime = Math.max(0, this.sustainedTime - dt * 2.0);
      this.sessionTime = Math.max(0, this.sessionTime - dt * 1.2);
    }

    this.breathPhase += dt * 1.80;
    const ds = 1 + this.sustainedTime * 0.22 + this.sessionTime * 0.35;
    this.mp0 += dt * 0.32 * ds;
    this.mp1 += dt * 0.46 * ds;
    this.dr1 += dt * 0.048;
    this.dr2 += dt * 0.061;
    const e = Math.min(1, this.energy + this.sustainedTime * 0.18);
    this.orbitPhase += dt * mapE(e, 0, 0.18, 0.25, 0.30, 0.55, 0.55, 0.82, 1.10, 1.0, 1.40);

    const spawnInterval = e < 0.05 ? 99999 : mapE(e, 0.05, 3.8, 0.22, 2.8, 0.54, 1.2, 0.82, 0.42, 1.0, 0.24);
    const nowSec = now / 1000;
    if (nowSec - this.lastWaveSpawn > spawnInterval) {
      this.wavePool.push({ birth: nowSec });
      this.lastWaveSpawn = nowSec;
    }
    if (this.wavePool.length > 60) this.wavePool.splice(0, this.wavePool.length - 60);

    // Guarded, not left to throw uncaught: an exception here would abort
    // _draw() partway through every frame from here on (ctx.clearRect()
    // already ran, nothing after the throw point ever draws again) — a
    // silently, persistently blank canvas. Logging keeps that failure mode
    // loud instead of silent; clampRadius()/finite guards below are the
    // actual prevention, this is the net under them.
    try {
      this._draw(e, this.sessionTime, nowSec, dt);
    } catch (err) {
      console.error('[MezzoWaveVisualizer] _draw() failed — canvas will stay blank until this clears:', err, {
        energy: this.energy, r1Active: this.r1Active, r2Active: this.r2Active,
        r1DisplayRadius: this.r1DisplayRadius, r2DisplayRadius: this.r2DisplayRadius,
      });
    }
  }

  _draw(e, sess, nowSec, dt) {
    const ctx = this.ctx;
    const cw = this.el.offsetWidth || 240;
    const ch = this.el.offsetHeight || 220;
    ctx.clearRect(0, 0, cw, ch);
    const cx = cw / 2, cy = ch / 2;
    const scale = Math.min(cw, ch) / 280;
    const breath = Math.sin(this.breathPhase);
    const bs = 1 + 0.048 * breath;

    // Color follows the same smoothed display energy (e) as ring geometry,
    // preventing visual color flicker from raw microphone samples. `e` is
    // already this component's own eased, frame-rate-independent energy
    // (see _loop() above) — never the raw per-frame mic sample — so
    // colorProgressFromEnergy(e) (using the existing ZONE_TARGETS bounds,
    // not new thresholds) is the single source of truth for every color
    // output below: both ring strokes, the center orb, the radiating waves,
    // and the glow all read this same `ct`, rather than each animating its
    // own independent color curve.
    const ct = clamp(colorProgressFromEnergy(e), 0, 1);

    const r0 = clampRadius(34 * scale * bs);
    const r0dpx = r0 * mapE(e, 0, 0.004, 0.25, 0.006, 0.72, 0.012, 1.0, 0.030);

    // r1/r2 visibility ramps — raw energy thresholds, unchanged; still drive
    // each ring's own stroke alpha and deformation-amplitude scaling exactly
    // as before.
    const r1base = 54 * scale, r1target = clampRadius(r1base * bs);
    const r1vis = mapE(e, 0.38, 0, 0.54, 1.0);
    const r1da = mapE(e, 0.54, 0, 0.60, 4.0, 0.72, 5.0, 1.0, 6.0) * r1vis * scale;
    const r1dx = Math.sin(this.dr1) * r1da, r1dy = Math.cos(this.dr1 * 0.73 + 0.9) * r1da;

    const r2base = 76 * scale, r2target = clampRadius(r2base * bs);
    const r2vis = mapE(e, 0.62, 0, 0.80, 1.0);
    const r2da = mapE(e, 0.65, 0, 0.72, 0, 1.0, 4.5) * r2vis * scale;
    const r2dx = Math.sin(this.dr2) * r2da, r2dy = Math.cos(this.dr2 * 0.73 + 1.8) * r2da;

    // Ring activation, with hysteresis — see the R1/R2_ACTIVATE/DEACTIVATE_E
    // constants above. This (not r1vis/r2vis) is what now decides both
    // whether a ring is drawn at all and which ring radiates.
    const r1WasActive = this.r1Active;
    this.r1Active = this.r1Active ? e > R1_DEACTIVATE_E : e > R1_ACTIVATE_E;
    const r2WasActive = this.r2Active;
    this.r2Active = this.r2Active ? e > R2_DEACTIVATE_E : e > R2_ACTIVATE_E;

    // Emergence: on activation, start from whatever the previously-active
    // ring's current on-screen radius is (r0's live value for r1; r1's own
    // just-updated live value for r2 — falling back to r1's resting target
    // only if r1 isn't currently active, e.g. energy jumped straight past
    // r1's whole range in one step) and ease toward the ring's own resting
    // radius. On deactivation the ring is removed immediately — no shrink
    // animation — and its stored radius is cleared so the next activation
    // always starts fresh rather than resuming a stale value.
    if (this.r1Active) {
      if (!r1WasActive) this.r1DisplayRadius = r0;
      this.r1DisplayRadius = easeToward(this.r1DisplayRadius ?? r0, r1target, dt, EMERGE_TAU);
    } else {
      this.r1DisplayRadius = null;
    }
    const r1 = this.r1Active ? clampRadius(this.r1DisplayRadius) : r1target;
    const r1dpx = r1 * mapE(e, 0.38, 0, 0.54, 0.130, 0.72, 0.110, 1.0, 0.130) * r1vis;

    if (this.r2Active) {
      if (!r2WasActive) this.r2DisplayRadius = this.r1Active ? r1 : r1target;
      this.r2DisplayRadius = easeToward(this.r2DisplayRadius ?? r1target, r2target, dt, EMERGE_TAU);
    } else {
      this.r2DisplayRadius = null;
    }
    const r2 = this.r2Active ? clampRadius(this.r2DisplayRadius) : r2target;
    const r2dpx = r2 * mapE(e, 0.65, 0, 0.72, 0.060, 0.82, 0.095, 1.0, 0.145) * r2vis;

    // Active (radiating) ring — by activation state, not a 0.5 visibility
    // cutoff, so ownership transfers the instant a ring starts emerging
    // rather than partway through its fade-in.
    const aR = this.r2Active ? r2 : this.r1Active ? r1 : r0;
    const aDpx = this.r2Active ? r2dpx : this.r1Active ? r1dpx : r0dpx;
    const aDx = this.r2Active ? r2dx : this.r1Active ? r1dx : 0;
    const aDy = this.r2Active ? r2dy : this.r1Active ? r1dy : 0;
    const aP0 = this.r1Active && !this.r2Active ? this.mp0 + Math.PI * 0.7 : this.mp0;
    const aP1 = this.r1Active && !this.r2Active ? this.mp1 + Math.PI * 1.1 : this.mp1;

    // Glow — inner/outer radii both guarded finite/positive, outer forced
    // strictly greater than inner, so createRadialGradient() can never throw.
    const gs = mapE(e, 0, 0.018, 0.22, 0.028, 0.54, 0.050, 0.72, 0.085, 1.0, 0.110);
    const glowInner = clampRadius(aR * 0.7);
    const glowOuter = Math.max(glowInner + 0.001, clampRadius(aR * 1.55));
    const gr = ctx.createRadialGradient(cx + aDx, cy + aDy, glowInner, cx + aDx, cy + aDy, glowOuter);
    gr.addColorStop(0, rgba(ct, 0));
    gr.addColorStop(0.4, rgba(ct, gs));
    gr.addColorStop(1, rgba(ct, 0));
    ctx.beginPath(); ctx.arc(cx, cy, aR * 1.55, 0, Math.PI * 2); ctx.fillStyle = gr; ctx.fill();

    // Waves
    const wSpd = mapE(e, 0, 5, 0.22, 6, 0.54, 9, 0.82, 13, 1.0, 16) * scale;
    const wMax = Math.max(5, aR * 0.28);
    const wPk = mapE(e, 0.05, 0.14, 0.22, 0.20, 0.54, 0.30, 0.82, 0.44, 1.0, 0.54);
    this.wavePool = this.wavePool.filter((wave) => {
      const tr = (nowSec - wave.birth) * wSpd;
      if (tr > wMax) return false;
      const prog = tr / wMax, wR = aR + tr, wDpx = aDpx * (1 + tr / Math.max(1, aR) * 0.5);
      contourPath(ctx, cx, cy, aDx, aDy, wR, wDpx, aP0, aP1);
      ctx.strokeStyle = rgba(ct, wPk * (1 - prog));
      ctx.lineWidth = 1.3;
      ctx.stroke();
      return true;
    });

    // Drawn while active — removed immediately (no shrink tween) the frame
    // activation clears; r1vis/r2vis (unchanged) still drive each ring's own
    // fade-in alpha and are already ~0 through the short hysteresis window,
    // so this reads identically to before during ordinary rising energy.
    const sw = 2.0 + sess * 0.7;
    if (this.r2Active) { contourPath(ctx, cx, cy, r2dx, r2dy, r2, r2dpx, this.mp0, this.mp1); ctx.strokeStyle = rgba(ct, 0.44 * r2vis); ctx.lineWidth = sw; ctx.stroke(); }
    if (this.r1Active) { contourPath(ctx, cx, cy, r1dx, r1dy, r1, r1dpx, this.mp0 + Math.PI * 0.7, this.mp1 + Math.PI * 1.1); ctx.strokeStyle = rgba(ct, 0.48 * r1vis); ctx.lineWidth = sw; ctx.stroke(); }
    contourPath(ctx, cx, cy, 0, 0, r0, r0dpx, this.mp0, this.mp1); ctx.strokeStyle = rgba(ct, 0.52); ctx.lineWidth = sw; ctx.stroke();

    // Orbital highlight
    const hlV = mapE(e, 0.05, 0.14, 0.22, 0.70, 0.54, 0.70, 0.82, 0.85, 1.0, 1.0);
    if (hlV > 0.01) {
      const a = this.orbitPhase;
      const dHL = aDpx * (0.48 * Math.sin(2 * a + aP0) + 0.30 * Math.sin(3 * a + aP1) + 0.14 * Math.sin(4 * a - aP0 * 0.6 + 0.9) + 0.08 * Math.sin(5 * a + aP1 * 0.8 + 2.1));
      const rrHL = Math.max(3, aR + dHL);
      const hx = cx + aDx + rrHL * Math.cos(a), hy = cy + aDy + rrHL * Math.sin(a);
      const hlG = ctx.createRadialGradient(hx, hy, 0, hx, hy, 16 * scale);
      hlG.addColorStop(0, rgba(ct, 0.22 * hlV));
      hlG.addColorStop(1, rgba(ct, 0));
      ctx.beginPath(); ctx.arc(hx, hy, 16 * scale, 0, Math.PI * 2); ctx.fillStyle = hlG; ctx.fill();
      ctx.beginPath(); ctx.arc(hx, hy, 3.2 * scale, 0, Math.PI * 2); ctx.fillStyle = rgba(ct, 0.85 * hlV); ctx.fill();
    }

    // Center dot
    ctx.shadowBlur = (5 + 4 * (0.5 + 0.5 * breath)) * scale;
    ctx.shadowColor = rgba(ct, 0.30);
    ctx.beginPath(); ctx.arc(cx, cy, 3.2 * bs * scale, 0, Math.PI * 2);
    ctx.fillStyle = rgba(ct, 0.62 + 0.24 * (0.5 + 0.5 * breath));
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}
