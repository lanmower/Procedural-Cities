// Find NaN source in roof polygons
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

let bi = 0;
for (const plot of plots) {
  const housePols = generateHousePolygons(plot, {minFloors:2,maxFloors:30,seed:42,noiseScale:0.0002});
  for (const house of housePols) {
    const info = getHouseInfo(house);
    const nanPols = info.pols.filter(p => p.points && p.points.some(v => !isFinite(v.x)||!isFinite(v.y)||!isFinite(v.z||0)));
    if (nanPols.length > 0) {
      console.log(`Building ${bi}: ${nanPols.length} NaN polygons, floors=${house.height}`);
      for (const p of nanPols.slice(0, 2)) {
        console.log(`  type=${p.type} pts:`, JSON.stringify(p.points.slice(0,4).map(v=>({x:v.x,y:v.y,z:v.z||0}))));
      }
      // Check the roof polygon's points to find which is degenerate
      const roofPol = { points: house.points.map(p=>({...p, z: (house.height * 400) + 1})), type:'roof', normal:{x:0,y:0,z:-1} };
      console.log('  roof polygon pts:', roofPol.points.length);
      // Identify which pts are NaN
      for (const p of nanPols.slice(0,1)) {
        const nanIdx = p.points.findIndex(v => !isFinite(v.x)||!isFinite(v.y));
        console.log(`  NaN at index ${nanIdx}:`, JSON.stringify(p.points[nanIdx]));
        // The placeRows function: center + tangent*(rng-0.5)*1000 + normal*(rng-0.5)*1000
        // tangent = v3norm(v3sub(pts[1], pts[0]))
        // If pts[0] == pts[1], tangent is {0,0,0} (normalized zero = {0,0,0})
        // normal = rot90_3(tangent) = rot90_3({0,0,0}) = {0,0,0}
        // center + {0,0,0}*(rng-0.5)*1000 = center -- that's fine
        // but base = center + ... should be ok
        // Wait: placeRows adds v3scale(tangent,...)*rng then rot90 tangent for normal
        // If tangent = {0,0,0}, then base = center (ok)
        // Then the box points: v3add(base, v3add(v3scale(tangent,-iW/2), v3scale(normal,-iD/2)))
        // = base + {0} + {0} = base -- that's ok (just stacks at center)
        // Hmm so NaN might come from ELSEWHERE
        // Let me check roof detail more carefully
        console.log('  house.points[0]:', JSON.stringify(house.points[0]));
        console.log('  house.points[1]:', JSON.stringify(house.points[1]));
        const t = {x:house.points[1].x-house.points[0].x, y:house.points[1].y-house.points[0].y};
        const tlen = Math.hypot(t.x,t.y);
        console.log('  tangent len (pts[0]->pts[1]):', tlen.toFixed(2));
      }
    }
    bi++;
  }
}

// Now reproduce: NaN in building 6 and 8
// Let me trace addDetailOnPolygon more carefully
// The getSplitProposal can fail with NaN if polygon points are weird
// Check: in addDetailOnPolygon, for the "same shape but smaller" branch:
// shape.points = pol.points.map(p => v3add(p,{z:offset}))
// getSplitProposal(shapeXY, polyIsClockwise(shapeXY), 0.5) where shapeXY = shape.points.map(xy)
// If all points have same x,y (degenerate polygon), getSplitProposal can return NaN?

// The shrunkPts branch:
// shrunkPts = shapeXY.map((_,i2) => {
//   const dir2 = v3norm(getPointDirection(shape.points, i2));
//   return {x:shapeXY[i2].x+dir2.x*d, y:shapeXY[i2].y+dir2.y*d};
// });
// getPointDirection: e1 = v3norm(v3sub(pts[i], pts[(i+n-1)%n]))
// If n=1 or pts[i] == pts[(i-1+n)%n], e1 = {0,0,0}
// Then the sum {x:-(e1.y+e2.y), y:(e1.x+e2.x), z:0} = {0,0,0}
// v3norm({0,0,0}) = {0,0,0}  -- NOT NaN
// So shrunkPts = shapeXY[i2] itself -- not NaN

// What about splitPolygonAlongMax?  getSplitProposal uses segIntersect
// segIntersect: if denom < 1e-10, returns null -- not NaN

// The concrete NaN source: looking at addDetailOnPolygon line 47:
// shape = {points: [...pol.points].reverse().map(p => v3add(p,{z:size}))}
// getSidesOfPolygon(shape,'exteriorSnd',size):
//   for each edge: [pts[i-1], v3sub(pts[i-1],{z:size}), v3sub(pts[i%n],{z:size}), pts[i%n]]
// These are all finite.
// Then fillOutPolygons(sides): for each side, width=(20+rng()*130)
// fillOutPolygon computes getPolygonDirection on the side quad
// If the side quad has zero area (e.g. pts[i-1]==pts[i%n]), direction = {0,0,-1}
// off = {0,0,-width} -- that gives inner pts offset in z, which is finite
// So not NaN from there either.

// Maybe the NaN is from addDetailOnPolygon's box placement?
// box.points: p1=randPt+{z:offset}, p2=p1+tangent*firstLen, p3=p2+t2*sndLen, p4=...
// tangent = v3norm(v3sub(pol.points[1], pol.points[0]))
// If pol.points[1] == pol.points[0], tangent = {0,0,0}
// p2 = p1 + {0,0,0}*firstLen = p1
// t2 = rot90_3(tangent) = {0,0,0}
// p3 = p2 + {0,0,0}*sndLen = p2 = p1
// p4 = p3 + rot90_3({0,0,0})*v3dist(p1,p2) = p1 + {0,0,0}*0 = p1
// All same point -- degenerate box. But still finite!

// v3norm({0,0,0}) = {0,0,0} not NaN
// Hmm, let me check: what about tan in placeRows?
// v3norm(v3sub(pts[1],pts[0])): if pts[0]==pts[1], result {0,0,0}
// rot90_3({0,0,0}) = {0,0,0}
// base = center + v3scale({0,0,0},(rng-0.5)*1000) + v3scale({0,0,0},(rng-0.5)*1000) = center
// box points: v3add(base, v3add(v3scale(tangent,-iW/2), v3scale(normal,-iD/2)))
//           = base + {0} + {0} = base -- finite

// Something else must cause NaN. Let me check getSplitProposal more carefully.
// segIntersect: if |denom| < 1e-10, returns NULL
// add(p1, scale(tangent, 100000)) where tangent is from normalize -- if tangent = {0,0}, then the extended point = p1
// segIntersect(p1, p1, pts[i], pts[iNext]) -- a segment of zero length. denom may be 0 -> null
// So getSplitProposal returns null (not NaN)

// What if polyIsClockwise of a degenerate polygon returns wrong result?
// That feeds into shrinkPoly direction. shrinkPoly: normalize({x:0,y:0}) = {0,0} (not NaN)

// Maybe NaN comes from getWindowFramePolygons?
// v3norm of v3sub(center, p1): if center == p1, returns {0,0,0}
// quad = [p1, p2, p2+{0}*frameWidth, p1+{0}*frameWidth] = [p1, p2, p2, p1] (degenerate but finite)
// off = v3scale(winNormal, frameDepth/2-20): winNormal=v3norm(rot90_3(v3sub(p2,p1)))
//   if p2==p1: rot90_3({0,0,0})={0,0,0}, v3norm({0,0,0})={0,0,0}
//   off = {0,0,0} -- finite

// I'm not finding an obvious NaN source analytically. Let me add more targeted tracing.
console.log('\nDone - no obvious NaN source found analytically');
console.log('NaN polygons found in analysis run - need runtime tracing');
