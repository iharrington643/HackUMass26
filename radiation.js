// radiotherapy using the linear-quadratic (LQ) model + the oxygen effect

// survival after one dose D:   S = exp(-a*D' - b*D'^2)
// where D' = D * OMF(o2) is the "effective dose" after the oxygen effect
// oxygen makes radiation damage stick, so hypoxic cells need ~3x the dose for the same kill
// OMF (oxygen modification factor) uses the Alper & Howard-Flanders formula:
//   OER(o2) = (K + m*o2) / (K + o2)     m = max OER ~3, K = o2 where it's halfway (~3 mmHg)
//   OMF = OER(o2) / m                    so OMF = 1 when well oxygenated, 1/3 when anoxic
// our oxygen is on a 0-1 scale where 1 = the level right by the capillaries. in real tumors that's
// ~40 mmHg (not the 100 mmHg of a dish of cells), so K = 3 mmHg / 40 = 0.075 on our scale.
// (on that scale our cutoffs mean: dormant under ~10 mmHg, dead under ~2 mmHg)

// cells that get lethally hit don't vanish right away. they stop dividing (i have taken the liberty 
// of calling them "doomed" cells) and die a day or two later when they try to divide (mitotic catastrophe). 
// until then they still take up space + use oxygen, which is why the tumor doesn't instantly regrow into the gap

// sources: Alper & Howard-Flanders OER formula w/ m = 3 (see arxiv 2201.02278 and PMC3283483),
// half-max at ~3 mmHg (Grimes & Partridge, PMC4765087). a = 0.3/Gy, b = 0.03/Gy^2 are typical
// textbook values for tumors (a/b ~ 10 Gy)

import { TRAIT } from "./cells.js";

export const RT_DEFAULTS = {
  alpha: 0.3,          // per Gy
  beta: 0.03,          // per Gy^2  (a/b = 10 Gy, typical tumor)
  oerMax: 3,           // max oxygen enhancement ratio for x-rays
  vesselPO2mmHg: 40,   // what o2 = 1 means in mmHg (tissue right by capillaries)
  K_mmHg: 3,           // o2 where OER is halfway, in mmHg
  K: 3 / 40,           // same thing on our 0-1 scale (recomputed from the two above)
  radResistFactor: 0.5,// RAD trait (better DNA repair) cuts a and b in half
  doomH: 30,           // avg hours a lethally hit cell survives before dying
};

/** oxygen modification factor OMF; 1 = fully oxygenated, 1/oerMax = no oxygen */
export function omf(o2, p = RT_DEFAULTS) {
  return (p.K + p.oerMax * o2) / (p.K + o2) / p.oerMax;
}

export function survivalFraction(dose, o2, geno = 0, p = RT_DEFAULTS) { /** chance one cell survives a dose of 'dose' Gy */
  const f = geno & TRAIT.RAD ? p.radResistFactor : 1;
  const d = dose * omf(o2, p);
  return Math.exp(-p.alpha * f * d - p.beta * f * d * d);
}

export class Radiation {
  /**
   * @param {CellRules} rules   from cells.js
   * @param {object} params     overrides for RT_DEFAULTS
   */
  constructor(rules, params = {}) {
    this.rules = rules; this.grid = rules.grid; this.oxygen = rules.oxygen;
    this.p = { ...RT_DEFAULTS, ...params };
    this.p.K = this.p.K_mmHg / this.p.vesselPO2mmHg;   // keep K in sync if someone changes the scale
    this.doomed = new Uint8Array(this.grid.n);  // 1 = this site's cell was lethally hit
    this.doomedList = [];
    this.totalGy = 0; this.fractions = 0;
    this.lastFraction = null;
    // doomed cells can't divide or move
    rules.arrestChecks.push((i) => this.doomed[i] === 1);
    rules.afterStepHooks.push(() => this.update());
  }

  /** give one dose to the whole tumor. returns some stats */
  giveFraction(dose = 2) {
    const { grid, oxygen, rules } = this;
    const O = oxygen.F, rand = rules.rand, geno = rules.clones.geno;
    let hit = 0, total = 0, hitOxic = 0, oxic = 0, hitHypoxic = 0, hypoxic = 0;
    for (const i of grid.domain) {
      if (!grid.isLiving(i) || this.doomed[i]) continue;
      total++;
      const o = O[i], isOxic = o > 0.5, isHyp = o < 0.1;
      if (isOxic) oxic++; if (isHyp) hypoxic++;
      if (rand() > survivalFraction(dose, o, geno[grid.clone[i]], this.p)) {
        this.doomed[i] = 1; this.doomedList.push(i); hit++;
        if (isOxic) hitOxic++; if (isHyp) hitHypoxic++;
      }
    }
    this.totalGy += dose; this.fractions++;
    this.lastFraction = { dose, hit, total, killFrac: hit / Math.max(1, total),
      killFracOxic: hitOxic / Math.max(1, oxic), killFracHypoxic: hitHypoxic / Math.max(1, hypoxic) };
    return this.lastFraction;
  }

  /** runs every step: doomed cells die off, and we can now forget doomed spots that are already dead/empty */
  update() {
    const { grid, rules } = this;
    const pDie = rules.p.dtH / this.p.doomH;
    const keep = [];
    for (const i of this.doomedList) {
      if (!this.doomed[i]) continue;
      if (!grid.isLiving(i)) { this.doomed[i] = 0; continue; }  // already died some other way
      if (rules.rand() < pDie) { rules.kill(i); this.doomed[i] = 0; continue; }
      keep.push(i);
    }
    this.doomedList = keep;
  }

  get doomedCount() { return this.doomedList.length; }

  /** forget everything (snapshots) */
  reset() { this.doomed.fill(0); this.doomedList = []; this.totalGy = 0; this.fractions = 0; }

  /**
   * standard schedule helper: "dose" Gy on weekdays (Mon-Fri) for "weeks" weeks
   * returns a function (dayIndexSinceStart) => dose to give that day where obviously 0 = don't give a dose
   */
  static conventionalSchedule(dose = 2, weeks = 4) {
    return (day) => (day < weeks * 7 && day % 7 < 5 ? dose : 0);
  }
}