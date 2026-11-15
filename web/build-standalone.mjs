
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const result = await build({
  entryPoints: [here("./app.js")],
  bundle: true, format: "esm", minify: true, write: false, target: "es2020", legalComments: "none",
  alias: { three: here("./vendor/three.module.js") },
  plugins: [{
    name: "three-addons",
    setup(b) { b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: here("./vendor/" + a.path.slice("three/addons/".length)) })); },
  }],
});
const js = result.outputFiles[0].text;
const model = readFileSync(here("../surrogate/out/surrogate_model.json"), "utf8");
const sideEffects = readFileSync(here("../treatment_side_effects.json"), "utf8");
const css = readFileSync(here("./site.css"), "utf8");
const siteJs = readFileSync(here("./site.js"), "utf8");
const chartsJs = readFileSync(here("./charts.js"), "utf8");

const safe = (s) => s.replace(/<\/script/gi, "<\\/script");

let html = readFileSync(here("./simulator.html"), "utf8");
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, "");
html = html.replace("<title>", `<script>window.ONCOSPHERE_STANDALONE = true;</script>\n<title>`);
html = html.replace('<link rel="stylesheet" href="site.css">', () => `<style>${css}</style>`);
html = html.replace('<script src="site.js"></script>', () => `<script>${safe(siteJs)}</script>`);
html = html.replace('<script src="charts.js"></script>', () => `<script>${safe(chartsJs)}</script>`);
html = html.replace(/href="(index|science|model|impact|research)\.html"/g, 'href="https://oncosphere.health/web/$1.html"');
html = html.replace('<script type="module" src="./app.js"></script>',
  () => `<script>window.ONCOSPHERE_MODEL = ${safe(model)};\nwindow.ONCOSPHERE_SIDE_EFFECTS = ${safe(sideEffects)};</script>\n<script type="module">${safe(js)}</script>`);
const out = here("./oncosphere-standalone.html");
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1e6).toFixed(1)} MB: app ${(js.length / 1e6).toFixed(2)} MB + model ${(model.length / 1e6).toFixed(2)} MB)`);
