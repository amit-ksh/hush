// DOM HUD helpers.
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.wave = $('wave').getContext('2d');
    this.samples = new Array(190).fill(19);
    this.phase = 0; this.acc = 0; this.msgTimer = 0;
  }
  show(on) { $('hud').classList.toggle('show', on); }
  setMode(live) { const m = $('mode'); m.textContent = live ? 'LIVE' : 'SIMULATED'; m.className = live ? 'live' : 'sim'; $('cam').style.display = live ? 'block' : 'none'; $('simbox').style.display = live ? 'none' : 'flex'; }
  setSeed(s) { $('seed').textContent = s; }
  setRoom(n) { $('room').textContent = n; }
  setKey(have) { $('keyIcon').classList.toggle('have', have); $('keytxt').textContent = have ? 'key: found' : 'key: not found'; }
  setStream(stream) { $('cam').srcObject = stream; $('calibCam').srcObject = stream; if (stream) { $('cam').play().catch(() => {}); $('calibCam').play().catch(() => {}); } }
  mic(on, frac, thr) {
    $('micWrap').style.display = on ? 'block' : 'none';
    $('micFill').style.width = `${frac * 100}%`; $('micThr').style.left = `${thr * 100}%`;
  }
  heardCue(t) { const e = $('heard'); e.textContent = t; e.style.opacity = 1; clearTimeout(this._ht); this._ht = setTimeout(() => { e.style.opacity = 0; }, 1400); }
  flash() { const e = $('flashFx'); e.style.transition = 'none'; e.style.opacity = 0.85; requestAnimationFrame(() => { e.style.transition = 'opacity .5s'; e.style.opacity = 0; }); }
  pulseScreen() { const e = $('pulseFx'); e.classList.remove('go'); void e.offsetWidth; e.classList.add('go'); }
  prompt(t) { $('prompt').textContent = t || ''; }
  hint(t) { $('hint').textContent = t || ''; }
  msg(t, secs = 2.5) { const m = $('msg'); m.textContent = t; m.style.opacity = 1; this.msgTimer = secs; }

  update(dt, bio, noise) {
    $('bpm').textContent = bio.bpm > 0 ? Math.round(bio.bpm) : '--';
    $('br').textContent = bio.br > 0 ? Math.round(bio.br) : '--';
    $('noiseFill').style.width = `${noise}%`;
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) $('msg').style.opacity = 0; }
    // heartbeat trace, synthesised from the current BPM (shape is illustrative)
    this.acc += dt;
    const bpm = bio.bpm > 0 ? bio.bpm : 0;
    while (this.acc > 1 / 60) {
      this.acc -= 1 / 60;
      this.phase = (this.phase + (bpm / 60) / 60) % 1;
      const p = this.phase; let y = 0;
      if (bpm > 0) {
        y = Math.exp(-Math.pow((p - 0.1) / 0.012, 2)) * 1 - Math.exp(-Math.pow((p - 0.075) / 0.01, 2)) * 0.25 - Math.exp(-Math.pow((p - 0.125) / 0.012, 2)) * 0.3 + Math.exp(-Math.pow((p - 0.3) / 0.04, 2)) * 0.25;
      }
      this.samples.push(19 - y * 16); this.samples.shift();
    }
    const c = this.wave; c.clearRect(0, 0, 190, 38);
    c.strokeStyle = bio.source === 'sim' ? '#e07a5f' : '#6fcf97'; c.lineWidth = 1.5; c.beginPath();
    this.samples.forEach((v, i) => (i ? c.lineTo(i, v) : c.moveTo(i, v))); c.stroke();
  }
}
