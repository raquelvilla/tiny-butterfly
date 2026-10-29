// Tiny Butterfly — "threads": a bezier pen. Tap to place points (tap and drag to pull out their
// handles), drag a point to move it, drag a handle to bend the curve, double-tap a point to remove
// it. The curve is a fine line in your palette with a soft glow and a light travelling along it;
// the points and handles fade away when you leave it alone. Drawn in 2D here and handed to
// shader.js as two textures: the crisp lines, and a small copy for the glow.

const Threads = (() => {
  const HIT = 0.035;       // grab radius for points and handles, in screen heights
  const FADE_AFTER = 3.5;  // seconds untouched before the points and handles fade out
  const MAX_POINTS = 24;
  const GLOW = 8;          // the glow copy is this many times smaller
  const KEY = 'tinyButterfly.threads';

  let canvas, ctx, glowCanvas, gctx;
  let W = 0, H = 0, clock = 0, idle = 0;
  let inks = ['#fff'];
  // Points in screen-height units, centred horizontally (so shapes survive a resize):
  // x, y = the point; hx, hy = its outgoing handle (the incoming one mirrors it).
  let pts = [];
  let drag = null;         // { i, part: 'point' | 'out' | 'in', fresh }
  let lastTap = { i: -1, t: 0 };

  const DEFAULT = [
    { x: -0.17, y: 0.36, hx: 0.15, hy: -0.07 },
    { x: 0, y: 0.5, hx: 0.06, hy: 0.09 },
    { x: 0.17, y: 0.64, hx: 0.15, hy: -0.07 },
  ];

  function init() {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
    glowCanvas = document.createElement('canvas');
    gctx = glowCanvas.getContext('2d');
    try { pts = JSON.parse(localStorage.getItem(KEY)) || null; } catch { pts = null; }
    if (!Array.isArray(pts)) pts = DEFAULT.map((p) => ({ ...p }));
  }

  function keep() {
    try { localStorage.setItem(KEY, JSON.stringify(pts)); } catch {}
  }

  function setColours(cols, count) {
    inks = [];
    for (let i = 0; i < count; i++) {
      let [r, g, b] = [cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 0.3) { const k = 0.35; r += (1 - r) * k; g += (1 - g) * k; b += (1 - b) * k; } // keep dark ones visible on black
      inks.push(`rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`);
    }
  }

  // ---- geometry ----------------------------------------------------------------------
  const sx = (u) => W / 2 + u * H;   // screen-height units -> canvas pixels
  const sy = (v) => v * H;
  // The four bezier control points of segment i → i+1, in canvas pixels.
  function seg(i) {
    const a = pts[i], b = pts[i + 1];
    return [sx(a.x), sy(a.y), sx(a.x + a.hx), sy(a.y + a.hy), sx(b.x - b.hx), sy(b.y - b.hy), sx(b.x), sy(b.y)];
  }
  function bez(c, t) {
    const m = 1 - t, a = m * m * m, b = 3 * m * m * t, d = 3 * m * t * t, e = t * t * t;
    return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
  }

  // ---- touch -------------------------------------------------------------------------
  // type: 'down' | 'move' | 'up'; x, y in 0..1 with y up (as shader.js measures them).
  function pointer(type, x, y) {
    if (!H) return;
    const u = (x * W - W / 2) / H, v = 1 - y;
    idle = 0;
    if (type === 'down') {
      const near = (px, py) => Math.hypot(px - u, py - v) < HIT;
      let hit = null;
      // handles first (they sit on top), then points; newest first
      for (let i = pts.length - 1; i >= 0 && !hit; i--) {
        const p = pts[i];
        if (Math.hypot(p.hx, p.hy) > 0.01) {
          if (near(p.x + p.hx, p.y + p.hy)) hit = { i, part: 'out' };
          else if (near(p.x - p.hx, p.y - p.hy)) hit = { i, part: 'in' };
        }
      }
      for (let i = pts.length - 1; i >= 0 && !hit; i--) if (near(pts[i].x, pts[i].y)) hit = { i, part: 'point' };
      const now = performance.now();
      if (hit && hit.part === 'point' && lastTap.i === hit.i && now - lastTap.t < 350) {
        pts.splice(hit.i, 1); // double-tap: remove it
        lastTap = { i: -1, t: 0 };
        keep();
        return;
      }
      if (hit) {
        drag = hit;
        if (hit.part === 'point') lastTap = { i: hit.i, t: now };
        return;
      }
      if (pts.length >= MAX_POINTS) return;
      pts.push({ x: u, y: v, hx: 0, hy: 0 }); // a new point; dragging now pulls its handles out
      drag = { i: pts.length - 1, part: 'out', fresh: true };
      lastTap = { i: -1, t: 0 };
    } else if (type === 'move' && drag) {
      const p = pts[drag.i];
      if (!p) return;
      if (drag.part === 'point') { p.x = u; p.y = v; }
      else if (drag.part === 'out') { p.hx = u - p.x; p.hy = v - p.y; }
      else { p.hx = p.x - u; p.hy = p.y - v; }
    } else if (type === 'up' && drag) {
      const p = pts[drag.i];
      // a plain tap: give the new point gentle handles pointing on from the one before
      if (p && drag.fresh && Math.hypot(p.hx, p.hy) < 0.012) {
        const q = pts[drag.i - 1];
        if (q) { p.hx = (p.x - q.x) * 0.3; p.hy = (p.y - q.y) * 0.3; }
      }
      drag = null;
      keep();
    }
  }

  // ---- drawing -----------------------------------------------------------------------
  function draw() {
    const px = H / 900; // one hairline, scaled to the screen
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (pts.length > 1) {
      const path = new Path2D();
      path.moveTo(sx(pts[0].x), sy(pts[0].y));
      for (let i = 0; i < pts.length - 1; i++) {
        const c = seg(i);
        path.bezierCurveTo(c[2], c[3], c[4], c[5], c[6], c[7]);
      }
      // the palette runs along the line, first point to last
      const a = pts[0], b = pts[pts.length - 1];
      let grad = '#fff';
      if (Math.hypot(b.x - a.x, b.y - a.y) > 0.02 && inks.length) {
        grad = ctx.createLinearGradient(sx(a.x), sy(a.y), sx(b.x), sy(b.y));
        inks.forEach((ink, k) => grad.addColorStop(inks.length > 1 ? k / (inks.length - 1) : 0, ink));
      }
      ctx.strokeStyle = grad;
      ctx.globalAlpha = 0.12;
      ctx.lineWidth = 7 * px;
      ctx.stroke(path);          // a soft halo
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 1.3 * px;
      ctx.stroke(path);          // the line itself
      ctx.globalAlpha = 1;

      // a small light travelling the length of the curve
      const n = pts.length - 1, t = (clock * 0.09) % 1 * n, i = Math.max(0, Math.min(n - 1, Math.floor(t)));
      const [lx, ly] = bez(seg(i), t - i);
      const r = 14 * px, g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
      g.addColorStop(0, 'rgba(255,255,255,.9)');
      g.addColorStop(0.25, 'rgba(255,255,255,.25)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
    }

    // points and handles, fading out when left alone
    const ui = Math.max(0, Math.min(1, 1 - (idle - FADE_AFTER) / 1.2));
    if (ui <= 0) return;
    ctx.globalAlpha = ui;
    ctx.lineWidth = 0.8 * px;
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    const arms = new Path2D(), knobs = new Path2D(), dots = new Path2D();
    const hr = 3.6 * px, pr = 3.4 * px;
    pts.forEach((p) => {
      const x = sx(p.x), y = sy(p.y);
      if (Math.hypot(p.hx, p.hy) > 0.01) {
        for (const s of [1, -1]) {
          const hx = sx(p.x + s * p.hx), hy = sy(p.y + s * p.hy);
          arms.moveTo(x, y); arms.lineTo(hx, hy);
          knobs.moveTo(hx + hr, hy); knobs.arc(hx, hy, hr, 0, Math.PI * 2);
        }
      }
      dots.moveTo(x + pr, y); dots.arc(x, y, pr, 0, Math.PI * 2);
    });
    ctx.stroke(arms);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 1 * px;
    ctx.stroke(knobs);
    ctx.fillStyle = '#fff';
    ctx.fill(dots);
    if (drag && pts[drag.i]) { // a soft ring round whatever you're holding
      const p = pts[drag.i];
      const k = drag.part === 'out' ? 1 : drag.part === 'in' ? -1 : 0;
      ctx.strokeStyle = 'rgba(255,255,255,.3)';
      ctx.beginPath();
      ctx.arc(sx(p.x + k * p.hx), sy(p.y + k * p.hy), 11 * px, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Advance and redraw at the given size; returns the two canvases to upload.
  function render(dt, w, h) {
    if (w !== W || h !== H) {
      W = canvas.width = w; H = canvas.height = h;
      glowCanvas.width = Math.max(1, Math.round(w / GLOW));
      glowCanvas.height = Math.max(1, Math.round(h / GLOW));
    }
    clock += Math.max(0, dt);
    if (!drag) idle += Math.max(0, dt);
    draw();
    gctx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
    gctx.drawImage(canvas, 0, 0, glowCanvas.width, glowCanvas.height);
    return { lines: canvas, glow: glowCanvas };
  }

  return { init, setColours, render, pointer };
})();
