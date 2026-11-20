// Creature AI on the tile grid. States: WANDER -> INVESTIGATE -> HUNT -> CATCH.
import { astar, lineOfSight } from './pathfind.js';

export const S = { WANDER: 'WANDER', INVESTIGATE: 'INVESTIGATE', HUNT: 'HUNT', CATCH: 'CATCH' };

export class Creature {
  constructor(level, rnd) {
    this.level = level; this.rnd = rnd;
    // spawn in the room farthest from the player spawn
    let far = level.rooms[0];
    for (const r of level.rooms) if (level.dist[r.id] > level.dist[far.id]) far = r;
    this.x = far.cx; this.y = far.cy;
    this.state = S.WANDER;
    this.path = []; this.target = null;
    this.repath = 0; this.wait = 0; this.loseTimer = 0; this.hideHear = 0;
    this.heading = 0; this.speed = 0;
    this.stepAcc = 0;
    this.timesHunted = 0;
    this.lastKnown = null;
    this.onState = null; this.onStep = null;
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    if (s === S.HUNT) this.timesHunted++;
    if (this.onState) this.onState(s);
  }

  goTo(tx, ty) {
    const L = this.level;
    const p = astar(L.solid, L.W, L.H, Math.round(this.x), Math.round(this.y), tx, ty);
    this.path = p || []; this.target = p ? { x: tx, y: ty } : null;
    return !!p;
  }

  randomRoomTarget() {
    const L = this.level, r = L.rooms[Math.floor(this.rnd() * L.rooms.length)];
    return { x: r.cx - 1, y: r.cy };
  }

  fuzzy(px, py) {
    const L = this.level;
    for (let i = 0; i < 8; i++) {
      const x = Math.round(px + (this.rnd() - 0.5) * 8), y = Math.round(py + (this.rnd() - 0.5) * 8);
      if (x > 0 && y > 0 && x < L.W && y < L.H && !L.solid[y][x]) return { x, y };
    }
    return { x: Math.round(px), y: Math.round(py) };
  }

  // ctx: { px, py (tiles), hidden, hiddenProp, flashlight, noise (NoiseModel) }
  update(dt, ctx) {
    if (this.state === S.CATCH) return;
    const L = this.level;
    const dx = ctx.px - this.x, dy = ctx.py - this.y, dist = Math.hypot(dx, dy);
    const los = lineOfSight(L.solid, Math.round(this.x), Math.round(this.y), Math.round(ctx.px), Math.round(ctx.py));
    const sees = !ctx.hidden && los && dist < 14 && (ctx.flashlight || dist < 4.5);
    const N = ctx.noise.value;
    const radius = ctx.noise.hearingRadius() * (los ? 1 : 0.6);
    const heard = dist < radius && N > 8;
    const exact = N >= 60;
    this.repath -= dt;

    switch (this.state) {
      case S.WANDER:
        if (sees) { this.setState(S.HUNT); this.loseTimer = 0; break; }
        if (heard) {
          const t = exact ? { x: Math.round(ctx.px), y: Math.round(ctx.py) } : this.fuzzy(ctx.px, ctx.py);
          if (this.goTo(t.x, t.y)) { this.setState(S.INVESTIGATE); this.wait = 0; break; }
        }
        if (!this.path.length) { if (this.wait > 0) this.wait -= dt; else { const t = this.randomRoomTarget(); this.goTo(t.x, t.y); this.wait = 1 + this.rnd() * 2; } }
        break;
      case S.INVESTIGATE:
        if (sees) { this.setState(S.HUNT); this.loseTimer = 0; break; }
        if (heard && this.repath <= 0) {
          const t = exact ? { x: Math.round(ctx.px), y: Math.round(ctx.py) } : this.fuzzy(ctx.px, ctx.py);
          this.goTo(t.x, t.y); this.repath = 1.0;
        }
        if (!this.path.length) { this.wait += dt; if (this.wait > 2.5) { this.setState(S.WANDER); this.wait = 0; } }
        break;
      case S.HUNT:
        if (sees || (exact && heard)) { this.loseTimer = 0; this.lastKnown = { x: Math.round(ctx.px), y: Math.round(ctx.py) }; }
        else this.loseTimer += dt;
        if (this.repath <= 0 && this.lastKnown) { this.goTo(this.lastKnown.x, this.lastKnown.y); this.repath = 0.35; }
        if (this.loseTimer > 4.5) { this.setState(S.INVESTIGATE); this.wait = 0; break; }
        if (!ctx.hidden && dist < 0.9) { this.setState(S.CATCH); return; }
        break;
      default: break;
    }

    // A hiding player is safe from sight but not from a racing pulse.
    if (ctx.hidden && dist < 2.2 && N >= 70) {
      this.hideHear += dt;
      if (this.hideHear > 1.5) { this.setState(S.CATCH); return; }
    } else this.hideHear = Math.max(0, this.hideHear - dt);
    if (!ctx.hidden && dist < 0.9 && this.state !== S.WANDER) { this.setState(S.CATCH); return; }

    // move along the path
    const sp = this.state === S.HUNT ? 2.1 : this.state === S.INVESTIGATE ? 1.4 : 0.95;
    this.speed = 0;
    if (this.path.length) {
      const [tx, ty] = this.path[0];
      const vx = tx - this.x, vy = ty - this.y, d = Math.hypot(vx, vy);
      if (d < 0.06) this.path.shift();
      else {
        const m = Math.min(d, sp * dt);
        this.x += (vx / d) * m; this.y += (vy / d) * m;
        const want = Math.atan2(vx, vy);
        let diff = want - this.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.heading += diff * Math.min(1, dt * 8);
        this.speed = sp;
        this.stepAcc += m;
        if (this.stepAcc > 0.9) { this.stepAcc = 0; if (this.onStep) this.onStep(); }
      }
    }
  }
}
