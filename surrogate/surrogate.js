//  runs the trained surrogate model (see train.py)

export const TREATMENT_GROUP = {
  carboplatin: "chemo", doxorubicin: "chemo", paclitaxel: "chemo", porfimer: "chemo",
  goserelin: "hormone", trastuzumabDeruxtecan: "adc", pembrolizumab: "immuno", radiation: "rt",
};


const EPS = 1e-6;

export function trajectoryFeatures(sizes) {
  const n0 = Math.max(sizes[0], 1);
  const rel = sizes.slice(0, 22).map((s) => s / n0);
  const nadir = Math.min(...rel), nadirDay = rel.indexOf(nadir);
  const r7 = rel[7], r14 = rel[14], r21 = rel[21];
  return {
    logN0: Math.log10(n0), r7, r14, r21, nadir, nadir_day: nadirDay,
    slope_14_21: Math.log(Math.max(r21, EPS) / Math.max(r14, EPS)) / 7,
    slope_7_14: Math.log(Math.max(r14, EPS) / Math.max(r7, EPS)) / 7,
    regrowing: r21 > nadir * 1.1 ? 1 : 0,
  };
}


function treeValue(tr, x) {
  let n = 0;
  while (tr.f[n] >= 0) n = x[tr.f[n]] <= tr.t[n] ? tr.l[n] : tr.r[n];
  return tr.t[n];
}
const sumTrees = (baseline, trees, x) => { let s = baseline; for (const t of trees) s += treeValue(t, x); return s; };

export class Surrogate {
  constructor(json) {
    if (json.format !== 2) throw new Error("old model file - re-run surrogate/train.py");
    this.m = json;
    this.vocab = json.vocab;
  }

  get regimens() { return this.vocab.regimens; }
  get cancers() { return this.vocab.cancers; }

  featureVector({ cancer, regimen, doseScale = 1, sizes }) {
    const v = this.vocab, f = {};
    if (sizes.length < 22) throw new Error("need tumor sizes for days 0 through 21");
    for (const c of v.cancers) f["cancer_" + c] = cancer === c ? 1 : 0;
    for (const r of v.regimens) f["regimen_" + r] = regimen === r ? 1 : 0;
    const used = v.regimenGroups[regimen] || [];
    for (const g of v.groups) f["uses_" + g] = used.includes(g) ? 1 : 0;
    f.doseScale = doseScale;
    Object.assign(f, trajectoryFeatures(sizes));
    return this.m.features.map((k) => f[k]);
  }

  predict(input) {
    const x = this.featureVector(input), m = this.m;
    const c = m.classifier;
    const raw = c.baseline.map((b, k) => sumTrees(b, c.trees[k], x));
    const mx = Math.max(...raw), ex = raw.map((r) => Math.exp(r - mx)), z = ex.reduce((a, b) => a + b, 0);
    const probs = Object.fromEntries(m.outcomes.map((o) => [o, 0]));
    c.classes.forEach((cls, k) => { probs[m.outcomes[cls]] = ex[k] / z; });
    // takeover day, quantile models are in log-days
    const q = (p) => { const e = m.quantiles[String(p)]; return sumTrees(e.baseline, e.trees, x); };
    const intervals = {};
    for (const L of m.levels) {
      const off = m.cqr_offsets[String(L)];
      intervals[L] = [Math.exp(q(+((1 - L) / 2).toFixed(4)) - off), Math.exp(q(+(1 - (1 - L) / 2).toFixed(4)) + off)];
    }
    return { probs, day: { p50: Math.exp(q(0.5)), intervals } };
  }

  /** predict once for every regimen a cancer is allowed, eg to rank options in the UI.*/
  compare(input, regimenIds) {
    return regimenIds.map((regimen) => ({ regimen, ...this.predict({ ...input, regimen }) }));
  }

  /** pull the inputs out of a Simulation that's been on plan for at least 21+ days */
  predictFromSim(sim, plan, regimenId) {
    const rows = sim.history.filter((h) => h.day >= plan.startDay && h.day <= plan.startDay + 21);
    return this.predict({
      cancer: sim.opts.cancer,
      regimen: regimenId, doseScale: plan.doseScale, sizes: rows.map((h) => h.living),
    });
  }
}

/** fetch + build the model */
export async function loadSurrogate(url = new URL("./out/surrogate_model.json", import.meta.url)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't load surrogate model from ${url} (${res.status})`);
  return new Surrogate(await res.json());
}
