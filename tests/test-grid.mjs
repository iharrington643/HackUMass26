// Run with:  node test-grid.mjs
import assert from "node:assert/strict";
import { CellGrid, EMPTY, ALIVE, DORMANT, DEAD, makeRng } from "./grid.js";

const g = new CellGrid(44, 20.5);
const rand = makeRng(42);

// Test 1. domain is a sphere
assert.equal(g.inside[g.index(0, 0, 0)], 0, "corner should be outside");
assert.equal(g.inside[g.index(22, 22, 22)], 1, "center should be inside");
console.log("domain sites:", g.domain.length, "(sphere of radius 20.5 ≈", Math.round(4 / 3 * Math.PI * 20.5 ** 3), ")");

// Test 2. neighbor sites of every domain site stay inside the array
for (const i of g.domain) for (const o of g.nb26) assert.ok(i + o >= 0 && i + o < g.n);

// Test 3. seeding
const seeded = g.seedTumor(3, 0);
assert.equal(g.counts[ALIVE], seeded);
console.log("seeded cells:", seeded);

// Test 4. state changes keep counts correct
const c = g.index(22, 22, 22);
g.setState(c, DORMANT); assert.equal(g.state[c], DORMANT);
g.setState(c, DEAD);    assert.equal(g.counts[DEAD], 1);
g.clear(c);             assert.equal(g.state[c], EMPTY); assert.equal(g.clone[c], -1);
assert.ok(g.placeCell(c, 5)); assert.equal(g.clone[c], 5);
assert.equal(g.placeCell(c, 6), false, "can't place on an occupied site");

// Test 5. test growth loop
for (let step = 0; step < 15; step++) {
  for (const i of g.shuffledOccupied(rand)) {
    if (g.state[i] !== ALIVE) continue;
    const j = g.randomEmptyNeighbor(i, rand);
    if (j >= 0) g.placeCell(j, g.clone[i]);
  }
}
const s = g.summary();
const total = s.empty + s.alive + s.dormant + s.dead;
assert.equal(total, s.sites, "counts must add up to the number of sites");
let recount = 0; for (const i of g.domain) if (g.state[i] === ALIVE) recount++;
assert.equal(recount, s.alive, "running count matches a full recount");
console.log("after 15 growth steps:", s);

// Test 6. no cell ends up outside the sphere
for (let i = 0; i < g.n; i++) if (!g.inside[i]) assert.equal(g.state[i], EMPTY);

// Test 7. moving a cell
const occ = g.occupiedSites();
const from = occ.find((i) => g.randomEmptyNeighbor(i, rand) >= 0);
if (from !== undefined) {
  const to = g.randomEmptyNeighbor(from, rand), cl = g.clone[from];
  assert.ok(g.moveCell(from, to));
  assert.equal(g.state[from], EMPTY); assert.equal(g.clone[to], cl);
}

// Test 8 snapshot / restore round-trip
const snap = g.snapshot();
const before = g.summary();
g.reset(); assert.equal(g.summary().alive, 0);
g.restore(snap);
assert.deepEqual(g.summary(), before);
console.log("snapshot size:", snap.state.byteLength + snap.clone.byteLength, "bytes");

// 9. speed check -- this is for the miliseconds per step that we can expect in each simulation step for the great shuffle^TM 
let t = performance.now();
for (let k = 0; k < 100; k++) g.shuffledOccupied(rand);
console.log("shuffle all occupied sites:", ((performance.now() - t) / 100).toFixed(2), "ms per step");

console.log("\nAll grid tests passed :D");
