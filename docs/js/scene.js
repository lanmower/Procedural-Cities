// Three.js scene setup and city mesh construction

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SCALE = 0.01;

const BLDG_COLORS = [0x3a3d4a, 0x2e3240, 0x404555, 0x333845, 0x4a4d58, 0x4a3830, 0x3d3028];

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080810);
  scene.fog = new THREE.Fog(0x080810, 300, 1000);

  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 2000);
  camera.position.set(0, 200, 200);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.48;

  scene.add(new THREE.AmbientLight(0x303040, 1.5));

  const sun = new THREE.DirectionalLight(0xfff0e0, 2.0);
  sun.position.set(200, 400, 100);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1500;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -600;
  sun.shadow.camera.right = sun.shadow.camera.top = 600;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x4060a0, 0.5);
  fill.position.set(-100, 50, -200);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshLambertMaterial({ color: 0x111110 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  let frameId;
  (function animate() {
    frameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();

  return { scene, camera, controls, renderer, dispose: () => cancelAnimationFrame(frameId) };
}

export function buildCityMesh(scene, roads, plots, buildings) {
  const group = new THREE.Group();

  // Road surfaces
  const roadQuads = roads.map(r => [r.v1, r.v2, r.v4, r.v3]);
  const roadGeo = mergeQuads(roadQuads, SCALE, 0.1);
  if (roadGeo) {
    const m = new THREE.Mesh(roadGeo, new THREE.MeshLambertMaterial({ color: 0x252521 }));
    m.receiveShadow = true;
    group.add(m);
  }

  // Dashed center lines on main roads
  const lineQuads = [];
  for (const r of roads) {
    if (r.type !== 'main') continue;
    const dx = r.p2.x - r.p1.x, dy = r.p2.y - r.p1.y;
    const len = Math.hypot(dx, dy);
    const tx = dx / len, ty = dy / len;
    const nx = -ty, ny = tx;
    const lw = 15;
    let pos = 600;
    while (pos < len - 300) {
      const s = { x: r.p1.x + tx * pos, y: r.p1.y + ty * pos };
      const e = { x: r.p1.x + tx * (pos + 300), y: r.p1.y + ty * (pos + 300) };
      lineQuads.push([
        { x: s.x + nx * lw, y: s.y + ny * lw },
        { x: s.x - nx * lw, y: s.y - ny * lw },
        { x: e.x - nx * lw, y: e.y - ny * lw },
        { x: e.x + nx * lw, y: e.y + ny * lw }
      ]);
      pos += 600;
    }
  }
  const lineGeo = mergeQuads(lineQuads, SCALE, 0.15);
  if (lineGeo) group.add(new THREE.Mesh(lineGeo, new THREE.MeshLambertMaterial({ color: 0xd0c060 })));

  // Plot fills (sidewalk / ground between roads)
  const plotGeo = mergePolygons(plots, SCALE, 0.05);
  if (plotGeo) {
    const m = new THREE.Mesh(plotGeo, new THREE.MeshLambertMaterial({ color: 0x2a2a27 }));
    m.receiveShadow = true;
    group.add(m);
  }

  // Buildings
  const mats = BLDG_COLORS.map(c => new THREE.MeshLambertMaterial({ color: c }));

  for (const b of buildings) {
    const fp = b.footprint;
    if (fp.length < 3) continue;

    const shape = new THREE.Shape();
    shape.moveTo(fp[0].x * SCALE, fp[0].y * SCALE);
    for (let i = 1; i < fp.length; i++) shape.lineTo(fp[i].x * SCALE, fp[i].y * SCALE);
    shape.closePath();

    const h = b.floors * 4;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);

    const idx = Math.abs(Math.floor(b.center.x * 7 + b.center.y * 13)) % mats.length;
    const mesh = new THREE.Mesh(geo, mats[idx]);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  scene.add(group);
  return group;
}

function mergeQuads(quads, sc, yOff = 0) {
  if (!quads.length) return null;
  const pos = [], idx = [];
  let vi = 0;
  for (const [a, b, c, d] of quads) {
    for (const p of [a, b, c, d]) pos.push(p.x * sc, yOff, p.y * sc);
    idx.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
    vi += 4;
  }
  return buildGeo(pos, idx);
}

function mergePolygons(polys, sc, yOff = 0) {
  const pos = [], idx = [];
  let vi = 0;
  for (const pts of polys) {
    if (pts.length < 3) continue;
    const verts2d = pts.map(p => new THREE.Vector2(p.x * sc, p.y * sc));
    const shape = new THREE.Shape(verts2d);
    const tris = THREE.ShapeUtils.triangulateShape(shape.getPoints(), []);
    const base = vi;
    for (const p of shape.getPoints()) { pos.push(p.x, yOff, p.y); vi++; }
    for (const [a, b, c] of tris) idx.push(base+a, base+b, base+c);
  }
  if (!pos.length) return null;
  return buildGeo(pos, idx);
}

function buildGeo(pos, idx) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
