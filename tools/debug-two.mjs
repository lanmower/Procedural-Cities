// Deep-dive: find exact source of each bug type
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const docsJs = join(__dirname, '../docs/js');
const toURL = (p) => pathToFileURL(p).href;

const { generateRoads } = await import(toURL(join(docsJs, 'roadGen.js')));
const { extractPlots }  = await import(toURL(join(docsJs, 'plotGen.js')));
const { generateHousePolygons } = await import(toURL(join(docsJs, 'buildingGen.js')));
const { getHouseInfo, floorHeight } = await import(toURL(join(docsJs, 'houseBuilder.js')));
const { fillOutPolygon } = await import(toURL(join(docsJs, 'houseGeom.js')));

const cfg = {seed:42,length:100,noiseScale:0.00005,primaryStep:3000,secondaryStep:2000,
  changeIntensity:5,secondaryChangeIntensity:8,maxMainLen:15,maxSecondaryLen:8,
  mainBranchChance:0.3,mainAdvantage:0.1,standardWidth:200,maxAttach:2000,
  mainRoadDetrimentRange:1000000,mainRoadDetrimentImpact:0.01,closeMiddle:800};

const roads = generateRoads(cfg);
const allPlots = extractPlots(roads, {extraLen:500,width:50,middleOffset:100,extraRoadLen:100,minRoadLen:500});
const plots = allPlots.filter(p => p.open === false);

let found = null;
for (const plot of plots) {
  const hp = generateHousePolygons(plot, {minFloors:2,maxFloors:30,seed:42,noiseScale:0.0002});
  if (hp.length > 0) { found = hp[0]; break; }
}
const house = found;

// --- TEST: fillOutPolygon on a simple wall quad ---
console.log('=== fillOutPolygon test ===');

// Simulate a typical exterior wall quad from interiorPlanToPolygons
// A wall going from (0,0,0) to (500,0,0) with height 400
const testWall = {
  points: [
    {x:0,   y:0, z:400},
    {x:0,   y:0, z:0},
    {x:500, y:0, z:0},
    {x:500, y:0, z:400},
  ],
  type: 'exterior',
  width: 50
};
const fillResult = fillOutPolygon(testWall);
console.log('Input wall (y=0 wall):');
console.log('  Points:', JSON.stringify(testWall.points.map(p=>({x:p.x,y:p.y,z:p.z}))));
console.log('fillOutPolygon results:', fillResult.length, 'polygons');
for (const p of fillResult) {
  const pts = p.points.map(v=>({x:+v.x.toFixed(1),y:+v.y.toFixed(1),z:+(v.z||0).toFixed(1)}));
  // Check if degenerate
  const unique = new Set(pts.map(v=>JSON.stringify(v))).size;
  console.log('  type='+p.type, 'unique_pts='+unique+'/'+pts.length, JSON.stringify(pts));
}

// Test with a diagonal wall (non-axis-aligned)
const testWall2 = {
  points: [
    {x:0,   y:0,   z:400},
    {x:0,   y:0,   z:0},
    {x:300, y:400, z:0},
    {x:300, y:400, z:400},
  ],
  type: 'exterior',
  width: 50
};
const fillResult2 = fillOutPolygon(testWall2);
console.log('\nInput diagonal wall:');
console.log('  Points:', JSON.stringify(testWall2.points.map(p=>({x:p.x,y:p.y,z:p.z}))));
console.log('fillOutPolygon results:', fillResult2.length, 'polygons');
for (const p of fillResult2) {
  const pts = p.points.map(v=>({x:+v.x.toFixed(1),y:+v.y.toFixed(1),z:+(v.z||0).toFixed(1)}));
  const unique = new Set(pts.map(v=>JSON.stringify(v))).size;
  console.log('  type='+p.type, 'unique_pts='+unique+'/'+pts.length, JSON.stringify(pts));
}

// --- What does getPolygonDirection return for the walls? ---
console.log('\n=== getPolygonDirection analysis ===');

// The polygon normal for a wall: e1 = first edge, last edge direction used
// For testWall: pts[0]=(0,0,400), pts[1]=(0,0,0), last=pts[3]=(500,0,400)
// e1 = normalize((0,0,-400)) = (0,0,-1)
// a = pts[3]-pts[0] = (500,0,0)
// cross(e1, a) = cross((0,0,-1),(500,0,0)) = (0*0-(-1)*0, (-1)*500-0*0, 0*0-0*500) = (0,-500,0)
// n = (0,-1,0) — correct inward normal for a y=0 wall!
// offset = (0,-50,0) — moves all points 50 units in -y direction
// So inner face has y=-50: that IS valid (thickness)

// For the DEGENERATE case seen: pts all at {x:2700.2,y:-97.5}
// Those 4 points form a rectangle in Z only (same x,y, different z)
// This is not a wall - it's a degenerate polygon from a zero-length edge
console.log('For a zero-length-edge wall quad (p1==p2):');
const zeroEdgeWall = {
  points: [
    {x:2700, y:-97, z:400},
    {x:2700, y:-97, z:0},
    {x:2700, y:-97, z:0},   // duplicate of p1
    {x:2700, y:-97, z:400}, // duplicate of p0
  ],
  type: 'exterior', width: 50
};
// manual normal:
// e1 = normalize((0,0,-400)) = (0,0,-1)
// a = pts[3]-pts[0] = (0,0,0)
// cross((0,0,-1),(0,0,0)) = (0,0,0) → zero length!
console.log('Expected: zero normal (degenerate polygon)');
const fillDegenerate = fillOutPolygon(zeroEdgeWall);
for (const p of fillDegenerate) {
  const pts = p.points.map(v=>({x:+v.x.toFixed(1),y:+v.y.toFixed(1),z:+(v.z||0).toFixed(1)}));
  const unique = new Set(pts.map(v=>JSON.stringify(v))).size;
  console.log('  type='+p.type, 'unique_pts='+unique, JSON.stringify(pts));
}

// --- Check what's producing the zero-edge walls ---
// These seem to come from interiorPlanToPolygons with door insertion
// Let's trace: wallPts.splice(2, 0, dL, v3add(dL,{z:doorH}), v3add(dR,{z:doorH}), dR)
// If p1==p2 (zero-length edge), then dL==dR, and splice produces repeated points
console.log('\n=== Check corridor corner polygon issue ===');
const info = getHouseInfo(house);
const cornersWalls = info.pols.filter(p =>
  p.type === 'interior' && p.points && p.points.length === 3 &&
  Math.max(...p.points.map(v=>v.z||0)) < 1
);
console.log('Corner interior triangles at z=0:', cornersWalls.length);
for (const w of cornersWalls.slice(0, 2)) {
  console.log('  pts:', JSON.stringify(w.points.map(v=>({x:+v.x.toFixed(0),y:+v.y.toFixed(0),z:+(v.z||0).toFixed(0)}))));
}

// How many total pols does fillOutPolygons produce from a simple set of pols?
// Before fillOutPolygon is called in houseBuilder, what's in pols?
// The issue in houseBuilder.js line 98: fillOutPolygons(toReturn.pols)
// This runs fillOutPolygon on EVERY polygon including floors, roofs, already-filled walls
// C++ only does this when !shellOnly AND it appears after rooms are built

// Count polygon types from the info without filtering
const byType = {};
for (const p of info.pols) {
  const t = p.type||'?'; byType[t]=(byType[t]||0)+1;
}
console.log('\nFull polygon type breakdown (1 building):');
for (const [t,c] of Object.entries(byType).sort((a,b)=>b[1]-a[1])) {
  console.log(' ', t.padEnd(20), c);
}

// Check: count windowFrame polygons vs windows
// 20328 windowFrames for 1 building seems way too many
// Each window should produce ~4-8 frame polys
// 4620 windows * ~4 frames = ~18480 — OK if windowFrames=true
// But buildApartmentRoom passes windowFrames=true!
// In C++, shellOnly controls whether to use window frames or just occlusionWindows
// In JS, houseBuilder.js buildApartmentRoom always passes windowFrames=true
console.log('\nWindow/frame analysis:');
console.log('  windows:', byType.window||0);
console.log('  windowFrames:', byType.windowFrame||0);
console.log('  Ratio:', ((byType.windowFrame||0)/(byType.window||1)).toFixed(1));
// getWindowFramePolygons: how many polys per window?
const { getWindowFramePolygons } = await import(toURL(join(docsJs, 'roomFeatures.js')));
const sampleWin = [{x:0,y:0,z:250},{x:0,y:0,z:50},{x:120,y:0,z:50},{x:120,y:0,z:250}];
const frames = getWindowFramePolygons(sampleWin, 0);
console.log('  getWindowFramePolygons returns:', frames.length, 'polys per window');
