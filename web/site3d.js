
import * as THREE from "three";

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const C = {
  cyan: 0x00f0ff, magenta: 0xff2fd6, green: 0x00ff88,
  sensitive: 0x3d7eff, persister: 0x22d3ee, dormant: 0x284a86, dead: 0x5a463a,
  bottles: [0xe5383b, 0xffd60a, 0xff6fb5, 0x2ecc71],
};

function rand(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }

function base(canvas, { fov = 40, z = 4.2 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07090c, 0.08);
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  camera.position.set(0, 0, z);
  scene.add(new THREE.HemisphereLight(0x9fdcff, 0x220a2a, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 4, 5); scene.add(key);
  const rim = new THREE.PointLight(C.magenta, 18, 12); rim.position.set(-3, -1, -2); scene.add(rim);
  const rim2 = new THREE.PointLight(C.cyan, 14, 12); rim2.position.set(3, -2, 2); scene.add(rim2);
  const root = new THREE.Group(); scene.add(root);
  const mouse = { x: 0, y: 0 };
  addEventListener("mousemove", (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });
  const resize = () => {
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 400;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas); resize();
  return { renderer, scene, camera, root, mouse, z };
}

function run(canvas, ctx, step) {
  let visible = true, last = performance.now(), t = 0;
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(canvas);
  (function frame(now) {
    requestAnimationFrame(frame);
    if (!visible) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!reduce) t += dt;
    step(t, dt);
    ctx.camera.position.x += (ctx.mouse.x * 0.8 - ctx.camera.position.x) * 0.05;
    ctx.camera.position.y += (-ctx.mouse.y * 0.6 - ctx.camera.position.y) * 0.05;
    ctx.camera.lookAt(0, 0, 0);
    ctx.renderer.render(ctx.scene, ctx.camera);
  })(last);
}

function glowSprite(color, size) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.25, "rgba(255,255,255,0.6)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(m); s.scale.setScalar(size); return s;
}

const SCENES = {
  tumor(canvas) {
    const ctx = base(canvas, { z: 4.4 });
    const r = rand(7), N = 2600, pos = [], dist = [];
    while (pos.length < N) {
      const p = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
      if (p.length() <= 1) { pos.push(p.multiplyScalar(1.15)); dist.push(p.length() / 1.15); }
    }
    const geo = new THREE.IcosahedronGeometry(0.05, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 });
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    pos.forEach((p, i) => { const s = dist[i] < 0.35 ? 0.6 : 0.85 + r() * 0.3; m4.makeScale(s, s, s).setPosition(p); mesh.setMatrixAt(i, m4); mesh.setColorAt(i, col.set(C.sensitive)); });
    ctx.root.add(mesh);
    const seeds = [0, 1, 2, 3].map(() => { const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(0.9); return v; });
    const pers = new Set(); for (let i = 0; i < N * 0.02; i++) pers.add(Math.floor(r() * N));
    const shell = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.42, 2)),
      new THREE.LineBasicMaterial({ color: 0xff4466, transparent: true, opacity: 0.18 }));
    ctx.root.add(shell);
    const D = 220, dPos = new Float32Array(D * 3), dDir = [], dLife = new Float32Array(D);
    for (let i = 0; i < D; i++) { const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(); dDir.push(v); dLife[i] = r(); }
    const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
    const drug = new THREE.Points(dGeo, new THREE.PointsMaterial({ color: C.cyan, size: 0.035, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    ctx.root.add(drug);
    const core = glowSprite(0xff2fd6, 1.2); core.material.opacity = 0.25; ctx.root.add(core);
    let lastColor = -1;
    run(canvas, ctx, (t) => {
      ctx.root.rotation.y = t * 0.18; ctx.root.rotation.x = Math.sin(t * 0.13) * 0.25;
      const cyc = (t % 14) / 14;
      const grow = 0.18 + 0.32 * Math.min(1, t / 40) + 0.1 * Math.sin(cyc * Math.PI * 2);
      const dosing = cyc < 0.35;
      for (let i = 0; i < D; i++) {
        dLife[i] += dosing ? 0.006 : 0.012;
        if (dLife[i] > 1) dLife[i] = 0;
        const k = 1.45 - dLife[i] * (dosing ? 1.2 : 0.4);
        dPos.set([dDir[i].x * k, dDir[i].y * k, dDir[i].z * k], i * 3);
      }
      dGeo.attributes.position.needsUpdate = true;
      drug.material.opacity = dosing ? 0.95 : 0.25;
      const tick = Math.floor(t * 8);
      if (tick === lastColor) return;
      lastColor = tick;
      for (let i = 0; i < N; i++) {
        const d = dist[i];
        let c = d < 0.33 ? C.dead : d < 0.52 ? C.dormant : C.sensitive;
        if (d >= 0.33) for (let k = 0; k < seeds.length; k++) if (pos[i].distanceTo(seeds[k]) < grow) { c = C.bottles[k]; break; }
        if (pers.has(i) && d >= 0.4 && (i + tick) % 9 < 4) c = C.persister;
        mesh.setColorAt(i, col.set(c));
      }
      mesh.instanceColor.needsUpdate = true;
    });
  },

  network(canvas) {
    const ctx = base(canvas, { z: 4.6 });
    const r = rand(3);
    const globe = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.3, 3)),
      new THREE.LineBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.14 }));
    ctx.root.add(globe);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(1.26, 48, 48), new THREE.MeshStandardMaterial({ color: 0x0a1626, roughness: 0.6, transparent: true, opacity: 0.85 }));
    ctx.root.add(inner);
    const nodes = [];
    for (let i = 0; i < 46; i++) {
      const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(1.31);
      const s = glowSprite(i % 4 === 0 ? C.magenta : i % 3 === 0 ? C.green : C.cyan, 0.16 + r() * 0.12);
      s.position.copy(v); ctx.root.add(s); nodes.push(v);
    }
    const arcs = [];
    for (let i = 0; i < 30; i++) {
      const a = nodes[Math.floor(r() * nodes.length)], b = nodes[Math.floor(r() * nodes.length)];
      if (a === b) continue;
      const mid = a.clone().add(b).multiplyScalar(0.5); mid.setLength(1.3 + a.distanceTo(b) * 0.45);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),
        new THREE.LineBasicMaterial({ color: i % 2 ? C.cyan : C.magenta, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }));
      ctx.root.add(line);
      const pulse = glowSprite(0xffffff, 0.09); ctx.root.add(pulse);
      arcs.push({ curve, pulse, off: r() });
    }
    run(canvas, ctx, (t) => {
      ctx.root.rotation.y = t * 0.12; ctx.root.rotation.x = 0.35;
      for (const a of arcs) a.pulse.position.copy(a.curve.getPoint((t * 0.25 + a.off) % 1));
      globe.material.opacity = 0.12 + 0.05 * Math.sin(t * 1.5);
    });
  },

  forest(canvas) {
    const ctx = base(canvas, { z: 5.2 });
    const r = rand(11);
    const nodeGeo = new THREE.IcosahedronGeometry(0.036, 1);
    const trees = [];
    const T = 7;
    for (let k = 0; k < T; k++) {
      const g = new THREE.Group(), ang = (k / T) * Math.PI * 2;
      g.position.set(Math.cos(ang) * 1.55, 0, Math.sin(ang) * 1.55);
      g.lookAt(0, 0, 0);
      const pts = [], segs = [];
      (function grow(x, y, depth, spread) {
        pts.push([x, y, depth]);
        if (depth >= 4 || (depth > 1 && r() < 0.15)) return;
        for (const s of [-1, 1]) {
          const nx = x + s * spread, ny = y - 0.38;
          segs.push(x, y, 0, nx, ny, 0);
          grow(nx, ny, depth + 1, spread * 0.55);
        }
      })(0, 0.85, 0, 0.5);
      const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
      g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: k % 2 ? C.cyan : C.magenta, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending })));
      const nodeMeshes = pts.map(([x, y, d]) => {
        const leaf = d >= 3;
        const m = new THREE.Mesh(nodeGeo, new THREE.MeshStandardMaterial({ color: leaf ? C.green : C.cyan, emissive: leaf ? 0x004422 : 0x003344 }));
        m.position.set(x, y, 0); g.add(m); return m;
      });
      ctx.root.add(g); trees.push({ g, nodeMeshes });
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    ctx.root.add(bar);
    const med = glowSprite(0xffffff, 0.5); ctx.root.add(med);
    const lo = glowSprite(C.magenta, 0.28), hi = glowSprite(C.magenta, 0.28); ctx.root.add(lo, hi);
    run(canvas, ctx, (t) => {
      ctx.root.rotation.y = t * 0.16;
      ctx.root.rotation.x = 0.18;
      const m = Math.sin(t * 0.7) * 0.25, w = 0.45 + Math.sin(t * 0.5) * 0.12;
      med.position.y = m; lo.position.y = m - w; hi.position.y = m + w;
      trees.forEach((tr, k) => tr.nodeMeshes.forEach((n, j) => { n.scale.setScalar(1 + 0.6 * Math.max(0, Math.sin(t * 3 - j * 0.6 - k))); }));
    });
  },

  lattice(canvas) {
    const ctx = base(canvas, { z: 4.6 });
    const n = 17, R = (n - 1) / 2, L = 3.2;
    const geo = new THREE.BoxGeometry(0.075, 0.075, 0.075);
    const items = [];
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
      const p = new THREE.Vector3(x - R, y - R, z - R), d = p.length();
      if (d <= R) items.push({ p: p.multiplyScalar(1.25 / R), d: d / R });
    }
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.4, emissive: 0x001118 }), items.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color(), lo = new THREE.Color(0x10243f), hi = new THREE.Color(0x7fd8ff);
    ctx.root.add(mesh);
    const shell = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.42, 2)),
      new THREE.LineBasicMaterial({ color: 0xff4466, transparent: true, opacity: 0.16 }));
    ctx.root.add(shell);
    let lastCut = -1;
    run(canvas, ctx, (t) => {
      ctx.root.rotation.y = 0.6 + Math.sin(t * 0.2) * 0.5; ctx.root.rotation.x = 0.35;
      const cut = Math.round((0.5 + 0.5 * Math.sin(t * 0.45)) * 20) / 20;
      if (cut === lastCut) return; lastCut = cut;
      let k = 0;
      const cz = 1.3 - 2.6 * cut * 0.6;
      for (const it of items) {
        const show = it.p.z <= cz;
        m4.makeScale(show ? 1 : 0, show ? 1 : 0, show ? 1 : 0).setPosition(it.p);
        mesh.setMatrixAt(k, m4);
        const o2 = Math.exp(-((1 - it.d) * (n / 2)) / L);
        mesh.setColorAt(k, col.copy(lo).lerp(hi, o2));
        k++;
      }
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    });
  },

  helix(canvas) {
    const ctx = base(canvas, { z: 5 });
    const g = new THREE.Group(); ctx.root.add(g);
    const sg = new THREE.SphereGeometry(0.06, 16, 16);
    const mA = new THREE.MeshStandardMaterial({ color: C.cyan, emissive: 0x003a44 });
    const mB = new THREE.MeshStandardMaterial({ color: C.magenta, emissive: 0x3a0033 });
    const rung = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
    for (let i = 0; i < 44; i++) {
      const y = (i - 22) * 0.075, a = i * 0.42;
      const p1 = new THREE.Vector3(Math.cos(a) * 0.5, y, Math.sin(a) * 0.5), p2 = p1.clone().multiply(new THREE.Vector3(-1, 1, -1));
      const s1 = new THREE.Mesh(sg, mA); s1.position.copy(p1); const s2 = new THREE.Mesh(sg, mB); s2.position.copy(p2);
      g.add(s1, s2);
      if (i % 2 === 0) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, p2]), rung));
    }
    const papers = [];
    for (let i = 0; i < 9; i++) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.56), new THREE.MeshStandardMaterial({ color: 0x8fdfff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, emissive: 0x062a33 }));
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(pl.geometry), new THREE.LineBasicMaterial({ color: i % 2 ? C.cyan : C.magenta, transparent: true, opacity: 0.7 }));
      pl.add(edge);
      for (let l = 0; l < 4; l++) {
        const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.15, 0.18 - l * 0.09, 0.001), new THREE.Vector3(0.15 - (l === 3 ? 0.1 : 0), 0.18 - l * 0.09, 0.001)]),
          new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
        pl.add(ln);
      }
      ctx.root.add(pl); papers.push({ pl, a: (i / 9) * Math.PI * 2, y: (i % 3 - 1) * 0.7, rad: 1.5 + (i % 2) * 0.3 });
    }
    run(canvas, ctx, (t) => {
      g.rotation.y = t * 0.5;
      for (const p of papers) {
        const a = p.a + t * 0.18;
        p.pl.position.set(Math.cos(a) * p.rad, p.y + Math.sin(t + p.a) * 0.12, Math.sin(a) * p.rad);
        p.pl.lookAt(0, p.pl.position.y, 0);
      }
    });
  },
};

SCENES.ledwall = function (canvas) {
  const ctx = base(canvas, { z: 6.4, fov: 38 });
  const P = 5, S = 16, gap = 0.1, led = 0.052, panelW = S * led;
  const N = P * S * S;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(led * 0.78, led * 0.78, 0.03),
    new THREE.MeshBasicMaterial({ toneMapped: false }), N);
  const m4 = new THREE.Matrix4(), col = new THREE.Color(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const wall = new THREE.Group();
  const totalW = P * panelW + (P - 1) * gap;
  for (let p = 0; p < P; p++) {
    const ang = (p - 2) * 0.16;
    const cx = -totalW / 2 + p * (panelW + gap) + panelW / 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(panelW + 0.05, panelW + 0.05), new THREE.MeshBasicMaterial({ color: 0x0a0d12 }));
    back.position.set(cx, 0, -0.03 + Math.abs(p - 2) * 0.12); back.quaternion.copy(q); wall.add(back);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(panelW + 0.05, panelW + 0.05)), new THREE.LineBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.35 }));
    edge.position.copy(back.position); edge.quaternion.copy(q); wall.add(edge);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = new THREE.Vector3((x - S / 2 + 0.5) * led, (S / 2 - y - 0.5) * led, 0).applyQuaternion(q);
      v.x += cx; v.z += Math.abs(p - 2) * 0.12;
      m4.compose(v, q, one); mesh.setMatrixAt((p * S + y) * S + x, m4); mesh.setColorAt((p * S + y) * S + x, col.set(0x000000));
    }
  }
  wall.add(mesh);
  ctx.root.add(wall);
  const brick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.28), new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.6 }));
  brick.position.set(1.6, -1.15, 0.4); ctx.root.add(brick);
  const cable = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.6, -1.06, 0.4), new THREE.Vector3(1.2, -0.95, 0.3), new THREE.Vector3(0.8, -0.75, 0.15), new THREE.Vector3(0.45, -0.45, 0.05)]).getPoints(30)),
    new THREE.LineBasicMaterial({ color: 0x444b57 }));
  ctx.root.add(cable);
  const spark = glowSprite(0xffa040, 0.55); spark.position.set(1.36, -1.1, 0.55); ctx.root.add(spark);
  const smoke = glowSprite(0x8a8f99, 0.9); smoke.position.set(1.5, -1.0, 0.4); ctx.root.add(smoke);
  const r = rand(11), seeds = C.bottles.map(() => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(0.8));
  let lastTick = -1;
  run(canvas, ctx, (t) => {
    ctx.root.rotation.y = Math.sin(t * 0.2) * 0.25; ctx.root.rotation.x = 0.08 + Math.sin(t * 0.15) * 0.05;
    const f = (Math.sin(t * 23) + Math.sin(t * 37)) * 0.5;
    const burst = (t % 6) < 0.7;
    spark.material.opacity = burst ? 0.5 + 0.5 * Math.max(0, f) : 0.05;
    smoke.material.opacity = 0.08 + 0.06 * Math.sin(t * 0.7);
    smoke.position.y = -0.85 + ((t * 0.12) % 0.5);
    const tick = Math.floor(t * 6);
    if (tick === lastTick) return;
    lastTick = tick;
    const R = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.25));
    const grow = 0.15 + 0.25 * (0.5 + 0.5 * Math.sin(t * 0.18 + 1));
    for (let p = 0; p < P; p++) {
      const z = (p - 2) / 2.5;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const px = (x - S / 2 + 0.5) / (S / 2), py = (S / 2 - y - 0.5) / (S / 2);
        const d = Math.hypot(px, py, z) / R;
        let c = 0x000000;
        if (d <= 1) {
          c = d < 0.35 ? C.dead : d < 0.6 ? C.dormant : C.sensitive;
          if (d >= 0.35) for (let k = 0; k < seeds.length; k++) if (Math.hypot(px * R - seeds[k].x * R, py * R - seeds[k].y * R, z * R - seeds[k].z * R) < grow) { c = C.bottles[k]; break; }
        }
        mesh.setColorAt((p * S + y) * S + x, col.set(c));
      }
    }
    mesh.instanceColor.needsUpdate = true;
  });
};

for (const canvas of document.querySelectorAll("canvas[data-scene]")) {
  try { SCENES[canvas.dataset.scene]?.(canvas); }
  catch (e) { console.warn("3D scene failed", e); canvas.replaceWith(Object.assign(document.createElement("div"), { className: "muted small", textContent: "(3D needs WebGL)" })); }
}
