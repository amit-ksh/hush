// Builds the Three.js scene from a generated level.
import * as THREE from 'three';

const WALL_H = 2.8;
const TEX = '../../assets/textures/';

const loader = new THREE.TextureLoader();
function tex(name, repeatX = 1, repeatY = 1, srgb = true) {
  const t = loader.load(TEX + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function pbr(id, rx, ry, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex(`${id}_diff.jpg`, rx, ry), normalMap: tex(`${id}_nor.jpg`, rx, ry, false),
    roughnessMap: tex(`${id}_rough.jpg`, rx, ry, false), ...extra,
  });
}

export class World {
  constructor(level, renderer) {
    this.level = level;
    const { W, H, TILE } = level;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020204);
    this.scene.fog = new THREE.FogExp2(0x020204, 0.12);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 60);
    this.scene.add(this.camera);

    this.ambient = new THREE.AmbientLight(0x505068, 1.0);
    this.scene.add(this.ambient);
    this.blackoutT = 0; this.shakeT = 0; this.shakeAmp = 0; this.fakeT = 0; this.slabT = 0;

    // flashlight
    this.flash = new THREE.SpotLight(0xfff2d0, 8, 26, 0.5, 0.5, 1);
    this.flash.position.set(0.15, -0.1, 0);
    this.flash.target.position.set(0, 0, -5);
    this.camera.add(this.flash); this.camera.add(this.flash.target);

    // floor + ceiling
    const floorMat = pbr('dark_planks', W * TILE / 2.5, H * TILE / 2.5, { roughness: 1 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * TILE, H * TILE), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set((W * TILE) / 2 - TILE / 2, 0, (H * TILE) / 2 - TILE / 2);
    this.scene.add(floor);
    const ceilMat = pbr('grey_plaster', W * TILE / 3, H * TILE / 3, { color: 0x888888 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W * TILE, H * TILE), ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.set(floor.position.x, WALL_H, floor.position.z);
    this.scene.add(ceil);

    // walls: only solid tiles adjacent to a floor tile and not furniture
    const wallTiles = [];
    const isWall = (x, y) => level.grid[y][x] === 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isWall(x, y)) continue;
      if (level.exit.x === x && level.exit.y === y) continue;
      let touches = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && !isWall(nx, ny)) touches = true;
      }
      if (touches) wallTiles.push([x, y]);
    }
    const wallMat = pbr('decrepit_wallpaper', 1, 1.5, { roughness: 1 });
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, WALL_H, TILE), wallMat, wallTiles.length);
    const m = new THREE.Matrix4();
    wallTiles.forEach(([x, y], i) => { m.makeTranslation(x * TILE, WALL_H / 2, y * TILE); walls.setMatrixAt(i, m); });
    this.scene.add(walls);

    // exit door
    const ex = level.exit;
    this.exitDoor = new THREE.Mesh(
      new THREE.BoxGeometry(ex.vertical ? 0.25 : TILE, 2.3, ex.vertical ? TILE : 0.25),
      pbr('rough_pine_door', 1, 1, { roughness: 1 }));
    this.exitDoor.position.set(ex.x * TILE, 1.15, ex.y * TILE);
    this.scene.add(this.exitDoor);
    // lintel above exit
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(TILE, WALL_H - 2.3, TILE), wallMat);
    lintel.position.set(ex.x * TILE, 2.3 + (WALL_H - 2.3) / 2, ex.y * TILE);
    this.scene.add(lintel);
    this.exitLight = new THREE.PointLight(0xff3322, 3, 8, 1.6);
    this.exitLight.position.set((ex.x + ex.nx * 0.8) * TILE, 2, (ex.y + ex.ny * 0.8) * TILE);
    this.scene.add(this.exitLight);

    // doorway frames (doors between rooms are open arches)
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.9 });
    for (const d of level.doors) {
      if (d.exit) continue;
      const lin = new THREE.Mesh(new THREE.BoxGeometry(TILE, WALL_H - 2.2, TILE), wallMat);
      lin.position.set(d.x * TILE, 2.2 + (WALL_H - 2.2) / 2, d.y * TILE);
      this.scene.add(lin);
      const post = (sx) => {
        const p = new THREE.Mesh(new THREE.BoxGeometry(d.vertical ? 0.2 : 0.12, 2.2, d.vertical ? 0.12 : 0.2), frameMat);
        p.position.set(d.x * TILE + (d.vertical ? 0 : sx * TILE * 0.47), 1.1, d.y * TILE + (d.vertical ? sx * TILE * 0.47 : 0));
        this.scene.add(p);
      };
      post(-1); post(1);
    }

    // props from primitives
    this.propMeshes = new Map();
    const wood = new THREE.MeshStandardMaterial({ color: 0x3b2616, roughness: 0.85 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x4a2a2a, roughness: 1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6, metalness: 0.4 });
    const slat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const closetMat = new THREE.MeshStandardMaterial({ color: 0x2d2a24, roughness: 0.9 });
    const curtainMat = new THREE.MeshStandardMaterial({ color: 0x5a1c1c, roughness: 1 });
    const box = (w, h, d, mat, y) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.y = y; return b; };
    for (const p of level.props) {
      const g = new THREE.Group();
      switch (p.type) {
        case 'wardrobe': g.add(box(1.2, 2.2, 0.8, wood, 1.1)); g.add(box(0.02, 1.9, 0.02, metal, 1.1)); break;
        case 'closet': g.add(box(1.3, 2.4, 0.7, closetMat, 1.2)); g.add(box(0.02, 2.0, 0.02, metal, 1.2)); break;
        case 'locker': g.add(box(0.7, 2.0, 0.6, metal, 1.0)); for (let i = 0; i < 4; i++) { const sl = box(0.4, 0.03, 0.02, slat, 1.5 + i * 0.1); sl.position.z = 0.31; g.add(sl); } break;
        case 'curtain': { const c = box(1.3, 2.4, 0.12, curtainMat, 1.2); c.position.z = 0.1; g.add(c); break; }
        case 'bigcrate': g.add(box(1.15, 1.2, 1.15, wood, 0.6)); g.add(box(1.2, 0.08, 1.2, metal, 1.2)); break;
        case 'bed': g.add(box(1.4, 0.45, 1.5, wood, 0.22)); g.add(box(1.3, 0.2, 1.4, cloth, 0.55)); break;
        case 'table': g.add(box(1.1, 0.07, 1.1, wood, 0.8)); [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]].forEach(([a, b]) => { const l = box(0.08, 0.8, 0.08, wood, 0.4); l.position.x = a; l.position.z = b; g.add(l); }); break;
        case 'shelf': g.add(box(1.3, 1.9, 0.4, wood, 0.95)); break;
        case 'sofa': g.add(box(1.4, 0.5, 0.9, cloth, 0.25)); g.add(box(1.4, 0.6, 0.2, cloth, 0.7)); break;
        case 'counter': g.add(box(1.4, 0.95, 0.7, metal, 0.47)); break;
        default: g.add(box(0.9, 0.7, 0.9, wood, 0.35)); break;
      }
      if (p.hide) { // faint rim shown when the player is close and looking at the spot
        const rim = new THREE.Group();
        const rimMat = new THREE.MeshBasicMaterial({ color: 0x7fb7ff, side: THREE.BackSide, transparent: true, opacity: 0.35 });
        for (const ch of g.children) { const r = new THREE.Mesh(ch.geometry, rimMat); r.position.copy(ch.position); r.scale.setScalar(1.06); rim.add(r); }
        rim.visible = false; g.add(rim); p.rim = rim;
      }
      g.position.set(p.x * TILE, 0, p.y * TILE);
      // orient so the "back" faces the wall (+z is front)
      g.rotation.y = Math.atan2(p.fx, p.fy);
      this.scene.add(g); this.propMeshes.set(p, g);
    }

    // dim warm room lights
    this.roomLights = [];
    for (const r of level.rooms) {
      const l = new THREE.PointLight(0xffb070, 0.9, 7.5, 1.8);
      l.position.set(r.cx * TILE, 2.3, r.cy * TILE);
      this.scene.add(l); this.roomLights.push(l);
    }

    // key
    this.key = new THREE.Group();
    const kmat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xaa7a10, emissiveIntensity: 1.2, metalness: 0.8, roughness: 0.3 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 16), kmat);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), kmat); shaft.position.y = -0.2;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.04), kmat); tooth.position.set(0.06, -0.3, 0);
    this.key.add(ring, shaft, tooth);
    this.key.position.set(level.key.x * TILE, 0.9, level.key.y * TILE);
    this.keyLight = new THREE.PointLight(0xffc040, 1.4, 5, 1.8); this.keyLight.position.copy(this.key.position);
    this.scene.add(this.key, this.keyLight);

    // creature
    this.creature = this._buildCreature();
    this.scene.add(this.creature.group);
    // a purely visual fake creature for the silhouette scare, and a slab for the door slam
    this.fake = this._buildCreature(); this.fake.group.visible = false; this.fake.glow.intensity = 1.2; this.scene.add(this.fake.group);
    this.slab = new THREE.Mesh(new THREE.BoxGeometry(TILE, 2.2, 0.1), pbr('rough_pine_door', 1, 1, { roughness: 1 }));
    this.slab.visible = false; this.scene.add(this.slab);
  }

  _buildCreature() {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x14100f, emissive: 0x2a0a08, emissiveIntensity: 1, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.15, 0.2), dark); torso.position.y = 1.45;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), dark); head.scale.set(0.8, 1.4, 0.9); head.position.y = 2.28;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), eyeMat); eyeL.position.set(-0.06, 2.32, 0.13);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.06;
    const limb = (len, x, y) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.07, len, 0.07), dark); l.geometry.translate(0, -len / 2, 0); l.position.set(x, y, 0); return l; };
    const armL = limb(1.5, -0.28, 2.0), armR = limb(1.5, 0.28, 2.0);
    const legL = limb(1.0, -0.1, 0.95), legR = limb(1.0, 0.1, 0.95);
    g.add(torso, head, eyeL, eyeR, armL, armR, legL, legR);
    const glow = new THREE.PointLight(0xff2200, 0.5, 4, 2); glow.position.set(0, 2.3, 0.3); g.add(glow);
    return { group: g, armL, armR, legL, legR, eyeL, eyeR, glow, t: 0 };
  }

  setCreature(x, y, heading, speed, dt, hunting) {
    const c = this.creature; c.t += dt * (1 + speed);
    c.group.position.set(x, 0, y); c.group.rotation.y = heading;
    const j = hunting ? 0.5 : 0.2;
    c.armL.rotation.x = Math.sin(c.t * 5) * j + (Math.random() - 0.5) * j * 0.6;
    c.armR.rotation.x = -Math.sin(c.t * 5) * j + (Math.random() - 0.5) * j * 0.6;
    c.armL.rotation.z = 0.1 + Math.random() * 0.08; c.armR.rotation.z = -0.1 - Math.random() * 0.08;
    c.legL.rotation.x = Math.sin(c.t * 5) * 0.5 * Math.min(1, speed); c.legR.rotation.x = -c.legL.rotation.x;
    c.group.position.y = Math.abs(Math.sin(c.t * 5)) * 0.04;
    c.glow.intensity = hunting ? 2.4 : 1.0;
  }

  highlight(prop) { for (const h of this.level.hides) if (h.rim) h.rim.visible = h === prop; }

  blackout(secs) { this.blackoutT = secs; }
  shake(secs, amp) { this.shakeT = secs; this.shakeAmp = amp; }
  showFake(x, z, secs, heading) { this.fake.group.position.set(x, 0, z); this.fake.group.rotation.y = heading; this.fake.group.visible = true; this.fakeT = secs; }
  slamDoor(d) {
    const T = this.level.TILE;
    this.slab.position.set(d.x * T, 1.1, d.y * T); this.slab.rotation.y = d.vertical ? Math.PI / 2 : 0;
    this.slab.visible = true; this.slabT = 1.3;
  }

  hideKey() { this.key.visible = false; this.keyLight.visible = false; }

  unlockExit() {
    const { exit, TILE } = this.level;
    // swing the door open
    this.exitOpening = true;
    this.exitLight.color.set(0x44ff88);
    this._exitT = 0;
  }

  update(dt, time) {
    if (this.key.visible) { this.key.rotation.y += dt * 1.5; this.key.position.y = 0.9 + Math.sin(time * 2) * 0.05; this.keyLight.position.y = this.key.position.y; }
    if (this.exitOpening && this._exitT < 1) {
      this._exitT = Math.min(1, this._exitT + dt);
      this.exitDoor.position.y = 1.15 + this._exitT * 2.4;
    }
    // lights: subtle flicker; full blackout scare with a sputtering flashlight
    if (this.blackoutT > 0) {
      this.blackoutT -= dt;
      this.roomLights.forEach((l) => { l.intensity = 0; });
      this.ambient.intensity = 0.08;
      this.flash.intensity = Math.random() < 0.5 ? 0 : 1.5 + Math.random() * 3;
      if (this.blackoutT <= 0) { this.ambient.intensity = 1.0; this.flash.intensity = 8; }
    } else {
      this.roomLights.forEach((l, i) => { l.intensity = 0.9 + (i % 3 === 0 ? (Math.random() - 0.5) * 0.25 * (Math.sin(time * 3 + i) > 0.8 ? 1 : 0) : 0); });
    }
    if (this.fakeT > 0) { this.fakeT -= dt; if (this.fakeT <= 0) this.fake.group.visible = false; }
    if (this.slabT > 0) { this.slabT -= dt; this.slab.scale.x = Math.min(1, (1.3 - this.slabT) * 8); if (this.slabT <= 0) this.slab.visible = false; }
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp * 2; this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp * 2;
      this.camera.rotation.z = (Math.random() - 0.5) * this.shakeAmp * 1.5;
    } else this.camera.rotation.z = 0;
  }

  render() { this.renderer.render(this.scene, this.camera); }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  dispose() {
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { for (const k of ['map', 'normalMap', 'roughnessMap']) o.material[k]?.dispose?.(); o.material.dispose?.(); } });
  }
}
