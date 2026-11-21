// Scare director: schedules random jump scares and performs them. The scares are meant to make
// the player's real pulse jump, which then feeds the noise model. Game feature only.
import { lineOfSight } from './pathfind.js';

export const SCARES_ENABLED = true;           // code-level toggle (a settings option can drive this later)

export const SCARE_IDS = ['blackout', 'doorSlam', 'whisper', 'silhouette', 'crash', 'wallSlam', 'heartbeat', 'musicBox', 'crawler', 'dolls'];
export const SCARE_LABELS = {
  blackout: 'lights out', doorSlam: 'door slam', whisper: 'whisper', silhouette: 'figure in the doorway',
  crash: 'crash in another room', wallSlam: 'hand on the wall', heartbeat: 'heartbeat doubling', musicBox: 'music box', crawler: 'crawler', dolls: 'hanging dolls',
};

export class ScareDirector {
  // rnd: () => [0,1). minGap/maxGap in seconds. Hard rules: gap >= minGap, never the same scare twice in a row,
  // nothing during a chase/catch (plus a short grace period afterwards).
  constructor({ rnd = Math.random, enabled = SCARES_ENABLED, minGap = 45, maxGap = 120, grace = 3 } = {}) {
    Object.assign(this, { rnd, enabled, minGap, maxGap, grace });
    this.t = 0; this.last = null; this.history = []; this.graceLeft = 0;
    this.next = 15 + this.rnd() * 15;            // the first scare comes early so the player sees what the game does
  }

  intensity() { return Math.min(1, this.t / 600); }       // rises over a ten-minute run

  _gap() {
    const hi = Math.max(this.minGap + 10, this.maxGap - 45 * this.intensity());   // scares get more frequent
    return this.t + this.minGap + this.rnd() * (hi - this.minGap);
  }

  // Returns a scare id to perform now, or null.
  update(dt, { chase = false } = {}) {
    this.t += dt;
    if (!this.enabled) return null;
    if (chase) { this.graceLeft = this.grace; return null; }
    if (this.graceLeft > 0) { this.graceLeft -= dt; return null; }
    if (this.t < this.next) return null;
    const options = SCARE_IDS.filter((id) => id !== this.last);
    const id = options[Math.floor(this.rnd() * options.length)];
    this.history.push({ t: this.t, id, prev: this.last, prevNext: this.next });
    this.last = id; this.next = this._gap();
    return id;
  }

  // The scare could not be staged (e.g. no valid spot): undo it and try again shortly.
  failed() {
    const h = this.history.pop();
    if (h) { this.last = h.prev; this.next = this.t + 5; }
  }
}

const rnd = Math.random;
const pickOf = (a) => a[Math.floor(rnd() * a.length)];

// Perform one scare. ctx: { world, player, creature, audio, hud, bio, level }. Returns false if it could not be staged.
export function performScare(id, ctx) {
  const { world, player, creature, audio, hud, bio, level } = ctx;
  const T = level.TILE, px = player.tileX, py = player.tileY;
  switch (id) {
    case 'blackout':
      world.blackout(2.0); audio.zap(); bio.simSpike(10); return true;
    case 'doorSlam': {
      const doors = level.doors.filter((d) => !d.exit && Math.hypot(d.x - px, d.y - py) < 16);
      if (!doors.length) return false;
      doors.sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py));
      const d = doors[0];
      world.slamDoor(d); world.shake(0.25, 0.03); audio.slam(d.x * T, d.y * T); bio.simSpike(10); return true;
    }
    case 'whisper':
      audio.whisper(rnd() < 0.5 ? -1 : 1); bio.simSpike(8); return true;
    case 'silhouette': {
      const lx = -Math.sin(player.yaw), lz = -Math.cos(player.yaw), cands = [];
      for (let y = Math.max(1, Math.floor(py) - 9); y <= Math.min(level.H - 2, Math.ceil(py) + 9); y++) {
        for (let x = Math.max(1, Math.floor(px) - 9); x <= Math.min(level.W - 2, Math.ceil(px) + 9); x++) {
          if (level.solid[y][x]) continue;
          const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
          if (d < 4 || d > 9 || (dx * lx + dy * lz) / d < 0.5) continue;
          if (lineOfSight(level.solid, Math.round(px), Math.round(py), x, y)) cands.push({ x, y });
        }
      }
      if (!cands.length) return false;
      const c = pickOf(cands);
      world.showFake(c.x * T, c.y * T, 0.3, Math.atan2(px - c.x, py - c.y));
      audio.zap(); audio.thump(); bio.simSpike(14); return true;
    }
    case 'crash': {
      const rooms = level.rooms.filter((r) => { const d = Math.hypot(r.cx - px, r.cy - py); return d > 6 && d < 30; });
      if (!rooms.length) return false;
      const r = pickOf(rooms);
      audio.crash(r.cx * T, r.cy * T);
      creature.hearSound({ x: r.cx, y: r.cy, radius: 60, loud: false });     // a real sound event
      world.shake(0.15, 0.015); hud.msg('Something crashed in another room.', 2.5); bio.simSpike(8); return true;
    }
    case 'wallSlam':
      audio.thump(); world.shake(0.6, 0.07); hud.flash(); bio.simSpike(16); return true;
    case 'heartbeat':
      audio.doubleHeart(4); hud.pulseScreen(); bio.simSpike(12); return true;
    case 'musicBox': {
      const rooms = level.rooms.filter((r) => { const d = Math.hypot(r.cx - px, r.cy - py); return d > 4 && d < 22; });
      const r = rooms.length ? pickOf(rooms) : level.rooms[0];
      audio.musicBox(r.cx * T, r.cy * T); bio.simSpike(6); return true;
    }
    case 'crawler': {
      // appears suddenly right in front of the player (no crawling around), lunges a little, then vanishes
      const lx = -Math.sin(player.yaw), lz = -Math.cos(player.yaw), cands = [];
      for (let y = Math.max(1, Math.floor(py) - 3); y <= Math.min(level.H - 2, Math.ceil(py) + 3); y++) {
        for (let x = Math.max(1, Math.floor(px) - 3); x <= Math.min(level.W - 2, Math.ceil(px) + 3); x++) {
          if (level.solid[y][x]) continue;
          const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
          if (d < 1.5 || d > 2.8 || (dx * lx + dy * lz) / d < 0.85) continue;
          if (lineOfSight(level.solid, Math.round(px), Math.round(py), x, y)) cands.push({ x, y, d });
        }
      }
      if (!cands.length) return false;
      const c = pickOf(cands), dx = px - c.x, dy = py - c.y, run = Math.min(0.7, c.d - 1.0);
      const ex = c.x + (dx / c.d) * run, ey = c.y + (dy / c.d) * run;
      world.showCrawler(c.x * T, c.y * T, ex * T, ey * T, 0.9);
      audio.crawlerSkitter(c.x * T, c.y * T, ex * T, ey * T, 0.9); world.shake(0.2, 0.025); bio.simSpike(18); return true;
    }
    case 'dolls': {
      const lx = -Math.sin(player.yaw), lz = -Math.cos(player.yaw), cands = [];
      for (let y = Math.max(1, Math.floor(py) - 7); y <= Math.min(level.H - 2, Math.ceil(py) + 7); y++) {
        for (let x = Math.max(1, Math.floor(px) - 7); x <= Math.min(level.W - 2, Math.ceil(px) + 7); x++) {
          if (level.solid[y][x]) continue;
          const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
          if (d < 2.5 || d > 6 || (dx * lx + dy * lz) / d < 0.6) continue;
          if (lineOfSight(level.solid, Math.round(px), Math.round(py), x, y)) cands.push({ x, y });
        }
      }
      if (!cands.length) return false;
      const c = pickOf(cands);
      world.showDolls(c.x * T, c.y * T, Math.atan2(px - c.x, py - c.y), 4.5);
      audio.dollSound(c.x * T, c.y * T); world.shake(0.2, 0.02); bio.simSpike(18); return true;
    }
    default: return false;
  }
}
