// Visual: full-screen WebGL shaders fed by a palette, played by touch and sound.
// Each style is its own fragment shader sharing a common header, and each answers touch its own way:
//   calm   — the nearest colour cloud is pulled to your finger
//   liquid — taps send out ripples, drags leave a wake
//   ribs   — the ribs around your finger break into stepped tiles; dragging sideways changes their count
//   glass  — the fluted strip follows your finger
//   pills  — (no touch yet)
const Visual = (() => {
  const FIELD = 2.2; // noise field units across the screen height
  const MAX_COLS = 6;
  const RIPPLES = 4;
  const WAKES = 6;

  const STYLES = {
    calm: { prog: 'calm', speed: 0.07, warp: 0, bright: 1.0 },
    liquid: { prog: 'liquid', speed: 0.3, warp: 2.6, bright: 1.0 },
    storm: { prog: 'liquid', speed: 0.85, warp: 4.6, bright: 1.05 },
    ribs: { prog: 'ribs', speed: 0.35, warp: 0, bright: 1.0 },
    glass: { prog: 'glass', speed: 0.3, warp: 0, bright: 1.0 },
    pills: { prog: 'pills', speed: 0.5, warp: 0, bright: 1.0 },
  };

  const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

  const COMMON = `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uWarp, uBright, uCount, uParam;
uniform vec3 uCols[${MAX_COLS}];  // sorted dark -> light
uniform vec3 uAudio;              // bass, mid, high (0..1)
uniform vec3 uTouch;              // xy = finger in 0..1 uv, z = 0..1 how pressed (rises fast, heals slowly)
uniform vec3 uRip[${RIPPLES}];     // ripples: xy = uv, z = age in seconds
uniform vec4 uWake[${WAKES}];      // wake: xy = uv, zw = velocity (uv/s)
#define FIELD ${FIELD.toFixed(2)}
#define PI 3.14159265

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= .5; }
  return v;
}
vec3 palette(float x){
  x = clamp(x, 0., 1.) * (uCount - 1.);
  vec3 c = uCols[0];
  for (int i = 1; i < ${MAX_COLS}; i++) {
    if (float(i) > uCount - .5) break;
    c = mix(c, uCols[i], smoothstep(0., 1., clamp(x - float(i - 1), 0., 1.)));
  }
  return c;
}
vec3 finish(vec3 col, float vignette, float grain){
  col *= uBright;
  vec2 uv = gl_FragCoord.xy / uRes;
  col *= mix(1. - vignette, 1., smoothstep(1.05, .35, length(uv - .5)));
  col += (hash(gl_FragCoord.xy + fract(uTime * 3.7) * 91.) - .5) * grain;
  return col;
}
`;

  const BODIES = {
    // Soft clouds of each colour drifting on slow Lissajous paths. The nearest one comes to your finger.
    calm: `
vec2 cloud(int i, float t){
  float fi = float(i);
  return vec2(.5 + .4 * sin(t * (.7 + fi * .13) + fi * 2.1), .5 + .4 * cos(t * (.5 + fi * .11) + fi * 1.3));
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  float t = uTime;
  float best = 1e9; int pick = 0;
  for (int i = 0; i < ${MAX_COLS}; i++) {
    if (float(i) > uCount - .5) break;
    vec2 d = (cloud(i, t) - uTouch.xy) * asp;
    float dd = dot(d, d);
    if (dd < best) { best = dd; pick = i; }
  }
  vec3 acc = vec3(0.); float wsum = 0.;
  for (int i = 0; i < ${MAX_COLS}; i++) {
    if (float(i) > uCount - .5) break;
    vec2 c = cloud(i, t);
    float pull = i == pick ? uTouch.z : 0.;
    c = mix(c, uTouch.xy, pull * .85);
    vec2 d = (uv - c) * asp;
    float w = exp(-dot(d, d) * (14. - uAudio.x * 6. - pull * 4.));
    acc += uCols[i] * w; wsum += w;
  }
  vec3 col = acc / max(wsum, 1e-4);
  col *= 1. + uAudio.z * .12;
  gl_FragColor = vec4(finish(col, .1, .018), 1.);
}`,

    // Domain-warped fbm. Taps ripple outward; drags push the colour along like a wake.
    liquid: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 p = uv * asp * FIELD;
  float glow = 0.;
  for (int i = 0; i < ${RIPPLES}; i++) {
    float a = uRip[i].z;
    vec2 d = (uv - uRip[i].xy) * asp;
    float r = length(d);
    float ring = exp(-pow((r - a * .45) * 14., 2.)) * exp(-a * 1.2);
    p += d / max(r, 1e-3) * ring * .3;
    glow += ring;
  }
  for (int i = 0; i < ${WAKES}; i++) {
    vec2 d = (uv - uWake[i].xy) * asp;
    p -= uWake[i].zw * asp * FIELD * .12 * exp(-dot(d, d) * 25.);
  }
  float t = uTime;
  float w = uWarp + uAudio.x * 3.;
  vec2 q = vec2(fbm(p + vec2(0., t * .12)), fbm(p + vec2(5.2, 1.3) - t * .1));
  vec2 r = vec2(fbm(p + w * q + vec2(1.7, 9.2) + t * .15), fbm(p + w * q + vec2(8.3, 2.8) - t * .13));
  float f = fbm(p + w * r);
  float x = smoothstep(.3, .7, f + (r.x - .5) * .45);
  vec3 col = palette(x);
  col *= .9 + .2 * smoothstep(.3, .8, f) + uAudio.z * .35 + glow * .08;
  gl_FragColor = vec4(finish(col, .18, .03), 1.);
}`,

    // Vertical ribs, each a drifting slice of the palette. Around your finger they break into
    // stepped horizontal tiles (shifted and re-pitched per slice) that heal when you let go.
    ribs: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  float n = clamp(floor(5. + 6. * asp + uParam), 3., 40.);
  float t = uTime;
  float rows = 10.;
  float row = floor(uv.y * rows);
  float yc = (row + .5) / rows;
  vec2 d = vec2((uv.x - uTouch.x) * asp * .6, yc - uTouch.y);
  float near = uTouch.z * exp(-dot(d, d) * 14.);
  float shift = (hash(vec2(row, 3.1)) - .5) * 1.6 * near;
  float pitch = 1. + (hash(vec2(row, 7.7)) - .5) * 1.6 * near;
  float x = ((uv.x - uTouch.x) * pitch + uTouch.x) * n + shift
          + sin(uv.y * 2.4 + t) * (.1 + uAudio.x * .5);
  float id = floor(x);
  float u = fract(x);
  float base = .5 + .3 * sin(t * .5 + id * .45 + uv.y * .8);  // where this rib sits in the palette
  float span = .4;
  vec3 col = palette(base - span * .5 + span * smoothstep(0., 1., u));
  col *= mix(.55, 1., smoothstep(0., .35, u));   // shadow on the rib's leading edge
  col *= 1. - smoothstep(.95, 1., u) * .25;      // crease
  float edge = .5 - abs(fract(uv.y * rows) - .5);   // 0 at a tile's top/bottom edge
  float seam = near * (1. - smoothstep(0., .012, edge));
  col *= 1. - seam * .25;                        // hairline between tiles
  col *= 1. + uAudio.z * .2;
  gl_FragColor = vec4(finish(col, .12, .035), 1.);
}`,

    // A smooth gradient seen through a strip of fluted glass. The strip follows your finger.
    glass: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float t = uTime;
  float cx = mix(.5 + .2 * sin(t * .5), uTouch.x, uTouch.z);
  float hw = .13 + uAudio.x * .05;
  float row = floor(uv.y * 7.);
  float jitter = (hash(vec2(row, floor(t * 1.3))) - .5) * .035;   // stepped glitch slices
  float bx = uv.x - (cx + jitter);
  float inside = step(abs(bx), hw);
  float ribs = 16.;
  float k = fract((bx + hw) / (2. * hw) * ribs);
  float sx = uv.x + inside * (k - .5) * (.22 + uAudio.y * .2);
  float gx = sx + .07 * sin(t * .4 + uv.y * 1.1);
  vec3 col = palette(gx);
  col *= 1. - inside * .14 * smoothstep(.75, 1., k);
  col += inside * .05 * smoothstep(.0, .2, k) * (1. - smoothstep(.2, .4, k));  // glint
  gl_FragColor = vec4(finish(col, .1, .04), 1.);
}`,

    // Columns of glowing pills on grainy charcoal; heights swell like an equaliser.
    pills: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  float n = floor(10. + 10. * asp);
  float t = uTime;
  float id = floor(uv.x * n);
  float u = fract(uv.x * n) - .5;
  float s = (id + .5) / n;
  float env = sin(PI * s);
  vec3 col = vec3(.165, .158, .165);
  for (int L = 0; L < 2; L++) {
    float fl = float(L);
    float wave = .5 + .5 * sin(s * 5. - t * 1.2 + fl * 1.9);
    float level = fl < .5 ? uAudio.y : uAudio.x;
    float h = (.04 + .22 * env * wave) * (1. + level * 1.3);
    float cy = (fl < .5 ? .6 : .4) + .1 * sin(s * 3. + t * .6 + fl * 2.2);
    float w = .32 * (.25 + .75 * env);
    vec2 d = vec2(u / w, (uv.y - cy) / h);
    float m = 1. - smoothstep(.9, 1., length(d));
    float g = fl < .5 ? mix(.45, 1., s) + d.y * .12 : mix(0., .6, s) - d.y * .1;
    vec3 pc = palette(g) * (.82 + .3 * (d.y * .5 + .5));
    col = mix(col, pc, m);
  }
  gl_FragColor = vec4(finish(col, .08, .06), 1.);
}`,
  };

  let canvas, gl;
  const programs = {};
  let running = false, raf = 0, last = 0, time = 0;
  let cols = new Float32Array(MAX_COLS * 3), count = 2;
  let style = STYLES.liquid;
  const cur = { speed: style.speed, warp: style.warp, bright: style.bright };
  const touch = { x: 0.5, y: 0.5, z: 0, down: 0, id: null, t: 0 };
  const ripples = Array.from({ length: RIPPLES }, () => ({ x: 0, y: 0, age: 99 }));
  const wakes = Array.from({ length: WAKES }, () => ({ x: 0, y: 0, vx: 0, vy: 0 }));
  let wakeNext = 0, wakeAt = 0;
  let ribExtra = 0; // ribs added/removed by dragging sideways
  const audio = { on: false, ctx: null, analyser: null, stream: null, data: null, lv: [0, 0, 0] };

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  // Compiled on first use and cached.
  function program(name) {
    if (programs[name]) return programs[name];
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, COMMON + BODIES[name]));
    gl.bindAttribLocation(prog, 0, 'a');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const U = {};
    for (const n of ['uRes', 'uTime', 'uWarp', 'uBright', 'uCount', 'uParam', 'uCols', 'uAudio', 'uTouch', 'uRip', 'uWake']) {
      U[n] = gl.getUniformLocation(prog, n);
    }
    return (programs[name] = { prog, U });
  }

  function init(c) {
    canvas = c;
    gl = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, alpha: false });
    if (!gl) return false;
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      program('liquid');
    } catch (err) {
      console.error(err);
      return false;
    }
    bindPointers();
    window.addEventListener('resize', resize);
    return true;
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
  }

  // Colours sorted dark → light so gradients flow instead of jumping.
  function setPalette(hexes) {
    let list = hexes.slice(0, MAX_COLS);
    if (list.length === 1) list = [list[0], list[0]];
    list.sort((a, b) => Color.toOklab(a)[0] - Color.toOklab(b)[0]);
    cols = new Float32Array(MAX_COLS * 3);
    list.forEach((h, i) => Color.hexToRgb(h).forEach((v, j) => (cols[i * 3 + j] = v / 255)));
    count = list.length;
  }

  function setStyle(name) {
    style = STYLES[name] || STYLES.liquid;
    if (gl) {
      try { program(style.prog); } catch (err) { console.error(err); style = STYLES.liquid; }
    }
  }

  // ---- touch: one finger at a time (the latest one) -------------------------------
  function toUV(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (r.bottom - e.clientY) / r.height];
  }

  function bindPointers() {
    canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = toUV(e);
      Object.assign(touch, { x, y, id: e.pointerId, t: performance.now() });
      touch.down++;
      const r = ripples.reduce((a, b) => (a.age > b.age ? a : b)); // reuse the oldest ripple
      Object.assign(r, { x, y, age: 0 });
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!touch.down || e.pointerId !== touch.id) return;
      const now = performance.now();
      const dt = Math.max(0.008, (now - touch.t) / 1000);
      const [x, y] = toUV(e);
      const vx = Math.max(-3, Math.min(3, (x - touch.x) / dt));
      const vy = Math.max(-3, Math.min(3, (y - touch.y) / dt));
      if (style.prog === 'ribs') ribExtra = Math.max(-8, Math.min(26, ribExtra + (x - touch.x) * 30));
      Object.assign(touch, { x, y, t: now });
      if (now - wakeAt > 45) {
        wakeAt = now;
        Object.assign(wakes[wakeNext], { x, y, vx, vy });
        wakeNext = (wakeNext + 1) % WAKES;
      }
    });
    const lift = (e) => {
      if (!touch.down) return;
      touch.down = Math.max(0, touch.down - 1);
      if (e.pointerId === touch.id) touch.id = null;
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
  }

  // ---- sound -------------------------------------------------------------------
  async function toggleMic() {
    if (audio.on) {
      audio.stream.getTracks().forEach((t) => t.stop());
      audio.ctx.close();
      Object.assign(audio, { on: false, ctx: null, analyser: null, stream: null });
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    ctx.createMediaStreamSource(stream).connect(analyser);
    Object.assign(audio, { on: true, ctx, analyser, stream, data: new Uint8Array(analyser.frequencyBinCount) });
    return true;
  }

  function readAudio() {
    const lv = audio.lv;
    if (!audio.on) { for (let i = 0; i < 3; i++) lv[i] *= 0.9; return lv; }
    audio.analyser.getByteFrequencyData(audio.data);
    const band = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += audio.data[i]; return s / ((b - a) * 255); };
    const raw = [band(1, 6), band(6, 40), band(40, 120)];
    for (let i = 0; i < 3; i++) {
      const v = Math.min(1, Math.max(0, (raw[i] - 0.08) * 1.6));
      lv[i] += (v - lv[i]) * (v > lv[i] ? 0.5 : 0.12); // fast attack, slow release
    }
    return lv;
  }

  // ---- loop --------------------------------------------------------------------
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    const ease = Math.min(1, dt * 2);
    cur.speed += (style.speed - cur.speed) * ease;
    cur.warp += (style.warp - cur.warp) * ease;
    cur.bright += (style.bright - cur.bright) * ease;
    const lv = readAudio();
    time += dt * cur.speed * (1 + lv[1] * 2.5);
    // Pressing takes hold quickly; letting go heals over ~2s.
    touch.z += ((touch.down ? 1 : 0) - touch.z) * Math.min(1, dt * (touch.down ? 6 : 0.9));

    const rip = new Float32Array(RIPPLES * 3);
    ripples.forEach((r, i) => { r.age = Math.min(99, r.age + dt); rip.set([r.x, r.y, r.age], i * 3); });
    const wake = new Float32Array(WAKES * 4);
    const fade = Math.pow(0.12, dt);
    wakes.forEach((w, i) => { w.vx *= fade; w.vy *= fade; wake.set([w.x, w.y, w.vx, w.vy], i * 4); });

    resize();
    const { prog, U } = program(style.prog);
    gl.useProgram(prog);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uWarp, cur.warp);
    gl.uniform1f(U.uBright, cur.bright);
    gl.uniform1f(U.uCount, count);
    gl.uniform1f(U.uParam, ribExtra);
    gl.uniform3fv(U.uCols, cols);
    gl.uniform3f(U.uAudio, lv[0], lv[1], lv[2]);
    gl.uniform3f(U.uTouch, touch.x, touch.y, touch.z);
    gl.uniform3fv(U.uRip, rip);
    gl.uniform4fv(U.uWake, wake);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || !gl) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    if (audio.on) toggleMic().then(() => document.querySelector('#micBtn')?.classList.remove('on'));
  }

  const snapshot = () => new Promise((res) => (canvas ? canvas.toBlob(res, 'image/png') : res(null)));

  return { init, start, stop, setPalette, setStyle, toggleMic, snapshot, styles: Object.keys(STYLES) };
})();
