// simhelpers.mjs - tiny helper to spin up a grown tumor for tests
import { CellGrid, makeRng } from "./grid.js";
import { createOxygenField } from "./diffusion.js";
import { CellRules, CloneTable } from "./cells.js";

export function makeSim(seed = 1, params = {}, founder = 0) {
  const grid = new CellGrid(44, 20.5);
  const oxygen = createOxygenField(grid);
  const clones = new CloneTable();
  const rules = new CellRules(grid, oxygen, clones, params, makeRng(seed));
  rules.seed(4.5, founder);
  oxygen.solveToTolerance(1e-6, 3000);
  const stepOnce = () => { rules.stepAll(); oxygen.step(); };
  const run = (days, perDay) => {
    for (let d = 0; d < days; d++) {
      if (perDay) perDay(d);
      for (let s = 0; s < 24 / rules.p.dtH; s++) stepOnce();
    }
  };
  const growTo = (cells, maxDays = 120) => { let d = 0; while (clones.totalLiving() < cells && d < maxDays) { run(1); d++; } return d; };
  return { grid, oxygen, clones, rules, run, growTo, stepOnce };
}
