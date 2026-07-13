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

const COMPONENT_CSS = `
.mezzo-wave {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.mezzo-wave-canvas {
  display: block;
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

function rgba(ct, a) {
  const r = Math.round(172 + (196 - 172) * ct);
  const g = Math.round(158 + (89 - 158) * ct);
  const b = Math.round(136 + (58 - 136) * ct);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
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
    const dpr = window.devicePixelRatio || 1;
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

    const tau = this.energy > this.targetEnergy ? 1.2 : 1.8;
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

    this._draw(e, this.sessionTime, nowSec);
  }

  _draw(e, sess, nowSec) {
    const ctx = this.ctx;
    const cw = this.el.offsetWidth || 240;
    const ch = this.el.offsetHeight || 220;
    ctx.clearRect(0, 0, cw, ch);
    const cx = cw / 2, cy = ch / 2;
    const scale = Math.min(cw, ch) / 280;
    const breath = Math.sin(this.breathPhase);
    const bs = 1 + 0.048 * breath;

    const ct0 = mapE(e, 0.72, 0, 1.0, 1.0);
    const ct1 = mapE(e, 0.60, 0, 0.72, 0.30, 1.0, 1.0);
    const ct2 = mapE(e, 0.54, 0, 0.65, 0.18, 0.72, 0.60, 1.0, 1.0);
    const ctDot = mapE(e, 0.68, 0, 0.72, 0.10, 1.0, 1.0);

    const r0 = 34 * scale * bs, r0dpx = r0 * mapE(e, 0, 0.004, 0.25, 0.006, 0.72, 0.012, 1.0, 0.030);
    const r1base = 54 * scale, r1 = r1base * bs;
    const r1vis = mapE(e, 0.38, 0, 0.54, 1.0);
    const r1dpx = r1 * mapE(e, 0.38, 0, 0.54, 0.130, 0.72, 0.110, 1.0, 0.130) * r1vis;
    const r1da = mapE(e, 0.54, 0, 0.60, 4.0, 0.72, 5.0, 1.0, 6.0) * r1vis * scale;
    const r1dx = Math.sin(this.dr1) * r1da, r1dy = Math.cos(this.dr1 * 0.73 + 0.9) * r1da;

    const r2base = 76 * scale, r2 = r2base * bs;
    const r2vis = mapE(e, 0.62, 0, 0.80, 1.0);
    const r2dpx = r2 * mapE(e, 0.65, 0, 0.72, 0.060, 0.82, 0.095, 1.0, 0.145) * r2vis;
    const r2da = mapE(e, 0.65, 0, 0.72, 0, 1.0, 4.5) * r2vis * scale;
    const r2dx = Math.sin(this.dr2) * r2da, r2dy = Math.cos(this.dr2 * 0.73 + 1.8) * r2da;

    const aR = r1vis > 0.5 && r2vis > 0.5 ? r2 : r1vis > 0.5 ? r1 : r0;
    const aDpx = r1vis > 0.5 && r2vis > 0.5 ? r2dpx : r1vis > 0.5 ? r1dpx : r0dpx;
    const aDx = r1vis > 0.5 && r2vis > 0.5 ? r2dx : r1vis > 0.5 ? r1dx : 0;
    const aDy = r1vis > 0.5 && r2vis > 0.5 ? r2dy : r1vis > 0.5 ? r1dy : 0;
    const aCT = r1vis > 0.5 && r2vis > 0.5 ? ct2 : r1vis > 0.5 ? ct1 : ct0;
    const aP0 = r1vis > 0.5 && r2vis < 0.5 ? this.mp0 + Math.PI * 0.7 : this.mp0;
    const aP1 = r1vis > 0.5 && r2vis < 0.5 ? this.mp1 + Math.PI * 1.1 : this.mp1;

    // Glow
    const gs = mapE(e, 0, 0.018, 0.22, 0.028, 0.54, 0.050, 0.72, 0.085, 1.0, 0.110);
    const gr = ctx.createRadialGradient(cx + aDx, cy + aDy, aR * 0.7, cx + aDx, cy + aDy, aR * 1.55);
    gr.addColorStop(0, rgba(aCT, 0));
    gr.addColorStop(0.4, rgba(aCT, gs));
    gr.addColorStop(1, rgba(aCT, 0));
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
      ctx.strokeStyle = rgba(aCT, wPk * (1 - prog));
      ctx.lineWidth = 1.3;
      ctx.stroke();
      return true;
    });

    const sw = 2.0 + sess * 0.7;
    if (r2vis > 0.02) { contourPath(ctx, cx, cy, r2dx, r2dy, r2, r2dpx, this.mp0, this.mp1); ctx.strokeStyle = rgba(ct2, 0.44 * r2vis); ctx.lineWidth = sw; ctx.stroke(); }
    if (r1vis > 0.02) { contourPath(ctx, cx, cy, r1dx, r1dy, r1, r1dpx, this.mp0 + Math.PI * 0.7, this.mp1 + Math.PI * 1.1); ctx.strokeStyle = rgba(ct1, 0.48 * r1vis); ctx.lineWidth = sw; ctx.stroke(); }
    contourPath(ctx, cx, cy, 0, 0, r0, r0dpx, this.mp0, this.mp1); ctx.strokeStyle = rgba(ct0, 0.52); ctx.lineWidth = sw; ctx.stroke();

    // Orbital highlight
    const hlV = mapE(e, 0.05, 0.14, 0.22, 0.70, 0.54, 0.70, 0.82, 0.85, 1.0, 1.0);
    if (hlV > 0.01) {
      const a = this.orbitPhase;
      const dHL = aDpx * (0.48 * Math.sin(2 * a + aP0) + 0.30 * Math.sin(3 * a + aP1) + 0.14 * Math.sin(4 * a - aP0 * 0.6 + 0.9) + 0.08 * Math.sin(5 * a + aP1 * 0.8 + 2.1));
      const rrHL = Math.max(3, aR + dHL);
      const hx = cx + aDx + rrHL * Math.cos(a), hy = cy + aDy + rrHL * Math.sin(a);
      const hlG = ctx.createRadialGradient(hx, hy, 0, hx, hy, 16 * scale);
      hlG.addColorStop(0, rgba(aCT, 0.22 * hlV));
      hlG.addColorStop(1, rgba(aCT, 0));
      ctx.beginPath(); ctx.arc(hx, hy, 16 * scale, 0, Math.PI * 2); ctx.fillStyle = hlG; ctx.fill();
      ctx.beginPath(); ctx.arc(hx, hy, 3.2 * scale, 0, Math.PI * 2); ctx.fillStyle = rgba(aCT, 0.85 * hlV); ctx.fill();
    }

    // Center dot
    ctx.shadowBlur = (5 + 4 * (0.5 + 0.5 * breath)) * scale;
    ctx.shadowColor = rgba(ctDot, 0.30);
    ctx.beginPath(); ctx.arc(cx, cy, 3.2 * bs * scale, 0, Math.PI * 2);
    ctx.fillStyle = rgba(ctDot, 0.62 + 0.24 * (0.5 + 0.5 * breath));
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}
