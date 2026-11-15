// check-parity.mjs - makes sure surrogate.js gives the same answers as the python model
//   node surrogate/check-parity.mjs
import { readFileSync } from "node:fs";
import { Surrogate } from "./surrogate.js";
const model = new Surrogate(JSON.parse(readFileSync(new URL("./out/surrogate_model.json", import.meta.url))));
const rows = JSON.parse(readFileSync(new URL("./out/parity_check.json", import.meta.url)));
let worst = 0;
for (const r of rows) {
  const p = model.predict(r.row);
  worst = Math.max(worst, ...["takeover", "not_by_180", "eradicated"].map((o, k) => Math.abs(p.probs[o] - r.probs[k])),
    Math.abs(p.day.p50 - r.p50) / r.p50, Math.abs(p.day.intervals[0.8][0] - r.lo80) / r.lo80, Math.abs(p.day.intervals[0.8][1] - r.hi80) / r.hi80);
}
console.log(`${rows.length} test rows, worst difference JS vs python: ${worst.toExponential(2)}`);
if (worst > 1e-4) { console.error("MISMATCH"); process.exit(1); }
console.log("JS surrogate matches python ✔");
