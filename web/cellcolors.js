
import { TRAIT } from "../cells.js";
import { DRUG_CATALOG } from "../drugs.js";
import { regimenTreatments } from "../schedules.js";

export const BOTTLES = [
  { color: "red",    hex: "#e5383b", treatment: "doxorubicin",           name: "Doxorubicin",   why: "doxorubicin really is red (nicknamed the \"red devil\")" },
  { color: "black",  hex: "#141518", treatment: "porfimer",              name: "Photofrin",     why: "Photofrin patients have to stay out of bright light" },
  { color: "orange", hex: "#ff8c1a", treatment: "goserelin",             name: "Goserelin",     why: "hormone therapy" },
  { color: "pink",   hex: "#ff6fb5", treatment: "trastuzumabDeruxtecan", name: "Enhertu",       why: "used for HER2 breast cancer (pink ribbon)" },
  { color: "yellow", hex: "#ffd60a", treatment: "radiation",             name: "Radiation",     why: "yellow like the radiation warning sign" },
  { color: "green",  hex: "#2ecc71", treatment: "pembrolizumab",         name: "Pembrolizumab", why: "a green light for T cells" },
  { color: "grey",   hex: "#9aa0a6", treatment: "carboplatin",           name: "Carboplatin",   why: "platinum is a grey metal" },
  { color: "white",  hex: "#f4f4f4", treatment: "paclitaxel",            name: "Paclitaxel",    why: "comes from the (pale) bark of the yew tree" },
];
export const BOTTLE_OF = Object.fromEntries(BOTTLES.map((b) => [b.treatment, b]));

export const CELL_HEX = {
  sensitive: "#3d7eff",
  persister: "#22d3ee",
  dormant:   "#284a86",
  doomed:    "#a78bfa",
  dead:      "#5a463a",
};

const toRGB = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
export const CELL_RGB = Object.fromEntries(Object.entries(CELL_HEX).map(([k, v]) => [k, toRGB(v)]));
const BOTTLE_RGB = Object.fromEntries(BOTTLES.map((b) => [b.treatment, toRGB(b.hex)]));

export function resists(treatment, geno) {
  if (treatment === "radiation") return (geno & TRAIT.RAD) !== 0;
  if (treatment === "pembrolizumab") return (geno & TRAIT.IMM) !== 0;
  const d = DRUG_CATALOG[treatment];
  if (!d) return false;
  return (d.resistTrait && (geno & d.resistTrait) !== 0) || (d.effluxSubstrate && (geno & TRAIT.EFX) !== 0);
}

let lastPlan = undefined, order = BOTTLES.map((b) => b.treatment);
function treatmentOrder(sim) {
  const plan = sim.plans?.[sim.plans.length - 1] || null;
  if (plan !== lastPlan) {
    lastPlan = plan;
    const active = plan ? regimenTreatments(plan.regimen) : [];
    order = [...active, ...BOTTLES.map((b) => b.treatment).filter((t) => !active.includes(t))];
  }
  return order;
}

export function resistanceOf(sim, geno) {
  for (const t of treatmentOrder(sim)) if (resists(t, geno)) return t;
  return null;
}

function hslToRGB(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export const COLOR_MODES = {
  resistance: "resistance (bottle colors)",
  clones: "clone (family tree)",
  oxygen: "oxygen",
  state: "alive / dormant / dead",
  drug: "drug level",
};
export const STATE_HEX = { dividing: "#3d7eff", dormant: "#284a86", doomed: "#a78bfa", dead: "#5a463a" };
const STATE_RGB = Object.fromEntries(Object.entries(STATE_HEX).map(([k, v]) => [k, toRGB(v)]));
const OXY_LO = toRGB("#10243f"), OXY_HI = toRGB("#7fd8ff");
const DRUG_LO = toRGB("#2a1a12"), DRUG_HI = toRGB("#ffb066");
const mix = (a, b, t) => [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);
export const RAMPS = { oxygen: [OXY_LO, OXY_HI], drug: [DRUG_LO, DRUG_HI] };

export function cellRGB(sim, i, colorMode = "resistance") {
  const s = sim.grid.state[i];
  if (s === 0) return null;
  if (colorMode === "state") {
    if (s === 3) return STATE_RGB.dead;
    if (sim.radiation?.doomed?.[i]) return STATE_RGB.doomed;
    return s === 2 ? STATE_RGB.dormant : STATE_RGB.dividing;
  }
  if (s === 3) return CELL_RGB.dead;
  if (colorMode === "oxygen") return mix(OXY_LO, OXY_HI, Math.min(1, Math.max(0, sim.oxygen.F[i])));
  if (colorMode === "drug") {
    const c = sim.drugs?.maxExposureAt ? sim.drugs.maxExposureAt(i) : 0;
    return mix(DRUG_LO, DRUG_HI, Math.min(1, Math.sqrt(Math.max(0, c))));
  }
  if (sim.radiation?.doomed?.[i]) return CELL_RGB.doomed;
  if (sim.killing?.persister?.[i]) return CELL_RGB.persister;
  const c = sim.grid.clone[i];
  if (colorMode === "clones") {
    const rgb = hslToRGB((c * 0.618034) % 1, 0.62, 0.58);
    return s === 2 ? rgb.map((v) => v * 0.55) : rgb;
  }
  const t = resistanceOf(sim, sim.clones.geno[c]);
  if (t) return s === 2 ? BOTTLE_RGB[t].map((v) => v * 0.7) : BOTTLE_RGB[t];
  return s === 2 ? CELL_RGB.dormant : CELL_RGB.sensitive;
}
