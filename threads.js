// Tiny Butterfly — "threads": the palette's name as fine outline lettering, made of particles.
// Touch flings the outline apart into a constellation of coloured nodes joined by thin lines, with
// some stretching into vertical strings; then it knits itself back together. Drawn in 2D here and
// handed to shader.js as two textures: the crisp lines, and a small copy for the glow.

const Threads = (() => {
  const SPACING = 0.006;  // particle spacing along the outline, in screen heights
  const REACH = 0.085;    // how far from the finger the outline comes apart
  const LINK = 0.065;     // nodes closer than this get joined by a line
  const LINGER = 0.2;     // how fast a flung particle settles (per second; lower = lingers longer)
  const IDLE = 4;         // seconds without touch before the outline starts disturbing itself
  const GLOW = 8;         // the glow copy is this many times smaller

  let canvas, ctx, glowCanvas, gctx;
  let W = 0, H = 0, word = 'tiny butterfly', built = '';
  let n = 0, P = null;    // particle arrays (see build)
  let chains = [];        // [start, end) index ranges, each a closed loop
  let inks = ['#fff'];    // palette colours as css, last one is white
  let bounds = { x0: 0, x1: 1, y0: 0, y1: 1 };
  let prev = null, idle = 0, ghost = null, clock = 0;

  function init() {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
    glowCanvas = document.createElement('canvas');
    gctx = glowCanvas.getContext('2d');
    if (document.fonts) document.fonts.load('500 100px "Space Grotesk"').then(() => { built = ''; });
  }

  function setWord(w) {
    word = (w || '').trim() || 'tiny butterfly';
  }

  function setColours(cols, count) {
    inks = [];
    for (let i = 0; i < count; i++) {
      let [r, g, b] = [cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 0.3) { const k = 0.35; r += (1 - r) * k; g += (1 - g) * k; b += (1 - b) * k; } // keep dark ones visible on black
      inks.push(`rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`);
    }
    inks.push('#fff');
    built = ''; // particles pick their colour at build time
  }

  // ---- layout: words → lines → a filled mask → traced outline loops → particles ----------
  function lines() {
    const words = word.split(/\s+/);
    const font = (s) => `500 ${s}px "Space Grotesk", system-ui, sans-serif`;
    ctx.font = font(100);
    let best = null;
    for (let rows = 1; rows <= Math.min(3, words.length); rows++) {
      // split into `rows` lines of roughly even width
      const per = Math.ceil(words.length / rows), ls = [];
      for (let i = 0; i < words.length; i += per) ls.push(words.slice(i, i + per).join(' '));
      const wide = Math.max(...ls.map((l) => ctx.measureText(l).width));
      const size = Math.min((W * 0.86 / wide) * 100, H * 0.62 / (ls.length * 1.05), H * 0.2);
      if (!best || size > best.size * 1.15) best = { ls, size };
    }
    return { ...best, font: font(best.size) };
  }

  function build() {
    const { ls, size, font } = lines();
    const mask = document.createElement('canvas');
    mask.width = W; mask.height = H;
    const m = mask.getContext('2d');
    m.font = font;
    m.textAlign = 'center';
    m.textBaseline = 'middle';
    m.fillStyle = '#fff';
    const lh = size * 1.05;
    ls.forEach((l, i) => m.fillText(l, W / 2, H / 2 + (i - (ls.length - 1) / 2) * lh));
    const a = m.getImageData(0, 0, W, H).data;

    // Marching squares on the alpha, every `s` pixels, with endpoints keyed by the grid edge they
    // sit on so segments can be chained into loops exactly.
    const s = Math.max(1, Math.round(H * 0.0015));
    const gw = Math.floor((W - 1) / s), gh = Math.floor((H - 1) / s);
    const v = (i, j) => a[((j * s) * W + i * s) * 4 + 3] / 255;
    const at = new Map(); // edge key -> [x, y]
    const next = new Map(); // edge key -> edge key (walk direction)
    const edge = (i, j, side) => {
      // side 0 = top (i,j)-(i+1,j), 1 = right, 2 = bottom, 3 = left
      const key = side === 0 ? `h${i},${j}` : side === 2 ? `h${i},${j + 1}` : side === 1 ? `v${i + 1},${j}` : `v${i},${j}`;
      if (!at.has(key)) {
        const [x0, y0, x1, y1] = side === 0 ? [i, j, i + 1, j] : side === 2 ? [i, j + 1, i + 1, j + 1]
          : side === 1 ? [i + 1, j, i + 1, j + 1] : [i, j, i, j + 1];
        const va = v(x0, y0), vb = v(x1, y1), t = Math.abs(vb - va) > 1e-6 ? (0.5 - va) / (vb - va) : 0.5;
        at.set(key, [(x0 + (x1 - x0) * t) * s, (y0 + (y1 - y0) * t) * s]);
      }
      return key;
    };
    // segment table: for each case, pairs of [from side, to side] keeping the inside on one hand
    const T = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[1, 0]], [[3, 0], [1, 2]], [[2, 0]], [[3, 0]],
      [[0, 3]], [[0, 2]], [[0, 1], [2, 3]], [[0, 1]], [[1, 3]], [[1, 2]], [[2, 3]], []];
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const c = (v(i, j) > 0.5 ? 8 : 0) | (v(i + 1, j) > 0.5 ? 4 : 0) | (v(i + 1, j + 1) > 0.5 ? 2 : 0) | (v(i, j + 1) > 0.5 ? 1 : 0);
        for (const [f, t] of T[c]) next.set(edge(i, j, f), edge(i, j, t));
      }
    }

    // walk the loops, then resample each at an even spacing
    const step = SPACING * H, loops = [];
    const seen = new Set();
    for (const k0 of next.keys()) {
      if (seen.has(k0)) continue;
      const pts = [];
      let k = k0;
      while (k && !seen.has(k)) { seen.add(k); pts.push(at.get(k)); k = next.get(k); }
      if (pts.length < 4) continue;
      let len = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        len += Math.hypot(q[0] - p[0], q[1] - p[1]);
      }
      const count = Math.max(6, Math.round(len / step)), d = len / count, out = [];
      let i = 0, acc = 0;
      for (let c = 0; c < count; c++) {
        const want = c * d;
        for (;;) {
          const p = pts[i % pts.length], q = pts[(i + 1) % pts.length];
          const sl = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (acc + sl >= want || i > pts.length * 2) {
            const t = sl > 0 ? (want - acc) / sl : 0;
            out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
            break;
          }
          acc += sl; i++;
        }
      }
      loops.push(out);
    }

    n = loops.reduce((t, l) => t + l.length, 0);
    P = {
      hx: new Float32Array(n), hy: new Float32Array(n), x: new Float32Array(n), y: new Float32Array(n),
      vx: new Float32Array(n), vy: new Float32Array(n), e: new Float32Array(n),
      ox: new Float32Array(n), oy: new Float32Array(n), seed: new Float32Array(n),
      ink: new Uint8Array(n), node: new Uint8Array(n), string: new Uint8Array(n),
    };
    chains = [];
    let k = 0;
    bounds = { x0: W, x1: 0, y0: H, y1: 0 };
    for (const l of loops) {
      chains.push([k, k + l.length]);
      for (const [x, y] of l) {
        P.hx[k] = P.x[k] = x; P.hy[k] = P.y[k] = y;
        P.seed[k] = Math.random() * 100;
        P.ink[k] = Math.floor(Math.random() * inks.length);
        P.node[k] = Math.random() < 0.45 ? 1 : 0; // the rest just tug the thread along
        P.string[k] = P.node[k] && Math.random() < 0.3 ? 1 : 0;
        bounds.x0 = Math.min(bounds.x0, x); bounds.x1 = Math.max(bounds.x1, x);
        bounds.y0 = Math.min(bounds.y0, y); bounds.y1 = Math.max(bounds.y1, y);
        k++;
      }
    }
    built = `${W}x${H}:${word}`;
  }

  // ---- motion -------------------------------------------------------------------------
  // Fling particles near the finger's path since last frame.
  function disturb(x0, y0, x1, y1) {
    const R = REACH * H, dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
    const fl = Math.hypot(dx, dy), fx = fl > 0.5 ? dx / fl : 0, fy = fl > 0.5 ? dy / fl : 0;
    for (let i = 0; i < n; i++) {
      const px = P.hx[i], py = P.hy[i];
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2)) : 0;
      const d = Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
      if (d > R) continue;
      const hit = 1 - (d / R) * 0.6;
      if (P.e[i] < 0.35) {
        // a fresh scatter target: strings shoot up or down, the rest spray outward (and along the drag)
        if (P.string[i]) {
          P.ox[i] = (Math.random() - 0.5) * 0.012 * H;
          P.oy[i] = (Math.random() < 0.5 ? -1 : 1) * (0.06 + Math.random() * 0.2) * H;
        } else {
          const ang = Math.random() * Math.PI * 2, mag = (0.03 + Math.random() * Math.random() * 0.14) * H;
          P.ox[i] = Math.cos(ang) * mag + fx * mag * 0.8;
          P.oy[i] = Math.sin(ang) * mag + fy * mag * 0.8;
        }
        P.vx[i] += dx * 0.5; P.vy[i] += dy * 0.5;
      }
      P.e[i] = Math.max(P.e[i], hit);
    }
  }

  function step(dt, finger) {
    clock += dt;
    if (!P || built !== `${W}x${H}:${word}`) build();
    // the finger, or a ghost one sweeping across the word when you've left it alone a while
    let f = finger;
    if (finger) { idle = 0; ghost = null; } else idle += dt;
    if (!finger && idle > IDLE) {
      if (!ghost) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        ghost = { t: 0, dur: 3 + Math.random() * 2, dir, y: bounds.y0 + (bounds.y1 - bounds.y0) * (0.2 + Math.random() * 0.6) };
      }
      ghost.t += dt;
      const u = ghost.t / ghost.dur, pad = 0.1 * W;
      const x = ghost.dir > 0 ? bounds.x0 - pad + (bounds.x1 - bounds.x0 + 2 * pad) * u : bounds.x1 + pad - (bounds.x1 - bounds.x0 + 2 * pad) * u;
      f = [x / W, 1 - (ghost.y + Math.sin(ghost.t * 2.3) * 0.04 * H) / H];
      if (u >= 1) { ghost = null; idle = IDLE - 2.5 - Math.random() * 3; f = null; }
    }
    if (f) {
      const x = f[0] * W, y = (1 - f[1]) * H;
      disturb(prev ? prev[0] : x, prev ? prev[1] : y, x, y);
      prev = [x, y];
    } else prev = null;

    const decay = Math.exp(-LINGER * dt * 3), wob = 0.004 * H;
    for (let i = 0; i < n; i++) {
      let e = P.e[i];
      if (e > 0) { e = e > 0.02 ? e * decay - dt * 0.05 : 0; P.e[i] = Math.max(0, e); }
      const s = e * e * (3 - 2 * e); // eased: holds its scatter, then glides home
      const tx = P.hx[i] + P.ox[i] * s + Math.sin(clock * 1.7 + P.seed[i]) * wob * s;
      const ty = P.hy[i] + P.oy[i] * s + Math.cos(clock * 1.3 + P.seed[i] * 1.3) * wob * s;
      const k = 70, c = 11;
      P.vx[i] += ((tx - P.x[i]) * k - P.vx[i] * c) * dt;
      P.vy[i] += ((ty - P.y[i]) * k - P.vy[i] * c) * dt;
      P.x[i] += P.vx[i] * dt;
      P.y[i] += P.vy[i] * dt;
    }
  }

  // ---- drawing ------------------------------------------------------------------------
  function draw() {
    const px = H / 900; // one hairline, scaled to the screen
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // the outline itself; where it's been flung apart it thins to a faint stretched thread
    const whole = new Path2D(), torn = new Path2D();
    for (const [a, b] of chains) {
      // a curve through each point, from the midpoint before it to the midpoint after
      for (let i = a; i < b; i++) {
        const h = i > a ? i - 1 : b - 1, j = i + 1 < b ? i + 1 : a;
        const p = Math.max(P.e[h], P.e[i], P.e[j]) > 0.18 ? torn : whole;
        p.moveTo((P.x[h] + P.x[i]) / 2, (P.y[h] + P.y[i]) / 2);
        p.quadraticCurveTo(P.x[i], P.y[i], (P.x[i] + P.x[j]) / 2, (P.y[i] + P.y[j]) / 2);
      }
    }
    ctx.lineWidth = 1.3 * px;
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.stroke(whole);
    ctx.lineWidth = 0.9 * px;
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.stroke(torn);

    // flung particles: links between near neighbours, strings, then the nodes on top
    const live = [];
    for (let i = 0; i < n; i++) if (P.node[i] && P.e[i] > 0.12) live.push(i);
    if (!live.length) return;
    const cell = LINK * H, grid = new Map();
    for (const i of live) {
      const key = `${Math.floor(P.x[i] / cell)},${Math.floor(P.y[i] / cell)}`;
      (grid.get(key) || grid.set(key, []).get(key)).push(i);
    }
    const byInk = inks.map(() => new Path2D());
    const strings = inks.map(() => new Path2D());
    for (const i of live) {
      const cx = Math.floor(P.x[i] / cell), cy = Math.floor(P.y[i] / cell);
      let links = 0;
      for (let gy = cy - 1; gy <= cy + 1 && links < 2; gy++) {
        for (let gx = cx - 1; gx <= cx + 1 && links < 2; gx++) {
          for (const j of grid.get(`${gx},${gy}`) || []) {
            if (j <= i || links >= 2) continue;
            if (Math.hypot(P.x[j] - P.x[i], P.y[j] - P.y[i]) > cell) continue;
            if ((i * 7 + j * 13) % 3 === 0) continue; // sparser, so it reads as a web, not a mesh
            byInk[P.ink[i]].moveTo(P.x[i], P.y[i]);
            byInk[P.ink[i]].lineTo(P.x[j], P.y[j]);
            links++;
          }
        }
      }
      if (P.string[i]) {
        const my = 2 * P.hy[i] - P.y[i]; // strings run through the letter, a node at each end
        strings[P.ink[i]].moveTo(P.x[i], P.y[i]);
        strings[P.ink[i]].lineTo(P.x[i], my);
      }
    }
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1 * px;
    inks.forEach((ink, k) => { ctx.strokeStyle = ink; ctx.stroke(byInk[k]); ctx.stroke(strings[k]); });
    ctx.globalAlpha = 1;
    const dots = inks.map(() => new Path2D());
    for (const i of live) {
      const r = (1.6 + 1.8 * P.e[i]) * px, d = dots[P.ink[i]];
      d.moveTo(P.x[i] + r, P.y[i]);
      d.arc(P.x[i], P.y[i], r, 0, Math.PI * 2);
      if (P.string[i]) {
        const my = 2 * P.hy[i] - P.y[i];
        d.moveTo(P.x[i] + r, my);
        d.arc(P.x[i], my, r, 0, Math.PI * 2);
      }
    }
    inks.forEach((ink, k) => { ctx.fillStyle = ink; ctx.fill(dots[k]); });
  }

  // Advance and redraw at the given size; returns the two canvases to upload.
  function render(dt, w, h, finger) {
    if (w !== W || h !== H) {
      W = canvas.width = w; H = canvas.height = h;
      glowCanvas.width = Math.max(1, Math.round(w / GLOW));
      glowCanvas.height = Math.max(1, Math.round(h / GLOW));
    }
    step(dt, finger);
    draw();
    gctx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
    gctx.drawImage(canvas, 0, 0, glowCanvas.width, glowCanvas.height);
    return { lines: canvas, glow: glowCanvas };
  }

  return { init, setWord, setColours, render };
})();
