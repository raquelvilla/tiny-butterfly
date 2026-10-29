// Visual: full-screen WebGL shaders fed by a palette, played by touch.
// Each style is its own fragment shader sharing a common header, and each answers touch its own way:
//   liquid — your finger draws a liquid-chrome trail (a feedback buffer) that refracts the colours
//            underneath and melts away
//            (taps and drawing also send ripples through the colours)
//   storm  — holding a finger down sends lightning along the noise's own paths (traced on the CPU
//            from a small read-back of the noise, then drawn as glowing segments)
//   ribs   — the ribs around your finger break into stepped tiles; dragging sideways changes their count
//   pills  — your finger spawns pills that grow into the nearest column, drift and fade
//   clouds — soft volumetric clouds; your finger moves the sun that lights them
const Visual = (() => {
  const FIELD = 2.2; // noise field units across the screen height
  const MAX_COLS = 6;
  const TRAIL_SCALE = 0.5; // trail buffer resolution relative to the canvas
  const BRUSH = 0.05;      // trail thickness, in screen heights
  const RIPPLES = 8;
  const RIPPLE_GAP = 0.1;  // uv distance a drawing finger travels between ripples
  const RIPPLE_EVERY = 380; // ms between ripples from a finger held still
  const STRIKES = 3;        // lightning strikes alive at once (each lingers ~0.4s)
  const STRIKE_EVERY = 140; // ms between strikes while held
  const SEG_PER = 56;       // traced line segments per strike
  const MAXSEG = STRIKES * SEG_PER;
  const GRID_W = 96;        // storm noise is read back at this width so bolts can be traced along it
  const BOLT_LEN = 0.5;     // longest bolt, in screen heights
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
// A fractional count fades the last octave in, so detail can change smoothly across the screen.
float fbm(vec2 p, float oct){
  float v = 0., a = .5, sum = 0.;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 8; i++) {
    float w = clamp(oct - float(i), 0., 1.);
    if (w <= 0.) break;
    v += a * w * noise(p); sum += a * w; p = m * p; a *= .5;
  }
  return v / sum;
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
  // Each ring's slope joins the trail's slope as one chrome surface, so ripples shade like chrome too.
  vec2 slope = vec2(0.);
  float ring = 0.;
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
    vec2 dir = d / max(r, 1e-3);
    p += dir * sin(phase) * packet * fade * .03;
    slope += dir * cos(phase) * packet * fade * .3;
    ring = max(ring, packet * fade);
  }
  n = normalize(vec3(-hx - slope.x, -hy - slope.y, .14));
  body = max(body, smoothstep(.05, .45, ring));

  float f;
  vec3 col = field(p, 3., f);

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

    // Fine, detailed warped noise that conducts lightning. Bolts are traced in JS along the contour of
    // the noise that passes through the finger (see traceStrike) and arrive here as line segments in a
    // small float texture; each one is drawn as a thin white core in a palette-tinted glow, growing
    // out from the finger and fading.
    storm: `
uniform sampler2D uSegs;  // row 0: segment a.xy, b.xy (uv); row 1: x = strike age, y = 0..1 along its bolt, z = weight
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  float f;
  vec3 col = field(uv * asp * FIELD * 1.35, 7., f);
  vec2 p = uv * asp;
  float core = 0., glow = 0.;
  for (int i = 0; i < ${MAXSEG}; i++) {
    float u = (float(i) + .5) / ${MAXSEG}.;
    vec4 A = texture2D(uSegs, vec2(u, .25));
    vec4 B = texture2D(uSegs, vec2(u, .75));
    float a = B.x;
    if (a > .4 || B.y > smoothstep(0., .12, a)) continue;   // dead, or not grown out this far yet
    vec2 pa = p - A.xy * asp, ba = (A.zw - A.xy) * asp;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0., 1.);
    float d = length(pa - ba * h) * uRes.y;                 // distance to the segment, in pixels
    float w = B.z * (1. - smoothstep(.05, .4, a)) * (1. - B.y * .5);
    core += smoothstep(1.4, 0., d) * w;
    glow += exp(-d * .12) * w;
  }
  vec3 tint = palette(1.) * 1.2 + .08;
  col += tint * glow * .4;
  col += mix(tint, vec3(1.), .8) * min(core, 1.5);
  gl_FragColor = vec4(finish(col, .22, .025), 1.);
}`,

    // The storm noise value alone (its broad paths: three octaves), packed into two 8-bit channels,
    // for reading back to trace bolts.
    stormField: `
uniform vec2 uSize;
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  float f;
  field(uv * asp * FIELD * 1.35, 3., f);
  float v = clamp(f, 0., 1.) * 255.;
  gl_FragColor = vec4(floor(v) / 255., fract(v), 0., 1.);
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
    // looks a few steps toward the sun to shadow itself, so thick parts darken and thin edges glow
    // (a silver lining). Near the sun those steps shrink and the detail softens, so the centre is a
    // gentle blur rather than a point where every direction converges. God rays come from checking
    // how much cloud lies between each pixel and the sun. The sun sits where your finger last was.
    clouds: `
uniform vec2 uLight;   // sun position, uv
float density(vec2 q, float t, float oct){
  float f = fbm(q + vec2(t * .6, t * .1), oct);
  float g = fbm(q * 2.3 - vec2(t * .3, 0.), max(oct - 2., 1.));
  float e = noise(q * 9. + vec2(t, 0.));                       // fine erosion at the edges
  return smoothstep(.48, .62, f * .75 + g * .35 - (e - .5) * .06);
}
// Filmic tone curve (ACES approximation): rolls highlights off like a camera instead of clipping.
vec3 filmic(vec3 x){
  x *= .9;
  return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 p = uv * asp, lp = uLight * asp;
  float t = uTime;
  vec2 toL = lp - p;
  float dist = length(toL);
  float calm = smoothstep(0., .28, dist);        // 0 at the sun, 1 away from it
  float oct = mix(3., 7., calm);                 // softer, blurrier clouds near the sun
  vec2 toSun = toL / max(dist, 1e-4);

  vec3 sky = mix(palette(.45), palette(.12), uv.y);
  vec3 col = mix(sky, vec3(dot(sky, vec3(.3, .59, .11))), .3) * .8;   // a little desaturated, like a photo
  float sun = exp(-dist * dist * 7.);
  vec3 sunCol = mix(palette(1.), vec3(1., .96, .88), .55);
  col += sunCol * (sun * .7 + exp(-dist * 2.4) * .38);        // wide warm halo
  vec3 litCol = mix(palette(.85), vec3(1.), .55);
  vec3 shadowCol = mix(palette(.25), litCol, .3) * .75;
  float cover = 0.;
  for (int L = 0; L < 2; L++) {
    float fl = float(L);
    float sc = mix(2.6, 3.8, fl);
    vec2 q = p * sc + vec2(fl * 7.3, fl * 3.1);
    float tt = t * (1. + fl * .6);
    float d = density(q, tt, oct);
    if (d < .001) continue;
    float acc = 0.;
    float stepLen = sc * .035 * calm;            // shadow steps fade out at the sun
    for (int i = 1; i <= 4; i++) acc += density(q + toSun * stepLen * float(i), tt, oct);
    float lit = exp(-acc * 1.05);
    float rim = (1. - d) * lit;
    vec3 c = mix(shadowCol, litCol, lit) + palette(1.) * rim * sun * .8 + rim * .06;
    float alpha = d * mix(.85, .97, fl);
    col = mix(col, c, alpha);
    cover = max(cover, alpha);
  }

  // God rays: walk toward the sun through the front layer; open sky lets light through.
  float open = 0.;
  for (int i = 0; i < 10; i++) {
    vec2 sp = p + toL * (float(i) + .5) / 10.;
    open += 1. - density(sp * 3.8 + vec2(7.3, 3.1), t * 1.6, 3.);
  }
  open /= 10.;
  float rays = pow(open, 3.) * exp(-dist * 1.6);
  col += sunCol * rays * .4 * (1. - cover * .5);
  // the sun itself: a soft bright disc that shows through thin cloud and dims behind thick
  // the sun itself: a soft disc with a hot core, rolled off (not clipped) by the filmic curve below
  col += sunCol * (smoothstep(.09, .02, dist) * 1.8 + exp(-dist * dist * 160.) * 3.) * (1. - cover * .45);
  gl_FragColor = vec4(finish(filmic(col * 1.15), .2, .018), 1.);
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
  const lastRipple = { x: 0, y: 0, at: 0 };
  const strikes = Array.from({ length: STRIKES }, () => ({ age: 99 }));
  let strikeAt = 0;
  const segData = new Float32Array(MAXSEG * 2 * 4); // the uSegs texture's contents
  let segTex = null;   // null until made; false if this device can't sample float textures
  let grid = null;     // read-back of the storm noise: { w, h, tex, fb, buf, f }
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
        ['uRes', 'uTime', 'uWarp', 'uBright', 'uCount', 'uParam', 'uCols', 'uTouch', 'uTrail', 'uTexel', 'uRip', 'uPills', 'uLight', 'uSegs', 'uSize']);
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
    Object.assign(lastRipple, { x, y, at: performance.now() });
  }

  // ---- storm: read the noise back, trace bolts along it, hand the segments to the shader ----
  function ensureSegTex() {
    if (segTex !== null) return segTex;
    if (!gl.getExtension('OES_texture_float')) return (segTex = false);
    segTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, segTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (let i = 0; i < MAXSEG; i++) segData[(MAXSEG + i) * 4] = 99; // all dead
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MAXSEG, 2, 0, gl.RGBA, gl.FLOAT, segData);
    return segTex;
  }

  // Render the storm noise small, exactly as the storm shader computes it, and read it back.
  function readField() {
    const w = GRID_W, h = Math.max(8, Math.round(GRID_W * canvas.height / canvas.width));
    if (!grid || grid.w !== w || grid.h !== h) {
      if (grid) { gl.deleteTexture(grid.tex); gl.deleteFramebuffer(grid.fb); }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      grid = { w, h, tex, fb, buf: new Uint8Array(w * h * 4), f: new Float32Array(w * h) };
    }
    const { prog, U } = program('stormField');
    gl.bindFramebuffer(gl.FRAMEBUFFER, grid.fb);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform2f(U.uSize, w, h);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uWarp, cur.warp);
    gl.uniform1f(U.uCount, count);
    gl.uniform3fv(U.uCols, cols);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, grid.buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (let i = 0; i < w * h; i++) grid.f[i] = (grid.buf[i * 4] + grid.buf[i * 4 + 1] / 255) / 255;
  }

  // Bilinear noise value at uv.
  function fieldAt(x, y) {
    const gx = Math.min(grid.w - 1.001, Math.max(0, x * grid.w - 0.5));
    const gy = Math.min(grid.h - 1.001, Math.max(0, y * grid.h - 0.5));
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const i = iy * grid.w + ix, F = grid.f;
    return (F[i] * (1 - fx) + F[i + 1] * fx) * (1 - fy) + (F[i + grid.w] * (1 - fx) + F[i + grid.w + 1] * fx) * fy;
  }

  // Bolts walk along the contour of the noise through the finger: each step goes along the contour,
  // nudges back onto it, and adds a little crackle; branches peel off onto neighbouring contours.
  // Each walked line is then smoothed (Chaikin corner cutting) so it flows instead of zig-zagging.
  function traceStrike(x0, y0, slot) {
    readField();
    const asp = canvas.width / canvas.height;
    const step = 0.016;
    const grad = (x, y) => {
      const ex = 1 / grid.w, ey = 1 / grid.h;
      return [(fieldAt(x + ex, y) - fieldAt(x - ex, y)) / (2 * ex * asp), (fieldAt(x, y + ey) - fieldAt(x, y - ey)) / (2 * ey)];
    };
    const arms = []; // { pts: [[x, y], …], t0: distance from the finger where it starts, weight }
    const walk = (x, y, sign, steps, level, weight, t0, branch) => {
      const pts = [[x, y]];
      let travelled = t0;
      for (let k = 0; k < steps; k++) {
        const [gx, gy] = grad(x, y);
        const g = Math.hypot(gx, gy);
        let nx = 0, ny = 0, tx, ty, pull = 0;
        if (g < 1e-4) { const a = Math.random() * 6.2832; tx = Math.cos(a); ty = Math.sin(a); }
        else {
          nx = gx / g; ny = gy / g; tx = -ny * sign; ty = nx * sign;
          pull = Math.max(-0.01, Math.min(0.01, (level - fieldAt(x, y)) / g));
        }
        const off = pull + (Math.random() - 0.5) * 0.007;
        x = (x * asp + tx * step + nx * off) / asp;
        y = y + ty * step + ny * off;
        pts.push([x, y]);
        travelled += step;
        if (x < 0 || x > 1 || y < 0 || y > 1 || travelled > BOLT_LEN) break;
        if (!branch && Math.random() < 0.1) {
          walk(x, y, Math.random() < 0.5 ? sign : -sign, 8, level + (Math.random() - 0.5) * 0.08, weight * 0.6, travelled, true);
        }
      }
      arms.push({ pts, t0, weight });
    };
    const chaikin = (pts) => {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
      }
      out.push(pts[pts.length - 1]);
      return out;
    };

    const level = fieldAt(x0, y0);
    const [gx, gy] = grad(x0, y0);
    let sign = Math.random() < 0.5 ? 1 : -1;
    if (drag.amount > 0.3) sign = (-gy * drag.x + gx * drag.y) >= 0 ? 1 : -1; // main arm heads the way you drag
    walk(x0, y0, sign, 18, level, 1, 0, false);
    walk(x0, y0, -sign, 8, level, 0.8, 0, false);

    // Strongest arms first, so the segment budget never cuts the main bolt.
    const segs = [];
    arms.sort((a, b) => b.weight - a.weight);
    for (const arm of arms) {
      const pts = chaikin(arm.pts);
      let len = arm.t0;
      for (let i = 0; i < pts.length - 1 && segs.length < SEG_PER; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        segs.push([ax, ay, bx, by, Math.min(1, len / BOLT_LEN), arm.weight]);
        len += Math.hypot((bx - ax) * asp, by - ay);
      }
    }
    for (let j = 0; j < SEG_PER; j++) {
      const i = slot * SEG_PER + j, sg = segs[j];
      if (sg) {
        segData.set(sg.slice(0, 4), i * 4);
        segData.set([0, sg[4], sg[5], 0], (MAXSEG + i) * 4);
      } else {
        segData[(MAXSEG + i) * 4] = 99;
      }
    }
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
    resize();
    const storm = style.prog === 'storm' && ensureSegTex();
    if (storm && touch.down && now - strikeAt > STRIKE_EVERY) {
      strikeAt = now;
      const slot = strikes.indexOf(oldest(strikes));
      strikes[slot].age = 0;
      traceStrike(touch.x, touch.y, slot);
    }
    strikes.forEach((k, slot) => {
      k.age = Math.min(99, k.age + dt);
      for (let j = 0; j < SEG_PER; j++) {
        const i = (MAXSEG + slot * SEG_PER + j) * 4;
        if (segData[i] < 99) segData[i] = k.age;
      }
    });
    if (style.prog === 'liquid' && touch.down && now - lastRipple.at > RIPPLE_EVERY) dropRipple(touch.x, touch.y);
    const rip = new Float32Array(RIPPLES * 3);
    ripples.forEach((r, i) => { r.age = Math.min(99, r.age + dt); rip.set([r.x, r.y, r.age], i * 3); });
    const pil = new Float32Array(SPAWNS * 4);
    spawned.forEach((q, i) => { q.age = Math.min(99, q.age + dt); pil.set([q.x, q.y, q.age, q.seed], i * 4); });
    if (touch.down) {
      const k = Math.min(1, dt * 4);
      light.x += (touch.x - light.x) * k;
      light.y += (touch.y - light.y) * k;
    }

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
    gl.uniform4fv(U.uPills, pil);
    gl.uniform2f(U.uLight, light.x, light.y);
    if (storm) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, segTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAXSEG, 2, gl.RGBA, gl.FLOAT, segData);
      gl.uniform1i(U.uSegs, 0);
    }
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
