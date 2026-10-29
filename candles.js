// Tiny Butterfly — "candles": a birthday cake, seen from a little above, covered in as many candles as
// you like (60 for a 60th). Striped in your palette, flames flickering. Swipe across to blow: flames
// lean away from your finger and the nearest go out with a curl of smoke. Tap a candle to relight
// it; blow them all out and they relight one after another, a flame passed along. Drawn in 2D here
// and handed to shader.js as two textures: the scene, and a small warm glow from the flames.

const Candles = (() => {
  const MAX = 120;
  const GLOW = 8;          // the glow layer is this many times smaller
  const BLOW = 0.075;      // how close (screen heights) a swipe must pass to blow a flame out
  const WIND = 0.14;       // how far the breath reaches to make flames lean
  const PASS_ON = 0.03;    // seconds between candles when they relight in a chain

  let canvas, ctx, glowCanvas, gctx;
  let W = 0, H = 0, clock = 0, built = '';
  let inks = [[1, 1, 1]];  // palette colours 0..1, sorted dark -> light
  let count = 60, candles = [], cake = null;
  let prev = null, moved = 0, allOutAt = -1;

  function init() {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
    glowCanvas = document.createElement('canvas');
    gctx = glowCanvas.getContext('2d');
  }

  function setColours(cols, n) {
    inks = [];
    for (let i = 0; i < n; i++) inks.push([cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]]);
    built = '';
  }

  function setCount(n) {
    count = Math.max(1, Math.min(MAX, Math.round(n) || 1));
    built = '';
  }

  const rgb = (c, a = 1, k = 1) =>
    `rgba(${Math.round(Math.min(1, c[0] * k) * 255)},${Math.round(Math.min(1, c[1] * k) * 255)},${Math.round(Math.min(1, c[2] * k) * 255)},${a})`;
  const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const WHITE = [1, 1, 1];

  // ---- layout: the cake, then candles packed evenly over its top (a sunflower spiral) ----------
  function build() {
    const rx = Math.min(W * 0.43, H * 0.3), ry = rx * 0.36;
    cake = { cx: W / 2, cy: H * 0.52, rx, ry, side: H * 0.11 };
    const spacing = Math.sqrt((Math.PI * rx * rx) / count) * 0.86; // room per candle across the top
    const cw = Math.max(H * 0.0035, Math.min(H * 0.013, spacing * 0.3));
    const ch = Math.max(H * 0.045, Math.min(H * 0.085, cw * 7));
    const turn = Math.random() * 7;
    candles = [];
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt((i + 0.5) / count) * 0.86, a = i * 2.39996 + turn;
      const ink = Math.floor(Math.random() * inks.length);
      candles.push({
        x: cake.cx + Math.cos(a) * r * rx, y: cake.cy + Math.sin(a) * r * ry, w: cw, h: ch,
        ink, stripe: Math.random() < 0.6 ? -1 : (ink + 1 + Math.floor(Math.random() * (inks.length - 1))) % inks.length,
        lit: true, flame: 1, lean: 0, leanV: 0, seed: Math.random() * 100, outAt: -99, relightAt: -1,
      });
    }
    candles.sort((a, b) => a.y - b.y); // back to front
    allOutAt = -1;
    built = `${W}x${H}:${count}:${inks.length}`;
  }

  const wickTop = (c) => [c.x, c.y - c.h - c.w * 1.1];

  // ---- touch: swipe to blow, tap to relight -------------------------------------------
  function pointer(type, x, y) {
    if (!H) return;
    const px = x * W, py = (1 - y) * H;
    if (type === 'down') { prev = [px, py]; moved = 0; return; }
    if (type === 'move' && prev) {
      blow(prev[0], prev[1], px, py);
      moved += Math.hypot(px - prev[0], py - prev[1]);
      prev = [px, py];
      return;
    }
    if (type === 'up') {
      if (prev && moved < H * 0.012) relightNear(px, py);
      prev = null;
    }
  }

  function blow(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), L2 = dx * dx + dy * dy;
    if (len < 0.5) return;
    const strong = len > H * 0.004; // a real breath, not a slow drift
    for (const c of candles) {
      const [fx, fy] = wickTop(c);
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((fx - x0) * dx + (fy - y0) * dy) / L2)) : 0;
      const d = Math.hypot(fx - (x0 + dx * t), fy - (y0 + dy * t));
      if (d > WIND * H) continue;
      const k = 1 - d / (WIND * H);
      c.leanV += (dx / len) * k * Math.min(3, len / (H * 0.004)) * 3; // lean along the breath
      if (strong && c.lit && d < BLOW * H) { c.lit = false; c.outAt = clock; c.relightAt = -1; }
    }
  }

  function relightNear(px, py) {
    let best = null, bd = H * 0.07;
    for (const c of candles) {
      const [fx, fy] = wickTop(c);
      const d = Math.min(Math.hypot(fx - px, fy - py), Math.hypot(c.x - px, c.y - c.h / 2 - py));
      if (!c.lit && d < bd) { bd = d; best = c; }
    }
    if (best) { best.lit = true; best.relightAt = -1; }
  }

  // ---- motion -----------------------------------------------------------------------
  function step(dt) {
    clock += dt;
    if (built !== `${W}x${H}:${count}:${inks.length}`) build();
    let lit = 0;
    for (const c of candles) {
      c.leanV += (-c.lean * 55 - c.leanV * 7) * dt;
      c.lean = Math.max(-1.2, Math.min(1.2, c.lean + c.leanV * dt));
      c.flame += ((c.lit ? 1 : 0) - c.flame) * Math.min(1, dt * (c.lit ? 4 : 14));
      if (!c.lit && c.relightAt >= 0 && clock >= c.relightAt) { c.lit = true; c.relightAt = -1; }
      if (c.lit) lit++;
    }
    // all out: a breath of quiet, then they relight one by one, passed along from a single candle
    if (lit === 0 && candles.length) {
      if (allOutAt < 0) allOutAt = clock;
      else if (clock - allOutAt > 2.2 && candles.every((c) => c.relightAt < 0)) {
        const from = candles[Math.floor(Math.random() * candles.length)];
        const order = candles.slice().sort((a, b) =>
          Math.hypot(a.x - from.x, (a.y - from.y) * 2.5) - Math.hypot(b.x - from.x, (b.y - from.y) * 2.5));
        order.forEach((c, i) => { c.relightAt = clock + i * PASS_ON * Math.min(1, 60 / candles.length); });
      }
    } else allOutAt = -1;
    return candles.length ? lit / candles.length : 0;
  }

  // ---- drawing ----------------------------------------------------------------------
  function draw(glowAmt) {
    const { cx, cy, rx, ry, side } = cake;
    const warm = [1, 0.62, 0.32];
    const frost = mixc(inks[inks.length - 1], WHITE, 0.35);
    const body = inks[Math.max(0, inks.length - 2)];

    // the room: dark, warmed by however many flames are lit
    const bg = ctx.createRadialGradient(cx, cy - side, 0, cx, cy - side, H * 0.8);
    bg.addColorStop(0, rgb(warm, 1, 0.16 * glowAmt + 0.03));
    bg.addColorStop(1, '#050404');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // the cake's side, a cylinder, lit warmly from above
    ctx.beginPath();
    ctx.moveTo(cx + rx, cy);
    ctx.lineTo(cx + rx, cy + side);
    ctx.ellipse(cx, cy + side, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(cx - rx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    const sg = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    const shade = 0.35 + 0.55 * glowAmt;
    sg.addColorStop(0, rgb(body, 1, shade * 0.45));
    sg.addColorStop(0.45, rgb(mixc(body, warm, 0.15), 1, shade));
    sg.addColorStop(1, rgb(body, 1, shade * 0.35));
    ctx.fillStyle = sg;
    ctx.fill();

    // frosting drips over the front edge
    ctx.fillStyle = rgb(frost, 1, shade * 0.95);
    for (let k = 0; k <= 26; k++) {
      const a = (k / 26) * Math.PI, x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      const len = side * (0.12 + 0.3 * Math.abs(Math.sin(k * 12.9898) * 0.5 + 0.5) * Math.sin(a));
      const wdt = rx * 0.07;
      ctx.beginPath();
      ctx.ellipse(x, y + len * 0.5, wdt * 0.5, len * 0.5 + wdt * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // the top, frosted, glowing in the middle where the candles are
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    const tg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    tg.addColorStop(0, rgb(mixc(frost, warm, 0.25 * glowAmt), 1, shade * 1.1));
    tg.addColorStop(1, rgb(frost, 1, shade * 0.8));
    ctx.fillStyle = tg;
    ctx.fill();

    // candles, back to front
    for (const c of candles) {
      const x0 = c.x - c.w / 2, top = c.y - c.h;
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.beginPath();
      ctx.ellipse(c.x + c.w * 0.4, c.y, c.w * 1.1, c.w * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, top, c.w, c.h);
      ctx.clip();
      ctx.fillStyle = rgb(mixc(inks[c.ink], WHITE, 0.15), 1, shade * 1.05);
      ctx.fillRect(x0, top, c.w, c.h);
      ctx.strokeStyle = c.stripe < 0 ? rgb(WHITE, 0.85, shade * 1.05) : rgb(inks[c.stripe], 1, shade * 1.05);
      ctx.lineWidth = c.w * 0.4;
      ctx.beginPath();
      for (let s = -1; s < c.h / (c.w * 1.4) + 2; s++) {
        const yy = c.y - s * c.w * 1.4;
        ctx.moveTo(x0 - c.w, yy + c.w);
        ctx.lineTo(x0 + c.w * 2, yy - c.w * 1.2);
      }
      ctx.stroke();
      const lg = ctx.createLinearGradient(x0, 0, x0 + c.w, 0); // round it
      lg.addColorStop(0, 'rgba(255,255,255,.25)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0)');
      lg.addColorStop(1, 'rgba(0,0,0,.3)');
      ctx.fillStyle = lg;
      ctx.fillRect(x0, top, c.w, c.h);
      ctx.restore();
      ctx.strokeStyle = 'rgba(30,20,15,.9)'; // the wick
      ctx.lineWidth = Math.max(1, c.w * 0.18);
      ctx.beginPath();
      ctx.moveTo(c.x, top);
      ctx.lineTo(c.x + c.lean * c.w * 0.3, top - c.w * 1.1);
      ctx.stroke();
    }

    // flames (and their glow), then smoke from the ones just blown out
    gctx.fillStyle = '#000';
    gctx.fillRect(0, 0, glowCanvas.width, glowCanvas.height);
    gctx.globalCompositeOperation = 'lighter';
    const glowEach = 0.5 / Math.sqrt(Math.max(1, candles.length / 6)); // many candles glow together, not 60x
    for (const c of candles) {
      if (c.flame < 0.02) continue;
      const [wx, wy] = wickTop(c);
      const flick = Math.sin(clock * 11 + c.seed) * 0.5 + Math.sin(clock * 23 + c.seed * 2) * 0.3;
      const fh = c.w * 3.4 * c.flame * (0.95 + 0.1 * flick), fw = fh * 0.34;
      const sway = Math.sin(clock * 3.1 + c.seed) * fw * 0.15 + c.lean * fh * 0.55;
      const tx = wx + sway * 1.6, ty = wy - fh;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.bezierCurveTo(wx + sway + fw * 1.15, wy - fh * 0.45, wx + fw, wy + fw * 0.55, wx, wy + fw * 0.55);
      ctx.bezierCurveTo(wx - fw, wy + fw * 0.55, wx + sway - fw * 1.15, wy - fh * 0.45, tx, ty);
      const fg = ctx.createRadialGradient(wx + sway * 0.4, wy - fh * 0.15, 0, wx + sway * 0.4, wy - fh * 0.15, fh * 0.8);
      fg.addColorStop(0, 'rgba(255,253,240,1)');
      fg.addColorStop(0.35, 'rgba(255,226,150,.97)');
      fg.addColorStop(0.7, 'rgba(255,155,70,.85)');
      fg.addColorStop(1, 'rgba(255,100,40,0)');
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.fillStyle = `rgba(110,140,255,${0.35 * c.flame})`; // the blue at the base of a flame
      ctx.beginPath();
      ctx.ellipse(wx, wy + fw * 0.2, fw * 0.55, fw * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      const gx = (wx + sway * 0.5) / GLOW, gy = (wy - fh * 0.35) / GLOW, gr = (fh * 2.4) / GLOW;
      const gg = gctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      gg.addColorStop(0, `rgba(255,170,80,${glowEach * c.flame})`);
      gg.addColorStop(1, 'rgba(255,120,40,0)');
      gctx.fillStyle = gg;
      gctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
    gctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    for (const c of candles) {
      const age = clock - c.outAt;
      if (c.lit || age > 3.2) continue;
      const [wx, wy] = wickTop(c), rise = H * 0.13 * Math.min(1, age * 1.2);
      ctx.strokeStyle = `rgba(215,208,200,${0.4 * (1 - age / 3.2)})`;
      ctx.lineWidth = c.w * 0.45;
      ctx.beginPath();
      for (let j = 0; j <= 16; j++) {
        const t = j / 16;
        const x = wx + Math.sin(t * 7 - age * 2.5 + c.seed) * c.w * 1.6 * t;
        const y = wy - t * rise;
        if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }

  // Advance and redraw at the given size; returns the two canvases to upload.
  function render(dt, w, h) {
    if (w !== W || h !== H) {
      W = canvas.width = w; H = canvas.height = h;
      glowCanvas.width = Math.max(1, Math.round(w / GLOW));
      glowCanvas.height = Math.max(1, Math.round(h / GLOW));
    }
    const litFrac = step(Math.max(0, dt));
    draw(litFrac);
    return { lines: canvas, glow: glowCanvas };
  }

  return { init, setColours, setCount, render, pointer, MAX };
})();
