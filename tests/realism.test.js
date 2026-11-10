// Run: node tests/realism.test.js — simulates thousands of AI-vs-AI points and checks the physics.
const S = require('../sim.js'), { ROSTER } = require('../roster.js');
const assert = require('assert');
let fails = 0;
const test = (n, f) => { try { f(); console.log('  ok  ', n); } catch (e) { fails++; console.log('  FAIL', n, '\n       ', e.message); } };

test('physics: topspin rally ball clears the net comfortably and lands on target', () => {
  const tr = S.plan({ x: 2, y: -12, z: 1 }, { x: -2.5, y: 10 }, S.SHOTS.topspin);
  assert(!tr.net && tr.netClear > 0.6 && tr.netClear < 2.5, 'clearance ' + tr.netClear);
  assert(Math.abs(tr.land.x + 2.5) < 1e-6 && Math.abs(tr.land.y - 10) < 1e-6);
  console.log('        topspin net clearance', tr.netClear.toFixed(2), 'm, flight', tr.tl.toFixed(2), 's');
});
test('physics: flat drive clears the net by less than topspin', () => {
  const f = S.plan({ x: 0, y: -12, z: 1 }, { x: 0, y: 10 }, S.SHOTS.flat), t = S.plan({ x: 0, y: -12, z: 1 }, { x: 0, y: 10 }, S.SHOTS.topspin);
  assert(f.netClear < t.netClear, f.netClear + ' vs ' + t.netClear);
});
test('physics: kick serve bounces higher than slice; slice stays lowest', () => {
  const peak = (k) => { const tr = S.plan({ x: 0.8, y: -12, z: 2.45 }, { x: -2, y: 5.6 }, S.SHOTS[k]); return (tr.post.vz * tr.post.vz) / (2 * S.G); };
  assert(peak('sKick') > peak('sFlat') && peak('sFlat') > peak('sSlice'), [peak('sKick'), peak('sFlat'), peak('sSlice')].join());
  console.log('        bounce height kick/flat/slice', ['sKick', 'sFlat', 'sSlice'].map((k) => peak(k).toFixed(2)).join(' / '), 'm');
});
test('physics: hitting a ball into own court counts as net, ball below tape is net', () => {
  assert(S.plan({ x: 0, y: -1, z: 0.3 }, { x: 0, y: 10 }, S.SHOTS.flat, { dz: -5 }).net);
});
test('judge: line ball is in, 10 cm out is out, serve box respected', () => {
  const mk = (x, y) => ({ net: false, from: { y: -12 }, land: { x, y } });
  assert.strictEqual(S.judge(mk(4.13, 5), 0).res, 'in');
  assert.strictEqual(S.judge(mk(4.25, 5), 0).res, 'out');
  assert.strictEqual(S.judge(mk(-2, 6.42), -1).res, 'in');
  assert.strictEqual(S.judge(mk(-2, 6.6), -1).res, 'out');
  assert.strictEqual(S.judge(mk(2, 5), -1).res, 'out'); // wrong box
});
test('risk: aiming near the lines under pressure is much riskier', () => {
  const p = S.makePlayer('me');
  const safe = S.errorRisk(p, { x: 0, y: -12, z: 1 }, { x: -2.4, y: 10 }, 'topspin', S.sigmaFor(p, 'topspin', 'FH', 1.1), 0, 400);
  const edgy = S.errorRisk(p, { x: 0, y: -12, z: 1 }, { x: -3.9, y: 11.5 }, 'topspin', S.sigmaFor(p, 'topspin', 'FH', 1.1), 0, 400);
  const edgyStretched = S.errorRisk(p, { x: 0, y: -12, z: 1 }, { x: -3.9, y: 11.5 }, 'flat', S.sigmaFor(p, 'flat', 'FH', 2.3), 0, 400);
  console.log(`        error risk: safe ${(safe * 100).toFixed(0)}%  near lines ${(edgy * 100).toFixed(0)}%  near lines flat & stretched ${(edgyStretched * 100).toFixed(0)}%`);
  assert(safe < 0.12 && edgy > 0.3 && edgyStretched > 0.6);
});
test('realism: AI-vs-AI statistics look like real junior tennis', () => {
  const rng = S.mulberry(99);
  ROSTER.forEach((o) => {
    let n = 0, df = 0, aces = 0, winners = 0, errors = 0, shots = 0, meWon = 0, net = 0, firstIn = 0, firstTot = 0;
    for (let i = 0; i < 1500; i++) {
      const me = S.makePlayer('me', { style: Object.assign({}, ROSTER[0].style, { shots: ['topspin', 'heavy', 'slice', 'flat', 'drop', 'lob'], aggr: 1, care: 1.2, temp: 0.12, net: 0.15 }) });
      const op = S.makePlayer('opp', Object.assign({}, o, { style: o.style }));
      const r = S.simulatePoint({ me, opp: op }, i % 2 ? 'me' : 'opp', i % 4 < 2, rng);
      n++; shots += r.shots; if (r.winner === 'me') meWon++;
      if (r.how === 'df') df++; else if (r.how === 'ace') aces++; else if (r.how === 'winner') winners++; else { errors++; if (r.how === 'net') net++; }
    }
    // first-serve % measured separately
    const sv = S.makePlayer('opp', o), rc = S.makePlayer('me'); const setup = S.serveSetup(sv, rc, true);
    for (let i = 0; i < 1000; i++) { const c = S.aiServe(sv, setup, false, rng); firstTot++; if (S.judge(S.execute(sv, setup.contact, c.aim, c.type, S.sigmaFor(sv, c.type, 'FH', 1), rng), setup.boxSign).res === 'in') firstIn++; }
    console.log(`        ${o.name.padEnd(15)} you win ${(100 * meWon / n).toFixed(0).padStart(2)}% | shots/pt ${(shots / n).toFixed(1)} | 1st serve in ${(100 * firstIn / firstTot).toFixed(0)}% | DF ${(100 * df / n).toFixed(1)}% | aces ${(100 * aces / n).toFixed(1)}% | winners ${(100 * winners / n).toFixed(0)}% | errors ${(100 * errors / n).toFixed(0)}% (net ${(100 * net / Math.max(1, errors)).toFixed(0)}%)`);
    assert(shots / n > 2.5 && shots / n < 9, 'rally length ' + shots / n);
    assert(df / n < 0.08, 'double faults ' + df / n);
    assert(firstIn / firstTot > 0.5 && firstIn / firstTot < 0.85, '1st serve % ' + firstIn / firstTot);
  });
});
console.log(fails ? `\n${fails} FAILED` : '\nALL TESTS PASSED'); process.exit(fails ? 1 : 0);
