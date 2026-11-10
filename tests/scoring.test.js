// Run: node tests/engine.test.js
const E = require('../scoring.js');
const assert = require('assert');
let fails = 0;
function test(name, fn) { try { fn(); console.log('  ok  ', name); } catch (e) { fails++; console.log('  FAIL', name, '\n       ', e.message); } }
const play = (s, w, n) => { for (let i = 0; i < n; i++) s = E.applyPoint(s, w); return s; };
const std = E.fmtOf({ format: 'std' });

test('6-0 set, server alternates', () => {
  let s = play(E.initState(std, 'me'), 'me', 24);
  assert.deepStrictEqual(s.sets[0], { me: 6, opp: 0 });
  assert.strictEqual(s.server, 'me'); // 6 games played → first server serves game 7
});
test('deuce / advantage', () => {
  let s = E.initState(std, 'me');
  s = play(s, 'me', 3); s = play(s, 'opp', 3);
  assert.deepStrictEqual(E.pointLabels(s), ['40', '40']);
  s = E.applyPoint(s, 'opp'); assert.deepStrictEqual(E.pointLabels(s), ['40', 'AD']);
  s = E.applyPoint(s, 'me'); assert.strictEqual(s.g.me + s.g.opp, 0);
  s = play(s, 'me', 2); assert.strictEqual(s.g.me, 1);
});
test('tiebreak at 6-6, tiebreak serve rotation, then 10-pt match tiebreak', () => {
  let s = play(E.initState(std, 'me'), 'me', 24);
  for (let g = 0; g < 6; g++) { s = play(s, 'me', 4); s = play(s, 'opp', 4); }
  assert.ok(s.tb && s.tbTarget === 7);
  const first = s.tbFirst; const seq = [s.server];
  for (let i = 0; i < 4; i++) { s = E.applyPoint(s, i % 2 ? 'me' : 'opp'); seq.push(s.server); }
  const o = E.other(first);
  assert.deepStrictEqual(seq, [first, o, o, first, first]); // ABBAA
  while (s.sets.length < 2) s = E.applyPoint(s, 'opp');
  assert.strictEqual(s.sets[1].opp, 7); assert.ok(s.sets[1].tb);
  assert.ok(s.mtb && s.tbTarget === 10, 'third set becomes match tiebreak');
  for (let i = 0; i < 9; i++) { s = E.applyPoint(s, 'me'); s = E.applyPoint(s, 'opp'); }
  assert.ok(!s.over, '9-9 not over'); s = E.applyPoint(s, 'me'); assert.ok(!s.over, '10-9 not over (win by 2)');
  s = E.applyPoint(s, 'me'); assert.ok(s.over && s.winner === 'me');
  assert.strictEqual(E.scoreString(s), '6-0 6-7(2) [11-9]'.replace('(2)', '(' + Math.min(s.sets[1].tb.me, s.sets[1].tb.opp) + ')'));
});
test('7-5 set ends without tiebreak', () => {
  let s = E.initState(std, 'me');
  for (let g = 0; g < 5; g++) { s = play(s, 'me', 4); s = play(s, 'opp', 4); }
  s = play(s, 'me', 4); assert.strictEqual(s.sets.length, 0);
  s = play(s, 'me', 4); assert.deepStrictEqual(s.sets[0], { me: 7, opp: 5 });
});
test('no-ad deciding point', () => {
  const f = E.fmtOf({ format: 'one', noAd: true }); let s = E.initState(f, 'opp');
  for (let i = 0; i < 3; i++) { s = E.applyPoint(s, 'me'); s = E.applyPoint(s, 'opp'); }
  assert.ok(E.tags(s).includes('DECIDER')); s = E.applyPoint(s, 'opp'); assert.strictEqual(s.g.opp, 1);
});
test('short sets: tiebreak at 4-4', () => {
  const f = E.fmtOf({ format: 'short' }); let s = E.initState(f, 'me');
  for (let g = 0; g < 4; g++) { s = play(s, 'me', 4); s = play(s, 'opp', 4); }
  assert.ok(s.tb);
});
test('pressure tags: break point, set point, match point', () => {
  let s = play(E.initState(std, 'me'), 'opp', 3);
  assert.ok(E.tags(s).includes('BP_AGAINST'));
  let u = play(E.initState(std, 'me'), 'me', 24); // up a set, opp serves
  for (let g = 0; g < 5; g++) u = play(u, 'me', 4); // 5-0
  u = play(u, 'me', 3);
  const t = E.tags(u); assert.ok(t.includes('MP_FOR') && t.includes('BP_FOR'), t.join());
});
test('win probability sanity', () => {
  const m = E.model(0.6, 0.4, std);
  const start = m.wp(E.initState(std, 'me'));
  assert.ok(Math.abs(start - 0.5) < 0.02, 'equal players ≈ 50%: ' + start);
  const strong = E.model(0.65, 0.45, std).wp(E.initState(std, 'me'));
  assert.ok(strong > 0.75, 'better player favoured: ' + strong);
  let s = play(E.initState(std, 'me'), 'me', 24);
  assert.ok(m.wp(s) > 0.7, 'up a set > 70%');
  // probabilities by brute-force Monte Carlo
  let wins = 0; const N = 20000; let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sp = 0.58, rp = 0.45, mm = E.model(sp, rp, std);
  for (let k = 0; k < N; k++) { let x = E.initState(std, 'me'); while (!x.over) x = E.applyPoint(x, rnd() < (x.server === 'me' ? sp : rp) ? 'me' : 'opp'); if (x.winner === 'me') wins++; }
  const exact = mm.wp(E.initState(std, 'me'));
  assert.ok(Math.abs(wins / N - exact) < 0.015, `Monte Carlo ${(wins / N).toFixed(3)} vs model ${exact.toFixed(3)}`);
  console.log('        model', exact.toFixed(3), 'simulated', (wins / N).toFixed(3));
});
test('replay + stats + insights on a simulated match', () => {
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m = { id: 'x', format: 'std', firstServer: 'me', oppRank: 150, points: [] };
  let s = E.initState(std, 'me');
  while (!s.over) { const w = rnd() < (s.server === 'me' ? 0.58 : 0.45) ? 'me' : 'opp'; m.points.push({ w }); s = E.applyPoint(s, w); }
  const r = E.replay(m, 195);
  assert.strictEqual(r.rows.length, m.points.length); assert.ok(r.state.over);
  const S = E.rowsStats(r.rows);
  assert.strictEqual(S.n, m.points.length); assert.ok(S.clutch !== null);
  const ins = E.insights(S); assert.ok(ins.plan.length >= 1);
  console.log('        points', S.n, 'clutch', S.clutch, 'score', E.scoreString(r.state));
});
console.log(fails ? `\n${fails} FAILED` : '\nALL TESTS PASSED');
process.exit(fails ? 1 : 0);
