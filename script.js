'use strict';

// ── Theme Toggle ──────────────────────────────────────────────────────────────

const html        = document.documentElement;
const themeToggle = document.getElementById('themeToggle');
const THEME_KEY   = 'jv-theme';

/** Apply a theme and persist it to localStorage */
function setTheme(theme) {
  html.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

// Initialise: use saved preference, or fall back to dark
const savedTheme = localStorage.getItem(THEME_KEY);
setTheme(savedTheme === 'light' ? 'light' : 'dark');

themeToggle.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  setTheme(next);
});

// ── Discord — copy handle to clipboard ───────────────────────────────────────

const discordBtn = document.getElementById('discordBtn');
const toast      = document.getElementById('toast');
let   toastTimer;

discordBtn.addEventListener('click', async () => {
  const handle = discordBtn.dataset.handle ?? '@theuxguy';

  try {
    await navigator.clipboard.writeText(handle);
    showToast(`Copied ${handle} to clipboard!`);
  } catch {
    // Clipboard API unavailable or permission denied — show handle instead
    showToast(`Discord: ${handle}`);
  }
});

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Blob Physics ──────────────────────────────────────────────────────────────
(function () {
  // Honour reduced-motion preference — keep blobs static
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // ── Config ─────────────────────────────────────────────────────────────────
  // r  = collision/mass radius — the ~100 px "hard" centre the user described.
  // vis = visual diameter of the element (for centering the transform).
  // spd = nominal speed in px/s. Feels slow & weighty at these values.
  const CFG = [
    { sel: '.blob-1', vis: 500, r: 80, spd: 22 },
    { sel: '.blob-2', vis: 380, r: 70, spd: 28 },
    { sel: '.blob-3', vis: 300, r: 60, spd: 18 },
  ];

  const STRETCH_MAX = 0.08;  // max motion-stretch  (8%)
  const SQUASH_HIT  = 0.15;  // impact squash magnitude (15%)

  // ── State ───────────────────────────────────────────────────────────────────
  let W = 0, H = 0, cardRect = null, lastTs = null;

  const blobs = CFG.map(cfg => ({
    el:     document.querySelector(cfg.sel),
    vis:    cfg.vis,
    r:      cfg.r,
    maxSpd: cfg.spd * 1.55,
    minSpd: cfg.spd * 0.40,
    cx: 0, cy: 0,   // centre position (px)
    vx: 0, vy: 0,   // velocity (px/s)
    sx: 1, sy: 1,   // current applied scale
    tsx: 1, tsy: 1, // target scale
    ang: 0,         // stretch-axis angle (radians)
  }));

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function randAngle() { return Math.random() * Math.PI * 2; }

  function enforceSpeed(b) {
    const s = Math.hypot(b.vx, b.vy);
    if (s === 0) {
      const a = randAngle();
      b.vx = Math.cos(a) * b.minSpd;
      b.vy = Math.sin(a) * b.minSpd;
    } else if (s > b.maxSpd) {
      const k = b.maxSpd / s; b.vx *= k; b.vy *= k;
    } else if (s < b.minSpd) {
      const k = b.minSpd / s; b.vx *= k; b.vy *= k;
    }
  }

  // Squash along the nx/ny axis, stretch perpendicular — snaps partway immediately.
  function squashHit(b, nx, ny) {
    b.ang = Math.atan2(ny, nx);
    b.tsx = 1 - SQUASH_HIT;
    b.tsy = 1 + SQUASH_HIT * 0.7;
    b.sx  = b.sx  * 0.55 + b.tsx * 0.45;
    b.sy  = b.sy  * 0.55 + b.tsy * 0.45;
  }

  // ── Collision resolvers ─────────────────────────────────────────────────────

  function wallBounce(b) {
    const r = b.r;
    if (b.cx - r < 0)  { b.cx = r;     if (b.vx < 0) { b.vx = -b.vx; squashHit(b,  1,  0); } }
    if (b.cx + r > W)  { b.cx = W - r; if (b.vx > 0) { b.vx = -b.vx; squashHit(b, -1,  0); } }
    if (b.cy - r < 0)  { b.cy = r;     if (b.vy < 0) { b.vy = -b.vy; squashHit(b,  0,  1); } }
    if (b.cy + r > H)  { b.cy = H - r; if (b.vy > 0) { b.vy = -b.vy; squashHit(b,  0, -1); } }
    enforceSpeed(b);
  }

  function cardBounce(b) {
    if (!cardRect) return;
    const { left, right, top, bottom } = cardRect;
    const r = b.r;
    // Nearest point on card rectangle to blob centre
    const nearX = Math.max(left,   Math.min(right,  b.cx));
    const nearY = Math.max(top,    Math.min(bottom, b.cy));
    const dx = b.cx - nearX, dy = b.cy - nearY;
    const dist2 = dx * dx + dy * dy;
    if (dist2 >= r * r) return;          // no collision
    const dist = Math.sqrt(dist2) || 0.01;
    const nx = dx / dist, ny = dy / dist;
    b.cx = nearX + nx * r;               // push mass outside card
    b.cy = nearY + ny * r;
    const dot = b.vx * nx + b.vy * ny;
    if (dot < 0) {                        // only reflect if moving into card
      b.vx -= 2 * dot * nx;
      b.vy -= 2 * dot * ny;
      squashHit(b, nx, ny);
    }
    enforceSpeed(b);
  }

  function blobBounce(a, b) {
    const dx = b.cx - a.cx, dy = b.cy - a.cy;
    const dist = Math.hypot(dx, dy);
    const minD = a.r + b.r;
    if (dist >= minD || dist < 0.01) return;
    const nx = dx / dist, ny = dy / dist;
    // Separate so mass centres are exactly minD apart
    const push = (minD - dist) * 0.5;
    a.cx -= nx * push; a.cy -= ny * push;
    b.cx += nx * push; b.cy += ny * push;
    // Equal-mass elastic: exchange velocity along collision normal
    const dv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (dv > 0) return;                   // already separating
    a.vx -= dv * nx; a.vy -= dv * ny;
    b.vx += dv * nx; b.vy += dv * ny;
    squashHit(a, -nx, -ny);
    squashHit(b,  nx,  ny);
    enforceSpeed(a);
    enforceSpeed(b);
  }

  // ── Squash & stretch ────────────────────────────────────────────────────────

  function updateScale(b, dt) {
    const spd = Math.hypot(b.vx, b.vy);
    const squashActive = Math.abs(b.tsx - 1) > 0.005 || Math.abs(b.tsy - 1) > 0.005;
    if (!squashActive) {
      // Continuous motion stretch: elongate along velocity direction
      const factor = Math.min(spd * 0.0028, STRETCH_MAX);
      b.ang = Math.atan2(b.vy, b.vx);
      b.tsx = 1 + factor;
      b.tsy = 1 - factor * 0.6;
    }
    // Lerp current → target (settles in ~100 ms)
    const lk = 1 - Math.exp(-9 * dt);
    b.sx += (b.tsx - b.sx) * lk;
    b.sy += (b.tsy - b.sy) * lk;
    // Decay target back to neutral (~450 ms)
    const dk = 1 - Math.exp(-2.2 * dt);
    b.tsx += (1 - b.tsx) * dk;
    b.tsy += (1 - b.tsy) * dk;
  }

  // rotate(ang) scale(sx,sy) rotate(-ang) scales along the ang axis.
  // With the default transform-origin (50% 50%) the pivot is the element centre,
  // so translate(cx - vis/2, cy - vis/2) correctly places that centre at (cx, cy).
  function applyTransform(b) {
    const tx = b.cx - b.vis * 0.5;
    const ty = b.cy - b.vis * 0.5;
    b.el.style.transform =
      `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) ` +
      `rotate(${b.ang.toFixed(3)}rad) ` +
      `scale(${b.sx.toFixed(4)},${b.sy.toFixed(4)}) ` +
      `rotate(${(-b.ang).toFixed(3)}rad)`;
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    W = window.innerWidth;
    H = window.innerHeight;
    // Spread blobs so they don't start on top of each other
    const pos = [
      [W * 0.18, H * 0.22],
      [W * 0.78, H * 0.75],
      [W * 0.52, H * 0.45],
    ];
    blobs.forEach((b, i) => {
      const a = randAngle();
      [b.cx, b.cy] = pos[i];
      b.vx = Math.cos(a) * CFG[i].spd;
      b.vy = Math.sin(a) * CFG[i].spd;
      b.sx = b.sy = b.tsx = b.tsy = 1;
      b.ang = a;
      applyTransform(b);
    });
    cardRect = document.querySelector('.card')?.getBoundingClientRect() ?? null;
  }

  // ── RAF loop ───────────────────────────────────────────────────────────────
  function tick(ts) {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.1);   // cap at 100 ms
    lastTs = ts;

    // Integrate positions
    blobs.forEach(b => { b.cx += b.vx * dt; b.cy += b.vy * dt; });

    // Blob–blob collisions (3 blobs → 3 pairs, enumerated explicitly)
    blobBounce(blobs[0], blobs[1]);
    blobBounce(blobs[0], blobs[2]);
    blobBounce(blobs[1], blobs[2]);

    // Wall & card collisions
    blobs.forEach(b => { wallBounce(b); cardBounce(b); });

    // Squash/stretch + DOM update
    blobs.forEach(b => { updateScale(b, dt); applyTransform(b); });

    requestAnimationFrame(tick);
  }

  // ── Resize ─────────────────────────────────────────────────────────────────
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      W = window.innerWidth;
      H = window.innerHeight;
      cardRect = document.querySelector('.card')?.getBoundingClientRect() ?? null;
    }, 120);
  });

  // Boot — defer until layout is complete so cardRect is accurate
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); requestAnimationFrame(tick); });
  } else {
    init();
    requestAnimationFrame(tick);
  }
}());
