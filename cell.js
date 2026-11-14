// the epic highs and lows of cell life: divide, mutate, go dormant, die
//
// if you are not finding the functions you are looking for, try perhaps grid.js (where cells live) and diffusion.js (how much oxygen they get)
// every step (4 hrs) each living cell, in random order:
//   1. might die randomly (apoptosis)
//   2. checks its oxygen: way too low = dies (necrosis), kinda low = goes DORMANT, ok = stays/wakes up ALIVE
//   3. if ALIVE it might divide into an empty neighbor spot
//   4. the new baby cell might pick up a mutation = a new trait, which makes a new clone
// resistance traits cost fitness though (aka slower division) so without drugs the sensitive cells will continue to win

import { EMPTY, ALIVE, DORMANT, DEAD } from "./grid.js";
import { O2_QUIESCENT, O2_NECROTIC } from "./diffusion.js";

// traits w bit flags
export const TRAIT = { PRO: 1, HYP: 2, RTA: 4, RCH: 8, EFX: 16, RAD: 32, MUT: 64, IMM: 128 };
export const N_TRAITS = 8;
export const TRAITS = [
  { key: "PRO", bit: 1,  name: "proliferative driver",   effect: "divides faster (x1.35)" },
  { key: "HYP", bit: 2,  name: "hypoxia adaptation",     effect: "survives + keeps dividing at lower oxygen" },
  { key: "RTA", bit: 4,  name: "target-site resistance", effect: "resists the targeted drug (used in task 8)" },
  { key: "RCH", bit: 8,  name: "apoptosis evasion",      effect: "resists chemo (used in task 8)" },
  { key: "EFX", bit: 16, name: "drug efflux pump",       effect: "pumps out some drugs (used in task 8)" },
  { key: "RAD", bit: 32, name: "better DNA repair",      effect: "resists radiation (used in task 9)" },
  { key: "MUT", bit: 64, name: "mutator",                effect: "mutation rate x10" },
  { key: "IMM", bit: 128, name: "immune escape",         effect: "hides from T cells, eg HLA/B2M loss (used by immunotherapy)" },
];

// the traits that count as "resistance" (and by extension also cost fitness)
export const RES_MASK = TRAIT.RTA | TRAIT.RCH | TRAIT.EFX | TRAIT.RAD | TRAIT.IMM;

export function popcount(x) { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; }
export function traitNames(geno) { return TRAITS.filter((t) => geno & t.bit).map((t) => t.key); }

// defaults
export const DEFAULT_CELL_PARAMS = {
  dtH: 4,            // Hours per step
  cycleH: 72,         // base cell cycle time in hrs (real tumor cells ~2-4 days)
  mu: 6e-4,           // chance that a division will makes a mutation
  mutatorBoost: 10,  // MUT trait multiplies mu by this
  costRes: 0.12,      // each resistance trait slows division by 12%
  proBoost: 1.35,    // PRO trait speeds division up by this much
  apoptosis: 0.0015,  // random death chance (yay!) per step
  necrosisProb: 0.25, // chance per step a cell under O2_NECROTIC actually dies
  hypDeathMult: 0.35, // HYP cells only die below O2_NECROTIC * this
  hypQuiesceMult: 0.6,// HYP cells only go dormant below O2_QUIESCENT * this
  lysisDays: 8,     // how long dead debris hangs around before it clears (avg)
  motility: 0.04,     // chance/step a cell wiggles into an empty neighbor & fills holes
  maxClones: 32000,
};
// clone table
export class CloneTable {
  constructor(max = 32000) {
    this.max = max;
    this.geno = new Uint8Array(max);    // traits bitmask
    this.parent = new Int16Array(max);   // which clone it came from (-1 = founder)
    this.born = new Float32Array(max);  // BIRTHDAY (sim day it appeared)
    this.count = new Int32Array(max);     // how many LIVING cells it has right now
    this.n = 0;
    this.full = false;
  }
  /** add a new clone, returns its id */
  add(geno, parent, day) {
    if (this.n >= this.max) { this.full = true; return parent; }
    const id = this.n++;
    this.geno[id] = geno; this.parent[id] = parent; this.born[id] = day; this.count[id] = 0;
    return id;
  }
  reset() { this.n = 0; this.full = false; this.count.fill(0); }
  /** rebuild living counts from the grid (pssst pssssst we can use after loading a snapshot) */
  recount(grid) {
    this.count.fill(0);
    for (const i of grid.domain) if (grid.isLiving(i)) this.count[grid.clone[i]]++;
  }
  livingClones() { let k = 0; for (let c = 0; c < this.n; c++) if (this.count[c] > 0) k++; return k; }
  /** how many living cells have ANY of the traits in mask */
  countWith(mask) { let s = 0; for (let c = 0; c < this.n; c++) if (this.geno[c] & mask) s += this.count[c]; return s; }
  totalLiving() { let s = 0; for (let c = 0; c < this.n; c++) s += this.count[c]; return s; }
  top(k = 10) {
    const ids = []; for (let c = 0; c < this.n; c++) if (this.count[c] > 0) ids.push(c);
    return ids.sort((a, b) => this.count[b] - this.count[a]).slice(0, k)
      .map((c) => ({ id: c, cells: this.count[c], traits: traitNames(this.geno[c]), parent: this.parent[c], bornDay: this.born[c] }));
  }
}

// the per-step rules
export class CellRules {
  /**
   * @param {CellGrid} grid
   * @param {DiffusionField} oxygen
   * @param {CloneTable} clones
   * @param {object} params   overrides for DEFAULT_CELL_PARAMS
   * @param {() => number} rand  seeded rng from makeRng
   */
  constructor(grid, oxygen, clones, params = {}, rand = Math.random) {
    this.grid = grid; this.oxygen = oxygen; this.clones = clones; this.rand = rand;
    this.p = { ...DEFAULT_CELL_PARAMS, ...params };
    this.step = 0;
    this.stats = { divisions: 0, mutations: 0, deaths: 0 };
    // COME BACK TO THIS FOR TASK#8 I REPEAT HOPE PLEASE COME BACK TO THIS
    //  set this to (i, geno, o2, cycling) => kill hazard per DAY (drugs go here)
    this.extraHazard = null;
    // other modules (radiation, immunotherapy) plug in here:
    this.hazards = [];          // list of (i, geno, o2, cycling) => kill rate per DAY & they all add up
    this.arrestChecks = [];     // list of (i) => true if that cell can't divide or move (eg lethally irradiated)
    this.afterStepHooks = [];   // list of () => void, run at the end of every step
  }
  get day() { return (this.step * this.p.dtH) / 24; }

  /** start a tumor */
  seed(radius = 4.5, founderGeno = 0) {
    const f = this.clones.add(founderGeno, -1, this.day);
    const n = this.grid.seedTumor(radius, f);
    this.clones.count[f] += n;
    return f;
  }

  /** chance this cell divides this step */
  divisionProb(geno, o2) {
    const p = this.p;
    let rate = (p.dtH / p.cycleH) * Math.min(1, (1.2 * o2) / (o2 + 0.2)); // less oxygen = slower
    if (geno & TRAIT.PRO) rate *= p.proBoost;
    const nRes = popcount(geno & RES_MASK);
    if (nRes) rate *= Math.pow(1 - p.costRes, nRes);                          // ......it mutated.....but at what cost....(fitness)
    return rate;
  }

  /** living cell dies */
  kill(i) {
    this.clones.count[this.grid.clone[i]]--;
    this.grid.setState(i, DEAD);
    this.stats.deaths++;
  }

  /** daughter genotype: usually same as mom, but has a chance for +1 random new trait for mutations based on a random chance
   *  See the mutation options
   */
  mutate(geno) {
    const p = this.p;
    const mu = geno & TRAIT.MUT ? p.mu * p.mutatorBoost : p.mu;
    if (this.rand() >= mu) return geno;
    const free = [];
    for (let b = 0; b < N_TRAITS; b++) if (!(geno & (1 << b))) free.push(1 << b);
    if (!free.length) return geno;
    return geno | free[Math.floor(this.rand() * free.length)];
  }

  /** alright everyone stay calm it's time to run one 4-hr step for every cell */
  stepAll() {
    const { grid, oxygen, clones, rand } = this;
    const p = this.p, O = oxygen.F;
    const lysisP = p.dtH / (p.lysisDays * 24), dtd = p.dtH / 24;
    const order = grid.shuffledOccupied(rand); // random order

    for (let k = 0; k < order.length; k++) {
      const i = order[k], s = grid.state[i];
      if (s === EMPTY) continue;
      if (s === DEAD) { if (rand() < lysisP) grid.clear(i); continue; } // debris slowly clears

      const c = grid.clone[i], g = clones.geno[c], o = O[i];

      if (rand() < p.apoptosis) { this.kill(i); continue; }

      // oxygen checks (HYP cells handle low oxygen better)
      const hyp = (g & TRAIT.HYP) !== 0;
      const oDie = hyp ? O2_NECROTIC * p.hypDeathMult : O2_NECROTIC;
      const oRest = hyp ? O2_QUIESCENT * p.hypQuiesceMult : O2_QUIESCENT;
      if (o < oDie) { if (rand() < p.necrosisProb) this.kill(i); continue; }
      const cycling = o >= oRest;
      if (!cycling) { if (s !== DORMANT) grid.setState(i, DORMANT); }
      else if (s === DORMANT) grid.setState(i, ALIVE); // got oxygen back, wake up

      // drugs, immune cells etc all add their kill rates here
      let h = this.extraHazard ? this.extraHazard(i, g, o, cycling) : 0;
      for (let q = 0; q < this.hazards.length; q++) h += this.hazards[q](i, g, o, cycling);
      if (h > 0 && rand() < 1 - Math.exp(-h * dtd)) { this.kill(i); continue; }

      // arrested cells (like ones hit by radiation) can't move or divide
      let arrested = false;
      for (let q = 0; q < this.arrestChecks.length; q++) if (this.arrestChecks[q](i)) { arrested = true; break; }
      if (arrested) continue;

      // small random wiggle so holes in the middle fill back in
      // (pick one random direction, only move if that spot is empty)
      if (rand() < p.motility) {
        const j = i + grid.nb26[Math.floor(rand() * 26)];
        if (grid.isEmpty(j)) { grid.moveCell(i, j); continue; }
      }

      if (!cycling) continue; // dormant cells don't divide

      // division
      if (rand() >= this.divisionProb(g, o)) continue;
      const j = grid.randomEmptyNeighbor(i, rand);
      if (j < 0) continue; // no room = can't divide (contact inhibition)
      const dg = this.mutate(g);
      let dc = c;
      if (dg !== g) { dc = clones.add(dg, c, this.day); this.stats.mutations++; }
      grid.placeCell(j, dc, ALIVE);
      clones.count[dc]++;
      this.stats.divisions++;
    }
    this.step++;
    for (let q = 0; q < this.afterStepHooks.length; q++) this.afterStepHooks[q]();
  }
}