import { polyArea, polyIsClockwise, polyCenter, splitPolygonAlongMax, polyEnsureClockwise } from './utils.js';
import { seededRandom, SimplexNoise } from './noise.js';

// C++ PlotBuilder::getHeight uses noise + log distribution
// noiseHeightInfluence = defined per-building-type in C++ specs; use 0.7 as default
function getHeight(center, rng, noiseScale, minFloors, maxFloors, noise) {
  const n = noise.noise(center.x * noiseScale, center.y * noiseScale);
  // C++: noise returns [-1,1], NoiseSingleton maps to [0,1]: adjustedNoise = (1-inf) + noise*inf
  const noiseHeightInfluence = 0.7;
  const adjustedNoiseFactor = (1 - noiseHeightInfluence) + ((n * 0.5 + 0.5) * noiseHeightInfluence);
  const randVal = Math.min(1, Math.max(0.001, rng()));
  // C++: modifier = -log(FRandRange(min(1.02-adj,1), 1)) / 4
  const low = Math.min(Math.max(1.02 - adjustedNoiseFactor, 0.001), 1);
  const modifier = -Math.log(low + (1 - low) * randVal) / 4;
  return Math.max(minFloors, Math.floor(minFloors + (maxFloors - minFloors) * modifier * adjustedNoiseFactor));
}

// C++ FHousePolygon::recursiveSplit — matches exactly:
//   if (pts < 3 || area <= minArea) return []
//   if (depth > 2) return [this]
//   if (area > maxArea) split, recurse both halves
//   else return [this]
// C++ getArea() uses 0.0001 scale factor, so C++ maxArea=6000 → JS maxArea = 6000/0.0001 = 60_000_000
// But all our coordinates are in raw UE cm, so we match by scaling maxArea accordingly.
const CPP_AREA_SCALE = 0.0001;
const CPP_MAX_AREA = 1000;
const CPP_MIN_AREA = 500;
const CPP_MIN_BUILD_AREA = 200;

function recursiveSplit(pts, maxArea, minArea, depth) {
  const area = polyArea(pts) * CPP_AREA_SCALE;
  if (pts.length < 3 || area <= minArea) return [];
  if (depth > 2) return [pts];
  if (area > maxArea) {
    const result = splitPolygonAlongMax(pts);
    if (!result || !result[0] || !result[1]) return [pts];
    const [remaining, newPoly] = result;
    const newArea = polyArea(newPoly) * CPP_AREA_SCALE;
    const remArea = polyArea(remaining) * CPP_AREA_SCALE;
    // Safety: don't recurse if split didn't reduce meaningfully
    if (newArea >= area * 0.95 || remArea >= area * 0.95) return [pts];
    const tot = [];
    const sub1 = recursiveSplit(newPoly, maxArea, minArea, depth + 1);
    tot.push(...sub1);
    tot.push(...recursiveSplit(remaining, maxArea, minArea, depth + 1));
    return tot;
  }
  return [pts];
}

export function generateHousePolygons(plot, cfg = {}) {
  const { minFloors = 3, maxFloors = 60, seed = 0, noiseScale = 0.0003 } = cfg;
  const pts = Array.isArray(plot) ? plot : plot.points;
  const isOpen = Array.isArray(plot) ? plot.open : plot.open;
  if (isOpen) return [];

  const center = polyCenter(pts);
  // C++ seed: FRandomStream(cen.X * 1000 + cen.Y)
  const rng = seededRandom(Math.abs(Math.floor(center.x * 1000 + center.y)) >>> 0);
  const noise = new SimplexNoise(seed);

  // C++ PlotBuilder: 5% chance of empty plot
  if (rng() < 0.05) return [];

  const plotArea = polyArea(pts) * CPP_AREA_SCALE;

  // C++: area > currMaxArea * 8 → green plot (too big), area > currMaxArea * 30 → ignore
  // C++: currMaxArea = FRandRange(minMaxArea=3000, maxMaxArea=6000)
  const currMaxArea = CPP_MIN_AREA + rng() * (CPP_MAX_AREA - CPP_MIN_AREA);

  if (plotArea > currMaxArea * 8) return [];
  if (plotArea > currMaxArea * 30) return [];

  // Ensure CW winding (C++ does checkOrientation())
  const cwPts = polyIsClockwise(pts) ? pts : [...pts].reverse();

  // C++ refine: decreaseEdges then recursiveSplit
  const pieces = recursiveSplit(cwPts, currMaxArea, CPP_MIN_BUILD_AREA, 0);

  // If no pieces (all too small), treat whole plot as one building if large enough
  const toProcess = pieces.length > 0 ? pieces : (plotArea >= CPP_MIN_BUILD_AREA ? [cwPts] : []);

  const result = [];
  for (const piece of toProcess) {
    const pieceArea = polyArea(piece) * CPP_AREA_SCALE;
    if (pieceArea < CPP_MIN_BUILD_AREA) continue;
    const cen = polyCenter(piece);
    const height = getHeight(cen, rng, noiseScale, minFloors, maxFloors, noise);
    const n = piece.length;
    // C++ uses 1-based edge indices for entrances/windows (1..n)
    const edgeSet = new Set(Array.from({ length: n }, (_, i) => i + 1));
    result.push({
      points: piece,
      height,
      entrances: edgeSet,
      windows: new Set(edgeSet),
      isClockwise: true, // ensured CW above
      open: false,
    });
  }

  return result;
}
