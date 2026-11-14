// Three.js; renderer, orbit camera, lighting, and the instanced cells

import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { RES_MASK } from "../cells.js";
import { CELL_HEX } from "./cellcolors.js";

export const CELL_COLORS = Object.fromEntries(Object.entries(CELL_HEX).map(([k, v]) => [k, new THREE.Color(v)]));

export function createScene(canvas, { radius = 20.5, center = 21.5 } = {}) {
  // renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0f17");
  scene.fog = new THREE.Fog("#0b0f17", radius * 4, radius * 9);   

  // camera + orbit controls 
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

  //  lighting 
  const hemi = new THREE.HemisphereLight("#bcd3ff", "#3a2a22", 0.9);      // sky / ground fill
  const key = new THREE.DirectionalLight("#fff1e0", 2.2);                  // main light
  key.position.set(radius * 2, radius * 3, radius * 2.5);
  const rim = new THREE.DirectionalLight("#7fb2ff", 1.6);                  // back light
  rim.position.set(-radius * 2.5, radius * 0.8, -radius * 3);
  const fill = new THREE.PointLight("#ffd9c2", 0.6, 0, 0);                 // tiny bit of light from the camera side
  camera.add(fill);
  scene.add(hemi, key, rim, camera);

  //  the "blood supply" boundary: a faint shell where oxygen + drugs come in. also because it looks cooler this way
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 3),
    new THREE.MeshBasicMaterial({ color: "#c0485a", wireframe: true, transparent: true, opacity: 0.07, depthWrite: false }),
  );
  scene.add(shell);

  //  cells
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
  let colorMode = "resistance", cutaway = false, showDead = true;
  const cloneColor = (c) => col.setHSL(((c * 0.618034) % 1), 0.62, 0.58);  

  /** copy the sim's cells into the instanced mesh. returns how many got drawn */
  function drawCells(sim) {
    const g = sim.grid, st = g.state, cl = g.clone, geno = sim.clones.geno;
    const pers = sim.killing?.persister, doomed = sim.radiation?.doomed;
    let n = 0;
    for (const i of g.domain) {
      const s = st[i];
      if (s === 0 || (s === 3 && !showDead)) continue;
      const [x, y, z] = g.coords(i);
      const px = x - center, py = y - center, pz = z - center;
      if (cutaway && pz > 0) continue;                 // slice the front half off to see inside bc otherwise the 3d view will hide interesting stuff like the inner area devoid of oxygen
      const scale = s === 3 ? 0.55 : s === 2 ? 0.85 : 1;
      m4.makeScale(scale, scale, scale).setPosition(px, py, pz);
      cells.setMatrixAt(n, m4);
      if (s === 3) col.copy(CELL_COLORS.dead);
      else if (doomed && doomed[i]) col.copy(CELL_COLORS.doomed);
      else if (pers && pers[i]) col.copy(CELL_COLORS.persister);
      else if (colorMode === "clones") { cloneColor(cl[i]); if (s === 2) col.multiplyScalar(0.55); }
      else if (geno[cl[i]] & RES_MASK) col.copy(CELL_COLORS.resistant).multiplyScalar(s === 2 ? 0.6 : 1);
      else col.copy(s === 2 ? CELL_COLORS.dormant : CELL_COLORS.sensitive);
      cells.setColorAt(n, col);
      n++;
    }
    cells.count = n;
    cells.instanceMatrix.needsUpdate = true;
    cells.instanceColor.needsUpdate = true;
    return n;
  }

  //  resize + render loop 
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
    setCutaway(on) { cutaway = on; },
    setShowDead(on) { showDead = on; },
    setColorMode(m) { colorMode = m; },
    showShell(on) { shell.visible = on; },
    resetCamera() { camera.position.set(radius * 2.3, radius * 1.45, radius * 3.2); controls.target.set(0, 0, 0); controls.update(); },
  };
}
