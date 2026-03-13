// analyze.mjs — CLI geometry analyzer for Procedural Cities
// Run: node tools/analyze.mjs
// Imports all generator modules, runs generation, checks geometry assertions

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsJs = join(__dirname, '../docs/js');
const CACHE_BUST = Date.now();
const toURL = (p) => pathToFileURL(p).href + '?v=' + CACHE_BUST;

// Dynamic imports of all generator modules
const { generateRoads }           = await import(toURL(join(docsJs, 'roadGen.js')));
const { extractPlots }            = await import(toURL(join(docsJs, 'plotGen.js')));
const { generateHousePolygons }   = await import(toURL(join(docsJs, 'buildingGen.js')));
const { getHouseInfo, floorHeight } = await import(toURL(join(docsJs, 'houseBuilder.js')));

const SEED = 42;
const LENGTH = 400;
const SCALE = 0.01;
const MIN_FLOORS = 2;

const cfg = {
  seed: SEED, length: LENGTH,
  noiseScale: 0.00005, primaryStep: 3000, secondaryStep: 2000,
  changeIntensity: 5, secondaryChangeIntensity: 8,
  maxMainLen: 15, maxSecondaryLen: 8,
  mainBranchChance: 0.3, mainAdvantage: 0.1,
  standardWidth: 200, maxAttach: 2000,
  mainRoadDetrimentRange: 1000000, mainRoadDetrimentImpact: 0.01,
  closeMiddle: 800,
};

console.log('Generating roads...');
const roads = generateRoads(cfg);
console.log(`  Roads: ${roads.length}`);

console.log('Extracting plots...');
const allPlots = extractPlots(roads, { extraLen: 500, width: 50, middleOffset: 100, extraRoadLen: 100, minRoadLen: 500 });
const plots = allPlots.filter(p => !p.open);
console.log(`  All plots: ${allPlots.length}, closed: ${plots.length}`);

console.log('Generating buildings...');
const allHouses = [];
const allPolygons = [];
let buildingCount = 0;

for (const plot of plots) {
  const housePols = generateHousePolygons(plot, { minFloors: MIN_FLOORS, maxFloors: 30, seed: SEED, noiseScale: 0.0002 });
  for (const house of housePols) {
    buildingCount++;
    const info = getHouseInfo(house);
    allHouses.push({ house, pols: info.pols });
    allPolygons.push(...info.pols);
  }
}

console.log(`  Buildings: ${buildingCount}`);
console.log(`  Total polygons: ${allPolygons.length}`);

// ---- ASSERTIONS ----
const issues = [];
let nanCount = 0, zeroAreaCount = 0, degenerateCount = 0;
let zFightCount = 0, invalidNormalCount = 0;
let wallsBelowFloor = 0, roofBelowWalls = 0;
let totalPolygons = allPolygons.length;

const polyArea3D = (pts) => {
  if (pts.length < 3) return 0;
  let ax=0, ay=0, az=0;
  for (let i=1; i<pts.length-1; i++) {
    const dx1=pts[i].x-pts[0].x, dy1=pts[i].y-pts[0].y, dz1=(pts[i].z||0)-(pts[0].z||0);
    const dx2=pts[i+1].x-pts[0].x, dy2=pts[i+1].y-pts[0].y, dz2=(pts[i+1].z||0)-(pts[0].z||0);
    ax += dy1*dz2 - dz1*dy2;
    ay += dz1*dx2 - dx1*dz2;
    az += dx1*dy2 - dy1*dx2;
  }
  return Math.hypot(ax, ay, az) * 0.5;
};

const polyNormal3D = (pts) => {
  if (pts.length < 3) return {x:0,y:0,z:0};
  const dx1=pts[1].x-pts[0].x, dy1=pts[1].y-pts[0].y, dz1=(pts[1].z||0)-(pts[0].z||0);
  const dx2=pts[pts.length-1].x-pts[0].x, dy2=pts[pts.length-1].y-pts[0].y, dz2=(pts[pts.length-1].z||0)-(pts[0].z||0);
  const nx=dy1*dz2-dz1*dy2, ny=dz1*dx2-dx1*dz2, nz=dx1*dy2-dy1*dx2;
  const len=Math.hypot(nx,ny,nz);
  if(len<1e-10)return{x:0,y:0,z:0};
  return{x:nx/len,y:ny/len,z:nz/len};
};

// Track z-levels per building for z-fighting check
const zLevelSets = [];

for (let bi = 0; bi < allHouses.length; bi++) {
  const { house, pols } = allHouses[bi];
  const floors = Math.max(1, house.height || 3);
  const expectedMinHeight = MIN_FLOORS * floorHeight;
  const expectedMaxHeight = 30 * floorHeight + 100;

  // Get all z-values for roof polygons
  const roofZs = pols.filter(p=>p.type==='roof').flatMap(p=>p.points.map(pt=>pt.z||0));
  const wallZs = pols.filter(p=>p.type==='exterior'||p.type==='interior').flatMap(p=>p.points.map(pt=>pt.z||0));
  const maxRoofZ = roofZs.length > 0 ? Math.max(...roofZs) : 0;
  const maxWallZ = wallZs.length > 0 ? Math.max(...wallZs) : 0;

  if (roofZs.length > 0 && maxRoofZ < expectedMinHeight - 1) {
    issues.push(`Building ${bi}: roof max z=${maxRoofZ.toFixed(0)}, expected >=${expectedMinHeight} (floors=${floors})`);
  }

  const zLevelMap = {};
  for (const pol of pols) {
    if (!pol.points) continue;
    for (const pt of pol.points) {
      // NaN/Infinity check
      if (!isFinite(pt.x) || !isFinite(pt.y) || !isFinite(pt.z||0)) {
        nanCount++;
        issues.push(`Building ${bi} (${pol.type}): NaN/Inf vertex x=${pt.x} y=${pt.y} z=${pt.z}`);
        break;
      }
    }

    // Zero area
    const area = polyArea3D(pol.points);
    if (area < 0.01 && pol.points.length >= 3) {
      zeroAreaCount++;
      if (zeroAreaCount <= 5) issues.push(`Building ${bi} (${pol.type}): near-zero area=${area.toFixed(4)}`);
    }

    // Zero-length normal (degenerate)
    const norm = polyNormal3D(pol.points);
    if (Math.hypot(norm.x, norm.y, norm.z) < 0.5) {
      invalidNormalCount++;
    }

    // Z-fighting: track exact z-levels for horizontal polygons
    const allZ = pol.points.map(pt=>pt.z||0);
    const minZ = Math.min(...allZ), maxZ = Math.max(...allZ);
    if (maxZ - minZ < 0.5) {
      const zKey = Math.round(minZ * 10) / 10;
      zLevelMap[zKey] = (zLevelMap[zKey]||0) + 1;
    }
  }

  // Count z-fighting (multiple coplanar horizontal polygons at same z)
  for (const [z, cnt] of Object.entries(zLevelMap)) {
    if (cnt > 3) zFightCount++;
  }
}

// Per-polygon type breakdown
const typeCounts = {};
for (const pol of allPolygons) {
  const t = pol.type || 'unknown';
  typeCounts[t] = (typeCounts[t]||0) + 1;
}

// Check polygon counts are reasonable
const exteriorCount = (typeCounts.exterior||0) + (typeCounts.exteriorSnd||0);
const interiorCount = typeCounts.interior||0;
const floorCount = typeCounts.floor||0;
const roofCount = typeCounts.roof||0;
const windowCount = typeCounts.window||0;

// Check fillOutPolygons not doubling everything
// If fillOutPolygons runs on ALL pols (including floors, roofs, interiors),
// it creates a reversed copy of every polygon (even those it shouldn't),
// causing massive duplication. Sign: interior count >> exterior count
const fillOutRatio = interiorCount / Math.max(exteriorCount, 1);
if (fillOutRatio > 5) {
  issues.push(`CRITICAL: interior/exterior ratio=${fillOutRatio.toFixed(1)} — fillOutPolygons likely running on wrong polygons`);
}

// Check per-polygon z value ranges for walls
let wallsAtZ0 = 0;
for (const pol of allPolygons) {
  if (pol.type === 'exterior' || pol.type === 'interior') {
    const allZ = (pol.points||[]).map(pt=>pt.z||0);
    const minZ = Math.min(...allZ), maxZ = Math.max(...allZ);
    if (maxZ < 1 && pol.points.length >= 4) wallsAtZ0++;
  }
}
if (wallsAtZ0 > 0) {
  issues.push(`WARNING: ${wallsAtZ0} wall polygons with max z < 1 (likely flat/zero-height walls)`);
}

// ---- GLTF EXPORT ----
const positions = [], indices = [], matGroups = {};
let vi = 0;

const triangulate = (pts) => {
  if (!pts || pts.length < 3) return [];
  if (pts.some(p => !isFinite(p.x)||!isFinite(p.y)||!isFinite(p.z||0))) return [];
  const tris = [];
  for (let i=1; i<pts.length-1; i++) tris.push([0, i, i+1]);
  return tris;
};

for (const pol of allPolygons.slice(0, 50000)) {
  const pts = pol.points;
  if (!pts || pts.length < 3) continue;
  if (pts.some(p => !isFinite(p.x)||!isFinite(p.y)||!isFinite(p.z||0))) continue;
  const type = pol.type || 'exterior';
  if (!matGroups[type]) matGroups[type] = { pos:[], idx:[], vi:0 };
  const g = matGroups[type];
  const base = g.vi;
  for (const p of pts) { g.pos.push(p.x*SCALE, (p.z||0)*SCALE, p.y*SCALE); g.vi++; }
  const tris = triangulate(pts);
  for (const [a,b,c] of tris) g.idx.push(base+a, base+b, base+c);
}

// Build GLTF
const buffers = [], bufferViews = [], accessors = [], meshes = [], nodes = [];
let byteOffset = 0;
const allBinBuffers = [];
let matIdx = 0;
const COLORS = {
  exterior:[0.816,0.812,0.784], exteriorSnd:[0.722,0.706,0.659],
  interior:[0.910,0.894,0.863], floor:[0.604,0.584,0.565],
  roof:[0.471,0.455,0.439], window:[0.290,0.541,0.690],
  concrete:[0.847,0.831,0.800], occlusionWindow:[0.039,0.082,0.125],
  windowFrame:[0.941,0.925,0.878], roadMiddle:[0.941,0.816,0.376],
};

const materials = Object.keys(COLORS).map(name => ({
  name, pbrMetallicRoughness: {
    baseColorFactor: [...(COLORS[name]||[0.5,0.5,0.5]), 1.0],
    metallicFactor: 0, roughnessFactor: 0.8
  }
}));

const gltfMeshPrimitives = [];
let meshMatIdx = 0;

for (const [type, g] of Object.entries(matGroups)) {
  if (!g.pos.length || !g.idx.length) { meshMatIdx++; continue; }

  const posBuf = Buffer.from(new Float32Array(g.pos).buffer);
  const idxBuf = Buffer.from(new Uint32Array(g.idx).buffer);

  const posView = { buffer:0, byteOffset, byteLength: posBuf.length, target: 34962 };
  byteOffset += posBuf.length;
  const idxView = { buffer:0, byteOffset, byteLength: idxBuf.length, target: 34963 };
  byteOffset += idxBuf.length;

  allBinBuffers.push(posBuf, idxBuf);
  bufferViews.push(posView, idxView);

  const posArr = g.pos;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (let i=0;i<posArr.length;i+=3){
    minX=Math.min(minX,posArr[i]); maxX=Math.max(maxX,posArr[i]);
    minY=Math.min(minY,posArr[i+1]); maxY=Math.max(maxY,posArr[i+1]);
    minZ=Math.min(minZ,posArr[i+2]); maxZ=Math.max(maxZ,posArr[i+2]);
  }

  const posAcc = { bufferView: bufferViews.length-2, componentType:5126, count:g.vi, type:'VEC3', min:[minX,minY,minZ], max:[maxX,maxY,maxZ] };
  const idxAcc = { bufferView: bufferViews.length-1, componentType:5125, count:g.idx.length, type:'SCALAR' };
  accessors.push(posAcc, idxAcc);

  const matColorIdx = materials.findIndex(m=>m.name===type);
  gltfMeshPrimitives.push({ attributes:{ POSITION: accessors.length-2 }, indices: accessors.length-1, material: matColorIdx >= 0 ? matColorIdx : 0 });
  meshMatIdx++;
}

const totalBin = Buffer.concat(allBinBuffers);
const gltf = {
  asset: { version:'2.0', generator:'procedural-cities-analyzer' },
  scene: 0, scenes: [{ nodes:[0] }],
  nodes: [{ mesh:0 }],
  meshes: [{ name:'city', primitives: gltfMeshPrimitives }],
  materials,
  accessors, bufferViews,
  buffers: [{ byteLength: totalBin.length, uri: 'city.bin' }]
};

const gltfPath = join(__dirname, 'city.gltf');
const binPath  = join(__dirname, 'city.bin');
writeFileSync(gltfPath, JSON.stringify(gltf, null, 2));
writeFileSync(binPath, totalBin);
console.log(`\nGLTF exported: ${gltfPath}`);
console.log(`Binary: ${binPath} (${(totalBin.length/1024).toFixed(0)} KB)`);

// ---- REPORT ----
console.log('\n========= GEOMETRY ANALYSIS REPORT =========');
console.log(`Roads:          ${roads.length}`);
console.log(`Plots (closed): ${plots.length}`);
console.log(`Buildings:      ${buildingCount}`);
console.log(`Total polygons: ${totalPolygons}`);
console.log('\nPolygon types:');
for (const [t, c] of Object.entries(typeCounts).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${t.padEnd(20)} ${c}`);
}
console.log('\nAssertion results:');
console.log(`  NaN/Inf vertices:    ${nanCount}`);
console.log(`  Zero-area polygons:  ${zeroAreaCount}`);
console.log(`  Invalid normals:     ${invalidNormalCount}`);
console.log(`  Z-fight hotspots:    ${zFightCount}`);
console.log(`  Walls at z=0:        ${wallsAtZ0}`);
console.log(`  Interior/exterior ratio: ${fillOutRatio.toFixed(2)}`);

if (issues.length > 0) {
  console.log(`\nISSUES FOUND (${issues.length}):`);
  for (const iss of issues.slice(0, 30)) console.log('  [!]', iss);
  if (issues.length > 30) console.log(`  ... and ${issues.length - 30} more`);
} else {
  console.log('\nNo issues found.');
}

// Write JSON report
const report = {
  roads: roads.length, plots: plots.length, buildings: buildingCount,
  totalPolygons, typeCounts, nanCount, zeroAreaCount, invalidNormalCount,
  zFightCount, wallsAtZ0, fillOutRatio, issues
};
const reportPath = join(__dirname, 'analysis-report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nFull report: ${reportPath}`);
console.log('============================================');
