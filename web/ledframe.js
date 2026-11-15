// turns the 3D tumor into pixels for the 16x16 LED panels. god this took so long i literally was typing some of this on the bus bc i was too nervous to take a break lol
//
// the panels are flat squares, so we have to be creative to show a 3D sphere on them :) Here are our two methods: 
//   "slice"  : the panel shows one cross-section through the tumor (like one MRI slice). with 5 panels we take
//              5 slices front-to-back, so you see a small disc, bigger, biggest, bigger, small = a sphere
//   "view"   : the panel shows the tumor from the front, like the 3D camera. the front of the ball is drawn bright
//              and the edges darker (they're further away), which makes a flat disc look round!!! Hip hip hooray for illusions.
//
// the edge of the ball is anti-aliased: each LED averages 3x3 sample points, so a half-covered LED is half
// bright instead of a jaggy staircase
//
import { cellRGB } from "./cellcolors.js";

export const PANEL = 16;                     // LEDs per side
export const LEDS_PER_PANEL = PANEL * PANEL;

export const LED_DEFAULTS = {
  panels: 5,          // how many panels are chained
  mode: "auto",       // "auto" | "slices" | "view+slice"
  zoom: "fit",        // "fit" = tumor always fills the panel, "grow" = fixed scale so you watch it grow
  // wiring / orientation (use the test pattern to get these right, see README)
  serpentine: true,   // rows zigzag (see lines on the back of the panels)
  columns: false,     // true if the LED chain runs down columns instead of across rows
  flipX: false, flipY: false,
  rotate: 0,          // 0 / 90 / 180 / 270, if the panels are mounted turned
  gamma: 2.2,         // LEDs look washed out without this (bc they're linear, and eyes aren't I guess)
  brightness: 1,      // 0-1
};

/** what each panel shows, from the settings */
export function panelPlan(cfg) {
  const n = cfg.panels;
  const slices = (k) => Array.from({ length: k }, (_, j) => ({ kind: "slice", t: k === 1 ? 0 : -0.8 + (1.6 * j) / (k - 1) }));
  if (cfg.mode === "slices") return slices(n);
  if (cfg.mode === "view+slice" || n <= 2) return n === 1 ? [{ kind: "view" }] : [{ kind: "view" }, ...slices(n - 1)];
  return slices(n);
}

/** (panel, x, y) -> x right, y down, 0-15 */
export function ledIndex(p, x, y, cfg) {
  let u = x, v = y;
  for (let r = 0; r < ((cfg.rotate || 0) / 90) % 4; r++) [u, v] = [PANEL - 1 - v, u];   // turn 90 degrees
  if (cfg.flipX) u = PANEL - 1 - u;
  if (cfg.flipY) v = PANEL - 1 - v;
  const line = cfg.columns ? u : v, pos = cfg.columns ? v : u;
  const along = cfg.serpentine && line % 2 === 1 ? PANEL - 1 - pos : pos;
  return p * LEDS_PER_PANEL + line * PANEL + along;
}

/** rough tumor radius in grid cells, from how many sites are filled (alive + dormant + dead) */
export function tumorRadius(grid) {
  const occupied = grid.domain.length - grid.counts[0];
  return Math.cbrt((3 * occupied) / (4 * Math.PI));
}

const SUB = [-1 / 3, 0, 1 / 3];   // 3x3 sample points inside each LED

/**
 * @param sim        Simulation
 * @param cfg        LED_DEFAULTS-style settings
 * @param colorMode  "resistance" | "clones" (just stealing this from the 3D model)
 * @returns { bytes: Uint8Array (r,g,b per LED, in wiring order), preview: Float32Array (r,g,b per pixel, picture order, before gamma), plan }
 */
export function buildFrame(sim, cfg, colorMode = "resistance") {
  const g = sim.grid, S = g.size, c = (S - 1) / 2;
  const n = cfg.panels, plan = panelPlan(cfg);
  const R = Math.max(tumorRadius(g), 1.5);
  const half = cfg.zoom === "grow" ? g.radius : Math.min(g.radius, Math.max(R * 1.12, 4));   // grid cells from center to panel edge
  const step = (2 * half) / PANEL;                                                            // grid cells per LED
  const preview = new Float32Array(n * LEDS_PER_PANEL * 3);
  const bytes = new Uint8Array(n * LEDS_PER_PANEL * 3);
  const gammaLUT = new Uint8Array(256);
  for (let k = 0; k < 256; k++) gammaLUT[k] = Math.round(255 * Math.pow(k / 255, cfg.gamma ?? 2.2));
  const bright = cfg.brightness ?? 1;

  const site = (x, y, z) => { 
    const xi = Math.round(x), yi = Math.round(y), zi = Math.round(z);
    if (xi < 0 || yi < 0 || zi < 0 || xi >= S || yi >= S || zi >= S) return -1;
    const i = g.index(xi, yi, zi);
    return g.state[i] === 0 ? -1 : i;
  };
 
  for (let p = 0; p < n; p++) {
    const what = plan[p];
    const z0 = c + (what.t ?? 0) * R; // slice depth 
    for (let py = 0; py < PANEL; py++) for (let px = 0; px < PANEL; px++) {
      let r = 0, gg = 0, b = 0, hits = 0;
      for (const ox of SUB) for (const oy of SUB) {
        const x = c + ((px + 0.5 + ox) / PANEL * 2 - 1) * half; 
        const y = c + (1 - (py + 0.5 + oy) / PANEL * 2) * half;   // picture y goes down, grid y goes up
        let i = -1, shade = 1;
        if (what.kind === "slice") i = site(x, y, z0);
        else {
          // look from the front (+z) and take the first cell we hit
          for (let z = S - 1; z >= 0; z--) { i = site(x, y, z); if (i >= 0) { shade = Math.max(0.22, Math.min(1, 0.22 + 0.78 * (z - c) / R)); break; } }
        }
        if (i < 0) continue;
        const col = cellRGB(sim, i, colorMode);
        r += col[0] * shade; gg += col[1] * shade; b += col[2] * shade; hits++; 
      }
      const k = (p * LEDS_PER_PANEL + py * PANEL + px) * 3; 
      const total = SUB.length * SUB.length; 
      preview[k] = r / total; preview[k + 1] = gg / total; preview[k + 2] = b / total;  
      const o = ledIndex(p, px, py, cfg) * 3;
      bytes[o] = gammaLUT[Math.min(255, Math.round(preview[k] * bright))];
      bytes[o + 1] = gammaLUT[Math.min(255, Math.round(preview[k + 1] * bright))]; 
      bytes[o + 2] = gammaLUT[Math.min(255, Math.round(preview[k + 2] * bright))]; 
    }
  }
  return { bytes, preview, plan };  
}

/**
 * orientation test: on every panel the TOP-LEFT LED is red, the rest of the top row green, the left column blue,
 * and panel k shows k white dots across the middle (so you can tell which panel is which).
 * if it looks wrong on the real panels, we know to flip / rotate / serpentine in the settings until it matches the preview
 */
export function buildTestFrame(cfg) {
  const n = cfg.panels;
  const preview = new Float32Array(n * LEDS_PER_PANEL * 3), bytes = new Uint8Array(n * LEDS_PER_PANEL * 3);
  const put = (p, x, y, rgb) => {
    const k = (p * LEDS_PER_PANEL + y * PANEL + x) * 3;
    preview.set(rgb, k);
    bytes.set(rgb.map((v) => Math.round(v * 0.5)), ledIndex(p, x, y, cfg) * 3);   // half brightness, it's just a test
  };
  for (let p = 0; p < n; p++) {
    for (let x = 1; x < PANEL; x++) put(p, x, 0, [0, 160, 0]);
    for (let y = 1; y < PANEL; y++) put(p, 0, y, [0, 0, 200]);
    put(p, 0, 0, [255, 0, 0]);
    for (let d = 0; d <= p; d++) put(p, 3 + d * 2, 8, [200, 200, 200]);
  }
  return { bytes, preview, plan: [] };
}

/** draw a preview onto a canvas: panels in order (1, 2, 3... left to right... */
export function drawPreview(canvas, preview, panels) {
  const ctx = canvas.getContext("2d");
  const perRow = panels <= 3 ? panels : Math.ceil(panels / 2), rows = Math.ceil(panels / perRow);
  const gap = 10, cell = Math.max(2, Math.floor((canvas.width - gap * (perRow - 1)) / (perRow * PANEL)));
  const side = PANEL * cell, h = rows * side + gap * (rows - 1);
  if (canvas.height !== h) canvas.height = h;
  ctx.fillStyle = "#05070b"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let p = 0; p < panels; p++) {
    const row = Math.floor(p / perRow), inRow = row === rows - 1 ? panels - row * perRow : perRow;
    const x0 = Math.floor((canvas.width - (inRow * side + gap * (inRow - 1))) / 2);
    const ox = x0 + (p - row * perRow) * (side + gap), oy = row * (side + gap);
    ctx.fillStyle = "#0e131c"; ctx.fillRect(ox, oy, side, side);
    for (let y = 0; y < PANEL; y++) for (let x = 0; x < PANEL; x++) {
      const k = (p * LEDS_PER_PANEL + y * PANEL + x) * 3;
      const r = preview[k], gg = preview[k + 1], b = preview[k + 2];
      if (r + gg + b < 3) continue;
      ctx.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      ctx.beginPath(); ctx.arc(ox + x * cell + cell / 2, oy + y * cell + cell / 2, cell * 0.42, 0, Math.PI * 2); ctx.fill();
    }
  }
}
