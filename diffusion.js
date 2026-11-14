// diffusion.js - steady state reaction-diffusion solver that runs on the CellGrid
//
// this solves 0 = D*del^2(C) - k*u(state)*C  (equation #2 in Hope's Math Notes tab of the task list sheet)
// on our grid. C is held at boundaryValue right outside the sphere bc that's where the blood vessels are
// everything's unitless, C = 1 at the vessels and distances are in cell diameters
// penetration length L = sqrt(D/k) (equation #3)
// on the grid the uptake part turns into (h/L)^2 (equation #9)
//
// solver = red-black gauss-seidel w/ over-relaxation (SOR), see equation #10
// every sim step we start from last step's field and just do 5 sweeps (omega = 1.7)
// that's accurate enough bc oxygen settles in like 20 sec and our time step is 4 hrs (#16)

import { EMPTY, ALIVE, DORMANT, DEAD } from "./grid.js";

export class DiffusionField {
  /**
   * @param {CellGrid} grid
   * @param {object} opts
   * opts.penetrationLength  L in cell diameters (oxygen is ~3)
   * opts.boundaryValue      what the value is at the vessels (1 for oxygen)
   * opts.dormantUptake      how much DORMANT cells use compared to ALIVE ones (resting cells breathe less)
   * opts.deadUptake         how much DEAD debris uses compared to ALIVE (0 for oxygen obv)
   * opts.backgroundUptake   tiny bit used by the surrounding tissue at EMPTY sites (grid units)
   * opts.omega              over-relaxation factor, has to be between 1 and 2 (1.7 was fastest when we tested)
   */
  constructor(grid, opts = {}) {
    const {
      penetrationLength = 3,
      boundaryValue = 1,
      dormantUptake = 0.5,
      deadUptake = 0,
      backgroundUptake = 0.002,
      omega = 1.7,
    } = opts;
    this.grid = grid;
    this.omega = omega;
    this.boundaryValue = boundaryValue;
    this.relUptake = { dormant: dormantUptake, dead: deadUptake, background: backgroundUptake };
    this.F = new Float32Array(grid.n).fill(boundaryValue);

    // split the sites into red/black like a checkerboard. every neighbor of a red site is black
    // so we can update each half in place and the order doesn't mess anything up
    const red = [], black = [];
    for (const i of grid.domain) {
      const [x, y, z] = grid.coords(i);
      ((x + y + z) & 1 ? black : red).push(i);
    }
    this.red = Int32Array.from(red);
    this.black = Int32Array.from(black);

    this.absorb = new Float32Array(4); // extra uptake term for each cell state
    this.setPenetrationLength(penetrationLength);
  }

  /** change L (like for a different drug or if someone moves the slider) */
  setPenetrationLength(L) {
    this.L = L;
    const a = 1 / (L * L);                 // (h/L)^2, h = 1 cell diameter
    const bg = this.relUptake.background;
    this.absorb[EMPTY] = bg;
    this.absorb[ALIVE] = a + bg;
    this.absorb[DORMANT] = a * this.relUptake.dormant + bg;
    this.absorb[DEAD] = a * this.relUptake.dead + bg;
  }

  /** set the value at the vessels (outside the sphere). for drugs this is the plasma level */
  setBoundaryValue(v) {
    const { F, grid } = this;
    const old = this.boundaryValue;
    // the equation is linear so the whole field just scales with the boundary value
    // so rescaling gives the exact new answer right away, no extra sweeps needed after a dose
    const scale = old !== 0 ? v / old : 0;
    for (let i = 0; i < grid.n; i++) {
      if (!grid.inside[i]) F[i] = v;
      else if (old !== 0) F[i] *= scale;
    }
    this.boundaryValue = v;
    // if it started at 0 there's nothing to scale yet, so just do a full solve instead
    if (old === 0 && v !== 0) this.solveToTolerance(1e-5, 1000);
  }

  /** do n red-black SOR sweeps */
  sweep(n = 3) {
    const { F, absorb, omega } = this;
    const st = this.grid.state;
    const s = this.grid.size, s2 = this.grid.size2;
    for (let it = 0; it < n; it++) {
      for (let pass = 0; pass < 2; pass++) {
        const list = pass === 0 ? this.red : this.black;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          const sum = F[i - 1] + F[i + 1] + F[i - s] + F[i + s] + F[i - s2] + F[i + s2];
          const target = sum / (6 + absorb[st[i]]);
          // over-relaxation can overshoot below 0 when uptake is strong (short L, high omega)
          // the real answer can't be negative tho so clamping it at 0 ("projected SOR") is fine
          const v = F[i] + omega * (target - F[i]);
          F[i] = v > 0 ? v : 0;
        }
      }
    }
  }

  /** biggest equation error anywhere in the sphere, scaled by the boundary value (0 = exact) */
  residual() {
    const { F, absorb } = this;
    const st = this.grid.state, s = this.grid.size, s2 = this.grid.size2;
    let worst = 0;
    for (const i of this.grid.domain) {
      const sum = F[i - 1] + F[i + 1] + F[i - s] + F[i + s] + F[i - s2] + F[i + s2];
      const r = Math.abs(sum - (6 + absorb[st[i]]) * F[i]);
      if (r > worst) worst = r;
    }
    return worst / Math.max(1e-12, Math.abs(this.boundaryValue) || 1);
  }

  /** keep sweeping until the error is under tol */
  solveToTolerance(tol = 1e-5, maxSweeps = 1000, checkEvery = 10) {
    let done = 0;
    while (done < maxSweeps) {
      this.sweep(checkEvery);
      done += checkEvery;
      if (this.residual() < tol) break;
    }
    return done;
  }

  /** the update we run every step in the main loop, just a few sweeps starting from last step
   *  5 sweeps at omega = 1.7 keeps the error on living cells around 0.01 at normal growth speed (see stability-check) */
  step(sweeps = 5) { this.sweep(sweeps); }

  /** call this after a big sudden change (radiation dose, a bunch of cells dying, loading a snapshot) */
  refresh(tol = 1e-4, maxSweeps = 150) { return this.solveToTolerance(tol, maxSweeps, 10); }

  valueAt(i) { return this.F[i]; }

  /** average value at each distance r from the center (for plots + checking stuff) */
  radialProfile() {
    const g = this.grid, R = Math.ceil(g.radius) + 1;
    const sum = new Float64Array(R), cnt = new Int32Array(R);
    for (const i of g.domain) {
      const [x, y, z] = g.coords(i);
      const r = Math.round(g.distFromCenter(x, y, z));
      sum[r] += this.F[i]; cnt[r]++;
    }
    return Array.from(sum, (v, r) => (cnt[r] ? v / cnt[r] : NaN));
  }

  /** min / mean / max but only for sites that have living cells */
  livingStats() {
    const g = this.grid;
    let mn = Infinity, mx = -Infinity, s = 0, n = 0;
    for (const i of g.domain) if (g.isLiving(i)) {
      const v = this.F[i]; if (v < mn) mn = v; if (v > mx) mx = v; s += v; n++;
    }
    return n ? { min: mn, mean: s / n, max: mx, cells: n } : { min: NaN, mean: NaN, max: NaN, cells: 0 };
  }
}

/** oxygen field w/ our default settings (L = 3 cell diameters, 1 = vessel oxygen level) */
export function createOxygenField(grid, opts = {}) {
  return new DiffusionField(grid, { penetrationLength: 3, boundaryValue: 1, dormantUptake: 0.5, deadUptake: 0, ...opts });
}

// oxygen cutoffs the cell rules use (1 = level right by the capillaries, ~40 mm Hg in a real tumor)
export const O2_QUIESCENT = 0.25; // under this cells stop dividing (go DORMANT)
export const O2_NECROTIC = 0.05;  // under this cells die (go DEAD)
