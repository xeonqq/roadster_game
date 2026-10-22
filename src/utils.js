// ── shared math & helpers ────────────────────────────────────────────────
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const mix = lerp;

/** frame-rate independent exponential smoothing */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};

export function angleDiff(a, b) {
  let d = (b - a + Math.PI) % TAU;
  if (d < 0) d += TAU;
  return d - Math.PI;
}
export const dampAngle = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
export const turnToward = (a, b, maxStep) => {
  const d = angleDiff(a, b);
  return a + clamp(d, -maxStep, maxStep);
};

/** Mulberry32 PRNG */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashInt(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = n ^ (n >>> 16);
  return n >>> 0;
}

export function hash2(x, y, seed = 0) {
  return hashInt(Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041));
}

export function randRange(rng, a, b) { return a + rng() * (b - a); }
export function randInt(rng, a, b) { return Math.floor(a + rng() * (b - a + 1)); }
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
export function chance(rng, p) { return rng() < p; }

export function pickWeighted(rng, entries) {
  let total = 0;
  for (const e of entries) total += e[1];
  let r = rng() * total;
  for (const e of entries) { r -= e[1]; if (r <= 0) return e[0]; }
  return entries[entries.length - 1][0];
}

/** closest point on segment; returns {x,y,t} */
export function closestOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby || 1;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1);
  return { x: ax + abx * t, y: ay + aby * t, t };
}

/** Push a circle out of an axis-aligned rect. Returns null or {x,y,nx,ny,depth}. */
export function resolveCircleRect(cx, cy, r, x0, y0, x1, y1) {
  const nx = clamp(cx, x0, x1);
  const ny = clamp(cy, y0, y1);
  const dx = cx - nx, dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { x: nx + (dx / d) * r, y: ny + (dy / d) * r, nx: dx / d, ny: dy / d, depth: r - d };
  }
  // centre is inside rect: push out through nearest edge
  const left = cx - x0, right = x1 - cx, top = cy - y0, bottom = y1 - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: x0 - r, y: cy, nx: -1, ny: 0, depth: left + r };
  if (m === right) return { x: x1 + r, y: cy, nx: 1, ny: 0, depth: right + r };
  if (m === top) return { x: cx, y: y0 - r, nx: 0, ny: -1, depth: top + r };
  return { x: cx, y: y1 + r, nx: 0, ny: 1, depth: bottom + r };
}

/** distance from point to AABB (0 when inside) */
export function pointRectDist(px, py, x0, y0, x1, y1) {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dy = Math.max(y0 - py, 0, py - y1);
  return Math.hypot(dx, dy);
}

/** Does the segment cross the circle? */
export function segmentCircle(ax, ay, bx, by, cx, cy, r) {
  const p = closestOnSegment(cx, cy, ax, ay, bx, by);
  return dist2(cx, cy, p.x, p.y) <= r * r;
}

export function normalizeAngle(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

export function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, a) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function shade(hex, amt) {
  const [r, g, b] = rgb(hex);
  const f = (v) => clamp(Math.round(v + amt * 255), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function formatNum(n) {
  return Math.floor(n).toLocaleString('en-US');
}

export function pad2(n) { return String(Math.floor(n)).padStart(2, '0'); }

export function randomSign(rng) { return rng() < 0.5 ? -1 : 1; }

/** cheap deterministic value noise */
export function noise2(x, y, seed = 0) {
  return (hash2(x, y, seed) & 0xffff) / 0xffff;
}
