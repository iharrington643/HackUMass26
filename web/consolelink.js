
export const CONSOLE_BAUD = 115200;

export function parseLine(line) {
  const t = line.trim();
  if (!t) return null;
  const [cmd, ...rest] = t.split(/\s+/);
  switch (cmd.toUpperCase()) {
    case "HELLO": return { type: "hello", version: rest[1] ?? "?" };
    case "PONG": return { type: "pong" };
    case "TAG": return rest[0] ? { type: "tag", uid: rest[0].toUpperCase() } : null;
    case "TAG-": return { type: "untag" };
    case "DOSE": case "TIME": {
      const n = parseInt(rest[0], 10);
      return Number.isFinite(n) && n !== 0 ? { type: cmd.toLowerCase(), delta: n } : null;
    }
    case "BTN": {
      const b = (rest[0] || "").toUpperCase();
      return ["PLAY", "TREAT", "RESET", "MODE", "DOSE", "TIME"].includes(b) ? { type: "button", button: b } : null;
    }
    default: return null;
  }
}

export class ConsoleLink {
  constructor({ onMessage = () => {}, onStatus = () => {} } = {}) {
    this.onMessage = onMessage; this.onStatus = onStatus;
    this.port = null; this.writer = null; this.connected = false; this.helloSeen = false;
  }
  static supported() { return typeof navigator !== "undefined" && "serial" in navigator; }

  async connect() {
    const port = await navigator.serial.requestPort();
    await this._open(port);
  }

  async autoConnect(skip = []) {
    if (!ConsoleLink.supported()) return false;
    for (const port of await navigator.serial.getPorts()) {
      if (skip.includes(port) || port.readable) continue;
      try { await this._open(port); } catch { continue; }
      await new Promise((r) => setTimeout(r, 2500));
      if (this.helloSeen) return true;
      await this.disconnect();
    }
    return false;
  }

  async _open(port) {
    await port.open({ baudRate: CONSOLE_BAUD });
    this.port = port; this.connected = true; this.helloSeen = false;
    this.writer = port.writable.getWriter();
    this.onStatus("console connected, waiting for it to say hello...");
    this._readLoop();
  }

  async _readLoop() {
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (this.port?.readable) {
        const reader = this.port.readable.getReader();
        this.reader = reader;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const msg = parseLine(buf.slice(0, nl));
              buf = buf.slice(nl + 1);
              if (!msg) continue;
              if (msg.type === "hello") { this.helloSeen = true; this.onStatus(`console ready (v${msg.version})`); }
              this.onMessage(msg);
            }
          }
        } finally { reader.releaseLock(); }
      }
    } catch (e) {
      this.onStatus("console unplugged? " + e.message);
    }
    this.connected = false;
  }

  async send(line) {
    if (!this.writer) return;
    try { await this.writer.write(new TextEncoder().encode(line + "\n")); } catch {}
  }
  setRing(r, g, b) { return this.send(`LED ${r | 0} ${g | 0} ${b | 0}`); }

  async disconnect() {
    try { await this.reader?.cancel(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
    this.port = null; this.writer = null; this.connected = false;
  }
}

export const VIAL_DEFAULTS = {
};
const VIAL_KEY = "oncosphere-vials";

export function loadVials() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(VIAL_KEY) || "{}"); } catch {}
  return { ...VIAL_DEFAULTS, ...saved };
}
export function saveVial(uid, treatment) {
  const v = loadVials(); v[uid] = treatment;
  try { localStorage.setItem(VIAL_KEY, JSON.stringify(v)); } catch {}
  return v;
}
export function forgetVials() { try { localStorage.removeItem(VIAL_KEY); } catch {} }
