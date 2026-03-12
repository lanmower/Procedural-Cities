import * as THREE from 'three';
import { generateRoads } from './roadGen.js';
import { extractPlots } from './plotGen.js';
import { generateHousePolygons } from './buildingGen.js';
import { getHouseInfo } from './houseBuilder.js';
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
    noiseScale: 0.0003,
    primaryStep: 600,
    secondaryStep: 400,
    changeIntensity: 30,
    secondaryChangeIntensity: 45,
    maxMainLen: 20,
    maxSecondaryLen: 10,
    mainAdvantage: 0.1,
    standardWidth: 20,
    maxAttach: 200,
    mainRoadDetrimentRange: 100000,
    mainRoadDetrimentImpact: 0.01,
    closeMiddle: 400,
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
    const minRoadLen = Math.floor(cfg.primaryStep * 0.15);
    const plots = extractPlots(roads, { extraLen: Math.floor(cfg.primaryStep * 0.08), width: 5, middleOffset: Math.floor(cfg.primaryStep * 0.016), minRoadLen });

    let materialPols = [];
    if (cfg.showBuildings) {
      overlay.textContent = 'Generating buildings…';
      await tick();
      for (const plot of plots) {
        const housePols = generateHousePolygons(plot, { minFloors: 3, maxFloors: 60, seed: cfg.seed, roadStep: cfg.primaryStep || 600 });
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
    currentMesh = buildCityMesh(ctx.scene, roads, plots, materialPols);

    const bbox = new THREE.Box3().setFromObject(currentMesh);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z);
    ctx.camera.position.set(center.x, maxDim * 0.8, center.z + maxDim * 0.9);
    ctx.controls.target.copy(center);
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
generate();
