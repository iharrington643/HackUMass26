// controls cell colors

import { RES_MASK } from "../cells.js";

export const CELL_HEX = {
  sensitive: "#4f97ea",  // dividing, no resistance traits
  resistant: "#f07a3d",  // has at least one resistance trait
  persister: "#d36bd8",  // drug-tolerant persister (not genetic)
  dormant:   "#5b6b84",  // alive but it's not dividing (due to low oxygen)
  doomed:    "#e8c14a",  // hit by radiation, will die soon #doomed
  dead:      "#2b2f38",  // necrotic debris
};

const toRGB = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
export const CELL_RGB = Object.fromEntries(Object.entries(CELL_HEX).map(([k, v]) => [k, toRGB(v)]));

function hslToRGB(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** color of grid site i as [r, g, b] 0-255*/
export function cellRGB(sim, i, colorMode = "resistance") {
  const s = sim.grid.state[i];
  if (s === 0) return null;
  if (s === 3) return CELL_RGB.dead;
  if (sim.radiation?.doomed?.[i]) return CELL_RGB.doomed;
  if (sim.killing?.persister?.[i]) return CELL_RGB.persister;
  const c = sim.grid.clone[i];
  if (colorMode === "clones") {
    const rgb = hslToRGB((c * 0.618034) % 1, 0.62, 0.58);
    return s === 2 ? rgb.map((v) => v * 0.55) : rgb;
  }
  if (sim.clones.geno[c] & RES_MASK) return s === 2 ? CELL_RGB.resistant.map((v) => v * 0.6) : CELL_RGB.resistant;
  return s === 2 ? CELL_RGB.dormant : CELL_RGB.sensitive;
}
