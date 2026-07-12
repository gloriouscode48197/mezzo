/**
 * Hero Ring — ambient animated background visualization for the landing
 * page hero. Pure rendering logic with no knowledge of page layout beyond
 * the canvas element it's given, so index.html only wires up markup, not
 * animation math.
 *
 * Respects prefers-reduced-motion: draws a single static frame and never
 * schedules another, instead of looping indefinitely.
 */

const SIZE = 600;

function rgba(a) {
  return 'rgba(196,178,151,' + a.toFixed(3) + ')';
}

function contour(ctx, r, dpx, p0, p1) {
  ctx.beginPath();
  for (let j = 0; j <= 160; j++) {
    const a = (j / 160) * Math.PI * 2;
    const d = dpx * (0.48 * Math.sin(2 * a + p0) + 0.30 * Math.sin(3 * a + p1) + 0.14 * Math.sin(4 * a - p0 * 0.6 + 0.9) + 0.08 * Math.sin(5 * a + p1 * 0.8 + 2.1));
    const rr = Math.max(3, r + d);
    const x = SIZE / 2 + rr * Math.cos(a), y = SIZE / 2 + rr * Math.sin(a);
    j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function initHeroRing(canvas) {
  if (!canvas) return;

  // Deliberately capped at 1, NOT window.devicePixelRatio — a full-size
  // (600px) canvas with a real retina backing store (1200px+) here has been
  // confirmed to trigger a Chromium compositor bug that mis-paints and
  // shifts unrelated sibling content elsewhere on the page on 2x+ displays
  // (reproduced directly: removing this canvas, or capping its backing
  // store, eliminates the corruption — nothing else about the layout
  // changes). The animation itself is a soft, thin-stroke ambient graphic;
  // it doesn't need retina sharpness, so this is a safe trade, not a
  // workaround with a visible cost.
  const dpr = Math.min(window.devicePixelRatio || 1, 1);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.width = SIZE + 'px';
  canvas.style.height = SIZE + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let breathPhase = 0, mp0 = 1.1, mp1 = 2.4, orbitPhase = 0, last = 0;

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    const bs = 1 + 0.048 * Math.sin(breathPhase);
    const cx = SIZE / 2, cy = SIZE / 2;

    [{ r: 110, dpx: 7 }, { r: 175, dpx: 16 }, { r: 248, dpx: 25 }].forEach((ring, i) => {
      const rB = ring.r * bs;
      contour(ctx, rB, ring.dpx, mp0, mp1);
      ctx.strokeStyle = rgba([0.60, 0.46, 0.30][i]);
      ctx.lineWidth = 2.1;
      ctx.stroke();
    });

    // Orbital highlight
    const aR = 175 * bs, a = orbitPhase;
    const dHL = aR * 0.009 * (0.48 * Math.sin(2 * a + mp0) + 0.30 * Math.sin(3 * a + mp1));
    const rHL = Math.max(3, aR + dHL);
    const hx = cx + rHL * Math.cos(a), hy = cy + rHL * Math.sin(a);
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 14);
    g.addColorStop(0, rgba(0.55)); g.addColorStop(1, rgba(0));
    ctx.beginPath(); ctx.arc(hx, hy, 14, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2); ctx.fillStyle = rgba(0.82); ctx.fill();

    ctx.shadowBlur = 6; ctx.shadowColor = rgba(0.42);
    ctx.beginPath(); ctx.arc(cx, cy, 3.2 * bs, 0, Math.PI * 2);
    ctx.fillStyle = rgba(0.78); ctx.fill();
    ctx.shadowBlur = 0;
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    breathPhase += dt * 1.70;
    mp0 += dt * 0.14; mp1 += dt * 0.20;
    orbitPhase += dt * 0.28;
    draw();
    if (!reduceMotion) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
