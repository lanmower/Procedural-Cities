import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const docsJs = join(__dirname, '../docs/js');
const CACHE_BUST = Date.now();
const toURL = (p) => pathToFileURL(p).href + '?v=' + CACHE_BUST;

const { fillOutPolygon, fillOutPolygons } = await import(toURL(join(docsJs, 'houseBuilder.js')));
const { getSidesOfPolygon, getFloorPolygonsWithHole } = await import(toURL(join(docsJs, 'houseDetail.js')));
const { getHouseInfo, floorHeight } = await import(toURL(join(docsJs, 'houseBuilder.js')));
const { generateHousePolygons } = await import(toURL(join(docsJs, 'buildingGen.js')));

let pass = 0, fail = 0;
function assert(label, cond, detail) {
  if (cond) { console.log(`  PASS: ${label}`); pass++; }
  else { console.log(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`); fail++; }
}
function near(a, b, tol = 0.1) { return Math.abs(a - b) < tol; }

console.log('\n=== TEST 1: fillOutPolygon with rectangle wall ===');
{
  const wallPts = [
    {x:0,y:0,z:0},
    {x:0,y:0,z:400},
    {x:1000,y:0,z:400},
    {x:1000,y:0,z:0},
  ];
  const pol = { points: wallPts, type: 'exterior', width: 20, overridePolygonSides: true };
  const result = fillOutPolygon(pol);
  assert('returns array', Array.isArray(result));
  assert('outer face first', result[0] === pol);
  assert('inner face last (reversed)', result[result.length-1].points !== undefined);
  const innerFace = result[result.length-1];
  assert('inner face type interior', innerFace.type === 'interior');
  const innerYs = innerFace.points.map(p => p.y);
  assert('inner face offset +20 in y', innerYs.every(y => near(y, 20)), `ys: ${innerYs.join(',')}`);
  assert('inner face reversed winding', innerFace.points[0].z > 0 || innerFace.points[1].z > 0);
}

console.log('\n=== TEST 2: fillOutPolygon no sides for exterior (default) ===');
{
  const pol = { points: [{x:0,y:0,z:0},{x:0,y:0,z:400},{x:1000,y:0,z:400},{x:1000,y:0,z:0}], type: 'exterior', width: 20 };
  const result = fillOutPolygon(pol);
  assert('exterior without overridePolygonSides: 2 polys only', result.length === 2, `got ${result.length}`);
}

console.log('\n=== TEST 3: getSidesOfPolygon wall heights ===');
{
  const height = 400;
  const pts = [{x:0,y:0,z:height},{x:1000,y:0,z:height},{x:1000,y:1000,z:height},{x:0,y:1000,z:height}];
  const pol = { points: pts };
  const sides = getSidesOfPolygon(pol, 'exterior', height);
  assert('4 sides for rectangle', sides.length === 4);
  for (const side of sides) {
    const zVals = side.points.map(p => p.z||0);
    const minZ = Math.min(...zVals), maxZ = Math.max(...zVals);
    assert(`side spans z 0-${height}`, near(minZ, 0) && near(maxZ, height), `minZ=${minZ} maxZ=${maxZ}`);
  }
}

console.log('\n=== TEST 4: Single building polygon z-ranges ===');
{
  const plotPts = [{x:0,y:0},{x:700,y:0},{x:700,y:700},{x:0,y:700}];
  const houses = generateHousePolygons({ points: plotPts, open: false }, { minFloors: 3, maxFloors: 3, seed: 42 });
  assert('generateHousePolygons returns at least one building', houses.length > 0, `got ${houses.length}`);
  if (houses.length > 0) {
    const house = houses[0];
    const info = getHouseInfo(house);
    assert('getHouseInfo returns polygons', info.pols.length > 0, `got ${info.pols.length}`);

    const exteriorPols = info.pols.filter(p => p.type === 'exterior' || p.type === 'interior');
    assert('has exterior/interior walls', exteriorPols.length > 0);

    const roofPols = info.pols.filter(p => p.type === 'roof');
    assert('has roof polygons', roofPols.length > 0);

    const floorPols = info.pols.filter(p => p.type === 'floor');
    assert('has floor polygons', floorPols.length > 0);

    const expectedRoofZ = floorHeight * house.height + 1;
    const roofZs = roofPols.flatMap(p => p.points.map(pt => pt.z||0));
    const minRoofZ = Math.min(...roofZs);
    assert(`roof min z near ${expectedRoofZ} (detail may extend above)`, near(minRoofZ, expectedRoofZ, 50), `minRoofZ=${minRoofZ}`);

    const wallZs = exteriorPols.flatMap(p => p.points.map(pt => pt.z||0));
    const minWallZ = Math.min(...wallZs);
    assert('walls start at z=0 (ground floor)', near(minWallZ, 0, 10), `minWallZ=${minWallZ}`);

    console.log(`  Building: ${house.height} floors, roof base z=${minRoofZ.toFixed(0)}, expected ${expectedRoofZ}`);
    console.log(`  Polygons: ${info.pols.length} total`);
    const typeCounts = {};
    for (const p of info.pols) typeCounts[p.type||'?'] = (typeCounts[p.type||'?']||0)+1;
    for (const [t,c] of Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]))
      console.log(`    ${t.padEnd(16)} ${c}`);

    const nanPts = info.pols.flatMap(p=>(p.points||[]).filter(pt=>!isFinite(pt.x)||!isFinite(pt.y)||!isFinite(pt.z||0)));
    assert('zero NaN/Inf vertices', nanPts.length === 0, `found ${nanPts.length}`);
  }
}

console.log('\n=== TEST 5: Window z relative to floor ===');
{
  const plotPts = [{x:0,y:0},{x:700,y:0},{x:700,y:700},{x:0,y:700}];
  const houses = generateHousePolygons({ points: plotPts, open: false }, { minFloors: 3, maxFloors: 3, seed: 42 });
  if (houses.length > 0) {
    const info = getHouseInfo(houses[0]);
    const windows = info.pols.filter(p => p.type === 'window' || p.type === 'windowFrame');
    assert('building has windows or frames', windows.length > 0, `got ${windows.length}`);
    let badZ = 0;
    for (const win of windows) {
      const zVals = win.points.map(p => p.z||0);
      const minWinZ = Math.min(...zVals);
      if (minWinZ < -1) badZ++;
    }
    assert('all window/frame z >= 0', badZ === 0, `${badZ} with z < 0`);
    console.log(`  ${windows.length} window/frame polygons verified`);
  } else {
    console.log('  SKIP: no house generated for test plot');
  }
}

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
