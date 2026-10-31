// Tiny Butterfly — "fluid": a tribute to The Coding Train's Coding Challenge 132, Fluid Simulation
// (Daniel Shiffman, after Mike Ash's port of Jos Stam's "Real-Time Fluid Dynamics for Games").
// A small grid of incompressible fluid: velocity is diffused, kept swirl-only (projected), and carried
// along itself, with vorticity confinement to keep it curling; dye in your palette's colours rides on
// it. Like in the video, a source shoots dye in a direction that wanders with noise (and here the
// source wanders the screen too). Drag to stir it and pour in colour; tap to drop a splash. Each
// stroke pours the next palette colour, so they fold into each other.
//
// Hands shader.js the dye as a small canvas; shader.js cuts it into soft blobs at screen resolution.

const Fluid = (() => {
  const ROWS = 220;        // grid cells down the screen at most (columns follow the screen's shape)
  const CELLS = 55000;     // ...but never more cells than this, so wide screens stay smooth
  const SWIRL = 0.15;      // vorticity confinement: puts back the small curls the grid would smooth away
  const ITER = 4;          // solver iterations, as in the video
  const VISC = 0.0000001;  // viscosity
  const DIFF = 0.000015;   // dye spreading a little on its own, so it stays soft and blobby
  const FADE = 0.985;      // dye left after each 60th of a second
  const STEP = 0.12;       // simulation time per frame at 60fps

  let canvas, ctx, img;
  let N = 0, M = 0, size = 0;          // columns, rows, cells including the border
  let vx, vy, vx0, vy0, dr, dg, db, s, curl; // velocity, previous velocity, dye (rgb), scratch, curl
  let palette = [[0.79, 0.71, 0.95]], count = 1;
  let clock = 0, stroke = 0, prev = null;

  const IX = (i, j) => i + (N + 2) * j;

  function init() {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
  }

  function setColours(cols, n) {
    palette = [];
    for (let i = 0; i < n; i++) palette.push([cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]]);
    count = n;
  }

  function grid(w, h) {
    M = Math.round(Math.min(ROWS, Math.sqrt(CELLS * h / w)));
    N = Math.max(8, Math.round(M * w / h));
    size = (N + 2) * (M + 2);
    [vx, vy, vx0, vy0, dr, dg, db, s, curl] = Array.from({ length: 9 }, () => new Float32Array(size));
    canvas.width = N; canvas.height = M;
    img = ctx.createImageData(N, M);
  }

  // ---- Stam's solver (as Mike Ash wrote it, in 2D) ----------------------------------------------
  function setBnd(b, x) {
    for (let i = 1; i <= N; i++) {
      x[IX(i, 0)] = b === 2 ? -x[IX(i, 1)] : x[IX(i, 1)];
      x[IX(i, M + 1)] = b === 2 ? -x[IX(i, M)] : x[IX(i, M)];
    }
    for (let j = 1; j <= M; j++) {
      x[IX(0, j)] = b === 1 ? -x[IX(1, j)] : x[IX(1, j)];
      x[IX(N + 1, j)] = b === 1 ? -x[IX(N, j)] : x[IX(N, j)];
    }
    x[IX(0, 0)] = 0.5 * (x[IX(1, 0)] + x[IX(0, 1)]);
    x[IX(0, M + 1)] = 0.5 * (x[IX(1, M + 1)] + x[IX(0, M)]);
    x[IX(N + 1, 0)] = 0.5 * (x[IX(N, 0)] + x[IX(N + 1, 1)]);
    x[IX(N + 1, M + 1)] = 0.5 * (x[IX(N, M + 1)] + x[IX(N + 1, M)]);
  }

  function linSolve(b, x, x0, a, c) {
    const inv = 1 / c;
    for (let k = 0; k < ITER; k++) {
      for (let j = 1; j <= M; j++) {
        for (let i = 1; i <= N; i++) {
          const n = IX(i, j);
          x[n] = (x0[n] + a * (x[n - 1] + x[n + 1] + x[n - N - 2] + x[n + N + 2])) * inv;
        }
      }
      setBnd(b, x);
    }
  }

  function diffuse(b, x, x0, diff, dt) {
    const a = dt * diff * N * M;
    linSolve(b, x, x0, a, 1 + 4 * a);
  }

  function project(velX, velY, p, div) {
    for (let j = 1; j <= M; j++) {
      for (let i = 1; i <= N; i++) {
        const n = IX(i, j);
        div[n] = -0.5 * (velX[n + 1] - velX[n - 1] + velY[n + N + 2] - velY[n - N - 2]) / M;
        p[n] = 0;
      }
    }
    setBnd(0, div); setBnd(0, p);
    linSolve(0, p, div, 1, 4);
    for (let j = 1; j <= M; j++) {
      for (let i = 1; i <= N; i++) {
        const n = IX(i, j);
        velX[n] -= 0.5 * (p[n + 1] - p[n - 1]) * M;
        velY[n] -= 0.5 * (p[n + N + 2] - p[n - N - 2]) * M;
      }
    }
    setBnd(1, velX); setBnd(2, velY);
  }

  function advect(b, d, d0, velX, velY, dt) {
    const dtx = dt * M, dty = dt * M;  // square cells: velocity is in screen heights
    for (let j = 1; j <= M; j++) {
      for (let i = 1; i <= N; i++) {
        const n = IX(i, j);
        let x = i - dtx * velX[n], y = j - dty * velY[n];
        x = Math.min(N + 0.5, Math.max(0.5, x));
        y = Math.min(M + 0.5, Math.max(0.5, y));
        const i0 = Math.floor(x), j0 = Math.floor(y), s1 = x - i0, t1 = y - j0;
        const s0 = 1 - s1, t0 = 1 - t1;
        d[n] = s0 * (t0 * d0[IX(i0, j0)] + t1 * d0[IX(i0, j0 + 1)])
             + s1 * (t0 * d0[IX(i0 + 1, j0)] + t1 * d0[IX(i0 + 1, j0 + 1)]);
      }
    }
    setBnd(b, d);
  }

  // Vorticity confinement (Fedkiw et al.): find where the fluid spins and nudge it to keep spinning,
  // so it stays curly and alive instead of going smooth.
  function confine(dt) {
    for (let j = 1; j <= M; j++) {
      for (let i = 1; i <= N; i++) {
        const n = IX(i, j);
        curl[n] = 0.5 * (vy[n + 1] - vy[n - 1] - vx[n + N + 2] + vx[n - N - 2]) * M;
      }
    }
    for (let j = 2; j < M; j++) {
      for (let i = 2; i < N; i++) {
        const n = IX(i, j);
        let gx = Math.abs(curl[n + 1]) - Math.abs(curl[n - 1]);
        let gy = Math.abs(curl[n + N + 2]) - Math.abs(curl[n - N - 2]);
        const len = Math.hypot(gx, gy) + 1e-5;
        gx /= len; gy /= len;
        const f = SWIRL * curl[n] * dt;
        vx[n] += gy * f / M;
        vy[n] -= gx * f / M;
      }
    }
  }

  function step(dt, fade) {
    confine(dt);
    diffuse(1, vx0, vx, VISC, dt);
    diffuse(2, vy0, vy, VISC, dt);
    project(vx0, vy0, vx, vy);
    advect(1, vx, vx0, vx0, vy0, dt);
    advect(2, vy, vy0, vx0, vy0, dt);
    project(vx, vy, vx0, vy0);
    for (const d of [dr, dg, db]) {
      diffuse(0, s, d, DIFF, dt);
      advect(0, d, s, vx, vy, dt);
      for (let n = 0; n < size; n++) d[n] *= fade;
    }
  }

  // ---- adding dye and motion ------------------------------------------------------------------
  function cell(u, v) {
    return [Math.min(N, Math.max(1, Math.round(u * N))), Math.min(M, Math.max(1, Math.round((1 - v) * M)))];
  }

  function pour(u, v, colour, amount, ax, ay, radius = 2) {
    const [ci, cj] = cell(u, v);
    for (let j = -radius; j <= radius; j++) {
      for (let i = -radius; i <= radius; i++) {
        const x = ci + i, y = cj + j;
        if (x < 1 || x > N || y < 1 || y > M) continue;
        const w = Math.exp(-(i * i + j * j) / (radius * radius * 0.6));
        const n = IX(x, y);
        dr[n] += colour[0] * amount * w;
        dg[n] += colour[1] * amount * w;
        db[n] += colour[2] * amount * w;
        vx[n] += ax * w;
        vy[n] += ay * w;
      }
    }
  }

  // Smooth 1D noise, for the wandering source.
  const hash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
  function noise(t) {
    const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
    return hash(i) * (1 - u) + hash(i + 1) * u;
  }

  const colourAt = (k) => palette[((k % count) + count) % count];

  function render(dt, w, h) {
    if (!vx || Math.abs(N / M - w / h) > 0.02) grid(w, h);
    dt = Math.max(0, Math.min(0.05, dt));
    clock += dt;
    // The source, as in the video: it shoots dye in a direction that drifts with noise, slowly going
    // round your palette. Unlike the video it isn't pinned to the middle: it wanders the screen too.
    const ang = noise(clock * 0.35) * Math.PI * 4;
    const k = clock * 0.18;
    const c0 = colourAt(Math.floor(k)), c1 = colourAt(Math.floor(k) + 1), f = k - Math.floor(k);
    const c = c0.map((v, i) => v + (c1[i] - v) * f);
    const su = 0.5 + (noise(clock * 0.07 + 31) - 0.5) * 1.3, sv = 0.5 + (noise(clock * 0.06 + 77) - 0.5) * 1.3;
    pour(su, sv, c, 24 * dt, Math.cos(ang) * 12 * dt, Math.sin(ang) * 12 * dt, 5);
    step(STEP * dt * 60, Math.pow(FADE, dt * 60));
    draw();
    return { lines: canvas, glow: canvas };
  }

  function draw() {
    const px = img.data;
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < N; i++) {
        const n = IX(i + 1, j + 1), o = (j * N + i) * 4;
        const r = dr[n], g = dg[n], b = db[n], amt = Math.max(r, g, b);
        // keep the hue and soften the pile-up; shader.js shapes the edges into blobs
        const k = amt > 1e-5 ? (1 - Math.exp(-amt * 3)) / amt : 0;
        px[o] = r * k * 255; px[o + 1] = g * k * 255; px[o + 2] = b * k * 255; px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function pointer(type, u, v) {
    if (!vx) return;
    if (type === 'down') {
      stroke++;
      prev = [u, v];
      pour(u, v, colourAt(stroke), 3, 0, 0, 8); // a splash where you touch
    } else if (type === 'move' && prev) {
      const dx = (u - prev[0]) * N, dy = -(v - prev[1]) * M; // in cells
      pour(u, v, colourAt(stroke), 1.4, dx * 0.15, dy * 0.15, 5);
      prev = [u, v];
    } else if (type === 'up') {
      prev = null;
    }
  }

  return { init, setColours, render, pointer };
})();
