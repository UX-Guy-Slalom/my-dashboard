/**
 * blob-physics.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Self-contained floating-blob physics engine with pointer interaction.
 * Drop this file into any page alongside the matching blob HTML/CSS and point
 * the selectors below at your elements — no other dependencies required.
 *
 * Quick-start:
 *   <script src="blob-physics.js"></script>
 *
 * All tuneable values live in the CONFIG object directly below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

(function () {

  // ============================================================
  //  CONFIGURATION
  //  Adjust anything here — no need to touch the engine below.
  // ============================================================

  // ── Blob definitions ─────────────────────────────────────────────────────
  // selector   : CSS selector for the blob element
  // visualSize : element width/height in px (used to centre the transform)
  // radius     : collision/mass radius in px (the invisible "hard" body)
  // speed      : nominal cruising speed in px/s
  const BLOBS = [
    { selector: '.blob-1', visualSize: 500, radius: 80, speed: 22 },
    { selector: '.blob-2', visualSize: 380, radius: 70, speed: 28 },
    { selector: '.blob-3', visualSize: 300, radius: 60, speed: 18 },
  ];

  const PHYSICS = {

    // ── Speed limits ────────────────────────────────────────────────────────
    speedMinFactor:  0.40,   // minimum speed = blob.speed × factor - default 0.40
    speedMaxFactor:  1.55,   // maximum speed = blob.speed × factor - default 1.55

    // ── Squash & stretch ────────────────────────────────────────────────────
    stretchMax:      0.08,   // max elongation along velocity axis (0.08 = 8%)
    stretchSide:     0.60,   // perpendicular compression factor (relative to stretch)

    squashMagnitude: 0.15,   // scale reduction on the impact axis (0.15 = 15%)
    squashSide:      0.70,   // perpendicular stretch factor (relative to squash)
    squashSnap:      0.45,   // fraction of squash applied instantly vs lerped (0–1)

    // How fast the scale lerps toward its target value.
    // Higher = snappier response. ~9 settles in ≈100 ms.
    scaleSnapSpeed:  9,

    // How fast the target scale decays back to neutral (1.0).
    // Lower = longer recovery. ~2.2 ≈ 450 ms half-life.
    scaleDecaySpeed: 2.2,

    // ── Brightness flash on impact ──────────────────────────────────────────
    flashPeak:       3,    // brightness() multiplier at moment of impact
    // How fast brightness fades back to 1.0 after a flash.
    // Lower = longer fade. ~1.2 ≈ 1.5–2 s fade.
    flashDecaySpeed: 1.0,

    // ── Visual blur ────────────────────────────────────────────────────────
    // Applied via JS filter so it correctly combines with brightness.
    // Should match the blur() value in your CSS .blob rule.
    blurPx:          72 ,     // px - default 72px

    // ── Pointer / touch interaction ─────────────────────────────────────────
    pointerEnabled:       true,
    pointerRepelRadius:   190,  // soft-repulsion zone radius (px)
    pointerRepelForce:    900,  // peak repulsion acceleration at contact edge (px/s²)
    pointerContactRadius: 22,   // treat the pointer as a solid circle of this radius (px)
                                // hard contact triggers a squash flash just like a wall hit

    // ── Collision objects ───────────────────────────────────────────────────
    wallBounce:    true,         // bounce off the viewport edges
    cardSelector:  '.card',      // CSS selector for an obstacle rectangle, or null to disable
    cardBreakpoint: 520,         // disable card collisions when viewport width is ≤ this (px)
                                 // set to 0 to always collide, or Infinity to always skip

    // ── Timing ─────────────────────────────────────────────────────────────
    dtCap:           0.10,   // max timestep (s) — prevents tunneling after tab becomes active
    resizeDebounce:  120,    // ms to wait after a resize event before recalculating bounds

  };

  // ============================================================
  //  ENGINE  (edit below only if you know what you're doing)
  // ============================================================

  // Respect the user's reduced-motion preference — leave blobs static.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // ── Internal state ─────────────────────────────────────────────────────────
  let W = 0, H = 0, obstacleRect = null, lastTs = null, started = false;

  /** Resolves obstacleRect, honouring cardBreakpoint. */
  function resolveObstacleRect() {
    if (!PHYSICS.cardSelector) return null;
    if (window.innerWidth <= PHYSICS.cardBreakpoint) return null;
    return document.querySelector(PHYSICS.cardSelector)?.getBoundingClientRect() ?? null;
  }

  const pointer = { x: -9999, y: -9999, active: false };

  // Build runtime blob objects from BLOBS config.
  const blobs = BLOBS.map(cfg => {
    const el = document.querySelector(cfg.selector);
    if (!el) {
      console.warn(`blob-physics: element not found for selector "${cfg.selector}"`);
      return null;
    }
    return {
      el,
      vis:    cfg.visualSize,
      r:      cfg.radius,
      minSpd: cfg.speed * PHYSICS.speedMinFactor,
      maxSpd: cfg.speed * PHYSICS.speedMaxFactor,
      nomSpd: cfg.speed,
      cx: 0, cy: 0,         // centre position (px)
      vx: 0, vy: 0,         // velocity (px/s)
      sx: 1, sy: 1,         // current applied scale
      tsx: 1, tsy: 1,       // target scale
      ang: 0,               // stretch-axis angle (radians)
      brightness: 1,        // luminance multiplier — flashes on impact
      hitRecovery: false,   // true while recovering from a squash impact
    };
  }).filter(Boolean);  // drop any null entries (missing elements)

  // ── Helpers ────────────────────────────────────────────────────────────────

  function randAngle() {
    return Math.random() * Math.PI * 2;
  }

  /** Clamps blob speed to [minSpd, maxSpd]; assigns a random direction if stationary or NaN. */
  function enforceSpeed(b) {
    const s = Math.hypot(b.vx, b.vy);
    if (!isFinite(s) || s === 0) {
      // Covers zero, NaN, and Infinity — all get a fresh random direction
      const a = randAngle();
      b.vx = Math.cos(a) * b.minSpd;
      b.vy = Math.sin(a) * b.minSpd;
    } else if (s > b.maxSpd) {
      const k = b.maxSpd / s; b.vx *= k; b.vy *= k;
    } else if (s < b.minSpd) {
      const k = b.minSpd / s; b.vx *= k; b.vy *= k;
    }
  }

  /**
   * Applies squash deformation along the collision normal (nx, ny) and
   * triggers the brightness flash.
   */
  function squashHit(b, nx, ny) {
    b.ang = Math.atan2(ny, nx);
    b.tsx = 1 - PHYSICS.squashMagnitude;
    b.tsy = 1 + PHYSICS.squashMagnitude * PHYSICS.squashSide;
    // Snap partway immediately for snappy impact feel
    b.sx = b.sx * (1 - PHYSICS.squashSnap) + b.tsx * PHYSICS.squashSnap;
    b.sy = b.sy * (1 - PHYSICS.squashSnap) + b.tsy * PHYSICS.squashSnap;
    b.brightness = PHYSICS.flashPeak;
    b.hitRecovery = true;   // enter recovery mode — suppress motion stretch until settled
  }

  // ── Collision resolvers ────────────────────────────────────────────────────

  /** Bounces blob off all four viewport edges. */
  function wallBounce(b) {
    if (!PHYSICS.wallBounce) return;
    const r = b.r;
    if (b.cx - r < 0)  { b.cx = r;     if (b.vx < 0) { b.vx = -b.vx; squashHit(b,  1,  0); } }
    if (b.cx + r > W)  { b.cx = W - r; if (b.vx > 0) { b.vx = -b.vx; squashHit(b, -1,  0); } }
    if (b.cy - r < 0)  { b.cy = r;     if (b.vy < 0) { b.vy = -b.vy; squashHit(b,  0,  1); } }
    if (b.cy + r > H)  { b.cy = H - r; if (b.vy > 0) { b.vy = -b.vy; squashHit(b,  0, -1); } }
    enforceSpeed(b);
  }

  /** Bounces blob off the configured card/obstacle rectangle. */
  function obstacleeBounce(b) {
    if (!obstacleRect) return;
    const { left, right, top, bottom } = obstacleRect;
    const r = b.r;
    // Nearest point ON (or inside) the rectangle to blob centre
    const nearX = Math.max(left,  Math.min(right,  b.cx));
    const nearY = Math.max(top,   Math.min(bottom, b.cy));
    const dx = b.cx - nearX, dy = b.cy - nearY;
    const dist2 = dx * dx + dy * dy;
    if (dist2 >= r * r) return;   // no overlap

    let nx, ny;
    if (dist2 < 0.0001) {
      // Blob centre is inside the rectangle — find the shortest escape to any edge
      // and eject along that axis so the blob doesn't get permanently stuck.
      const toLeft   = b.cx - left;
      const toRight  = right  - b.cx;
      const toTop    = b.cy - top;
      const toBottom = bottom - b.cy;
      const shortest = Math.min(toLeft, toRight, toTop, toBottom);
      if      (shortest === toLeft)   { nx = -1; ny =  0; b.cx = left   - r; }
      else if (shortest === toRight)  { nx =  1; ny =  0; b.cx = right  + r; }
      else if (shortest === toTop)    { nx =  0; ny = -1; b.cy = top    - r; }
      else                            { nx =  0; ny =  1; b.cy = bottom + r; }
    } else {
      const dist = Math.sqrt(dist2);
      nx = dx / dist; ny = dy / dist;
      b.cx = nearX + nx * r;      // push mass centre outside obstacle
      b.cy = nearY + ny * r;
    }

    const dot = b.vx * nx + b.vy * ny;
    if (dot < 0) {                // only reflect if moving into obstacle
      b.vx -= 2 * dot * nx;
      b.vy -= 2 * dot * ny;
      squashHit(b, nx, ny);
    }
    enforceSpeed(b);
  }

  /** Equal-mass elastic collision between two blobs. */
  function blobBounce(a, b) {
    const dx = b.cx - a.cx, dy = b.cy - a.cy;
    const dist = Math.hypot(dx, dy);
    const minD = a.r + b.r;
    if (dist >= minD || dist < 0.01) return;
    const nx = dx / dist, ny = dy / dist;
    const push = (minD - dist) * 0.5;
    a.cx -= nx * push; a.cy -= ny * push;
    b.cx += nx * push; b.cy += ny * push;
    // Exchange velocity components along collision normal (elastic, equal mass).
    // nx/ny points FROM a TO b, so dv > 0 means the blobs are approaching —
    // apply the impulse. dv < 0 means they're already separating — skip.
    const dv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (dv < 0) return;   // already separating, nothing to do
    a.vx -= dv * nx; a.vy -= dv * ny;
    b.vx += dv * nx; b.vy += dv * ny;
    squashHit(a, -nx, -ny);
    squashHit(b,  nx,  ny);
    enforceSpeed(a);
    enforceSpeed(b);
  }

  /**
   * Applies soft quadratic repulsion from the pointer inside the repel zone,
   * and a hard elastic reflection if the pointer penetrates the blob's radius.
   */
  function pointerRepel(b, dt) {
    if (!PHYSICS.pointerEnabled || !pointer.active) return;
    const dx = b.cx - pointer.x;
    const dy = b.cy - pointer.y;
    const dist = Math.hypot(dx, dy) || 0.01;
    const minD = b.r + PHYSICS.pointerContactRadius;

    if (dist < minD) {
      // Hard contact — push out and reflect velocity
      const nx = dx / dist, ny = dy / dist;
      b.cx = pointer.x + nx * minD;
      b.cy = pointer.y + ny * minD;
      const dot = b.vx * nx + b.vy * ny;
      if (dot < 0) {
        b.vx -= 2 * dot * nx;
        b.vy -= 2 * dot * ny;
        squashHit(b, nx, ny);
      }
      enforceSpeed(b);
    } else if (dist < PHYSICS.pointerRepelRadius) {
      // Soft repulsion — quadratic falloff to zero at the zone boundary
      const t = 1 - dist / PHYSICS.pointerRepelRadius;
      const f = t * t * PHYSICS.pointerRepelForce * dt;
      b.vx += (dx / dist) * f;
      b.vy += (dy / dist) * f;
      enforceSpeed(b);
    }
  }

  // ── Scale / brightness updates ─────────────────────────────────────────────

  function updateBlobState(b, dt) {
    const spd = Math.hypot(b.vx, b.vy);

    if (b.hitRecovery) {
      // Recovering from an impact: decay target back toward neutral.
      // Only exit recovery once the target is essentially at rest (< 0.5% deviation)
      // so the two modes can never fight each other.
      const dk = 1 - Math.exp(-PHYSICS.scaleDecaySpeed * dt);
      b.tsx += (1 - b.tsx) * dk;
      b.tsy += (1 - b.tsy) * dk;
      if (Math.abs(b.tsx - 1) < 0.005 && Math.abs(b.tsy - 1) < 0.005) {
        b.tsx = 1; b.tsy = 1;   // snap cleanly to neutral
        b.hitRecovery = false;
      }
    } else {
      // Normal travel: set motion-stretch target directly from velocity each frame.
      // No decay is applied — the target is recalculated fresh every tick.
      const factor = Math.min(spd * 0.0028, PHYSICS.stretchMax);
      b.ang = Math.atan2(b.vy, b.vx);
      b.tsx = 1 + factor;
      b.tsy = 1 - factor * PHYSICS.stretchSide;
    }

    // Lerp current scale → target (snappy)
    const lk = 1 - Math.exp(-PHYSICS.scaleSnapSpeed * dt);
    b.sx += (b.tsx - b.sx) * lk;
    b.sy += (b.tsy - b.sy) * lk;

    // Decay brightness flash back to 1.0
    if (b.brightness > 1.001) {
      b.brightness += (1 - b.brightness) * (1 - Math.exp(-PHYSICS.flashDecaySpeed * dt));
    } else {
      b.brightness = 1;
    }
  }

  // ── DOM write ──────────────────────────────────────────────────────────────

  /**
   * Writes transform + filter to the blob element.
   * rotate(ang) scale(sx,sy) rotate(-ang) scales along the ang axis while keeping
   * the default transform-origin (50% 50%) as the pivot, matching the blob centre.
   */
  function applyTransform(b) {
    const tx = b.cx - b.vis * 0.5;
    const ty = b.cy - b.vis * 0.5;
    b.el.style.transform =
      `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) ` +
      `rotate(${b.ang.toFixed(3)}rad) ` +
      `scale(${b.sx.toFixed(4)},${b.sy.toFixed(4)}) ` +
      `rotate(${(-b.ang).toFixed(3)}rad)`;
    b.el.style.filter = `blur(${PHYSICS.blurPx}px) brightness(${b.brightness.toFixed(3)})`;
  }

  // ── Initialisation ─────────────────────────────────────────────────────────

  function init() {
    W = window.innerWidth;
    H = window.innerHeight;

    // Stagger starting positions so blobs don't pile up
    const pos = [
      [W * 0.18, H * 0.22],
      [W * 0.78, H * 0.75],
      [W * 0.52, H * 0.45],
    ];

    blobs.forEach((b, i) => {
      const a = randAngle();
      const p = pos[i] ?? [W * Math.random(), H * Math.random()];
      b.cx = p[0]; b.cy = p[1];
      b.vx = Math.cos(a) * BLOBS[i].speed;
      b.vy = Math.sin(a) * BLOBS[i].speed;
      b.sx = b.sy = b.tsx = b.tsy = 1;
      b.brightness = 1;
      b.hitRecovery = false;
      b.ang = a;
      applyTransform(b);
    });

    // Cache obstacle rect once at init (also updated on resize)
    obstacleRect = resolveObstacleRect();
  }

  // ── Animation loop ─────────────────────────────────────────────────────────

  function tick(ts) {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, PHYSICS.dtCap);
    lastTs = ts;

    // Integrate positions
    blobs.forEach(b => { b.cx += b.vx * dt; b.cy += b.vy * dt; });

    // Pointer repulsion (applied before blob–blob so forces compose naturally)
    blobs.forEach(b => pointerRepel(b, dt));

    // Blob–blob collisions — 3 blobs = 3 unique pairs
    for (let i = 0; i < blobs.length; i++) {
      for (let j = i + 1; j < blobs.length; j++) {
        blobBounce(blobs[i], blobs[j]);
      }
    }

    // Wall & obstacle collisions
    blobs.forEach(b => { wallBounce(b); obstacleeBounce(b); });

    // Squash/stretch, brightness, DOM update
    blobs.forEach(b => { updateBlobState(b, dt); applyTransform(b); });

    requestAnimationFrame(tick);
  }

  // ── Pointer tracking ───────────────────────────────────────────────────────

  function onPointerMove(e) {
    if (!PHYSICS.pointerEnabled) return;
    pointer.active = true;
    const src = e.touches ? e.touches[0] : e;
    pointer.x = src.clientX;
    pointer.y = src.clientY;
  }

  window.addEventListener('mousemove',  onPointerMove);
  window.addEventListener('touchmove',  onPointerMove, { passive: true });
  window.addEventListener('touchstart', onPointerMove, { passive: true });
  window.addEventListener('mouseleave', () => { pointer.active = false; });
  window.addEventListener('touchend',   () => { pointer.active = false; });

  // ── Resize ─────────────────────────────────────────────────────────────────

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      W = window.innerWidth;
      H = window.innerHeight;
      obstacleRect = resolveObstacleRect();
    }, PHYSICS.resizeDebounce);
  });

  // ── Visibility — reset lastTs so a hidden→visible transition doesn't
  //    produce a giant dt spike on the first resumed frame.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lastTs = null;
  });

  // ── Boot ───────────────────────────────────────────────────────────────────
  // Defer until DOMContentLoaded so element positions are accurate.
  // The `started` guard prevents a double-init if the event fires unexpectedly.

  function boot() {
    if (started) return;
    started = true;
    init();
    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

}());
