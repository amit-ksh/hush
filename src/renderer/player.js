// First-person controls: WASD + mouse look (pointer lock), Shift sprint, C crouch, F flashlight, E interact.
export class Player {
  constructor(level, camera) {
    this.level = level; this.camera = camera;
    const T = level.TILE;
    this.x = level.spawn.x * T; this.z = level.spawn.y * T;
    this.yaw = 0; this.pitch = 0;
    this.eye = 1.6;
    this.keys = new Set();
    this.flashlight = true;
    this.crouching = false;
    this.hidden = null;       // prop while hiding
    this.moving = false; this.sprinting = false;
    this.holdBreath = false; this.holdSecs = 0; this.gasp = false; this.baseYaw = 0;
    this.locked = false;
    this.onInteract = null;
    this.onFlashToggle = null;
    this._bob = 0;
    this._down = (e) => {
      if (e.repeat) return;
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.crouching = !this.crouching;
      if (e.code === 'KeyF') { this.flashlight = !this.flashlight; if (this.onFlashToggle) this.onFlashToggle(this.flashlight); }
      if (e.code === 'KeyE' && this.onInteract) this.onInteract();
    };
    this._up = (e) => this.keys.delete(e.code);
    this._move = (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022));
      this._clampPeek();
    };
    window.addEventListener('keydown', this._down); window.addEventListener('keyup', this._up);
    window.addEventListener('mousemove', this._move);
  }

  // While hiding, the view is locked inside the spot with only a small peek range.
  _clampPeek() {
    if (!this.hidden) return;
    const d = Math.atan2(Math.sin(this.yaw - this.baseYaw), Math.cos(this.yaw - this.baseYaw));
    this.yaw = this.baseYaw + Math.max(-0.55, Math.min(0.55, d));
    this.pitch = Math.max(-0.3, Math.min(0.3, this.pitch));
  }

  dispose() {
    window.removeEventListener('keydown', this._down); window.removeEventListener('keyup', this._up);
    window.removeEventListener('mousemove', this._move);
  }

  get tileX() { return this.x / this.level.TILE; }
  get tileY() { return this.z / this.level.TILE; }

  blocked(px, pz) {
    const { solid, TILE, W, H } = this.level, r = 0.28;
    for (const [ox, oz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
      const tx = Math.round((px + ox) / TILE), ty = Math.round((pz + oz) / TILE);
      if (tx < 0 || ty < 0 || tx >= W || ty >= H || solid[ty][tx]) return true;
    }
    return false;
  }

  update(dt) {
    const k = this.keys;
    this.moving = false; this.sprinting = false;
    if (!this.hidden && this.locked) {
      let f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
      let s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      const len = Math.hypot(f, s);
      if (len > 0) {
        f /= len; s /= len;
        this.sprinting = (k.has('ShiftLeft') || k.has('ShiftRight')) && !this.crouching && f > 0;
        const speed = this.crouching ? 1.3 : this.sprinting ? 4.0 : 2.4;
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        const dx = (-sin * f + cos * s) * speed * dt, dz = (-cos * f - sin * s) * speed * dt;
        if (!this.blocked(this.x + dx, this.z)) this.x += dx;
        if (!this.blocked(this.x, this.z + dz)) this.z += dz;
        this.moving = true;
        this._bob += dt * speed * 2.4;
      }
    }
    this.holdBreath = false; this.gasp = false;
    if (this.hidden) {
      this._clampPeek();
      if (k.has('Space')) {
        this.holdSecs += dt; this.holdBreath = true;
        if (this.holdSecs > 10) { k.delete('Space'); this.holdBreath = false; this.gasp = true; this.holdSecs = 0; }
      } else this.holdSecs = Math.max(0, this.holdSecs - dt * 2);
    } else this.holdSecs = 0;
    const targetEye = this.hidden ? 1.45 : this.crouching ? 0.95 : 1.6;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);
    const bob = this.moving ? Math.sin(this._bob) * 0.035 : 0;
    this.camera.position.set(this.x, this.eye + bob, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  hideIn(prop) {
    const T = this.level.TILE;
    this.hidden = prop; this._ox = this.x; this._oz = this.z;
    this.baseYaw = Math.atan2(-prop.fx, -prop.fy); this.yaw = this.baseYaw; this.pitch = 0; this.holdSecs = 0;
    this.x = prop.x * T; this.z = prop.y * T;
    this.crouching = false;
  }

  leaveHiding() {
    const T = this.level.TILE, p = this.hidden;
    this.x = (p.x + p.fx) * T; this.z = (p.y + p.fy) * T;
    this.hidden = null;
  }
}
