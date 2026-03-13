import * as THREE from 'three';
import { generateRoads } from './roadGen.js?v=full-port-3';
import { extractPlots } from './plotGen.js?v=full-port-3';
import { generateHousePolygons } from './buildingGen.js?v=full-port-3';
import { getHouseInfo } from './houseBuilder.js?v=full-port-3';
import { getSideWalkPolygons, getSidewalkWithDecorations } from './sidewalkGen.js?v=full-port-3';
import { createScene, buildCityMesh } from './scene.js?v=full-port-3';
import { getCrossingsForRoads, getBushesAtCorners, getGrassPatches } from './plotDecorations.js?v=full-port-3';

const overlay = document.getElementById('overlay');
let ctx = null;
let currentMesh = null;

function getConfig() {
  return {
    seed:      parseInt(document.getElementById('seed').value) || 42,
    length:    parseInt(document.getElementById('segments').value) || 400,
    mainBranchChance: parseFloat(document.getElementById('branch').value) || 0.3,
    showBuildings: document.getElementById('bldgs').checked,
    noiseScale: 0.00005,
    primaryStep: 3000,
    secondaryStep: 2000,
    changeIntensity: 5,
    secondaryChangeIntensity: 8,
    maxMainLen: 15,
    maxSecondaryLen: 8,
    mainAdvantage: 0.1,
    standardWidth: 200,
    maxAttach: 2000,
    mainRoadDetrimentRange: 1000000,
    mainRoadDetrimentImpact: 0.01,
    closeMiddle: 800,
  };
}

async function generate() {
  overlay.style.opacity = '1';
  overlay.style.display = 'flex';
  await tick();

  const cfg = getConfig();

  try {
    overlay.textContent = 'Generating roads…';
    await tick();
    const roads = generateRoads(cfg);

    overlay.textContent = 'Extracting plots…';
    await tick();
    const allPlots = extractPlots(roads, { extraLen: 500, width: 50, middleOffset: 100, extraRoadLen: 100, minRoadLen: 500 });
    const plots = allPlots.filter(p => !p.open);

    let materialPols = [];

    overlay.textContent = 'Generating sidewalks…';
    await tick();
    for (const plot of plots) {
      materialPols.push(...getSidewalkWithDecorations(plot, 500));
      const pts = plot.points || plot;
      if (pts && pts.length >= 3) {
        const seed = Math.abs(Math.floor((pts[0].x||0)*1000+(pts[0].y||0))) >>> 0;
        const rng = () => (Math.sin(seed++) * 43758.5453) % 1;
        let s = seed;
        const srng = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s>>>0)/0xffffffff; };
        materialPols.push(...getBushesAtCorners(pts, srng));
        materialPols.push(...getGrassPatches(pts, srng, 6));
      }
    }
    overlay.textContent = 'Generating crosswalks…';
    await tick();
    materialPols.push(...getCrossingsForRoads(roads));

    if (cfg.showBuildings) {
      overlay.textContent = 'Generating buildings…';
      await tick();
      for (const plot of plots) {
        const housePols = generateHousePolygons(plot, { minFloors: 2, maxFloors: 30, seed: cfg.seed, noiseScale: 0.0002 });
        for (const house of housePols) {
          const info = getHouseInfo(house);
          materialPols.push(...info.pols);
        }
      }
    }

    overlay.textContent = 'Building meshes…';
    await tick();

    if (currentMesh) {
      ctx.scene.remove(currentMesh);
      currentMesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    window._dbg = { roads: roads.length, plots: plots.length, materialPols: materialPols.length };
    window._pols = materialPols;
    const openPlots = allPlots.filter(p=>p.open).length;
    console.log('roads:', roads.length, 'plots:', plots.length, '(allPlots:', allPlots.length, 'open:', openPlots, ') materialPols:', materialPols.length);
    currentMesh = buildCityMesh(ctx.scene, roads, plots, materialPols);

    const bbox = new THREE.Box3().setFromObject(currentMesh);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z);
    const groundCenter = new THREE.Vector3(center.x, 0, center.z);
    ctx.camera.position.set(center.x, maxDim * 1.1, center.z + maxDim * 0.4);
    ctx.controls.target.copy(groundCenter);
    ctx.controls.update();

    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 500);
  } catch(e) {
    overlay.textContent = 'Error: ' + e.message;
    console.error(e);
  }
}

function tick() { return new Promise(r => setTimeout(r, 0)); }

window.regenerate = generate;
document.getElementById('btnGen').addEventListener('click', generate);

ctx = createScene(document.body);
window._ctx = ctx;
generate();
