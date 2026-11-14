// this grid builds a 3D lattice of cell sites for the tumor simulation.
// One site = approximately one cell diameter (~20 µm) according to what I found online (shown in the Citations page)
export const EMPTY = 0;    // no cell, this site is empty
export const ALIVE = 1;    
export const DORMANT = 2;  // living but not dividing (low oxygen or drug-tolerant)
export const DEAD = 3;     // debris (necrotic or killed)
export const STATE_NAMES = ["empty", "alive", "dormant", "dead"];
export const STATE_COLORS = ["#ffffff", "#00ff00", "#ffff00", "#ff0000"]; 
// ^^^ I'm not using those colors yet but this is a reminder that we will need to change these 
// to match the LEDs soon/eventually
export class CellGrid {
  /**
   * size = sites per side of the lattice
   * radius = radius of the spherical domain 
  */

  constructor(size = 44, radius = 20.5) { 
    //I'm unsure what the best default size would be. 
    // Maybe determine after getting the LEDs to work? 256? 80?? setting them smaller for now
    // for testing purposes, but we will need to change this later to match the LEDs in some way
    this.size = size;
    this.size2 = size * size;
    this.n = size * size * size;
    this.center = (size - 1) / 2;
    this.radius = radius;
    this.state = new Uint8Array(this.n);           // EMPTY / ALIVE / DORMANT / DEAD
    this.clone = new Int16Array(this.n).fill(-1);  // which clone (genotype lineage) lives here; -1 = none
    this.inside = new Uint8Array(this.n);          // 1 if the site is inside the spherical domain

    // list of all sites inside the domain (so we can can skip the empty corners 
    // of the cube when we iterate over our loops)
    const list = [];
    for (let z = 0; z < size; z++)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const i = this.index(x, y, z);
          if (this.distFromCenter(x, y, z) <= radius) { this.inside[i] = 1; list.push(i); }
        }
    this.domain = Int32Array.from(list);

    // neighbor offsets: 6 face neighbors (for diffusion purposes) and 26 (for division/movement)
    const s = size, s2 = this.size2;
    this.nb6 = Int32Array.from([-1, 1, -s, s, -s2, s2]);
    const nb26 = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (dx || dy || dz) nb26.push(dx + dy * s + dz * s2);
    this.nb26 = Int32Array.from(nb26);

    // running counts of each state
    this.counts = new Int32Array(4);
    this.counts[EMPTY] = this.domain.length;
  }

  // coordinates system
  index(x, y, z) { return x + y * this.size + z * this.size2; }
  coords(i) {
    const x = i % this.size, y = Math.floor(i / this.size) % this.size, z = Math.floor(i / this.size2);
    return [x, y, z];
  }
  distFromCenter(x, y, z) {
    const c = this.center;
    return Math.hypot(x - c, y - c, z - c);
  }

  isInside(i) { return i >= 0 && i < this.n && this.inside[i] === 1; }
  isEmpty(i) { return this.inside[i] === 1 && this.state[i] === EMPTY; }
  isLiving(i) { const s = this.state[i]; return s === ALIVE || s === DORMANT; }

  setState(i, newState, cloneId) {
    if (!this.inside[i]) throw new Error(`site ${i} is outside the domain`);
    this.counts[this.state[i]]--;
    this.counts[newState]++;
    this.state[i] = newState;
    if (newState === EMPTY) this.clone[i] = -1;
    else if (cloneId !== undefined) this.clone[i] = cloneId;
  }

  /** Function to puut a new living cell if the site is empty **/
  placeCell(i, cloneId, state = ALIVE) {
    if (!this.isEmpty(i)) return false;
    this.setState(i, state, cloneId);
    return true;
  }

  /** CLEAR THE DEBRIS */
  clear(i) { if (this.state[i] !== EMPTY) this.setState(i, EMPTY); }

  /** Adds an option to move a cell from site i to empty site j */
  moveCell(i, j) {
    if (!this.isEmpty(j) || this.state[i] === EMPTY) return false;
    const st = this.state[i], cl = this.clone[i];
    this.setState(i, EMPTY);
    this.setState(j, st, cl);
    return true;
  }

  /**
   * Random empty neighbor among the 26 surrounding sites, or -1 if boxed in
   * @param {() => number} rand  this is just a random number generator returning anything between [0, 1)
   */
  randomEmptyNeighbor(i, rand = Math.random) {
    const start = Math.floor(rand() * 26);
    for (let k = 0; k < 26; k++) {
      const j = i + this.nb26[(start + k) % 26];
      if (this.isEmpty(j)) return j;
    }
    return -1;
  }

  /** Returns true if any of the 6 face neighbors is empty/outside (ie cell is on the surface). */
  isExposed(i) {
    for (let k = 0; k < 6; k++) {
      const j = i + this.nb6[k];
      if (!this.inside[j] || this.state[j] === EMPTY) return true;
    }
    return false;
  }

  // setup
  /** Fill a ball of radius r (in sites) around the center with living cells of one clone */
  seedTumor(r = 3, cloneId = 0) {
    let placed = 0;
    for (const i of this.domain) {
      const [x, y, z] = this.coords(i);
      if (this.distFromCenter(x, y, z) <= r && this.placeCell(i, cloneId)) placed++;
    }
    return placed;
  }

  reset() {
    this.state.fill(EMPTY);
    this.clone.fill(-1);
    this.counts.fill(0);
    this.counts[EMPTY] = this.domain.length;
  }

  // iteration
  /** Indices of all occupied sites -- every site minus empty */
  occupiedSites(out = new Int32Array(this.domain.length)) {
    let n = 0;
    for (const i of this.domain) if (this.state[i] !== EMPTY) out[n++] = i;
    return out.subarray(0, n);
  }

  /** this is the same thing as occupiedSites but I'm shuffling it, so cells act in random order each step. */
  shuffledOccupied(rand = Math.random, buffer) {
      const a = this.occupiedSites(buffer); // pass a reausable buffer to avoid making a new array every step
      const j = Math.floor(rand() * (k + 1));
      const t = a[k]; a[k] = a[j]; a[j] = t;
    }
    return a;
  }

  summary() {
    return { empty: this.counts[EMPTY], alive: this.counts[ALIVE], dormant: this.counts[DORMANT],
      dead: this.counts[DEAD], living: this.counts[ALIVE] + this.counts[DORMANT], sites: this.domain.length };
  }

  // snapshots for rewind --- working now? all tests passed idk man

  snapshot() {
    const D = this.domain.length, st = new Uint8Array(D), cl = new Int16Array(D);
    for (let k = 0; k < D; k++) { st[k] = this.state[this.domain[k]]; cl[k] = this.clone[this.domain[k]]; }
    return { state: st, clone: cl };
  }

  restore(snap) {
    this.counts.fill(0);
    for (let k = 0; k < this.domain.length; k++) {
      const i = this.domain[k];
      this.state[i] = snap.state[k];
      this.clone[i] = snap.clone[k];
      this.counts[snap.state[k]]++;
    }
  }
}

/** seeded random number generator (xorshift32) so runs can be reateatable */
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  const rng = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  rng.getState = () => s;
  rng.setState = (v) => { s = (v >>> 0) || 1; };
  return rng;
}

// once this is ready to test we can use the test-grid.mjs file to check it. node test-grid.mjs
// I think the snapshot/restore is not working yet, so we will need to come back to that later 
// but at least the skeleton for it is functioning for now
