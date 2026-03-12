import { polyArea, polyIsClockwise, polyCenter, splitPolygonAlongMax } from './utils.js';
import { seededRandom, SimplexNoise } from './noise.js';

function getHeight(center, rng, noiseScale, minFloors, maxFloors, noise) {
  const n = noise.noise(center.x * noiseScale, center.y * noiseScale);
  const noiseFactor = 0.5 + n * 0.5;
  const noiseHeightInfluence = 0.7;
  const adjustedNoiseFactor = (1 - noiseHeightInfluence) + noiseFactor * noiseHeightInfluence;
  const randVal = Math.min(1, Math.max(0.001, rng()));
  const clamped = Math.min(1 - adjustedNoiseFactor + 0.02, 1);
  const modifier = -Math.log(clamped + (1 - clamped) * randVal) / 4;
  return Math.max(minFloors, Math.floor(minFloors + (maxFloors - minFloors) * modifier * adjustedNoiseFactor));
}

function subdivide(pts, maxArea, depth) {
  const area = polyArea(pts);
  if (area <= maxArea || pts.length < 4 || depth >= 6) return [pts];
  const result = splitPolygonAlongMax(pts);
  if (!result) return [pts];
  const [a, b] = result;
  if (!a || !b) return [pts];
  if (polyArea(a) >= area * 0.9 || polyArea(b) >= area * 0.9) return [pts];
  return [...subdivide(a, maxArea, depth + 1), ...subdivide(b, maxArea, depth + 1)];
}

export function generateHousePolygons(plot, cfg = {}) {
  const { minFloors = 3, maxFloors = 60, seed = 0, noiseScale = 0.0003 } = cfg;
  const pts = Array.isArray(plot) ? plot : plot.points;
  const isOpen = Array.isArray(plot) ? plot.open : plot.open;
  if (isOpen) return [];

  const center = polyCenter(pts);
  const rng = seededRandom(Math.abs(Math.floor(center.x * 7 + center.y * 13 + seed)) >>> 0);
  const noise = new SimplexNoise(seed);

  if (rng() < 0.05) return [];

  const area = polyArea(pts);
  const targetPieces = rng() * (8 - 3) + 3;
  const currMaxArea = area / targetPieces;
  const minArea = currMaxArea * 0.3;

  const pieces = subdivide(pts, currMaxArea, 0);
  const result = [];
  for (const pts of pieces) {
    if (polyArea(pts) < minArea) continue;
    const cen = polyCenter(pts);
    const height = getHeight(cen, rng, noiseScale, minFloors, maxFloors, noise);
    const n = pts.length;
    const edgeSet = new Set(Array.from({ length: n }, (_, i) => i));
    result.push({
      points: pts,
      height,
      entrances: edgeSet,
      windows: new Set(edgeSet),
      isClockwise: polyIsClockwise(pts),
      open: false,
    });
  }

  return result;
}
