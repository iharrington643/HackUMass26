// drug levels in the blood + how far each drug gets into the tumor
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
// !!!! EVERY number in DRUG_CATALOG below is a DUMMY placeholder until Rayne
// !!!! fills in the real ones (task 5). run dummyReport() to see what's still fake
//
// without further ado, i am so incredibly tired: drug KILLING (dose-response curves, persisters)

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
  carboplatin: {
    name: "Carboplatin", kind: "chemo",
    penetrationLength: 5,     // (OVERRIDDEN by DIFFUSION_PARAMS below -> 40 cells from D_eff + k) old ESTIMATE: no measured distance found? At least Rayne and I couldn't find one. cisplatin (same family) gets all the way into the core of spheroids (Zhang et al. 2012, Metallomics), but carboplatin penetrated big cell clumps poorly in a Dartmouth PDT + carboplatin study, so we went fairly deep but not all the way
    halfLifeH: 1.5,           // RAYNE: 1.1-2 h, took the middle
    mode: "bolus",            // SOURCED: 15-60 min IV infusion, short enough to count as a bolus at 4-hr steps
    infusionH: 0,             // not used (bolus)
    killRate: 1.8,            // DUMMY
    ec50: 0.22,               // DUMMY
    hill: 2,                  // DUMMY
    quiescentFactor: 0.4,     // DUMMY (platinum crosslinks DNA, so it hurts resting cells some too)
    effluxSubstrate: false,   // DUMMY
    resistTrait: TRAIT.RCH,   // DUMMY
    resistFold: 6,            // DUMMY
  },
  doxorubicin: {
    name: "Doxorubicin", kind: "chemo",
    penetrationLength: 3.2,   // SOURCED: drops to half at 40-50 um from vessels (Primeau et al. 2005) -> 45/ln2/20 = 3.2 cells
    halfLifeH: 30,            // RAYNE: 30 h (also matches the 17-48 h terminal half-life range)
    mode: "bolus",            // SOURCED: given as an IV push / short infusion
    infusionH: 0,             // not used (bolus)
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
    penetrationLength: 2,     // SOURCE-ish: "little drug reaching further than 100 um" from vessels in tumors (Kyle et al. 2007, Clin Cancer Res). if ~10% is left at 100 um: L = 100/ln(10)/20 = 2.2 cells, rounded to 2
    halfLifeH: 20,            // RAYNE: 13-27 h, took the middle
    mode: "bolus",            // SOURCED-ish: 1-3 hr infusion, close enough to a bolus at 4-hr steps
    infusionH: 0,             // not used (bolus)
    killRate: 2.0,            // DUMMY
    ec50: 0.15,               // DUMMY
    hill: 2,                  // DUMMY
    quiescentFactor: 0,       // DUMMY (taxanes mainly hit dividing cells, so we picked 0)
    effluxSubstrate: true,    // DUMMY
    resistTrait: TRAIT.RCH,   // DUMMY
    resistFold: 6,            // DUMMY
  },
  goserelin: {
    // hormone therapy: it doesn't poison cells, it shuts off testosterone/estrogen so hormone-dependent
    // cells stop growing + die off. we model that as a slow, steady kill rate. only matters for
    // hormone-sensitive cancers (see cancers.js). "resistance" = the tumor learns to grow without hormone
    // (castration-resistant prostate cancer) -> we reuse the RTA trait for that
    name: "Goserelin (Zoladex implant)", kind: "hormone",
    penetrationLength: 10,    // ESTIMATE: it works through hormone levels in the whole body, not by soaking into the tumor, so we let it reach everywhere
    halfLifeH: 3.2,           // RAYNE: 2.3-4.2 h, took the middle (this is how fast it clears AFTER the implant runs out)
    mode: "infusion",         // SOURCED: it's a slow-release implant under the skin, so it acts like a month-long infusion
    infusionH: 672,           // SOURCED: the 3.6 mg implant is replaced every 28 days (28 x 24 h)
    killRate: 0.25,           // DUMMY (slow on purpose, hormone therapy shrinks tumors over months)
    ec50: 0.2,                // DUMMY
    hill: 2,                  // DUMMY
    quiescentFactor: 0.6,     // DUMMY
    effluxSubstrate: false,   // DUMMY
    resistFold: 25,           // DUMMY
  },
  trastuzumabDeruxtecan: {
    // antibody-drug conjugate (Enhertu): antibody finds HER2 cells, then releases a topo-I chemo payload.
    // only works if the cancer actually has HER2 (see cancers.js). losing HER2 = RTA trait
    name: "Trastuzumab deruxtecan (Enhertu)", kind: "targeted",
    penetrationLength: 3,     // ESTIMATE: the antibody only reaches "several cell layers" from capillaries (Thurber et al. 2008) and stays right on the HER2 cells near vessels (2021 Clin Cancer Res imaging study)
    payloadPenetrationLength: 5.5, // ESTIMATE: the released chemo payload (DXd) leaks into neighbors the antibody never reached (same 2021 imaging study). other ADC payloads reached ~125 um vs ~75 um for the antibody-hit cells (Khera et al. 2022) -> ~1.7x deeper
    bystander: 0.5,           // DUMMY 
    halfLifeH: 139,           // RAYNE: 5.8 days x 24
    mode: "bolus",            // 30-90 min IV infusion every 3 weeks
    infusionH: 0,             // not used (bolus)
    killRate: 1.2,            // DUMMY
    ec50: 0.15,               // DUMMY
    hill: 2,                  // DUMMY
    quiescentFactor: 0.2,     // DUMMY (topo-I payload mostly hits dividing cells)
    effluxSubstrate: true,    // DUMMY
    resistTrait: TRAIT.RTA,   // DUMMY
    resistFold: 25,           // DUMMY
  },
  porfimer: {
    // photodynamic therapy (Photofrin): the drug does nothing by itself. ~2 days after the shot a laser
    // is shone on the tumor and the drug makes toxic singlet oxygen right there. so it needs light AND oxygen
    name: "Porfimer sodium (Photofrin) + laser", kind: "photodynamic",
    penetrationLength: 2.5,   // ESTIMATE: Photofrin mostly sticks near blood vessels (Korbelik & Krosl 1994, Br J Cancer; 2012 Cancer Res vascular study). similar photosensitizers convert to L = 2.3 (mTHPC, 5x lower at 75 um) to 5.4 cells (NPe6, 2x lower at 75 um), and Photofrin's on the vessel-hugging end
    halfLifeH: 408,           // RAYNE: 12.7-21.3 days, took ~17 days (x 24)
    mode: "bolus",            // SOURCED: single IV injection
    infusionH: 0,             // not used (bolus)
    killRate: 12,             // DUMMY (while the laser is on - PDT kills a lot in one go)
    ec50: 0.2,                // DUMMY
    hill: 2,                  // DUMMY
    quiescentFactor: 1,       // DUMMY (singlet oxygen kills resting cells just as well)
    effluxSubstrate: false,   // DUMMY
    resistTrait: TRAIT.RCH,   // DUMMY
    resistFold: 3,            // DUMMY
    needsLight: true,         // how PDT works (not a dummy)
    needsOxygen: true,        // how PDT works (not a dummy)
    oxygenK: 0.1,             // DUMMY - kill is half-max at this oxygen level (1 = right by the vessels)
  },
};

export const DUMMY_FIELDS = Object.fromEntries(
  Object.entries(DRUG_CATALOG).map(([id, d]) => [id, Object.keys(d).filter((k) => k !== "name" && k !== "kind")])
);

/** report for dummies. just kidding it's just for finding any dummy fields left behind in my edits & reformatting*/
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
    this.plasma = {};        // 1 = peak after one standard dose
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
  /** bolus */
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

  /** turn a daily pill / maintenance drug on (level > 0) or off (0)
   Not really a concern for right now but still not like removing it because eventually it might be helpful?*/
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

  /** the normalized field (vessel = 1) a drug uses, which we can use later for coloring the 3D view?? */
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
