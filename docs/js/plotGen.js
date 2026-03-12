// Plot extraction from road network - faithful port of BaseLibrary::getSurroundingPolygons
// Uses linked-line algorithm to find city blocks between roads

import { dist, normalize, mid, rot90, add, scale, sub, polyIsClockwise, polyDecreaseEdges, polyClipEdges, getProperIntersection } from './utils.js';

export function extractPlots(roads, cfg = {}) {
  const { extraLen = 500, width = 50, middleOffset = 100 } = cfg;
  if (!roads.length) return [];

  // Identical algorithm to getSurroundingPolygons from BaseLibrary.cpp
  return getSurroundingPolygons(roads, roads, 200, extraLen, 0, width, middleOffset);
}

function getSurroundingPolygons(segments, blocking, stdWidth, extraLen, extraRoadLen, width, middleOffset) {
  const lines = [];

  // Get coherent lines (side-lines) from each road segment
  for (const f of segments) {
    const tangent = normalize(sub(f.p2, f.p1));
    const extraVec = scale(tangent, extraLen);
    const beginNorm = normalize(f.beginTangent || tangent);
    const sideOffsetBegin = scale(rot90(beginNorm), (stdWidth / 2) * f.width);
    const sideOffsetEnd = scale(rot90(tangent), (stdWidth / 2) * f.width);

    // Left side line
    // C++: left->p2 = f.p1 + sideOffsetBegin - extraLength (p2 at p1-end, extended backward)
    //      left->p1 = f.p2 + sideOffsetEnd + extraLength   (p1 at p2-end, extended forward)
    const left = {
      p1: add(add(f.p2, sideOffsetEnd), extraVec),
      p2: sub(add(f.p1, sideOffsetBegin), extraVec),
      parent: null,
      child: null,
      point: null
    };
    decidePolygonFate(segments, blocking, left, lines, true, extraRoadLen, width, middleOffset, 0);

    // Right side line
    // C++: right->p1 = f.p1 - sideOffsetBegin - extraLength (extended backward)
    //      right->p2 = f.p2 - sideOffsetEnd + extraLength   (extended forward)
    if (f.width !== 0) {
      const right = {
        p1: sub(sub(f.p1, sideOffsetBegin), extraVec),
        p2: add(sub(f.p2, sideOffsetEnd), extraVec),
        parent: null,
        child: null,
        point: null
      };
      decidePolygonFate(segments, blocking, right, lines, true, extraRoadLen, width, middleOffset, 0);
    }
  }

  // Build polygons from linked line structures
  const remaining = new Set(lines);
  const polygons = [];

  while (remaining.size > 0) {
    const it = remaining.values();
    let curr = it.next().value;
    const taken = new Set([curr]);

    // Find top of the chain
    while (curr.parent && remaining.has(curr.parent) && !taken.has(curr.parent)) {
      curr = curr.parent;
      taken.add(curr);
    }

    // Build polygon from this chain
    const poly = [curr.p1, curr.point && (curr.point.x !== 0) ? curr.point : curr.p2];
    taken.clear();
    taken.add(curr);
    remaining.delete(curr);

    // Follow child chain
    while (curr.child && !taken.has(curr.child)) {
      curr = curr.child;
      poly.push(curr.point && (curr.point.x !== 0) ? curr.point : curr.p2);
      remaining.delete(curr);
      taken.add(curr);
    }

    // Check if closed
    if (curr.child && taken.has(curr.child)) {
      const res = getProperIntersection(curr.p1, curr.p2, curr.child.p1, curr.child.p2);
      if (res) {
        poly.shift();
        poly.push(res);
      }
      poly.open = false;
    } else {
      poly.open = true;
    }

    polygons.push(poly);
  }

  const maxConnect = 5000;

  // Fix open polygons that are close
  for (let i = 0; i < polygons.length; i++) {
    const p = polygons[i];
    if (p.open && dist(p[0], p[p.length - 1]) < maxConnect) {
      p.open = false;
    }
    // Ensure clockwise
    if (!polyIsClockwise(p)) {
      p.reverse();
    }
  }

  // Combine nearby open polygons
  const prevOpen = [];
  for (let i = 0; i < polygons.length; i++) {
    const p = polygons[i];
    if (p.open) {
      let added = false;
      for (const p2 of prevOpen) {
        if (dist(p2[0], p[0]) < maxConnect) {
          p2.reverse();
          p2.push(...p);
          added = true;
          break;
        } else if (dist(p2[p2.length - 1], p[0]) < maxConnect) {
          p2.push(...p);
          added = true;
          break;
        } else if (dist(p2[0], p[p.length - 1]) < maxConnect) {
          p2.reverse();
          p.reverse();
          p2.push(...p);
          added = true;
          break;
        } else if (dist(p2[p2.length - 1], p[p.length - 1]) < maxConnect) {
          p.reverse();
          p2.push(...p);
          added = true;
          break;
        }
      }
      if (!added) {
        prevOpen.push(p);
      }
      polygons.splice(i, 1);
      i--;
    }
  }
  polygons.push(...prevOpen);

  // Final cleanup
  for (let i = 0; i < polygons.length; i++) {
    const p = polygons[i];
    if (p.open && dist(p[0], p[p.length - 1]) < maxConnect) {
      p.open = false;
    }
    polyClipEdges(p, -0.96);
    if (p.length < 3) {
      polygons.splice(i, 1);
      i--;
    }
  }

  return polygons;
}

function decidePolygonFate(segments, blocking, inLine, lines, allowSplit, extraRoadLen, width, middleOffset, depth) {
  const len = dist(inLine.p1, inLine.p2);
  const minRoadLen = 3000;

  if (len < minRoadLen || depth > 3) {
    return;
  }

  const tangent1 = normalize(sub(inLine.p2, inLine.p1));
  const tangent2 = rot90(tangent1);

  // Check for road collisions
  for (const f of blocking) {
    const tangent = normalize(sub(f.p2, f.p1));
    const toUseExtraLen = extraRoadLen;
    const intSec = getProperIntersection(
      sub(f.p1, scale(tangent, toUseExtraLen)),
      add(f.p2, scale(tangent, toUseExtraLen)),
      inLine.p1,
      inLine.p2
    );

    if (intSec && (intSec.x !== 0 || intSec.y !== 0)) {
      if (!allowSplit) {
        return;
      }

      const altTangent = rot90(tangent);
      const newP = {};

      const diff1 = Math.pow(dist(intSec, inLine.p1), 2) - Math.pow(dist(add(intSec, scale(altTangent, middleOffset)), inLine.p1), 2);
      const diff2 = Math.pow(dist(intSec, inLine.p2), 2) - Math.pow(dist(add(intSec, scale(altTangent, middleOffset)), inLine.p2), 2);

      if (diff1 > diff2) {
        newP.p1 = inLine.p1;
        newP.p2 = add(intSec, scale(altTangent, middleOffset));
        inLine.p1 = sub(intSec, scale(altTangent, middleOffset));
      } else {
        newP.p1 = add(intSec, scale(altTangent, middleOffset));
        newP.p2 = inLine.p2;
        inLine.p2 = sub(intSec, scale(altTangent, middleOffset));
      }

      newP.parent = null;
      newP.child = null;
      newP.point = null;
      decidePolygonFate(segments, blocking, newP, lines, true, extraRoadLen, width, middleOffset, depth + 1);
    }
  }

  if (dist(inLine.p1, inLine.p2) < minRoadLen) {
    return;
  }

  // Check intersections with other lines
  for (let i = 0; i < lines.length; i++) {
    const pol = lines[i];
    const tangent3 = normalize(sub(pol.p2, pol.p1));
    const tangent4 = rot90(tangent3);

    const res = getProperIntersection(pol.p1, pol.p2, inLine.p1, inLine.p2);

    if (res && (res.x !== 0 || res.y !== 0)) {
      const d1 = Math.pow(dist(pol.p1, res), 2);
      const d2 = Math.pow(dist(inLine.p2, res), 2);
      const d3 = Math.pow(dist(pol.p2, res), 2);
      const d4 = Math.pow(dist(inLine.p1, res), 2);

      if (d1 + d2 > d3 + d4) {
        inLine.parent = pol;
        pol.child = inLine;
        pol.point = res;
      } else {
        pol.parent = inLine;
        inLine.child = pol;
        inLine.point = res;
      }
    }
  }

  lines.push(inLine);
}
