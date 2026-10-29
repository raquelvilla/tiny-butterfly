// Visual: full-screen WebGL shaders fed by a palette, played by touch.
// Each style is its own fragment shader sharing a common header, and each answers touch its own way:
//   liquid — your finger draws a liquid-chrome trail (a feedback buffer) that refracts the colours
//            underneath and melts away
//            (taps and drawing also send ripples through the colours)
//   storm  — holding a finger down sends lightning through the noise's own veins
//   ribs   — the ribs around your finger break into stepped tiles; dragging sideways changes their count
//   pills  — your finger spawns pills that grow into the nearest column, drift and fade
//   clouds — soft volumetric clouds; your finger moves the sun that lights them
const Visual = (() => {
  const FIELD = 2.2; // noise field units across the screen height
  const MAX_COLS = 6;
  const TRAIL_SCALE = 0.5; // trail buffer resolution relative to the canvas
  const BRUSH = 0.05;      // trail thickness, in screen heights
  const RIPPLES = 8;
  const RIPPLE_GAP = 0.14; // uv distance a drawing finger travels between ripples
  const STRIKES = 4;        // lightning strikes alive at once (each lingers ~0.35s)
  const STRIKE_EVERY = 140; // ms between strikes while held
  const SPAWNS = 16;        // finger-spawned pills alive at once (each lives ~4s)
  const SPAWN_GAP = 0.035;  // uv distance a dragging finger travels between pills

  const STYLES = {
    liquid: { prog: 'liquid', speed: 0.3, warp: 2.6, bright: 1.0 },
    storm: { prog: 'storm', speed: 0.85, warp: 4.6, bright: 1.0 },
    ribs: { prog: 'ribs', speed: 0.35, warp: 0, bright: 1.0 },
    pills: { prog: 'pills', speed: 0.5, warp: 0, bright: 1.0 },
    clouds: { prog: 'clouds', speed: 0.12, warp: 0, bright: 1.0 },
  };

  const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

  // Feedback pass: last frame's trail, softly blurred and faded, plus a capsule stamped along the
  // finger's path since the previous frame (so fast strokes stay continuous).
  const TRAIL = `
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uSize, uTexel, uA, uB;
uniform float uOn, uR, uDecay;
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  float v = texture2D(uPrev, uv).r;
  if (uDecay > .5) {   // once per frame; extra stamping passes in the same frame only add
    v = v * .4
      + (texture2D(uPrev, uv + vec2(uTexel.x, 0.)).r + texture2D(uPrev, uv - vec2(uTexel.x, 0.)).r
       + texture2D(uPrev, uv + vec2(0., uTexel.y)).r + texture2D(uPrev, uv - vec2(0., uTexel.y)).r) * .15;
    v = max(v * .985 - .0025, 0.);   // the subtraction makes sure 8-bit values reach zero
  }
  vec2 asp = vec2(uSize.x / uSize.y, 1.);
  vec2 p = uv * asp, a = uA * asp, b = uB * asp;
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0., 1.);
  float d = length(pa - ba * h);
  v = max(v, uOn * smoothstep(uR, uR * .3, d));
  gl_FragColor = vec4(vec3(v), 1.);
}`;

  const COMMON = `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uWarp, uBright, uCount, uParam;
uniform vec3 uCols[${MAX_COLS}];  // sorted dark -> light
uniform vec3 uTouch;              // xy = finger in 0..1 uv, z = 0..1 how pressed (rises fast, heals slowly)
#define FIELD ${FIELD.toFixed(2)}
#define PI 3.14159265

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// Fractal noise with a variable number of octaves (more = finer detail), normalised to 0..1.
float fbm(vec2 p, float oct){
  float v = 0., a = .5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= oct) break;
    v += a * noise(p); p = m * p; a *= .5;
  }
  return v / (1. - 2. * a);
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
// The domain-warped noise behind liquid and storm (r = its second warp, for colour shaping).
float warped(vec2 p, float oct, out vec2 r){
  float t = uTime, w = uWarp;
  vec2 q = vec2(fbm(p + vec2(0., t * .12), oct), fbm(p + vec2(5.2, 1.3) - t * .1, oct));
  r = vec2(fbm(p + w * q + vec2(1.7, 9.2) + t * .15, oct), fbm(p + w * q + vec2(8.3, 2.8) - t * .13, oct));
  return fbm(p + w * r, oct);
}
// The colour field over that noise; f hands back the noise value.
vec3 field(vec2 p, float oct, out float f){
  vec2 r;
  f = warped(p, oct, r);
  float x = smoothstep(.3, .7, f + (r.x - .5) * .45);
  return palette(x) * (.9 + .2 * smoothstep(.3, .8, f));
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
    // Domain-warped fbm under a liquid-chrome trail. The trail's slope acts as a surface normal:
    // it bends the colours beneath (refraction), darkens at the rim and catches a highlight.
    // Taps (and every so often while drawing) also send water ripples through the colours.
    liquid: `
uniform sampler2D uTrail;
uniform vec2 uTexel;
uniform vec3 uRip[${RIPPLES}];   // xy = uv, z = age in seconds
float trail(vec2 uv){ return texture2D(uTrail, uv).r; }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  float h = trail(uv);
  vec2 o = uTexel * 3.;
  float hx = trail(uv + vec2(o.x, 0.)) - trail(uv - vec2(o.x, 0.));
  float hy = trail(uv + vec2(0., o.y)) - trail(uv - vec2(0., o.y));
  vec3 n = normalize(vec3(-hx, -hy, .14));
  float body = smoothstep(.02, .14, h);

  // Smooth: three octaves at a broader scale.
  vec2 p = uv * asp * FIELD * .75 + n.xy * .6 * body;

  // Ripples: a packet of concentric crests travels outward and fades, bending the colour slightly
  // and catching light on each crest so it reads as a ring.
  float shade = 0.;
  for (int i = 0; i < ${RIPPLES}; i++) {
    float a = uRip[i].z;
    if (a > 3.) continue;
    vec2 d = (uv - uRip[i].xy) * asp;
    float r = length(d);
    float ahead = r - a * .3;                     // > 0 outside the leading edge
    float e = ahead + .06;
    float packet = exp(-pow(max(e, 0.) * 22., 2.) - pow(min(e, 0.) * 9., 2.));
    float fade = exp(-a * 1.1) * smoothstep(0., .04, r);
    float phase = ahead * 75.;
    p += d / max(r, 1e-3) * sin(phase) * packet * fade * .03;
    shade += cos(phase) * packet * fade;
  }

  float f;
  vec3 col = field(p, 3., f);
  col *= 1. + shade * .14;
  col += pow(max(shade, 0.), 3.) * .1;

  vec3 L = normalize(vec3(-.45, .6, .65));
  float diff = clamp(dot(n, L), 0., 1.);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0., 0., 1.)), 0., 1.), 36.);
  float rim = pow(1. - n.z, 1.6);
  vec3 env = palette(.5 + .5 * n.y);                     // the chrome reflects the palette
  vec3 glass = col * (.6 + .55 * diff) + env * rim * .35;
  glass = mix(glass, vec3(.04, .035, .05), rim * .6);     // dark outline at the edges
  glass += spec * 1.1;
  col = mix(col, glass, body);
  gl_FragColor = vec4(finish(col, .18, .03), 1.);
}`,

    // Fine, detailed warped noise that conducts lightning. Each bolt is one connected line heading out
    // from the finger whose sideways path is steered by the broad shapes of the same noise, sampled
    // along the bolt, so it swerves with the visible folds; a little fine jitter makes it crackle.
    // Bolts grow out, fork, lean the way you drag, and re-strike on new paths every few frames.
    storm: `
uniform vec4 uStrikes[${STRIKES}];  // xy = origin uv, z = seed, w = age in seconds
uniform vec3 uDir;                  // xy = drag direction, z = 0..1 how much you're moving
#define STORM_SCALE (FIELD * 1.35)
// (core, glow) of one bolt grown to 'reach' (0..1) of its length
vec2 bolt(vec2 p, vec2 o, float ang, float len, float reach, float bend, float seed){
  vec2 dir = vec2(cos(ang), sin(ang)), side = vec2(-dir.y, dir.x);
  vec2 d = p - o;
  float s = dot(d, dir);
  float end = len * reach;
  if (s < 0. || s > end) return vec2(0.);
  float across = dot(d, side);
  if (abs(across) > bend * .5 + .03) return vec2(0.);    // too far from any possible path
  vec2 r;
  vec2 axis = o + dir * s;
  float coarse = warped(axis * STORM_SCALE, 3., r);       // the noise's broad shapes along the path
  float jitter = (noise(vec2(s * 40., seed)) - .5) * .02 + (noise(vec2(s * 110., seed + 5.)) - .5) * .007;
  float path = ((coarse - .5) * bend + jitter) * smoothstep(0., .05, s);
  float px = abs(across - path) * uRes.y;                 // distance to the bolt, in pixels
  float taper = 1. - s / len;
  float tip = smoothstep(end - .025, end, s) * (1. - reach) * 2.;   // bright leading tip
  return vec2(smoothstep(1.5, 0., px) * (taper + tip), exp(-px * .12) * taper);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  float f;
  vec3 col = field(uv * asp * STORM_SCALE, 7., f);
  vec2 p = uv * asp;
  vec2 light = vec2(0.);
  float moveAng = atan(uDir.y, uDir.x + 1e-5);
  for (int k = 0; k < ${STRIKES}; k++) {
    vec4 S = uStrikes[k];
    float a = S.w;
    if (a > .35) continue;
    vec2 o = S.xy * asp;
    float seed = S.z;
    float reach = smoothstep(0., .1, a);
    float life = 1. - smoothstep(.04, .35, a);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float rnd = hash(vec2(fi, seed));
      float ang = mix(rnd * 6.2832, moveAng + (rnd - .5) * 1.2, uDir.z);
      float len = .25 + .35 * hash(vec2(seed, fi + 4.));
      float bend = .5 + .4 * hash(vec2(fi + 9., seed));
      light += bolt(p, o, ang, len, reach, bend, seed + fi * 13.) * life;
      // a fork leaving part-way along (from where the main path actually is), also noise-steered
      float s0 = len * .4;
      vec2 r;
      vec2 a0 = o + vec2(cos(ang), sin(ang)) * s0;
      vec2 fo = a0 + vec2(-sin(ang), cos(ang)) * (warped(a0 * STORM_SCALE, 3., r) - .5) * bend;
      float fang = ang + (hash(vec2(fi, seed + 2.)) - .5) * 1.5;
      light += .65 * bolt(p, fo, fang, len * .55, smoothstep(.4, 1., reach), bend * .7, seed + fi * 29.) * life;
    }
  }
  vec3 tint = palette(1.) * 1.2 + .08;
  col += tint * light.y * .45;
  col += mix(tint, vec3(1.), .8) * min(light.x, 1.6);
  gl_FragColor = vec4(finish(col, .22, .025), 1.);
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
          + sin(uv.y * 2.4 + t) * .1;
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
  gl_FragColor = vec4(finish(col, .12, .035), 1.);
}`,

    // Columns of glowing pills on grainy charcoal; heights swell in a slow wave. Pills your finger
    // spawns snap to the nearest column, grow in with a soft shadow, drift up and shrink away.
    pills: `
uniform vec4 uPills[${SPAWNS}];   // xy = where spawned (uv), z = age in seconds, w = seed
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
    float h = .04 + .22 * env * wave;
    float cy = (fl < .5 ? .6 : .4) + .1 * sin(s * 3. + t * .6 + fl * 2.2);
    float w = .32 * (.25 + .75 * env);
    vec2 d = vec2(u / w, (uv.y - cy) / h);
    float m = 1. - smoothstep(.9, 1., length(d));
    float g = fl < .5 ? mix(.45, 1., s) + d.y * .12 : mix(0., .6, s) - d.y * .1;
    vec3 pc = palette(g) * (.82 + .3 * (d.y * .5 + .5));
    col = mix(col, pc, m);
  }
  for (int i = 0; i < ${SPAWNS}; i++) {
    vec4 P = uPills[i];
    float a = P.z;
    if (a > 4.) continue;
    float seed = P.w;
    float grow = smoothstep(0., .35, a) * (1. - smoothstep(3., 4., a));
    float cx = (floor(P.x * n) + .5) / n;
    float cy = P.y + a * .025;
    float hh = (.08 + .14 * hash(vec2(seed, 1.))) * grow + 1e-4;
    float ww = .3 / n;
    vec2 d = vec2((uv.x - cx) / ww, (uv.y - cy) / hh);
    float r = length(d);
    col *= 1. - .35 * (1. - smoothstep(.9, 1.8, r)) * grow;   // soft shadow around it
    float m = (1. - smoothstep(.9, 1., r)) * step(.002, grow);
    float g = hash(vec2(seed, 2.)) + d.y * .12;
    col = mix(col, palette(g) * (.82 + .3 * (d.y * .5 + .5)), m);
  }
  gl_FragColor = vec4(finish(col, .08, .06), 1.);
}`,

    // Soft volumetric clouds: two drifting layers of billowy noise over a palette sky. Each layer
    // marches a few steps toward the sun to shadow itself, so thick parts darken and thin edges glow
    // (a silver lining). The sun sits where your finger last was.
    clouds: `
uniform vec2 uLight;   // sun position, uv
float density(vec2 q, float t){
  float f = fbm(q + vec2(t * .6, t * .1), 6.);
  float g = fbm(q * 2.3 - vec2(t * .3, 0.), 4.);
  return smoothstep(.47, .66, f * .75 + g * .35);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 p = uv * asp, lp = uLight * asp;
  float t = uTime;
  vec3 col = mix(palette(.45), palette(.12), uv.y) * .85;
  float sun = exp(-dot(p - lp, p - lp) * 6.);
  col += palette(1.) * sun * .6;
  vec2 toSun = normalize(lp - p + 1e-4);
  vec3 litCol = mix(palette(.85), vec3(1.), .6);
  vec3 shadowCol = mix(palette(.4), litCol, .45);
  for (int L = 0; L < 2; L++) {
    float fl = float(L);
    float sc = mix(1.6, 2.4, fl);
    vec2 q = p * sc + vec2(fl * 7.3, fl * 3.1);
    float tt = t * (1. + fl * .6);
    float d = density(q, tt);
    if (d < .001) continue;
    float acc = 0.;
    for (int i = 1; i <= 4; i++) acc += density(q + toSun * sc * .05 * float(i), tt);
    float lit = exp(-acc * .8);
    float rim = (1. - d) * lit;
    vec3 c = mix(shadowCol, litCol, lit) + palette(1.) * rim * sun * 1.5 + rim * .15;
    col = mix(col, c, d * mix(.85, .97, fl));
  }
  gl_FragColor = vec4(finish(col, .15, .02), 1.);
}`,
  };

  let canvas, gl;
  const programs = {};
  let trailProg = null;
  let trail = null; // { w, h, tex: [a, b], fb: [a, b], read: 0 }
  let running = false, raf = 0, last = 0, time = 0;
  let cols = new Float32Array(MAX_COLS * 3), count = 2;
  let style = STYLES.liquid;
  const cur = { speed: style.speed, warp: style.warp, bright: style.bright };
  const touch = { x: 0.5, y: 0.5, z: 0, down: 0, id: null };
  const path = []; // finger points not yet stamped into the trail (capped so a stall can't pile up)
  const ripples = Array.from({ length: RIPPLES }, () => ({ x: 0, y: 0, age: 99 }));
  const lastRipple = { x: 0, y: 0 };
  const strikes = Array.from({ length: STRIKES }, () => ({ x: 0, y: 0, seed: 0, age: 99 }));
  let strikeAt = 0;
  const drag = { x: 1, y: 0, amount: 0 }; // recent drag direction, and how much you're moving
  let ribExtra = 0; // ribs added/removed by dragging sideways
  const spawned = Array.from({ length: SPAWNS }, () => ({ x: 0, y: 0, seed: 0, age: 99 }));
  const lastSpawn = { x: 0, y: 0 };
  const light = { x: 0.28, y: 0.82 }; // clouds' sun; drifts to your finger and stays there

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function link(fragSrc, uniforms) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragSrc));
    gl.bindAttribLocation(prog, 0, 'a');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const U = {};
    for (const n of uniforms) U[n] = gl.getUniformLocation(prog, n);
    return { prog, U };
  }

  // Style programs are compiled on first use and cached.
  function program(name) {
    if (!programs[name]) {
      programs[name] = link(COMMON + BODIES[name],
        ['uRes', 'uTime', 'uWarp', 'uBright', 'uCount', 'uParam', 'uCols', 'uTouch', 'uTrail', 'uTexel', 'uRip', 'uStrikes', 'uDir', 'uPills', 'uLight']);
    }
    return programs[name];
  }

  // Two textures we ping-pong between: read last frame's trail, write this frame's.
  function ensureTrail() {
    const w = Math.max(1, Math.round(canvas.width * TRAIL_SCALE));
    const h = Math.max(1, Math.round(canvas.height * TRAIL_SCALE));
    if (trail && trail.w === w && trail.h === h) return;
    if (trail) {
      trail.tex.forEach((t) => gl.deleteTexture(t));
      trail.fb.forEach((f) => gl.deleteFramebuffer(f));
    }
    trail = { w, h, tex: [], fb: [], read: 0 };
    for (let i = 0; i < 2; i++) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      trail.tex.push(tex);
      trail.fb.push(fb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // One feedback pass: fade (if decay) and stamp the segment a→b (if on).
  function trailPass(a, b, on, decay) {
    const write = 1 - trail.read;
    const { U } = trailProg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, trail.fb[write]);
    gl.bindTexture(gl.TEXTURE_2D, trail.tex[trail.read]);
    gl.uniform2f(U.uA, a[0], a[1]);
    gl.uniform2f(U.uB, b[0], b[1]);
    gl.uniform1f(U.uOn, on ? 1 : 0);
    gl.uniform1f(U.uDecay, decay ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    trail.read = write;
  }

  // Fade once, then stamp every segment the finger travelled since the last frame (so curves stay
  // curves even when frames are slower than pointer events).
  function stepTrail() {
    ensureTrail();
    const { prog, U } = trailProg;
    gl.viewport(0, 0, trail.w, trail.h);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(U.uPrev, 0);
    gl.uniform2f(U.uSize, trail.w, trail.h);
    gl.uniform2f(U.uTexel, 1 / trail.w, 1 / trail.h);
    gl.uniform1f(U.uR, BRUSH);
    const pts = path.splice(0);
    trailPass([0, 0], [0, 0], false, true);
    for (let i = 1; i < pts.length; i++) trailPass(pts[i - 1], pts[i], true, false);
    if (touch.down) path.push(pts.length ? pts[pts.length - 1] : [touch.x, touch.y]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
      trailProg = link(TRAIL, ['uPrev', 'uSize', 'uTexel', 'uA', 'uB', 'uOn', 'uR', 'uDecay']);
      program('liquid');
    } catch (err) {
      console.error(err);
      return false;
    }
    bindPointers();
    return true;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
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
    path.length = 0;
    if (gl) {
      try { program(style.prog); } catch (err) { console.error(err); style = STYLES.liquid; }
    }
  }

  // ---- touch: one finger at a time (the latest one) -------------------------------
  function toUV(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (r.bottom - e.clientY) / r.height];
  }

  const oldest = (list) => list.reduce((a, b) => (a.age > b.age ? a : b));

  function dropRipple(x, y) {
    Object.assign(oldest(ripples), { x, y, age: 0 });
    Object.assign(lastRipple, { x, y });
  }

  function spawnPill(x, y) {
    Object.assign(oldest(spawned), { x, y, seed: Math.random() * 100, age: 0 });
    Object.assign(lastSpawn, { x, y });
  }

  function bindPointers() {
    canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = toUV(e);
      Object.assign(touch, { x, y, id: e.pointerId });
      touch.down++;
      path.length = 0;
      path.push([x, y], [x, y]); // a dot even if the finger never moves
      if (style.prog === 'liquid') dropRipple(x, y);
      if (style.prog === 'pills') spawnPill(x, y);
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!touch.down || e.pointerId !== touch.id) return;
      const [x, y] = toUV(e);
      if (style.prog === 'ribs') ribExtra = Math.max(-8, Math.min(26, ribExtra + (x - touch.x) * 30));
      const dx = (x - touch.x) * canvas.width / canvas.height, dy = y - touch.y, len = Math.hypot(dx, dy);
      if (len > 0.002) {
        drag.x += (dx / len - drag.x) * 0.3;
        drag.y += (dy / len - drag.y) * 0.3;
        drag.amount = Math.min(1.5, drag.amount + len * 25);
      }
      Object.assign(touch, { x, y });
      if (style.prog === 'liquid' && Math.hypot(x - lastRipple.x, y - lastRipple.y) > RIPPLE_GAP) dropRipple(x, y);
      if (style.prog === 'pills' && Math.hypot(x - lastSpawn.x, y - lastSpawn.y) > SPAWN_GAP) spawnPill(x, y);
      if (path.length < 48) path.push([x, y]);
    });
    const lift = (e) => {
      if (!touch.down) return;
      touch.down = Math.max(0, touch.down - 1);
      if (e.pointerId === touch.id) touch.id = null;
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
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
    time += dt * cur.speed;
    // Pressing takes hold quickly; letting go heals over ~2s.
    touch.z += ((touch.down ? 1 : 0) - touch.z) * Math.min(1, dt * (touch.down ? 6 : 0.9));
    drag.amount *= Math.pow(0.05, dt);
    if (touch.down && now - strikeAt > STRIKE_EVERY) {
      strikeAt = now;
      Object.assign(oldest(strikes), { x: touch.x, y: touch.y, seed: Math.random() * 100, age: 0 });
    }
    const rip = new Float32Array(RIPPLES * 3);
    ripples.forEach((r, i) => { r.age = Math.min(99, r.age + dt); rip.set([r.x, r.y, r.age], i * 3); });
    const stk = new Float32Array(STRIKES * 4);
    strikes.forEach((k, i) => { k.age = Math.min(99, k.age + dt); stk.set([k.x, k.y, k.seed, k.age], i * 4); });
    const pil = new Float32Array(SPAWNS * 4);
    spawned.forEach((q, i) => { q.age = Math.min(99, q.age + dt); pil.set([q.x, q.y, q.age, q.seed], i * 4); });
    if (touch.down) {
      const k = Math.min(1, dt * 4);
      light.x += (touch.x - light.x) * k;
      light.y += (touch.y - light.y) * k;
    }

    resize();
    const liquid = style.prog === 'liquid';
    if (liquid) stepTrail();

    const { prog, U } = program(style.prog);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uWarp, cur.warp);
    gl.uniform1f(U.uBright, cur.bright);
    gl.uniform1f(U.uCount, count);
    gl.uniform1f(U.uParam, ribExtra);
    gl.uniform3fv(U.uCols, cols);
    gl.uniform3f(U.uTouch, touch.x, touch.y, touch.z);
    gl.uniform3fv(U.uRip, rip);
    gl.uniform4fv(U.uStrikes, stk);
    gl.uniform3f(U.uDir, drag.x, drag.y, Math.min(1, drag.amount));
    gl.uniform4fv(U.uPills, pil);
    gl.uniform2f(U.uLight, light.x, light.y);
    if (liquid) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, trail.tex[trail.read]);
      gl.uniform1i(U.uTrail, 0);
      gl.uniform2f(U.uTexel, 1 / trail.w, 1 / trail.h);
    }
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
  }

  const snapshot = () => new Promise((res) => (canvas ? canvas.toBlob(res, 'image/png') : res(null)));

  return { init, start, stop, setPalette, setStyle, snapshot, styles: Object.keys(STYLES) };
})();
