/* CLUTCH engine — tennis scoring, Markov win-probability model and match analytics.
   Pure functions only (no DOM) so it can be unit-tested in Node. */
(function (root) {
  'use strict';

  const FORMATS = {
    quick: { label: 'Quick: one short set to 4 (tiebreak at 4-4)', setGames: 4, setsToWin: 1, finalSet: 'set' },
    std:   { label: 'Best of 3 · 10-pt match tiebreak for 3rd', setGames: 6, setsToWin: 2, finalSet: 'mtb10' },
    full:  { label: 'Best of 3 full sets',                      setGames: 6, setsToWin: 2, finalSet: 'set' },
    short: { label: 'Short sets to 4 · match tiebreak',         setGames: 4, setsToWin: 2, finalSet: 'mtb10' },
    pro8:  { label: '8-game pro set',                           setGames: 8, setsToWin: 1, finalSet: 'set' },
    one:   { label: 'One set to 6',                             setGames: 6, setsToWin: 1, finalSet: 'set' },
  };
  const STROKES = { FH: 'Forehand', BH: 'Backhand', RET: 'Return', VOL: 'Volley', OH: 'Overhead', DS: 'Drop/Slice' };
  const K_PRIOR = 24;          // how many points of "prior belief" before live data dominates
  const BIG = 0.08;            // leverage threshold for a ⚡ big point
  const HUGE = 0.15;

  const other = (x) => (x === 'me' ? 'opp' : 'me');
  const fmtOf = (m) => Object.assign({}, FORMATS[m.format] || FORMATS.std, { noAd: !!m.noAd });

  /* ---------------- scoring ---------------- */
  function isFinalMTB(s) {
    return s.fmt.finalSet === 'mtb10' && s.setsWon.me === s.fmt.setsToWin - 1 && s.setsWon.opp === s.fmt.setsToWin - 1;
  }
  function startMTB(s, server) { s.tb = true; s.mtb = true; s.tbTarget = 10; s.tbFirst = server; s.server = server; }

  function initState(fmt, firstServer) {
    const s = { fmt, sets: [], setsWon: { me: 0, opp: 0 }, g: { me: 0, opp: 0 }, p: { me: 0, opp: 0 },
      server: firstServer, tb: false, tbTarget: 7, tbFirst: null, mtb: false, over: false, winner: null };
    if (isFinalMTB(s)) startMTB(s, firstServer);
    return s;
  }
  function clone(s) {
    return { fmt: s.fmt, sets: s.sets.map((x) => Object.assign({}, x)), setsWon: Object.assign({}, s.setsWon),
      g: Object.assign({}, s.g), p: Object.assign({}, s.p), server: s.server, tb: s.tb, tbTarget: s.tbTarget,
      tbFirst: s.tbFirst, mtb: s.mtb, over: s.over, winner: s.winner };
  }
  function tbServer(first, k) { return Math.floor((k + 1) / 2) % 2 === 0 ? first : other(first); }

  function finishSet(s, w, set, nextServer) {
    s.sets.push(set); s.setsWon[w]++;
    s.g = { me: 0, opp: 0 }; s.p = { me: 0, opp: 0 }; s.tb = false; s.mtb = false; s.tbFirst = null; s.tbTarget = 7;
    if (s.setsWon[w] >= s.fmt.setsToWin) { s.over = true; s.winner = w; return; }
    s.server = nextServer;
    if (isFinalMTB(s)) startMTB(s, nextServer);
  }

  function applyPoint(s0, w) {
    const s = clone(s0);
    if (s.over) return s;
    const l = other(w);
    s.p[w]++;
    if (s.tb) {
      if (s.p[w] >= s.tbTarget && s.p[w] - s.p[l] >= 2) {
        const set = s.mtb
          ? { me: w === 'me' ? 1 : 0, opp: w === 'opp' ? 1 : 0, tb: Object.assign({}, s.p), mtb: true }
          : { me: s.g.me + (w === 'me' ? 1 : 0), opp: s.g.opp + (w === 'opp' ? 1 : 0), tb: Object.assign({}, s.p) };
        finishSet(s, w, set, other(s.tbFirst));
      } else {
        s.server = tbServer(s.tbFirst, s.p.me + s.p.opp);
      }
      return s;
    }
    const a = s.p[w], b = s.p[l];
    const gameWon = s.fmt.noAd ? a >= 4 : a >= 4 && a - b >= 2;
    if (gameWon) {
      s.g[w]++; s.p = { me: 0, opp: 0 };
      const G = s.fmt.setGames, next = other(s.server);
      if (s.g[w] >= G && s.g[w] - s.g[l] >= 2) finishSet(s, w, { me: s.g.me, opp: s.g.opp }, next);
      else if (s.g.me === G && s.g.opp === G) { s.tb = true; s.tbTarget = 7; s.tbFirst = next; s.server = next; }
      else s.server = next;
    }
    return s;
  }

  function pointLabels(s) {
    if (s.tb) return [String(s.p.me), String(s.p.opp)];
    const n = ['0', '15', '30', '40'], a = s.p.me, b = s.p.opp;
    if (a >= 3 && b >= 3) { if (a === b) return ['40', '40']; return a > b ? ['AD', '40'] : ['40', 'AD']; }
    return [n[a], n[b]];
  }

  function tags(s) {
    if (s.over) return [];
    const t = [];
    const nMe = applyPoint(s, 'me'), nOpp = applyPoint(s, 'opp');
    if (nMe.over) t.push('MP_FOR'); else if (nMe.setsWon.me > s.setsWon.me) t.push('SP_FOR');
    if (nOpp.over) t.push('MP_AGAINST'); else if (nOpp.setsWon.opp > s.setsWon.opp) t.push('SP_AGAINST');
    if (s.tb) { t.push(s.mtb ? 'MTB' : 'TB'); return t; }
    const gMe = nMe.g.me > s.g.me || nMe.sets.length > s.sets.length || (nMe.tb && !s.tb);
    const gOpp = nOpp.g.opp > s.g.opp || nOpp.sets.length > s.sets.length || (nOpp.tb && !s.tb);
    if (s.server === 'opp' && gMe) t.push('BP_FOR');
    if (s.server === 'me' && gOpp) t.push('BP_AGAINST');
    if (s.p.me === s.p.opp && s.p.me >= 2) t.push(s.fmt.noAd && s.p.me === 3 ? 'DECIDER' : s.p.me >= 3 ? 'DEUCE' : '30-30');
    return t;
  }

  /* ---------------- win probability (Markov chain) ----------------
     sp = P(I win a point on my serve), rp = P(I win a point on opponent's serve) */
  function model(sp, rp, fmt) {
    const mG = new Map(), mTB = new Map(), mS = new Map(), mM = new Map();
    function G(p, a, b) { // player with point-prob p wins game from a:b
      if (fmt.noAd) { if (a >= 4) return 1; if (b >= 4) return 0; }
      else {
        if (a >= 4 && a - b >= 2) return 1; if (b >= 4 && b - a >= 2) return 0;
        if (a >= 3 && b >= 3) { const d = (p * p) / (p * p + (1 - p) * (1 - p)); return a === b ? d : a > b ? p + (1 - p) * d : p * d; }
      }
      const k = p + '|' + a + '|' + b; if (mG.has(k)) return mG.get(k);
      const v = p * G(p, a + 1, b) + (1 - p) * G(p, a, b + 1); mG.set(k, v); return v;
    }
    const gameMe = (server, a, b) => (server === 'me' ? G(sp, a, b) : 1 - G(1 - rp, b, a));
    function TB(a, b, first, T) {
      if (a >= T && a - b >= 2) return 1; if (b >= T && b - a >= 2) return 0;
      if (a === b && a >= T - 1) { const x = sp * rp, y = (1 - sp) * (1 - rp); return x / (x + y); }
      const k = a + '|' + b + '|' + first + '|' + T; if (mTB.has(k)) return mTB.get(k);
      const p = tbServer(first, a + b) === 'me' ? sp : rp;
      const v = p * TB(a + 1, b, first, T) + (1 - p) * TB(a, b + 1, first, T); mTB.set(k, v); return v;
    }
    function SET(gm, go, server) {
      const N = fmt.setGames;
      if (gm >= N && gm - go >= 2) return 1; if (go >= N && go - gm >= 2) return 0;
      if (gm === N && go === N) return TB(0, 0, server, 7);
      const k = gm + '|' + go + '|' + server; if (mS.has(k)) return mS.get(k);
      const h = gameMe(server, 0, 0);
      const v = h * SET(gm + 1, go, other(server)) + (1 - h) * SET(gm, go + 1, other(server)); mS.set(k, v); return v;
    }
    let setAvg = null, mtbAvg = null;
    function MATCH(a, b) {
      const N = fmt.setsToWin; if (a >= N) return 1; if (b >= N) return 0;
      const k = a + '|' + b; if (mM.has(k)) return mM.get(k);
      if (setAvg === null) { setAvg = (SET(0, 0, 'me') + SET(0, 0, 'opp')) / 2; mtbAvg = (TB(0, 0, 'me', 10) + TB(0, 0, 'opp', 10)) / 2; }
      const q = fmt.finalSet === 'mtb10' && a === N - 1 && b === N - 1 ? mtbAvg : setAvg;
      const v = q * MATCH(a + 1, b) + (1 - q) * MATCH(a, b + 1); mM.set(k, v); return v;
    }
    function wp(st) {
      if (st.over) return st.winner === 'me' ? 1 : 0;
      let pc;
      if (st.tb) pc = TB(st.p.me, st.p.opp, st.tbFirst, st.tbTarget);
      else {
        const g = gameMe(st.server, st.p.me, st.p.opp), nx = other(st.server);
        pc = g * SET(st.g.me + 1, st.g.opp, nx) + (1 - g) * SET(st.g.me, st.g.opp + 1, nx);
      }
      return pc * MATCH(st.setsWon.me + 1, st.setsWon.opp) + (1 - pc) * MATCH(st.setsWon.me, st.setsWon.opp + 1);
    }
    const leverage = (st) => (st.over ? 0 : wp(applyPoint(st, 'me')) - wp(applyPoint(st, 'opp')));
    return { wp, leverage };
  }

  function priors(myRank, oppRank) {
    let d = 0;
    if (myRank > 0 && oppRank > 0) d = Math.max(-0.08, Math.min(0.08, 0.035 * Math.log(oppRank / myRank)));
    return { s: 0.56 + d, r: 0.44 + d };
  }

  /* who hit the shot that ended the point */
  function hitter(pt, server) {
    if (pt.how === 'w') return pt.w;
    if (pt.how === 'ace' || pt.how === 'df') return server;
    if (pt.how === 'fe' || pt.how === 'ue') return other(pt.w);
    return null;
  }

  /* Replay a match point-by-point → timeline rows with win prob, leverage and pressure tags */
  function replay(match, myRank) {
    const fmt = fmtOf(match);
    let st = initState(fmt, match.firstServer || 'me');
    const pr = priors(myRank || 0, match.oppRank || 0);
    const sv = { n: 0, w: 0 }, rt = { n: 0, w: 0 };
    const rows = [];
    let mdl = model(pr.s, pr.r, fmt);
    (match.points || []).forEach((pt, i) => {
      if (st.over) return;
      const sE = (pr.s * K_PRIOR + sv.w) / (K_PRIOR + sv.n), rE = (pr.r * K_PRIOR + rt.w) / (K_PRIOR + rt.n);
      mdl = model(sE, rE, fmt);
      const ifW = mdl.wp(applyPoint(st, 'me')), ifL = mdl.wp(applyPoint(st, 'opp'));
      const next = applyPoint(st, pt.w);
      rows.push({ i, mid: match.id, pt, before: st, server: st.server, by: hitter(pt, st.server),
        wp: mdl.wp(st), wpAfter: pt.w === 'me' ? ifW : ifL, lev: ifW - ifL, tags: tags(st) });
      if (st.server === 'me') { sv.n++; if (pt.w === 'me') sv.w++; } else { rt.n++; if (pt.w === 'me') rt.w++; }
      st = next;
    });
    const sE = (pr.s * K_PRIOR + sv.w) / (K_PRIOR + sv.n), rE = (pr.r * K_PRIOR + rt.w) / (K_PRIOR + rt.n);
    mdl = model(sE, rE, fmt);
    return { fmt, state: st, rows, wpNow: mdl.wp(st), levNow: mdl.leverage(st), tagsNow: tags(st), est: { s: sE, r: rE } };
  }

  /* ---------------- analytics ---------------- */
  const ctr = () => ({ n: 0, won: 0 });
  const add = (c, won) => { c.n++; if (won) c.won++; };
  const PRESSURE = ['MP_FOR', 'MP_AGAINST', 'SP_FOR', 'SP_AGAINST', 'BP_FOR', 'BP_AGAINST', '30-30', 'DEUCE', 'DECIDER', 'TB', 'MTB'];

  function rowsStats(rows) {
    const S = { n: 0, won: 0, srv: { n: 0, won: 0, first: 0, firstWon: 0, second: 0, secondWon: 0, df: 0, aces: 0 },
      ret: { n: 0, won: 0, first: 0, firstWon: 0, second: 0, secondWon: 0, oppDf: 0, oppAces: 0 },
      bpFor: ctr(), bpAg: ctr(), pivot: ctr(), tb: ctr(), spFor: ctr(), spAg: ctr(), mpFor: ctr(), mpAg: ctr(),
      press: ctr(), norm: ctr(), big: ctr(), afterLoss: ctr(), afterWin: ctr(), afterUE: ctr(), afterBigLoss: ctr(),
      winners: {}, ue: {}, fe: {}, myWinners: 0, myUE: 0, myFE: 0, oppWinners: 0, oppUE: 0,
      rally: { S: ctr(), M: ctr(), L: ctr() }, bestRun: 0, worstRun: 0, levSum: 0, levWon: 0 };
    let prev = null, run = 0;
    rows.forEach((r) => {
      const won = r.pt.w === 'me', pt = r.pt;
      if (prev && prev.mid !== r.mid) { prev = null; run = 0; }
      add(S, won);
      if (r.server === 'me') {
        add(S.srv, won);
        if (pt.sv === 1) { S.srv.first++; if (won) S.srv.firstWon++; }
        else if (pt.sv === 2) { S.srv.second++; if (won) S.srv.secondWon++; }
        else if (pt.sv === 0) S.srv.df++;
        if (pt.how === 'ace') S.srv.aces++;
      } else {
        add(S.ret, won);
        if (pt.sv === 1) { S.ret.first++; if (won) S.ret.firstWon++; }
        else if (pt.sv === 2) { S.ret.second++; if (won) S.ret.secondWon++; }
        else if (pt.sv === 0) S.ret.oppDf++;
        if (pt.how === 'ace') S.ret.oppAces++;
      }
      const t = r.tags;
      if (t.includes('BP_FOR')) add(S.bpFor, won);
      if (t.includes('BP_AGAINST')) add(S.bpAg, won);
      if (t.includes('30-30') || t.includes('DEUCE') || t.includes('DECIDER')) add(S.pivot, won);
      if (t.includes('TB') || t.includes('MTB')) add(S.tb, won);
      if (t.includes('SP_FOR')) add(S.spFor, won);
      if (t.includes('SP_AGAINST')) add(S.spAg, won);
      if (t.includes('MP_FOR')) add(S.mpFor, won);
      if (t.includes('MP_AGAINST')) add(S.mpAg, won);
      add(t.some((x) => PRESSURE.includes(x)) ? S.press : S.norm, won);
      if (r.lev >= BIG) add(S.big, won);
      S.levSum += r.lev; if (won) S.levWon += r.lev;
      if (prev) {
        add(prev.pt.w === 'me' ? S.afterWin : S.afterLoss, won);
        if (prev.by === 'me' && prev.pt.how === 'ue') add(S.afterUE, won);
        if (prev.pt.w === 'opp' && prev.lev >= BIG) add(S.afterBigLoss, won);
      }
      const st = pt.st || '—';
      if (r.by === 'me') {
        if (pt.how === 'w') { S.winners[st] = (S.winners[st] || 0) + 1; S.myWinners++; }
        if (pt.how === 'ue') { S.ue[st] = (S.ue[st] || 0) + 1; S.myUE++; }
        if (pt.how === 'fe') { S.fe[st] = (S.fe[st] || 0) + 1; S.myFE++; }
      } else if (r.by === 'opp') {
        if (pt.how === 'w' || pt.how === 'ace') S.oppWinners++;
        if (pt.how === 'ue') S.oppUE++;
      }
      if (pt.ra && S.rally[pt.ra]) add(S.rally[pt.ra], won);
      run = won ? (run > 0 ? run + 1 : 1) : (run < 0 ? run - 1 : -1);
      S.bestRun = Math.max(S.bestRun, run); S.worstRun = Math.max(S.worstRun, -run);
      prev = r;
    });
    S.pointPct = S.n ? S.won / S.n : 0;
    S.levPct = S.levSum > 0 ? S.levWon / S.levSum : S.pointPct;
    S.clutch = S.n >= 10 ? Math.round((S.levPct - S.pointPct) * 100) : null;
    return S;
  }

  const pct = (a, b) => (b ? a / b : null);
  const P = (x) => Math.round(x * 100) + '%';
  function topKey(obj) { let k = null, v = 0; Object.keys(obj).forEach((x) => { if (x !== '—' && obj[x] > v) { v = obj[x]; k = x; } }); return k ? [k, v] : null; }

  function insights(S) {
    const str = [], fix = [], plan = [];
    if (S.n < 10) return { strengths: str, fixes: fix, plan: ['Chart at least 10 points to unlock coaching insights.'] };
    if (S.clutch !== null && S.clutch >= 4) str.push(`Big-point player: you raised your level by +${S.clutch} on the points that mattered most.`);
    if (S.clutch !== null && S.clutch <= -4) {
      fix.push(`Big points slipped away: your Clutch Score was ${S.clutch}. You played the important points worse than normal ones.`);
      plan.push('When the app shows ⚡, run the 20-second reset and choose your pattern BEFORE the point starts.');
    }
    const svT = S.srv.first + S.srv.second + S.srv.df; // only points where serve detail was entered
    const f1 = svT >= 15 ? S.srv.first / svT : null, w1 = pct(S.srv.firstWon, S.srv.first), w2 = pct(S.srv.secondWon, S.srv.second);
    if (f1 !== null && f1 < 0.55) {
      fix.push(`Only ${P(f1)} first serves in.`);
      plan.push(`First-serve focus: take a little pace off and aim for 65%+ in.${w1 !== null && w2 !== null ? ` You win ${P(w1)} behind a first serve vs ${P(w2)} on a second.` : ''}`);
    } else if (f1 !== null && f1 >= 0.65 && w1 !== null && w1 >= 0.6) str.push(`Serve is a weapon: ${P(f1)} first serves in, won ${P(w1)} of them.`);
    if (w2 !== null && S.srv.second >= 8 && w2 < 0.4) { fix.push(`Second serve got attacked (won only ${P(w2)}).`); plan.push('Second serve: more spin and net clearance. Aim at the backhand and recover fast for the next ball.'); }
    if (S.srv.df >= 4) { fix.push(`${S.srv.df} double faults.`); if (plan.length < 3) plan.push('Double faults: use the same toss and routine every time, brush UP the back of the ball, and aim 3 feet over the net.'); }
    const ue = topKey(S.ue);
    if (ue && ue[1] >= 4 && ue[1] / Math.max(1, S.myUE) >= 0.35) {
      fix.push(`Most unforced errors came from the ${STROKES[ue[0]].toUpperCase()} (${ue[1]} of ${S.myUE}).`);
      plan.push(`${STROKES[ue[0]]}: aim higher over the net and deep middle. Save the lines for short balls.`);
    }
    const wn = topKey(S.winners);
    if (wn && wn[1] >= 3) { str.push(`${STROKES[wn[0]]} is your weapon: ${wn[1]} winners.`); if (plan.length < 3 && wn[0] === 'FH') plan.push('On big points, run around and hit your forehand. That\'s your weapon.'); }
    const bb = pct(S.afterLoss.won, S.afterLoss.n);
    if (bb !== null && S.afterLoss.n >= 15) {
      if (bb < 0.4) { fix.push(`After losing a point you won only ${P(bb)} of the next ones.`); plan.push('Short memory: after a lost point, turn away, switch the racquet to your other hand, breathe out long, and say "next ball".'); }
      else if (bb >= 0.52) str.push(`Great bounce-back: you won ${P(bb)} of points right after losing one.`);
    }
    if (S.bpAg.n >= 3) {
      const sv = S.bpAg.won / S.bpAg.n;
      if (sv >= 0.6) str.push(`The Wall: you saved ${S.bpAg.won} of ${S.bpAg.n} break points.`);
      else if (sv <= 0.4) { fix.push(`You saved only ${S.bpAg.won} of ${S.bpAg.n} break points.`); if (plan.length < 3) plan.push('Break point down: make a high-percentage first serve to the bigger target, then hit your first ball deep crosscourt.'); }
    }
    if (S.bpFor.n >= 3) {
      const cv = S.bpFor.won / S.bpFor.n;
      if (cv >= 0.55) str.push(`Killer returner: converted ${S.bpFor.won} of ${S.bpFor.n} break points.`);
      else if (cv <= 0.35) { fix.push(`Converted only ${S.bpFor.won} of ${S.bpFor.n} break points.`); if (plan.length < 3) plan.push('Break point for you: return deep down the middle and make them hit one more ball. Let THEM feel the pressure.'); }
    }
    const L = pct(S.rally.L.won, S.rally.L.n), Sh = pct(S.rally.S.won, S.rally.S.n);
    if (L !== null && Sh !== null && S.rally.L.n >= 6 && S.rally.S.n >= 6) {
      if (L - Sh >= 0.1) { str.push(`You win the long rallies (${P(L)} of points with 9+ shots).`); if (plan.length < 3) plan.push('Make it a grind: high, heavy crosscourt balls. The longer the point, the better for you.'); }
      else if (Sh - L >= 0.1) { str.push(`Quick-strike player: you win ${P(Sh)} of short points.`); if (plan.length < 3) plan.push('Serve +1: plan your first forehand after the serve and take control early.'); }
    }
    const rw = pct(S.ret.won, S.ret.n);
    if (rw !== null && S.ret.n >= 20 && rw >= 0.5) str.push(`Strong returner: won ${P(rw)} of return points.`);
    if (!plan.length) plan.push('Keep doing what works. Same patterns, same routines, and play every point like it\'s 30-30.');
    return { strengths: str.slice(0, 3), fixes: fix.slice(0, 3), plan: plan.slice(0, 3) };
  }

  function scoreString(state, persp) {
    const me = persp !== 'opp';
    return state.sets.map((s) => {
      const a = me ? s.me : s.opp, b = me ? s.opp : s.me;
      if (s.mtb) return `[${me ? s.tb.me : s.tb.opp}-${me ? s.tb.opp : s.tb.me}]`;
      if (s.tb) return `${a}-${b}(${Math.min(s.tb.me, s.tb.opp)})`;
      return `${a}-${b}`;
    }).join(' ');
  }

  function describe(st) {
    const lab = pointLabels(st);
    const setNo = st.sets.length + 1;
    let pts = lab[0] + '–' + lab[1];
    if (!st.tb && st.p.me >= 3 && st.p.opp >= 3) pts = st.p.me === st.p.opp ? 'Deuce' : st.p.me > st.p.opp ? 'Ad you' : 'Ad opp';
    return { set: st.mtb ? 'Match tiebreak' : 'Set ' + setNo, sets: st.setsWon.me + '–' + st.setsWon.opp,
      games: st.mtb ? '' : st.g.me + '–' + st.g.opp, points: (st.tb && !st.mtb ? 'TB ' : '') + pts, server: st.server };
  }

  const api = { FORMATS, STROKES, BIG, HUGE, other, fmtOf, initState, applyPoint, pointLabels, tags, model, priors,
    replay, rowsStats, insights, scoreString, describe, hitter, tbServer, PRESSURE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this);
