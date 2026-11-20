import assert from 'node:assert/strict';
import { MicAnalyzer, medianFloor, rmsToDb } from '../src/renderer/micLogic.js';

const DT = 1 / 60;
function run(a, seq) { // seq: array of [seconds, dbfs]; returns events with timestamps
  const events = []; let t = 0, last = null;
  for (const [secs, db] of seq) for (let i = 0; i < Math.round(secs / DT); i++) { last = a.push(typeof db === 'function' ? db(i * DT) : db, DT); t += DT; if (last.event) events.push({ t, ...last.event }); }
  return { events, last };
}
const FLOOR = -50;
const fresh = () => { const a = new MicAnalyzer(); a.setFloor(FLOOR); return a; };

assert.ok(Math.abs(rmsToDb(1) - 0) < 1e-9 && Math.abs(rmsToDb(0.1) + 20) < 1e-9, 'rmsToDb');
assert.equal(medianFloor([-52, -50, -49, -20, -51]), -50, 'median floor ignores outliers');
assert.equal(medianFloor([]), -55, 'default floor');

// silence at the floor: no events, no noise
let r = run(fresh(), [[3, FLOOR]]);
assert.equal(r.events.length, 0); assert.equal(r.last.noise, 0);

// a clap (+35 dB for 80 ms) is one event with high loudness
let a = fresh();
r = run(a, [[1, FLOOR], [0.08, FLOOR + 35], [1, FLOOR]]);
assert.equal(r.events.length, 1, 'clap -> one event');
assert.ok(r.events[0].loudness > 0.6, `clap loudness ${r.events[0].loudness}`);

// two claps inside the refractory window count once; a third after it counts
a = fresh();
r = run(a, [[1, FLOOR], [0.05, FLOOR + 35], [0.2, FLOOR], [0.05, FLOOR + 35], [1.2, FLOOR], [0.05, FLOOR + 35], [0.5, FLOOR]]);
assert.equal(r.events.length, 2, `refractory: expected 2 events, got ${r.events.length}`);

// quiet sound just above floor (+8 dB): no spike, but a small continuous contribution
a = fresh();
r = run(a, [[2, FLOOR + 8]]);
assert.equal(r.events.length, 0); assert.ok(r.last.noise > 0 && r.last.noise < 5, `quiet noise ${r.last.noise}`);

// slow swell from floor to +30 dB over 4 s is not a spike (rise too gradual)
a = fresh();
r = run(a, [[1, FLOOR], [4, (t) => FLOOR + 7.5 * t]]);
assert.equal(r.events.length, 0, 'gradual swell is not an onset');
assert.ok(r.last.noise > 15, `sustained loud level adds noise, got ${r.last.noise}`);

// release is slower than attack
a = fresh();
r = run(a, [[0.5, FLOOR + 30]]); const up = r.last.level;
r = run(a, [[0.1, FLOOR]]);
assert.ok(r.last.level > up * 0.5, 'slow release');
assert.ok(up > 25, 'fast attack');

// speaking: a burst of syllables over a floor produces events, below-threshold mumble does not
a = fresh();
r = run(a, [[1, FLOOR], [0.15, FLOOR + 22], [0.5, FLOOR + 3], [0.15, FLOOR + 22], [1, FLOOR]]);
assert.ok(r.events.length >= 1 && r.events.length <= 2, `speech events ${r.events.length}`);
r = run(fresh(), [[2, FLOOR + 10]]);
assert.equal(r.events.length, 0, 'mumble below threshold');

console.log('mic OK: floor median, onset/threshold, refractory, swell rejection, attack/release, mumble rejection');
