import assert from 'node:assert/strict';
import { generateLevel, reachable, HIDE_TYPES } from '../src/renderer/levelgen.js';

let totalRooms = 0, hideTotal = 0;
const typeSeen = new Set();
for (let seed = 1; seed <= 50; seed++) {
  const L = generateLevel(seed * 7919);
  assert.ok(L.rooms.length >= 6 && L.rooms.length <= 10, `seed ${seed}: room count ${L.rooms.length}`);
  const R = reachable(L, L.spawn);
  assert.ok(!L.solid[L.spawn.y][L.spawn.x], `seed ${seed}: spawn is solid`);
  assert.ok(R(L.key.x, L.key.y), `seed ${seed}: key unreachable`);
  assert.ok(R(L.exit.x + L.exit.nx, L.exit.y + L.exit.ny), `seed ${seed}: exit unreachable`);
  assert.notEqual(L.exitRoom, L.spawnRoom, `seed ${seed}: exit in spawn room`);
  for (const r of L.rooms) assert.ok(R(r.cx, r.cy) || L.solid[r.cy][r.cx], `seed ${seed}: room ${r.id} unreachable`);
  for (const h of L.hides) assert.ok(R(h.x + h.fx, h.y + h.fy), `seed ${seed}: hiding spot unreachable`);
  assert.ok(L.hides.length >= 1, `seed ${seed}: no hiding spot`);
  // Hiding spots (iteration 2): every non-spawn room has one, none block a doorway, all reachable.
  for (const r of L.rooms) {
    if (r.id === L.spawnRoom) continue;
    assert.ok(L.hides.some((h) => h.room === r.id), `seed ${seed}: room ${r.id} (${r.name}) has no hiding spot`);
  }
  for (const h of L.hides) {
    assert.ok(HIDE_TYPES.includes(h.type), `seed ${seed}: bad hide type ${h.type}`);
    assert.ok(L.solid[h.y][h.x] === 1, `seed ${seed}: hiding spot tile must be solid`);
    for (const d of L.doors) {
      assert.ok(Math.abs(d.x - h.x) + Math.abs(d.y - h.y) > 1, `seed ${seed}: hiding spot blocks a doorway`);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = d.x + dx, ny = d.y + dy;
        if (nx >= 0 && ny >= 0 && nx < L.W && ny < L.H && L.grid[ny][nx] === 0) assert.ok(!L.solid[ny][nx], `seed ${seed}: furniture in front of a door`);
      }
    }
  }
  hideTotal += L.hides.length; for (const h of L.hides) typeSeen.add(h.type);
  totalRooms += L.rooms.length;
}
console.log(`levelgen OK: 50 seeds, avg rooms ${(totalRooms / 50).toFixed(1)}, avg hiding spots/room ${(hideTotal / totalRooms).toFixed(2)}, types seen ${[...typeSeen].sort().join(",")}; spawn->key, spawn->exit, hiding spots reachable, no door blocked`);
