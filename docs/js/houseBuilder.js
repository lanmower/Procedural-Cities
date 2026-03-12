// HouseBuilder.js — port of HouseBuilder.cpp
import { add, sub, scale, normalize, dist, rot90, mid, polyArea, polyIsClockwise,
         polyCenter, shrinkPoly, segIntersect, splitPolygonAlongMax, dot, perp } from './utils.js';
import { seededRandom } from './noise.js';

const floorHeight = 400;
const holeSizeX = 1200, holeSizeY = 1600;
const corrWidth = 300;
const maxApartmentSize = 4000 * 4000;

// --- helpers ---
function pt(x, y, z = 0) { return { x, y, z }; }
function xy(p) { return { x: p.x, y: p.y }; }
function withZ(p, z) { return { x: p.x, y: p.y, z }; }
function quad(a, b, c, d) { return [a, b, c, d]; }

function polyPolyIntersects(polyA, polyB) {
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i], a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j], b2 = polyB[(j + 1) % polyB.length];
      if (segIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

// Build a 1200x1600 rectangle aligned to first edge of polygon
function getShaftHolePolygon(f, rng) {
  const pts = f.points;
  const edge = normalize(sub(pts[1], pts[0]));
  const edgePerp = rot90(edge);
  const center = polyCenter(pts);

  function makeRect(origin) {
    const hx = scale(edge, holeSizeX / 2), hy = scale(edgePerp, holeSizeY / 2);
    return [
      add(add(origin, hx), hy),
      add(sub(origin, hx), hy),
      sub(sub(origin, hx), hy),
      add(sub(origin, hx), scale(hy, -1)),
      add(add(origin, hx), scale(hy, -1)),
    ].map(p => xy(p));
  }

  // random interior point near center
  const offX = (rng() - 0.5) * holeSizeX;
  const offY = (rng() - 0.5) * holeSizeY;
  const origin = add(center, add(scale(edge, offX), scale(edgePerp, offY)));
  let rect = makeRect(origin);

  if (polyPolyIntersects(rect, pts.map(xy))) {
    rect = makeRect(xy(center));
    if (polyPolyIntersects(rect, pts.map(xy))) return null;
  }
  return rect;
}

// makeInteresting: randomly modify building footprint, return cutout plots
function makeInteresting(f, hole, rng, attempts = 4) {
  const plots = [];
  for (let i = 0; i < attempts; i++) {
    const r = rng();
    if (r < 0.20) attemptMoveSideInwards(f, plots, rng);
    else if (r < 0.35) attemptRemoveCorner(f, plots, rng);
    // 0.05 shrink skipped (complex, minor visual impact)
  }
  return plots;
}

function attemptMoveSideInwards(f, plots, rng) {
  const pts = f.points;
  const n = pts.length;
  const si = Math.floor(rng() * n);
  const a = pts[si], b = pts[(si + 1) % n];
  const edgeLen = dist(a, b);
  if (edgeLen < 500) return;
  const inset = 200 + rng() * 600;
  const d = normalize(sub(b, a));
  const norm = rot90(d);
  const na = add(xy(a), scale(norm, inset));
  const nb = add(xy(b), scale(norm, inset));
  // cutout quad
  const cutout = [xy(a), xy(b), nb, na];
  plots.push({ pol: { points: cutout }, type: 'undecided' });
  // move edge inward
  pts[si] = withZ(na, a.z);
  pts[(si + 1) % n] = withZ(nb, b.z);
}

function attemptRemoveCorner(f, plots, rng) {
  const pts = f.points;
  const n = pts.length;
  if (n < 4) return;
  const ci = Math.floor(rng() * n);
  const prev = pts[(ci + n - 1) % n], curr = pts[ci], next = pts[(ci + 1) % n];
  const t = 0.3 + rng() * 0.4;
  const p1 = add(xy(prev), scale(sub(xy(curr), xy(prev)), t));
  const p2 = add(xy(curr), scale(sub(xy(next), xy(curr)), t));
  plots.push({ pol: { points: [xy(curr), p2, p1] }, type: 'undecided' });
  pts.splice(ci, 1, withZ(p1, curr.z), withZ(p2, curr.z));
}

// potentiallyShrink: shrink building footprint between floors
function potentiallyShrink(f, hole, rng) {
  const plots = [];
  if (rng() < 0.3) {
    const amount = 100 + rng() * 300;
    const shrunk = shrinkPoly(f.points.map(xy), -amount);
    const cutout = f.points.map(xy);
    f.points = shrunk.map(p => withZ(p, 0));
    plots.push({ pol: { points: cutout }, type: 'asphalt' });
  }
  return plots;
}

// Corridor slice between shaft hole and exterior wall
function getInteriorPlanAndPlaceEntrancePolygons(f, hole, floorIdx) {
  const rooms = [];
  if (!hole) return rooms;
  const hpts = hole;
  const fpts = f.points.map(xy);
  const z = floorIdx * floorHeight;

  for (let hi = 0; hi < 4; hi++) {
    const ha = hpts[hi], hb = hpts[(hi + 1) % hpts.length];
    const edgeDir = normalize(sub(hb, ha));
    const outward = rot90(edgeDir);
    const hMid = mid(ha, hb);

    // shoot ray outward to find exterior wall
    const rayEnd = add(hMid, scale(outward, 20000));
    let bestDist = Infinity, hitPt = null;
    for (let fi = 0; fi < fpts.length; fi++) {
      const fa = fpts[fi], fb = fpts[(fi + 1) % fpts.length];
      const ix = segIntersect(hMid, rayEnd, fa, fb);
      if (ix) {
        const d = dist(hMid, ix);
        if (d < bestDist) { bestDist = d; hitPt = ix; }
      }
    }
    if (!hitPt || bestDist < corrWidth) continue;

    // corridor slice: shaft edge + 2 sides + exterior edge
    const sideDir = perp(outward);
    const halfW = dist(ha, hb) / 2;
    const extA = add(hitPt, scale(sideDir, halfW));
    const extB = sub(hitPt, scale(sideDir, halfW));

    const roomPts = [
      withZ(ha, z), withZ(hb, z), withZ(extB, z), withZ(extA, z)
    ];
    rooms.push({
      points: roomPts,
      entrances: new Set(),
      windows: new Set([2]),   // exterior edge index
      exteriorWalls: new Set([2]),
      toIgnore: new Set([0])   // shaft-side edge
    });
  }
  return rooms;
}

// Wall quad: two points at base z, two at top z+h
function wallQuad(a, b, h) {
  return [
    withZ(xy(a), a.z),
    withZ(xy(b), b.z),
    withZ(xy(b), b.z + h),
    withZ(xy(a), a.z + h),
  ];
}

function buildApartment(room, floorIdx, rng) {
  const pols = [];
  const pts = room.points;
  const z = floorIdx * floorHeight;

  // floor
  pols.push({ points: pts.map(p => withZ(xy(p), z)), type: 'floor' });

  for (let i = 0; i < pts.length; i++) {
    if (room.toIgnore && room.toIgnore.has(i)) continue;
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const isExt = room.exteriorWalls && room.exteriorWalls.has(i);
    const type = isExt ? 'exterior' : 'interior';
    pols.push({ points: wallQuad(a, b, floorHeight), type });
  }
  return { pols, meshes: [] };
}

function addFloorWithHole(f, hole, z) {
  // flat floor slab at height z — represented as the outline polygon
  return { points: f.points.map(p => withZ(xy(p), z)), type: 'floor' };
}

function addRoofDetail(f, rng) {
  const pols = [];
  const roofPts = f.points.map(p => withZ(xy(p), p.z + floorHeight));
  pols.push({ points: roofPts, type: 'roof' });

  if (rng() < 0.6) {
    const amount = 100 + rng() * 200;
    const shrunk = shrinkPoly(roofPts.map(xy), -amount);
    if (shrunk.length >= 3) {
      const topZ = roofPts[0].z + 200;
      pols.push({ points: shrunk.map(p => withZ(p, topZ)), type: 'roof' });
      // side walls
      for (let i = 0; i < shrunk.length; i++) {
        const a = shrunk[i], b = shrunk[(i + 1) % shrunk.length];
        pols.push({ points: wallQuad(withZ(a, roofPts[0].z), withZ(b, roofPts[0].z), 200), type: 'exteriorSnd' });
      }
    }
  }
  return pols;
}

// --- Main entry ---
export function getHouseInfo(f) {
  const center = polyCenter(f.points.map(xy));
  const rng = seededRandom((center.x * 73856093) ^ (center.y * 19349663));

  const pols = [];
  const meshes = [];
  const remainingPlots = [];

  // 1. shaft hole
  let hole = getShaftHolePolygon(f, rng);
  if (!hole) {
    remainingPlots.push({ pol: { points: f.points.map(xy) }, type: 'undecided' });
    return { pols, meshes, remainingPlots };
  }

  // 2. makeInteresting
  const cutouts = makeInteresting(f, hole, rng, 4);
  remainingPlots.push(...cutouts);

  const numFloors = Math.max(1, f.height || 3);

  // 3. ground floor
  const groundRooms = getInteriorPlanAndPlaceEntrancePolygons(f, hole, 0);
  for (const room of groundRooms) {
    const { pols: rp, meshes: rm } = buildApartment(room, 0, rng);
    pols.push(...rp); meshes.push(...rm);
  }

  // 4. upper floors
  for (let i = 1; i < numFloors; i++) {
    const shrinkPlots = potentiallyShrink(f, hole, rng);
    remainingPlots.push(...shrinkPlots);
    pols.push(addFloorWithHole(f, hole, floorHeight * i));
    const rooms = getInteriorPlanAndPlaceEntrancePolygons(f, hole, i);
    for (const room of rooms) {
      const { pols: rp, meshes: rm } = buildApartment(room, i, rng);
      pols.push(...rp); meshes.push(...rm);
    }
  }

  // 5. roof
  const roofPols = addRoofDetail(f, rng);
  pols.push(...roofPols);

  return { pols, meshes, remainingPlots };
}
