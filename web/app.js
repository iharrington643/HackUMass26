// runs the sim live in the 3D scene, lets you start a treatment, and asks the surrogate
// model for a prediction once 21 days of treatment have gone by

import { createScene } from "./scene.js";
import { Simulation } from "../simulation.js";
import { REGIMENS } from "../schedules.js";
import { CANCER_TYPES } from "../cancers.js";
import { loadSurrogate, Surrogate } from "../surrogate/surrogate.js"; //this isn't working yet but once I finish writing the code I'll upload it so this file works too
import { LedLink, BAUD } from "./ledlink.js";
import { LED_DEFAULTS, buildFrame, buildTestFrame, drawPreview } from "./ledframe.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

let sim, view, plan = null, planId = null, playing = !params.has("paused"), stepsPerFrame = 1, prediction = null;
// choosing to fill the cancer list FIRST so that the page is usable even if something later is slow or broken
// because I ran into this a lot in testing
$("cancer").innerHTML = Object.entries(CANCER_TYPES).map(([id, c]) => `<option value="${id}">${c.name}</option>`).join("");
$("cancer").value = params.get("cancer") || "breast";
// the surrogate model loads in the background
let surrogate = null, surrogateError = null;
const MODEL_URL = window.ONCOSPHERE_MODEL_URL || "../surrogate/out/surrogate_model.json";
(window.ONCOSPHERE_MODEL ? Promise.resolve(new Surrogate(window.ONCOSPHERE_MODEL)) : loadSurrogate(MODEL_URL))
  .then((m) => { surrogate = m; }).catch((e) => { surrogateError = e.message; console.warn(e); });

function newSim() {
  const cancer = $("cancer").value;
  sim = new Simulation({ seed: Math.floor(Math.random() * 1e6) + 1, cancer, snapshotEveryDays: 1 });
  plan = null; planId = null; prediction = null;
  // fill the regimen dropdown with what this cancer is allowed / what Rayne found is applicable. some treatments won't work for certain cancers so that's why we're excluding some
  $("regimen").innerHTML = sim.availableRegimens().map((id) => `<option value="${id}">${REGIMENS[id].name}</option>`).join("");
  // ?grow=N lets you skip ahead
  if (params.has("grow")) sim.growTo(+params.get("grow"));
  view?.drawCells(sim);
  updateHud();
}

function updateHud() {
  const sm = sim.grid.summary();
  $("day").textContent = `day ${Math.floor(sim.day)}`;
  $("counts").innerHTML = `${sm.living.toLocaleString()} living · ${sm.dormant.toLocaleString()} dormant · ${sm.dead.toLocaleString()} dead` +
    `<br>${sim.clones.livingClones()} clones · ${sim.killing.persisterCount} persisters`;
  const box = $("prediction");
  if (!plan) { box.innerHTML = `<span class="muted">start a treatment to get a prediction</span>`; return; }
  const since = Math.floor(sim.day) - plan.startDay;
  if (since < 21) { box.innerHTML = `<span class="muted">prediction at day 21 of treatment (${21 - since} days to go)</span>`; return; }
  if (!prediction && surrogate) prediction = surrogate.predictFromSim(sim, plan, planId);
  if (!prediction) { box.innerHTML = `<span class="muted">${surrogateError ? "surrogate model didn't load: " + surrogateError : "loading the surrogate model…"}</span>`; return; }
  const p = prediction.probs, d = prediction.day, [lo, hi] = d.intervals[0.8];
  box.innerHTML = `<b>${Math.round(p.takeover * 100)}%</b> chance resistance takes over by day 180<br>` +
    (p.takeover >= 0.05 ? `if it does: around day <b>${Math.round(d.p50)}</b> (80%: ${Math.round(lo)}–${Math.round(Math.min(hi, 180))})<br>` : "") +
    `<span class="muted">${Math.round(p.eradicated * 100)}% wiped out · ${Math.round(p.not_by_180 * 100)}% no takeover by 180</span>`;
}

//  UI wiring
newSim();
view = createScene($("view"), { radius: sim.grid.radius, center: (sim.grid.size - 1) / 2 });
view.drawCells(sim);

$("cancer").onchange = newSim;
$("reset").onclick = newSim;
$("play").onclick = () => { playing = !playing; $("play").textContent = playing ? "Pause" : "Play"; };
$("play").textContent = playing ? "Pause" : "Play";
$("speed").oninput = (e) => { stepsPerFrame = +e.target.value; };
$("treat").onclick = () => {
  if (plan) sim.stopPlan(plan);
  planId = $("regimen").value; plan = sim.startPlan(planId); prediction = null;
  updateHud();
};
$("rotate").onchange = (e) => view.setAutoRotate(e.target.checked);
$("cut").onchange = (e) => { view.setCutaway(e.target.checked); view.drawCells(sim); };
$("color").onchange = (e) => { view.setColorMode(e.target.value); view.drawCells(sim); };
$("dead").onchange = (e) => { view.setShowDead(e.target.checked); view.drawCells(sim); };
$("recenter").onclick = () => view.resetCamera();
if (params.has("cut")) { $("cut").checked = true; view.setCutaway(true); view.drawCells(sim); }
view.setAutoRotate($("rotate").checked);

// ---- LED panels -------------------------------------------------------------------------------------------
// settings are remembered in this browser (try/catch because storage can be blocked)
const LED_KEY = "oncosphere-led-settings";
let ledCfg = { ...LED_DEFAULTS };
try { Object.assign(ledCfg, JSON.parse(localStorage.getItem(LED_KEY) || "{}")); } catch {}
const saveLed = () => { try { localStorage.setItem(LED_KEY, JSON.stringify(ledCfg)); } catch {} };
const led = new LedLink();
let ledTest = false;
led.onStatus = (msg) => {
  $("led-status").textContent = msg;
  if (led.panels) { ledCfg.panels = led.panels; $("led-panels").value = String(led.panels); }
  $("led-connect").textContent = led.connected ? "Disconnect" : "Connect LEDs";
};
if (!LedLink.supported) {
  $("led-connect").disabled = true;
  $("led-status").textContent = "needs Chrome or Edge (Web Serial). the preview still works";
}
// put saved settings into the controls, and controls back into settings
const ledInputs = { "led-panels": "panels", "led-mode": "mode", "led-zoom": "zoom", "led-rotate": "rotate",
  "led-serp": "serpentine", "led-cols": "columns", "led-fx": "flipX", "led-fy": "flipY", "led-bright": "brightness" };
for (const [id, key] of Object.entries(ledInputs)) {
  const el = $(id);
  if (el.type === "checkbox") el.checked = !!ledCfg[key]; else el.value = String(ledCfg[key]);
  el.oninput = el.onchange = () => {
    const v = el.type === "checkbox" ? el.checked : el.type === "range" || key === "panels" || key === "rotate" ? +el.value : el.value;
    if (key === "panels" && led.panels) { el.value = String(led.panels); return; }  
    ledCfg[key] = v; saveLed();
  };
}
$("led-test").onchange = (e) => { ledTest = e.target.checked; };
$("led-connect").onclick = async () => {
  try { if (led.connected) await led.disconnect(); else await led.connect(BAUD); }
  catch (e) { $("led-status").textContent = e.name === "NotFoundError" ? "no port picked" : "couldn't connect: " + e.message; }
  $("led-connect").textContent = led.connected ? "Disconnect" : "Connect LEDs";
};

let lastPreview = 0, lastFrame = null;
function updateLeds(now) {
  const sending = led.canSend();
  if (!sending && now - lastPreview < 100) return; // no Arduino waiting we have to refresh the preview 10x a second
  const cfg = { ...ledCfg, panels: led.panels || ledCfg.panels };
  lastFrame = ledTest ? buildTestFrame(cfg) : buildFrame(sim, cfg, $("color").value);
  if (now - lastPreview >= 100) { drawPreview($("led-preview"), lastFrame.preview, cfg.panels); lastPreview = now; }
  if (sending) led.send(lastFrame.bytes);
  if (led.connected && led.panels) $("led-fps").textContent = `${led.fps.toFixed(0)} frames/s to the panels`;
}

//  run the sim a few steps each frame
let lastHud = 0;
view.onFrame(() => {
  if (playing && stepsPerFrame > 0) {
    for (let k = 0; k < stepsPerFrame; k++) sim.stepOnce();
    view.drawCells(sim);
  }
  const now = performance.now();
  if (now - lastHud > 200) { updateHud(); lastHud = now; }  
  updateLeds(now);
});
window.__oncosphere = { get sim() { return sim; }, view, get surrogate() { return surrogate; }, led, get ledCfg() { return ledCfg; }, updateLeds };   // for poking around in the console
document.body.dataset.ready = "1";
