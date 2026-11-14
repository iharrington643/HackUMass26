// drugs.js - drug levels in the blood + how far each drug gets into the tumor
//
// two parts:
//  1. plasma (blood) level over time for each drug. 1 = peak right after one standard dose
//       bolus:      jumps up by the dose, then decays w/ the half-life        C = C0 * exp(-ln2 * t / t_half)  (eq #13)
//       infusion:   held at the dose level for infusionH hours, then decays   (eq #14, eg 46-hr 5-FU pump)
//       continuous: daily pills / long antibody infusions, slides toward a steady level while "on"
//  2. how much of that reaches each spot in the tumor. same solver as oxygen:
//       0 = D_drug*del^2(C) - k_drug*n(x)*C,  C = plasma level at the vessels      (eq #11)
//     the equation is linear so we solve ONE normalized field (vessel level = 1) per penetration length
//     and just multiply by the plasma level:   C(x, t) = plasma(t) * field_L(x)
//     drugs w/ the same penetration length share a field, so 6 drugs might only need 3-4 fields
//
// !!!! EVERY number in DRUG_CATALOG below is a DUMMY placeholder (marked "// DUMMY") until Rayne
// !!!! fills in the real ones (task 5). run dummyReport() to see what's still fake
//
// drug KILLING (dose-response curves, persisters) is task 8 - it'll call concentrationAt()

import { DiffusionField } from "./diffusion.js";
import { TRAIT } from "./cells.js";

// ---------------------------------------------------------------------------------------------
// drug catalog - ALL VALUES ARE DUMMIES
//   penetrationLength : cell diameters, how deep it gets before dropping by a factor of e
//   halfLifeH         : plasma half-life in hours
//   mode              : "bolus" | "infusion" | "continuous"
//   infusionH         : how long an infusion runs (infusion mode only)
//   killRate          : max kill rate per day at saturating dose (used in task 8)
//   ec50              : local concentration for half-max effect, relative to plasma peak (task 8)
//   hill              : steepness of the dose-response curve (task 8)
//   quiescentFactor   : how well it kills non-dividing cells, 0 = only kills dividing ones (task 8)
//   effluxSubstrate   : true if the EFX pump trait pushes it out (task 8)
//   resistTrait       : which trait makes cells resistant (task 8)
//   resistFold        : how many times higher EC50 gets for resistant cells (task 8)
// ---------------------------------------------------------------------------------------------
export const DRUG_CATALOG = {
  doxorubicin: {
    name: "Doxorubicin", kind: "chemo",
    penetrationLength: 2,     // DUMMY
    halfLifeH: 30,            // DUMMY
    mode: "bolus",            // DUMMY
    infusionH: 0,             // DUMMY
    killRate: 1.5,            // DUMMY
    ec50: 0.2,                // DUMMY
    hill: 2,                  // DUMMY
    quiescentFactor: 0.35,    // DUMMY
    effluxSubstrate: true,    // DUMMY
    resistTrait: TRAIT.RCH,   // DUMMY
    resistFold: 6,            // DUMMY
  },
  paclitaxel: {
    name: "Paclitaxel", kind: "chemo",
    penetrationLength: 4,     // DUMMY
    halfLifeH: 20,            // DUMMY
    mode: "bolus",            // DUMMY
    infusionH: 0,             // DUMMY
    killRate: 2.0,            // DUMMY
    ec50: 0.15,               // DUMMY
    hill: 2,                  // DUMMY
    quiescentFactor: 0,       // DUMMY
    effluxSubstrate: true,    // DUMMY
    resistTrait: TRAIT.RCH,   // DUMMY
    resistFold: 6,            // DUMMY
  },
  cisplatin: {
    name: "Cisplatin", kind: "chemo",
    penetrationLength: 6,     // DUMMY
    halfLifeH: 10,            // DUMMY
    mode: "bolus",            // DUMMY
    infusionH: 0,             // DUMMY
    killRate: 1.8,            // DUMMY
    ec50: 0.22,               // DUMMY
    hill: 2,                  // DUMMY
    quiescentFactor: 0.4,     // DUMMY
    effluxSubstrate: false,   // DUMMY
    resistTrait: TRAIT.RCH,   // DUMMY
    resistFold: 6,            // DUMMY
  },
  fluorouracil: {
    name: "5-Fluorouracil", kind: "chemo",
    penetrationLength: 8,     // DUMMY (small molecule)
    halfLifeH: 0.5,           // DUMMY
    mode: "infusion",         // DUMMY
    infusionH: 46,            // DUMMY
    killRate: 1.8,            // DUMMY
    ec50: 0.2,                // DUMMY
    hill: 2,                  // DUMMY
    quiescentFactor: 0.05,    // DUMMY
    effluxSubstrate: false,   // DUMMY
    resistTrait: TRAIT.RCH,   // DUMMY
    resistFold: 6,            // DUMMY
  },
  targetedTKI: {
    name: "Targeted pill (generic TKI)", kind: "targeted",
    penetrationLength: 6,     // DUMMY
    halfLifeH: 48,            // DUMMY
    mode: "continuous",       // DUMMY
    infusionH: 0,             // DUMMY
    killRate: 0.5,            // DUMMY
    ec50: 0.15,               // DUMMY
    hill: 2,                  // DUMMY
    quiescentFactor: 0.5,     // DUMMY
    effluxSubstrate: true,    // DUMMY
    resistTrait: TRAIT.RTA,   // DUMMY
    resistFold: 25,           // DUMMY
  },
  targetedAntibody: {
    name: "Targeted antibody (generic)", kind: "targeted",
    penetrationLength: 2,     // DUMMY (big molecule)
    halfLifeH: 400,           // DUMMY
    mode: "continuous",       // DUMMY
    infusionH: 0,             // DUMMY
    killRate: 0.4,            // DUMMY
    ec50: 0.15,               // DUMMY
    hill: 2,                  // DUMMY
    quiescentFactor: 0.5,     // DUMMY
    effluxSubstrate: false,   // DUMMY
    resistTrait: TRAIT.RTA,   // DUMMY
    resistFold: 25,           // DUMMY
  },
};

export const DUMMY_FIELDS = Object.fromEntries(
  Object.entries(DRUG_CATALOG).map(([id, d]) => [id, Object.keys(d).filter((k) => k !== "name" && k !== "kind")])
);

/** report for dummies. just kidding it's just for finding any dummy fields left behind */
export function dummyReport() {
  const lines = [];
  for (const [id, fields] of Object.entries(DUMMY_FIELDS)) if (fields.length) lines.push(`${id}: ${fields.join(", ")}`);
  return lines;
}

// field settings shared by all drug fields - ALSO DUMMIES
export const DRUG_FIELD_DEFAULTS = {
  dormantUptake: 1,     // DUMMY - resting cells take drug up as much as dividing ones
  deadUptake: 0.2,      // DUMMY - dead debris soaks up a little drug
  roundTo: 0.5,         // drugs whose penetration lengths round to the same value share one field (not a dummy)
  activeLevel: 1e-3,    // below this plasma level we stop updating that field (not a dummy)
  sweepsPerStep: 3,     // drug fields don't need to be as exact as oxygen, 3 sweeps keeps us under the time budget
};

export class DrugFields {
  /**
   * @param {CellRules} rules   from cells.js
   * @param {object} catalog    for drugs
   * @param {object} opts       overrides for DRUG_FIELD_DEFAULTS
   */
  constructor(rules, catalog = DRUG_CATALOG, opts = {}) {
    this.rules = rules; this.grid = rules.grid;
    this.opts = { ...DRUG_FIELD_DEFAULTS, ...opts };
    this.catalog = catalog;
    this.ids = Object.keys(catalog);
    this.plasma = {};        // drug id -> blood level (1 = peak after one standard dose)
    this.infusionLeft = {};  // drug id -> hours of infusion left
    this.infusionLevel = {}; // drug id -> level held during infusion
    this.continuousOn = {};  // drug id -> target level while on (0 = off)
    this.groupOf = {};       // drug id -> penetration length key
    this.fields = new Map(); // penetration length key -> { field, active, drugs: [] }

    for (const id of this.ids) {
      this.plasma[id] = 0; this.infusionLeft[id] = 0; this.infusionLevel[id] = 0; this.continuousOn[id] = 0;
      const L = Math.max(1, Math.round(catalog[id].penetrationLength / this.opts.roundTo) * this.opts.roundTo);
      this.groupOf[id] = L;
      if (!this.fields.has(L)) {
        const field = new DiffusionField(this.grid, {
          penetrationLength: L, boundaryValue: 1,
          dormantUptake: this.opts.dormantUptake, deadUptake: this.opts.deadUptake,
        });
        this.fields.set(L, { field, active: false, drugs: [] });
      }
      this.fields.get(L).drugs.push(id);
    }
    rules.afterStepHooks.push(() => this.update());
  }

  get fieldCount() { return this.fields.size; }

  // dosing
  /** bolus drugs jump up, infusion drugs start their pump */
  giveDose(id, amount = 1) {
    const d = this.catalog[id];
    if (!d) throw new Error(`unknown drug ${id}`);
    if (d.mode === "infusion") {
      this.infusionLeft[id] = d.infusionH; this.infusionLevel[id] = amount;
      this.plasma[id] = Math.max(this.plasma[id], amount);
    } else if (d.mode === "continuous") {
      this.setContinuous(id, amount);
    } else {
      this.plasma[id] += amount;
    }
    this.activate(id);
  }

  /** turn a daily pill / maintenance drug on (level > 0) or off (0) */
  setContinuous(id, level = 1) {
    this.continuousOn[id] = level;
    if (level > 0) this.activate(id);
  }

  /** make sure the drug's field is accurate*/
  activate(id) {
    const g = this.fields.get(this.groupOf[id]);
    if (!g.active) { g.field.refresh(); g.active = true; }
  }

  // reading
  /** drug level at grid site i (relative to plasma peak after one standard dose) */
  concentrationAt(id, i) {
    const p = this.plasma[id];
    return p > 0 ? p * this.fields.get(this.groupOf[id]).field.F[i] : 0;
  }

  /** the normalized field (vessel = 1) a drug uses, which we can use later for coloring the 3D view */
  fieldFor(id) { return this.fields.get(this.groupOf[id]).field; }

  /** drugs currently in the blood above activeLevel */
  activeDrugs() { return this.ids.filter((id) => this.plasma[id] > this.opts.activeLevel); }

  /** biggest local drug level across all active drugs at site i (for a drug color mode) */
  maxExposureAt(i) {
    let m = 0;
    for (const id of this.ids) { const c = this.concentrationAt(id, i); if (c > m) m = c; }
    return m;
  }

  // every step
  /** plasma levels change, then active fields get a few sweeps */
  update() {
    const dt = this.rules.p.dtH;
    for (const id of this.ids) {
      const d = this.catalog[id];
      const decay = Math.exp((-Math.LN2 / d.halfLifeH) * dt);
      if (this.infusionLeft[id] > 0) {
        this.plasma[id] = this.infusionLevel[id];
        this.infusionLeft[id] = Math.max(0, this.infusionLeft[id] - dt);
      } else if (d.mode === "continuous") {
        // slide toward the target (on) or toward 0 (off) at the drug's half-life rate
        const target = this.continuousOn[id];
        this.plasma[id] = target + (this.plasma[id] - target) * decay;
      } else {
        this.plasma[id] *= decay;
      }
      if (this.plasma[id] < 1e-6) this.plasma[id] = 0;
    }
    for (const g of this.fields.values()) {
      const anyOn = g.drugs.some((id) => this.plasma[id] > this.opts.activeLevel || this.continuousOn[id] > 0);
      if (anyOn) {
        if (!g.active) { g.field.refresh(); g.active = true; } else g.field.step(this.opts.sweepsPerStep);
      } else g.active = false; 
    }
  }

  // rewind support
  getState() {
    return { plasma: { ...this.plasma }, infusionLeft: { ...this.infusionLeft },
      infusionLevel: { ...this.infusionLevel }, continuousOn: { ...this.continuousOn } };
  }
  setState(s) {
    Object.assign(this.plasma, s.plasma); Object.assign(this.infusionLeft, s.infusionLeft);
    Object.assign(this.infusionLevel, s.infusionLevel); Object.assign(this.continuousOn, s.continuousOn);
    for (const g of this.fields.values()) g.active = false; // force a refresh @ next step
  }
}