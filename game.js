/* RALLY IQ — game UI, rendering and match flow. */
(function () {
  'use strict';
  const S = window.Sim, SC = window.Engine, R = window.Roster.ROSTER;
  const $ = (id) => document.getElementById(id);
  const $screen = $('screen'), $game = $('game'), $hud = $('hud'), $panel = $('panel'), $modal = $('modal'), $toast = $('toast'), cv = $('cv'), g = cv.getContext('2d');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- saved progress ---------------- */
  const KEY = 'rallyiq.v1';
  const DEF = { name: '', hand: 1, mode: 'learn', sound: true, format: 'quick', unlocked: 0, stars: {}, totals: { matches: 0, wins: 0, smart: 0, risky: 0 } };
  let P; try { P = Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { P = Object.assign({}, DEF); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} };
  const myName = () => (P.name || 'You').trim();

  /* ---------------- sound (synthesised, no files) ---------------- */
  let AC = null, NB = null;
  function ac() {
    if (!P.sound) return null;
    try { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) { return null; }
    if (!NB) { NB = AC.createBuffer(1, AC.sampleRate * 0.6, AC.sampleRate); const d = NB.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    return AC;
  }
  function snd(type, vol) {
    const a = ac(); if (!a) return; vol = vol == null ? 1 : vol; const t = a.currentTime;
    const burst = (freq, q, dur, v, ftype) => {
      const s = a.createBufferSource(); s.buffer = NB; const f = a.createBiquadFilter(); f.type = ftype || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const gn = a.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(v, t + 0.004); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(gn).connect(a.destination); s.start(t); s.stop(t + dur + 0.02);
    };
    if (type === 'hit') {
      burst(1500, 1.4, 0.06, 0.8 * vol);
      const o = a.createOscillator(); o.frequency.setValueAtTime(340, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.05);
      const g2 = a.createGain(); g2.gain.setValueAtTime(0.45 * vol, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.07); o.connect(g2).connect(a.destination); o.start(t); o.stop(t + 0.08);
    } else if (type === 'bounce') burst(650, 0.9, 0.05, 0.35 * vol);
    else if (type === 'net') burst(220, 0.7, 0.14, 0.6 * vol, 'lowpass');
    else if (type === 'cheer') {
      const s = a.createBufferSource(); s.buffer = NB; s.loop = true; const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2000; f.Q.value = 0.4;
      const gn = a.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(0.18 * vol, t + 0.2); gn.gain.linearRampToValueAtTime(0.0001, t + 1.6);
      s.connect(f).connect(gn).connect(a.destination); s.start(t); s.stop(t + 1.7);
    } else if (type === 'ooh') {
      const o = a.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(260, t); o.frequency.linearRampToValueAtTime(180, t + 0.5);
      const gn = a.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(0.08 * vol, t + 0.1); gn.gain.linearRampToValueAtTime(0.0001, t + 0.6); o.connect(gn).connect(a.destination); o.start(t); o.stop(t + 0.65);
    }
  }

  /* ---------------- camera / projection ---------------- */
  let CW = 0, CH = 0, DPR = 1, CAM = { camY: -30, F: 500, camH: 15, H0: 0 };
  function resize() {
    const r = cv.parentElement.getBoundingClientRect(); if (!r.width) return;
    DPR = Math.min(2.5, window.devicePixelRatio || 1); CW = r.width; CH = r.height;
    cv.width = Math.round(CW * DPR); cv.height = Math.round(CH * DPR);
    const camY = -30, F = (0.94 * CW * (-S.BL - camY)) / (2 * (S.DW + 0.6));
    const dN = -S.BL - 3.0 - camY, dF = S.BL + 2.2 - camY, top = 26, bot = 8;
    const camH = S.clamp((CH - top - bot) / (F * (1 / dN - 1 / dF)), 3, 40);
    CAM = { camY, F, camH, H0: top - (camH * F) / dF };
  }
  function P3(x, y, z) { const d = Math.max(0.5, y - CAM.camY); return { x: CW / 2 + (x * CAM.F) / d, y: CAM.H0 + ((CAM.camH - (z || 0)) * CAM.F) / d, s: CAM.F / d }; }
  function unP(sx, sy) { const den = sy - CAM.H0; if (den <= 0) return null; const d = (CAM.camH * CAM.F) / den; return { x: ((sx - CW / 2) * d) / CAM.F, y: CAM.camY + d }; }

  /* ---------------- drawing ---------------- */
  function poly(pts, fill) { g.beginPath(); pts.forEach((p, i) => { const q = P3(p[0], p[1], p[2] || 0); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.closePath(); g.fillStyle = fill; g.fill(); }
  function ln(x1, y1, x2, y2, w) { const a = P3(x1, y1, 0), b = P3(x2, y2, 0); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineWidth = Math.max(1, (w * (a.s + b.s)) / 2); g.stroke(); }
  function drawCourt() {
    const sky = g.createLinearGradient(0, 0, 0, CH * 0.3); sky.addColorStop(0, '#0d1b33'); sky.addColorStop(1, '#173b2c');
    g.fillStyle = sky; g.fillRect(0, 0, CW, CH);
    poly([[-S.DW - 4, -S.BL - 7], [S.DW + 4, -S.BL - 7], [S.DW + 4, S.BL + 7], [-S.DW - 4, S.BL + 7]], '#3B7A55');
    // back wall / fence hint
    const fz = P3(0, S.BL + 7, 0), fz2 = P3(0, S.BL + 7, 3);
    g.fillStyle = '#12301f'; g.fillRect(0, fz2.y, CW, fz.y - fz2.y);
    poly([[-S.DW, -S.BL], [S.DW, -S.BL], [S.DW, S.BL], [-S.DW, S.BL]], '#2F62A8');
    g.strokeStyle = 'rgba(255,255,255,.95)'; const W = 0.055;
    ln(-S.DW, -S.BL, S.DW, -S.BL, W); ln(-S.DW, S.BL, S.DW, S.BL, W);
    [-S.DW, S.DW, -S.HW, S.HW].forEach((x) => ln(x, -S.BL, x, S.BL, W));
    ln(-S.HW, -S.SL, S.HW, -S.SL, W); ln(-S.HW, S.SL, S.HW, S.SL, W); ln(0, -S.SL, 0, S.SL, W);
    ln(0, -S.BL, 0, -S.BL + 0.15, W); ln(0, S.BL, 0, S.BL - 0.15, W);
  }
  function drawNet() {
    const N = 24, top = [];
    for (let i = 0; i <= N; i++) { const x = -S.POSTX + (2 * S.POSTX * i) / N; top.push(P3(x, 0, S.netH(x))); }
    const base = [P3(S.POSTX, 0, 0), P3(-S.POSTX, 0, 0)];
    g.beginPath(); top.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); base.forEach((p) => g.lineTo(p.x, p.y)); g.closePath();
    g.fillStyle = 'rgba(10,14,22,.55)'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
    for (let i = 0; i <= N; i++) { const x = -S.POSTX + (2 * S.POSTX * i) / N, a = P3(x, 0, 0), b = P3(x, 0, S.netH(x)); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, 0.05 * top[N / 2].s); g.beginPath(); top.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
    [-S.POSTX, S.POSTX].forEach((x) => { const a = P3(x, 0, 0), b = P3(x, 0, S.NETP + 0.05); g.strokeStyle = '#c9d2e3'; g.lineWidth = Math.max(2, 0.08 * a.s); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); });
  }
  function drawPlayer(pl, color, now) {
    const f = P3(pl.pos.x, pl.pos.y, 0), s = f.s;
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(f.x, f.y, 0.42 * s, 0.13 * s, 0, 0, 7); g.fill();
    const hip = P3(pl.pos.x, pl.pos.y, 0.78), sh = P3(pl.pos.x, pl.pos.y, 1.22), head = P3(pl.pos.x, pl.pos.y, 1.42);
    const run = Math.sin((pl.stride || 0) * 2.2) * 0.18;
    g.strokeStyle = '#1b1f2a'; g.lineCap = 'round'; g.lineWidth = Math.max(2, 0.11 * s);
    [[-0.13, run], [0.13, -run]].forEach(([dx, r]) => { const ft = P3(pl.pos.x + dx + r * 0.5, pl.pos.y + r, 0); g.beginPath(); g.moveTo(hip.x + dx * s * 0.6, hip.y); g.lineTo(ft.x, ft.y); g.stroke(); });
    g.fillStyle = color; const bw = 0.42 * s; g.beginPath(); g.roundRect ? g.roundRect(hip.x - bw / 2, sh.y, bw, hip.y - sh.y + 0.05 * s, 0.1 * s) : g.rect(hip.x - bw / 2, sh.y, bw, hip.y - sh.y); g.fill();
    g.fillStyle = '#e8c39b'; g.beginPath(); g.arc(head.x, head.y, Math.max(2, 0.13 * s), 0, 7); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(head.x, head.y - 0.04 * s, Math.max(2, 0.135 * s), Math.PI, 0); g.fill();
    // arm + racquet: swings across the body on contact
    const side = (pl.strokeSide === 'BH' ? -1 : 1) * Math.sign(S.fhSign(pl)) * (pl.side < 0 ? 1 : 1);
    const el = (now - (pl.swingAt || -1e9)) / 260;
    let ang = el >= 0 && el < 1 ? (-1.3 + 2.8 * el) : -0.4;
    const sx = sh.x + side * bw * 0.45, sy = sh.y + 0.05 * s;
    const L = 0.62 * s, dir = side;
    const rx = sx + dir * Math.cos(ang) * L * 0.9, ry = sy + Math.sin(-ang) * L * 0.5 + 0.18 * s;
    g.strokeStyle = '#e8c39b'; g.lineWidth = Math.max(1.5, 0.07 * s); g.beginPath(); g.moveTo(sx, sy); g.lineTo((sx + rx) / 2, (sy + ry) / 2); g.stroke();
    g.strokeStyle = '#20242e'; g.lineWidth = Math.max(1.2, 0.04 * s); g.beginPath(); g.moveTo((sx + rx) / 2, (sy + ry) / 2); g.lineTo(rx, ry); g.stroke();
    g.strokeStyle = '#f2f2f2'; g.lineWidth = Math.max(1, 0.03 * s); g.beginPath(); g.ellipse(rx + dir * 0.1 * s, ry, Math.max(2, 0.13 * s), Math.max(2.5, 0.17 * s), dir * 0.6, 0, 7); g.stroke();
  }
  function drawBall(b) {
    const sh = P3(b.x, b.y, 0), p = P3(b.x, b.y, b.z), r = Math.max(2.6, 0.075 * p.s);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(sh.x, sh.y, r * 1.1, r * 0.45, 0, 0, 7); g.fill();
    g.fillStyle = '#E4FF4F'; g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke();
  }
  function drawMarks(now) {
    M.marks = M.marks.filter((m) => now - m.at < 2600);
    M.marks.forEach((m) => {
      const p = P3(m.x, m.y, 0), a = 1 - (now - m.at) / 2600;
      g.fillStyle = m.out ? `rgba(255,92,114,${a})` : `rgba(255,255,255,${0.6 * a})`;
      g.beginPath(); g.ellipse(p.x, p.y, Math.max(3, 0.1 * p.s), Math.max(1.5, 0.04 * p.s), 0, 0, 7); g.fill();
      if (m.out) { g.fillStyle = `rgba(255,140,155,${a})`; g.font = '800 13px -apple-system,Segoe UI,sans-serif'; g.textAlign = 'center'; g.fillText('OUT ' + Math.max(1, Math.round(m.by * 100)) + 'cm', p.x, p.y - 8); }
    });
  }
  function drawAim() {
    if (!D || !D.aim) return;
    const ctx = D.ctx, sh = S.SHOTS[D.type];
    const tr = S.plan(D.serve ? M.su.contact : ctx.contact, D.aim, sh);
    const col = D.risk < 0.12 ? '#3BE38A' : D.risk < 0.28 ? '#FFC94A' : '#FF5C72';
    g.setLineDash([5, 6]); g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i <= 30; i++) { const t = (tr.tl * i) / 30, b = S.pos(tr, t), p = P3(b.x, b.y, b.z); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }
    g.stroke(); g.setLineDash([]);
    const a = P3(D.aim.x, D.aim.y, 0);
    g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); g.ellipse(a.x, a.y, Math.max(8, 0.55 * a.s), Math.max(3.5, 0.22 * a.s), 0, 0, 7); g.stroke();
    g.beginPath(); g.ellipse(a.x, a.y, Math.max(3, 0.2 * a.s), Math.max(1.5, 0.08 * a.s), 0, 0, 7); g.fillStyle = col; g.fill();
    if (!D.serve && P.mode === 'learn' && ctx) { // where you'll make contact
      const c = P3(ctx.contact.x, ctx.contact.y, 0); g.strokeStyle = 'rgba(220,255,74,.6)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(c.x, c.y, 0.35 * c.s, 0.12 * c.s, 0, 0, 7); g.stroke();
    }
  }
  function draw(now) {
    if (!CW) return;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawCourt(); drawMarks(now);
    const items = [];
    const me = M.players.me, op = M.players.opp;
    items.push({ y: op.pos.y, f: () => drawPlayer(op, M.o.color, now) });
    items.push({ y: me.pos.y, f: () => drawPlayer(me, '#DCFF4A', now) });
    items.push({ y: 0, f: drawNet });
    const b = ballPos(); if (b) items.push({ y: b.y + (b.y > 0 ? 0.01 : -0.01), f: () => drawBall(b) });
    items.sort((a, c) => c.y - a.y).forEach((it) => it.f());
    drawAim();
  }
  function ballPos() {
    if (M.tr) return S.pos(M.tr, M.t);
    if (M.phase === 'serve' || M.phase === 'faultwait') { const sv = M.players[M.score.server]; const bob = Math.abs(Math.sin(performance.now() / 300)) * 0.5; return { x: sv.pos.x + S.fhSign(sv) * -0.25, y: sv.pos.y, z: 0.9 + bob }; }
    return null;
  }

  /* ---------------- match flow ---------------- */
  let M = null, D = null;
  function newMatch(oi) {
    const o = R[oi];
    const me = S.makePlayer('me', { hand: P.hand, speed: 5.6 });
    const op = S.makePlayer('opp', { hand: o.hand || 1, speed: o.speed, power: o.power, skill: o.skill, style: o.style });
    const fmt = SC.fmtOf({ format: P.format });
    M = { o, oi, players: { me, opp: op }, score: SC.initState(fmt, Math.random() < 0.5 ? 'me' : 'opp'), marks: [], t: 0, tr: null, phase: 'serve',
      stats: { pts: 0, won: 0, winners: 0, errors: 0, net: 0, out: 0, aces: 0, df: 0, sv1: 0, sv1in: 0, longest: 0, dec: [], notes: [] } };
    showGame(); setupPoint();
  }
  function setupPoint() {
    const st = M.score, server = M.players[st.server], recv = M.players[S.other(st.server)];
    const deuce = (st.p.me + st.p.opp) % 2 === 0;
    M.su = S.serveSetup(server, recv, deuce); M.second = false;
    server.pos = Object.assign({}, M.su.serverPos); recv.pos = Object.assign({}, M.su.receiverPos);
    server.target = Object.assign({}, server.pos); recv.target = Object.assign({}, recv.pos);
    server.atNet = recv.atNet = false; server.strokeSide = recv.strokeSide = 'FH';
    M.tr = null; M.t = 0; M.point = { shots: 0, dec: [], my: null, rally: 0 }; M.result = null;
    startServe();
  }
  function startServe() {
    M.tr = null; M.phase = 'serve'; D = null; renderHUD();
    if (M.score.server === 'me') openServe();
    else { $panel.innerHTML = `<div class="row between"><b>${esc(M.o.name)} is serving${M.second ? ' (2nd)' : ''}…</b><span class="pill">Get ready to return</span></div><p class="muted small">Watch the serve. You'll choose your return as the ball comes.</p>`; M.aiServeAt = performance.now() + 1000; }
  }
  function serveBall(id, type, aim) {
    const pl = M.players[id], sigma = S.sigmaFor(pl, type, 'FH', 1);
    const tr = S.execute(pl, M.su.contact, aim, type, sigma, Math.random);
    if (id === 'me' && !M.second) { M.stats.sv1++; if (S.judge(tr, M.su.boxSign).res === 'in') M.stats.sv1in++; }
    pl.swingAt = performance.now(); pl.strokeSide = 'FH'; snd('hit', 1.1);
    launch(tr, id, 'serve', M.su.boxSign);
  }
  function launch(tr, hid, kind, box) {
    const H = M.players[hid], Rv = M.players[S.other(hid)];
    Object.assign(M, { tr, t: 0, hitter: hid, kind, box, bounced: false, netHit: false, phase: 'flight', ev: null, pending: null });
    M.judge = S.judge(tr, kind === 'serve' ? box : 0);
    H.target = kind === 'serve' ? { x: H.pos.x * 0.3, y: H.side * (S.BL + 0.8) } : S.recovery(H, tr.land.x, H.atNet);
    if (M.judge.res === 'in') {
      const ic = S.intercept(tr, Rv, kind === 'serve' ? S.RETURN_REACT : null);
      if (ic) {
        const stroke = S.strokeSide(Rv, ic.p.x), incoming = S.speedAt(tr, ic.t), diff = S.difficulty(ic, incoming);
        const off = (stroke === 'FH' ? 1 : -1) * S.fhSign(Rv) * 0.55;
        Rv.target = { x: ic.p.x - off, y: ic.p.y + Rv.side * 0.15 }; Rv.strokeSide = stroke;
        const ctx = { striker: Rv, target: H, contact: { x: ic.p.x, y: ic.p.y, z: ic.p.z }, diff, stroke, volley: ic.volley, smash: ic.smash, need: ic.need, incoming, isReturn: kind === 'serve', t: ic.t };
        M.ev = { type: 'hit', t: ic.t, who: Rv.id };
        if (Rv.id === 'opp') M.oppCtx = ctx; else openDecision(ctx);
      } else {
        M.ev = { type: 'winner', t: Math.min(tr.tb2, tr.tl + 1.0) };
        const far = S.pos(tr, Math.min(tr.tb2, tr.tl + 0.8)); Rv.target = { x: S.clamp(far.x, -6, 6), y: S.clamp(far.y, -15, 15) };
        if (Rv.id === 'me') { D = null; $panel.innerHTML = `<p class="muted">Can't reach it…</p>`; }
      }
    } else {
      Rv.target = { x: Rv.pos.x * 0.5 + S.clamp(tr.land.x, -5, 5) * 0.5, y: Rv.pos.y };
      if (Rv.id === 'me') { D = null; $panel.innerHTML = `<p class="muted">Watch the ball…</p>`; }
    }
    renderHUD();
  }
  function oppAtContact(ctx) { const o = M.players.opp; return Object.assign({}, o, { pos: S.moveToward(o.pos, o.target || o.pos, o.speed * Math.max(0, ctx.t - 0.1)) }); }
  function aiHit() {
    const ctx = M.oppCtx, pl = M.players.opp; ctx.target = M.players.me; ctx.rng = Math.random;
    const ch = S.aiChoose(ctx);
    const tr = S.execute(pl, ctx.contact, ch.aim, ch.type, S.sigmaFor(pl, ch.type, ctx.stroke, ctx.diff), Math.random);
    pl.atNet = ch.approach || Math.abs(ctx.contact.y) < 7; pl.swingAt = performance.now();
    M.point.shots++; M.point.lastOpp = ch; snd('hit', ch.type === 'drop' || ch.type === 'dropvolley' ? 0.5 : 1);
    if (ch.approach) toast(`${M.o.name.split(' ')[0]} is coming in!`, '#FFC94A');
    launch(tr, 'opp', 'rally', 0);
  }
  function myHit(ch) {
    const ctx = D.ctx, pl = M.players.me;
    const ev = S.coach(ctx, ch); M.stats.dec.push(ev.r); if (ev.msg) { M.point.dec.push(ev); M.stats.notes.push(ev); }
    const tr = S.execute(pl, ctx.contact, ch.aim, ch.type, S.sigmaFor(pl, ch.type, ctx.stroke, ctx.diff), Math.random);
    pl.atNet = ch.approach || Math.abs(ctx.contact.y) < 7; pl.swingAt = performance.now();
    M.point.shots++; M.point.my = { ch, tr, margin: S.describeAim(ctx, ch.aim).margin, risk: D.risk };
    D = null; snd('hit', ch.type === 'drop' || ch.type === 'dropvolley' ? 0.5 : 1);
    $panel.innerHTML = `<p class="muted">${ch.approach ? '🏃 Moving in to the net…' : 'Recovering…'}</p>`;
    launch(tr, 'me', 'rally', 0);
  }
  function endPoint(winner, how) {
    if (M.phase !== 'flight') return;
    M.phase = 'ending'; M.endT = M.t + (how === 'fault' ? 0.6 : 0.9); M.result = { winner, how };
    if (how === 'fault') toast(M.tr.net ? 'FAULT (net)' : 'FAULT', '#FF8A9B');
  }
  function finishPoint() {
    const r = M.result;
    if (r.how === 'fault' && !M.second) { M.second = true; M.phase = 'faultwait'; M.tr = null; const sv = M.players[M.score.server]; sv.pos = Object.assign({}, M.su.serverPos); sv.target = Object.assign({}, sv.pos); setTimeout(startServe, 300); return; }
    if (r.how === 'fault') r.how = 'df';
    const st = M.stats, iWon = r.winner === 'me';
    st.pts++; if (iWon) st.won++;
    st.longest = Math.max(st.longest, M.point.shots);
    const hitter = M.hitter; // who hit the last ball
    if (r.how === 'df' && hitter === 'me') st.df++;
    if (r.how === 'ace' && hitter === 'me') st.aces++;
    if ((r.how === 'winner' || r.how === 'ace') && hitter === 'me') st.winners++;
    if ((r.how === 'out' || r.how === 'net') && hitter === 'me') { st.errors++; st[r.how]++; }
    const before = M.score;
    M.score = SC.applyPoint(M.score, r.winner);
    if (iWon && (r.how === 'winner' || r.how === 'ace')) snd('cheer'); else if (!iWon && hitter === 'me') snd('ooh');
    renderHUD();
    pointCard(r, before);
  }
  function pointCard(r, before) {
    const iWon = r.winner === 'me', hitter = M.hitter, oN = M.o.name.split(' ')[0];
    let title, sub = '';
    const lastOppType = M.point.lastOpp ? S.SHOTS[M.point.lastOpp.type].name : '';
    if (r.how === 'df') title = hitter === 'me' ? 'Double fault' : `${oN} double-faults`;
    else if (r.how === 'ace') title = hitter === 'me' ? 'ACE! 🎾' : `Ace by ${oN}`;
    else if (r.how === 'winner') title = hitter === 'me' ? 'WINNER! 🔥' : `${oN}: ${lastOppType} winner`;
    else if (r.how === 'out') { title = hitter === 'me' ? `Out by ${Math.max(1, Math.round(M.judge.by * 100))} cm` : `${oN} hits it out`; }
    else title = hitter === 'me' ? 'Into the net' : `${oN} nets it`;
    if (M.point.shots > 1) sub = `${M.point.shots}-shot rally`;
    if (M.point.shots === 1 && (r.how === 'out' || r.how === 'net') && hitter === 'me' && M.kind !== 'serve') sub = 'Return error';
    // coaching note for this point
    let note = null;
    const decs = M.point.dec.slice();
    if (iWon) { const best = decs.filter((d) => d.r > 0).sort((a, b) => b.r - a.r)[0]; if (best) note = { cls: 'good', txt: '✅ ' + best.msg }; }
    else {
      const worst = decs.filter((d) => d.r < 0).sort((a, b) => a.r - b.r)[0];
      if (worst) note = { cls: 'bad', txt: '🎯 ' + worst.msg };
      else if (hitter === 'me' && M.point.my && r.how !== 'df') {
        const my = M.point.my;
        if (my.margin < 0.6) note = { cls: 'bad', txt: `🎯 You aimed only ${Math.round(my.margin * 100)} cm inside the line. A little more margin and that ball is in.` };
        else if (r.how === 'net' && my.ch.type === 'flat') note = { cls: 'bad', txt: '🎯 Flat shots clear the net by only ~0.5 m. Topspin gives you more net clearance and still dips in.' };
        else note = { cls: '', txt: `It happens. That shot had about a ${Math.round(my.risk * 100)}% error risk. Your choice was fine, and over a match good choices win.` };
      } else if (r.how === 'df') note = { cls: 'bad', txt: '🎯 On second serve, use KICK. Lots of spin = safe and high bouncing.' };
      else if (M.point.my && Math.abs(M.point.my.tr.land.y) < 7.2 && M.point.my.ch.type !== 'drop') note = { cls: 'bad', txt: '🎯 Your last ball landed short. That gave them an easy ball to attack. Depth keeps you safe.' };
      else if (hitter === 'opp') note = { cls: '', txt: 'Great shot by them. Sometimes you just say "too good" and play the next point.' };
    }
    const tg = SC.tags(M.score), over = M.score.over;
    $panel.innerHTML = `<div class="row between"><div class="result" style="color:${iWon ? 'var(--win)' : 'var(--loss)'}">${esc(title)}</div><span class="pill">${iWon ? 'Point ' + esc(myName()) : 'Point ' + esc(oN)}</span></div>
      ${sub ? `<div class="muted small">${sub}</div>` : ''}
      ${note ? `<div class="coach ${note.cls}">${esc(note.txt)}</div>` : ''}
      <button class="btn primary" data-a="${over ? 'matchover' : 'next'}" style="margin-top:10px">${over ? 'See match result' : 'Next point ▶'}</button>`;
    M.phase = 'card';
  }

  /* ---------------- decision panel (your shot) ---------------- */
  const GROUND = [['topspin', 'Topspin', 'safe & deep'], ['heavy', 'Heavy', 'high & loopy'], ['flat', 'Flat', 'fast, risky'], ['slice', 'Slice', 'low & skids'], ['drop', 'Drop', 'short touch'], ['lob', 'Lob', 'high over']];
  const VOLLEYS = [['volley', 'Volley', 'punch deep'], ['dropvolley', 'Drop volley', 'soft & short']];
  const ZONES = [['cross', 'Crosscourt'], ['middle', 'Middle'], ['line', 'Down the line'], ['angle', 'Short angle'], ['body', 'At them']];
  function openDecision(ctx) {
    const tgt = oppAtContact(ctx); ctx.target = tgt;
    const type = ctx.smash ? 'smash' : ctx.volley ? 'volley' : 'topspin';
    D = { ctx, type, zone: 'cross', approach: false, serve: false };
    setZone('cross'); renderDecision();
  }
  function zonesNow() { return S.zones(D.ctx.contact, D.ctx.target); }
  function setZone(z) { D.zone = z; if (z !== 'custom') D.aim = Object.assign({}, zonesNow()[z]); calcRisk(); }
  function calcRisk() {
    const me = M.players.me;
    if (D.serve) { D.risk = S.errorRisk(me, M.su.contact, D.aim, D.type, S.sigmaFor(me, D.type, 'FH', 1), M.su.boxSign, 80); return; }
    D.risk = S.errorRisk(me, D.ctx.contact, D.aim, D.type, S.sigmaFor(me, D.type, D.ctx.stroke, D.ctx.diff), 0, 80);
  }
  function riskHTML() { const c = D.risk < 0.12 ? 'var(--win)' : D.risk < 0.28 ? 'var(--gold)' : 'var(--loss)'; return `<span class="risk" style="color:${c}">Error risk ${Math.round(D.risk * 100)}%</span>`; }
  function renderDecision() {
    if (!D || D.serve) return renderServe();
    const c = D.ctx, sit = S.situation(c), learn = P.mode === 'learn';
    const list = c.smash ? [['smash', 'Smash', 'put it away']] : c.volley ? VOLLEYS : GROUND;
    const zoneOK = !['drop', 'lob', 'dropvolley'].includes(D.type);
    $panel.innerHTML = `
      <div class="row between"><span class="pill" style="color:${sit === 'defense' ? 'var(--loss)' : sit === 'attack' || sit === 'smash' ? 'var(--win)' : 'var(--gold)'}">${learn ? S.SITUATION_LABEL[sit] : (c.volley ? 'VOLLEY' : c.stroke === 'FH' ? 'FOREHAND' : 'BACKHAND')}</span>
        ${learn ? riskHTML() : `<span class="muted small">${c.stroke === 'FH' ? 'Forehand' : 'Backhand'}</span>`}</div>
      <div class="grid3" style="margin-top:8px">${list.map(([k, n, d]) => `<button class="shot ${D.type === k ? 'on' : ''}" data-a="type" data-v="${k}">${n}<small>${d}</small></button>`).join('')}</div>
      <div class="chips" style="margin-top:8px">${ZONES.map(([k, n]) => `<button class="chip ${D.zone === k ? 'on' : ''} ${zoneOK ? '' : 'dim'}" data-a="zone" data-v="${k}">${n}</button>`).join('')}
        ${!c.volley && !c.smash ? `<button class="chip ${D.approach ? 'on' : ''}" data-a="approach">🏃 Come to net</button>` : ''}</div>
      <div class="row" style="margin-top:8px"><button class="btn primary hit" data-a="hit">HIT ${c.stroke === 'FH' ? 'FOREHAND' : 'BACKHAND'}</button></div>
      <div class="tiny muted" style="margin-top:6px;text-align:center">Tip: tap the court to aim anywhere${learn ? ' · ball waits for you' : ' · decide before the ball arrives!'}</div>`;
  }
  function openServe() {
    const me = M.players.me;
    D = { serve: true, type: M.second ? 'sKick' : 'sFlat', zone: 't', ctx: null };
    D.aim = Object.assign({}, M.su.targets.t); calcRisk(); renderServe();
  }
  function renderServe() {
    const learn = P.mode === 'learn';
    $panel.innerHTML = `<div class="row between"><b>${M.second ? '2nd serve' : '1st serve'} · ${M.su.boxSign === S.facing(M.players.opp) ? 'Deuce court' : 'Ad court'}</b>${learn ? riskHTML() : ''}</div>
      <div class="grid3" style="margin-top:8px">${[['sFlat', 'Flat', 'fastest'], ['sSlice', 'Slice', 'curves wide'], ['sKick', 'Kick', 'safe, high bounce']].map(([k, n, d]) => `<button class="shot ${D.type === k ? 'on' : ''}" data-a="stype" data-v="${k}">${n}<small>${d}</small></button>`).join('')}</div>
      <div class="chips" style="margin-top:8px">${[['wide', 'Wide'], ['body', 'Body'], ['t', 'Down the T']].map(([k, n]) => `<button class="chip ${D.zone === k ? 'on' : ''}" data-a="szone" data-v="${k}">${n}</button>`).join('')}</div>
      <div class="row" style="margin-top:8px"><button class="btn primary hit" data-a="serve">SERVE</button></div>
      <div class="tiny muted" style="margin-top:6px;text-align:center">Tap the service box to aim exactly</div>`;
  }
  function autoChoice() { const c = D.ctx; return { type: c.smash ? 'smash' : c.volley ? 'volley' : 'topspin', aim: zonesNow().cross, approach: false, late: true }; }

  /* ---------------- HUD ---------------- */
  const TAGTXT = { MP_FOR: ['MATCH POINT', 'good'], MP_AGAINST: ['MATCH POINT DOWN', 'bad'], SP_FOR: ['SET POINT', 'good'], SP_AGAINST: ['SET POINT DOWN', 'bad'], BP_FOR: ['BREAK POINT', 'good'], BP_AGAINST: ['BREAK POINT DOWN', 'bad'], TB: ['TIEBREAK', ''], MTB: ['MATCH TIEBREAK', ''], DEUCE: ['DEUCE', ''], DECIDER: ['DECIDING POINT', ''] };
  function renderHUD() {
    const st = M.score, lab = SC.pointLabels(st);
    const row = (who, nm) => `<div class="sb" style="margin-top:${who === 'opp' ? 3 : 0}px"><span>${!st.over && st.server === who ? '<span class="dot" style="display:inline-block"></span>' : ''}</span>
      <span class="nm">${esc(nm)}</span><span class="g">${st.sets.map((s) => s[who]).join(' ')}${st.sets.length ? ' ' : ''}${st.over ? '' : st.g[who]}</span><span class="p">${st.over ? (st.winner === who ? '✓' : '') : who === 'me' ? lab[0] : lab[1]}</span></div>`;
    const t = SC.tags(st).find((x) => TAGTXT[x]);
    $hud.innerHTML = `<div class="hudrow"><div style="flex:1">${row('me', myName())}${row('opp', M.o.name)}</div><button class="iconbtn" data-a="pause">⏸</button></div>
      <div class="tagline ${t ? TAGTXT[t][1] : ''}">${t ? TAGTXT[t][0] : ''}</div>`;
  }
  let toastT;
  function toast(txt, color) { $toast.textContent = txt; $toast.style.color = color || '#fff'; $toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => $toast.classList.remove('on'), 1100); }

  /* ---------------- main loop ---------------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000) * (window.__speed || 1); last = now;
    if (M && !$game.hidden && !M.paused) {
      if (M.phase === 'serve' && M.score.server === 'opp' && now >= M.aiServeAt) { const c = S.aiServe(M.players.opp, M.su, M.second, Math.random); serveBall('opp', c.type, c.aim); }
      if (M.phase === 'flight' || M.phase === 'ending') step(dt);
      // move players
      ['me', 'opp'].forEach((id) => {
        const p = M.players[id], tg = p.target; if (!tg) return;
        const sp = p.speed * dt * (M.phase === 'flight' || M.phase === 'ending' ? M.scale || 0.9 : 0.9);
        const np = S.moveToward(p.pos, tg, sp); p.stride = (p.stride || 0) + Math.hypot(np.x - p.pos.x, np.y - p.pos.y); p.pos = np;
      });
      draw(now);
    }
    requestAnimationFrame(frame);
  }
  function step(dt) {
    const waitingMe = M.phase === 'flight' && M.ev && M.ev.type === 'hit' && M.ev.who === 'me' && !M.pending;
    M.scale = waitingMe && P.mode === 'pro' ? 0.5 : 0.9;
    let nt = M.t + dt * M.scale;
    if (waitingMe && P.mode === 'learn' && nt >= M.ev.t) { nt = M.ev.t; M.scale = 0; }
    M.t = nt;
    const tr = M.tr;
    if (!M.bounced && !tr.net && M.t >= tr.tl) {
      M.bounced = true; snd('bounce', 0.6);
      const out = M.judge.res === 'out'; M.marks.push({ x: tr.land.x, y: tr.land.y, at: performance.now(), out, by: M.judge.by });
      if (out) endPoint(S.other(M.hitter), M.kind === 'serve' ? 'fault' : 'out');
    }
    if (tr.net && !M.netHit && M.t >= tr.tNet) { M.netHit = true; snd('net'); endPoint(S.other(M.hitter), M.kind === 'serve' ? 'fault' : 'net'); }
    if (M.phase === 'flight' && M.ev) {
      if (M.ev.type === 'hit' && M.t >= M.ev.t) {
        if (M.ev.who === 'opp') aiHit();
        else if (M.pending) myHit(M.pending);
        else if (P.mode === 'pro') { toast('Too late!', '#FF8A9B'); myHit(autoChoice()); }
      } else if (M.ev.type === 'winner' && M.t >= M.ev.t) endPoint(M.hitter, M.kind === 'serve' ? 'ace' : 'winner');
    }
    if (M.phase === 'ending' && M.t >= M.endT) finishPoint();
  }
  requestAnimationFrame(frame);

  /* ---------------- input ---------------- */
  cv.addEventListener('pointerdown', (e) => {
    if (!M || !D) return;
    const r = cv.getBoundingClientRect(), p = unP(e.clientX - r.left, e.clientY - r.top);
    if (!p || p.y < 0.3 || p.y > S.BL + 3 || Math.abs(p.x) > S.DW + 2) return;
    D.aim = { x: S.clamp(p.x, -S.DW - 1, S.DW + 1), y: S.clamp(p.y, 0.5, S.BL + 2) }; D.zone = 'custom'; calcRisk();
    if (D.serve) renderServe(); else renderDecision();
  });
  const A = {
    type: (v) => { D.type = v; if (v === 'drop' || v === 'dropvolley') setZone('drop'); else if (v === 'lob') setZone('lob'); else { if (['drop', 'lob'].includes(D.zone)) setZone('cross'); else calcRisk(); } renderDecision(); },
    zone: (v) => { if (['drop', 'lob', 'dropvolley'].includes(D.type)) D.type = D.ctx.volley ? 'volley' : 'topspin'; setZone(v); renderDecision(); },
    approach: () => { D.approach = !D.approach; renderDecision(); },
    hit: () => {
      if (!D || D.serve || M.phase !== 'flight') return;
      const ch = { type: D.type, aim: Object.assign({}, D.aim), approach: D.approach };
      if (M.ev && M.t >= M.ev.t - 1e-6) myHit(ch); else { M.pending = ch; $panel.innerHTML = `<p style="font-weight:800">${S.SHOTS[ch.type].name} ready… <span class="muted">waiting for the ball</span></p>`; }
    },
    stype: (v) => { D.type = v; calcRisk(); renderServe(); },
    szone: (v) => { D.zone = v; D.aim = Object.assign({}, M.su.targets[v]); if (M.second) D.aim.y *= 0.9; calcRisk(); renderServe(); },
    serve: () => {
      if (!D || !D.serve || M.phase !== 'serve') return;
      const ev = S.coachServe(M.players.me, { type: D.type, aim: D.aim }, M.second, M.players.opp);
      M.stats.dec.push(ev.r); if (ev.msg) { M.point.dec.push(ev); M.stats.notes.push(ev); }
      const t = D.type, a = Object.assign({}, D.aim); D = null; $panel.innerHTML = '<p class="muted">…</p>'; serveBall('me', t, a);
    },
    next: () => { setupPoint(); },
    matchover: () => matchOver(),
    pause: () => { M.paused = true; modal(`<h3>Paused</h3><p class="muted small">${esc(myName())} vs ${esc(M.o.name)}</p>
      <div style="display:grid;gap:8px;margin-top:12px"><button class="btn primary" data-a="resume">Resume</button><button class="btn" data-a="quit">Quit match</button></div>`); },
    resume: () => { M.paused = false; last = performance.now(); closeModal(); },
    quit: () => { closeModal(); M = null; D = null; home(); },
    tour: () => tour(), home: () => home(), how: () => how(), settings: () => settings(),
    pick: (v) => preMatch(+v), play: (v) => { closeModal(); newMatch(+v); },
    setmode: (v) => { P.mode = v; save(); settings(); }, setfmt: (v) => { P.format = v; save(); settings(); },
    sethand: (v) => { P.hand = +v; save(); settings(); }, setsound: (v) => { P.sound = v === '1'; save(); settings(); },
    savename: () => { const i = document.getElementById('nm'); P.name = (i && i.value || '').trim().slice(0, 14); save(); home(); },
    rematch: () => { closeModal(); newMatch(M.oi); }, nextopp: () => { closeModal(); preMatch(Math.min(R.length - 1, M.oi + 1)); },
    closemodal: () => closeModal(),
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]'); if (!el) return; ac();
    const f = A[el.dataset.a]; if (f) { e.preventDefault(); f(el.dataset.v); }
  });

  /* ---------------- screens ---------------- */
  function modal(html) { $modal.innerHTML = `<div class="sheet">${html}</div>`; $modal.hidden = false; }
  function closeModal() { $modal.hidden = true; $modal.innerHTML = ''; }
  function showGame() { $screen.hidden = true; $game.hidden = false; requestAnimationFrame(resize); setTimeout(resize, 50); }
  function showScreen(html) { $game.hidden = true; $screen.hidden = false; $screen.innerHTML = `<div class="in">${html}</div>`; $screen.scrollTop = 0; }
  const starsOf = (o) => P.stars[o.id] || 0;
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  function home() {
    const total = R.reduce((a, o) => a + starsOf(o), 0);
    showScreen(`
      <div class="card hero"><div class="logo">RALLY <b>IQ</b></div><p class="muted" style="margin:8px 0 0">Think like a champion. Every shot is a decision.</p></div>
      ${!P.name ? `<div class="card"><h3>What's your name?</h3><div class="row" style="margin-top:8px"><input id="nm" type="text" maxlength="14" placeholder="First name"><button class="btn primary" style="width:auto" data-a="savename">Go</button></div></div>` : `<p style="text-align:center;font-weight:800;margin:4px 0 14px">Welcome back, ${esc(P.name)} 👋</p>`}
      <button class="btn primary" data-a="tour" style="min-height:64px;font-size:20px">🏆 Junior Tour <span style="font-weight:600;font-size:14px;opacity:.7">· ${total}/${R.length * 3} ★</span></button>
      <div class="grid2" style="margin-top:10px"><button class="btn" data-a="how">📘 How to play</button><button class="btn" data-a="settings">⚙️ Settings</button></div>
      <h2>Your career</h2><div class="card"><div class="kv"><span>Matches won</span><b>${P.totals.wins} / ${P.totals.matches}</b></div>
        <div class="kv"><span>Smart decisions</span><b>${P.totals.smart}</b></div><div class="kv"><span>Risky decisions</span><b>${P.totals.risky}</b></div></div>
      <p class="tiny muted" style="text-align:center">All players are fictional. Ball flight, bounce, running speed and error rates are modelled on real junior tennis.</p>`);
  }
  function tour() {
    showScreen(`<div class="row between"><button class="pill" data-a="home">‹ Home</button><span class="pill">Mode: ${P.mode === 'learn' ? 'Learn' : 'Pro'}</span></div>
      <h1 style="margin:14px 0 4px">Junior Tour</h1><p class="muted small">Beat each opponent to unlock the next. Each one teaches a real strategy. ★★★ = win with a Strategy IQ of 75+.</p>
      <div style="margin-top:14px">${R.map((o, i) => {
        const locked = i > P.unlocked;
        return `<button class="opp ${locked ? 'locked' : ''}" ${locked ? '' : `data-a="pick" data-v="${i}"`}><div class="av" style="background:${o.color}">${locked ? '🔒' : esc(o.name[0])}</div>
          <div style="flex:1;min-width:0"><div style="font-weight:800">${i + 1}. ${esc(o.name)}</div><div class="muted small">${esc(o.tag)}</div><div class="small" style="color:var(--ball)">Lesson: ${esc(o.lesson)}</div></div>
          <div class="stars">${starStr(starsOf(o))}</div></button>`;
      }).join('')}</div>`);
  }
  function preMatch(i) {
    const o = R[i];
    modal(`<div class="row"><div class="av" style="background:${o.color}">${esc(o.name[0])}</div><div><h3 style="margin:0">${esc(o.name)}</h3><div class="muted small">${esc(o.tag)}${o.hand === -1 ? ' · left-handed' : ''}</div></div></div>
      <h2 style="margin-top:16px">Scouting report</h2><p class="small" style="margin:0">${esc(o.scout)}</p>
      <h2>Today's lesson: ${esc(o.lesson)}</h2><ul class="t small">${o.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <p class="muted tiny" style="margin-top:12px">${SC.FORMATS[P.format].label} · ${P.mode === 'learn' ? 'Learn mode: the ball waits for your decision' : 'Pro mode: decide before the ball arrives'}</p>
      <div class="grid2" style="margin-top:12px"><button class="btn" data-a="closemodal">Back</button><button class="btn primary" data-a="play" data-v="${i}">Play ▶</button></div>`);
  }
  function grade(iq) { return iq >= 85 ? 'A+' : iq >= 75 ? 'A' : iq >= 65 ? 'B' : iq >= 55 ? 'C' : 'D'; }
  function matchOver() {
    const st = M.stats, won = M.score.winner === 'me';
    const n = st.dec.length, iq = n ? Math.round((100 * (st.dec.reduce((a, b) => a + b, 0) + 2 * n)) / (4 * n)) : 50;
    const smart = st.dec.filter((x) => x > 0).length, risky = st.dec.filter((x) => x < 0).length;
    const stars = !won ? 1 : iq >= 75 ? 3 : 2;
    const o = M.o; P.stars[o.id] = Math.max(P.stars[o.id] || 0, stars);
    if (won && M.oi === P.unlocked && P.unlocked < R.length - 1) P.unlocked++;
    P.totals.matches++; if (won) P.totals.wins++; P.totals.smart += smart; P.totals.risky += risky; save();
    const count = (arr) => { const m = {}; arr.forEach((x) => { m[x.msg] = (m[x.msg] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]); };
    const goods = count(st.notes.filter((x) => x.r > 0)), bads = count(st.notes.filter((x) => x.r < 0));
    const score = SC.scoreString(M.score);
    if (won) snd('cheer');
    modal(`<div style="text-align:center"><div style="font-size:46px">${won ? '🏆' : '💪'}</div><h1>${won ? 'You won!' : 'Good fight!'}</h1>
        <div style="font-size:22px;font-weight:900;color:var(--ball)">${esc(score)}</div><div class="muted small">vs ${esc(o.name)}</div>
        <div class="stars" style="font-size:28px;margin-top:6px">${starStr(stars)}</div></div>
      <div class="card" style="margin-top:14px;text-align:center;background:var(--card2)"><div class="muted tiny" style="font-weight:800;letter-spacing:1.5px">STRATEGY IQ</div>
        <div class="grade" style="color:${iq >= 75 ? 'var(--win)' : iq >= 55 ? 'var(--gold)' : 'var(--loss)'}">${grade(iq)}</div><div class="small">${iq}/100 · ${smart} smart · ${risky} risky decisions</div></div>
      ${goods.length ? `<h2>You did well</h2><ul class="t small">${goods.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${bads.length ? `<h2>Work on</h2><ul class="t small">${bads.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <h2>Stats</h2><div class="small"><div class="kv"><span>Points won</span><b>${st.won}/${st.pts}</b></div>
        <div class="kv"><span>Winners / errors</span><b>${st.winners} / ${st.errors}</b></div>
        <div class="kv"><span>Errors: net / out</span><b>${st.net} / ${st.out}</b></div>
        <div class="kv"><span>1st serves in</span><b>${st.sv1 ? Math.round((100 * st.sv1in) / st.sv1) + '%' : '—'}</b></div>
        <div class="kv"><span>Aces / double faults</span><b>${st.aces} / ${st.df}</b></div>
        <div class="kv"><span>Longest rally</span><b>${st.longest} shots</b></div></div>
      <div class="grid2" style="margin-top:14px"><button class="btn" data-a="rematch">Rematch</button>
        ${won && M.oi < R.length - 1 ? `<button class="btn primary" data-a="nextopp">Next opponent ▶</button>` : `<button class="btn primary" data-a="tour">Tour</button>`}</div>`);
  }
  function how() {
    showScreen(`<button class="pill" data-a="home">‹ Home</button><h1 style="margin:14px 0">How to play</h1>
      <div class="card small"><ol style="margin:0;padding-left:18px">
        <li>When the ball comes to you, pick a <b>shot</b> (Topspin, Heavy, Flat, Slice, Drop, Lob) and <b>where</b> to aim it (or tap the court).</li>
        <li>Press <b>HIT</b>. Your player runs and swings automatically. Your <b>decision</b> is what matters.</li>
        <li>The <b>error risk</b> is real: it grows when you aim close to the lines, hit flat, or you are stretched.</li>
        <li>Tick <b>Come to net</b> on a short ball to attack the net.</li>
        <li>After each point the coach tells you what was smart and what to change.</li></ol></div>
      <h2>Strategy book</h2>
      <div class="card small"><ul class="t">
        <li><b>Crosscourt is king.</b> The net is lower in the middle (0.91 m vs 1.07 m at the posts) and the diagonal is about 1.4 m longer.</li>
        <li><b>Margin wins.</b> Aim about 1 m inside the lines. Pros miss when they aim at lines too.</li>
        <li><b>Defend high and crosscourt</b> when you are stretched. It buys time to recover.</li>
        <li><b>Attack the short ball</b>: step in, hit to the open court or the weakness, then come to the net.</li>
        <li><b>Approach down the line</b> and cover the line.</li>
        <li><b>Vs a net player:</b> pass low and wide, hit at their feet, or lob deep.</li>
        <li><b>Drop shots</b> work when you're inside the court and they're far behind the baseline.</li>
        <li><b>Find the weakness</b> early and use it on big points.</li>
        <li><b>Second serve: spin</b> (kick/slice), never flat.</li>
        <li><b>Recover</b> after every shot. The open court is where you lose points.</li></ul></div>
      ${R.map((o, i) => i <= P.unlocked ? `<div class="card small"><b>${esc(o.lesson)}</b> <span class="muted">(${esc(o.name)})</span><ul class="t">${o.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '').join('')}`);
  }
  function settings() {
    const seg = (a, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button data-a="${a}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    showScreen(`<button class="pill" data-a="home">‹ Home</button><h1 style="margin:14px 0">Settings</h1>
      <div class="card"><div class="lbl">Name</div><div class="row"><input id="nm" type="text" maxlength="14" value="${esc(P.name)}"><button class="btn primary" style="width:auto" data-a="savename">Save</button></div>
      <div class="lbl" style="margin-top:14px">Mode</div>${seg('setmode', [['learn', 'Learn'], ['pro', 'Pro']], P.mode)}
      <p class="muted tiny">Learn: the ball waits for you, and you see the situation and error risk. Pro: real-time slow-motion, no hints. Decide before the ball arrives!</p>
      <div class="lbl" style="margin-top:14px">You play</div>${seg('sethand', [[1, 'Right-handed'], [-1, 'Left-handed']], P.hand)}
      <div class="lbl" style="margin-top:14px">Match length</div>${seg('setfmt', [['quick', 'Short set (to 4)'], ['one', 'Full set (to 6)']], P.format)}
      <div class="lbl" style="margin-top:14px">Sound</div>${seg('setsound', [['1', 'On'], ['0', 'Off']], P.sound ? '1' : '0')}</div>
      <p class="tiny muted" style="text-align:center">Rally IQ v1.0 · works offline · progress is saved on this device</p>`);
  }

  window.addEventListener('resize', () => { if (!$game.hidden) resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && M && !$game.hidden && !M.paused && M.phase !== 'card') A.pause(); });
  window.__rallyiq = { get M() { return M; }, get D() { return D; }, A, P }; // test hook
  home();
})();
