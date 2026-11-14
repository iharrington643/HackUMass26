// treatment schedules for the treatments Rayne and Hope put together: chemo cycles (every 1/2/3 weeks),
// monthly hormone implant, Enhertu + pembrolizumab every 3 (or 6) weeks, Photofrin + laser,
// and radiation courses
//
// a plan is a list of "parts" that each start on some day of the plan:
//   { type: "cycles",  drug, days: [0], cycleDays: 21, cycles: 4, dose: 1 }    drug cycles (cycles can be Infinity)
//   { type: "continuous", drug, startDay: 0, endDay: Infinity, level: 1 }     daily pills (don't think we're using this concept yet but in case we swap to another treatment)
//   { type: "rt",      dosePerFraction: 2, weeks: 4 }                           radiation Mon-Fri
//   { type: "ici",     intervalDays: 21, doses: 35, dose: 1 }                  pembrolizumab
//   { type: "pdt",     drug: "porfimer", lightDelayDays: 2, courses: 1, intervalDays: 30 }   shot, then laser 2 days later
//
// "phases" let a regimen switch drugs partway (eg dose-dense doxorubicin then weekly paclitaxel)
//
// dose: 1 = one standard dose of that drug. the schedules (how often, how many) arebased on whatever seemed most common/standard online (see source notes)

export const REGIMENS = {
//chemo
  carboplatinQ21: {
    name: "Carboplatin every 3 weeks x6",
    parts: [{ type: "cycles", drug: "carboplatin", days: [0], cycleDays: 21, cycles: 6 }], // SOURCED: standard 21-day cycles, 4-6 of them
  },
  carboPaclitaxelQ21: {
    name: "Carboplatin + paclitaxel every 3 weeks x6",
    parts: [ // this appears to be the standard lung / endometrial doublet, both on day 1 of a 21-day cycle
      { type: "cycles", drug: "carboplatin", days: [0], cycleDays: 21, cycles: 6 },
      { type: "cycles", drug: "paclitaxel", days: [0], cycleDays: 21, cycles: 6 },
    ],
  },
  doxQ21: {
    name: "Doxorubicin every 3 weeks x4",
    parts: [{ type: "cycles", drug: "doxorubicin", days: [0], cycleDays: 21, cycles: 4 }],
  },
  doxDoseDense: {
    name: "Dose-dense doxorubicin (every 2 weeks x4) then weekly paclitaxel x12",
    parts: [ 
      { type: "cycles", drug: "doxorubicin", days: [0], cycleDays: 14, cycles: 4 },
      { type: "cycles", drug: "paclitaxel", days: [0], cycleDays: 7, cycles: 12, dose: 0.46, startDay: 56 }, // weekly dose is 80 vs 175 mg/m2
    ],
  },
  weeklyPaclitaxel: {
    name: "Weekly paclitaxel x12",
    parts: [{ type: "cycles", drug: "paclitaxel", days: [0], cycleDays: 7, cycles: 12, dose: 0.46 }],
  },

  // hormone
  goserelinMonthly: {
    name: "Goserelin implant every 28 days (ongoing)",
    parts: [{ type: "cycles", drug: "goserelin", days: [0], cycleDays: 28, cycles: Infinity }], // 3.6 mg implant every 28 days
  },
  goserelinPlusRT: {
    name: "Goserelin implants + radiation 3 Gy x20 starting at 8 weeks",
    parts: [ 
      { type: "cycles", drug: "goserelin", days: [0], cycleDays: 28, cycles: 6 },
      { type: "rt", dosePerFraction: 3, weeks: 4, startDay: 56 },
    ],
  },

  //  targeted
  enhertuQ21: {
    name: "Trastuzumab deruxtecan (Enhertu) every 3 weeks (ongoing)",
    parts: [{ type: "cycles", drug: "trastuzumabDeruxtecan", days: [0], cycleDays: 21, cycles: Infinity }], //essentially until it stops working
  },

  // immunotherapy
  pembroQ3W: {
    name: "Pembrolizumab every 3 weeks (up to 2 years)",
    parts: [{ type: "ici", intervalDays: 21, doses: 35 }],     
  },
  pembroQ6W: {
    name: "Pembrolizumab every 6 weeks (up to 2 years)",
    parts: [{ type: "ici", intervalDays: 42, doses: 18, dose: 2 }],
  },
  carboPaclitaxelPembro: {
    name: "Carboplatin + paclitaxel + pembrolizumab x4, then pembrolizumab alone",
    parts: [
      { type: "cycles", drug: "carboplatin", days: [0], cycleDays: 21, cycles: 4 },
      { type: "cycles", drug: "paclitaxel", days: [0], cycleDays: 21, cycles: 4 },
      { type: "ici", intervalDays: 21, doses: 35 },
    ],
  },

  //  photodynamic 
  photofrinPDT: {
    name: "Photofrin injection, laser 2 days later",
    parts: [{ type: "pdt", drug: "porfimer", lightDelayDays: 2, courses: 1, intervalDays: 30 }],
  },

  //  radiation 
  radiationConventional: {
    name: "Radiation 2 Gy x 30 (60 Gy over 6 weeks)",
    parts: [{ type: "rt", dosePerFraction: 2, weeks: 6 }],      
  },
  radiationHypo: {
    name: "Radiation 2.67 Gy x 15 (40 Gy over 3 weeks)",
    parts: [{ type: "rt", dosePerFraction: 2.67, weeks: 3 }],  
  },
  radiation40Gy: {
    name: "Radiation 2 Gy x 20 (40 Gy over 4 weeks)",
    parts: [{ type: "rt", dosePerFraction: 2, weeks: 4 }],
  },
};

/** which treatments (if confused, see the list of names from cancers.js TREATMENTS) a regimen uses */
export function regimenTreatments(regimen) {
  const t = new Set();
  for (const p of regimen.parts) {
    if (p.type === "rt") t.add("radiation");
    else if (p.type === "ici") t.add("pembrolizumab");
    else t.add(p.drug);
  }
  return [...t];
}

/** regimens a cancer can get = every treatment in the regimen is on that cancer's list */
export function regimensFor(cancer) {
  const ok = new Set(cancer.treatments);
  return Object.entries(REGIMENS).filter(([, r]) => regimenTreatments(r).every((t) => ok.has(t))).map(([id]) => id);
}

export class TreatmentPlan {
  /**
   * @param {object} regimen   one of REGIMENS (or your own { name, parts })
   * @param {number} startDay  sim day the plan starts
   * @param {object} opts      { doseScale: 1 } multiplies every drug dose
   */
  constructor(regimen, startDay = 0, opts = {}) {
    this.regimen = regimen; this.startDay = startDay;
    this.doseScale = opts.doseScale ?? 1;
    this.name = regimen.name;
  }

  /** everything that should happen on a given sim day... */
  eventsOn(simDay) {
    const d = simDay - this.startDay, out = [];
    if (d < 0) return out;
    for (const part of this.regimen.parts) {
      const rel = d - (part.startDay ?? 0);
      if (rel < 0) continue;
      if (part.type === "cycles") {
        const cyc = Math.floor(rel / part.cycleDays), inCycle = rel % part.cycleDays;
        if (cyc < part.cycles && part.days.includes(inCycle))
          out.push({ type: "drug", drug: part.drug, dose: (part.dose ?? 1) * this.doseScale, cycle: cyc + 1, of: part.cycles });
      } else if (part.type === "continuous") {
        const end = part.endDay ?? Infinity;
        out.push({ type: "continuous", drug: part.drug, level: rel < end - (part.startDay ?? 0) ? (part.level ?? 1) * this.doseScale : 0 });
      } else if (part.type === "pdt") {
        const course = Math.floor(rel / part.intervalDays), inC = rel % part.intervalDays;
        if (course < (part.courses ?? 1)) {
          if (inC === 0) out.push({ type: "drug", drug: part.drug, dose: (part.dose ?? 1) * this.doseScale, cycle: course + 1, of: part.courses ?? 1 });
          if (inC === part.lightDelayDays) out.push({ type: "light" });
        }
      } else if (part.type === "rt") {
        if (rel < part.weeks * 7 && rel % 7 < 5) out.push({ type: "rt", dose: part.dosePerFraction });
      } else if (part.type === "ici") {
        const k = Math.floor(rel / part.intervalDays);
        if (rel % part.intervalDays === 0 && k < (part.doses ?? Infinity)) out.push({ type: "ici", dose: part.dose ?? 1 });
      }
    }
    return out;
  }

  /** last day anything happens */
  get lengthDays() {
    let L = 0;
    for (const p of this.regimen.parts) {
      const s = p.startDay ?? 0;
      if (p.type === "cycles") L = Math.max(L, s + p.cycleDays * p.cycles);
      else if (p.type === "pdt") L = Math.max(L, s + p.intervalDays * ((p.courses ?? 1) - 1) + p.lightDelayDays + 1);
      else if (p.type === "ici") L = Math.max(L, s + p.intervalDays * (p.doses ?? Infinity));
      else if (p.type === "rt") L = Math.max(L, s + p.weeks * 7);
      else L = Infinity;
    }
    return L;
  }

  /** text calendar of the first `days` days --just for debugging */
  calendar(days = 28) {
    const lines = [];
    for (let k = 0; k < days; k++) {
      const ev = this.eventsOn(this.startDay + k).filter((e) => e.type !== "continuous" || e.level > 0);
      if (ev.length) lines.push(`day ${k}: ` + ev.map((e) => (e.type === "drug" ? `${e.drug} x${e.dose} (cycle ${e.cycle}/${e.of})` : e.type === "rt" ? `RT ${e.dose} Gy` : e.type === "ici" ? "pembrolizumab" : e.type === "light" ? "PDT laser" : `${e.drug} on`)).join(", "));
    }
    return lines;
  }
}