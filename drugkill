// drugkill.js - drugs actually killing cells (dose-response curves) + drug-tolerant "persister" cells
//
// kill rate per DAY for one cell:
//   h = sum over drugs:  killRate * hill(C_local) * (dividing ? 1 : quiescentFactor)
//   hill(C) = C^n / (C^n + EC50^n)            <- classic dose-response (Hill) curve, n = hill
//   C_local = plasma * penetration field      (from drugs.js)
//   EFX pump trait: C_local / effluxFold   
//   resistance trait (resistTrait): EC50 * resistFold
//   cancer type: killRate * killScale[drug]   (eg goserelin does nothing to a cancer that doesn't run on hormones)
//   Enhertu (ADC): local dose = max(antibody field, bystander x deeper payload field)
//   PDT (porfimer): only while the laser is on, and times o2 / (o2 + oxygenK) since it needs oxygen
//   short half-life drugs: we use the AVERAGE blood level over the step, not the level at the start,
//     so carboplatin (1.5 h half-life) doesn't count as a full 4 hrs of exposure
//
// persisters (drug-tolerant, NOT genetic): while a cell is being hit by drug, it has a small chance
// each step to flip into a dormant "persister" state. persisters
//   - don't divide or move
//   - only get hit at persTol * the normal kill rate (super tolerant)
//   - flip back to normal once the drug is mostly gone (avg persRevertH hrs)
//   - sometimes pick up a mutation while sitting there (persMuPerDay) -> a path to real resistance
// this (drug-tolerant persister cells, Sharma et al. 2010 Cell) is why even
// combos that kill almost everything usually relapse

// !!!! killRate / ec50 / hill / quiescentFactor / resistFold live in drugs.js

import { TRAIT, N_TRAITS, stepProb } from "./cells.js";

export const KILL_DEFAULTS = {
  effluxFold: 6,          // DUMMY COME BACK TO THIS LATER AND REPLACE - EFX pump cuts the inside-the-cell dose by this much
  persSwitchPerDay: 0.024,// DUMMY - rate a drug-exposed cell flips to persister (~0.4% per 4-hr step)
  persTol: 0.04,          // DUMMY - persisters get killed at 4% of the normal rate
  persRevertH: 96,        // DUMMY - avg hrs to flip back once the drug is gone
  persMuPerDay: 0.0036,   // DUMMY - chance per day a persister picks up a new trait
  exposureFloor: 0.02,    // below this total kill rate (per day) we count the cell as "drug-free" (setting, not biology)
  killScale: {},          // per-drug multiplier from the cancer type (cancers.js fills this in)
};

export class DrugKilling {
  /**
   * @param {CellRules} rules
   * @param {DrugFields} drugs   
   * @param {object} params        overrides for KILL_DEFAULTS
   */
  constructor(rules, drugs, params = {}) {
    this.rules = rules; this.grid = rules.grid; this.drugs = drugs;
    this.p = { ...KILL_DEFAULTS, ...params };
    this.persister = new Uint8Array(this.grid.n);
    this.persList = [];
    this._stepSeen = -1; this._act = [];
    this.lastHazard = new Float32Array(this.grid.n); // kill rate each cell saw last step (for persister revert)
    rules.hazards.push((i, g, o, cycling) => this.hazard(i, g, o, cycling));
    rules.arrestChecks.push((i) => this.persister[i] === 1);
    rules.afterStepHooks.push(() => this.update());
  }

  /** per-step list of active drugs */
  activeList() {
    if (this._stepSeen === this.rules.step) return this._act;
    this._stepSeen = this.rules.step;
    const dtH = this.rules.p.dtH, drugs = this.drugs;
    this._act = drugs.activeDrugs().flatMap((id) => {
      const d = drugs.catalog[id];
      if (d.needsLight && !drugs.lightOn) return [];        // PDT drug cannot treat anyhing /be activated/actually work at all until the laser
      const scale = this.p.killScale[id] ?? 1;
      if (scale <= 0) return [];
      // average level over this step for drugs that are decaying
      let plasma = drugs.plasma[id];
      if (d.mode !== "continuous" && !(drugs.infusionLeft[id] > 0)) {
        const x = (Math.LN2 / d.halfLifeH) * dtH;
        plasma *= x > 1e-6 ? (1 - Math.exp(-x)) / x : 1;
      }
      const pf = drugs.payloadFieldFor(id);
      return [{ plasma, F: drugs.fieldFor(id).F, PF: pf ? pf.F : null, by: d.bystander ?? 0.5, k: d.killRate * scale, ec50: d.ec50, n: d.hill,
        qf: d.quiescentFactor, efx: d.effluxSubstrate, res: d.resistTrait, fold: d.resistFold,
        oxK: d.needsOxygen ? d.oxygenK ?? 0.1 : 0 }];
    });
    return this._act;
  }

  /** kill rate per day from all drugs for one cell */
  rawHazard(i, g, cycling, o2 = 1) {
    const act = this.activeList();
    let h = 0;
    for (let q = 0; q < act.length; q++) {
      const a = act[q];
      let c = a.plasma * (a.PF ? Math.max(a.F[i], a.by * a.PF[i]) : a.F[i]); //ADCs
      if (a.efx && (g & TRAIT.EFX)) c /= this.p.effluxFold;
      if (c <= 0) continue;
      const e = a.ec50 * (g & a.res ? a.fold : 1);
      const cn = Math.pow(c, a.n);
      let hi = a.k * (cn / (cn + Math.pow(e, a.n))) * (cycling ? 1 : a.qf);
      if (a.oxK) hi *= o2 / (o2 + a.oxK);
      h += hi;
    }
    return h;
  }

  /** the hook cells.js calls. also where cells can flip into persisters */
  hazard(i, g, o, cycling) {
    const h = this.rawHazard(i, g, cycling, o);
    this.lastHazard[i] = h;
    if (h <= 0) return 0;
    if (this.persister[i]) return h * this.p.persTol;
    if (this.rules.rand() < stepProb(this.p.persSwitchPerDay, this.rules.p.dtH)) {
      this.persister[i] = 1; this.persList.push(i);
      return h * this.p.persTol;
    }
    return h;
  }

  /** after each step persisters flip back if drug-free, maybe mutates */
  update() {
    const { grid, rules } = this, dtH = rules.p.dtH;
    const revertP = 1 - Math.exp(-dtH / this.p.persRevertH);
    const muP = stepProb(this.p.persMuPerDay, dtH);
    const keep = [];
    for (const i of this.persList) {
      if (!this.persister[i]) continue;
      if (!grid.isLiving(i)) { this.persister[i] = 0; continue; }
      if (this.lastHazard[i] < this.p.exposureFloor && rules.rand() < revertP) { this.persister[i] = 0; continue; }
      if (rules.rand() < muP) {                       // stress-induced mutation while hiding out
        const c = grid.clone[i], g0 = rules.clones.geno[c];
        const free = []; for (let b = 0; b < N_TRAITS; b++) if (!(g0 & (1 << b))) free.push(1 << b);
        if (free.length) {
          const nc = rules.clones.add(g0 | free[Math.floor(rules.rand() * free.length)], c, rules.day);
          if (nc !== c) { rules.clones.count[c]--; grid.clone[i] = nc; rules.clones.count[nc]++; }
        }
      }
      keep.push(i);
    }
    this.persList = keep;
  }

  get persisterCount() { return this.persList.length; }

  getState() { return { persList: this.persList.slice() }; }
  setState(s) {
    this.persister.fill(0); this.persList = s.persList.slice();
    for (const i of this.persList) this.persister[i] = 1;
    this._stepSeen = -1;
  }
}



