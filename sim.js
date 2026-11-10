/* RALLY IQ — tennis physics, shot execution, movement, opponent AI and strategy coach.
   Pure logic (no DOM) so it can be tested in Node.
   Coordinates in metres: x across the court (0 = centre), y along it (net at y=0),
   z height. "me" plays the bottom half (y<0), "opp" the top half (y>0). */
(function (root) {
  'use strict';
  const G = 9.81, HW = 4.115, DW = 5.485, BL = 11.885, SL = 6.40, NETC = 0.914, NETP = 1.07, POSTX = DW + 0.914, BR = 0.033;
  const REACH = 1.0, RETURN_REACT = 0.42; // reading a serve takes longer than a rally ball

  // v = average horizontal speed (m/s), g = effective gravity multiplier (topspin dips, slice floats),
  // e = bounce restitution (topspin kicks up, slice stays low), keep = horizontal speed kept after bounce,
  // sig/sigZ = execution scatter (m, m/s) before difficulty/skill multipliers.
  const SHOTS = {
    topspin:    { name: 'Topspin',     v: 21, g: 1.40, e: 0.63, keep: 0.72, sig: 0.40, sigZ: 0.30 },
    heavy:      { name: 'Heavy loop',  v: 16.5, g: 1.50, e: 0.59, keep: 0.68, sig: 0.36, sigZ: 0.26 },
    flat:       { name: 'Flat drive',  v: 25, g: 1.00, e: 0.77, keep: 0.80, sig: 0.62, sigZ: 0.40 },
    slice:      { name: 'Slice',       v: 18, g: 0.60, e: 0.62, keep: 0.72, sig: 0.42, sigZ: 0.26 },
    drop:       { name: 'Drop shot',   v: 9,  g: 0.90, e: 0.34, keep: 0.35, sig: 0.55, sigZ: 0.22 },
    lob:        { name: 'Lob',         v: 10, g: 1.00, e: 0.68, keep: 0.70, sig: 0.70, sigZ: 0.35 },
    volley:     { name: 'Volley',      v: 16, g: 1.00, e: 0.75, keep: 0.70, sig: 0.42, sigZ: 0.22 },
    dropvolley: { name: 'Drop volley', v: 7,  g: 1.00, e: 0.48, keep: 0.30, sig: 0.50, sigZ: 0.18 },
    smash:      { name: 'Smash',       v: 27, g: 1.00, e: 0.70, keep: 0.80, sig: 0.55, sigZ: 0.30 },
    sFlat:      { name: 'Flat serve',  v: 30, g: 1.00, e: 0.66, keep: 0.75, sig: 0.60, sigZ: 0.22, serve: true },
    sSlice:     { name: 'Slice serve', v: 26, g: 1.10, e: 0.54, keep: 0.72, sig: 0.50, sigZ: 0.18, serve: true },
    sKick:      { name: 'Kick serve',  v: 21, g: 1.60, e: 0.60, keep: 0.68, sig: 0.38, sigZ: 0.14, serve: true },
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function gauss(rng) { let u = 0; while (!u) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
  function mulberry(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const netH = (x) => NETC + (NETP - NETC) * Math.min(1, Math.abs(x) / POSTX);
  const facing = (p) => -p.side;               // bottom player faces +y
  const fhSign = (p) => facing(p) * p.hand;     // global x-direction of a player's forehand side
  const other = (id) => (id === 'me' ? 'opp' : 'me');

  /* ---------- ball flight ---------- */
  function plan(from, aim, sh, noise) {
    noise = noise || {};
    const tx = aim.x + (noise.dx || 0), ty = aim.y + (noise.dy || 0);
    let dx = tx - from.x, dy = ty - from.y; let d = Math.hypot(dx, dy); if (d < 0.5) { d = 0.5; }
    // shorter shots (angles, short balls) are hit with less pace, like in real tennis
    const distF = sh.serve ? 1 : Math.pow(clamp(d / 22, 0.5, 1.1), 0.8);
    const ux = dx / d, uy = dy / d, v = sh.v * distF * (noise.pow || 1), g = G * sh.g;
    const T = d / v;
    const vz = (0.5 * g * T * T - from.z) / T + (noise.dz || 0);
    const tl = (vz + Math.sqrt(vz * vz + 2 * g * from.z)) / g;
    const land = { x: from.x + ux * v * tl, y: from.y + uy * v * tl };
    const post = { vx: ux * v * sh.keep, vy: uy * v * sh.keep, vz: -(vz - g * tl) * sh.e };
    const tb2 = tl + (2 * post.vz) / G;
    const tr = { from, ux, uy, v, vz, g, tl, land, post, tb2, sh, net: false, tNet: null };
    if (Math.abs(uy) > 1e-6) {
      const tn = -from.y / (uy * v);
      if (tn > 0 && tn < tl) {
        const zn = from.z + vz * tn - 0.5 * g * tn * tn, xn = from.x + ux * v * tn;
        tr.tNet = tn; tr.netClear = zn - netH(xn);
        if (zn < netH(xn) + BR) tr.net = true;
      } else if (Math.sign(land.y) === Math.sign(from.y) || Math.abs(land.y) < 0.01) { tr.net = true; tr.tNet = Math.max(0.05, Math.min(tl, tn > 0 ? tn : tl)); tr.netClear = -1; }
    }
    return tr;
  }
  function pos(tr, t) {
    if (tr.net && t >= tr.tNet) { // ball stopped by the net, drops down
      const p = pos(Object.assign({}, tr, { net: false }), tr.tNet); const u = t - tr.tNet;
      return { x: p.x, y: p.y - Math.sign(tr.uy) * 0.15, z: Math.max(0, p.z - 0.5 * G * u * u) };
    }
    if (t <= tr.tl) return { x: tr.from.x + tr.ux * tr.v * t, y: tr.from.y + tr.uy * tr.v * t, z: tr.from.z + tr.vz * t - 0.5 * tr.g * t * t };
    let u = t - tr.tl, vz = tr.post.vz, x = tr.land.x, y = tr.land.y, f = 1;
    // keep bouncing (lower each time) for display after the second bounce
    let flight = (2 * vz) / G;
    while (u > flight && flight > 0.02) { x += tr.post.vx * f * flight; y += tr.post.vy * f * flight; u -= flight; vz *= 0.6; f *= 0.85; flight = (2 * vz) / G; }
    return { x: x + tr.post.vx * f * u, y: y + tr.post.vy * f * u, z: Math.max(0, vz * u - 0.5 * G * u * u) };
  }
  function judge(tr, serveBox) { // → {res:'net'|'out'|'in', by: metres out}
    if (tr.net) return { res: 'net', by: 0 };
    const s = -Math.sign(tr.from.y), L = tr.land;
    let out = Math.max(0, Math.abs(L.x) - (HW + BR));
    if (serveBox) {
      out = Math.max(out, s * L.y - (SL + BR), serveBox * L.x < -BR ? -serveBox * L.x - BR : 0);
    } else out = Math.max(out, s * L.y - (BL + BR));
    if (s * L.y < 0) out = Math.max(out, 0.01);
    return out > 0 ? { res: 'out', by: out } : { res: 'in', by: 0 };
  }

  /* ---------- reaching the ball ---------- */
  function intercept(tr, pl, react) {
    if (react == null) react = pl.react;
    let best = null, bestCost = 1e9;
    const canVolley = Math.abs(pl.pos.y) < 8;
    for (let t = 0.1; t <= tr.tb2 + 1e-9; t += 0.02) {
      const b = pos(tr, t);
      if (Math.sign(b.y) !== pl.side || Math.abs(b.y) < 0.5) continue;
      const pre = t < tr.tl;
      if (pre) { if (!canVolley || b.z < 0.3 || b.z > 2.9) continue; }
      else if (b.z < 0.15 || b.z > 2.2) continue;
      const dist = Math.max(0, Math.hypot(b.x - pl.pos.x, b.y - pl.pos.y) - REACH);
      const avail = Math.max(0, t - react) * pl.speed;
      if (dist > avail + 1e-9) continue;
      const need = avail > 0 ? dist / avail : 0;
      const cost = pre ? t * 0.3 - 1 : Math.abs(b.z - 1.0) + 0.1 * t + need * 0.3;
      if (cost < bestCost) { bestCost = cost; best = { t, p: b, need, volley: pre, smash: pre && b.z > 2.05, dist }; }
      if (pre) break;
    }
    return best;
  }
  function speedAt(tr, t) { return t <= tr.tl ? tr.v : tr.v * tr.sh.keep; }
  function difficulty(ic, incoming) {
    let d = 1 + 1.5 * ic.need * ic.need; const z = ic.p.z;
    if (!ic.volley) { if (z < 0.45) d += 0.35; if (z > 1.55) d += 0.3; if (Math.abs(ic.p.y) > BL + 1.8) d += 0.2; }
    else if (z < 0.6) d += 0.45;
    d += Math.max(0, incoming - 15) * 0.025;
    return d;
  }
  function strokeSide(pl, ballX) { return (ballX - pl.pos.x) * fhSign(pl) > -0.35 ? 'FH' : 'BH'; }

  /* ---------- hitting ---------- */
  function sigmaFor(pl, shotKey, stroke, diff) {
    const sh = SHOTS[shotKey];
    const sk = sh.serve ? pl.skill.SRV : (shotKey === 'volley' || shotKey === 'dropvolley' || shotKey === 'smash') ? pl.skill.VOL : pl.skill[stroke];
    return sh.sig * diff * sk;
  }
  function execute(pl, from, aim, shotKey, sigma, rng) {
    const sh = SHOTS[shotKey];
    const noise = { dx: gauss(rng) * sigma * 0.9, dy: gauss(rng) * sigma * 1.2, dz: gauss(rng) * sh.sigZ * (sigma / sh.sig), pow: pl.power * (1 + gauss(rng) * 0.03) };
    return plan(from, aim, sh, noise);
  }
  const RISK_RNG_SEED = 1234;
  function errorRisk(pl, from, aim, shotKey, sigma, serveBox, n) {
    n = n || 80; const rng = mulberry(RISK_RNG_SEED); let bad = 0;
    for (let i = 0; i < n; i++) { if (judge(execute(pl, from, aim, shotKey, sigma, rng), serveBox).res !== 'in') bad++; }
    return bad / n;
  }

  /* ---------- targets ---------- */
  function zones(contact, tgt) {
    const s = tgt.side;
    const cross = Math.abs(contact.x) > 0.5 ? -Math.sign(contact.x) : -Math.sign(contact.x || 1);
    const bh = -fhSign(tgt);
    return {
      cross: { x: cross * 2.5, y: s * 10.0 }, line: { x: -cross * 2.6, y: s * 10.0 }, middle: { x: 0, y: s * 10.3 },
      angle: { x: cross * 3.3, y: s * 4.9 }, drop: { x: clamp(tgt.pos.x * -0.4 + cross * 0.8, -2.5, 2.5), y: s * 2.3 },
      lob: { x: bh * 1.8, y: s * 9.9 }, weak: { x: bh * 2.6, y: s * 10.0 },
      body: { x: clamp(tgt.pos.x, -3, 3), y: s * clamp(Math.abs(tgt.pos.y) - 0.6, 3.5, 10.4) },
    };
  }
  function serveSetup(server, receiver, deuce) {
    const boxSign = deuce ? facing(receiver) : -facing(receiver);
    const sx = (deuce ? facing(server) : -facing(server)) * 0.8;
    const s = receiver.side;
    return {
      boxSign, serverPos: { x: sx, y: server.side * (BL + 0.3) }, receiverPos: { x: boxSign * 2.6, y: s * (BL + 0.9) },
      contact: { x: sx, y: server.side * (BL + 0.1), z: 2.45 },
      targets: { wide: { x: boxSign * 3.55, y: s * (SL - 0.75) }, body: { x: boxSign * 2.0, y: s * (SL - 0.8) }, t: { x: boxSign * 0.45, y: s * (SL - 0.75) } },
    };
  }
  function recovery(pl, landX, atNet) {
    if (atNet) return { x: clamp(landX * 0.45, -2.5, 2.5), y: pl.side * 3.0 };
    return { x: clamp(landX * 0.3, -1.6, 1.6), y: pl.side * (BL + (pl.style && pl.style.deep ? 2.2 : 0.8)) };
  }

  /* ---------- opponent AI ---------- */
  function aiChoose(ctx) {
    const pl = ctx.striker, tgt = ctx.target, st = pl.style, rng = ctx.rng;
    const Z = zones(ctx.contact, tgt);
    let types;
    if (ctx.smash) types = ['smash'];
    else if (ctx.volley) types = ['volley', 'dropvolley'];
    else types = st.shots;
    const cands = [];
    types.forEach((ty) => {
      let names = ty === 'drop' || ty === 'dropvolley' ? ['drop'] : ty === 'lob' ? ['lob'] : ['cross', 'line', 'middle', 'angle', 'weak', 'body'];
      names.forEach((nm) => {
        if (nm === 'angle' && ty !== 'topspin' && ty !== 'slice' && ty !== 'volley') return;
        const aim = Z[nm];
        const sigma = sigmaFor(pl, ty, ctx.stroke, ctx.diff);
        const err = errorRisk(pl, ctx.contact, aim, ty, sigma, 0, 14);
        const tr = plan(ctx.contact, aim, SHOTS[ty]);
        const ic = intercept(tr, tgt);
        let val = !ic ? 1.6 : 0.2 + 1.2 * ic.need * ic.need + 0.1 * (speedAt(tr, ic.t) / 20);
        if (ic && Math.abs(tr.land.y) < 7 && ty !== 'drop' && ty !== 'dropvolley') val -= 0.25;
        if (ty === 'lob' && Math.abs(tgt.pos.y) > 7) val -= 0.35; // lobbing a baseliner just gives them a smash/attack
        if (ty === 'drop' && Math.abs(tgt.pos.y) < BL) val -= 0.3;
        const score = (1 - err) * val * st.aggr - err * st.care + (st.pref && st.pref[ty] ? st.pref[ty] : 0);
        cands.push({ ty, nm, aim, score });
      });
    });
    const mx = Math.max(...cands.map((c) => c.score));
    const w = cands.map((c) => Math.exp((c.score - mx) / st.temp)); const tot = w.reduce((a, b) => a + b, 0);
    let r = rng() * tot, pick = cands[0];
    for (let i = 0; i < cands.length; i++) { if ((r -= w[i]) <= 0) { pick = cands[i]; break; } }
    const inside = Math.abs(ctx.contact.y) < BL - 1.5;
    const approach = !ctx.volley && !ctx.smash && inside && ctx.need < 0.5 && rng() < st.net && pick.ty !== 'drop' && pick.ty !== 'lob';
    return { type: pick.ty, aim: pick.aim, zone: pick.nm, approach };
  }
  function aiServe(pl, setup, second, rng) {
    const st = pl.style;
    const type = second ? (rng() < 0.7 ? 'sKick' : 'sSlice') : (rng() < st.flatServe ? 'sFlat' : rng() < 0.6 ? 'sSlice' : 'sKick');
    const names = ['wide', 'body', 't']; const nm = names[Math.floor(rng() * 3)];
    const aim = Object.assign({}, setup.targets[nm]);
    if (second) aim.y *= 0.88;
    return { type, aim, zone: nm };
  }

  /* ---------- strategy coach ---------- */
  function situation(ctx) {
    const c = ctx.contact, o = ctx.target;
    if (ctx.smash) return 'smash';
    if (ctx.volley) return 'volley';
    if (ctx.need > 0.72 || (Math.abs(c.y) > BL + 1.5 && ctx.incoming > 18)) return 'defense';
    if (Math.abs(o.pos.y) < 6.5) return 'pass';
    if (Math.abs(c.y) < BL - 2.2 && ctx.need < 0.6 && c.z > 0.5) return 'attack';
    return 'neutral';
  }
  const SITUATION_LABEL = { defense: 'STRETCHED: defend', pass: 'OPPONENT AT NET', attack: 'SHORT BALL: attack!', neutral: 'NEUTRAL RALLY', volley: 'VOLLEY', smash: 'OVERHEAD!' };
  function describeAim(ctx, aim) {
    const c = ctx.contact, o = ctx.target;
    const cross = Math.abs(c.x) > 0.5 ? -Math.sign(c.x) : -Math.sign(c.x || 1);
    const depth = Math.abs(aim.y), margin = Math.min(HW - Math.abs(aim.x), BL - depth);
    const dir = Math.abs(aim.x) < 1.0 ? 'middle' : Math.sign(aim.x) === cross ? 'cross' : 'line';
    const bh = -fhSign(o);
    return { dir, depth, margin, deep: depth > 8.3, short: depth < 6.5, toBH: Math.sign(aim.x) === bh && Math.abs(aim.x) > 1.2,
      openCourt: Math.abs(o.pos.x) > 1.6 && Math.sign(aim.x) === -Math.sign(o.pos.x) && Math.abs(aim.x) > 1.5,
      atBody: Math.abs(aim.x - o.pos.x) < 1.2 };
  }
  function coach(ctx, choice) {
    const sit = situation(ctx), a = describeAim(ctx, choice.aim), ty = choice.type, o = ctx.target;
    const notes = [];
    const add = (r, msg) => notes.push({ r, msg });
    const weakBH = o.style && o.style.weak === 'BH';
    if (a.margin < 0.45 && !['drop', 'dropvolley', 'lob'].includes(ty)) add(-1, 'You aimed within half a metre of the line. Even pros miss there a lot. Give yourself about 1 m of margin.');
    if (sit === 'defense') {
      if (ty === 'flat') add(-2, 'You were stretched. A flat drive from there misses a lot. Defend high and heavy, or with slice, to buy time.');
      else if (a.dir === 'line' && ty !== 'lob') add(-2, 'Down the line from defense goes over the HIGHER part of the net and opens your court. Defend crosscourt.');
      else if (['heavy', 'topspin', 'slice'].includes(ty) && a.dir !== 'line' && a.deep) add(2, 'Great defense: deep and crosscourt gives you time to recover.');
      else if (ty === 'lob' && a.deep) add(1, 'Good: a high defensive lob buys you time.');
      else if (ty === 'drop') add(-1, 'Drop shots from defense rarely work. You can\'t disguise them when you\'re stretched.');
    } else if (sit === 'pass') {
      if (ty === 'lob') add(a.deep ? 2 : -1, a.deep ? 'Lob over the net player. Smart!' : 'A short lob is a smash waiting to happen. Lob DEEP.');
      else if (ty === 'heavy') add(-2, 'A slow, loopy ball gives the net player an easy volley. Pass low, or lob.');
      else if (a.atBody) add(1, 'Low at the net player\'s feet makes volleying very hard. Good choice.');
      else if (Math.abs(choice.aim.x) > 2.3 && ['topspin', 'slice', 'flat'].includes(ty)) add(2, 'Good passing shot: low and away from the net player.');
      else add(-1, 'Against a net player, pass wide or lob. Don\'t hit it back to them.');
    } else if (sit === 'attack') {
      if (['heavy', 'lob'].includes(ty) || (ty === 'slice' && !choice.approach)) add(-1, 'Short ball! That was your chance to attack. Step in and hit to the open court, or come to the net.');
      else if (ty === 'drop') add(Math.abs(o.pos.y) > BL + 0.8 ? 2 : 0, Math.abs(o.pos.y) > BL + 0.8 ? 'Drop shot from inside the court vs a deep opponent. Perfect timing.' : 'Drop shot is OK here, but it works best when they\'re far behind the baseline.');
      else if ((a.openCourt || a.toBH) && a.deep) add(2, 'You attacked the short ball into the ' + (a.openCourt ? 'open court' : 'backhand') + '. That\'s how you take control.');
      else if (a.deep) add(1, 'Good, you were aggressive on the short ball.');
      if (choice.approach) add(a.dir === 'line' ? 2 : 1, a.dir === 'line' ? 'Approach down the line, then cover the line. A classic pattern.' : 'Good idea to come in. Approaching down the line is usually even better.');
    } else if (sit === 'volley') {
      if (ty === 'dropvolley') add(Math.abs(o.pos.y) > BL - 0.5 ? 2 : -1, Math.abs(o.pos.y) > BL - 0.5 ? 'Drop volley with the opponent deep. Great touch and timing.' : 'Drop volley vs a player who is already close = easy ball for them.');
      else if (a.openCourt || (Math.abs(choice.aim.x) > 2 && !a.atBody)) add(2, 'Volley into the open court, away from the opponent. That\'s the way.');
      else if (a.atBody && Math.abs(o.pos.y) > 9) add(-1, 'You volleyed right back to the baseliner. Aim for the open court or a sharp angle.');
    } else if (sit === 'smash') {
      add(a.margin < 0.45 ? -1 : 2, a.margin < 0.45 ? 'Smash with a margin. Aim big targets.' : 'Put it away! Overheads should go to big targets with margin.');
    } else {
      if (ty === 'drop') add(Math.abs(o.pos.y) > BL + 1.5 && Math.abs(ctx.contact.y) < BL ? 2 : -1, Math.abs(o.pos.y) > BL + 1.5 ? 'Drop shot vs a deep opponent. Smart.' : 'Drop shot from a neutral rally against a player near the baseline is low-percentage.');
      else if (weakBH && a.toBH && a.deep) add(2, 'You found the weak backhand! Keep pressing it, especially on big points.');
      else if (a.openCourt && a.deep) add(1, 'Hit to the open court. Make them run.');
      else if (a.dir === 'cross' && a.deep && ['topspin', 'heavy'].includes(ty)) add(1, 'Smart rally ball: crosscourt and deep. The net is lower in the middle and the court is longer diagonally.');
      else if (a.dir === 'line' && ty === 'flat') add(-1, 'Changing direction with a flat drive from a neutral ball is risky. Go down the line when the ball is short and in your strike zone.');
      else if (a.short && Math.abs(choice.aim.x) > 2.7) add(Math.abs(ctx.contact.x) > 2.5 ? 1 : -1, Math.abs(ctx.contact.x) > 2.5 ? 'Short angle from a wide ball: great use of court geometry.' : 'Short angles work best from a wide ball. From the middle of the court they land short and sit up for your opponent.');
      else if (a.short && ty !== 'slice') add(-1, 'A short rally ball invites your opponent to attack. Keep it deep.');
      else if (ty === 'lob') add(-1, 'Lobbing a baseliner gives them an easy, high ball. Save the lob for when they are at the net or you are in trouble.');
    }
    if (!notes.length) return { r: 0, msg: '', sit };
    const r = clamp(notes.reduce((s, n) => s + n.r, 0), -2, 2);
    const key = notes.slice().sort((x, y) => (r < 0 ? x.r - y.r : y.r - x.r))[0];
    return { r, msg: key.msg, sit };
  }
  function coachServe(server, choice, second, receiver) {
    if (second && choice.type === 'sFlat') return { r: -2, msg: 'Second serve: use kick or slice. Spin brings the ball down into the box, and a double fault gives away the point for free.' };
    if (second && choice.type === 'sKick') return { r: 1, msg: 'Kick second serve: safe and it bounces high to the opponent. Smart.' };
    if (!second && receiver.style && receiver.style.weak === 'BH' && Math.sign(choice.aim.x) === -fhSign(receiver)) return { r: 2, msg: 'Serving to the weak backhand. Great scouting!' };
    return { r: 0, msg: '' };
  }

  /* ---------- players ---------- */
  function makePlayer(id, o) {
    o = o || {};
    return { id, side: id === 'me' ? -1 : 1, hand: o.hand || 1, speed: o.speed || 5.6, react: o.react || 0.25, power: o.power || 1,
      skill: Object.assign({ FH: 1, BH: 1, VOL: 1, SRV: 1 }, o.skill || {}), style: o.style || null, pos: { x: 0, y: (id === 'me' ? -1 : 1) * (BL + 0.8) } };
  }

  function moveToward(p, t, maxD) { const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy); if (d <= maxD || d < 1e-9) return { x: t.x, y: t.y }; return { x: p.x + (dx / d) * maxD, y: p.y + (dy / d) * maxD }; }

  /* ---------- headless point simulation (for testing / balancing) ---------- */
  function simulatePoint(players, serverId, deuce, rng, chooseMe) {
    const srv = players[serverId], rcv = players[other(serverId)];
    const setup = serveSetup(srv, rcv, deuce);
    srv.pos = Object.assign({}, setup.serverPos); rcv.pos = Object.assign({}, setup.receiverPos);
    let tr = null, shots = 0;
    for (let k = 0; k < 2; k++) {
      const sv = aiServe(srv, setup, k === 1, rng);
      const t = execute(srv, setup.contact, sv.aim, sv.type, sigmaFor(srv, sv.type, 'FH', 1), rng);
      const j = judge(t, setup.boxSign);
      if (j.res === 'in') { tr = t; break; }
      if (k === 1) return { winner: rcv.id, how: 'df', shots: 0 };
    }
    let striker = rcv, hitter = srv; shots = 1;
    srv.pos = recovery(srv, tr.land.x, false);
    while (shots < 200) {
      const ic = intercept(tr, striker, shots === 1 ? RETURN_REACT : null);
      if (!ic) return { winner: hitter.id, how: shots === 1 ? 'ace' : 'winner', shots, last: tr.sh.name, lastLand: tr.land };
      const incoming = speedAt(tr, ic.t);
      const stroke = strokeSide(striker, ic.p.x);
      const contact = { x: ic.p.x, y: ic.p.y, z: ic.p.z };
      const diff = difficulty(ic, incoming);
      // the striker moves to the ball; the other player recovers meanwhile
      striker.pos = { x: ic.p.x - fhSign(striker) * (stroke === 'FH' ? 0.6 : -0.6), y: ic.p.y };
      const ctx = { striker, target: hitter, contact, diff, stroke, volley: ic.volley, smash: ic.smash, need: ic.need, incoming, rng };
      const ch = (chooseMe && striker.id === 'me') ? chooseMe(ctx) : aiChoose(ctx);
      const nt = execute(striker, contact, ch.aim, ch.type, sigmaFor(striker, ch.type, stroke, diff), rng);
      shots++;
      const j = judge(nt, 0);
      if (j.res !== 'in') return { winner: hitter.id, how: j.res, shots, errBy: striker.id };
      // the hitter now runs back toward a recovery spot; they only get as far as time allows
      const rec = recovery(striker, nt.land.x, ch.approach || Math.abs(contact.y) < 7);
      const icNext = intercept(nt, hitter);
      striker.pos = moveToward(striker.pos, rec, striker.speed * Math.max(0, (icNext ? icNext.t : nt.tl) - 0.15));
      tr = nt; const tmp = striker; striker = hitter; hitter = tmp;
    }
    return { winner: 'me', how: 'limit', shots };
  }

  const api = { G, HW, DW, BL, SL, NETC, NETP, POSTX, SHOTS, clamp, gauss, mulberry, netH, facing, fhSign, other, plan, pos, judge, intercept, speedAt,
    difficulty, strokeSide, sigmaFor, execute, errorRisk, zones, serveSetup, recovery, aiChoose, aiServe, situation, SITUATION_LABEL, describeAim,
    coach, coachServe, makePlayer, simulatePoint, moveToward, RETURN_REACT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sim = api;
})(typeof self !== 'undefined' ? self : this);
