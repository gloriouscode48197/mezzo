/**
 * MezzoVoiceCircle — Self-contained voice visualization component
 *
 * Renders an organic, breathing circle that responds to voice volume.
 * Uses the pre-made SVG brush-stroke assets (4 ring levels × 3 variants).
 *
 * RING STACKING: All 4 ring layers (ring-0 through ring-3) are rendered
 * simultaneously, absolutely positioned on top of each other. Ring-0 is
 * always visible. Higher rings fade in/out as volume crosses thresholds.
 * Each ring layer independently cycles through its 3 SVG variants.
 *
 * Pure renderer: takes a pre-computed zone (0-3) and a sustained-outside
 * flag from the caller (src/engine.js owns volume classification,
 * monitoring.js owns the sustained-duration timer) — it does not read raw
 * RMS or compute thresholds itself, so the rings and the status label can
 * never disagree about what state the app is in.
 *
 * Outside-of-range feedback is communicated entirely through color (gray →
 * Mezzo orange, via a CSS filter — no colored SVG variants exist or are
 * needed) and organic ring drift that escalates once sustained. The
 * background never changes and there is no blinking.
 *
 * Works in both full webpage and PiP windows — scales to fill its container.
 *
 * Usage:
 *   const circle = new MezzoVoiceCircle(containerEl, { assetPath: 'assets' });
 *   // On each audio frame:
 *   circle.update(zone, isSustained);
 *   // Cleanup:
 *   circle.destroy();
 *
 * Requires: design-tokens/mezzo-tokens.css loaded in the same document.
 */

// =============================================================================
// Constants
// =============================================================================

const VARIANT_COUNT = 3;
const RING_COUNT = 4;

// Staggered cycle durations per ring so layers don't breathe in sync
const VARIANT_CYCLE_MS = [2500, 2800, 2300, 3100];

// Each ring layer's size as a percentage of the stage container.
// Derived from design tokens: within(90) / elevated(160) / sustained(240) / container(280).
const RING_SIZE_PCT = [
  (90 / 280) * 100,   // ring-0: ~32.14%
  (160 / 280) * 100,  // ring-1: ~57.14%
  (240 / 280) * 100,  // ring-2: ~85.71%
  100,                 // ring-3: 100%
];

// =============================================================================
// Component CSS (injected into host document)
// =============================================================================

const COMPONENT_CSS = `
/* ── Voice Circle Container ── */
.mezzo-circle {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  container-type: size;
  background: var(--surface);
  overflow: hidden;
}

/* ── Circle Stage (constant size, always pulsing) ── */
.mezzo-circle-stage {
  width: var(--circle-container);
  height: var(--circle-container);
  position: relative;
  animation: mezzo-pulse 4s ease-in-out infinite;
}

/* ── Ring Layer (one per ring level, stacked) ── */
.mezzo-ring-layer {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  opacity: 0;
  transition: opacity 350ms ease;
  pointer-events: none;
}

.mezzo-ring-layer.ring-visible {
  opacity: 1;
}

/* ── SVG Images inside each ring layer (crossfade for variant cycling) ── */
.mezzo-ring-img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 1.2s ease, filter 450ms ease;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

.mezzo-ring-img.visible {
  opacity: 1;
}

/* ── Outside-of-range tint: neutral gray -> Mezzo orange (#C4593A), no new
   colored assets needed — the brush-stroke art is plain warm gray, so this
   filter shifts hue/saturation while preserving its shading. ── */
.mezzo-circle-stage.is-outside .mezzo-ring-img {
  filter: grayscale(1) sepia(1) saturate(900%) hue-rotate(335deg) brightness(0.82);
}

/* ── Keyframes ── */
@keyframes mezzo-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}

/* ── Organic ring drift (rings 1-3 only — the center circle stays fixed).
   Amplitude is scaled by --drift-scale so "subtle" and "active" reuse the
   same waypoint shapes; each ring has a different shape/phase so they never
   move in lockstep. ── */
@keyframes mezzo-drift-1 {
  0%, 100% { transform: translate(calc(-50% + (2.5px * var(--drift-scale, 1))), calc(-50% - (1.5px * var(--drift-scale, 1)))); }
  33% { transform: translate(calc(-50% - (2px * var(--drift-scale, 1))), calc(-50% + (2.5px * var(--drift-scale, 1)))); }
  66% { transform: translate(calc(-50% + (1.5px * var(--drift-scale, 1))), calc(-50% + (2px * var(--drift-scale, 1)))); }
}
@keyframes mezzo-drift-2 {
  0%, 100% { transform: translate(calc(-50% - (2.5px * var(--drift-scale, 1))), calc(-50% + (2px * var(--drift-scale, 1)))); }
  40% { transform: translate(calc(-50% + (2px * var(--drift-scale, 1))), calc(-50% - (1.5px * var(--drift-scale, 1)))); }
  75% { transform: translate(calc(-50% - (1px * var(--drift-scale, 1))), calc(-50% - (2.5px * var(--drift-scale, 1)))); }
}
@keyframes mezzo-drift-3 {
  0%, 100% { transform: translate(calc(-50% + (1.8px * var(--drift-scale, 1))), calc(-50% + (2.5px * var(--drift-scale, 1)))); }
  50% { transform: translate(calc(-50% - (2.5px * var(--drift-scale, 1))), calc(-50% - (1.8px * var(--drift-scale, 1)))); }
  80% { transform: translate(calc(-50% + (1.2px * var(--drift-scale, 1))), calc(-50% - (2px * var(--drift-scale, 1)))); }
}

.mezzo-ring-layer:nth-child(2).drift-subtle { --drift-scale: 1; animation: mezzo-drift-1 3.6s ease-in-out infinite; }
.mezzo-ring-layer:nth-child(3).drift-subtle { --drift-scale: 1; animation: mezzo-drift-2 4.1s ease-in-out infinite; }
.mezzo-ring-layer:nth-child(4).drift-subtle { --drift-scale: 1; animation: mezzo-drift-3 3.3s ease-in-out infinite; }

.mezzo-ring-layer:nth-child(2).drift-active { --drift-scale: 2.2; animation: mezzo-drift-1 1.8s ease-in-out infinite; }
.mezzo-ring-layer:nth-child(3).drift-active { --drift-scale: 2.2; animation: mezzo-drift-2 2.1s ease-in-out infinite; }
.mezzo-ring-layer:nth-child(4).drift-active { --drift-scale: 2.2; animation: mezzo-drift-3 1.6s ease-in-out infinite; }
`;

// =============================================================================
// MezzoVoiceCircle Class
// =============================================================================

export class MezzoVoiceCircle {
  /**
   * @param {HTMLElement} container — Element to render into (fills 100% of it)
   * @param {Object} [options]
   * @param {string} [options.assetPath='assets'] — Path to the SVG circle assets
   */
  constructor(container, options = {}) {
    this.container = container;
    this.assetPath = options.assetPath ?? 'assets';

    // ── Visual state ──
    this.currentZone = 0;

    // ── DOM references ──
    this.el = null;
    this.stage = null;

    /**
     * Each entry: { ring, visible, activeImg, variant, el, imgs[], interval }
     *  - ring:      0-3 (which ring level this layer represents)
     *  - visible:   boolean (is this layer currently shown)
     *  - activeImg: 0 or 1 (which img in the crossfade pair is currently visible)
     *  - variant:   0-2 (current variant in the cycle)
     *  - el:        the wrapper div (.mezzo-ring-layer)
     *  - imgs:      [img0, img1] crossfade pair
     *  - interval:  setInterval id for variant cycling
     */
    this.ringLayers = [];

    // ── Build ──
    this._injectCSS();
    this._createDOM();
    this._startVariantCycles();
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Update the visualization with the current classification.
   * Call this on each audio frame (every 25-50 ms). The component
   * only touches the DOM when something actually changes.
   *
   * @param {number} zone         — 0-3, pre-computed by src/engine.js
   * @param {boolean} isSustained — Whether zone 3 has held continuously for
   *   monitoring.js's sustained-duration window (escalates ring drift)
   */
  update(zone, isSustained = false) {
    if (zone !== this.currentZone) {
      this.currentZone = zone;
      this._updateRingVisibility();
    }

    const isOutside = zone === 3;
    this.stage.classList.toggle('is-outside', isOutside);

    // Drift only applies to rings 1-3; the center circle (ring-0) stays fixed.
    for (let i = 1; i < RING_COUNT; i++) {
      const layerEl = this.ringLayers[i].el;
      layerEl.classList.toggle('drift-subtle', isOutside && !isSustained);
      layerEl.classList.toggle('drift-active', isOutside && isSustained);
    }
  }

  /**
   * Remove all DOM elements and stop timers.
   */
  destroy() {
    for (const layer of this.ringLayers) {
      if (layer.interval) {
        clearInterval(layer.interval);
        layer.interval = null;
      }
      for (const img of layer.imgs) {
        if (img) img.onload = null;
      }
    }
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
  }

  // ===========================================================================
  // DOM Setup
  // ===========================================================================

  /** Inject component CSS into the host document (once per document). */
  _injectCSS() {
    const doc = this.container.ownerDocument;
    if (doc.getElementById('mezzo-voice-circle-css')) return;
    const style = doc.createElement('style');
    style.id = 'mezzo-voice-circle-css';
    style.textContent = COMPONENT_CSS;
    doc.head.appendChild(style);
  }

  /** Build the component's DOM tree inside the container. */
  _createDOM() {
    const doc = this.container.ownerDocument;

    // Wrapper (flex-centered, fills container, owns background)
    this.el = doc.createElement('div');
    this.el.className = 'mezzo-circle';

    // Stage (constant size, carries the pulse animation)
    this.stage = doc.createElement('div');
    this.stage.className = 'mezzo-circle-stage';

    // Create 4 ring layers, each with a crossfade pair of images
    for (let ring = 0; ring < RING_COUNT; ring++) {
      const layerEl = doc.createElement('div');
      layerEl.className = 'mezzo-ring-layer';

      // Size each ring layer proportionally
      const pct = RING_SIZE_PCT[ring] + '%';
      layerEl.style.width = pct;
      layerEl.style.height = pct;

      // Ring-0 starts visible; others start hidden
      if (ring === 0) {
        layerEl.classList.add('ring-visible');
      }

      const imgs = [];
      for (let j = 0; j < 2; j++) {
        const img = doc.createElement('img');
        img.className = 'mezzo-ring-img';
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        img.draggable = false;
        imgs.push(img);
        layerEl.appendChild(img);
      }

      // Load initial asset — first image visible, ready for crossfade
      imgs[0].src = this._assetUrl(ring, 0);
      imgs[0].classList.add('visible');

      this.ringLayers.push({
        ring,
        visible: ring === 0,
        activeImg: 0,
        variant: 0,
        el: layerEl,
        imgs,
        interval: null,
      });

      this.stage.appendChild(layerEl);
    }

    this.el.appendChild(this.stage);
    this.container.appendChild(this.el);
  }

  // ===========================================================================
  // Asset URL
  // ===========================================================================

  /**
   * Build the SVG asset URL.
   * Pattern: light-bg-circle-ring-{ring}-{variant}.svg — always the "light"
   * asset variant. Outside-of-range feedback is a color filter (gray ->
   * orange), not an asset swap, and the background no longer changes.
   */
  _assetUrl(ring, variant) {
    return `${this.assetPath}/light-bg-circle-ring-${ring}-${variant}.svg`;
  }

  // ===========================================================================
  // Ring Visibility (additive stacking)
  // ===========================================================================

  /**
   * Show all ring layers up to and including currentZone.
   * Ring-0 is always visible. Higher rings fade in/out via CSS transition.
   */
  _updateRingVisibility() {
    for (let i = 0; i < RING_COUNT; i++) {
      const layer = this.ringLayers[i];
      const shouldBeVisible = i <= this.currentZone;
      if (shouldBeVisible !== layer.visible) {
        layer.visible = shouldBeVisible;
        layer.el.classList.toggle('ring-visible', shouldBeVisible);
      }
    }
  }

  // ===========================================================================
  // Per-Layer Crossfade
  // ===========================================================================

  /**
   * Crossfade a single ring layer to a new image.
   * Uses onload gating so the transition only begins once the image is ready.
   */
  _crossfadeLayer(layer, src) {
    const nextIdx = 1 - layer.activeImg;
    const nextImg = layer.imgs[nextIdx];
    const prevImg = layer.imgs[layer.activeImg];
    let applied = false;

    const applyTransition = () => {
      if (applied) return;
      applied = true;
      nextImg.classList.add('visible');
      prevImg.classList.remove('visible');
      layer.activeImg = nextIdx;
    };

    nextImg.onload = () => {
      applyTransition();
      nextImg.onload = null;
    };

    nextImg.src = src;

    // If already cached the browser may not fire onload — handle synchronously
    if (nextImg.complete && nextImg.naturalWidth > 0) {
      applyTransition();
      nextImg.onload = null;
    }
  }

  // ===========================================================================
  // Variant Cycling (independent per layer)
  // ===========================================================================

  /**
   * Start variant cycling for each ring layer on staggered timers.
   * Each ring cycles through its 3 brush-stroke variants independently,
   * creating organic, unsynchronized breathing across all visible rings.
   */
  _startVariantCycles() {
    for (let i = 0; i < RING_COUNT; i++) {
      const layer = this.ringLayers[i];
      layer.interval = setInterval(() => {
        layer.variant = (layer.variant + 1) % VARIANT_COUNT;
        this._crossfadeLayer(layer, this._assetUrl(layer.ring, layer.variant));
      }, VARIANT_CYCLE_MS[i]);
    }
  }
}
