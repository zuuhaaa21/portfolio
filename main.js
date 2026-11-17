/*
  Fathima Zuha — landing hero
  ───────────────────────────
  • Lanyard   : verlet strap (visual) pinned to an off-screen anchor and the clasp.
  • Clasp     : heavy point on an inextensible strap (2D pendulum, fixed 120 Hz step).
  • Card      : physical pendulum under the clasp, driven by the clasp's acceleration;
                tilts toward the cursor (springs), flips to the contact side.
  • Light     : cursor-following glare, glossy band, iridescent rim, wall shadow.
  • Wordmark  : letters puff up near the cursor / the swinging card; a wave rolls by.
  • Campaign  : the card is "the ad" — visitor interactions become live metrics
                and pixel events (PageView → ViewContent → Lead).
*/
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const hero = $('#hero');
  const cv = $('#strap');
  const ctx = cv.getContext('2d');
  const hang = $('#hang');
  const card = $('#card');
  const dRing = $('#dRing'), clawG = $('#clawG');
  let strapEx = 0, strapEy = 1;          // direction of the strap where it meets the D-ring
  const shadow = $('#shadow');
  const mark = $('#mark');
  const title = $('#title');
  const img = $('#cardImg');
  const toastEl = $('#toast');

  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = mqReduce.matches;
  const coarse = matchMedia('(pointer: coarse)').matches;

  // card design size (px) — scaled as a whole by ks
  const CW = 300, CH = 430, CT = 70.8;        // CT: strap end → card top

  const N = 26;            // strap segments
  const DT = 1 / 120;      // physics step (s)
  const G = 2400;          // gravity (px/s²)
  const ITER = 16;
  const DAMP = 0.993;
  const MAX_RY = 22, MAX_RX = 16;
  const ANCHOR_Y = -40;
  const LABEL = 'FATHIMA ZUHA   ·   PERFORMANCE MARKETER   ·   META ADS   ·   ';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const easeOutBack = (u) => { const c = 1.15, c3 = c + 1; return 1 + c3 * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
  const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

  // ── state ─────────────────────────────────────────────────────────────
  let W = 0, H = 0, dpr = 1, ks = 1, mobile = false;
  let ropeLen = 400, seg = 15, armL = 286, anchorX = 0, strapW = 44;
  const pts = Array.from({ length: N + 1 }, () => ({ x: 0, y: 0, px: 0, py: 0 }));
  const anc = { x: 0, y: 0, vx: 0, vy: 0, reset: true };

  let theta = 0, thetaV = 0;
  let rx = 0, rxV = 0, ry = 0, ryV = 0;
  let fl = 0, flV = 0, flT = 0;           // flip angle (deg)
  let gx = 32, gy = 18;
  let idleW = 1;
  let accX = 0, accY = 0, lastVX = 0, lastVY = 0, endVX = 0;
  let cardCx = 0, cardCy = 0;
  let clock = 0, started = false;

  const ptr = { x: 0, y: 0, active: false };
  const orient = { nx: 0, ny: 0, active: false };
  let drag = null;

  // ── wordmark: split into letter cells (fixed widths so weight changes don't reflow)
  const letters = [];
  (function splitMark() {
    const txt = mark.textContent;
    mark.textContent = '';
    for (const ch of txt) {
      const e = document.createElement('span');
      e.className = ch === ' ' ? 'mk sp' : 'mk';
      e.textContent = ch === ' ' ? ' ' : ch;
      e.setAttribute('aria-hidden', 'true');
      mark.appendChild(e);
      letters.push({ e, ch, k: 0, v: 0, cx: 0, cy: 0, shown: '' });
    }
  })();

  function fitMark() {
    // measure at 100px, then size so the name fills the width
    mark.style.fontSize = '100px';
    letters.forEach((l) => { l.e.style.width = ''; l.e.style.transform = ''; l.e.style.fontVariationSettings = ''; l.e.style.textShadow = ''; });
    const widths = letters.map((l) => l.e.getBoundingClientRect().width);
    let target, measured;
    if (mobile) {
      const spIdx = letters.findIndex((l) => l.ch === ' ');
      const first = widths.slice(0, spIdx < 0 ? widths.length : spIdx).reduce((a, b) => a + b, 0);
      measured = first; target = W - 14;
    } else {
      measured = widths.reduce((a, b) => a + b, 0); target = W - 64;
    }
    let fs = 100 * target / (measured || 1);
    if (!mobile) fs = Math.min(fs, H * 0.3);
    mark.style.fontSize = fs.toFixed(2) + 'px';
    letters.forEach((l, i) => { if (l.ch !== ' ') l.e.style.width = (widths[i] / 100).toFixed(4) + 'em'; l.shown = ''; });
    return fs;
  }

  // centre the name on its ink, not its box: the "F" has a left side-bearing and the
  // tight negative tracking lets the last letter overhang the box on the right
  const measureCtx = document.createElement('canvas').getContext('2d');
  function opticalCenterMark() {
    mark.style.translate = '';
    if (mobile) return;   // two short lines on phones are already centred by text-align
    const fs = parseFloat(mark.style.fontSize) || 100;
    measureCtx.font = `500 ${fs}px "Funnel Display", sans-serif`;
    const fl = letters[0], ll = letters[letters.length - 1];
    const mF = measureCtx.measureText(fl.ch), mL = measureCtx.measureText(ll.ch);
    const first = fl.e.getBoundingClientRect(), last = ll.e.getBoundingClientRect();
    // each letter's glyph origin sits at its cell's left edge
    const inkL = first.left - mF.actualBoundingBoxLeft;     // + left side-bearing
    const inkR = last.left + mL.actualBoundingBoxRight;     // ink right edge
    const shift = W / 2 - (inkL + inkR) / 2;
    if (Math.abs(shift) < 60) mark.style.translate = shift.toFixed(1) + 'px 0';
  }

  function cacheLetterCenters() {
    const prev = mark.style.transform;
    mark.style.transform = 'none';
    letters.forEach((l) => { const r = l.e.getBoundingClientRect(); l.cx = r.left + r.width / 2; l.cy = r.top + window.scrollY + r.height * 0.55; });
    mark.style.transform = prev;
  }

  // ── layout ────────────────────────────────────────────────────────────
  let markFs = 100;
  function layout() {
    W = root.clientWidth;          // excludes the scrollbar now that the page scrolls
    H = hero.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    mobile = W <= 820;

    markFs = fitMark();
    opticalCenterMark();
    const mstyle = mark.style.transform;
    mark.style.transform = 'none';
    const mr = mark.getBoundingClientRect();
    mark.style.transform = mstyle;
    const lineH = markFs * 0.78;
    // card's lower edge dips into the first line of the name (the name sits behind the card)
    const cardBottom = mr.top + window.scrollY + lineH * (mobile ? 0.6 : 0.32);

    const range = document.createRange();
    range.selectNodeContents(title);
    const tr = range.getBoundingClientRect();

    if (mobile) {
      ks = Math.min(0.72 * W / CW, (cardBottom - (tr.bottom + window.scrollY) - 16) / CH, 1.15);
      ks = Math.max(ks, 0.45);
      strapW = 44 * ks;
      const half = CW * ks / 2;
      anchorX = clamp(Math.max(W / 2, tr.right + 20 + strapW / 2), half + 4, W - half - 4);
    } else {
      ks = clamp(Math.min(H / 900, W / 1300), 0.62, 1.3);
      ks = Math.min(ks, (cardBottom - 60) / (CH + CT));
      strapW = 44 * ks;
      anchorX = W / 2;
    }

    const restY = cardBottom - (CH + CT) * ks;
    ropeLen = Math.max(60, restY - ANCHOR_Y);
    seg = ropeLen / N;
    armL = (CT + CH / 2) * ks;

    root.style.setProperty('--ks', ks.toFixed(4));
    root.style.setProperty('--cwpx', (CW * ks).toFixed(1) + 'px');
    root.style.setProperty('--chpx', (CH * ks).toFixed(1) + 'px');
    anc.reset = true;
    cacheLetterCenters();
    labelCache.ks = 0;
  }

  // anchor: off-screen above; drives entrance + idle float
  function anchorPos(t) {
    let x = anchorX, y = ANCHOR_Y;
    if (!reduce) {
      const ky = easeOutBack(clamp(t / 1.5, 0, 1));
      const kx = easeInOutCubic(clamp(t / 1.75, 0, 1));
      x += (1 - kx) * (-0.14 * W);
      y -= (1 - ky) * (ropeLen + (CT + CH) * ks + 160);
      const f = smooth(1.3, 3.4, t);
      x += f * (Math.sin(t * 0.42) * 7 + Math.sin(t * 0.97 + 1.3) * 2.5) * ks;
      y += f * (Math.sin(t * 0.63) * 9 + Math.sin(t * 1.31 + 0.4) * 2) * ks;
    }
    return { x, y };
  }

  function initRope() {
    const a = anchorPos(0);
    for (let i = 0; i <= N; i++) {
      const p = pts[i];
      p.x = p.px = a.x;
      p.y = p.py = a.y + i * seg;
    }
    anc.x = a.x; anc.y = a.y; anc.vx = anc.vy = 0; anc.reset = false;
    theta = thetaV = 0;
    if (!reduce) { ry = -40; rx = 10; }
  }

  // ── physics step ──────────────────────────────────────────────────────
  function step(t) {
    const ready = reduce ? 1 : smooth(1.0, 2.3, t);

    // anchor moves the whole system rigidly + partial fictitious force
    const a = anchorPos(t);
    const dX = a.x - anc.x, dY = a.y - anc.y;
    let aAx = 0, aAy = 0;
    if (anc.reset) { anc.vx = anc.vy = 0; anc.reset = false; }
    else {
      const vAx = dX / DT, vAy = dY / DT;
      aAx = (vAx - anc.vx) / DT; aAy = (vAy - anc.vy) / DT;
      anc.vx = vAx; anc.vy = vAy;
    }
    anc.x = a.x; anc.y = a.y;
    for (let i = 0; i <= N; i++) { const p = pts[i]; p.x += dX; p.px += dX; p.y += dY; p.py += dY; }
    const fAx = clamp(-aAx * 0.55, -2 * G, 2 * G);
    const fAy = clamp(-aAy * 0.55, -0.7 * G, 2 * G);

    // clasp: heavy point on an inextensible strap
    const p0 = pts[0], end = pts[N];
    {
      const vx = (end.x - end.px) * DAMP, vy = (end.y - end.py) * DAMP;
      end.px = end.x; end.py = end.y;
      let fx = fAx + (reduce ? 0 : Math.sin(t * 0.7) * 14 * ks);
      if (!drag && ptr.active && !reduce) fx += clamp(ptr.x - end.x, -700, 700) * 0.24 * ready;
      end.x += vx + fx * DT * DT;
      end.y += vy + (G + fAy) * DT * DT;
    }
    if (drag) {
      end.x = lerp(end.px, drag.x - drag.ox, 0.3);
      end.y = lerp(end.py, drag.y - drag.oy, 0.3);
    }
    {
      const dx = end.x - p0.x, dy = end.y - p0.y, d = Math.hypot(dx, dy);
      if (d > ropeLen) { const r = ropeLen / d; end.x = p0.x + dx * r; end.y = p0.y + dy * r; }
    }

    // the strap: light verlet rope pinned at both ends (visual only)
    const air = reduce ? 0 : 1;
    for (let i = 1; i < N; i++) {
      const p = pts[i];
      const vx = (p.x - p.px) * 0.97, vy = (p.y - p.py) * 0.97;
      p.px = p.x; p.py = p.y;
      p.x += vx + (fAx * 0.5 + air * Math.sin(t * 0.9 + i * 0.4) * 30 * ks) * DT * DT;
      p.y += vy + (G + fAy) * DT * DT;
    }
    const sl = seg * 1.01;
    for (let k = 0; k < ITER; k++) {
      const fwd = (k & 1) === 0;
      for (let j = 0; j < N; j++) {
        const i = fwd ? j : N - 1 - j;
        const A = pts[i], B = pts[i + 1];
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
        if (d <= sl || d === 0) continue;
        const wa = i === 0 ? 0 : 1, wb = i + 1 === N ? 0 : 1, sum = wa + wb;
        if (!sum) continue;
        const diff = (d - sl) / d;
        A.x += dx * diff * (wa / sum); A.y += dy * diff * (wa / sum);
        B.x -= dx * diff * (wb / sum); B.y -= dy * diff * (wb / sum);
      }
    }

    // card swing (physical pendulum)
    const vx = (end.x - end.px) / DT, vy = (end.y - end.py) / DT;
    accX = lerp(accX, clamp((vx - lastVX) / DT, -4 * G, 4 * G), 0.3);
    accY = lerp(accY, clamp((vy - lastVY) / DT, -4 * G, 4 * G), 0.3);
    lastVX = vx; lastVY = vy;
    endVX = lerp(endVX, vx, 0.08);
    let tAcc;
    if (drag) {
      const ropeAng = clamp(Math.atan2(end.x - p0.x, end.y - p0.y), -1.1, 1.1);
      tAcc = (ropeAng - theta) * 70 - thetaV * 14;
    } else {
      const gEff = G - clamp(accY, -2 * G, 0.8 * G);
      const lEff = armL + (CH * ks) * (CH * ks) / (12 * armL);
      tAcc = (-gEff * Math.sin(theta) - accX * Math.cos(theta)) / lEff - 2.6 * thetaV;
    }
    thetaV += tAcc * DT;
    theta = clamp(theta + thetaV * DT, -1.2, 1.2);

    // tilt toward the pointer
    let nx = 0, ny = 0, src = false;
    if (ptr.active) {
      nx = clamp((ptr.x - cardCx) / (W * 0.42), -1, 1);
      ny = clamp((ptr.y - cardCy) / (H * 0.42), -1, 1);
      src = true;
    } else if (orient.active) { nx = orient.nx; ny = orient.ny; src = true; }
    idleW = lerp(idleW, src ? 0.25 : 1, 0.012);

    const tScale = reduce ? 0.35 : 1;
    let tY = nx * MAX_RY * ready * tScale;
    let tX = -ny * MAX_RX * ready * tScale;
    if (!reduce) {
      const f = smooth(1.3, 3.2, t) * idleW;
      tY += f * (Math.sin(t * 0.53) * 7 + Math.sin(t * 1.17 + 0.6) * 1.6);
      tX += f * (Math.sin(t * 0.71 + 0.8) * 4 + Math.sin(t * 1.43) * 1);
      tY += clamp(-thetaV * 9 + endVX * 0.012, -16, 16);
      if (drag) tX += clamp(-vy * 0.008, -12, 12);
    }
    const K = reduce ? 140 : lerp(16, 120, smooth(0, 1.8, t));
    const D = 2 * Math.sqrt(K) * 0.72;
    ryV += ((tY - ry) * K - ryV * D) * DT; ry += ryV * DT;
    rxV += ((tX - rx) * K - rxV * D) * DT; rx += rxV * DT;

    // flip spring
    if (reduce) { fl = flT; flV = 0; }
    else { flV += ((flT - fl) * 75 - flV * 10.5) * DT; fl += flV * DT; }

    // light
    const cwp = CW * ks, chp = CH * ks;
    let gxT, gyT;
    if (ptr.active) { gxT = 50 + ((ptr.x - cardCx) / cwp) * 100; gyT = 50 + ((ptr.y - cardCy) / chp) * 100; }
    else { gxT = 32 - ry * 2.6; gyT = 18 + rx * 2.6; }
    gx = lerp(gx, clamp(gxT, -15, 115), 0.06);
    gy = lerp(gy, clamp(gyT, -15, 115), 0.06);
  }

  // ── render ────────────────────────────────────────────────────────────
  function render() {
    const end = pts[N];
    const sn = Math.sin(theta), cs = Math.cos(theta);
    cardCx = end.x + armL * sn;
    cardCy = end.y + armL * cs;

    const intro = reduce ? smooth(0, 0.5, clock) : smooth(0.05, 0.45, clock);
    hang.style.opacity = intro.toFixed(3);
    hang.style.transform = `translate3d(${end.x.toFixed(2)}px,${end.y.toFixed(2)}px,0) rotate(${(-theta).toFixed(4)}rad) scale(${ks.toFixed(4)})`;
    card.style.transform = `rotateX(${rx.toFixed(3)}deg) rotateY(${(ry + fl).toFixed(3)}deg)`;

    // The D-ring is sewn into the strap, so it hangs along the strap's end direction;
    // the swivel lets the clasp turn freely, so the clasp runs from the ring's tip down to
    // the card's slot. (SVG units = px at ks 1; the clasp point is (30, 4) in the SVG.)
    {
      const b = pts[N - 4];                        // over ~60px: the strap's overall run, not a kink
      let sx = end.x - b.x, sy = end.y - b.y; const sl = Math.hypot(sx, sy) || 1;
      strapEx = sx / sl; strapEy = sy / sl;
      const d = clamp(Math.atan2(-strapEx, strapEy) + theta, -0.7, 0.7);   // ring angle in the clasp's frame
      const px = 30 - 20.6 * Math.sin(d), py = 4 + 20.6 * Math.cos(d);    // ring tip → swivel eye
      const g = Math.atan2(-(30 - px), 81 - py);                          // eye → slot
      const deg = 180 / Math.PI;
      dRing.setAttribute('transform', `rotate(${(d * deg).toFixed(2)} 30 4)`);
      clawG.setAttribute('transform', `translate(${(px - 30).toFixed(2)} ${(py - 24.6).toFixed(2)}) rotate(${(g * deg).toFixed(2)} 30 24.6)`);
    }

    const mag = Math.min(1, Math.hypot(rx, ry) / 24);
    const st = card.style;
    // face::after extends 30% past each edge (160% box) → map card % into that box
    st.setProperty('--gx', ((gx + 30) / 1.6).toFixed(1) + '%');
    st.setProperty('--gxb', ((130 - gx) / 1.6).toFixed(1) + '%');   // back face is mirrored
    st.setProperty('--gy', ((gy + 30) / 1.6).toFixed(1) + '%');
    st.setProperty('--glare', (0.22 + mag * 0.6).toFixed(3));
    st.setProperty('--shine', (ry * 1.1 - rx * 0.5).toFixed(2) + '%');
    st.setProperty('--rim', (Math.atan2(rx, ry) * 57.3 + clock * 6).toFixed(1) + 'deg');
    st.setProperty('--rimO', (0.3 + mag * 0.6).toFixed(3));

    const rad = Math.PI / 180;
    const sx = cardCx + (16 + ry * 0.5) * ks + (cardCx - W / 2) * 0.05;
    const sy = cardCy + (34 + rx * 0.6) * ks;
    const scx = 0.9 * Math.abs(Math.cos((ry + fl) * rad));
    const scy = 0.88 * Math.abs(Math.cos(rx * rad));
    shadow.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0) rotate(${(-theta).toFixed(4)}rad) scale(${Math.max(0.05, scx).toFixed(3)},${scy.toFixed(3)})`;
    shadow.style.opacity = (intro * (0.2 - mag * 0.04)).toFixed(3);

    drawStrap();
  }

  // ── lanyard strap ─────────────────────────────────────────────────────
  const tmp = Array.from({ length: N + 2 }, () => ({ x: 0, y: 0 }));
  const LX = new Float32Array(N + 2), LY = new Float32Array(N + 2), RX = new Float32Array(N + 2), RY = new Float32Array(N + 2);
  const labelCache = { ks: 0, w: {} };

  function drawStrap() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const end = pts[N];
    // the end runs straight along the strap's own direction; the D-ring follows it (see render)
    const ex = strapEx, ey = strapEy;
    for (let i = 0; i <= N; i++) { tmp[i].x = pts[i].x; tmp[i].y = pts[i].y; }
    // the sewn end is stiff: its last two points ease onto that line, so the fold sits square on the ring
    const EASE = [0, 0.85, 0.55, 0.28, 0.1];          // stiff at the seam, fading out up the strap
    for (let k = 1; k <= 4; k++) {
      const p = pts[N - k], d = Math.hypot(p.x - end.x, p.y - end.y), m = EASE[k];
      tmp[N - k].x = p.x + (end.x - ex * d - p.x) * m;
      tmp[N - k].y = p.y + (end.y - ey * d - p.y) * m;
    }
    // the strap runs just past the D-ring's bar (which sits at the clasp point) and folds round it
    tmp[N + 1].x = end.x + ex * 3.4 * ks; tmp[N + 1].y = end.y + ey * 3.4 * ks;
    const n = N + 2, w = strapW / 2;
    for (let i = 0; i < n; i++) {
      const a = tmp[Math.max(0, i - 1)], b = tmp[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      LX[i] = tmp[i].x - ty * w; LY[i] = tmp[i].y + tx * w;
      RX[i] = tmp[i].x + ty * w; RY[i] = tmp[i].y - tx * w;
    }
    const outline = () => {
      ctx.beginPath(); ctx.moveTo(LX[0], LY[0]);
      for (let i = 1; i < n; i++) ctx.lineTo(LX[i], LY[i]);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(RX[i], RY[i]);
      ctx.closePath();
    };

    // body + soft cast shadow on the wall
    ctx.save();
    ctx.shadowColor = 'rgba(37, 34, 75, 0.2)';
    ctx.shadowBlur = 18 * ks * dpr;
    ctx.shadowOffsetX = 12 * ks * dpr;
    ctx.shadowOffsetY = 18 * ks * dpr;
    outline();
    ctx.fillStyle = '#16161b';
    ctx.fill();
    ctx.restore();

    // woven texture (fine cross ribs) + edge highlights
    ctx.save();
    outline();
    ctx.clip();
    ctx.beginPath();
    const step = 2.4 * ks;
    let acc = 0, next = 0;
    for (let i = 0; i < n - 1; i++) {
      const d = Math.hypot(tmp[i + 1].x - tmp[i].x, tmp[i + 1].y - tmp[i].y) || 0.001;
      while (next <= acc + d) {
        const f = (next - acc) / d;
        ctx.moveTo(LX[i] + (LX[i + 1] - LX[i]) * f, LY[i] + (LY[i + 1] - LY[i]) * f);
        ctx.lineTo(RX[i] + (RX[i + 1] - RX[i]) * f, RY[i] + (RY[i + 1] - RY[i]) * f);
        next += step;
      }
      acc += d;
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = Math.max(0.6, 0.9 * ks);
    ctx.stroke();
    ctx.lineWidth = 1.2 * ks;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.moveTo(LX[0], LY[0]); for (let i = 1; i < n; i++) ctx.lineTo(LX[i], LY[i]); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.moveTo(RX[0], RY[0]); for (let i = 1; i < n; i++) ctx.lineTo(RX[i], RY[i]); ctx.stroke();

    // the end: the strap loops round the D-ring's bar and is sewn back on itself.
    // Drawn in the end's own frame (+y runs down the strap, 0 = the bar).
    ctx.setTransform(dpr * ey, dpr * -ex, dpr * ex, dpr * ey, dpr * end.x, dpr * end.y);
    // rolled edge over the bar: lit on the curve, falling into shadow underneath
    const fold = ctx.createLinearGradient(0, -7 * ks, 0, 3.4 * ks);
    fold.addColorStop(0, 'rgba(255,255,255,0)');
    fold.addColorStop(0.45, 'rgba(255,255,255,0.07)');
    fold.addColorStop(0.62, 'rgba(255,255,255,0.13)');
    fold.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = fold;
    ctx.fillRect(-w - 2, -7 * ks, 2 * w + 4, 10.4 * ks + 1);
    // where the folded-back layer ends, under the front one: a faint ridge
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(-w - 2, -31 * ks, 2 * w + 4, 1.1 * ks);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-w - 2, -29.9 * ks, 2 * w + 4, 0.9 * ks);
    // box-and-cross stitch holding the loop
    const bx = w - 5 * ks, top = -26 * ks, bot = -11 * ks;
    ctx.setLineDash([2.2 * ks, 1.5 * ks]);
    ctx.lineWidth = Math.max(0.7, 0.85 * ks);
    ctx.strokeStyle = 'rgba(255,255,255,0.26)';
    ctx.strokeRect(-bx, top, 2 * bx, bot - top);
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath(); ctx.moveTo(-bx, top); ctx.lineTo(bx, bot); ctx.moveTo(bx, top); ctx.lineTo(-bx, bot); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // printed label running down the strap
    const fsz = 11.5 * ks;
    ctx.font = `600 ${fsz.toFixed(2)}px "Funnel Sans", system-ui, sans-serif`;
    if (labelCache.ks !== ks) { labelCache.ks = ks; labelCache.w = {}; }
    ctx.fillStyle = '#8e93cb';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const startS = -ANCHOR_Y + 16 * ks;
    const stopS = ropeLen - 40 * ks;           // the print stops above the stitching
    acc = 0; next = startS; let ci = 0;
    for (let i = 0; i < N; i++) {
      const p = pts[i], q = pts[i + 1];
      const d = Math.hypot(q.x - p.x, q.y - p.y) || 0.001;
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      while (next <= acc + d && next < stopS) {
        const f = (next - acc) / d;
        const ch = LABEL[ci % LABEL.length]; ci++;
        let cw = labelCache.w[ch];
        if (cw === undefined) cw = labelCache.w[ch] = ctx.measureText(ch).width;
        if (ch !== ' ') {
          ctx.setTransform(dpr * ca, dpr * sa, -dpr * sa, dpr * ca, dpr * (p.x + (q.x - p.x) * f), dpr * (p.y + (q.y - p.y) * f));
          ctx.fillText(ch, cw / 2, 0);
        }
        next += cw + 2.4 * ks;
      }
      acc += d;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── wordmark inflation ────────────────────────────────────────────────
  let waveT0 = 0, nextWave = 4.2, nearT = -10;
  function markStep(dt) {
    if (reduce || !started) return;
    const R = markFs * 0.78 * 0.9;
    const srcs = [];
    if (ptr.active) srcs.push([ptr.x, ptr.y]);
    srcs.push([cardCx, cardCy + CH * ks * 0.35]);   // the lower part of the card brushes the name

    let wc = null;
    if (waveT0) {
      const e = (clock - waveT0) / 1.7;
      if (e >= 1) { waveT0 = 0; nextWave = clock + 6 + Math.random() * 2; }
      else wc = -2.5 + e * (letters.length + 5);
    } else if (clock > nextWave && clock - nearT > 2) { waveT0 = clock; }
    else if (clock > nextWave) nextWave = clock + 1;

    for (let i = 0; i < letters.length; i++) {
      const l = letters[i];
      if (l.ch === ' ') continue;
      let t = 0;
      for (const s of srcs) {
        const dx = s[0] - l.cx, dy = s[1] - l.cy;
        t = Math.max(t, Math.exp(-(dx * dx + dy * dy) / (R * R)));
      }
      if (t > 0.05 && ptr.active) nearT = clock;
      if (wc !== null) { const u = (i - wc) / 1.15; t = Math.max(t, 0.85 * Math.exp(-u * u)); }
      if (t > l.k + 0.002 || l.v > 0.01) {
        const w = 15, z = 0.42;
        l.v += (w * w * (t - l.k) - 2 * z * w * l.v) * dt; l.k += l.v * dt;
      } else {
        l.v = 0; l.k += (t - l.k) * (1 - Math.exp(-dt / (wc !== null ? 0.16 : 0.45)));
      }
      const q = Math.max(0, l.k), key = q < 0.012 ? '' : q.toFixed(3);
      if (key === l.shown) continue;
      l.shown = key;
      if (!key) { l.e.style.transform = ''; l.e.style.fontVariationSettings = ''; l.e.style.textShadow = ''; continue; }
      l.e.style.transform = `translate3d(0,${(-0.028 * q).toFixed(4)}em,0) scale(${(1 + 0.06 * q).toFixed(4)})`;
      if (!coarse) {
        l.e.style.fontVariationSettings = `"wght" ${Math.round(500 + 100 * Math.min(1, q))}`;
        l.e.style.textShadow = `0 ${(0.04 * q).toFixed(3)}em ${(0.07 * q).toFixed(3)}em rgba(43,39,91,${(0.2 * Math.min(1, q)).toFixed(3)})`;
      }
    }
  }

  // ── loop ──────────────────────────────────────────────────────────────
  let acc = 0, lastTs = 0;
  function frame(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 8) { step(clock); clock += DT; acc -= DT; n++; }
    if (n === 8) acc = 0;
    if (window.scrollY < H) {        // only draw the hero while it's on screen
      render();
      markStep(dt);
    }
    campTick();
    scrollNudge();
    aboutTick();
    expTick();
    requestAnimationFrame(frame);
  }

  // ── campaign: the card is the ad ──────────────────────────────────────
  const stats = { imp: 0, eng: 0, clk: 0, lead: 0 };
  const kImp = $('#kImp'), kEng = $('#kEng'), kLead = $('#kLead'), lBar = $('#lBar'), lTxt = $('#lTxt');
  const campState = $('#campState'), campDot = $('#campDot');
  const fired = new Set();
  let lastImp = -10, launched = false, hovering = false;

  const pad = (n) => String(n).padStart(2, '0');
  // values roll up into place (like a counter), no bouncing
  function setText(el, v) {
    if (el.textContent === v) return;
    el.textContent = v;
    el.classList.remove('roll'); void el.offsetWidth; el.classList.add('roll');
  }
  function renderStats() {
    setText(kImp, pad(stats.imp));
    setText(kEng, pad(stats.eng));
    setText(kLead, pad(stats.lead));
    lBar.style.width = (Math.min(1, stats.eng / 50) * 100).toFixed(1) + '%';
    if (stats.eng >= 50) {
      lTxt.textContent = 'Complete';
      campState.textContent = 'Contact Zuha · Optimised';
      campDot.className = 'done';
    } else {
      lTxt.textContent = `${pad(stats.eng)} / 50`;
    }
  }
  let toastTO = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTO);
    toastTO = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  function fire(ev) {
    const li = document.querySelector(`.px li[data-ev="${ev}"]`);
    if (!li) return;
    li.classList.add('fired');
    if (!fired.has(ev)) { fired.add(ev); if (ev === 'Lead') toast('Conversion tracked · Lead'); }
  }
  function engage(click) { stats.eng++; if (click) stats.clk++; renderStats(); }
  function impression() { if (clock - lastImp > 1.5) { lastImp = clock; stats.imp++; renderStats(); } }

  function campTick() {
    if (!launched && clock > (reduce ? 0.4 : 1.7)) {
      launched = true;
      campDot.className = 'on';
      lastImp = clock; stats.imp = 1; renderStats();
      fire('PageView');
    }
    // a new impression each time the cursor comes onto the card
    if (launched && ptr.active && !coarse) {
      const half = CW * ks / 2, hh = CH * ks / 2;
      const over = Math.abs(ptr.x - cardCx) < half && Math.abs(ptr.y - cardCy) < hh;
      if (over && !hovering) impression();
      hovering = over;
    }
  }

  // ── flip ──────────────────────────────────────────────────────────────
  function setFlip(back) {
    flT = back ? 180 : 0;
    card.classList.toggle('is-back', back);
    if (back) { engage(true); fire('ViewContent'); }
    else engage(false);
  }
  $('#toBack').addEventListener('click', (e) => { e.stopPropagation(); setFlip(true); });
  $('#toFront').addEventListener('click', (e) => { e.stopPropagation(); setFlip(false); });

  // contact rows: copy / open = a lead
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove(); return ok;
    }
  }
  document.querySelectorAll('.crow').forEach((row) => {
    row.addEventListener('click', async (e) => {
      e.stopPropagation();
      const v = row.dataset.copy;
      if (v) {
        await copyText(v);
        row.classList.add('ok');
        setTimeout(() => row.classList.remove('ok'), 1600);
      }
      stats.lead++;            // copying phone / email or opening LinkedIn = a lead
      engage(true);
      fire('Lead');
    });
  });

  // ── input ─────────────────────────────────────────────────────────────
  // the page scrolls now: physics lives in page coordinates (the hero starts at y = 0)
  let lastClientY = 0;
  const pageY = (e) => e.clientY + window.scrollY;
  function setPtr(e) { ptr.x = e.clientX; ptr.y = pageY(e); lastClientY = e.clientY; ptr.active = true; }

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || e.buttons || drag) setPtr(e);
    if (drag && e.pointerId === drag.id) {
      drag.x = e.clientX; drag.y = pageY(e);
      if (Math.hypot(e.clientX - drag.sx, pageY(e) - drag.sy) > 8) drag.moved = true;
    }
  }, { passive: true });
  // scrolling under a still mouse moves the pointer relative to the page
  window.addEventListener('scroll', () => { if (ptr.active && !coarse) ptr.y = lastClientY + window.scrollY; }, { passive: true });
  hero.addEventListener('pointerdown', setPtr, { passive: true });

  // a click anywhere on the card flips it (a real drag doesn't count as a click;
  // the contact rows and arrow buttons keep their own behaviour)
  let suppressTap = false;
  card.addEventListener('click', (e) => {
    if (e.target.closest('button, a')) return;
    if (suppressTap) { suppressTap = false; return; }
    setFlip(!card.classList.contains('is-back'));
  });

  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a')) return;          // let buttons/links work
    suppressTap = false;
    if (reduce || clock < 0.9) return;
    e.preventDefault();
    try { card.setPointerCapture(e.pointerId); } catch (_) {}
    const end = pts[N];
    const py = pageY(e);
    drag = { id: e.pointerId, ox: e.clientX - end.x, oy: py - end.y, x: e.clientX, y: py, sx: e.clientX, sy: py, moved: false };
    card.classList.add('grabbing');
    setPtr(e);
  });

  function release(e) {
    if (drag && e.pointerId === drag.id) {
      if (drag.moved) { engage(false); suppressTap = true; }
      drag = null;
      card.classList.remove('grabbing');
    }
    if (e.pointerType !== 'mouse') ptr.active = false;
  }
  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', release);
  hero.addEventListener('pointerup', release);
  hero.addEventListener('pointercancel', release);

  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget && !drag) { ptr.active = false; hovering = false; } });
  window.addEventListener('blur', () => { if (!drag) ptr.active = false; });

  if (coarse) {
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || e.beta == null) return;
      orient.active = true;
      orient.nx = clamp(e.gamma / 28, -1, 1);
      orient.ny = clamp((e.beta - 45) / 28, -1, 1);
    });
  }

  let rto = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(rto); rto = requestAnimationFrame(() => relayout()); });
  const onReduce = (e) => { reduce = e.matches; sceneDirty = true; xDirty = true; };
  if (mqReduce.addEventListener) mqReduce.addEventListener('change', onReduce);
  else if (mqReduce.addListener) mqReduce.addListener(onReduce);

  // ── about: a pinned, scroll-scrubbed scene ────────────────────────────
  // The section sticks briefly while you scroll through its track. Scroll position becomes
  // a timeline T: 0 → 1 while the section slides in, 1 → 2 while it's pinned.
  //   "About Zuha" enters at the top-right corner, runs left along the top edge, turns
  //   the corner and travels down the left side, where it stays → headline inks in word
  //   by word → copy → fact rows draw themselves → details. Zuha's photo stays still.
  // Scrolling back rewinds it. Phones (no pin) play each piece as it crosses into view.
  const track = $('#about'), stage = $('#aboutStage'), amark = $('#amark'), aTitle = $('#aboutTitle');
  const aFacts = $('#aFacts');
  const stnBtns = [...document.querySelectorAll('.stn button')];
  const peek = document.querySelector('.peek');
  const copyEl = hero.querySelector('.copy');
  const sc = {};
  document.querySelectorAll('[data-sc]').forEach((el) => { sc[el.dataset.sc] = el; });
  const rows = [...aFacts.children];

  // style writes only when a value actually changes
  const written = new WeakMap();
  function put(el, prop, val) {
    let c = written.get(el); if (!c) { c = {}; written.set(el, c); }
    if (c[prop] === val) return;
    c[prop] = val;
    if (prop.charCodeAt(0) === 45) el.style.setProperty(prop, val); else el.style[prop] = val;
  }
  const band = (T, a, b) => { const t = clamp((T - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const fade = (el, t, dy = 16) => {
    put(el, 'opacity', t.toFixed(3));
    put(el, 'transform', t >= 1 ? 'none' : `translate3d(0,${((1 - t) * dy).toFixed(1)}px,0)`);
  };
  // phones: how far an element has travelled into the viewport (0 at the bottom edge → 1 a bit above)
  const local = (el, span = 0.38) => {
    const r = el.getBoundingClientRect(), vh = window.innerHeight;
    return clamp((vh * 0.94 - r.top) / (vh * span), 0, 1);
  };

  // split the name into letters, and the headline into words
  const aLetters = [];
  (() => {
    const t = amark.textContent; amark.textContent = '';
    for (const ch of t) {
      const e = document.createElement('span');
      e.className = 'al'; e.textContent = ch === ' ' ? ' ' : ch;
      amark.appendChild(e); aLetters.push(e);
    }
  })();
  const words = [];
  (function split(node) {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          const w = document.createElement('span'); w.className = 'w'; w.textContent = part;
          frag.appendChild(w); words.push(w);
        });
        node.replaceChild(frag, n);
      } else if (n.nodeType === 1) split(n);
    });
  })(aTitle);

  // The name's route (desktop), in stage pixels: a straight run along the top edge from
  // just past the right side, a rounded left turn at the top-left corner, then straight
  // down the left edge. Its final resting place is the vertical name, reading bottom → top.
  const route = { on: false, x0: 0, yh: 0, xv: 0, R: 0, L1: 0, L2: 0, U: 0, c: [], w: [], h: 0 };
  function routeAt(u) {
    const { x0, yh, xv, R, L1, L2 } = route;
    if (u < L1) return [x0 - u, yh, 0];                               // along the top, heading left
    if (u < L1 + L2) {                                                // the corner
      const a = -Math.PI / 2 - (u - L1) / R;
      const tx = Math.sin(a), ty = -Math.cos(a);
      return [xv + R + R * Math.cos(a), yh + R + R * Math.sin(a), Math.atan2(-ty, -tx) * 180 / Math.PI];
    }
    return [xv, yh + R + (u - L1 - L2), -90];                         // down the left side
  }

  // the vertical name fills the stage's height (on phones it lies flat across the width)
  function fitAboutMark() {
    amark.classList.remove('path');
    aLetters.forEach((el) => { el.style.transform = ''; el.style.opacity = ''; written.delete(el); });
    amark.style.fontSize = '100px';
    const w100 = amark.offsetWidth, h100 = aLetters[0].offsetHeight;
    const c100 = aLetters.map((el) => el.offsetLeft + el.offsetWidth / 2);
    const ww100 = aLetters.map((el) => el.offsetWidth);
    let fs;
    route.on = !mobile;
    if (mobile) {
      fs = (W - 36) / (w100 / 100);
    } else {
      const sh = stage.clientHeight, top = 20, bot = 72;
      // the whole name has to fit on the straight part below the corner
      fs = Math.min((sh - bot - top - 8) / (w100 / 100 + 1.6 * h100 / 100), W * 0.14);
      const s = fs / 100, h = h100 * s;
      route.h = h;
      route.c = c100.map((v) => v * s);
      route.w = ww100.map((v) => v * s);
      route.xv = 32 + h / 2;
      route.yh = top + h / 2;
      route.R = 1.1 * h;
      route.x0 = stage.clientWidth + h * 0.7;
      route.L1 = route.x0 - (route.xv + route.R);
      route.L2 = Math.PI * route.R / 2;
      route.U = route.L1 + route.L2 + (sh - bot - route.yh - route.R);
      amark.classList.add('path');
    }
    amark.style.fontSize = fs.toFixed(2) + 'px';
    stage.style.setProperty('--amk', mobile ? '0px' : (fs * 0.78).toFixed(1) + 'px');
  }
  function relayout() { layout(); fitAboutMark(); fitExp(); sceneDirty = true; }

  let sceneDirty = true;
  function aboutTick() {
    const vh = window.innerHeight;
    const r = track.getBoundingClientRect();
    const near = r.bottom > -40 && r.top < vh + 40;
    if (!near && !sceneDirty) return;
    sceneDirty = false;
    const still = reduce;
    const pinned = !mobile && !still;

    // timeline
    const pinLen = r.height - vh;
    const p = pinLen > 0 ? clamp(-r.top / pinLen, 0, 1) : 0;
    const T = still ? 2 : clamp((vh - r.top) / vh, 0, 1) + p;
    const at = (a, b, el, stagger = 0) => (pinned || still ? band(T, a, b) : band(local(el) * 1.25 - stagger, 0, 1));

    // lights
    put(stage, '--lit', (pinned ? band(T, 0.05, 0.6) : 1).toFixed(3));
    put(stage, '--spot', (pinned ? band(T, 0.4, 0.9) : 1).toFixed(3));
    put(stage, '--p', p.toFixed(4));

    // the name travels its route: in at the top-right, left along the top, round the corner, down
    if (route.on) {
      const e = still ? 1 : band(T, 0.04, 1.7);
      const head = e * route.U;
      aLetters.forEach((el, i) => {
        const [x, y, rot] = routeAt(head - route.c[i]);
        put(el, 'transform', `translate3d(${(x - route.w[i] / 2).toFixed(1)}px,${(y - route.h / 2).toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg)`);
      });
    } else {
      aLetters.forEach((el, i) => {
        const t = at(0, 1, amark, i * 0.05);
        put(el, 'opacity', t.toFixed(3));
        put(el, 'transform', t >= 1 ? 'none' : `translate3d(0,${((1 - t) * 45).toFixed(1)}%,0)`);
      });
    }

    fade(sc.eyebrow, at(0.3, 0.45, sc.eyebrow), 12);

    // headline inks in word by word
    const m = words.length;
    words.forEach((w, j) => {
      const a = 0.35 + j * (0.25 / m);
      const t = at(a, a + 0.12, aTitle, j * 0.06);
      put(w, 'opacity', (0.08 + 0.92 * t).toFixed(3));
      put(w, 'transform', t >= 1 ? 'none' : `translate3d(0,${((1 - t) * 0.38).toFixed(3)}em,0)`);
    });

    fade(sc.lead, at(0.62, 0.78, sc.lead));
    fade(sc.body, at(0.7, 0.86, sc.body));

    // fact rows draw their hairline, then the words slide in
    rows.forEach((row, k) => put(row, '--t', at(0.8 + k * 0.05, 0.94 + k * 0.05, row).toFixed(4)));
    put(aFacts, '--tb', at(1.0, 1.12, aFacts).toFixed(4));

    fade(sc.how, at(1.0, 1.14, sc.how), 12);
  }

  // ── experience: her work dealt onto the desk ────────────────────────────
  // Like the reference's pile of work cards. The section pins briefly; scroll T runs
  // 0 → 1 while it slides in and 1 → 2 while pinned:
  //   the lamp comes up and "Experience" prints along the desk's edge → the headline inks
  //   in → rows draw → four "ad set" cards are dealt from off the corner of the desk, one
  //   by one, each landing with a little lift and its drawing inking in.
  // After that the cards are yours: drag and throw them (they slide to a stop).
  const xTrack = $('#experience'), xStage = $('#xStage'), xmark = $('#xmark'), xTitle = $('#expTitle');
  const xDesk = $('#xDesk'), xRows = $('#xRows');
  const xText = xStage.querySelector('.x-text');
  const xs = {};
  xStage.querySelectorAll('[data-x]').forEach((el) => { xs[el.dataset.x] = el; });
  const xRowEls = [...xRows.children];
  const xCards = [...xDesk.children].map((el, i) => ({ el, i, x: 0, y: 0, r: 0, hx: 0, hy: 0, hr: 0, h: 300, held: false, vx: 0, vy: 0 }));
  xCards.forEach((c) => c.el.querySelectorAll('.xc-art .d').forEach((p) => p.setAttribute('pathLength', '1')));

  // split "Experience" into letters and the headline into words
  const xLetters = [];
  (() => {
    const t = xmark.textContent; xmark.textContent = '';
    for (const ch of t) { const e = document.createElement('span'); e.className = 'xl'; e.textContent = ch; xmark.appendChild(e); xLetters.push(e); }
  })();
  const xWords = [];
  (function split(node) {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          const w = document.createElement('span'); w.className = 'w'; w.textContent = part;
          frag.appendChild(w); xWords.push(w);
        });
        node.replaceChild(frag, n);
      } else if (n.nodeType === 1) split(n);
    });
  })(xTitle);

  // the desk: the area right of the text where card centres may rest
  const desk = { x0: 0, y0: 0, x1: 0, y1: 0, cw: 280, sw: 0, sh: 0 };
  const SCATTER = [[0.22, 0.26, -7], [0.76, 0.22, 5], [0.3, 0.78, 4], [0.78, 0.74, -6]];
  function homes() {
    const { x0, y0, x1, y1 } = desk, w = x1 - x0, h = y1 - y0;
    xCards.forEach((c, i) => {
      const [fx, fy, r] = SCATTER[i];
      c.hx = x0 + fx * w; c.hy = y0 + fy * h; c.hr = r;
    });
  }

  function fitExp() {
    xmark.style.fontSize = '100px';
    const w100 = xmark.offsetWidth;
    if (mobile) {
      xmark.style.fontSize = ((W - 36) / (w100 / 100)).toFixed(2) + 'px';
      xStage.style.setProperty('--cw', Math.min(330, W - 56) + 'px');
      xCards.forEach((c) => { c.el.style.zIndex = ''; c.el.style.visibility = ''; written.delete(c.el); });
      xDirty = true;
      return;
    }
    const sw = xStage.clientWidth, sh = xStage.clientHeight;
    const fs = Math.min((sw - 64) / (w100 / 100), sh * 0.3);
    xmark.style.fontSize = fs.toFixed(2) + 'px';
    xStage.style.setProperty('--xmh', (fs * 0.98).toFixed(0) + 'px');
    const textR = xText.offsetLeft + xText.offsetWidth;
    desk.sw = sw; desk.sh = sh;
    desk.x0 = textR + 48; desk.x1 = sw - 72; desk.y0 = 36; desk.y1 = sh - 36;
    const cw = clamp(Math.min((desk.x1 - desk.x0) * 0.4, (desk.y1 - desk.y0) / 2.55), 200, 300);
    desk.cw = cw;
    xStage.style.setProperty('--cw', cw.toFixed(0) + 'px');
    xCards.forEach((c) => { c.h = c.el.offsetHeight; });
    // keep the cards' centres far enough in that they stay on the desk
    const tallest = Math.max(...xCards.map((c) => c.h));
    desk.x0 += cw * 0.45; desk.x1 -= cw * 0.45;
    desk.y0 += tallest * 0.42; desk.y1 -= tallest * 0.42;
    homes();
    xCards.forEach((c) => { if (!c.held) { c.x = c.hx; c.y = c.hy; c.r = c.hr; } });
    xDirty = true;
  }

  // drag & throw
  let xz = 10, xDealt = false, xDirty = true;
  xCards.forEach((c) => {
    const el = c.el;
    let ox = 0, oy = 0, sx = 0, sy = 0, lt = 0, lx = 0, ly = 0, moved = 0;
    const stageXY = (e) => { const r = xStage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    el.addEventListener('pointerdown', (e) => {
      if (mobile || !xDealt || e.button > 0) return;
      e.preventDefault();
      const [px, py] = stageXY(e);
      c.held = true; ox = c.x - px; oy = c.y - py; sx = px; sy = py; lx = px; ly = py; lt = performance.now(); moved = 0;
      c.vx = c.vy = 0;
      el.style.zIndex = ++xz; el.classList.add('held');
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      xDirty = true;
    });
    el.addEventListener('pointermove', (e) => {
      if (!c.held) return;
      const [px, py] = stageXY(e), now = performance.now(), dt = Math.max(8, now - lt);
      c.vx = c.vx * 0.6 + ((px - lx) / dt) * 1000 * 0.4;      // px/s, smoothed
      c.vy = c.vy * 0.6 + ((py - ly) / dt) * 1000 * 0.4;
      lx = px; ly = py; lt = now;
      moved = Math.max(moved, Math.hypot(px - sx, py - sy));
      c.x = px + ox; c.y = py + oy;
      c.r += (c.hr + clamp(c.vx * 0.006, -14, 14) - c.r) * 0.25;   // leans into the motion
      xDirty = true;
    });
    const up = () => {
      if (!c.held) return;
      c.held = false; el.classList.remove('held');
      if (performance.now() - lt > 90) { c.vx = 0; c.vy = 0; }      // stopped before letting go: it stays put
      // thrown: it slides on along its path and comes to rest, with a bit of spin
      c.hx = clamp(c.x + c.vx * 0.22, desk.x0 - desk.cw * 0.3, desk.x1 + desk.cw * 0.3);
      c.hy = clamp(c.y + c.vy * 0.22, desk.y0 - 60, desk.y1 + 60);
      c.hr = clamp(c.r + c.vx * 0.012, -28, 28);
      xDirty = true;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });

  function expTick() {
    const vh = window.innerHeight, r = xTrack.getBoundingClientRect();
    if ((r.bottom < -40 || r.top > vh + 40) && !xDirty) return;
    xDirty = false;
    const still = reduce;
    const pinned = !mobile && !still;
    const pinLen = r.height - vh;
    const p = pinLen > 0 ? clamp(-r.top / pinLen, 0, 1) : 0;
    const T = still ? 2 : clamp((vh - r.top) / vh, 0, 1) + p;
    const at = (a, b, el, stagger = 0) => (pinned || still ? band(T, a, b) : band(local(el, 0.3) * 1.25 - stagger, 0, 1));

    put(xStage, '--pool', (pinned ? band(T, 0.2, 0.9) : 1).toFixed(3));
    xLetters.forEach((el, i) => {
      const t = pinned || still ? band(T, 0.2 + i * 0.035, 0.5 + i * 0.035) : band(local(xmark, 0.3) * 1.3 - i * 0.04, 0, 1);
      put(el, 'transform', t >= 1 ? 'none' : `translate3d(0,${((1 - t) * 100).toFixed(1)}%,0)`);
    });
    fade(xs.eyebrow, at(0.25, 0.4, xs.eyebrow), 12);
    const m = xWords.length;
    xWords.forEach((w, j) => {
      const t = at(0.3 + j * (0.2 / m), 0.42 + j * (0.2 / m), xTitle, j * 0.08);
      put(w, 'opacity', (0.08 + 0.92 * t).toFixed(3));
      put(w, 'transform', t >= 1 ? 'none' : `translate3d(0,${((1 - t) * 0.38).toFixed(3)}em,0)`);
    });
    fade(xs.lead, at(0.48, 0.62, xs.lead));
    xRowEls.forEach((row, k) => put(row, '--t', at(0.58 + k * 0.05, 0.7 + k * 0.05, row).toFixed(4)));
    put(xRows, '--tb', at(0.82, 0.92, xRows).toFixed(4));
    fade(xs.ctl, at(0.9, 1.05, xs.ctl), 10);

    if (mobile) {
      // phones: each card slides in from the right edge, turning as it lands, then its drawing inks in
      xCards.forEach((c, i) => {
        const t = still ? 1 : band(local(c.el, 0.32) * 1.2, 0, 1);
        const tilt = i % 2 ? 2 : -2;
        put(c.el, 'transform', `translate3d(${((1 - t) * W * 0.75).toFixed(1)}px,0,0) rotate(${(tilt + (1 - t) * 16).toFixed(2)}deg)`);
        put(c.el, '--dr', band(t, 0.6, 1).toFixed(3));
      });
      return;
    }

    // desktop: springs carry each card toward its resting place (instant with reduced motion)
    const k = still ? 1 : 0.14;
    let moving = false;
    xDealt = true;
    xCards.forEach((c, i) => {
      if (!c.held) {
        c.x += (c.hx - c.x) * k; c.y += (c.hy - c.y) * k; c.r += (c.hr - c.r) * k;
        if (Math.abs(c.hx - c.x) + Math.abs(c.hy - c.y) + Math.abs(c.hr - c.r) > 0.2) moving = true;
      }
      // the deal: from a deck off the bottom-right corner, along a little arc, onto the desk
      const a = 0.36 + i * 0.17, d = still ? 1 : band(T, a, a + 0.42);
      if (d < 1) xDealt = false;
      const sx = desk.sw + desk.cw * 0.8, sy = desk.sh + c.h * 0.3, sr = 28 - i * 4;
      const lift = Math.sin(Math.PI * d);
      const x = sx + (c.x - sx) * d, y = sy + (c.y - sy) * d - lift * 70, rot = sr + (c.r - sr) * d;
      const sc = 1 + lift * 0.07 + (c.held ? 0.04 : 0);
      put(c.el, 'transform', `translate3d(${(x - desk.cw / 2).toFixed(1)}px,${(y - c.h / 2).toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`);
      put(c.el, 'visibility', d <= 0 ? 'hidden' : 'visible');
      put(c.el, '--dr', (still ? 1 : band(T, a + 0.38, a + 0.6)).toFixed(3));
    });
    if (moving || xCards.some((c) => c.held)) xDirty = true;
  }

  // ── scroll: section dots, the scroll cue, and a little life in the hero ──
  // "About" lands at the end of the scene, so a click plays the whole thing on the way down
  function aboutEnd() {
    return mobile || reduce ? track.offsetTop : track.offsetTop + track.offsetHeight - window.innerHeight;
  }
  function goTo(id) {
    const behavior = reduce ? 'auto' : 'smooth';
    if (id === 'hero') window.scrollTo({ top: 0, behavior });
    else if (id === 'about') window.scrollTo({ top: aboutEnd(), behavior });
    else if (id === 'experience') window.scrollTo({ top: mobile || reduce ? xTrack.offsetTop : xTrack.offsetTop + (xTrack.offsetHeight - window.innerHeight) * 0.5, behavior });
  }
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.go)));

  let lastScrollY = window.scrollY, scrollKick = 0;
  function onScroll() {
    const y = window.scrollY;
    if (y < H && lastScrollY < H) scrollKick += clamp(y - lastScrollY, -90, 90);   // only while the card is on screen
    lastScrollY = y;
    const half = window.innerHeight * 0.5;
    const i = y > xTrack.offsetTop - half ? 2 : y > track.offsetTop - half ? 1 : 0;
    stnBtns.forEach((b, k) => { if (k === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    peek.classList.toggle('gone', y > 40);
    // hero copy drifts up ahead of the page and fades: the card hangs in front of it
    if (!reduce && y < H * 1.1) {
      const k = clamp(y / H, 0, 1);
      put(copyEl, 'transform', y > 0 ? `translate3d(0,${(-y * 0.18).toFixed(1)}px,0)` : 'none');   // leaves a little faster than the page
      put(copyEl, 'opacity', (1 - k * 0.65).toFixed(3));
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // scroll speed nudges the hanging card: it bobs and sways, then settles
  function scrollNudge() {
    if (!scrollKick || reduce || drag) { scrollKick = 0; return; }
    const end = pts[N];
    end.py += scrollKick * 0.08;      // verlet: moving the previous position = an impulse
    end.px -= scrollKick * 0.025;
    scrollKick = 0;
  }

  // ── boot ──────────────────────────────────────────────────────────────
  relayout();
  initRope();
  render();
  onScroll();
  aboutTick();

  function go() {
    if (started) return;
    started = true;
    relayout();                     // fonts may have arrived → re-fit the names
    initRope();
    hero.classList.add('is-live');
    requestAnimationFrame(frame);
  }
  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  const imgReady = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
  Promise.all([fontsReady, imgReady]).then(() => setTimeout(go, reduce ? 0 : 200));
  setTimeout(go, 3500);
  if (document.fonts) document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', () => { if (started) relayout(); });
})();
