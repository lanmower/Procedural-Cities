// Find zero-area windowFrame source in building 5
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

let bi = 0;
for (const plot of plots) {
  const housePols = generateHousePolygons(plot, {minFloors:2,maxFloors:30,seed:42,noiseScale:0.0002});
  for (const house of housePols) {
    if (bi === 5) {
      const info = getHouseInfo(house);
      const zeroArea = info.pols.filter(p => p.type==='windowFrame' && p.points && polyArea3D(p.points) < 0.01);
      console.log('Building 5 zero-area windowFrames:', zeroArea.length);
      for (const p of zeroArea.slice(0,5)) {
        const xs=p.points.map(v=>v.x), ys=p.points.map(v=>v.y), zs=p.points.map(v=>v.z||0);
        console.log('  pts:', p.points.length,
          'xRange:', (Math.max(...xs)-Math.min(...xs)).toFixed(2),
          'yRange:', (Math.max(...ys)-Math.min(...ys)).toFixed(2),
          'zRange:', (Math.max(...zs)-Math.min(...zs)).toFixed(2));
        console.log('  sample pt:', JSON.stringify(p.points[0]));
      }
      // Also check what roomFeatures.js version is in use
      const { getWindowFramePolygons } = await import(toURL(join(docsJs, 'roomFeatures.js')));
      const testPts=[{x:0,y:0,z:250},{x:0,y:0,z:50},{x:0,y:0,z:50},{x:0,y:0,z:250}];
      const r=getWindowFramePolygons(testPts,0);
      console.log('roomFeatures degenerate test:', r.length, '(expected 0)');
      break;
    }
    bi++;
  }
  if (bi > 5) break;
}
