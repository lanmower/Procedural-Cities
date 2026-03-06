// 2D geometry utilities - ported from BaseLibrary.cpp

export function segIntersect(p1, p2, p3, p4) {
  const s1x = p2.x - p1.x, s1y = p2.y - p1.y;
  const s2x = p4.x - p3.x, s2y = p4.y - p3.y;
  const denom = -s2x * s1y + s1x * s2y;
  if (Math.abs(denom) < 1e-10) return null;
  const s = (-s1y * (p1.x - p3.x) + s1x * (p1.y - p3.y)) / denom;
  const t = ( s2x * (p1.y - p3.y) - s2y * (p1.x - p3.x)) / denom;
  if (s >= 0 && s <= 1 && t >= 0 && t <= 1)
    return { x: p1.x + t * s1x, y: p1.y + t * s1y };
  return null;
}

export function polyIntersect(p1, p2, poly) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const r = segIntersect(p1, p2, a, b);
    if (r) return r;
  }
  return null;
}

export function normalize(v) {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-10) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function distSq(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function mid(a, b) {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

// rotate v by angle (radians) in 2D
export function rot2(v, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// perpendicular (left normal = rotate 90deg CCW)
export function perp(v) { return { x: -v.y, y: v.x }; }

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) * 0.5;
}

export function polyIsClockwise(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  }
  return s > 0;
}

export function polyCenter(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

// shrink polygon inward by distance d (simple vertex offset)
export function shrinkPoly(pts, d) {
  const n = pts.length;
  const result = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const e1 = normalize({ x: curr.x - prev.x, y: curr.y - prev.y });
    const e2 = normalize({ x: next.x - curr.x, y: next.y - curr.y });
    const n1 = perp(e1), n2 = perp(e2);
    const nx = (n1.x + n2.x) * 0.5, ny = (n1.y + n2.y) * 0.5;
    const len = Math.hypot(nx, ny);
    if (len < 1e-10) { result.push({ x: curr.x, y: curr.y }); continue; }
    result.push({ x: curr.x + (nx / len) * d, y: curr.y + (ny / len) * d });
  }
  return result;
}

export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function scale(v, s) { return { x: v.x * s, y: v.y * s }; }
export function dot(a, b) { return a.x * b.x + a.y * b.y; }
