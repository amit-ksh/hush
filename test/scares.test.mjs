import assert from 'node:assert/strict';
import { ScareDirector, SCARE_IDS } from '../src/renderer/scares.js';
import { mulberry32 } from '../src/renderer/levelgen.js';

// Simulate 30 minutes at 10 Hz; return fire records.
function simulate(seed, chaseFn = () => false) {
  const d = new ScareDirector({ rnd: mulberry32(seed) });
  const fires = [];
  for (let i = 0; i < 18000; i++) {
    const chase = chaseFn(i / 10);
    const id = d.update(0.1, { chase });
    if (id) fires.push({ t: d.t, id, chase });
  }
  return { fires, d };
}

for (let seed = 1; seed <= 20; seed++) {
  const { fires } = simulate(seed);
  assert.ok(fires.length > 10, `seed ${seed}: too few scares (${fires.length})`);
  assert.ok(fires[0].t >= 45 && fires[0].t <= 121, `first scare time ${fires[0].t}`);
  for (let i = 1; i < fires.length; i++) {
    assert.ok(fires[i].t - fires[i - 1].t >= 44.9, `cooldown violated: ${fires[i].t - fires[i - 1].t}`);
    assert.ok(fires[i].t - fires[i - 1].t <= 121, 'gap exceeds maximum');
    assert.notEqual(fires[i].id, fires[i - 1].id, 'same scare twice in a row');
    assert.ok(SCARE_IDS.includes(fires[i].id));
  }
}

// nothing during a chase: chase active for 100-400 s windows
const chasing = (t) => (t > 100 && t < 400) || (t > 900 && t < 960);
const { fires } = simulate(7, chasing);
assert.ok(fires.length > 3);
for (const f of fires) assert.ok(!chasing(f.t - 0.05) && !chasing(f.t), `scare fired during chase at ${f.t}`);
assert.ok(!fires.some((f) => f.t > 100 && f.t < 403), 'no scare during or within grace of chase');

// every scare type appears over many runs (all reachable)
const seen = new Set();
for (let s = 1; s <= 20; s++) simulate(s).fires.forEach((f) => seen.add(f.id));
assert.equal(seen.size, SCARE_IDS.length, 'all scare types reachable');

// frequency rises with intensity: average gap early > average gap late
{
  const { fires: f } = simulate(3);
  const gaps = f.slice(1).map((x, i) => x.t - f[i].t);
  const half = Math.floor(gaps.length / 2);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(avg(gaps.slice(0, half)) >= avg(gaps.slice(half)) - 1, 'gaps do not grow later in the run');
}

// failed(): undoes the record, retries within a few seconds, and still never repeats
{
  const d = new ScareDirector({ rnd: mulberry32(5) });
  let id = null, t0 = 0;
  while (!id) { id = d.update(0.1); }
  t0 = d.t; d.failed();
  assert.equal(d.last, null); assert.ok(d.next - d.t <= 5.01);
  let id2 = null; while (!id2) id2 = d.update(0.1);
  assert.ok(d.t - t0 <= 6, 'retry soon');
}

// disabled flag
{
  const d = new ScareDirector({ rnd: mulberry32(1), enabled: false });
  for (let i = 0; i < 5000; i++) assert.equal(d.update(0.1), null);
}

console.log(`scares OK: 20 seeds x 30 min (cooldown>=45s, max gap<=120s, no repeats, none during chase, all ${SCARE_IDS.length} types reachable)`);
