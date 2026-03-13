import * as THREE from 'three';
import { generateRoads } from './roadGen.js';
import { extractPlots } from './plotGen.js';
import { generateHousePolygons } from './buildingGen.js';
import { getHouseInfo } from './houseBuilder.js';
import { getSideWalkPolygons } from './sidewalkGen.js';
import { createScene, buildCityMesh } from './scene.js';

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
      materialPols.push(...getSideWalkPolygons(plot, 500));
    }

    if (cfg.showBuildings) {
      overlay.textContent = 'Generating buildings…';
      await tick();
      for (const plot of plots) {
        const housePols = generateHousePolygons(plot, { minFloors: 3, maxFloors: 60, seed: cfg.seed, noiseScale: cfg.noiseScale });
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
