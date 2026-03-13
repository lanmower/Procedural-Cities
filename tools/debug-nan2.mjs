// Trace NaN source at runtime by patching v3norm and other functions
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const docsJs = join(__dirname, '../docs/js');
const toURL = (p) => pathToFileURL(p).href;

const { generateRoads } = await import(toURL(join(docsJs, 'roadGen.js')));
const { extractPlots }  = await import(toURL(join(docsJs, 'plotGen.js')));
const { generateHousePolygons } = await import(toURL(join(docsJs, 'buildingGen.js')));
const { getHouseInfo } = await import(toURL(join(docsJs, 'houseBuilder.js')));

const cfg = {seed:42,length:400,noiseScale:0.00005,primaryStep:3000,secondaryStep:2000,
  changeIntensity:5,secondaryChangeIntensity:8,maxMainLen:15,maxSecondaryLen:8,
  mainBranchChance:0.3,mainAdvantage:0.1,standardWidth:200,maxAttach:2000,
  mainRoadDetrimentRange:1000000,mainRoadDetrimentImpact:0.01,closeMiddle:800};

const roads = generateRoads(cfg);
const allPlots = extractPlots(roads, {extraLen:500,width:50,middleOffset:100,extraRoadLen:100,minRoadLen:500});
const plots = allPlots.filter(p => p.open === false);

// Instrument: check if house.points has NaN before/after each floor step
// Do this by processing building 6
let bi = 0;
for (const plot of plots) {
  const housePols = generateHousePolygons(plot, {minFloors:2,maxFloors:30,seed:42,noiseScale:0.0002});
  for (const house of housePols) {
    if (bi === 6) {
      console.log('=== Building 6 diagnosis ===');
      console.log('house.points:', house.points.map(p=>({x:+p.x.toFixed(0),y:+p.y.toFixed(0)})));
      console.log('floors:', house.height);

      // Check if makeInteresting corrupts points
      // makeInteresting is called in getHouseInfo with f.canBeModified
      // It calls attemptMoveSideInwards which modifies f.points in place
      // Then potentiallyShrink also modifies f.points

      // Reproduce the issue manually
      const { getShaftHolePolygon, potentiallyShrink, getInteriorPlanAndPlaceEntrancePolygons } = await import(toURL(join(docsJs, 'houseBuilder.js')));
      const { makeInteresting } = await import(toURL(join(docsJs, 'housePlan.js')));
      const { seededRandom } = await import(toURL(join(docsJs, 'noise.js')));
      const { polyIsClockwise, polyCenter } = await import(toURL(join(docsJs, 'utils.js')));
      const { xy, withZ, polyPolyIntersects2D, pointInPoly2D } = await import(toURL(join(docsJs, 'houseGeom.js')));

      const f = {
        points: house.points.map(p => ({...p})),
        windows: new Set(house.windows),
        entrances: new Set(house.entrances),
        height: house.height,
        canBeModified: house.canBeModified !== false,
      };
      const ptsXY = f.points.map(xy);
      const center = polyCenter(ptsXY);
      const rng = seededRandom(Math.abs(Math.floor(center.x + center.y)) >>> 0);

      // Simulate getHouseInfo up to roof polygon
      const pre = { points: f.points.map(p=>({...p})), windows: new Set(f.windows), entrances: new Set(f.entrances) };

      const holeValid = (h) => h && !polyPolyIntersects2D(h.map(xy), ptsXY) && h.every(p => pointInPoly2D(xy(p), ptsXY));
      let hole = getShaftHolePolygon(f, rng, false);
      if (!holeValid(hole)) hole = getShaftHolePolygon(f, rng, true);
      if (!holeValid(hole)) hole = getShaftHolePolygon(f, rng, true, 0.6);
      if (!holeValid(hole)) hole = getShaftHolePolygon(f, rng, true, 0.35);
      if (!holeValid(hole)) hole = getShaftHolePolygon(f, rng, true, 0.18);
      if (!holeValid(hole)) { console.log('hole invalid'); process.exit(1); }

      const floorHeight = 400;
      const makeInterestingAttempts = 4;
      const maxChangeIntensity = 0.35;
      const toReturn = { pols: [], meshes: [], remainingPlots: [] };

      if (f.canBeModified !== false) {
        for (let i = 0; i < makeInterestingAttempts; i++) {
          makeInteresting(f, toReturn.remainingPlots, hole, rng);
          const hasNaN = f.points.some(p => !isFinite(p.x) || !isFinite(p.y));
          if (hasNaN) { console.log(`NaN in f.points after makeInteresting attempt ${i}`); break; }
        }
      }

      const floors = Math.max(1, f.height || 3);
      const myChangeIntensity = rng() * maxChangeIntensity;

      for (let i = 1; i < floors; i++) {
        if (rng() < myChangeIntensity && f.canBeModified !== false) {
          const before = f.points.map(p=>({...p}));
          toReturn.pols.push(...potentiallyShrink(f, hole, rng, {x:0,y:0,z:floorHeight*i+1}));
          const hasNaN = f.points.some(p => !isFinite(p.x) || !isFinite(p.y));
          if (hasNaN) {
            console.log(`NaN in f.points after potentiallyShrink at floor ${i}`);
            console.log('Before:', before.map(p=>({x:+p.x.toFixed(0),y:+p.y.toFixed(0)})));
            console.log('After:', f.points.map(p=>({x:p.x,y:p.y})));
            break;
          }
        } else {
          rng(); // consume rng for skipped change
        }
      }

      const roofPol = { points: f.points.map(p=>withZ(xy(p),floorHeight*floors+1)), type:'roof', normal:{x:0,y:0,z:-1} };
      const hasNaNRoof = roofPol.points.some(p => !isFinite(p.x) || !isFinite(p.y));
      console.log('roofPol NaN:', hasNaNRoof);
      console.log('f.points after loop:', f.points.map(p=>({x:p.x,y:p.y})));
      break;
    }
    bi++;
  }
  if (bi > 6) break;
}
