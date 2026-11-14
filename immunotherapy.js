// T cells + checkpoint inhibitor (anti-PD-1, like pembrolizumab)

import { DiffusionField } from "./diffusion.js";
import { TRAIT, popcount } from "./cells.js";

// how we model it:
//  - T cells come in from the blood vessels at the edge and get "used up" as they engage tumor cells,
//    so they only reach a few cells deep. that's just another diffusion field (same solver as oxygen)
//  - tumor cells put up PD-L1 which shuts T cells down. without the drug killing is divided by (1 + s)
//  - the checkpoint drug blocks that brake. blockade = C / (C + EC50), C = drug level in the blood
//  - the immune response doesn't kick in instantly, T cells have to expand over weeks:
//       dA/dt = r * blockade * (1 - A) - d * (A - A0)        A = activation from 0 to 1, A0 = baseline
//  - how "visible" a cell is depends on its mutations (more mutations = more neoantigens).
//    mutator (MUT) tumors light up the most, which matches how high mutation burden tumors
//    respond better to checkpoint drugs (Samstein et al. 2019, Nature Genetics)
//  - immune escape (IMM trait, like losing HLA/B2M) makes a cell almost invisible -> resistance
//  - hypoxic tissue is immunosuppressive so T cells kill less in low oxygen

// kill rate per DAY for a cell:
//   h = kKill * A * T(x) * visibility(geno) * o2/(o2 + hypoxiaK) / (1 + s * (1 - blockade))
//
// drug: pembrolizumab, half-life ~26 days (FDA label), given every 3 weeks

export const IMMUNO_DEFAULTS = {
  tCellL: 5,            // how deep T cells get into the tumor (cell diameters)
  kKill: 2.0,             // max possible kill rate per day
  pdl1Suppression: 4,      // s: no drug = killing divided by (1 + 4)
  baselineActivation: 0.1, // A0: natural immune surveillance before treatment
  activationRate: 0.12,    // r per day: how fast T cells ramp up once the brake is off
  activationDecay: 0.04,   // d per day: how fast activation fades back to baseline
  halfLifeDays: 26,      // RAYNE: pembrolizumab 26 days
  ec50: 0.3,        // blood level (1 = right after one standard dose) for half-max blockade
  baseVisibility: 0.3,    // how visible a cell w/ no extra mutations is
  perMutation: 0.15,       // + this per acquired trait (proxy for neoantigens)
  mutatorBonus: 0.6,     // + this if MUT (hypermutated = tons of neoantigens)
  immEscapeFactor: 0.1,    // IMM trait multiplies visibility by this
  hypoxiaK: 0.1,           // T cells work half as well at o2 = 0.1
};

export class Immunotherapy {
  /**
   * @param {CellRules} rules   from cells.js, again
   * @param {object} params     overrides for IMMUNO_DEFAULTS
   */
  constructor(rules, params = {}) {
    this.rules = rules; this.grid = rules.grid;
    this.p = { ...IMMUNO_DEFAULTS, ...params };
    // T cells get tied up by living tumor cells (both alive + dormant), plus also  a bit by debris
    this.tcells = new DiffusionField(this.grid, {
      penetrationLength: this.p.tCellL, boundaryValue: 1, dormantUptake: 1, deadUptake: 0.3,
    });
    this.tcells.solveToTolerance(1e-5, 2000);
    this.drug = 0;                             // blood level of the checkpoint drug
    this.activation = this.p.baselineActivation;
    this.doses = 0;
    this.visCache = new Float32Array(256);     // visibility per genotype
    for (let g = 0; g < 256; g++) this.visCache[g] = this.visibility(g);
    rules.hazards.push((i, g, o) => this.hazard(i, g, o));
    rules.afterStepHooks.push(() => this.update());
  }

  /** how easy the genotype is for T cells to spot */
  visibility(g) {
    const p = this.p;
    let v = p.baseVisibility + p.perMutation * popcount(g & ~TRAIT.IMM);
    if (g & TRAIT.MUT) v += p.mutatorBonus;
    if (g & TRAIT.IMM) v *= p.immEscapeFactor;
    return v;
  }

  /** fraction of PD-1 brakes blocked by the drug right now (0-1) */
  get blockade() { return this.drug / (this.drug + this.p.ec50); }

  /** give one dose of the checkpoint inhibitor (1 = one standard dose) */
  giveDose(amount = 1) { this.drug += amount; this.doses++; }

  /** kill rate per day for the cell at site i */
  hazard(i, g, o) {
    if (this.activation <= 0) return 0;
    const p = this.p;
    return (p.kKill * this.activation * this.tcells.F[i] * this.visCache[g] * (o / (o + p.hypoxiaK))) /
      (1 + p.pdl1Suppression * (1 - this.blockade));
  }

  /** drug wears off, T cells ramp up/down, T-cell field updates */
  update() {
    const p = this.p, dtd = this.rules.p.dtH / 24;
    this.drug *= Math.exp((-Math.LN2 / p.halfLifeDays) * dtd);
    const b = this.blockade, A = this.activation;
    this.activation = Math.min(1, Math.max(0, A + dtd * (p.activationRate * b * (1 - A) - p.activationDecay * (A - p.baselineActivation))));
    this.tcells.step();
  }

  /** one dose every interval # of days. returns (day) => dose that day */
  static q3wSchedule(interval = 21) { return (day) => (day % interval === 0 ? 1 : 0); }
}