// Seeded procedural house generator. Pure JS (no DOM) so it can be tested in Node.
// Tile grid: 1 = solid (wall / furniture), 0 = floor. Rooms sit in a lattice of slots.

export const TILE = 1.6;          // metres per tile
export const SLOT = 7;            // tiles per slot (6 interior + 1 shared wall)

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROOM_NAMES = ['Bedroom', 'Kitchen', 'Hall', 'Bathroom', 'Study', 'Living room', 'Nursery', 'Pantry', 'Cellar', 'Attic'];
const PROP_SETS = {
  Bedroom: ['bed', 'wardrobe', 'shelf'], Kitchen: ['counter', 'table', 'crate'], Hall: ['shelf', 'wardrobe', 'crate'],
  Bathroom: ['crate', 'shelf'], Study: ['shelf', 'table', 'wardrobe'], 'Living room': ['sofa', 'table', 'shelf'],
  Nursery: ['bed', 'crate', 'wardrobe'], Pantry: ['shelf', 'crate', 'crate'], Cellar: ['crate', 'crate', 'wardrobe'], Attic: ['crate', 'bed', 'wardrobe'],
};

export function generateLevel(seed) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

  const COLS = 4, ROWS = 3;
  const W = COLS * SLOT + 1, H = ROWS * SLOT + 1;
  const want = 6 + Math.floor(rnd() * 5); // 6..10 rooms

  // Grow a connected set of slots.
  const key = (c, r) => r * COLS + c;
  const chosen = new Map();
  const start = [Math.floor(rnd() * COLS), Math.floor(rnd() * ROWS)];
  chosen.set(key(...start), { c: start[0], r: start[1] });
  const edges = [];
  while (chosen.size < want) {
    const cells = [...chosen.values()];
    const from = pick(cells);
    const [dc, dr] = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    const c = from.c + dc, r = from.r + dr;
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
    if (!chosen.has(key(c, r))) { chosen.set(key(c, r), { c, r }); edges.push([key(from.c, from.r), key(c, r)]); }
  }
  // Extra loops so the creature can circle.
  for (const a of chosen.values()) for (const b of chosen.values()) {
    if (Math.abs(a.c - b.c) + Math.abs(a.r - b.r) === 1 && key(a.c, a.r) < key(b.c, b.r) && rnd() < 0.3
        && !edges.some(([p, q]) => (p === key(a.c, a.r) && q === key(b.c, b.r)) || (q === key(a.c, a.r) && p === key(b.c, b.r)))) {
      edges.push([key(a.c, a.r), key(b.c, b.r)]);
    }
  }

  const names = shuffle([...ROOM_NAMES]);
  const rooms = [];
  const roomOf = new Map();
  for (const [k, s] of chosen) {
    const x0 = s.c * SLOT + 1, y0 = s.r * SLOT + 1;
    const room = { id: rooms.length, slot: k, c: s.c, r: s.r, name: names[rooms.length % names.length], x0, y0, x1: x0 + SLOT - 2, y1: y0 + SLOT - 2 };
    room.cx = Math.floor((room.x0 + room.x1) / 2); room.cy = Math.floor((room.y0 + room.y1) / 2);
    rooms.push(room); roomOf.set(k, room);
  }

  const grid = Array.from({ length: H }, () => new Uint8Array(W).fill(1));
  for (const r of rooms) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) grid[y][x] = 0;

  const doors = [];
  const adj = rooms.map(() => []);
  for (const [ka, kb] of edges) {
    const a = roomOf.get(ka), b = roomOf.get(kb);
    let dx, dy;
    if (a.r === b.r) { dx = Math.max(a.c, b.c) * SLOT; dy = a.y0 + 1 + Math.floor(rnd() * (SLOT - 3)); }
    else { dy = Math.max(a.r, b.r) * SLOT; dx = a.x0 + 1 + Math.floor(rnd() * (SLOT - 3)); }
    grid[dy][dx] = 0;
    doors.push({ x: dx, y: dy, a: a.id, b: b.id, exit: false, vertical: a.r === b.r });
    adj[a.id].push(b.id); adj[b.id].push(a.id);
  }

  // Spawn room: random; exit room: farthest edge-of-house room by BFS over rooms.
  const spawnRoom = pick(rooms);
  const dist = rooms.map(() => -1); dist[spawnRoom.id] = 0;
  const q = [spawnRoom.id];
  while (q.length) { const u = q.shift(); for (const v of adj[u]) if (dist[v] < 0) { dist[v] = dist[u] + 1; q.push(v); } }
  const edgeRooms = rooms.filter((r) => (r.c === 0 || r.r === 0 || r.c === COLS - 1 || r.r === ROWS - 1) && r.id !== spawnRoom.id);
  edgeRooms.sort((p, q2) => dist[q2.id] - dist[p.id] || p.id - q2.id);
  const exitRoom = edgeRooms[0];
  const sides = [];
  if (exitRoom.c === 0) sides.push({ x: 0, y: exitRoom.cy, nx: 1, ny: 0 });
  if (exitRoom.c === COLS - 1) sides.push({ x: W - 1, y: exitRoom.cy, nx: -1, ny: 0 });
  if (exitRoom.r === 0) sides.push({ x: exitRoom.cx, y: 0, nx: 0, ny: 1 });
  if (exitRoom.r === ROWS - 1) sides.push({ x: exitRoom.cx, y: H - 1, nx: 0, ny: -1 });
  const es = pick(sides);
  const exit = { x: es.x, y: es.y, nx: es.nx, ny: es.ny, room: exitRoom.id, vertical: es.nx !== 0 };
  doors.push({ x: es.x, y: es.y, a: exitRoom.id, b: -1, exit: true, vertical: exit.vertical });
  // The exit tile stays solid (grid = 1) until unlocked; its inside neighbour stays clear (nearDoor).

  const nearDoor = (x, y) => doors.some((d) => Math.abs(d.x - x) <= 1 && Math.abs(d.y - y) <= 1);

  // Props hug walls, never next to doors.
  const props = [];
  const hides = [];
  const solid = grid.map((row) => Uint8Array.from(row));
  for (const room of rooms) {
    const set = PROP_SETS[room.name] || ['crate'];
    const candidates = [];
    for (let y = room.y0; y <= room.y1; y++) for (let x = room.x0; x <= room.x1; x++) {
      const onWall = x === room.x0 || x === room.x1 || y === room.y0 || y === room.y1;
      if (!onWall || nearDoor(x, y)) continue;
      const corner = (x === room.x0 || x === room.x1) && (y === room.y0 || y === room.y1);
      if (corner) continue;
      candidates.push({ x, y });
    }
    shuffle(candidates);
    const n = 2 + Math.floor(rnd() * 3);
    let hasHide = false;
    for (let i = 0; i < n && candidates.length; i++) {
      const c = candidates.pop();
      if (props.some((p) => p.room === room.id && Math.abs(p.x - c.x) + Math.abs(p.y - c.y) <= 1)) continue;
      let type = pick(set);
      if (!hasHide && i === n - 1 && rnd() < 0.8) type = 'wardrobe';
      const facing = c.x === room.x0 ? [1, 0] : c.x === room.x1 ? [-1, 0] : c.y === room.y0 ? [0, 1] : [0, -1];
      const p = { type, x: c.x, y: c.y, room: room.id, fx: facing[0], fy: facing[1], hide: type === 'wardrobe' || type === 'bed' };
      props.push(p); solid[c.y][c.x] = 1;
      if (p.hide) { hides.push(p); hasHide = true; }
    }
    if (rnd() < 0.4) { // a table in the middle for some rooms
      const x = room.cx + 1, y = room.cy;
      if (!doors.some((d) => Math.abs(d.x - x) + Math.abs(d.y - y) <= 2) && !props.some((p) => p.room === room.id && Math.abs(p.x - x) + Math.abs(p.y - y) <= 1)) {
        props.push({ type: 'table', x, y, room: room.id, fx: 0, fy: 0, hide: false }); solid[y][x] = 1;
      }
    }
  }
  if (!hides.length) { // guarantee a hiding spot somewhere
    const p = props.find((pp) => pp.type !== 'table');
    if (p) { p.type = 'wardrobe'; p.hide = true; hides.push(p); }
  }

  const free = (r) => { for (let y = r.cy; y <= r.y1; y++) for (let x = r.cx - 1; x <= r.x1; x++) if (!solid[y][x]) return { x, y }; return { x: r.cx, y: r.cy }; };
  const spawn = { ...free(spawnRoom), room: spawnRoom.id };
  const keyCandidates = rooms.filter((r) => r.id !== spawnRoom.id && r.id !== exitRoom.id && dist[r.id] >= 2);
  const fallback = rooms.filter((r) => r.id !== spawnRoom.id);
  const keyRoom = pick(keyCandidates.length ? keyCandidates : fallback);
  const kt = [];
  for (let y = keyRoom.y0; y <= keyRoom.y1; y++) for (let x = keyRoom.x0; x <= keyRoom.x1; x++) if (!solid[y][x] && !nearDoor(x, y)) kt.push({ x, y });
  const keyTile = kt.length ? pick(kt) : { x: keyRoom.cx, y: keyRoom.cy };
  const keyPos = { x: keyTile.x, y: keyTile.y, room: keyRoom.id };

  return { seed, W, H, TILE, grid, solid, rooms, doors, adj, dist, spawn, exit, key: keyPos, props, hides, spawnRoom: spawnRoom.id, exitRoom: exitRoom.id };
}

// 4-neighbour flood fill over walkable tiles (solid = 0).
export function reachable(level, from) {
  const { W, H, solid } = level;
  const seen = new Uint8Array(W * H);
  const q = [[from.x, from.y]]; seen[from.y * W + from.x] = 1;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || solid[ny][nx] || seen[ny * W + nx]) continue;
      seen[ny * W + nx] = 1; q.push([nx, ny]);
    }
  }
  return (x, y) => !!seen[y * W + x];
}
