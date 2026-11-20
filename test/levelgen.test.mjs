import assert from 'node:assert/strict';
import { generateLevel, reachable } from '../src/renderer/levelgen.js';

let totalRooms = 0;
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
  totalRooms += L.rooms.length;
}
console.log(`levelgen OK: 50 seeds, avg rooms ${(totalRooms / 50).toFixed(1)}; spawn->key, spawn->exit and hiding spots reachable on all seeds`);
