// sidewalkGen.js — port of PlotBuilder.cpp getSideWalkPolygons
import { add, sub, scale, normalize, rot90 } from './utils.js';

function getNormal(p1, p2, right) {
  const t = normalize(sub(p2, p1));
  return right ? { x: -t.y, y: t.x } : { x: t.y, y: -t.x };
}

// Returns array of {points, type:'concrete'} polygons for the sidewalk border of a plot
// Matches C++ getSideWalkPolygons: per-edge flat strip + raised curb edge
export function getSideWalkPolygons(plot, width = 500) {
  const pols = [];
  const pts = Array.isArray(plot) ? plot : plot.points;
  if (!pts || pts.length < 3) return pols;
  const n = pts.length;
  const isClockwise = pts.isClockwise ?? plot.isClockwise ?? true;
  const endWidth = 40;
  const endHeight = 40;

  let prevP1 = null, prevP2 = null;

  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const normal = normalize(getNormal(p1, p2, !isClockwise));

    // flat sidewalk strip at z=30
    const sp1 = p1, sp2 = p2;
    const sp3 = add(p2, scale(normal, width));
    const sp4 = add(p1, scale(normal, width));
    pols.push({ points: [
      { x: sp1.x, y: sp1.y, z: 30 },
      { x: sp2.x, y: sp2.y, z: 30 },
      { x: sp3.x, y: sp3.y, z: 30 },
      { x: sp4.x, y: sp4.y, z: 30 }
    ], type: 'concrete' });

    // raised curb outer edge top
    const cp1 = add(p1, scale(normal, width));
    const cp2 = add(p2, scale(normal, width));
    const cp3 = add(p2, scale(normal, width + endWidth));
    const cp4 = add(p1, scale(normal, width + endWidth));
    const curbZ = 30 + endHeight;
    pols.push({ points: [
      { x: cp1.x, y: cp1.y, z: curbZ },
      { x: cp2.x, y: cp2.y, z: curbZ },
      { x: cp3.x, y: cp3.y, z: curbZ },
      { x: cp4.x, y: cp4.y, z: curbZ }
    ], type: 'concrete' });
    // curb side walls
    pols.push({ points: [
      { x: cp1.x, y: cp1.y, z: 30 },
      { x: cp2.x, y: cp2.y, z: 30 },
      { x: cp2.x, y: cp2.y, z: curbZ },
      { x: cp1.x, y: cp1.y, z: curbZ }
    ], type: 'concrete' });
    pols.push({ points: [
      { x: cp3.x, y: cp3.y, z: curbZ },
      { x: cp4.x, y: cp4.y, z: curbZ },
      { x: cp4.x, y: cp4.y, z: 30 },
      { x: cp3.x, y: cp3.y, z: 30 }
    ], type: 'concrete' });

    // corner triangle between this edge and previous
    if (prevP1 !== null) {
      pols.push({ points: [
        { x: prevP1.x, y: prevP1.y, z: 30 },
        { x: sp4.x,    y: sp4.y,    z: 30 },
        { x: prevP2.x, y: prevP2.y, z: 30 }
      ], type: 'concrete' });
    }

    prevP1 = sp2;
    prevP2 = sp3;
  }

  // closing corner triangle
  if (prevP1 !== null) {
    const p0 = pts[0];
    const normal0 = normalize(getNormal(pts[n - 1], pts[0], !isClockwise));
    const sp4_0 = add(p0, scale(normal0, width));
    pols.push({ points: [
      { x: prevP1.x, y: prevP1.y, z: 30 },
      { x: sp4_0.x,  y: sp4_0.y,  z: 30 },
      { x: prevP2.x, y: prevP2.y, z: 30 }
    ], type: 'concrete' });
  }

  return pols;
}
