// talks to the Arduino over USB using the browser's Web Serial API

export const BAUD = 1000000;   // NOTE NOTE NOTE THIS IS AN IMPORTANT NOTE this must match BAUD in the .ino. if frames glitch, drop both to 500000

export class LedLink {
  constructor() {
    this.port = null; this.writer = null; this.reader = null;
    this.panels = 0;           
    this.ready = false; this.sending = false;
    this.lastSend = 0; this.frames = 0; this.fps = 0; this._fpsT = performance.now();
    this.onStatus = () => {};
  }

  static get supported() { return typeof navigator !== "undefined" && "serial" in navigator; }
  get connected() { return !!this.writer; }

  async connect(baud = BAUD) {
    this.port = await navigator.serial.requestPort();          // browser pops up a "pick a device" list
    await this.port.open({ baudRate: baud, bufferSize: 16384 });
    this.writer = this.port.writable.getWriter();
    this.onStatus("connected - waiting for the Arduino to restart (~2 s)…");
    this._readLoop();
  }

  async _readLoop() {
    this.reader = this.port.readable.getReader();
    let wantCount = false;
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        for (const b of value) {
          if (wantCount) {
            wantCount = false;
            if (b >= 1 && b <= 8) {
              if (b !== this.panels) { this.panels = b; this.onStatus(`Arduino ready: ${b} panel${b > 1 ? "s" : ""}`); }
              this.ready = true;
            }
          } else if (b === 82) wantCount = true;               // 'R'
        }
      }
    } catch (e) {
      this.onStatus("connection lost: " + e.message);
    } finally {
      this.reader?.releaseLock();
    }
  }

  /** true when it's ok to send the next frame */
  canSend() {
    if (!this.writer || !this.panels || this.sending) return false;
    return this.ready || performance.now() - this.lastSend > 1000;   // if an 'R' got lost, try again after 1 s
  }

  async send(bytes) {
    this.ready = false; this.sending = true; this.lastSend = performance.now();
    const msg = new Uint8Array(bytes.length + 2);
    msg[0] = 79; msg[1] = 83;                                   // 'O' 'S'
    msg.set(bytes, 2);
    try { await this.writer.write(msg); }
    catch (e) { this.onStatus("send failed: " + e.message); }
    finally { this.sending = false; }
    this.frames++;
    const now = performance.now();
    if (now - this._fpsT > 1000) { this.fps = (this.frames * 1000) / (now - this._fpsT); this.frames = 0; this._fpsT = now; }
  }

  async disconnect() {
    try { await this.reader?.cancel(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
    this.port = this.writer = this.reader = null; this.panels = 0; this.ready = false;
    this.onStatus("disconnected");
  }
}
