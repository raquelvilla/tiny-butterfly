// Tiny Butterfly — "candles": an abstraction of a birthday — only the flames, in the dark. Tap to light
// a flame wherever you touch; drag to blow: flames lean away from your breath and the nearest go out
// with a curl of smoke. Each flame paints heat, and where flames crowd together the heat adds up, so
// they merge into bigger, brighter fire: the more you light close together, the more it all burns.
// shader.js turns the heat into fire (colour ramp, rising turbulence, glow).
//
// Hands shader.js two canvases: heat (R = fire, G = smoke) at half resolution, and a small glow layer.

const Candles = (() => {
  const MAX = 160;
  const HEAT = 2;          // the heat layer is this many times smaller than the screen
  const GLOW = 8;          // the glow layer is this many times smaller
  const BLOW = 0.075;      // how close (screen heights) a swipe must pass to blow a flame out
  const WIND = 0.14;       // how far the breath reaches to make flames lean
  const SIZE = 0.075;      // a flame's height, in screen heights

  let canvas, ctx, glowCanvas, gctx;
  let W = 0, H = 0, clock = 0;
  // Flames sit at u, v (fractions of the screen, so they survive a resize); x, y are those in pixels.
  let flames = [];
  let prev = null, moved = 0;

  function init() {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
    glowCanvas = document.createElement('canvas');
    gctx = glowCanvas.getContext('2d');
    light(0.5, 0.58); // one flame to begin with, so the dark isn't empty
  }

  const setColours = () => {}; // the palette tints the fire in shader.js

  function light(u, v) {
    if (flames.length >= MAX) flames.shift();
    flames.push({
      u, v, x: 0, y: 0, size: SIZE * (0.85 + Math.random() * 0.3),
      lit: true, flame: 0, lean: 0, leanV: 0, seed: Math.random() * 100, outAt: -99,
    });
  }

  // ---- touch: tap to light a flame, drag to blow -------------------------------------
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
      // a tap lights a flame there (its middle where you touched)
      if (prev && moved < H * 0.012) light(px / W, (py + SIZE * H * 0.4) / H);
      prev = null;
    }
  }

  const middle = (f) => [f.x, f.y - f.size * H * 0.4];

  function blow(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), L2 = dx * dx + dy * dy;
    if (len < 0.5) return;
    const strong = len > H * 0.004; // a real breath, not a slow drift
    for (const f of flames) {
      const [fx, fy] = middle(f);
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((fx - x0) * dx + (fy - y0) * dy) / L2)) : 0;
      const d = Math.hypot(fx - (x0 + dx * t), fy - (y0 + dy * t));
      if (d > WIND * H) continue;
      const k = 1 - d / (WIND * H);
      f.leanV += (dx / len) * k * Math.min(3, len / (H * 0.004)) * 3; // lean along the breath
      if (strong && f.lit && d < BLOW * H) { f.lit = false; f.outAt = clock; }
    }
  }

  // ---- motion -----------------------------------------------------------------------
  function step(dt) {
    clock += dt;
    for (const f of flames) {
      f.x = f.u * W; f.y = f.v * H;
      f.leanV += (-f.lean * 55 - f.leanV * 7) * dt;
      f.lean = Math.max(-1.2, Math.min(1.2, f.lean + f.leanV * dt));
      f.flame += ((f.lit ? 1 : 0) - f.flame) * Math.min(1, dt * (f.lit ? 3 : 12));
    }
    // blown-out flames go once their smoke has gone
    flames = flames.filter((f) => f.lit || clock - f.outAt < 3.2);
    flames.sort((a, b) => a.y - b.y);
  }

  // ---- drawing: heat (and smoke) for shader.js to turn into fire --------------------
  // A soft vertical blob of heat, leaning with the breath; drawn into one colour channel, additively.
  function blob(c, x, y, w, h, lean, alpha, rgb) {
    c.save();
    c.translate(x, y);
    c.transform(1, 0, -lean * 0.5, 1, 0, 0);
    c.scale(w, h);
    const g = c.createRadialGradient(0, 0.25, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.45, `rgba(${rgb},${alpha * 0.55})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.fillRect(-1, -1, 2, 2);
    c.restore();
  }

  function draw() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    gctx.globalCompositeOperation = 'source-over';
    gctx.fillStyle = '#000';
    gctx.fillRect(0, 0, glowCanvas.width, glowCanvas.height);
    ctx.globalCompositeOperation = 'lighter';
    gctx.globalCompositeOperation = 'lighter';
    const glowEach = 0.13; // the glow layer is also the flames' shared heat: crowded flames add up into one fire

    for (const f of flames) {
      if (f.flame < 0.02) continue;
      const flick = Math.sin(clock * 9 + f.seed) * 0.5 + Math.sin(clock * 21 + f.seed * 2) * 0.3;
      const h = f.size * H * f.flame * (0.93 + 0.1 * flick), w = h * 0.3;
      const sway = Math.sin(clock * 2.7 + f.seed) * 0.12 + f.lean * 0.9;
      // the body of the flame, its hotter core low down, and a narrow tip drawn up from it
      blob(ctx, f.x / HEAT, (f.y - h * 0.38) / HEAT, w / HEAT, (h * 0.5) / HEAT, sway, 0.3, '255,0,0');
      blob(ctx, f.x / HEAT, (f.y - h * 0.22) / HEAT, (w * 0.5) / HEAT, (h * 0.28) / HEAT, sway * 0.5, 0.38, '255,0,0');
      blob(ctx, (f.x + sway * h * 0.35) / HEAT, (f.y - h * 0.78) / HEAT, (w * 0.4) / HEAT, (h * 0.4) / HEAT, sway * 1.4, 0.17, '255,0,0');
      blob(gctx, f.x / GLOW, (f.y - h * 0.45) / GLOW, (h * 0.75) / GLOW, (h * 1.1) / GLOW, 0, glowEach * f.flame, '255,0,0');
    }

    // smoke from flames just blown out, in the green channel
    ctx.lineCap = 'round';
    for (const f of flames) {
      const age = clock - f.outAt;
      if (f.lit || age > 3.2) continue;
      const rise = H * 0.14 * Math.min(1, age * 1.1);
      ctx.strokeStyle = `rgba(0,255,0,${0.5 * (1 - age / 3.2)})`;
      ctx.lineWidth = (f.size * H * 0.06) / HEAT;
      ctx.beginPath();
      for (let j = 0; j <= 16; j++) {
        const t = j / 16;
        const x = f.x + Math.sin(t * 7 - age * 2.5 + f.seed) * f.size * H * 0.18 * t;
        const y = f.y - f.size * H * 0.1 - t * rise;
        if (j) ctx.lineTo(x / HEAT, y / HEAT); else ctx.moveTo(x / HEAT, y / HEAT);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    gctx.globalCompositeOperation = 'source-over';
  }

  // Advance and redraw at the given size; returns the two canvases to upload.
  function render(dt, w, h) {
    if (w !== W || h !== H) {
      W = w; H = h;
      canvas.width = Math.max(1, Math.round(w / HEAT));
      canvas.height = Math.max(1, Math.round(h / HEAT));
      glowCanvas.width = Math.max(1, Math.round(w / GLOW));
      glowCanvas.height = Math.max(1, Math.round(h / GLOW));
    }
    step(Math.max(0, dt));
    draw();
    return { lines: canvas, glow: glowCanvas };
  }

  return { init, setColours, render, pointer };
})();
