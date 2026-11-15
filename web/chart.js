
const BLUE = "#3987e5", ORANGE = "#d95926", GRID = "#1f2630", INK = "#a3aab5";

export function drawSizeChart(canvas, history, { treatDay = null, nowDay = null } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600, h = canvas.clientHeight || 160;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "11px system-ui, sans-serif";

  const L = 46, R = 10, T = 8, B = 22;
  const pw = w - L - R, ph = h - T - B;
  if (!history.length) return;
  const maxDay = Math.max(history[history.length - 1].day, 10);
  const maxN = Math.max(10, ...history.map((d) => d.living));
  const lmax = Math.log10(maxN * 1.2), lmin = 0;
  const x = (d) => L + (d / maxDay) * pw;
  const y = (n) => T + ph - ((Math.log10(Math.max(1, n)) - lmin) / (lmax - lmin)) * ph;

  ctx.strokeStyle = GRID; ctx.fillStyle = INK; ctx.lineWidth = 1;
  for (let p = 0; p <= Math.ceil(lmax); p++) {
    const yy = y(10 ** p);
    if (yy < T - 1) break;
    ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + pw, yy); ctx.stroke();
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText(p >= 3 ? `${10 ** (p - 3)}k` : String(10 ** p), L - 6, yy);
  }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  const stepD = maxDay > 200 ? 50 : maxDay > 80 ? 20 : 10;
  for (let d = 0; d <= maxDay; d += stepD) ctx.fillText(`day ${d}`, x(d), T + ph + 5);

  const line = (key, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    history.forEach((d, k) => { const px = x(d.day), py = y(d[key]); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
  };
  if (treatDay != null) {
    ctx.strokeStyle = "#8a8984"; ctx.setLineDash([4, 4]); ctx.beginPath();
    ctx.moveTo(x(treatDay), T); ctx.lineTo(x(treatDay), T + ph); ctx.stroke(); ctx.setLineDash([]);
  }
  line("living", BLUE);
  line("resistant", ORANGE);
  if (nowDay != null && nowDay < maxDay) {
    ctx.strokeStyle = "#00f0ff"; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(x(nowDay), T); ctx.lineTo(x(nowDay), T + ph); ctx.stroke();
  }
  const last = history[history.length - 1];
  ctx.textAlign = "right"; ctx.textBaseline = "bottom";
  ctx.fillStyle = BLUE; ctx.fillText("all living", L + pw, Math.max(T + 12, y(last.living) - 3));
  ctx.fillStyle = ORANGE; ctx.fillText("resistant", L + pw, Math.min(T + ph, Math.max(T + 24, y(Math.max(1, last.resistant)) - 3)));
}
