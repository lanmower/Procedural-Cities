import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const docsJs = join(__dirname, '../docs/js');
const toURL = (p) => pathToFileURL(p).href;

const { generateRoads } = await import(toURL(join(docsJs, 'roadGen.js')));
const { extractPlots }  = await import(toURL(join(docsJs, 'plotGen.js')));
const { generateHousePolygons } = await import(toURL(join(docsJs, 'buildingGen.js')));
const { getHouseInfo, floorHeight } = await import(toURL(join(docsJs, 'houseBuilder.js')));

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
if (!found) { console.log('No house found'); process.exit(1); }

const house = found;
const info = getHouseInfo(house);
const pols = info.pols;

const polyArea3D = (pts) => {
  if (pts.length < 3) return 0;
  let ax=0, ay=0, az=0;
  for (let i=1; i<pts.length-1; i++) {
    const dx1=pts[i].x-pts[0].x, dy1=pts[i].y-pts[0].y, dz1=(pts[i].z||0)-(pts[0].z||0);
    const dx2=pts[i+1].x-pts[0].x, dy2=pts[i+1].y-pts[0].y, dz2=(pts[i+1].z||0)-(pts[0].z||0);
    ax+=dy1*dz2-dz1*dy2; ay+=dz1*dx2-dx1*dz2; az+=dx1*dy2-dy1*dx2;
  }
  return Math.hypot(ax,ay,az)*0.5;
};

console.log('Building floors=', house.height, 'floorHeight=', floorHeight);
console.log('Total pols:', pols.length);

const byType = {};
for (const p of pols) {
  const t = p.type || '?';
  if (!byType[t]) byType[t] = {count:0, zeroArea:0, nanV:0, zeroHeight:0, samples:[]};
  byType[t].count++;
  if (!p.points || p.points.length < 3) continue;
  if (p.points.some(v => !isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z||0))) { byType[t].nanV++; continue; }
  const zVals = p.points.map(v => v.z||0);
  const minZ = Math.min(...zVals), maxZ = Math.max(...zVals);
  if (maxZ < 1) byType[t].zeroHeight++;
  const area = polyArea3D(p.points);
  if (area < 0.01) byType[t].zeroArea++;
  if (byType[t].samples.length < 2) byType[t].samples.push({n:p.points.length,area:area.toFixed(2),minZ,maxZ});
}

for (const [t, d] of Object.entries(byType)) {
  console.log(t.padEnd(20), `count=${d.count} zeroArea=${d.zeroArea} nan=${d.nanV} zeroH=${d.zeroHeight}`);
  for (const s of d.samples) console.log('  ', JSON.stringify(s));
}

// Show first few wall-at-z0 polygons in detail
const wallsZ0 = pols.filter(p => (p.type==='exterior'||p.type==='interior') && p.points && Math.max(...p.points.map(v=>v.z||0)) < 1);
console.log('\nWalls with maxZ<1:', wallsZ0.length);
for (const w of wallsZ0.slice(0,3)) {
  console.log('  type='+w.type, 'pts:', JSON.stringify(w.points.map(v=>({x:+v.x.toFixed(0),y:+v.y.toFixed(0),z:+(v.z||0).toFixed(0)}))));
}

// Show zero-area exterior polys
const zeroExt = pols.filter(p => p.type==='exterior' && p.points && polyArea3D(p.points) < 0.01);
console.log('\nZero-area exterior:', zeroExt.length);
for (const p of zeroExt.slice(0,3)) {
  console.log('  pts:', JSON.stringify(p.points.map(v=>({x:+v.x.toFixed(1),y:+v.y.toFixed(1),z:+(v.z||0).toFixed(1)}))));
}

// Check if fillOutPolygon is creating dupes — look for near-identical polygons
const roofPols = pols.filter(p => p.type === 'roof');
console.log('\nRoof polygons:', roofPols.length);
for (const r of roofPols.slice(0,3)) {
  const zVals = (r.points||[]).map(v=>v.z||0);
  console.log('  z range:', Math.min(...zVals).toFixed(0), '..', Math.max(...zVals).toFixed(0), 'pts:', r.points?.length);
}

// Show NaN-producing polygon
const nanPols = pols.filter(p => p.points && p.points.some(v => !isFinite(v.x)||!isFinite(v.y)));
console.log('\nNaN-vertex polygons:', nanPols.length);
for (const p of nanPols.slice(0,2)) {
  console.log('  type='+p.type, 'pts:', JSON.stringify(p.points));
}
