// A* on the tile grid (4-neighbour). solid[y][x] === 1 blocks. extraBlock(x, y) optional.
export function astar(solid, W, H, sx, sy, gx, gy, maxNodes = 4000) {
  if (sx === gx && sy === gy) return [];
  const idx = (x, y) => y * W + x;
  const open = [[sx, sy]];
  const g = new Map([[idx(sx, sy), 0]]);
  const f = new Map([[idx(sx, sy), Math.abs(sx - gx) + Math.abs(sy - gy)]]);
  const came = new Map();
  const closed = new Set();
  let n = 0;
  while (open.length && n++ < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f.get(idx(...open[i])) < f.get(idx(...open[bi]))) bi = i;
    const [x, y] = open.splice(bi, 1)[0];
    const ci = idx(x, y);
    if (x === gx && y === gy) {
      const path = [[x, y]];
      let k = ci;
      while (came.has(k)) { k = came.get(k); path.push([k % W, Math.floor(k / W)]); }
      path.reverse(); path.shift();
      return path;
    }
    closed.add(ci);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (solid[ny][nx] && !(nx === gx && ny === gy)) continue;
      const ni = idx(nx, ny);
      if (closed.has(ni)) continue;
      const ng = g.get(ci) + 1;
      if (g.has(ni) && ng >= g.get(ni)) continue;
      came.set(ni, ci); g.set(ni, ng); f.set(ni, ng + Math.abs(nx - gx) + Math.abs(ny - gy));
      if (!open.some((o) => o[0] === nx && o[1] === ny)) open.push([nx, ny]);
    }
  }
  return null;
}

// Tile-grid line of sight (Bresenham); true if no solid tile between (excluding endpoints).
export function lineOfSight(solid, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (!(x === x1 && y === y1)) {
    if (!(x === x0 && y === y0) && solid[y][x]) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return true;
}
