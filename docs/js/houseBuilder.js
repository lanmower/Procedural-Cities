// HouseBuilder.js — 1:1 port of HouseBuilder.cpp + RoomBuilder.cpp (interiorPlanToPolygons)
import { scale, normalize, dist, rot90, rot270, mid, polyArea, polyIsClockwise,
         polyCenter, shrinkPoly, segIntersect, splitPolygonAlongMax, getSplitProposal,
         polySelfIntersects } from './utils.js';
import { seededRandom } from './noise.js';

export const floorHeight = 400;
const holeSizeX = 1200, holeSizeY = 1600;
const corrWidth = 300;
const makeInterestingAttempts = 4;
const maxChangeIntensity = 0.35;
const simplePlotGroundOffset = 30;

function pt3(x, y, z) { return { x, y, z }; }
function xy(p) { return { x: p.x, y: p.y }; }
function withZ(p, z) { return { x: p.x, y: p.y, z }; }
function addZ(p, dz) { return { x: p.x, y: p.y, z: (p.z || 0) + dz }; }

// --- FVector-style 3D helpers matching UE conventions ---
function v3(x, y, z) { return { x, y, z }; }
function v3add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: (a.z||0)+(b.z||0) }; }
function v3sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: (a.z||0)-(b.z||0) }; }
function v3scale(v, s) { return { x: v.x*s, y: v.y*s, z: (v.z||0)*s }; }
function v3len(v) { return Math.hypot(v.x, v.y, v.z||0); }
function v3norm(v) { const l = v3len(v); return l < 1e-10 ? {x:0,y:0,z:0} : {x:v.x/l,y:v.y/l,z:(v.z||0)/l}; }
function v3dist(a, b) { return Math.hypot(b.x-a.x, b.y-a.y, (b.z||0)-(a.z||0)); }
// FRotator(0,270,0).RotateVector in UE = rotate 270deg around Z = (x,y) -> (y,-x)
function rot270_3(v) { return { x: v.y, y: -v.x, z: v.z||0 }; }
// FRotator(0,90,0).RotateVector in UE = rotate 90deg around Z = (x,y) -> (-y, x)
function rot90_3(v) { return { x: -v.y, y: v.x, z: v.z||0 }; }

// intersection of two infinite lines (p1+t*(p2-p1)) and (p3+s*(p4-p3))
// Returns FVector or {x:0,y:0,z:0} if no intersection — matches C++ intersection()
function lineIntersect3(p1, p2, p3, p4) {
  const s1x = p2.x - p1.x, s1y = p2.y - p1.y;
  const s2x = p4.x - p3.x, s2y = p4.y - p3.y;
  const denom = -s2x * s1y + s1x * s2y;
  if (Math.abs(denom) < 1e-10) return {x:0,y:0,z:0};
  const s = (-s1y*(p1.x-p3.x) + s1x*(p1.y-p3.y)) / denom;
  const t = ( s2x*(p1.y-p3.y) - s2y*(p1.x-p3.x)) / denom;
  if (s >= 0 && s <= 1 && t >= 0 && t <= 1)
    return { x: p1.x + t*s1x, y: p1.y + t*s1y, z: p1.z||0 };
  return {x:0,y:0,z:0};
}

// --- Polygon intersection helpers matching C++ ---
function polyPolyIntersects2D(polyA, polyB) {
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i], a2 = polyA[(i+1)%polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j], b2 = polyB[(j+1)%polyB.length];
      if (segIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function pointInPoly2D(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length-1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < (xj-xi)*(p.y-yi)/(yj-yi)+xi))
      inside = !inside;
  }
  return inside;
}

// --- getShaftHolePolygon (AHouseBuilder::getShaftHolePolygon) ---
// C++: tangent1 = normalize(pts[1]-pts[0]), tangent2 = rot90(tangent1)
// center = useCenter ? getCenter() : getRandomPoint(true, 3000, stream)
// Returns 4-point rectangle aligned to first edge
export function getShaftHolePolygon(f, rng, useCenter) {
  const pts = f.points;
  const tangent1 = v3norm(v3sub(pts[1], pts[0]));
  const tangent2 = rot90_3(tangent1);
  let center;
  if (useCenter) {
    center = { x: polyCenter(pts.map(xy)).x, y: polyCenter(pts.map(xy)).y, z: 0 };
  } else {
    const c = polyCenter(pts.map(xy));
    const offX = (rng() - 0.5) * 2000;
    const offY = (rng() - 0.5) * 2000;
    center = { x: c.x + offX, y: c.y + offY, z: 0 };
    if (!pointInPoly2D(center, pts.map(xy))) center = { x: c.x, y: c.y, z: 0 };
  }

  const hole = [];
  hole.push(v3add(v3add(center, v3scale(tangent1,  holeSizeX/2)), v3scale(tangent2,  holeSizeY/2)));
  hole.push(v3add(v3add(center, v3scale(tangent1, -holeSizeX/2)), v3scale(tangent2,  holeSizeY/2)));
  hole.push(v3add(v3add(center, v3scale(tangent1, -holeSizeX/2)), v3scale(tangent2, -holeSizeY/2)));
  hole.push(v3add(v3add(center, v3scale(tangent1,  holeSizeX/2)), v3scale(tangent2, -holeSizeY/2)));
  return hole;
}

// --- attemptMoveSideInwards ---
// Returns { pol, valid } where pol is the removed strip
function attemptMoveSideInwards(fpts, fwindows, fentrances, place, centerHole, len, offset) {
  const n = fpts.length;
  const prev2 = place > 1 ? place - 2 : place - 2 + n;
  const dir1 = v3norm(v3sub(fpts[prev2 % n], fpts[place-1]));
  const dir2 = v3norm(v3sub(fpts[(place+1)%n], fpts[place%n]));

  const toChange1To = v3add(fpts[place-1], v3scale(dir1, len));
  const toChange2To = v3add(fpts[place%n], v3scale(dir2, len));

  // check intersection with centerHole and self
  const line = [toChange1To, toChange2To];
  if (linePolyIntersects(line, centerHole) || linePolyIntersects(line, fpts)) {
    return null;
  }

  const pol = {
    points: [
      v3add(fpts[place%n], offset),
      v3add(fpts[place-1], offset),
      v3add(toChange1To, offset),
      v3add(toChange2To, offset)
    ]
  };

  fpts[place-1] = toChange1To;
  fpts[place%n] = toChange2To;
  fwindows.add(place);
  return pol;
}

function linePolyIntersects(line, poly) {
  if (line.length < 2 || poly.length < 2) return false;
  for (let i = 0; i < poly.length; i++) {
    const ix = lineIntersect3(line[0], line[1], poly[i], poly[(i+1)%poly.length]);
    if (ix.x !== 0 || ix.y !== 0) return true;
  }
  return false;
}

// --- attemptRemoveCorner ---
function attemptRemoveCorner(fpts, fwindows, fentrances, place, centerHole, offset) {
  const n = fpts.length;
  const p1 = mid(xy(fpts[place-1]), xy(fpts[place%n]));
  const p2 = mid(xy(fpts[(place+1)%n]), xy(fpts[place%n]));

  const triPts = [withZ(p1, 0), withZ(p2, 0), fpts[place%n]];
  if (linePolyIntersects([triPts[0], triPts[1]], centerHole)) return null;

  const pol = {
    points: [v3add(triPts[0], offset), v3add(triPts[1], offset), v3add(triPts[2], offset)]
  };

  const hadW = fwindows.has(place);
  const hadE = fentrances.has(place);

  // f.addPoint(place, p1), addPoint(place+1, p2), removePoint(place+2)
  fpts.splice(place%n, 0, withZ(p1, fpts[place%n].z||0));
  fpts.splice((place+1)%fpts.length, 0, withZ(p2, 0));
  fpts.splice((place+2)%fpts.length, 1);
  fwindows.add(place+1);
  fentrances.add(place+1);
  if (hadW) fwindows.add(place);
  if (hadE) fentrances.add(place);
  return pol;
}

// --- makeInteresting (AHouseBuilder::makeInteresting) ---
// Modifies fpts in place, pushes FSimplePlot-like objects to plots
function makeInteresting(f, plots, centerHole, rng) {
  const n = f.points.length;
  const place = 1 + Math.floor(rng() * n); // RandRange(1, n)
  const len = 300 + rng() * 1200; // FRandRange(300, 1500)

  const r1 = rng();
  if (r1 < 0.2) {
    const pol = attemptMoveSideInwards(f.points, f.windows, f.entrances, place, centerHole, len, {x:0,y:0,z:30});
    if (pol && pol.points.length > 0) plots.push({ pol, type: f.simplePlotType || 'undecided' });
  } else if (rng() < 0.15 && v3dist(f.points[place%n], f.points[place-1]) > 500) {
    const pol = attemptRemoveCorner(f.points, f.windows, f.entrances, place, centerHole, {x:0,y:0,z:30});
    if (pol && pol.points.length > 0) plots.push({ pol, type: f.simplePlotType || 'undecided' });
  } else if (rng() < 0.05) {
    const shrinkLen = 150 + rng() * 1350;
    const cpPts = f.points.map(p => xy(p));
    const shrunk = shrinkPoly(cpPts, shrinkLen);
    if (!polyPolyIntersects2D(shrunk, centerHole.map(xy)) && !polySelfIntersects(shrunk)) {
      // getSideWithHoles result: surrounding ring as roof polygons
      f.points = shrunk.map(p => withZ(p, 0));
      for (let i = 1; i <= f.points.length; i++) f.windows.add(i);
    }
  }
}

// --- potentiallyShrink (per-floor) ---
// C++: 25% moveSideInwards, 20% symmetricShrink, 15% removeCorner
export function potentiallyShrink(f, centerHole, rng, offset) {
  const pols = [];
  const n = f.points.length;
  const place = 1 + Math.floor(rng() * n);
  const len = 100 + rng() * 1000;

  if (rng() < 0.25) {
    const pol = attemptMoveSideInwards(f.points, f.windows, f.entrances, place, centerHole, len, offset);
    if (pol && pol.points.length > 2) {
      pols.push({ points: pol.points, type: 'roof', normal: {x:0,y:0,z:-1} });
    }
  } else if (rng() < 0.2) {
    const shrinkLen = 150 + rng() * 1350;
    const cpPts = f.points.map(p => xy(p));
    const shrunk = shrinkPoly(cpPts, shrinkLen);
    if (!polyPolyIntersects2D(shrunk, centerHole.map(xy)) && !polySelfIntersects(shrunk)) {
      // ring between f and shrunk → roof polygons
      const holes = [shrunk];
      pols.push({ points: f.points.map(p => withZ(xy(p), offset.z||0)), type: 'roof', normal:{x:0,y:0,z:-1}, holePoints: shrunk.map(p=>withZ(p, offset.z||0)) });
      f.points = shrunk.map(p => withZ(p, 0));
      for (let i = 1; i <= f.points.length; i++) f.windows.add(i);
    }
  } else if (rng() < 0.15) {
    const pol = attemptRemoveCorner(f.points, f.windows, f.entrances, place, centerHole, offset);
    if (pol && pol.points.length > 2) {
      pols.push({ points: pol.points, type: 'roof', normal: {x:0,y:0,z:-1} });
    }
  }
  return pols;
}

// --- getInteriorPlanAndPlaceEntrancePolygons ---
// C++ logic: for each hole edge i:
//   tangent = normalize(hole[i%n] - hole[i-1])
//   midPos = edgeLen/2
//   altTangent = rot270(tangent)  [points outward from shaft]
//   firstAttach = hole[i-1] + (midPos - corrWidth*0.5)*tangent
//   shoot ray from firstAttach in altTangent dir, find intersection with f
//   sndAttach = exterior wall hit
//   build corridor room + exterior wall traversal + corners polygon
export function getInteriorPlanAndPlaceEntrancePolygons(f, hole, ground, corrWidthVal, rng, entrancePols, maxApartmentSize) {
  if (!hole) return [];
  const fpts = f.points;
  const hpts = hole;
  const n = hpts.length;

  const roomPols = [];
  const connections = [];
  for (let i = 0; i < n; i++) {
    roomPols.push({ points: [], entrances: new Set(), windows: new Set(), exteriorWalls: new Set(), toIgnore: new Set(), canRefine: true });
    connections.push({ a: 0, b: 0 });
  }

  const corners = { points: [], entrances: new Set(), windows: new Set(), exteriorWalls: new Set(), toIgnore: new Set(), canRefine: false };

  let prevAttachGlobal = null;

  for (let i = 1; i <= n; i++) {
    const tangent = v3norm(v3sub(hpts[i % n], hpts[i-1]));
    const edgeLen = v3dist(hpts[i % n], hpts[i-1]);
    const midPos = edgeLen / 2;
    // altTangent = rot270(tangent) — pointing outward from shaft toward exterior
    const altTangent = rot270_3(tangent);

    // firstAttach = left side of corridor on this hole edge
    const firstAttach = v3add(hpts[i-1], v3scale(tangent, midPos - corrWidthVal * 0.5));
    let sndAttach = {x:0,y:0,z:0};
    let conn = 0;
    for (let j = 1; j <= fpts.length; j++) {
      const res = lineIntersect3(firstAttach, v3add(firstAttach, v3scale(altTangent, 100000)), fpts[j-1], fpts[j % fpts.length]);
      if (res.x !== 0 || res.y !== 0) { sndAttach = res; conn = j; break; }
    }
    let prevAttach = sndAttach;
    if (sndAttach.x === 0 && sndAttach.y === 0) return [];

    const fEntrances = f.entrances || new Set();
    if (!ground || !fEntrances.has(conn)) {
      corners.points.push(sndAttach);
    } else {
      prevAttach = sndAttach;
    }
    connections[i-1].b = conn;
    roomPols[i-1].points.push(firstAttach);
    roomPols[i-1].entrances.add(roomPols[i-1].points.length);
    roomPols[i-1].points.push(sndAttach);

    // secondAttach = right side of corridor
    const firstAttach2 = v3add(hpts[i-1], v3scale(tangent, midPos + corrWidthVal * 0.5));
    let sndAttach2 = {x:0,y:0,z:0};
    let conn2 = 0;
    for (let j = 1; j <= fpts.length; j++) {
      const res = lineIntersect3(firstAttach2, v3add(firstAttach2, v3scale(altTangent, 100000)), fpts[j-1], fpts[j % fpts.length]);
      if (res.x !== 0 || res.y !== 0) { sndAttach2 = res; conn2 = j; break; }
    }

    const fWindows = f.windows || new Set();
    if (!ground || !fEntrances.has(conn2)) {
      if (fWindows.has(conn2)) corners.windows.add(corners.points.length);
      corners.points.push(sndAttach2);
    } else {
      if (sndAttach2.x !== 0 && v3dist(prevAttach, sndAttach2) < 1000) {
        // place entrance polygons between prevAttach and sndAttach2
        if (entrancePols) {
          entrancePols.push(...getEntrancePolygons(prevAttach, sndAttach2, 390, 50));
        }
      }
    }

    if (i === n) {
      // wrap: prepend sndAttach2 and firstAttach2 to roomPols[0]
      const oldEntrances = Array.from(roomPols[0].entrances);
      roomPols[0].entrances = new Set(oldEntrances.map(e => e + 2));
      connections[0].a = conn2;
      // C++: EmplaceAt(0, sndAttach) then EmplaceAt(1, firstAttach) → [sndAttach2, firstAttach2, ...]
      roomPols[0].points.unshift(sndAttach2, firstAttach2);
      roomPols[0].entrances.add(1);
    } else {
      connections[i].a = conn2;
      roomPols[i].points.push(sndAttach2);
      roomPols[i].entrances.add(roomPols[i].points.length);
      roomPols[i].points.push(firstAttach2);
    }
  }

  // Sew roomPolygons together by adding exterior wall points
  for (let i = 0; i < roomPols.length; i++) {
    const fp = roomPols[i];
    fp.exteriorWalls.add(fp.points.length);

    // walk exterior wall from connections[i].b backwards to connections[i].a
    const bStart = connections[i].b - 1 === -1 ? fpts.length : connections[i].b - 1;
    const bEnd   = connections[i].a - 1 === -1 ? fpts.length : connections[i].a - 1;
    const fWindows = f.windows || new Set();
    for (let j = bStart; j !== bEnd; j = (j === 0 ? fpts.length : j - 1)) {
      if (fWindows.has(j + 1)) fp.windows.add(fp.points.length);
      fp.exteriorWalls.add(fp.points.length);
      fp.points.push(fpts[j % fpts.length]);
    }
    if (fWindows.has(connections[i].a)) fp.windows.add(fp.points.length);
    fp.exteriorWalls.add(fp.points.length);
  }

  // Corners polygon
  corners.points.reverse();
  if (corners.points.length > 0) corners.points.push({ ...corners.points[0] });
  for (let i = 0; i < corners.points.length; i += 2) corners.toIgnore.add(i);
  for (let i = 1; i < corners.points.length + 2; i += 2) {
    corners.exteriorWalls.add(i);
  }
  roomPols.push(corners);

  return roomPols;
}

// --- getEntrancePolygons ---
function getEntrancePolygons(begin, end, height, thickness) {
  const colW = 30;
  const tan = v3norm(v3sub(end, begin));
  const dir = v3norm(rot90_3(v3sub(begin, end))); // getNormal(begin, end, false)
  const b = v3add(begin, v3scale(dir, 10));
  const e = v3add(end, v3scale(dir, 10));
  const pts = [
    v3sub(b, v3scale(tan, colW/2)),
    v3add(v3sub(b, v3scale(tan, colW/2)), {x:0,y:0,z: height + colW/2}),
    v3add(v3add(e, v3scale(tan, colW/2)), {x:0,y:0,z: height + colW/2}),
    v3add(e, v3scale(tan, colW/2)),
    v3sub(e, v3scale(tan, colW/2)),
    v3add(v3sub(e, v3scale(tan, colW/2)), {x:0,y:0,z: height - colW/2}),
    v3add(v3add(b, v3scale(tan, colW/2)), {x:0,y:0,z: height - colW/2}),
    v3add(b, v3scale(tan, colW/2)),
  ];
  return [{ points: pts, type: 'exterior', width: thickness, overridePolygonSides: true }];
}

// --- addStairInfo ---
export function addStairInfo(info, height, hole) {
  for (let i = 1; i <= hole.length; i++) {
    const p1 = withZ(xy(hole[i-1]), 0);
    const p2 = withZ(xy(hole[i%hole.length]), 0);
    const side = {
      points: [
        v3add(p1, {x:0,y:0,z:height}),
        v3add(p2, {x:0,y:0,z:height}),
        p2,
        p1,
      ],
      type: 'interior'
    };
    info.pols.push(side);
  }
}

// --- addFacade ---
// C++: tangent1 = normalize(pts[i-1] - housePosition), offset pts[i-1] outward by width
export function addFacade(f, toReturn, beginHeight, facadeHeight, width) {
  const pts = f.points;
  const hp = f.housePosition || polyCenter(pts.map(xy));
  for (let i = 1; i <= pts.length; i++) {
    const p1 = pts[i-1], p2 = pts[i % pts.length];
    const t1 = v3norm(v3sub(p1, hp));
    const t2 = v3norm(v3sub(p2, hp));
    const fac = {
      points: [
        v3add(v3add(p1, v3scale(t1, width)), {x:0,y:0,z:beginHeight}),
        v3add(v3add(p1, v3scale(t1, width)), {x:0,y:0,z:beginHeight+facadeHeight}),
        v3add(v3add(p2, v3scale(t2, width)), {x:0,y:0,z:beginHeight+facadeHeight}),
        v3add(v3add(p2, v3scale(t2, width)), {x:0,y:0,z:beginHeight}),
      ],
      type: 'exteriorSnd',
    };
    toReturn.pols.push(fac);
  }
}

// --- getSidesOfPolygon helper ---
function getSidesOfPolygon(pol, type, height) {
  const sides = [];
  const pts = pol.points;
  for (let i = 1; i <= pts.length; i++) {
    sides.push({
      points: [
        pts[i-1],
        pts[i % pts.length],
        v3sub(pts[i % pts.length], {x:0,y:0,z:height}),
        v3sub(pts[i-1], {x:0,y:0,z:height}),
      ],
      type,
      overridePolygonSides: true
    });
  }
  return sides;
}

// --- addDetailOnPolygon (recursive, matches C++) ---
// depth starts at 0, maxDepth=2, maxBoxes=3
function addDetailOnPolygon(depth, maxDepth, maxBoxes, pol, toReturn, rng, placed, canCoverCompletely) {
  if (depth === maxDepth) return;
  const nextShapes = [];

  if (rng() < 0.6) {
    // edge detail: C++ reverses then raises, adds sides + fillOutPolygons (end caps)
    const size = 50 + rng() * 450;
    const revPts = [...pol.points].reverse();
    const shape = { points: revPts.map(p => v3add(p, {x:0,y:0,z:size})) };
    const sides = getSidesOfPolygon(shape, 'exteriorSnd', size);
    const width = 20 + rng() * 130;
    sides.forEach(s => { s.overridePolygonSides = true; s.width = width; });
    // fillOutPolygons: for each side quad, add the "other" face (cap polygon between adjacent sides)
    for (const s of sides) {
      toReturn.pols.push({ points: [s.points[0], s.points[3], s.points[2], s.points[1]], type: 'exteriorSnd' });
    }
    toReturn.pols.push(...sides);
  }

  const offset = 100 + rng() * 900;

  if (rng() < 0.3) {
    const numBoxes = Math.floor(rng() * (maxBoxes + 1));
    for (let j = 0; j < numBoxes; j++) {
      const boxOffset = 100 + rng() * 900;
      let box = null;
      let found = false;
      for (let count = 0; count < 5; count++) {
        const center = polyCenter(pol.points.map(xy));
        const randPt = getRandomPointInPolygon(pol.points, rng);
        const p1 = v3add(randPt, {x:0,y:0,z:boxOffset});
        const tangent = v3norm(v3sub(pol.points[1], pol.points[0]));
        const firstLen = 500 + rng() * 2500;
        const sndLen   = 500 + rng() * 2500;
        const p2 = v3add(p1, v3scale(tangent, firstLen));
        const tang2 = rot90_3(tangent);
        const p3 = v3add(p2, v3scale(tang2, sndLen));
        const tang3 = rot90_3(tang2);
        const p4 = v3add(p3, v3scale(tang3, firstLen));
        box = { points: [p1, p2, p3, p4], type: 'exteriorSnd', normal: {x:0,y:0,z:-1} };
        if (!polyPolyIntersects2D(box.points.map(xy), placed.flatMap(p => p.points ? p.points.map(xy) : [xy(p)]))) {
          found = true; break;
        }
      }
      if (found && box) {
        for (let i = 1; i <= box.points.length; i++) {
          toReturn.pols.push({
            points: [
              box.points[i-1],
              box.points[i % box.points.length],
              v3sub(box.points[i % box.points.length], {x:0,y:0,z:boxOffset}),
              v3sub(box.points[i-1], {x:0,y:0,z:boxOffset}),
            ],
            type: 'exteriorSnd'
          });
        }
        placed.push(box);
        toReturn.pols.push(box);
        nextShapes.push(box);
      }
    }
  } else if (rng() < 0.4 && canCoverCompletely) {
    // same shape shrunk
    const shape = { points: pol.points.map(p => v3add(p, {x:0,y:0,z:offset})) };
    const shapeXY = shape.points.map(xy);
    const sp = getSplitProposal(shapeXY, polyIsClockwise(shapeXY), 0.5);
    if (sp && sp.min !== -1) {
      const maxDist = v3dist(sp.p1, sp.p2) / 2;
      if (maxDist > 150) {
        const dist_ = 150 + rng() * (maxDist - 150);
        const shrunkPts = shapeXY.map((pt2, i2) => {
          const dir2 = v3norm(getPointDirection(shape.points, i2));
          return { x: pt2.x + dir2.x * dist_, y: pt2.y + dir2.y * dist_ };
        });
        const shrunkShape = { points: shrunkPts.map(p => withZ(p, shape.points[0].z)), type: 'exteriorSnd', normal:{x:0,y:0,z:-1} };
        for (let i = 1; i <= shrunkShape.points.length; i++) {
          toReturn.pols.push({
            points: [
              shrunkShape.points[i-1],
              shrunkShape.points[i % shrunkShape.points.length],
              v3sub(shrunkShape.points[i % shrunkShape.points.length], {x:0,y:0,z:offset}),
              v3sub(shrunkShape.points[i-1], {x:0,y:0,z:offset}),
            ],
            type: 'roof'
          });
        }
        placed.push(shrunkShape);
        toReturn.pols.push(shrunkShape);
        nextShapes.push(shrunkShape);
      }
    }
  } else if (rng() < 0.2 && canCoverCompletely) {
    // pointy shape
    const centerP = v3add(polyCenter(pol.points.map(xy)), {z: pol.points[0].z + 200 + rng() * 800});
    for (let i = 1; i <= pol.points.length; i++) {
      toReturn.pols.push({
        points: [pol.points[i-1], centerP, pol.points[i % pol.points.length]],
        type: 'roof'
      });
    }
    placed.push(pol);
  }

  for (const s of nextShapes) {
    addDetailOnPolygon(depth + 1, maxDepth, 1, s, toReturn, rng, [], true);
  }
}

function getPointDirection(pts, i) {
  const n = pts.length;
  const prev = pts[(i + n - 1) % n];
  const curr = pts[i];
  const next = pts[(i + 1) % n];
  const e1 = v3norm(v3sub(curr, prev));
  const e2 = v3norm(v3sub(next, curr));
  return v3norm({ x: -(e1.y + e2.y), y: (e1.x + e2.x), z: 0 });
}

function getRandomPointInPolygon(pts, rng) {
  const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  for (let attempt = 0; attempt < 20; attempt++) {
    const p = { x: minX + rng()*(maxX-minX), y: minY + rng()*(maxY-minY) };
    if (pointInPoly2D(p, pts.map(xy))) return withZ(p, pts[0].z||0);
  }
  return withZ(polyCenter(pts.map(xy)), pts[0].z||0);
}

export function addRoofDetail(roof, toReturn, rng, placed, canCoverCompletely) {
  addDetailOnPolygon(0, 2, 3, roof, toReturn, rng, placed || [], canCoverCompletely !== false);
}

// --- getFloorPolygonsWithHole ---
export function getFloorPolygonsWithHole(f, floorBegin, hole) {
  const fPts = f.points.map(p => withZ(xy(p), (p.z||0) + floorBegin));
  const holePts = hole.map(p => withZ(xy(p), (p.z||0) + floorBegin));
  return [{ points: fPts, type: 'floor', normal: {x:0,y:0,z:-1}, holePoints: holePts }];
}

// --- interiorPlanToPolygons (RoomBuilder.cpp) ---
// Converts room polygons to wall quads with windows and door holes
export function interiorPlanToPolygons(roomPols, floorHeightVal, windowDensity, windowHeight, windowWidth, floor, shellOnly, windowFrames) {
  const result = [];

  for (const rp of roomPols) {
    const pts = rp.points;
    const n = pts.length;
    for (let i = 1; i <= n; i++) {
      if (rp.toIgnore && rp.toIgnore.has(i)) continue;
      if (shellOnly && !(rp.exteriorWalls && rp.exteriorWalls.has(i))) continue;

      const isExt = rp.exteriorWalls && rp.exteriorWalls.has(i);
      const type = isExt ? 'exterior' : 'interior';

      const p1 = pts[i-1], p2 = pts[i % n];
      const tan = v3norm(v3sub(p2, p1));

      let extraFront = {x:0,y:0,z:0};
      let extraBack  = {x:0,y:0,z:0};
      if (!isExt) {
        const prev = i > 1 ? i-1 : n;
        const next = i < n ? i+1 : 1;
        if (rp.exteriorWalls && rp.exteriorWalls.has(prev)) extraFront = v3scale(tan, 20);
        if (rp.exteriorWalls && rp.exteriorWalls.has(next))  extraBack  = v3scale(tan, -20);
      }

      const wallPts = [
        v3add(v3add(p1, {x:0,y:0,z:floorHeightVal}), extraFront),
        v3add(p1, extraFront),
        v3add(p2, extraBack),
        v3add(v3add(p2, {x:0,y:0,z:floorHeightVal}), extraBack),
      ];

      // entrance hole
      if (rp.entrances && rp.entrances.has(i) && v3dist(p1, p2) > 100) {
        // insert door cutout at indices 2-5
        const entrPos = rp.specificEntrances && rp.specificEntrances[i]
          ? rp.specificEntrances[i]
          : { x: (p1.x+p2.x)/2, y: (p1.y+p2.y)/2, z: p1.z||0 };
        const doorW = 137, doorH = 297;
        const entTan = v3norm(v3sub(p2, p1));
        const dStart = v3dist(p1, entrPos) - doorW/2;
        const dEnd   = dStart + doorW;
        const dLeft  = v3add(p1, v3scale(entTan, dStart));
        const dRight = v3add(p1, v3scale(entTan, dEnd));
        wallPts.splice(2, 0,
          dLeft,
          v3add(dLeft, {x:0,y:0,z:doorH}),
          v3add(dRight, {x:0,y:0,z:doorH}),
          dRight
        );
      }

      // windows — C++: spaces = floor(min(windowDensity*len, len/(windowWidth+20)))
      // then for j=1..spaces-1: place window at j*jumpLen ± windowWidth/2
      const windowHoles = [];
      if (rp.windows && rp.windows.has(i)) {
        const edgeLen = v3dist(p1, p2);
        const edgeTan = v3norm(v3sub(p2, p1));
        const spaces = Math.floor(Math.min(windowDensity * edgeLen, edgeLen / (windowWidth + 20)));
        if (spaces > 0) {
          const jumpLen = edgeLen / spaces;
          for (let j = 1; j < spaces; j++) {
            let cStart = j * jumpLen - windowWidth/2;
            let cEnd   = j * jumpLen + windowWidth/2;
            if (cEnd - cStart > 100) {
              // pw1 = p1 + tangent*cStart + z(50+windowHeight)  [top-left]
              // pw2 = pw1 - z(windowHeight)                     [bottom-left]
              // pw3 = p1 + tangent*cEnd + z(50)                 [bottom-right]
              // pw4 = pw3 + z(windowHeight)                     [top-right]
              const pw1 = v3add(v3add(p1, v3scale(edgeTan, cStart)), {x:0,y:0,z:50+windowHeight});
              const pw2 = v3sub(pw1, {x:0,y:0,z:windowHeight});
              const pw3 = v3add(v3add(p1, v3scale(edgeTan, cEnd)),   {x:0,y:0,z:50});
              const pw4 = v3add(pw3, {x:0,y:0,z:windowHeight});
              // C++ stores: pw1, pw2, pw3, pw4
              const winPts = [pw1, pw2, pw3, pw4];
              result.push({ points: winPts, type: shellOnly ? 'occlusionWindow' : 'window', width: 8 });
              windowHoles.push({ points: winPts });
              if (!windowFrames) {
                // C++: p.getDirection() = face normal of window polygon, depth = 20 inward
                // For clockwise exterior wall, inward normal = rot270 of tangent
                const wallInward = v3norm(rot270_3(v3sub(p2, p1)));
                for (let k = 1; k <= 4; k++) {
                  const wp1 = winPts[k-1], wp2 = winPts[k%4];
                  result.push({ points: [wp1, wp2, v3add(wp2, v3scale(wallInward, 20)), v3add(wp1, v3scale(wallInward, 20))], type: 'exterior', width: 0 });
                }
              }
            }
          }
        }
      }

      // wall with window holes — holes used by scene.js triangulation
      result.push({ points: wallPts, type, windows: windowHoles });
    }
  }
  return result;
}

// --- getHouseInfo (main entry) ---
export function getHouseInfo(f) {
  const ptsXY = f.points.map(xy);
  const center = polyCenter(ptsXY);
  const rng = seededRandom(Math.abs(Math.floor(center.x + center.y)) >>> 0);

  const toReturn = { pols: [], meshes: [], remainingPlots: [] };

  // normalize f
  if (!f.windows)   f.windows   = new Set(Array.from({length:f.points.length},(_,i)=>i+1));
  if (!f.entrances) f.entrances = new Set(Array.from({length:f.points.length},(_,i)=>i+1));
  if (!f.isClockwise) f.isClockwise = polyIsClockwise(ptsXY);
  if (!f.housePosition) f.housePosition = center;

  const pre = { points: f.points.map(p => ({...p})), windows: new Set(f.windows), entrances: new Set(f.entrances) };

  let hole = getShaftHolePolygon(f, rng, false);
  if (!hole || polyPolyIntersects2D(hole.map(xy), ptsXY)) {
    hole = getShaftHolePolygon(f, rng, true);
    if (!hole || polyPolyIntersects2D(hole.map(xy), ptsXY)) {
      const whole = { pol: { points: f.points.map(p => withZ(xy(p), simplePlotGroundOffset)) }, type: f.simplePlotType || 'undecided' };
      toReturn.remainingPlots.push(whole);
      return toReturn;
    }
  }

  if (f.canBeModified !== false) {
    for (let i = 0; i < makeInterestingAttempts; i++) {
      makeInteresting(f, toReturn.remainingPlots, hole, rng);
    }
  }

  const floors = Math.max(1, f.height || 3);
  const myChangeIntensity = rng() * maxChangeIntensity;

  const windowChangeCutoff = 1 + Math.floor(rng() * 20);
  let currentWindowType = Math.floor(rng() * 4);
  const roofAccess = rng() < 0.35;
  const horizontalFacade = rng() < 0.15;
  const unchangingCP = rng; // same stream passed for ground-floor apartments each upper floor

  const specMaxApartmentSize = 200 * 200;

  // ground floor rooms
  const groundRooms = getInteriorPlanAndPlaceEntrancePolygons(f, hole, true, corrWidth, rng, toReturn.pols, specMaxApartmentSize);
  for (const p of groundRooms) {
    p.windowType = 0; // rectangular
    if (p.windows && p.windows.size > 0 && f.type === 'apartment') {
      for (const wi of p.windows) p.entrances.add(wi);
    }
    const roomInfo = buildApartmentRoom(p, 0, rng, false);
    toReturn.pols.push(...roomInfo.pols);
    toReturn.meshes.push(...roomInfo.meshes);
  }

  // Shaft stair info
  addStairInfo(toReturn, floorHeight * floors, hole);

  // ground floor slab
  toReturn.pols.push({ points: f.points.map(p => withZ(xy(p), 0)), type: 'floor' });

  for (let i = 1; i < floors; i++) {
    if (i === windowChangeCutoff) currentWindowType = Math.floor(rng() * 4);

    if (rng() < myChangeIntensity && f.canBeModified !== false) {
      const shrinkRes = potentiallyShrink(f, hole, rng, {x:0,y:0,z: floorHeight*i + 1});
      toReturn.pols.push(...shrinkRes);
    }

    toReturn.pols.push(...getFloorPolygonsWithHole(f, floorHeight * i + 1, hole));

    if (horizontalFacade) addFacade(f, toReturn, floorHeight*i - 50, 70, 20);

    const upperRooms = getInteriorPlanAndPlaceEntrancePolygons(f, hole, false, corrWidth, rng, toReturn.pols, specMaxApartmentSize);
    for (const p of upperRooms) {
      p.windowType = currentWindowType;
      const roomInfo = buildApartmentRoom(p, i, rng, false);
      const off = {x:0,y:0,z:floorHeight*i};
      roomInfo.pols = roomInfo.pols.map(pol => ({
        ...pol,
        points: pol.points.map(pt2 => v3add(pt2, off)),
        ...(pol.windows ? { windows: pol.windows.map(w => ({ ...w, points: w.points.map(pt2 => v3add(pt2, off)) })) } : {}),
        ...(pol.holePoints ? { holePoints: pol.holePoints.map(pt2 => v3add(pt2, off)) } : {}),
      }));
      toReturn.pols.push(...roomInfo.pols);
      toReturn.meshes.push(...roomInfo.meshes);
    }
  }

  // Roof
  const roofPol = {
    points: f.points.map(p => withZ(xy(p), floorHeight * floors + 1)),
    type: 'roof',
    normal: {x:0,y:0,z:-1}
  };
  const placed = [];

  if (roofAccess) {
    const newRoof = getFloorPolygonsWithHole(f, floorHeight * floors + 1, hole);
    for (const a of newRoof) { a.type = 'roof'; a.overridePolygonSides = true; }
    toReturn.pols.push(...newRoof);
    // box roof above stairwell
    const boxRoof = {
      points: [...hole].reverse().map(p => withZ(xy(p), floorHeight * (floors+1) + 1)),
      type: 'exterior',
      normal: {x:0,y:0,z:-1}
    };
    const boxSides = getSidesOfPolygon(boxRoof, 'exterior', floorHeight);
    toReturn.pols.push(...boxSides);
    toReturn.pols.push(boxRoof);
    placed.push(boxRoof);
  } else {
    toReturn.pols.push(roofPol);
  }

  addRoofDetail(roofPol, toReturn, rng, placed, !roofAccess);

  f.points = pre.points;
  f.windows = pre.windows;
  f.entrances = pre.entrances;

  return toReturn;
}

// buildApartmentRoom: simplified interior (walls per room polygon)
function buildApartmentRoom(room, floorIdx, rng, potentialBalcony) {
  const pols = [];
  const meshes = [];
  const pts = room.points;
  const n = pts.length;
  const z = floorIdx * floorHeight;

  const windowDensity = 0.003;
  const windowHeight  = 200;
  const windowWidth   = 120;

  const walls = interiorPlanToPolygons([room], floorHeight, windowDensity, windowHeight, windowWidth, floorIdx, false, false);
  pols.push(...walls);
  return { pols, meshes };
}
