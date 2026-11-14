// this is the javascript version of rayne's work on the cancer type & treatment regiment research!
// aka coding in the cancer types we picked + which treatments each one can get (from Rayne's sheet)
//
// the user picks a cancer before starting, then only gets offered regimens whose treatments are all
// on that cancer's list (regimensFor() in schedules.js does the filtering)
//
// stats are US new cases + deaths per year, thanks to Rayne's research
// killScale = how much each drug works on this cancer compared to a cancer it fully works on.
//   1 = normal. most are 1 for now. the ones that aren't are for drugs that need the tumor to have a
//   specific target: goserelin needs hormone-driven cancer, Enhertu needs HER2 on the cells, etc

export const TREATMENTS = {
  carboplatin: "Carboplatin (chemo)",
  doxorubicin: "Doxorubicin (chemo)",
  paclitaxel: "Paclitaxel (chemo)",
  goserelin: "Goserelin (hormone)",
  pembrolizumab: "Pembrolizumab (immunotherapy)",
  porfimer: "Porfimer sodium / Photofrin (photodynamic)",
  radiation: "Radiation therapy",
  trastuzumabDeruxtecan: "Trastuzumab deruxtecan / Enhertu (targeted)",
};

const ALL = Object.keys(TREATMENTS);
const except = (...no) => ALL.filter((t) => !no.includes(t));

export const CANCER_TYPES = {
  bladder: {
    name: "Bladder cancer", newCases: 84870, deaths: 17420,                       // RAYNE
    treatments: except("goserelin"),                                              // RAYNE
    killScale: { trastuzumabDeruxtecan: 0.4 },                                    // DUMMY (only HER2+ tumors respond well)
  },
  breast: {
    name: "Breast cancer", newCases: 319750, deaths: 42680,                       // RAYNE
    treatments: ALL,                                                              // RAYNE
    killScale: { goserelin: 0.7 },                                                // DUMMY (most breast cancers are ER+, not all)
  },
  colorectal: {
    name: "Colon and rectal cancer", newCases: 154270, deaths: 52900,             // RAYNE
    treatments: ["pembrolizumab", "radiation", "trastuzumabDeruxtecan"],          // RAYNE
    killScale: { trastuzumabDeruxtecan: 0.4 },                                    // DUMMY (only HER2+ tumors respond well)
  },
  uterine: {
    name: "Uterine / endometrial cancer", newCases: 69120, deaths: 13860,         // RAYNE
    treatments: except("porfimer"),                                               // RAYNE
    killScale: { goserelin: 0.5, trastuzumabDeruxtecan: 0.4 },                    // DUMMY
  },
  prostate: {
    name: "Prostate cancer", newCases: 313780, deaths: 35770,                     // RAYNE
    treatments: ["carboplatin", "goserelin", "pembrolizumab", "radiation", "trastuzumabDeruxtecan"], // RAYNE
    killScale: { trastuzumabDeruxtecan: 0.4 },                                    // DUMMY (goserelin = 1, prostate is the classic hormone-driven one)
  },
  nonHodgkin: {
    name: "Non-Hodgkin lymphoma", newCases: 80350, deaths: 19390,                 // RAYNE
    treatments: ["carboplatin", "doxorubicin", "pembrolizumab", "radiation"],     // RAYNE
    killScale: {},
  },
  hodgkin: {
    name: "Hodgkin lymphoma", newCases: 8920, deaths: 1100,                       // RAYNE
    treatments: ["carboplatin", "doxorubicin", "pembrolizumab", "radiation"],     // RAYNE
    killScale: {},
  },
  lung: {
    name: "Lung cancer", newCases: 226650, deaths: 124730,                        // RAYNE
    treatments: except("goserelin"),                                              // RAYNE
    killScale: { trastuzumabDeruxtecan: 0.4 },                                    // DUMMY
  },
  thyroid: {
    name: "Thyroid cancer", newCases: 44020, deaths: 2290,                        // RAYNE
    treatments: except("goserelin", "porfimer"),                                  // RAYNE
    killScale: { trastuzumabDeruxtecan: 0.4 },                                    // DUMMY
  },
  melanoma: {
    name: "Melanoma", newCases: 104960, deaths: 8430,                             // RAYNE
    treatments: ["carboplatin", "paclitaxel", "pembrolizumab", "radiation", "trastuzumabDeruxtecan"], // RAYNE
    killScale: { trastuzumabDeruxtecan: 0.4 },                                    // DUMMY
  },
};

export function killScaleFor(cancerId) {
  const c = CANCER_TYPES[cancerId];
  if (!c) throw new Error(`unknown cancer ${cancerId}`);
  const out = {};
  for (const t of ALL) out[t] = c.treatments.includes(t) ? c.killScale[t] ?? 1 : 0;
  return out;
}

/** deaths per new case, eg for the cancer picker screen */
export function mortality(cancerId) { const c = CANCER_TYPES[cancerId]; return c.deaths / c.newCases; }