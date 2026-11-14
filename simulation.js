// the moment you've all been waiting for...it's the main event of the evening...THE SIMULATION FILE
// ie this takes all the other modules and runs them all together as one
//
//   const sim = new Simulation({ seed: 1, cancer: "breast" });   // cancer ids are in cancers.js
//   sim.availableRegimens()                              // -> regimen ids this cancer is allowed
//   sim.growTo(26000);                                   // let the tumor grow
//   sim.startPlan(REGIMENS.doxQ21);                      // start treatment today (or sim.startPlan("doxQ21"))
//   sim.runDays(30);                                     // run
//   sim.rewindTo(10);                                    // go back to day 10 (any saved day)
//   sim.startPlan(REGIMENS.pembroQ3W);                   // try something else from there
//
// order inside one step (4 hrs):
//   1. if it's the start of a new day: save a snapshot (for rewind), then give that day's treatments
//   2. cells act (cells.js), which calls every module's kill hazard / arrest check
//   3. after-step hooks: radiation doomed cells die, immune activation updates, drug levels + fields update,
//      persisters revert/mutate
//   4. oxygen field updates

import { CellGrid, makeRng } from "./grid.js";
import { createOxygenField } from "./diffusion.js";
import { CellRules, CloneTable, RES_MASK } from "./cells.js";
import { DrugFields, DRUG_CATALOG } from "./drugs.js";
import { DrugKilling } from "./drugkill.js";
import { Radiation } from "./radiation.js";
import { Immunotherapy } from "./immunotherapy.js";
import { TreatmentPlan, regimensFor, REGIMENS } from "./schedules.js";
import { CANCER_TYPES, killScaleFor } from "./cancers.js";

export class Simulation {
  /**
   * @param {object} o
   *   seed, cancer (null = no cancer type, every drug works at full strength), gridSize (44), radius (20.5), cellParams, drugCatalog, killParams, rtParams, immunoParams,
   *   founderGeno (0), seedRadius (4.5), snapshotEveryDays (1), maxSnapshots (400)
   */
  constructor(o = {}) {
    this.opts = { seed: 1, gridSize: 44, radius: 20.5, founderGeno: 0, seedRadius: 4.5, snapshotEveryDays: 1, maxSnapshots: 400, ...o };
    this.rand = makeRng(this.opts.seed);
    this.grid = new CellGrid(this.opts.gridSize, this.opts.radius);
    this.oxygen = createOxygenField(this.grid);
    this.clones = new CloneTable();
    this.rules = new CellRules(this.grid, this.oxygen, this.clones, o.cellParams || {}, this.rand);
    this.radiation = new Radiation(this.rules, o.rtParams || {});
    this.immuno = new Immunotherapy(this.rules, o.immunoParams || {});
    this.drugs = new DrugFields(this.rules, o.drugCatalog || DRUG_CATALOG);
    this.cancer = o.cancer ? CANCER_TYPES[o.cancer] : null;
    if (o.cancer && !this.cancer) throw new Error(`unknown cancer ${o.cancer}`);
    const killScale = o.cancer ? killScaleFor(o.cancer) : {};
    this.killing = new DrugKilling(this.rules, this.drugs, { killScale, ...(o.killParams || {}) });
    this.plans = [];
    this.snapshots = new Map();   
    this.history = [];          
    this.eventsLog = [];       
    this.rules.seed(this.opts.seedRadius, this.opts.founderGeno);
    this.oxygen.solveToTolerance(1e-6, 3000);
    this._recordDay();
  }

  get stepsPerDay() { return Math.round(24 / this.rules.p.dtH); }
  get step() { return this.rules.step; }
  get day() { return this.rules.step / this.stepsPerDay; }
  get dayIndex() { return Math.floor(this.day); }

  //  treatments
  /** start a regimen today. returns the plan so that it can be stopped later */
  /** regimen ids this sim's cancer can get (all of them if no cancer was picked) */
  availableRegimens() { return this.cancer ? regimensFor(this.cancer) : Object.keys(REGIMENS); }

  startPlan(regimen, opts = {}) {
    if (typeof regimen === "string") regimen = REGIMENS[regimen];
    const plan = new TreatmentPlan(regimen, opts.startDay ?? Math.ceil(this.day), opts);
    this.plans.push(plan);
    return plan;
  }
  stopPlan(plan) {
    this.plans = this.plans.filter((p) => p !== plan);
    for (const part of plan.regimen.parts) if (part.type === "continuous") this.drugs.setContinuous(part.drug, 0);
  }
  stopAll() { for (const p of [...this.plans]) this.stopPlan(p); }

  giveDrug(drug, dose = 1) { this.drugs.giveDose(drug, dose); this.eventsLog.push({ day: this.day, type: "drug", drug, dose }); }
  giveRadiation(dose = 2) { const r = this.radiation.giveFraction(dose); this.eventsLog.push({ day: this.day, type: "rt", dose }); this.oxygen.refresh(); return r; }
  giveLight(hours = 4) { this.drugs.giveLight(hours); this.eventsLog.push({ day: this.day, type: "light" }); }
  giveCheckpoint(dose = 1) { this.immuno.giveDose(dose); this.eventsLog.push({ day: this.day, type: "ici", dose }); }

  _applyPlans(day) {
    const want = {};
    for (const plan of this.plans) for (const e of plan.eventsOn(day)) {
      if (e.type === "drug") this.giveDrug(e.drug, e.dose);
      else if (e.type === "rt") this.giveRadiation(e.dose);
      else if (e.type === "ici") this.giveCheckpoint(e.dose);
      else if (e.type === "light") this.giveLight();
      else if (e.type === "continuous") want[e.drug] = Math.max(want[e.drug] ?? 0, e.level);
    }
    for (const [drug, level] of Object.entries(want)) this.drugs.setContinuous(drug, level);
  }

  //  running 
  stepOnce() {
    if (this.rules.step % this.stepsPerDay === 0) {
      const d = this.dayIndex;
      if (d % this.opts.snapshotEveryDays === 0) this._saveSnapshot(d);
      this._applyPlans(d);
    }
    this.rules.stepAll();
    this.oxygen.step();
    if (this.rules.step % this.stepsPerDay === 0) this._recordDay();
  }
  runDays(n) { for (let k = 0; k < n * this.stepsPerDay; k++) this.stepOnce(); }
  growTo(cells, maxDays = 150) { let d = 0; while (this.clones.totalLiving() < cells && d < maxDays) { this.runDays(1); d++; } return d; }

  _recordDay() {
    const c = this.clones, sm = this.grid.summary();
    this.history.push({
      day: Math.round(this.day), living: sm.living, alive: sm.alive, dormant: sm.dormant, dead: sm.dead,
      clones: c.livingClones(), resistant: c.countWith(RES_MASK), // any resistance trait
      persisters: this.killing.persisterCount, doomed: this.radiation.doomedCount,
      drugs: { ...this.drugs.plasma }, immuneActivation: this.immuno.activation,
    });
  }

  // rewind
  /** everything needed to put the sim back how it was before so you can essentially go back in time and try different things */
  snapshot() {
    const c = this.clones;
    return {
      step: this.rules.step, rng: this.rand.getState(),
      grid: this.grid.snapshot(),
      clones: { n: c.n, geno: c.geno.slice(0, c.n), parent: c.parent.slice(0, c.n), born: c.born.slice(0, c.n) },
      radiation: { doomed: this.radiation.doomedList.slice(), totalGy: this.radiation.totalGy, fractions: this.radiation.fractions },
      immuno: { drug: this.immuno.drug, activation: this.immuno.activation, doses: this.immuno.doses },
      drugs: this.drugs.getState(),
      killing: this.killing.getState(),
      plans: this.plans.map((p) => ({ regimen: p.regimen, startDay: p.startDay, doseScale: p.doseScale })),
      historyLen: this.history.length, eventsLen: this.eventsLog.length,
      stats: { ...this.rules.stats },
    };
  }

  restore(s) {
    this.rules.step = s.step; this.rand.setState(s.rng);
    this.grid.restore(s.grid);
    const c = this.clones;
    c.n = s.clones.n; c.geno.set(s.clones.geno); c.parent.set(s.clones.parent); c.born.set(s.clones.born);
    c.recount(this.grid);
    const r = this.radiation;
    r.doomed.fill(0); r.doomedList = s.radiation.doomed.slice(); for (const i of r.doomedList) r.doomed[i] = 1;
    r.totalGy = s.radiation.totalGy; r.fractions = s.radiation.fractions;
    Object.assign(this.immuno, s.immuno);
    this.drugs.setState(s.drugs);
    this.killing.setState(s.killing);
    this.plans = s.plans.map((p) => new TreatmentPlan(p.regimen, p.startDay, { doseScale: p.doseScale }));
    this.history.length = s.historyLen; this.eventsLog.length = s.eventsLen;
    Object.assign(this.rules.stats, s.stats);
    // fields depend on where the cells are bc of how diffusion works better on the surface
    this.oxygen.refresh(1e-5, 400);
    this.immuno.tcells.refresh(1e-5, 400);
    for (const g of this.drugs.fields.values()) if (g.active) g.field.refresh(1e-5, 400);
  }

  _saveSnapshot(day) {
    this.snapshots.set(day, this.snapshot());
    if (this.snapshots.size > this.opts.maxSnapshots) {       // thin out old odd days so memory stays bounded
      for (const k of this.snapshots.keys()) if (k % 2 === 1 && k < day - 30) this.snapshots.delete(k);
    }
  }

  /** jump back to the latest saved day before the chosen day */
  rewindTo(day) {
    let best = -1;
    for (const k of this.snapshots.keys()) if (k <= day && k > best) best = k;
    if (best < 0) throw new Error("no snapshot at or before day " + day);
    this.restore(this.snapshots.get(best));
    for (const k of [...this.snapshots.keys()]) if (k > best) this.snapshots.delete(k);
    return best;
  }

  /** approximate memory used by saved snapshots */
  get snapshotBytes() {
    let b = 0; for (const s of this.snapshots.values()) b += s.grid.state.byteLength + s.grid.clone.byteLength + s.clones.geno.byteLength * 7;
    return b;
  }
}