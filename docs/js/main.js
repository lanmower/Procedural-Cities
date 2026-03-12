import * as THREE from 'three';
import { generateRoads } from './roadGen.js';
import { extractPlots } from './plotGen.js';
import { generateBuildings } from './buildingGen.js';
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
    noiseScale: 0.00003,
    primaryStep: 5000,
    secondaryStep: 3000,
    changeIntensity: 30,
    secondaryChangeIntensity: 45,
    maxMainLen: 15,
    maxSecondaryLen: 8,
    mainAdvantage: 0.1,
    standardWidth: 200,
    maxAttach: 2000,
    mainRoadDetrimentRange: 1000000,
    mainRoadDetrimentImpact: 0.01,
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
    const plots = extractPlots(roads, { extraLen: 500, width: 50, middleOffset: 100, maxConnect: 5000 });

    let buildings = [];
    if (cfg.showBuildings) {
      overlay.textContent = 'Generating buildings…';
      await tick();
      for (const plot of plots) {
        const bldgs = generateBuildings(plot, { minFloors: 3, maxFloors: 30, seed: cfg.seed });
        buildings.push(...bldgs);
      }
    }

    overlay.textContent = 'Building meshes…';
    await tick();

    if (currentMesh) {
      ctx.scene.remove(currentMesh);
      currentMesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    currentMesh = buildCityMesh(ctx.scene, roads, plots, buildings);

    // frame the generated city
    const bbox = new THREE.Box3().setFromObject(currentMesh);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z);
    ctx.camera.position.set(center.x, maxDim * 0.6, center.z + maxDim * 0.7);
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
