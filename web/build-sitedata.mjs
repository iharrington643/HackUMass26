
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { CANCER_TYPES } from "../cancers.js";
import { STARTING_FREQ } from "../cancers.js";
import { DRUG_CATALOG, DIFFUSION_PARAMS, penetrationLengthCells, CELL_UM } from "../drugs.js";
import { GDSC_KILL_SCALE, GDSC_RESIST_FOLD, GDSC_PROXY } from "../gdsc.js";
import { REGIMENS } from "../schedules.js";
import { TIMELINES } from "../sideeffects.js";

const here = (p) => new URL(p, import.meta.url);
const readJSON = (p) => (existsSync(here(p)) ? JSON.parse(readFileSync(here(p), "utf8")) : null);

const data = {};
data.model = readJSON("../surrogate/out/web_results.json");
data.metrics = readJSON("../surrogate/out/metrics.json");
data.sensitivity = readJSON("../analysis/out/sensitivity_summary.json");
data.regimenNames = Object.fromEntries(Object.entries(REGIMENS).map(([k, v]) => [k, v.name]));

const strat = readJSON("../analysis/out/strategies.json");
if (strat) {
  const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
  data.strategies = {};
  for (const cancer of strat.cancers) {
    const rows = strat.rows.filter((r) => r.cancer === cancer);
    const regs = [...new Set(rows.map((r) => r.regimen))];
    data.strategies[cancer] = regs.map((reg) => {
      const rr = rows.filter((r) => r.regimen === reg);
      const days = [], med = [], lo = [], hi = [];
      for (let d = 0; d <= 180; d += 3) {
        const v = rr.map((r) => r.rel[Math.min(d, r.rel.length - 1)]);
        days.push(d); med.push(+pct(v, 0.5).toFixed(3)); lo.push(+pct(v, 0.1).toFixed(3)); hi.push(+pct(v, 0.9).toFixed(3));
      }
      return { regimen: reg, name: REGIMENS[reg]?.name ?? reg, days, med, lo, hi,
        pTakeover: rr.filter((r) => r.outcome === "takeover").length / rr.length,
        pGone: rr.filter((r) => r.outcome === "eradicated").length / rr.length };
    }).sort((a, b) => a.med[a.med.length - 1] - b.med[b.med.length - 1]);
  }
}

data.cancers = Object.entries(CANCER_TYPES).map(([id, c]) => ({ id, name: c.name, newCases: c.newCases, deaths: c.deaths,
  treatments: c.treatments }));
data.penetration = Object.entries(DRUG_CATALOG).map(([id, d]) => ({
  id, name: d.name, L: +penetrationLengthCells(id, d, DIFFUSION_PARAMS).toFixed(2),
  um: Math.round(penetrationLengthCells(id, d, DIFFUSION_PARAMS) * CELL_UM),
  Deff: DIFFUSION_PARAMS[id]?.Deff ?? null, k: DIFFUSION_PARAMS[id]?.k ?? null }));
data.gdsc = { killScale: GDSC_KILL_SCALE, resistFold: GDSC_RESIST_FOLD, proxy: GDSC_PROXY };
data.startingFreq = STARTING_FREQ;
data.timelines = TIMELINES;

mkdirSync(here("./data/"), { recursive: true });
writeFileSync(here("./data/sitedata.js"),
  "// made by web/build-sitedata.mjs - don't edit by hand\nwindow.SITE_DATA = " + JSON.stringify(data) + ";\n");
console.log("wrote web/data/sitedata.js", (JSON.stringify(data).length / 1024).toFixed(0) + " KB");
