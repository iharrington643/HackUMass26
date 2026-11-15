(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const palette = { blue: "#3987e5", orange: "#d95926", aqua: "#1baf7a", magenta: "#d55181", yellow: "#c98500", violet: "#9085e9",
    cyan: "#00f0ff", grid: "rgba(255,255,255,0.06)", ink: "#e8ecf0", ink2: "#a3aab5", ink3: "#6b7380" };

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? "–" : (+v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));

  function niceTicks(min, max, n = 5) {
    const span = max - min || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function scale(dom, rng, log) {
    if (log) { const a = Math.log10(dom[0]), b = Math.log10(dom[1]); const f = (v) => rng[0] + ((Math.log10(Math.max(v, dom[0])) - a) / (b - a)) * (rng[1] - rng[0]); f.ticks = () => { const t = []; for (let p = Math.ceil(a); p <= Math.floor(b); p++) t.push(10 ** p); return t; }; return f; }
    const f = (v) => rng[0] + ((v - dom[0]) / (dom[1] - dom[0] || 1)) * (rng[1] - rng[0]); f.ticks = (n) => niceTicks(dom[0], dom[1], n); return f;
  }
  function setup(container, { width, height = 340, margin = {} } = {}) {
    const host = typeof container === "string" ? document.querySelector(container) : container;
    host.innerHTML = ""; host.classList.add("chart");
    width = width || Math.max(320, Math.round(host.clientWidth || host.parentElement?.clientWidth || 640));
    const m = { top: 14, right: 18, bottom: 42, left: 52, ...margin };
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" }, host);
    const defs = el("defs", {}, svg);
    const glow = el("filter", { id: "glow-" + Math.random().toString(36).slice(2), x: "-30%", y: "-30%", width: "160%", height: "160%" }, defs);
    el("feGaussianBlur", { stdDeviation: 2.4, result: "b" }, glow);
    const merge = el("feMerge", {}, glow); el("feMergeNode", { in: "b" }, merge); el("feMergeNode", { in: "SourceGraphic" }, merge);
    const tip = document.createElement("div"); tip.className = "chart-tip"; host.appendChild(tip);
    const showTip = (html, x, y) => {
      const r = svg.getBoundingClientRect(), k = r.width / width;
      tip.innerHTML = html; tip.style.left = x * k + "px"; tip.style.top = y * k + "px"; tip.classList.add("on");
    };
    const hideTip = () => tip.classList.remove("on");
    return { host, svg, defs, m, W: width, H: height, iw: width - m.left - m.right, ih: height - m.top - m.bottom, glowId: glow.id, showTip, hideTip };
  }
  const autoFmt = (ticks) => {
    const st = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
    const dec = Math.min(3, Math.max(...[st, ...ticks].map((v) => (String(+(+v).toFixed(6)).split(".")[1] || "").length)));
    return (v) => fmt(v, dec);
  };
  function axes(c, x, y, { xLabel, yLabel, xTicks, yTicks, xFmt, yFmt } = {}) {
    xTicks = xTicks || x.ticks(6); yTicks = yTicks || y.ticks(5);
    xFmt = xFmt || autoFmt(xTicks); yFmt = yFmt || autoFmt(yTicks);
    const g = el("g", { transform: `translate(${c.m.left},${c.m.top})` }, c.svg);
    const gy = el("g", { class: "axis" }, g);
    for (const t of yTicks) {
      const yy = y(t);
      el("line", { class: "gridline", x1: 0, x2: c.iw, y1: yy, y2: yy }, gy);
      el("text", { x: -8, y: yy, "text-anchor": "end", "dominant-baseline": "middle" }, gy).textContent = yFmt(t);
    }
    const gx = el("g", { class: "axis", transform: `translate(0,${c.ih})` }, g);
    el("line", { x1: 0, x2: c.iw, y1: 0, y2: 0 }, gx);
    for (const t of xTicks) {
      const xx = x(t);
      el("line", { x1: xx, x2: xx, y1: 0, y2: 4 }, gx);
      el("text", { x: xx, y: 16, "text-anchor": "middle" }, gx).textContent = xFmt(t);
    }
    if (xLabel) el("text", { class: "title-lbl", x: c.iw / 2, y: c.ih + 36, "text-anchor": "middle" }, g).textContent = xLabel;
    if (yLabel) el("text", { class: "title-lbl", transform: `translate(${-c.m.left + 13},${c.ih / 2}) rotate(-90)`, "text-anchor": "middle" }, g).textContent = yLabel;
    return g;
  }
  function legend(host, items) {
    const d = document.createElement("div"); d.className = "chart-legend";
    d.innerHTML = items.map((i) => `<span><i class="${i.dot ? "dot" : ""}" style="background:${i.color};${i.dash ? "background:repeating-linear-gradient(90deg," + i.color + " 0 4px,transparent 4px 7px)" : ""}"></i>${i.name}</span>`).join("");
    host.appendChild(d);
  }

  function line(container, o) {
    const c = setup(container, o);
    const all = o.series.flatMap((s) => [...s.pts, ...(s.band || []).flatMap(([x, l, h]) => [[x, l], [x, h]])]);
    const xd = o.x?.domain || [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
    const yd = o.y?.domain || [Math.min(0, ...all.map((p) => p[1])), Math.max(...all.map((p) => p[1])) * 1.05];
    const x = scale(xd, [0, c.iw], o.x?.log), y = scale(yd, [c.ih, 0], o.y?.log);
    const g = axes(c, x, y, { xLabel: o.x?.label, yLabel: o.y?.label, xTicks: o.x?.ticks, yTicks: o.y?.log ? y.ticks() : o.y?.ticks, xFmt: o.x?.fmt, yFmt: o.y?.fmt });
    for (const r of o.refs || []) {
      if (r.diag) el("line", { x1: x(xd[0]), y1: y(xd[0]), x2: x(xd[1]), y2: y(xd[1]), stroke: palette.ink3, "stroke-dasharray": "4 4" }, g);
      if (r.y != null) { el("line", { x1: 0, x2: c.iw, y1: y(r.y), y2: y(r.y), stroke: r.color || palette.ink3, "stroke-dasharray": "4 4" }, g); if (r.label) el("text", { class: "lbl", x: c.iw - 4, y: y(r.y) - 6, "text-anchor": "end" }, g).textContent = r.label; }
      if (r.x != null) { el("line", { y1: 0, y2: c.ih, x1: x(r.x), x2: x(r.x), stroke: r.color || palette.ink3, "stroke-dasharray": "4 4" }, g); if (r.label) el("text", { class: "lbl", x: x(r.x) + 5, y: 10 }, g).textContent = r.label; }
    }
    for (const s of o.series) if (s.band) {
      const top = s.band.map(([xx, , h]) => `${x(xx)},${y(h)}`), bot = s.band.slice().reverse().map(([xx, l]) => `${x(xx)},${y(l)}`);
      el("polygon", { points: [...top, ...bot].join(" "), fill: s.color, opacity: s.bandOpacity ?? 0.16 }, g);
    }
    for (const s of o.series) {
      if (!s.pts.length) continue;
      let d = "";
      s.pts.forEach(([xx, yy], i) => {
        if (s.step && i) d += `H${x(xx)}V${y(yy)}`; else d += (i ? "L" : "M") + x(xx) + "," + y(yy);
      });
      const path = el("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width || 2, "stroke-dasharray": s.dash ? "5 5" : null, filter: s.glow === false ? null : `url(#${c.glowId})`, "stroke-linejoin": "round" }, g);
      if (o.animate !== false && path.getTotalLength) { const L = path.getTotalLength(); path.style.strokeDasharray = s.dash ? "5 5" : L; if (!s.dash) { path.style.strokeDashoffset = L; path.getBoundingClientRect(); path.style.transition = "stroke-dashoffset 1.6s cubic-bezier(.22,1,.36,1)"; requestAnimationFrame(() => (path.style.strokeDashoffset = 0)); } }
      if (s.markers) for (const [xx, yy] of s.pts) el("circle", { cx: x(xx), cy: y(yy), r: 5, fill: s.color, stroke: "#07090c", "stroke-width": 2 }, g);
      if (o.directLabels && s.name) { const [lx, ly] = s.pts[s.pts.length - 1]; el("text", { class: "direct", x: x(lx) + 6, y: y(ly), fill: s.color, "dominant-baseline": "middle" }, g).textContent = s.name; }
    }
    const cross = el("line", { y1: 0, y2: c.ih, stroke: palette.cyan, "stroke-opacity": 0.5, visibility: "hidden" }, g);
    const dots = o.series.map((s) => el("circle", { r: 4.5, fill: s.color, stroke: "#07090c", "stroke-width": 2, visibility: "hidden" }, g));
    const hit = el("rect", { class: "hover-hit", width: c.iw, height: c.ih }, g);
    const xs = [...new Set(o.series.flatMap((s) => s.pts.map((p) => p[0])))].sort((a, b) => a - b);
    hit.addEventListener("mousemove", (e) => {
      const r = c.svg.getBoundingClientRect(), mx = ((e.clientX - r.left) / r.width) * c.W - c.m.left;
      let best = xs[0]; for (const v of xs) if (Math.abs(x(v) - mx) < Math.abs(x(best) - mx)) best = v;
      cross.setAttribute("x1", x(best)); cross.setAttribute("x2", x(best)); cross.setAttribute("visibility", "visible");
      const rows = [];
      o.series.forEach((s, i) => {
        const p = s.pts.find((q) => q[0] === best);
        if (!p) { dots[i].setAttribute("visibility", "hidden"); return; }
        dots[i].setAttribute("cx", x(p[0])); dots[i].setAttribute("cy", y(p[1])); dots[i].setAttribute("visibility", "visible");
        const b = s.band?.find((q) => q[0] === best);
        rows.push(`<span style="color:${s.color}">●</span> ${s.name || ""} <b>${(o.y?.tipFmt || ((v) => fmt(v, 2)))(p[1])}</b>${b ? ` <span style="color:#6b7380">(${fmt(b[1], 2)}–${fmt(b[2], 2)})</span>` : ""}`);
      });
      const minY = Math.min(...o.series.map((s) => { const p = s.pts.find((q) => q[0] === best); return p ? y(p[1]) : c.ih; }));
      c.showTip(`${(o.x?.tipFmt || ((v) => (o.x?.label ? o.x.label.split(" (")[0] + " " : "") + fmt(v, 2)))(best)}<br>${rows.join("<br>")}`, x(best) + c.m.left, minY + c.m.top);
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); c.hideTip(); });
    if (o.legend !== false && o.series.filter((s) => s.name).length > 1) legend(c.host, o.series.filter((s) => s.name).map((s) => ({ name: s.name, color: s.color, dash: s.dash })));
    return c;
  }

  function scatterIntervals(container, o) {
    const c = setup(container, { height: 420, ...o });
    const x = scale([0, 185], [0, c.iw]), y = scale([0, 185], [c.ih, 0]);
    const g = axes(c, x, y, { xLabel: o.xLabel, yLabel: o.yLabel, xTicks: [0, 25, 50, 75, 100, 125, 150, 175], yTicks: [0, 25, 50, 75, 100, 125, 150, 175] });
    el("line", { x1: x(0), y1: y(0), x2: x(185), y2: y(185), stroke: palette.ink3, "stroke-dasharray": "4 4" }, g);
    el("text", { class: "lbl", x: x(150), y: y(158), transform: `rotate(-45 ${x(150)} ${y(158)})` }, g).textContent = "perfect";
    o.points.forEach((p, i) => {
      const inside = p.real >= p.lo && p.real <= p.hi;
      const gg = el("g", { style: `opacity:0;transition:opacity .5s ${i * 12}ms` }, g);
      el("line", { x1: x(p.pred), x2: x(p.pred), y1: y(p.lo), y2: y(p.hi), stroke: palette.blue, "stroke-opacity": 0.45, "stroke-width": 2 }, gg);
      const mk = inside
        ? el("circle", { cx: x(p.pred), cy: y(p.real), r: 4.5, fill: palette.blue, stroke: "#07090c", "stroke-width": 1.5 }, gg)
        : el("path", { d: `M${x(p.pred) - 5},${y(p.real) - 5}l10,10m0,-10l-10,10`, stroke: palette.orange, "stroke-width": 2.6 }, gg);
      const hit = el("circle", { cx: x(p.pred), cy: y(p.real), r: 9, fill: "transparent" }, gg);
      hit.addEventListener("mouseenter", () => c.showTip(`${p.cancer} · ${o.names?.[p.regimen] || p.regimen}<br>predicted <b>day ${Math.round(p.pred)}</b> (80%: ${Math.round(p.lo)}–${Math.round(p.hi)})<br>real <b>day ${p.real}</b> ${inside ? "✓ inside" : "✗ outside"}`, x(p.pred) + c.m.left, y(p.real) + c.m.top));
      hit.addEventListener("mouseleave", c.hideTip);
      requestAnimationFrame(() => (gg.style.opacity = 1));
      void mk;
    });
    legend(c.host, [{ name: "80% interval", color: palette.blue }, { name: "real day inside interval", color: palette.blue, dot: true }, { name: "real day outside (✗)", color: palette.orange, dot: true }]);
    return c;
  }

  const fitLeft = (container, want) => { const h = typeof container === "string" ? document.querySelector(container) : container; const w = h?.clientWidth || 640; return Math.round(Math.min(want, Math.max(96, w * 0.38))); };
  function barH(container, o) {
    const rowH = o.rowH || 28;
    const c = setup(container, { height: o.items.length * rowH + 56, ...o, margin: { left: fitLeft(container, o.left || 190), right: 60, ...(o.margin || {}) } });
    const lo = Math.min(0, ...o.items.map((i) => i.value - (i.sd || 0))), hi = Math.max(0, ...o.items.map((i) => i.value + (i.sd || 0)));
    const x = scale(o.domain || [lo, hi * 1.08 || 1], [0, c.iw]);
    const g = el("g", { transform: `translate(${c.m.left},${c.m.top})` }, c.svg);
    const gx = el("g", { class: "axis", transform: `translate(0,${c.ih})` }, g);
    for (const t of x.ticks(5)) { el("line", { class: "gridline", x1: x(t), x2: x(t), y1: -c.ih, y2: 0 }, gx); el("text", { x: x(t), y: 16, "text-anchor": "middle" }, gx).textContent = (o.fmt || fmt)(t); }
    if (o.xLabel) el("text", { class: "title-lbl", x: c.iw / 2, y: c.ih + 36, "text-anchor": "middle" }, g).textContent = o.xLabel;
    el("line", { x1: x(0), x2: x(0), y1: 0, y2: c.ih, stroke: palette.ink3 }, g);
    const bh = rowH * 0.58;
    o.items.forEach((it, i) => {
      const yy = i * rowH + (rowH - bh) / 2, x0 = x(Math.min(0, it.value)), w = Math.abs(x(it.value) - x(0));
      el("text", { class: "lbl", x: -10, y: yy + bh / 2, "text-anchor": "end", "dominant-baseline": "middle", style: "fill:#a3aab5;font-family:var(--font-body);font-size:11px" }, g).textContent = it.label;
      const bar = el("rect", { x: it.value < 0 ? x(0) : x0, y: yy, width: 0, height: bh, rx: 3, fill: it.color || palette.blue, filter: `url(#${c.glowId})` }, g);
      requestAnimationFrame(() => { bar.style.transition = `all 1s cubic-bezier(.22,1,.36,1) ${i * 40}ms`; bar.setAttribute("width", w); if (it.value < 0) bar.setAttribute("x", x(it.value)); });
      if (it.sd) el("line", { x1: x(it.value - it.sd), x2: x(it.value + it.sd), y1: yy + bh / 2, y2: yy + bh / 2, stroke: "#e8ecf0", "stroke-opacity": 0.5 }, g);
      const neg = it.value < 0, tight = neg && x(it.value) - (it.sd ? x(it.value) - x(it.value - it.sd) : 0) < 60;
      const lx = neg ? (tight ? x(it.value) + 8 : x(it.value - (it.sd || 0)) - 6) : x(it.value + (it.sd || 0)) + 6;
      el("text", { class: "lbl", x: lx, y: yy + bh / 2, "text-anchor": neg && !tight ? "end" : "start", "dominant-baseline": "middle", style: tight ? "fill:#fff" : null }, g).textContent = (o.valueFmt || fmt)(it.value);
      const hit = el("rect", { x: 0, y: i * rowH, width: c.iw, height: rowH, fill: "transparent" }, g);
      hit.addEventListener("mouseenter", () => c.showTip(`${it.label}<br><b>${(o.valueFmt || fmt)(it.value)}</b>${it.sd ? ` ± ${fmt(it.sd, 1)}` : ""}${it.note ? "<br>" + it.note : ""}`, x(it.value) + c.m.left, yy + c.m.top));
      hit.addEventListener("mouseleave", c.hideTip);
    });
    if (o.legend) legend(c.host, o.legend);
    return c;
  }

  function heatmap(container, o) {
    const hostEl = typeof container === "string" ? document.querySelector(container) : container;
    const avail = (hostEl.clientWidth || 640) - (o.left || 150) - 20;
    const cw = Math.max(44, Math.min(o.maxCellW || 150, avail / o.cols.length)), ch = o.cellH || 34;
    const c = setup(container, { width: (o.left || 150) + o.cols.length * cw + 20, height: (o.top || 60) + o.rows.length * ch + 10, margin: { left: o.left || 150, top: o.top || 60, right: 20, bottom: 10 } });
    const g = el("g", { transform: `translate(${c.m.left},${c.m.top})` }, c.svg);
    const vals = o.values.flat().filter((v) => v != null), lo = o.min ?? Math.min(...vals), hi = o.max ?? Math.max(...vals);
    const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
    const [a, b] = o.ramp.map(hex), mid = o.mid ? hex(o.mid) : null;
    const colorOf = (v) => {
      let t = (v - lo) / (hi - lo || 1); t = Math.max(0, Math.min(1, t));
      let rgb;
      if (mid) rgb = t < 0.5 ? a.map((x, k) => x + (mid[k] - x) * t * 2) : mid.map((x, k) => x + (b[k] - x) * (t - 0.5) * 2);
      else rgb = a.map((x, k) => x + (b[k] - x) * t);
      return { fill: `rgb(${rgb.map(Math.round).join(",")})`, light: rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11 > 140 };
    };
    o.cols.forEach((cl, j) => el("text", { class: "lbl", x: j * cw + cw / 2, y: -10, "text-anchor": "start", transform: `rotate(-35 ${j * cw + cw / 2} -10)` }, g).textContent = cl);
    o.rows.forEach((rw, i) => {
      el("text", { class: "lbl", x: -10, y: i * ch + ch / 2, "text-anchor": "end", "dominant-baseline": "middle", style: "fill:#a3aab5;font-family:var(--font-body);font-size:11px" }, g).textContent = rw;
      o.cols.forEach((cl, j) => {
        const v = o.values[i][j];
        const col = v == null ? { fill: "#11161d", light: false } : colorOf(v);
        const r = el("rect", { x: j * cw + 1, y: i * ch + 1, width: cw - 2, height: ch - 2, rx: 3, fill: col.fill, opacity: 0 }, g);
        requestAnimationFrame(() => { r.style.transition = `opacity .6s ${(i + j) * 25}ms`; r.setAttribute("opacity", 1); });
        if (v != null) el("text", { x: j * cw + cw / 2, y: i * ch + ch / 2, "text-anchor": "middle", "dominant-baseline": "middle", style: `font-family:var(--font-mono);font-size:10.5px;fill:${col.light ? "#07090c" : "#e8ecf0"};pointer-events:none` }, g).textContent = (o.fmt || fmt)(v);
        r.addEventListener("mouseenter", () => { r.setAttribute("stroke", palette.cyan); c.showTip(`${rw} · ${cl}<br><b>${v == null ? "n/a" : (o.tipFmt || o.fmt || fmt)(v)}</b>`, j * cw + cw / 2 + c.m.left, i * ch + c.m.top); });
        r.addEventListener("mouseleave", () => { r.removeAttribute("stroke"); c.hideTip(); });
      });
    });
    return c;
  }

  function strips(container, o) {
    const rowH = 26;
    const c = setup(container, { height: o.rows.length * rowH + 60, ...o, margin: { left: fitLeft(container, o.left || 240), right: 90 } });
    const x = scale([0, 180], [0, c.iw]);
    const g = el("g", { transform: `translate(${c.m.left},${c.m.top})` }, c.svg);
    const gx = el("g", { class: "axis", transform: `translate(0,${c.ih})` }, g);
    for (const t of [0, 30, 60, 90, 120, 150, 180]) { el("line", { class: "gridline", x1: x(t), x2: x(t), y1: -c.ih, y2: 0 }, gx); el("text", { x: x(t), y: 16, "text-anchor": "middle" }, gx).textContent = t; }
    if (o.xLabel) el("text", { class: "title-lbl", x: c.iw / 2, y: c.ih + 36, "text-anchor": "middle" }, g).textContent = o.xLabel;
    let seed = 3; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    o.rows.forEach((r, i) => {
      const cy = i * rowH + rowH / 2;
      el("text", { class: "lbl", x: -10, y: cy, "text-anchor": "end", "dominant-baseline": "middle", style: "fill:#a3aab5;font-family:var(--font-body);font-size:11px" }, g).textContent = r.label;
      for (const d of r.days) el("circle", { cx: x(d), cy: cy + (rnd() - 0.5) * rowH * 0.5, r: 3, fill: r.color, opacity: 0.75 }, g);
      if (r.median != null) el("line", { x1: x(r.median), x2: x(r.median), y1: cy - rowH * 0.38, y2: cy + rowH * 0.38, stroke: "#fff", "stroke-width": 2.5 }, g);
      el("text", { class: "lbl", x: c.iw + 8, y: cy, "dominant-baseline": "middle" }, g).textContent = r.note || "";
      const hit = el("rect", { x: 0, y: i * rowH, width: c.iw, height: rowH, fill: "transparent" }, g);
      hit.addEventListener("mouseenter", () => c.showTip(`${r.label}<br>${r.tip || ""}`, (r.median != null ? x(r.median) : c.iw / 2) + c.m.left, cy + c.m.top - 6));
      hit.addEventListener("mouseleave", c.hideTip);
    });
    if (o.legend) legend(c.host, o.legend);
    return c;
  }

  window.OncoCharts = { line, scatterIntervals, barH, heatmap, strips, palette, fmt, legend };
})();
