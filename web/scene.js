
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { CELL_HEX, cellRGB } from "./cellcolors.js";

export const CELL_COLORS = Object.fromEntries(Object.entries(CELL_HEX).map(([k, v]) => [k, new THREE.Color(v)]));

export function createScene(canvas, { radius = 20.5, center = 21.5 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#2a313c");
  scene.fog = new THREE.Fog("#2a313c", radius * 4, radius * 9);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, radius * 30);
  camera.position.set(radius * 2.3, radius * 1.45, radius * 3.2);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = radius * 0.6;
  controls.maxDistance = radius * 8;
  controls.autoRotateSpeed = 0.7;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.update();

  const hemi = new THREE.HemisphereLight("#bcd3ff", "#3a2a22", 0.9);
  const key = new THREE.DirectionalLight("#fff1e0", 2.2);
  key.position.set(radius * 2, radius * 3, radius * 2.5);
  const rim = new THREE.DirectionalLight("#7fb2ff", 1.6);
  rim.position.set(-radius * 2.5, radius * 0.8, -radius * 3);
  const fill = new THREE.PointLight("#ffd9c2", 0.6, 0, 0);
  camera.add(fill);
  scene.add(hemi, key, rim, camera);

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 3),
    new THREE.MeshBasicMaterial({ color: "#c0485a", wireframe: true, transparent: true, opacity: 0.07, depthWrite: false }),
  );
  scene.add(shell);

  const maxCells = Math.ceil((4 / 3) * Math.PI * (radius + 1) ** 3);
  const geo = new THREE.IcosahedronGeometry(0.5, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.0 });
  const cells = new THREE.InstancedMesh(geo, mat, maxCells);
  cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cells.setColorAt(0, CELL_COLORS.sensitive);
  cells.instanceColor.setUsage(THREE.DynamicDrawUsage);
  cells.count = 0;
  cells.frustumCulled = false;
  scene.add(cells);

  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  let colorMode = "resistance", cutaway = 0, showDead = true;

  function drawCells(sim) {
    const g = sim.grid, st = g.state;
    const cutZ = radius - 2 * radius * cutaway;
    let n = 0;
    for (const i of g.domain) {
      const s = st[i];
      if (s === 0 || (s === 3 && !showDead)) continue;
      const [x, y, z] = g.coords(i);
      const px = x - center, py = y - center, pz = z - center;
      if (cutaway > 0 && pz > cutZ) continue;
      const scale = s === 3 ? 0.55 : s === 2 ? 0.85 : 1;
      m4.makeScale(scale, scale, scale).setPosition(px, py, pz);
      cells.setMatrixAt(n, m4);
      const rgb = cellRGB(sim, i, colorMode);
      col.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
      cells.setColorAt(n, col);
      n++;
    }
    cells.count = n;
    cells.instanceMatrix.needsUpdate = true;
    cells.instanceColor.needsUpdate = true;
    return n;
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const frameHooks = [];
  renderer.setAnimationLoop(() => {
    for (const f of frameHooks) f();
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    scene, camera, controls, renderer, cells, lights: { hemi, key, rim, fill }, shell,
    drawCells,
    onFrame(f) { frameHooks.push(f); },
    setAutoRotate(on) { controls.autoRotate = on; },
    setCutaway(v) { cutaway = v === true ? 0.5 : v === false ? 0 : Math.min(1, Math.max(0, +v)); },
    setShowDead(on) { showDead = on; },
    setColorMode(m) { colorMode = m; },
    showShell(on) { shell.visible = on; },
    resetCamera() { camera.position.set(radius * 2.3, radius * 1.45, radius * 3.2); controls.target.set(0, 0, 0); controls.update(); },
  };
}
