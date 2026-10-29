// Visual: full-screen WebGL shader gradient fed by a palette, stirred by touch and sound.
const Visual = (() => {
  const FIELD = 2.2; // field units across the screen height; touch coords use the same scale
  const MAX_COLS = 6;
  const SWIRLS = 4;
  const PRESETS = {
    calm: { warp: 1.4, speed: 0.12, bright: 1.0 },
    liquid: { warp: 2.6, speed: 0.3, bright: 1.0 },
    storm: { warp: 4.6, speed: 0.85, bright: 1.05 },
  };

  const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
  const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uWarp, uBright, uCount;
uniform vec3 uCols[${MAX_COLS}];
uniform vec3 uSw[${SWIRLS}];   // xy = centre (field units), z = twist
uniform vec3 uAudio;           // bass, mid, high (0..1)

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
void main(){
  vec2 p = gl_FragCoord.xy / uRes.y * ${FIELD.toFixed(2)};
  for (int i = 0; i < ${SWIRLS}; i++) {
    vec2 d = p - uSw[i].xy;
    float a = uSw[i].z * exp(-dot(d, d) * 4.);
    float c = cos(a), s = sin(a);
    p = uSw[i].xy + mat2(c, s, -s, c) * d;
  }
  float t = uTime;
  float w = uWarp + uAudio.x * 3.;
  vec2 q = vec2(fbm(p + vec2(0., t * .12)), fbm(p + vec2(5.2, 1.3) - t * .1));
  vec2 r = vec2(fbm(p + w * q + vec2(1.7, 9.2) + t * .15), fbm(p + w * q + vec2(8.3, 2.8) - t * .13));
  float f = fbm(p + w * r);
  float x = smoothstep(.3, .7, f + (r.x - .5) * .45);
  vec3 col = palette(x);
  col *= .9 + .2 * smoothstep(.3, .8, f) + uAudio.z * .35;
  col *= uBright;
  vec2 uv = gl_FragCoord.xy / uRes;
  col *= mix(.82, 1., smoothstep(1.05, .35, length(uv - .5)));
  col += (hash(gl_FragCoord.xy + fract(t) * 91.) - .5) * .03;
  gl_FragColor = vec4(col, 1.);
}`;

  let canvas, gl, U = {};
  let running = false, raf = 0, last = 0, time = 0;
  let cols = new Float32Array(MAX_COLS * 3), count = 2;
  const target = { ...PRESETS.liquid };
  const cur = { ...PRESETS.liquid };
  const swirls = Array.from({ length: SWIRLS }, () => ({ x: 0, y: 0, tx: 0, ty: 0, twist: 0, spin: 0, id: null, lx: 0, ly: 0 }));
  const audio = { on: false, ctx: null, analyser: null, stream: null, data: null, lv: [0, 0, 0] };

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function init(c) {
    canvas = c;
    gl = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, alpha: false });
    if (!gl) return false;
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const n of ['uRes', 'uTime', 'uWarp', 'uBright', 'uCount', 'uCols', 'uSw', 'uAudio']) {
        U[n] = gl.getUniformLocation(prog, n);
      }
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

  // Colours sorted dark → light so the gradient flows instead of jumping.
  function setPalette(hexes) {
    let list = hexes.slice(0, MAX_COLS);
    if (list.length === 1) list = [list[0], list[0]];
    list.sort((a, b) => Color.toOklab(a)[0] - Color.toOklab(b)[0]);
    cols = new Float32Array(MAX_COLS * 3);
    list.forEach((h, i) => Color.hexToRgb(h).forEach((v, j) => (cols[i * 3 + j] = v / 255)));
    count = list.length;
  }

  function setPreset(name) { Object.assign(target, PRESETS[name] || PRESETS.liquid); }

  // ---- touch: each finger drags a swirl; twist follows how fast you move ----
  function toField(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.height) * FIELD, ((r.bottom - e.clientY) / r.height) * FIELD];
  }

  function bindPointers() {
    canvas.addEventListener('pointerdown', (e) => {
      const s = swirls.find((x) => x.id === null && Math.abs(x.twist) < 0.05) ||
        swirls.reduce((a, b) => (Math.abs(a.twist) < Math.abs(b.twist) ? a : b));
      const [x, y] = toField(e);
      Object.assign(s, { id: e.pointerId, x, y, tx: x, ty: y, lx: e.clientX, ly: e.clientY });
      s.spin += (Math.random() < 0.5 ? -1 : 1) * 0.6; // a tap alone gives a little stir
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const s = swirls.find((x) => x.id === e.pointerId);
      if (!s) return;
      const dx = e.clientX - s.lx, dy = e.clientY - s.ly;
      s.lx = e.clientX; s.ly = e.clientY;
      [s.tx, s.ty] = toField(e);
      s.spin = Math.max(-4, Math.min(4, s.spin + (dx - dy * 0.5) * 0.012));
    });
    const lift = (e) => { const s = swirls.find((x) => x.id === e.pointerId); if (s) s.id = null; };
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
    for (const k of Object.keys(cur)) cur[k] += (target[k] - cur[k]) * Math.min(1, dt * 2);
    const lv = readAudio();
    time += dt * cur.speed * (1 + lv[1] * 2.5);

    const sw = new Float32Array(SWIRLS * 3);
    swirls.forEach((s, i) => {
      s.x += (s.tx - s.x) * Math.min(1, dt * 10);
      s.y += (s.ty - s.y) * Math.min(1, dt * 10);
      s.spin *= Math.pow(s.id === null ? 0.25 : 0.6, dt); // fades over ~2s once lifted
      s.twist += (s.spin - s.twist) * Math.min(1, dt * 6);
      sw.set([s.x, s.y, s.twist], i * 3);
    });

    resize();
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uWarp, cur.warp);
    gl.uniform1f(U.uBright, cur.bright);
    gl.uniform1f(U.uCount, count);
    gl.uniform3fv(U.uCols, cols);
    gl.uniform3fv(U.uSw, sw);
    gl.uniform3f(U.uAudio, lv[0], lv[1], lv[2]);
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

  return { init, start, stop, setPalette, setPreset, toggleMic, snapshot };
})();
