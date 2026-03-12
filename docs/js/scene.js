import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SCALE = 0.01;

const MATS = {
  exterior:    new THREE.MeshLambertMaterial({ color: 0xd0cfc8, side: THREE.DoubleSide }),
  exteriorSnd: new THREE.MeshLambertMaterial({ color: 0xb8b4a8, side: THREE.DoubleSide }),
  interior:    new THREE.MeshLambertMaterial({ color: 0xe8e4dc, side: THREE.DoubleSide }),
  floor:       new THREE.MeshLambertMaterial({ color: 0x9a9590 }),
  roof:        new THREE.MeshLambertMaterial({ color: 0x787470 }),
  road:        new THREE.MeshLambertMaterial({ color: 0x3a3a36 }),
  roadLine:    new THREE.MeshLambertMaterial({ color: 0xd0c060 }),
  plot:        new THREE.MeshLambertMaterial({ color: 0x454540 }),
};

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb8cce0);
  scene.fog = new THREE.FogExp2(0xb8cce0, 0.0003);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 10000);
  camera.position.set(0, 300, 300);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const sun = new THREE.DirectionalLight(0xfff8e8, 2.5);
  sun.position.set(300, 600, 200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 3000;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -800;
  sun.shadow.camera.right = sun.shadow.camera.top = 800;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8090c0, 0.6);
  fill.position.set(-200, 100, -300);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshLambertMaterial({ color: 0x4a5a40 })
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

export function buildCityMesh(scene, roads, plots, materialPols) {
  const group = new THREE.Group();

  // Roads
  const roadQuads = roads.map(r => [r.v1, r.v2, r.v4, r.v3]);
  const roadGeo = mergeQuads(roadQuads, SCALE, 0.1);
  if (roadGeo) {
    const m = new THREE.Mesh(roadGeo, MATS.road);
    m.receiveShadow = true;
    group.add(m);
  }

  // Road center lines (main roads)
  const lineQuads = [];
  for (const r of roads) {
    if (r.type !== 'main') continue;
    const dx = r.p2.x - r.p1.x, dy = r.p2.y - r.p1.y;
    const len = Math.hypot(dx, dy), tx = dx/len, ty = dy/len;
    const lw = 10;
    let pos = 400;
    while (pos < len - 200) {
      const s = { x: r.p1.x + tx*pos, y: r.p1.y + ty*pos };
      const e = { x: r.p1.x + tx*(pos+200), y: r.p1.y + ty*(pos+200) };
      lineQuads.push([
        { x: s.x - ty*lw, y: s.y + tx*lw }, { x: s.x + ty*lw, y: s.y - tx*lw },
        { x: e.x + ty*lw, y: e.y - tx*lw }, { x: e.x - ty*lw, y: e.y + tx*lw }
      ]);
      pos += 400;
    }
  }
  const lineGeo = mergeQuads(lineQuads, SCALE, 0.12);
  if (lineGeo) group.add(new THREE.Mesh(lineGeo, MATS.roadLine));

  // Plot fills
  const plotGeo = mergePolygons(plots, SCALE, 0.05);
  if (plotGeo) {
    const m = new THREE.Mesh(plotGeo, MATS.plot);
    m.receiveShadow = true;
    group.add(m);
  }

  // Building material polygons grouped by type
  const byType = {};
  for (const pol of materialPols) {
    const t = pol.type || 'exterior';
    if (!byType[t]) byType[t] = [];
    byType[t].push(pol.points);
  }

  for (const [type, polList] of Object.entries(byType)) {
    const mat = MATS[type] || MATS.exterior;
    const geo = mergePolygons3D(polList, SCALE);
    if (geo) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
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

// Render 3D material polygons (walls/floors/roofs with z coordinate)
function mergePolygons3D(polys, sc) {
  const pos = [], idx = [];
  let vi = 0;
  for (const pts of polys) {
    if (!pts || pts.length < 3) continue;
    // For quads (walls): render as two triangles
    if (pts.length === 4) {
      for (const p of pts) pos.push(p.x * sc, (p.z || 0) * sc, p.y * sc);
      idx.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
      vi += 4;
    } else {
      // triangulate flat polygons
      const verts2d = pts.map(p => new THREE.Vector2(p.x * sc, p.y * sc));
      const shape = new THREE.Shape(verts2d);
      const tris = THREE.ShapeUtils.triangulateShape(shape.getPoints(), []);
      const base = vi;
      const z = (pts[0].z || 0) * sc;
      for (const p of shape.getPoints()) { pos.push(p.x, z, p.y); vi++; }
      for (const [a, b, c] of tris) idx.push(base+a, base+b, base+c);
    }
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
