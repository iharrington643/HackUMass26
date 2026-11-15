(function () {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const stars = document.querySelector(".stars");
  if (stars) for (let i = 0; i < 110; i++) {
    const s = document.createElement("div");
    s.className = "star";
    s.style.left = Math.random() * 100 + "%";
    s.style.top = Math.random() * 100 + "%";
    s.style.animationDelay = Math.random() * 3 + "s";
    s.style.animationDuration = 2 + Math.random() * 3 + "s";
    stars.appendChild(s);
  }
  const parts = document.querySelector(".particles");
  if (parts && !reduce) {
    const cols = ["#00ff88", "#00f0ff", "#ff2fd6"];
    for (let i = 0; i < 40; i++) {
      const p = document.createElement("div");
      const c = cols[i % 3];
      p.className = "particle";
      p.style.left = Math.random() * 100 + "%";
      p.style.background = c;
      p.style.boxShadow = `0 0 10px ${c}`;
      p.style.animationDelay = -Math.random() * 15 + "s";
      p.style.animationDuration = 14 + Math.random() * 10 + "s";
      parts.appendChild(p);
    }
  }

  const ring = document.querySelector(".mouse-ring");
  if (ring && !reduce) {
    let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;
    addEventListener("mousemove", (e) => { mx = e.clientX; my = e.clientY; });
    document.addEventListener("mouseover", (e) => ring.classList.toggle("hot", !!e.target.closest("a, button, .tab, .c-btn, .c-dot, .rect, select, input")));
    (function loop() { rx += (mx - rx) * 0.15; ry += (my - ry) * 0.15; ring.style.left = rx + "px"; ring.style.top = ry + "px"; requestAnimationFrame(loop); })();
  }

  const layers = $$("[data-speed]");
  if (layers.length && !reduce) {
    let ticking = false;
    const update = () => {
      const y = scrollY;
      for (const l of layers) l.style.transform = `translate3d(0, ${y * +l.dataset.speed}px, 0)`;
      ticking = false;
    };
    addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  }

  const counters = (root) => $$("[data-count]", root).forEach((el) => {
    if (el.dataset.done) return;
    el.dataset.done = 1;
    const target = +el.dataset.count, dec = +(el.dataset.dec || 0), suf = el.dataset.suffix || "", pre = el.dataset.prefix || "";
    const fmt = (v) => pre + v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
    if (reduce) { el.textContent = fmt(target); return; }
    const t0 = performance.now(), dur = 1600;
    (function tick(t) {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(target * e);
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  });
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((ents) => ents.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("visible");
      counters(en.target);
      io.unobserve(en.target);
    }), { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    $$(".reveal, [data-count]").forEach((el) => io.observe(el));
    setTimeout(() => { $$(".reveal").forEach((el) => el.classList.add("visible")); counters(document); }, 4000);
  } else { $$(".reveal").forEach((el) => el.classList.add("visible")); counters(document); }

  $$(".carousel-wrap").forEach((wrap) => {
    const car = wrap.querySelector(".carousel"), cards = $$(".c-card", car), n = cards.length;
    const step = 360 / n, rad = Math.round((260 / 2) / Math.tan(Math.PI / n)) + 70;
    cards.forEach((c, i) => { c.style.transform = `rotateY(${i * step}deg) translateZ(${innerWidth < 768 ? rad * 0.65 : rad}px)`; });
    const dots = wrap.querySelector(".c-dots");
    let idx = 0, rot = 0;
    cards.forEach((_, i) => { const d = document.createElement("div"); d.className = "c-dot" + (i ? "" : " active"); d.onclick = () => go(i); dots.appendChild(d); });
    const go = (i) => { rot -= (i - idx) * step; idx = (i + n) % n; car.style.transform = `rotateY(${rot}deg)`; $$(".c-dot", dots).forEach((d, k) => d.classList.toggle("active", k === idx)); };
    wrap.querySelector(".c-prev").onclick = () => go(idx - 1);
    wrap.querySelector(".c-next").onclick = () => go(idx + 1);
    let sx = 0;
    car.addEventListener("touchstart", (e) => { sx = e.changedTouches[0].screenX; }, { passive: true });
    car.addEventListener("touchend", (e) => { const dx = e.changedTouches[0].screenX - sx; if (Math.abs(dx) > 50) go(idx + (dx < 0 ? 1 : -1)); });
    if (!reduce) { let timer = setInterval(() => go(idx + 1), 5000); wrap.addEventListener("mouseenter", () => clearInterval(timer)); }
  });

  $$(".tabs").forEach((tabs) => {
    const btns = $$(".tab", tabs), panels = $$(".tab-panel", tabs);
    btns.forEach((b) => b.addEventListener("click", () => {
      btns.forEach((x) => x.classList.toggle("active", x === b));
      panels.forEach((p) => p.classList.toggle("active", p.id === b.dataset.tab));
      document.dispatchEvent(new CustomEvent("tabchange", { detail: b.dataset.tab }));
    }));
  });

  if (!reduce) $$(".tilt, .rect").forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      el.style.transform = `perspective(700px) rotateX(${(y - r.height / 2) / 22}deg) rotateY(${(r.width / 2 - x) / 22}deg) scale(1.02)`;
    });
    el.addEventListener("mouseleave", () => { el.style.transform = ""; });
  });

  const ham = document.querySelector(".hamburger"), mnav = document.querySelector(".mobile-nav");
  if (ham && mnav) {
    ham.onclick = () => { ham.classList.toggle("open"); mnav.classList.toggle("open"); };
    $$("a", mnav).forEach((a) => a.addEventListener("click", () => { ham.classList.remove("open"); mnav.classList.remove("open"); }));
  }

  const clock = document.querySelector(".side-status .clock");
  if (clock) { const t0 = Date.now(); setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); clock.textContent = `T+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }, 1000); }

  $$(".term-body[data-lines]").forEach((body) => {
    const lines = JSON.parse(body.dataset.lines);
    const start = () => {
      body.innerHTML = "";
      let i = 0;
      const next = () => {
        if (i >= lines.length) { const c = document.createElement("div"); c.innerHTML = '<span class="p">$</span> <span class="term-cursor"></span>'; body.appendChild(c); setTimeout(start, 6000); return; }
        const [cls, text] = lines[i++];
        const d = document.createElement("div");
        d.innerHTML = `<span class="${cls}"></span>`;
        body.appendChild(d);
        while (body.children.length > 12) body.removeChild(body.firstChild);
        const span = d.firstChild;
        if (reduce || cls !== "p") { span.textContent = text; setTimeout(next, cls === "p" ? 400 : 220); return; }
        let k = 0;
        (function type() { span.textContent = text.slice(0, ++k); if (k < text.length) setTimeout(type, 18); else setTimeout(next, 350); })();
      };
      next();
    };
    if ("IntersectionObserver" in window) {
      const o = new IntersectionObserver((e) => { if (e[0].isIntersecting) { start(); o.disconnect(); } });
      o.observe(body);
    } else start();
  });
})();
