// Building generation - ported from PlotBuilder + HouseBuilder algorithms
// Subdivides plot polygons into building footprints and assigns heights

import { polyArea, polyIsClockwise, polyCenter, shrinkPoly, dist, normalize, add, scale, sub, perp, segIntersect, getSplitProposal, splitPolygonAlongMax } from './utils.js';
import { seededRandom, SimplexNoise } from './noise.js';

const MIN_AREA = 5000;     // Units² min building footprint
const MAX_AREA_BASE = 50000;   // Units² per building
const MAX_AREA_RANGE = 100000;
const MAX_DEPTH = 8;
const FLOOR_HEIGHT = 400;  // Height per floor in units

export function generateBuildings(plot, cfg = {}) {
  const { minFloors = 3, maxFloors = 20, seed = 0, noiseScale = 0.00003 } = cfg;
  const cen = polyCenter(plot);
  const rng = seededRandom(Math.abs(Math.floor(cen.x * 7 + cen.y * 13 + seed)) >>> 0);
  const noise = new SimplexNoise(seed);

  if (polyArea(plot) < MIN_AREA) return [];

  const maxArea = MAX_AREA_BASE + rng() * MAX_AREA_RANGE;

  if (polyArea(plot) > maxArea * 30) return [];

  if (rng() < 0.05) return [];

  const footprints = subdivide(plot, maxArea, 0);
  const buildings = [];

  for (const fp of footprints) {
    const fpArea = polyArea(fp);
    if (fpArea < MIN_AREA) continue;
    const fcen = polyCenter(fp);
    const noiseVal = noise.noise(fcen.x * noiseScale, fcen.y * noiseScale);
    const noiseFactor = 0.5 + noiseVal * 0.5;
    const noiseHeightInfluence = 0.7;
    const adjustedNoiseFactor = (1 - noiseHeightInfluence) + noiseFactor * noiseHeightInfluence;
    const randVal = Math.min(1, Math.max(0.001, rng()));
    const modifier = -Math.log(Math.min(1 - adjustedNoiseFactor + 0.02, 1) + (1 - Math.min(1 - adjustedNoiseFactor + 0.02, 1)) * randVal) / 4;
    const floors = Math.max(minFloors, Math.floor(minFloors + (maxFloors - minFloors) * modifier * adjustedNoiseFactor));
    buildings.push({ footprint: fp, floors, center: fcen, area: fpArea });
  }

  return buildings;
}

function subdivide(pts, maxArea, depth) {
  const area = polyArea(pts);
  if (area <= maxArea || pts.length < 4 || depth >= MAX_DEPTH) {
    return [pts];
  }

  const split = getSplitLine(pts);
  if (!split) return [pts];

  const [a, b] = splitPolygon(pts, split);
  if (!a || !b) return [pts];

  // Guard: if split didn't meaningfully reduce size, stop
  if (polyArea(a) >= area * 0.9 || polyArea(b) >= area * 0.9) return [pts];

  return [...subdivide(a, maxArea, depth+1), ...subdivide(b, maxArea, depth+1)];
}

function getSplitLine(pts) {
  let maxLen = 0, best = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const d = dist(pts[i], pts[j]);
    if (d > maxLen) { maxLen = d; best = i; }
  }
  const i = best, j = (i + 1) % pts.length;
  const tan = normalize({ x: pts[j].x - pts[i].x, y: pts[j].y - pts[i].y });
  const n2 = perp(tan);
  const mp = { x: (pts[i].x + pts[j].x) * 0.5, y: (pts[i].y + pts[j].y) * 0.5 };
  return { p1: add(mp, scale(n2, -1e8)), p2: add(mp, scale(n2, 1e8)) };
}

function splitPolygon(pts, line) {
  const hits = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ix = segIntersect(line.p1, line.p2, pts[i], pts[j]);
    if (ix) hits.push({ pt: ix, edge: i });
  }
  if (hits.length < 2) return [null, null];

  // Keep only first and last hit to avoid degenerate splits
  const h0 = hits[0], h1 = hits[hits.length - 1];
  if (h0.edge === h1.edge) return [null, null];

  const polyA = [h0.pt];
  for (let i = (h0.edge + 1) % n; i !== (h1.edge + 1) % n; i = (i + 1) % n)
    polyA.push(pts[i]);
  polyA.push(h1.pt);

  const polyB = [h1.pt];
  for (let i = (h1.edge + 1) % n; i !== (h0.edge + 1) % n; i = (i + 1) % n)
    polyB.push(pts[i]);
  polyB.push(h0.pt);

  if (polyA.length < 3 || polyB.length < 3) return [null, null];
  return [polyA, polyB];
}
