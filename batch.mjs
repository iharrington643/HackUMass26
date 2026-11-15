// runs the sim headless a bunch of times with random patients + treatments, for training the
// surrogate model. when it's done, one JSON line per run goes into the output file
//
// each run:
//   1. pick a random cancer + one of the regimens that cancer is allowed (cancers.js / schedules.js)
//   2. pick random "hidden" patient parameters (mutation rate, cost of resistance, cycle time, how strong the
//      drugs / radiation / immune system are). the model never sees these, they're just there so patients differ
//   3. grow the tumor to a random starting size, start treatment = day 0
//   4. record tumor size every day for 3 weeks (the model's inputs)
//   5. keep going until resistant cells take over (>50% of living cells for 7 days straight), the tumor is
//      wiped out, or day 180
//
// "resistant" depends on the treatment (see resistanceGroups) though; it has to resist EVERY kind of treatment in
// the regimen. eg carboplatin + paclitaxel + pembrolizumab -> need (RCH or EFX) AND IMM

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { appendFileSync, existsSync } from "node:fs";
import os from "node:os";
import { Simulation } from "./simulation.js";
import { DRUG_CATALOG } from "./drugs.js";
import { CANCER_TYPES } from "./cancers.js";
import { REGIMENS, regimensFor, regimenTreatments } from "./schedules.js";
import { TRAIT } from "./cells.js";
import { makeRng } from "./grid.js";

export const HORIZON = 180;        // days after treatment starts
export const TAKEOVER_FRAC = 0.5;  // resistant share that counts as "taken over"
export const TAKEOVER_HOLD = 7;    // ...and it has to stay there this many days
export const MIN_LIVING = 100;     // ignore takeover by a tiny handful of cells (just noise)
export const FEATURE_DAYS = 21;    // the model makes its prediction on day 21

// which trait combos count as resistant to each kind of treatment
const GROUP_OF = {
  carboplatin: "chemo", doxorubicin: "chemo", paclitaxel: "chemo", porfimer: "chemo",
  goserelin: "hormone", trastuzumabDeruxtecan: "adc", pembrolizumab: "immuno", radiation: "rt",
};
const GROUP_MASK = {
  chemo: TRAIT.RCH | TRAIT.EFX,
  hormone: TRAIT.RTA,
  adc: TRAIT.RTA | TRAIT.EFX,
  immuno: TRAIT.IMM,
  rt: TRAIT.RAD,
};
export function resistanceGroups(regimen) {
  return [...new Set(regimenTreatments(regimen).map((t) => GROUP_OF[t]))].map((g) => GROUP_MASK[g]);
}
const isResistant = (geno, masks) => masks.every((m) => (geno & m) !== 0);

const logU = (r, lo, hi) => Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo)));

/** pick everything random about one run (can be re-made exactly bc of runID) */
export function drawRun(runId) {
  const r = makeRng(1000003 * (runId + 1));
  const cancerIds = Object.keys(CANCER_TYPES);
  const cancer = cancerIds[Math.floor(r() * cancerIds.length)];
  const options = regimensFor(CANCER_TYPES[cancer]);
  const regimen = options[Math.floor(r() * options.length)];
  return {
    runId, seed: Math.floor(r() * 2 ** 31) + 1, cancer, regimen,
    doseScale: +(0.5 + r()).toFixed(3),                  // 0.5x to 1.5x the standard dose
    targetN0: Math.round(8000 + r() * 20000),            // start treatment somewhere between 8k and 28k cells
    hidden: {                                            // THESE DO NOT GO INTO THE MODEL, I REPEAT DO NOT GIVE ANY OF THESE TO THE MODEL
      mu: 6e-4 * logU(r, 0.5, 2),
      costRes: 0.12 * logU(r, 0.5, 1.5),
      cycleH: 72 * logU(r, 0.6, 1.5),
      drugPotency: logU(r, 0.6, 1.6),                    // multiplies every drug's kill rate
      rtAlpha: 0.3 * logU(r, 0.7, 1.4),
      immuneKill: 2.0 * logU(r, 0.5, 2),
    },
  };
}

/** run one simulation & return the row for the dataset */
export function runOne(spec) {
  const h = spec.hidden;
  const catalog = Object.fromEntries(Object.entries(DRUG_CATALOG).map(([id, d]) => [id, { ...d, killRate: d.killRate * h.drugPotency }]));
  const sim = new Simulation({
    seed: spec.seed, cancer: spec.cancer, drugCatalog: catalog, snapshotEveryDays: 100000, // no rewind needed here
    cellParams: { mu: h.mu, costRes: h.costRes, cycleH: h.cycleH },
    rtParams: { alpha: h.rtAlpha }, immunoParams: { kKill: h.immuneKill },
  });
  const growDays = sim.growTo(spec.targetN0, 120);
  const regimen = REGIMENS[spec.regimen];
  const masks = resistanceGroups(regimen);
  const c = sim.clones;
  const resFrac = () => {
    let res = 0, tot = 0;
    for (let k = 0; k < c.n; k++) { const n = c.count[k]; if (n > 0) { tot += n; if (isResistant(c.geno[k], masks)) res += n; } }
    return { tot, frac: tot ? res / tot : 0 };
  };

  const N0 = c.totalLiving();
  sim.startPlan(regimen, { doseScale: spec.doseScale });
  const sizes = [N0], fracs = [resFrac().frac];
  let outcome = "not_by_180", T_res = null, above = 0, firstAbove = null, oracle = null;
  for (let day = 1; day <= HORIZON; day++) {
    sim.runDays(1);
    const { tot, frac } = resFrac();
    sizes.push(tot); fracs.push(frac);
    if (day === FEATURE_DAYS) oracle = { true_res_frac_d21: frac, n_clones_d21: c.livingClones() };
    if (tot === 0) { outcome = "eradicated"; if (!oracle) oracle = { true_res_frac_d21: 0, n_clones_d21: 0 }; break; }
    if (frac > TAKEOVER_FRAC && tot >= MIN_LIVING) { if (above === 0) firstAbove = day; above++; } else above = 0;
    if (above >= TAKEOVER_HOLD) { outcome = "takeover"; T_res = firstAbove; break; }
  }
  // if it ended before day 21, pad the trajectory with zeros so features still work
  while (sizes.length <= FEATURE_DAYS) sizes.push(0);
  return {
    ...spec, growDays, N0, outcome, T_res, daysRun: fracs.length - 1,
    sizes: sizes.slice(0, FEATURE_DAYS + 1),          // days 0..21, raw living-cell counts
    resFrac: fracs.map((f) => +f.toFixed(4)),          
    ...oracle,
  };
}

//  worker side
if (!isMainThread) {
  parentPort.on("message", (runId) => {
    if (runId === null) process.exit(0);
    const t = performance.now();
    const row = runOne(drawRun(runId));
    row.ms = Math.round(performance.now() - t);
    parentPort.postMessage(row);
  });
}

//  main side
if (isMainThread && process.argv[1] && process.argv[1].endsWith("batch.mjs")) {
  const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
  const runs = +arg("runs", 50), start = +arg("start", 0), out = arg("out", "runs.jsonl");
  const nWorkers = +arg("workers", os.cpus().length);
  const done = new Set();
  if (existsSync(out)) for (const l of (await import("node:fs")).readFileSync(out, "utf8").split("\n")) if (l) done.add(JSON.parse(l).runId);
  const queue = []; for (let id = start; id < start + runs; id++) if (!done.has(id)) queue.push(id);
  console.log(`${queue.length} runs to do (${done.size} already in ${out}), ${nWorkers} workers`);
  const t0 = Date.now(); let finished = 0;
  const counts = { takeover: 0, not_by_180: 0, eradicated: 0 };
  await Promise.all(Array.from({ length: Math.min(nWorkers, queue.length) }, () => new Promise((resolve) => {
    const w = new Worker(new URL(import.meta.url));
    const next = () => { const id = queue.shift(); if (id === undefined) { w.postMessage(null); resolve(); } else w.postMessage(id); };
    w.on("message", (row) => {
      appendFileSync(out, JSON.stringify(row) + "\n");
      finished++; counts[row.outcome]++;
      const el = (Date.now() - t0) / 1000;
      if (finished % 10 === 0 || queue.length === 0)
        console.log(`${finished} done | ${JSON.stringify(counts)} | ${(el / finished).toFixed(1)} s/run | ~${Math.round((el / finished) * queue.length / 60)} min left`);
      next();
    });
    w.on("error", (e) => { console.error(e); next(); });
    next();
  })));
  console.log(`finished in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
