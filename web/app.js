
import { createScene } from "./scene.js";
import { Simulation } from "../simulation.js";
import { REGIMENS, regimenTreatments } from "../schedules.js";
import { CANCER_TYPES } from "../cancers.js";
import { loadSurrogate, Surrogate } from "../surrogate/surrogate.js";
import { COLOR_MODES, BOTTLES, BOTTLE_OF, CELL_HEX } from "./cellcolors.js";
import { drawSizeChart } from "./chart.js";
import { wellnessOn } from "../sideeffects.js";
import { ConsoleLink, loadVials, saveVial, forgetVials } from "./consolelink.js";

const $ = (id) => document.getElementById(id);
const has = (id) => !!document.getElementById(id);
const params = new URLSearchParams(location.search);

let sim, view, playing = !params.has("paused"), stepsPerFrame = 1, prediction = null, predictionFor = null;
$("cancer").innerHTML = Object.entries(CANCER_TYPES).map(([id, c]) => `<option value="${id}">${c.name}</option>`).join("");
$("cancer").value = params.get("cancer") || "breast";
if (has("color")) {
  const keep = $("color").value;
  $("color").innerHTML = Object.entries(COLOR_MODES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $("color").value = COLOR_MODES[keep] ? keep : "resistance";
}
let surrogate = null, surrogateError = null;
const MODEL_URL = window.ONCOSPHERE_MODEL_URL || "../surrogate/out/surrogate_model.json";
(window.ONCOSPHERE_MODEL ? Promise.resolve(new Surrogate(window.ONCOSPHERE_MODEL)) : loadSurrogate(MODEL_URL))
  .then((m) => { surrogate = m; }).catch((e) => { surrogateError = e.message; console.warn(e); });
let sideEffects = [];
fetch(window.ONCOSPHERE_SIDE_EFFECTS_URL || "../treatment_side_effects.json")
  .then((r) => r.json()).then((j) => { sideEffects = j; }).catch((e) => console.warn("no side effect data", e));
if (window.ONCOSPHERE_SIDE_EFFECTS) sideEffects = window.ONCOSPHERE_SIDE_EFFECTS;

const currentPlan = () => sim.plans[sim.plans.length - 1] || null;
const planIdOf = (p) => p && Object.keys(REGIMENS).find((k) => REGIMENS[k] === p.regimen);
const doseScale = () => (has("dose") ? +$("dose").value : 1);

function newSim() {
  const cancer = $("cancer").value;
  const startingMutations = has("realstart") ? $("realstart").checked : false;
  sim = new Simulation({ seed: Math.floor(Math.random() * 1e6) + 1, cancer, snapshotEveryDays: 1, startingMutations });
  prediction = null; predictionFor = null;
  const keep = $("regimen").value;
  $("regimen").innerHTML = sim.availableRegimens().map((id) => `<option value="${id}">${REGIMENS[id].name}</option>`).join("");
  if (sim.availableRegimens().includes(keep)) $("regimen").value = keep;
  if (params.has("grow")) sim.growTo(+params.get("grow"));
  view?.drawCells(sim);
  updateHud();
}

function startTreatment(regimenId = $("regimen").value) {
  if (!sim.availableRegimens().includes(regimenId)) { toast(`${REGIMENS[regimenId]?.name ?? regimenId} isn't used for this cancer`); return; }
  if (sim.viewingPast) sim.branchHere();
  sim.stopAll();
  $("regimen").value = regimenId;
  sim.startPlan(regimenId, { doseScale: doseScale() });
  prediction = null; predictionFor = null;
  updateHud();
}

function startingTraits() {
  const g = sim.opts.founderGeno;
  if (!g) return "";
  const names = { 1: "fast-growing driver", 2: "low-oxygen survivor (TP53)", 4: "target escape", 16: "efflux pump", 64: "mutator", 128: "immune escape" };
  return "<br>started with: " + Object.entries(names).filter(([b]) => g & b).map(([, n]) => n).join(", ");
}

function updateHud() {
  const sm = sim.grid.summary();
  $("day").textContent = `day ${Math.floor(sim.day)}` + (sim.viewingPast ? ` (looking back, latest is ${sim.latestDay})` : "");
  $("counts").innerHTML = `${sm.living.toLocaleString()} living · ${sm.dormant.toLocaleString()} dormant · ${sm.dead.toLocaleString()} dead` +
    `<br>${sim.clones.livingClones()} clones · ${sim.killing.persisterCount} persisters` + startingTraits();
  updateTimeline();
  updateChart();
  updateWellness();
  const box = $("prediction");
  const plan = currentPlan(), planId = planIdOf(plan);
  if (!plan) { box.innerHTML = `<span class="muted">start a treatment to get a prediction</span>`; return; }
  const since = Math.floor(sim.day) - plan.startDay;
  if (since < 21) { box.innerHTML = `<span class="muted">prediction at day 21 of treatment (${21 - since} days to go)</span>`; return; }
  const key = `${planId}@${plan.startDay}`;
  if (predictionFor !== key && surrogate) { prediction = surrogate.predictFromSim(sim, plan, planId); predictionFor = key; }
  if (!prediction) { box.innerHTML = `<span class="muted">${surrogateError ? "surrogate model didn't load: " + surrogateError : "loading the surrogate model…"}</span>`; return; }
  const p = prediction.probs, d = prediction.day, [lo, hi] = d.intervals[0.8];
  box.innerHTML = `<b>${Math.round(p.takeover * 100)}%</b> chance resistance takes over by day 180<br>` +
    (p.takeover >= 0.05 ? `if it does: around day <b>${Math.round(d.p50)}</b> (80%: ${Math.round(lo)}–${Math.round(Math.min(hi, 180))})<br>` : "") +
    `<span class="muted">${Math.round(p.eradicated * 100)}% wiped out · ${Math.round(p.not_by_180 * 100)}% no takeover by 180</span>`;
}

function updateTimeline() {
  if (!has("timeline")) return;
  const t = $("timeline");
  t.max = String(sim.latestDay);
  if (document.activeElement !== t || !sim.viewingPast) t.value = String(Math.floor(sim.day));
  if (has("timeline-label")) $("timeline-label").textContent = `day ${Math.floor(sim.day)} of ${sim.latestDay}`;
}
function scrubTo(day) {
  setPlaying(false);
  sim.viewDay(Math.max(0, Math.min(sim.latestDay, Math.round(day))));
  view.drawCells(sim);
  updateHud();
}

function updateChart() {
  if (!has("chart")) return;
  const plan = currentPlan();
  drawSizeChart($("chart"), sim.viewingPast ? sim._live.history : sim.history,
    { treatDay: plan ? plan.startDay : null, nowDay: sim.viewingPast ? Math.floor(sim.day) : null });
}
function updateWellness() {
  if (!has("wellness")) return;
  const w = wellnessOn(sideEffects, sim.eventsLog, sim.day);
  if (!sim.eventsLog.length) { $("wellness").innerHTML = `<span class="muted">no treatment yet</span>`; return; }
  const rows = w.effects.slice(0, 6).map((e) =>
    `<tr><td>${e.effect}</td><td><meter min="0" max="1" value="${(e.level * e.chance).toFixed(2)}"></meter></td>` +
    `<td class="muted">${Math.round(e.chance * 100)}% get it</td></tr>`).join("");
  $("wellness").innerHTML =
    `feeling: <b>${w.wellness}/100</b> · white cells: <b>${Math.round(w.whiteCells * 100)}%</b> of normal` +
    (rows ? `<table>${rows}</table>` : `<p class="muted">nothing expected today</p>`) +
    (w.signs.length ? `<details><summary>call the care team if</summary>${w.signs.map((s) => `<p>${s.text}</p>`).join("")}</details>` : "") +
    `<p class="muted">rough timing from drug labels + Rayne's side effect data. a demo, not medical advice</p>`;
}

function setPlaying(on) {
  if (on && sim.viewingPast) sim.branchHere();
  playing = on;
  $("play").textContent = playing ? "Pause" : "Play";
  console_?.setRing(...(playing ? [0, 80, 40] : [60, 40, 0]));
}

let toastTimer = 0;
function toast(msg) {
  if (!has("toast")) { console.log(msg); return; }
  $("toast").textContent = msg; $("toast").hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3500);
}

newSim();
view = createScene($("view"), { radius: sim.grid.radius, center: (sim.grid.size - 1) / 2 });
view.drawCells(sim);

$("cancer").onchange = newSim;
$("reset").onclick = newSim;
$("play").onclick = () => setPlaying(!playing);
$("play").textContent = playing ? "Pause" : "Play";
$("speed").oninput = (e) => { stepsPerFrame = +e.target.value; };
$("treat").onclick = () => startTreatment();
$("rotate").onchange = (e) => view.setAutoRotate(e.target.checked);
const applyCut = () => { const c = $("cut"); view.setCutaway(c.type === "checkbox" ? c.checked : +c.value / 100); view.drawCells(sim); };
$("cut").oninput = $("cut").onchange = applyCut;
$("color").onchange = (e) => { view.setColorMode(e.target.value); view.drawCells(sim); };
$("dead").onchange = (e) => { view.setShowDead(e.target.checked); view.drawCells(sim); };
$("recenter").onclick = () => view.resetCamera();
if (has("timeline")) $("timeline").oninput = (e) => scrubTo(+e.target.value);
if (has("dose")) $("dose").oninput = () => { if (has("dose-label")) $("dose-label").textContent = `${Math.round(doseScale() * 100)}%`; };
if (has("realstart")) $("realstart").onchange = newSim;
if (params.has("cut")) { if ($("cut").type === "checkbox") $("cut").checked = true; else $("cut").value = "50"; applyCut(); }
view.setAutoRotate($("rotate").checked);

const SPEEDS = [0, 1, 2, 3, 4, 5, 6];
function nudgeDose(dir) { if (!has("dose")) return; const d = $("dose"); d.value = String(Math.min(+d.max, Math.max(+d.min, +d.value + dir * +d.step))); d.oninput(); toast(`dose ${Math.round(doseScale() * 100)}%`); }
function cycleColor() { const keys = Object.keys(COLOR_MODES), c = $("color"); c.value = keys[(keys.indexOf(c.value) + 1) % keys.length]; c.onchange({ target: c }); toast(`color: ${COLOR_MODES[c.value]}`); }
function stepCut() { const c = $("cut"); if (c.type === "checkbox") c.checked = !c.checked; else c.value = String((+c.value + 25) % 125); applyCut(); }
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input[type=text], input[type=email], textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === " ") { setPlaying(!playing); e.preventDefault(); }
  else if (k === "t" || k === "T") startTreatment();
  else if (k === "r" || k === "R") newSim();
  else if (k === "ArrowLeft") { scrubTo(Math.floor(sim.day) - (e.shiftKey ? 10 : 1)); e.preventDefault(); }
  else if (k === "ArrowRight") { scrubTo(Math.floor(sim.day) + (e.shiftKey ? 10 : 1)); e.preventDefault(); }
  else if (k === "ArrowUp") { nudgeDose(1); e.preventDefault(); }
  else if (k === "ArrowDown") { nudgeDose(-1); e.preventDefault(); }
  else if (k === "[" || k === "]") { const s = $("speed"); s.value = String(SPEEDS[Math.max(0, Math.min(6, +s.value + (k === "]" ? 1 : -1)))]); s.oninput({ target: s }); toast(`speed ${s.value}`); }
  else if (k === "c" || k === "C") cycleColor();
  else if (k === "x" || k === "X") stepCut();
  else if (k === "d" || k === "D") { const d = $("dead"); d.checked = !d.checked; d.onchange({ target: d }); }
  else if (/^[1-8]$/.test(k)) pickBottle(BOTTLES[+k - 1].treatment);
  else return;
});

let console_ = null;
if (has("console-connect")) {
  console_ = new ConsoleLink({
    onStatus: (m) => { if (has("console-status")) $("console-status").textContent = m; },
    onMessage: handleConsole,
  });
  if (!ConsoleLink.supported()) { $("console-connect").disabled = true; $("console-status").textContent = "needs Chrome or Edge (Web Serial). keyboard works though"; }
  $("console-connect").onclick = async () => {
    try { if (console_.connected) await console_.disconnect(); else await console_.connect(); }
    catch (e) { $("console-status").textContent = e.name === "NotFoundError" ? "no port picked" : "couldn't connect: " + e.message; }
    $("console-connect").textContent = console_.connected ? "Disconnect console" : "Connect console";
  };
  if (has("vials-forget")) $("vials-forget").onclick = () => { forgetVials(); toast("forgot all vials"); };
  setTimeout(() => console_.autoConnect([]).then((ok) => {
    if (ok) $("console-connect").textContent = "Disconnect console";
  }), 1500);
}
function regimenFor(treatment) {
  const list = sim.availableRegimens().filter((id) => regimenTreatments(REGIMENS[id]).includes(treatment));
  return list.find((id) => regimenTreatments(REGIMENS[id]).length === 1) || list[0] || null;
}
const hexToRgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
function pickBottle(treatment) {
  const b = BOTTLE_OF[treatment], id = regimenFor(treatment);
  if (!id) { toast(`${b.color} bottle (${b.name}) isn't used for ${CANCER_TYPES[sim.opts.cancer].name}`); console_?.setRing(120, 0, 0); return; }
  $("regimen").value = id;
  toast(`${b.color} bottle: ${REGIMENS[id].name}. press TREAT to start`);
  console_?.setRing(...hexToRgb(b.hex).map((v) => v * 0.5));
}
function handleConsole(msg) {
  if (msg.type === "tag") {
    const vials = loadVials();
    let t = vials[msg.uid];
    if (t && !BOTTLE_OF[t]) t = null;
    if (!t) {
      t = has("vial-assign") ? $("vial-assign").value : BOTTLES.find((b) => !Object.values(vials).includes(b.treatment))?.treatment;
      if (!t) { toast(`unknown bottle ${msg.uid}`); return; }
      saveVial(msg.uid, t);
      toast(`new bottle ${msg.uid} linked to ${BOTTLE_OF[t].color} (${BOTTLE_OF[t].name})`);
    }
    pickBottle(t);
  } else if (msg.type === "dose") nudgeDose(Math.sign(msg.delta));
  else if (msg.type === "time") scrubTo(Math.floor(sim.day) + msg.delta);
  else if (msg.type === "button") {
    if (msg.button === "PLAY") setPlaying(!playing);
    else if (msg.button === "TREAT") startTreatment();
    else if (msg.button === "RESET") newSim();
    else if (msg.button === "MODE") cycleColor();
    else if (msg.button === "DOSE") { if (has("dose")) { $("dose").value = "1"; $("dose").oninput(); toast("dose back to 100%"); } }
    else if (msg.button === "TIME") scrubTo(sim.latestDay);
  }
}

if (has("legend")) $("legend").innerHTML =
  `<b>resistant to…</b>` + BOTTLES.map((b, k) => `<span title="key ${k + 1} · ${b.why}"><i style="background:${b.hex}"></i>${b.name}</span>`).join("") +
  `<b>not resistant</b>` + [["sensitive", "dividing"], ["dormant", "resting (low O₂)"], ["persister", "persister"], ["doomed", "radiation-doomed"], ["dead", "dead"]]
    .map(([k, n]) => `<span><i style="background:${CELL_HEX[k]}"></i>${n}</span>`).join("");
if (has("bottles")) $("bottles").innerHTML = BOTTLES.map((b, k) =>
  `<button class="bottle" data-t="${b.treatment}" title="${b.why}"><i style="background:${b.hex}"></i><b>${k + 1}</b> ${b.color} · ${b.name}</button>`).join("");
document.querySelectorAll("#bottles .bottle").forEach((el) => el.onclick = () => pickBottle(el.dataset.t));
if (has("vial-assign")) $("vial-assign").innerHTML = BOTTLES.map((b) => `<option value="${b.treatment}">${b.color} (${b.name})</option>`).join("");

let lastHud = 0;
view.onFrame(() => {
  if (playing && stepsPerFrame > 0) {
    if (sim.viewingPast) sim.branchHere();
    for (let k = 0; k < stepsPerFrame; k++) sim.stepOnce();
    view.drawCells(sim);
  }
  const now = performance.now();
  if (now - lastHud > 200) { updateHud(); lastHud = now; }
});
window.__oncosphere = { get sim() { return sim; }, view, get surrogate() { return surrogate; },
  console: console_, handleConsole, startTreatment, scrubTo, pickBottle, regimenFor };
document.body.dataset.ready = "1";
