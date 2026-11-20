// Opt-in microphone LEVEL monitor. Audio is analysed with an AnalyserNode and reduced to a dBFS number
// each frame. The stream is NOT connected to any output, recorder or network; samples are never kept.
import { MicAnalyzer, rmsToDb, medianFloor, MIC_CFG } from './micLogic.js';

export class MicMonitor {
  constructor() {
    this.analyzer = new MicAnalyzer();
    this.active = false; this.stream = null; this.ctx = null; this.node = null; this.src = null; this.buf = null;
    this.fakeT = 0; this.fakeDb = 0;
    this.floorSamples = [];
    this.last = { over: 0, level: 0, noise: 0, event: null, db: -100 };
  }

  async start(ctx) {
    if (this.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    this.ctx = ctx;
    this.src = ctx.createMediaStreamSource(this.stream);
    this.node = ctx.createAnalyser(); this.node.fftSize = 1024;
    this.src.connect(this.node);                 // analysis only: never connected to ctx.destination
    this.buf = new Float32Array(this.node.fftSize);
    this.analyzer.reset(); this.active = true;
  }

  stop() {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    try { this.src && this.src.disconnect(); } catch { /* ignore */ }
    this.stream = null; this.src = null; this.node = null; this.active = false;
    this.last = { over: 0, level: 0, noise: 0, event: null, db: -100 };
  }

  // Simulation key V / smoke test: pretend a loud sound happened.
  injectSpike(loudness = 0.9) { this.fakeT = 0.12; this.fakeDb = this.analyzer.floorDb + 20 + loudness * 20; }

  readDb() {
    if (this.fakeT > 0) return this.fakeDb;
    if (!this.active || !this.node) return null;
    this.node.getFloatTimeDomainData(this.buf);
    let sum = 0; for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return rmsToDb(Math.sqrt(sum / this.buf.length));
  }

  // Calibration helpers: learn the room noise floor.
  collectFloor() { const db = this.readDb(); if (db != null) this.floorSamples.push(db); return db; }
  finishFloor() { if (this.floorSamples.length) this.analyzer.setFloor(medianFloor(this.floorSamples)); this.floorSamples = []; return this.analyzer.floorDb; }

  update(dt) {
    this.fakeT = Math.max(0, this.fakeT - dt);
    const db = this.readDb();
    if (db == null) { this.last = { over: 0, level: 0, noise: 0, event: null, db: -100 }; this.analyzer.reset(); return this.last; }
    this.last = { ...this.analyzer.push(db, dt), db };
    return this.last;
  }

  get barFrac() { return Math.min(1, this.last.level / MIC_CFG.barRangeDb); }
  get thresholdFrac() { return MIC_CFG.spikeDb / MIC_CFG.barRangeDb; }
}
