// Visual: full-screen WebGL shaders fed by a palette, played by touch.
// Each style is its own fragment shader sharing a common header, and each answers touch its own way:
//   liquid — your finger draws a liquid-chrome trail (a feedback buffer) that refracts the colours
//            underneath and melts away
//            (and pushes a simulated water surface, so chrome waves spread out from the stroke)
//   storm  — holding a finger down sends lightning along the noise's own paths (traced on the CPU
//            from a small read-back of the noise, then drawn as glowing segments)
//   clouds — soft volumetric clouds; your finger moves the sun that lights them
//   vapour — glowing pieces of dry ice sublimating into fibrous vapour (a feedback buffer advected
//            by swirling flow); tap to drop a piece, drag to carry it and stream its vapour
const Visual = (() => {
  const FIELD = 2.2; // noise field units across the screen height
  const MAX_COLS = 6;
  const TRAIL_SCALE = 0.5; // trail buffer resolution relative to the canvas
  const BRUSH = 0.038;     // trail thickness, in screen heights
  const STRIKES = 3;        // lightning strikes alive at once (each lingers ~0.4s)
  const STRIKE_EVERY = 140; // ms between strikes while held
  const SEG_PER = 56;       // traced line segments per strike
  const MAXSEG = STRIKES * SEG_PER;
  const GRID_W = 96;        // storm noise is read back at this width so bolts can be traced along it
  const BOLT_LEN = 0.5;     // longest bolt, in screen heights
  const SOURCES = 6;        // vapour: 2 drifting ice pieces + up to 4 you drop
  const VAPOUR_SCALE = 0.8; // vapour buffer resolution relative to the canvas (higher = finer fibres)
  const ICE_LIFE = 12;      // seconds a dropped piece takes to sublimate away
  const VAPOUR_LIFE = 2.5;  // seconds a wisp of vapour lives before it's gone

  const STYLES = {
    liquid: { prog: 'liquid', speed: 0.3, warp: 2.6, bright: 1.0 },
    storm: { prog: 'storm', speed: 0.85, warp: 4.6, bright: 1.0 },
    clouds: { prog: 'clouds', speed: 0.12, warp: 0, bright: 1.0 },
    vapour: { prog: 'vapour', speed: 1, warp: 0, bright: 1.0 },
  };

  const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

  // Feedback pass: last frame's trail, softly blurred and faded, plus a capsule stamped along the
  // finger's path since the previous frame (so fast strokes stay continuous).
  const TRAIL = `
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uSize, uTexel, uA, uB;
uniform float uOn, uR, uDecay, uPress;
// R = chrome trail. G, B = water height now and one step ago (stored as h*.5+.5): a classic
// two-buffer ripple simulation, so waves spread out from wherever the stroke pushes the water.
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 c = texture2D(uPrev, uv);
  float v = c.r;
  float h = c.g * 2. - 1., hp = c.b * 2. - 1.;
  // uDecay: 0 = stamping pass (only adds), 1 = the frame's main step, 2 = an extra water-only step.
  if (uDecay > .5) {
    float n = texture2D(uPrev, uv + vec2(uTexel.x, 0.)).g + texture2D(uPrev, uv - vec2(uTexel.x, 0.)).g
            + texture2D(uPrev, uv + vec2(0., uTexel.y)).g + texture2D(uPrev, uv - vec2(0., uTexel.y)).g;
    float hn = ((n * 2. - 4.) * .5 - hp) * .99;    // neighbours' average x2, minus last step, damped
    hp = h;
    h = hn;
  }
  if (uDecay > .5 && uDecay < 1.5) {
    v = v * .4
      + (texture2D(uPrev, uv + vec2(uTexel.x, 0.)).r + texture2D(uPrev, uv - vec2(uTexel.x, 0.)).r
       + texture2D(uPrev, uv + vec2(0., uTexel.y)).r + texture2D(uPrev, uv - vec2(0., uTexel.y)).r) * .15;
    v = max(v * .985 - .0025, 0.);   // the subtraction makes sure 8-bit values reach zero
  }
  vec2 asp = vec2(uSize.x / uSize.y, 1.);
  vec2 p = uv * asp, a = uA * asp, b = uB * asp;
  vec2 pa = p - a, ba = b - a;
  float k = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0., 1.);
  float d = length(pa - ba * k);
  float stamp = uOn * smoothstep(uR, uR * .3, d);
  v = max(v, stamp);
  h = mix(h, uPress, stamp);                      // the stroke pushes the water in a pulse
  gl_FragColor = vec4(v, clamp(h * .5 + .5, 0., 1.), clamp(hp * .5 + .5, 0., 1.), 1.);
}`;

  const COMMON = `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uWarp, uBright, uCount;
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
    // The trail buffer also holds a water surface the stroke pushes, so waves spread from its shape.
    liquid: `
uniform sampler2D uTrail;
uniform vec2 uTexel;
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
  // The water surface's slope joins the trail's slope as one chrome surface, so waves shade like chrome.
  vec2 w = uTexel * 1.5;
  vec2 slope = vec2(texture2D(uTrail, uv + vec2(w.x, 0.)).g - texture2D(uTrail, uv - vec2(w.x, 0.)).g,
                    texture2D(uTrail, uv + vec2(0., w.y)).g - texture2D(uTrail, uv - vec2(0., w.y)).g) * 7.;
  p += slope * .25;
  n = normalize(vec3(-hx - slope.x, -hy - slope.y, .14));
  body = max(body, smoothstep(.04, .35, length(slope)));

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
  float sun = exp(-dist * dist * 16.);
  vec3 sunCol = mix(palette(1.), vec3(1., .96, .88), .55);
  col += sunCol * (sun * .6 + exp(-dist * 3.6) * .3);         // warm halo
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
  // 24 samples, each pixel starting at a random offset so leftover stepping becomes fine grain.
  float open = 0.;
  float jitter = hash(gl_FragCoord.xy + fract(t) * 37.);
  for (int i = 0; i < 24; i++) {
    vec2 sp = p + toL * (float(i) + jitter) / 24.;
    open += 1. - density(sp * 3.8 + vec2(7.3, 3.1), t * 1.6, 3.);
  }
  open /= 24.;
  float rays = pow(open, 3.) * exp(-dist * 1.6);
  col += sunCol * rays * .4 * (1. - cover * .5);
  // the sun itself: a soft bright disc that shows through thin cloud and dims behind thick
  // the sun itself: a soft disc with a hot core, rolled off (not clipped) by the filmic curve below
  col += sunCol * (smoothstep(.045, .012, dist) * 1.8 + exp(-dist * dist * 450.) * 3.) * (1. - cover * .45);
  gl_FragColor = vec4(finish(filmic(col * 1.15), .2, .018), 1.);
}`,

    // Glowing hearts sublimating on black, like dry ice. The vapour lives in a feedback buffer
    // (vapourStep); here it's coloured like heat through the palette, dark -> colours -> white-hot,
    // and each piece is a white-hot heart with a glow.
    vapour: `
uniform sampler2D uVap;
uniform vec4 uSrc[${SOURCES}];   // xy = uv, z = strength 0..1, w = seed
// Signed distance to a heart (point at the origin, lobes up to y ~ 1); negative inside.
float heart(vec2 p){
  p.x = abs(p.x);
  if (p.y + p.x > 1.) return length(p - vec2(.25, .75)) - .35355;
  vec2 a = p - vec2(0., 1.), b = p - .5 * max(p.x + p.y, 0.);
  return sqrt(min(dot(a, a), dot(b, b))) * sign(p.x - p.y);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 p = uv * asp;
  vec4 V = texture2D(uVap, uv);
  float v = V.r * pow(max(1. - V.g, 0.), 1.4);   // born bright, fades as it ages
  v = v / (1. + v * .35);                       // soften where plumes pile up
  vec3 c1 = palette(.3) * .5, c2 = palette(.7), c3 = mix(palette(1.), vec3(1.), .5);
  vec3 col = mix(vec3(.006), c1, smoothstep(.05, .35, v));   // faint vapour stays dark
  col = mix(col, c2, smoothstep(.28, .7, v));
  col = mix(col, c3, smoothstep(.75, 1., v));
  for (int i = 0; i < ${SOURCES}; i++) {
    vec4 S = uSrc[i];
    if (S.z <= 0.) continue;
    vec2 d = p - S.xy * asp;
    float r = length(d);
    // each piece is a little white-hot heart, rocking gently
    float size = .03 * (.55 + .45 * S.z);
    float a = .25 * sin(uTime * 1.3 + S.w);
    vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * d / size + vec2(0., .5);
    float edge = 1.5 / (size * uRes.y);
    col = mix(col, vec3(1.), smoothstep(edge, -edge, heart(q)));
    col += c3 * exp(-r * 45.) * .6 * S.z;
  }
  gl_FragColor = vec4(finish(col, .25, .02), 1.);
}`,

    // One step of the vapour simulation: carry last frame's vapour along a swirling flow (curl noise,
    // a gentle rise, and a push outward from each piece), fade it, and emit new fibres around each
    // piece. Fibres are angular noise around the core, so they stream out as hair-like strands.
    vapourStep: `
uniform sampler2D uPrev;
uniform vec2 uSize;
uniform float uDt;
uniform vec4 uSrc[${SOURCES}];
vec2 curl(vec2 p){
  float e = .05;
  float a = fbm(p + vec2(0., e), 3.), b = fbm(p - vec2(0., e), 3.);
  float c = fbm(p + vec2(e, 0.), 3.), d = fbm(p - vec2(e, 0.), 3.);
  return vec2(a - b, -(c - d)) / (2. * e);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 asp = vec2(uSize.x / uSize.y, 1.);
  vec2 p = uv * asp;
  vec2 vel = curl(p * 1.6 + vec2(0., uTime * .12)) * .26 + vec2(0., .1);   // broad, sweeping currents
  float em = 0.;
  for (int i = 0; i < ${SOURCES}; i++) {
    vec4 S = uSrc[i];
    if (S.z <= 0.) continue;
    vec2 d = p - S.xy * asp;
    float r = length(d) + 1e-4;
    vel += d / r * .5 * S.z * exp(-r * 5.);
    float ang = atan(d.y, d.x);
    float fib = noise(vec2(ang * 38. + S.w, uTime * 2. + S.w)) * noise(vec2(ang * 11. - S.w, uTime * .7));
    em += exp(-r * 34.) * (.04 + pow(fib, 2.) * 5.) * S.z;
  }
  // Vapour has a lifecycle: R = density, G = age (0 newborn .. 1 dead). It's carried by the flow,
  // ages every frame, and is gone at age 1, so only the last few seconds of vapour ever exist and
  // the frame can't fill up. New vapour born at the ice resets the age where it lands.
  vec2 back = uv - vel / asp * uDt;
  vec4 prev = texture2D(uPrev, back);
  float d = prev.r, age = prev.g;
  float born = em * uDt * 3.;
  born *= step(.0015, born);   // faint traces far from the ice don't count as births (or nothing would ever die)
  age = mix(age, 0., born / max(d + born, 1e-4));
  d = min(d + born, 1.);
  age += uDt / ${VAPOUR_LIFE.toFixed(2)};
  if (age >= 1.) d = 0.;
  // 8-bit storage: dither so slow ageing still advances on average instead of rounding away.
  float dz = (hash(gl_FragCoord.xy + fract(uTime * 7.3) * 113.) - .5) / 255.;
  gl_FragColor = vec4(clamp(d + dz, 0., 1.), clamp(age + dz, 0., 1.), 0., 1.);
}`,
  };

  let canvas, gl;
  const programs = {};
  let trailProg = null;
  let trail = null; // { w, h, tex: [a, b], fb: [a, b], read: 0 }
  let vapour = null, vapourProg = null;
  let clock = 0;    // real seconds since start (vapour's flow shouldn't depend on style speed)
  const ice = Array.from({ length: SOURCES }, (_, i) =>
    ({ auto: i < 2, x: 0.5, y: 0.5, age: 99, seed: Math.random() * 50, held: false }));
  let running = false, raf = 0, last = 0, time = 0;
  let cols = new Float32Array(MAX_COLS * 3), count = 2;
  let style = STYLES.liquid;
  const cur = { speed: style.speed, warp: style.warp, bright: style.bright };
  const touch = { x: 0.5, y: 0.5, z: 0, down: 0, id: null };
  const path = []; // finger points not yet stamped into the trail (capped so a stall can't pile up)
  const strikes = Array.from({ length: STRIKES }, () => ({ age: 99 }));
  let strikeAt = 0;
  const segData = new Float32Array(MAXSEG * 2 * 4); // the uSegs texture's contents
  let segTex = null;   // null until made; false if this device can't sample float textures
  let grid = null;     // read-back of the storm noise: { w, h, tex, fb, buf, f }
  const drag = { x: 1, y: 0, amount: 0 }; // recent drag direction, and how much you're moving
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
        ['uRes', 'uTime', 'uWarp', 'uBright', 'uCount', 'uCols', 'uTouch', 'uTrail', 'uTexel', 'uLight', 'uSegs', 'uSize', 'uVap', 'uSrc']);
    }
    return programs[name];
  }

  // Two textures to ping-pong between (read last frame's, write this frame's), sized to the canvas.
  // Returns buf unchanged if it still fits, otherwise a fresh cleared pair.
  // precise: use half-float storage when the device can render to it (smooth, low waves survive),
  // falling back to 8-bit otherwise.
  function pingPong(buf, scale, clear = [0, 0, 0, 1], precise = false) {
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    if (buf && buf.w === w && buf.h === h) return buf;
    if (buf) {
      buf.tex.forEach((t) => gl.deleteTexture(t));
      buf.fb.forEach((f) => gl.deleteFramebuffer(f));
    }
    const type = precise ? halfFloatType() : gl.UNSIGNED_BYTE;
    const out = { w, h, tex: [], fb: [], read: 0 };
    for (let i = 0; i < 2; i++) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (type !== gl.UNSIGNED_BYTE && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        halfFloat = 0; // can't render to it here after all: start over in 8-bit
        out.tex.push(tex); out.fb.push(fb);
        out.tex.forEach((t) => gl.deleteTexture(t));
        out.fb.forEach((f) => gl.deleteFramebuffer(f));
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return pingPong(null, scale, clear, false);
      }
      gl.clearColor(...clear);
      gl.clear(gl.COLOR_BUFFER_BIT);
      out.tex.push(tex);
      out.fb.push(fb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  let halfFloat = null; // null = not checked yet, 0 = unavailable, else the HALF_FLOAT_OES type
  function halfFloatType() {
    if (halfFloat === null) {
      const ext = gl.getExtension('OES_texture_half_float');
      const linear = gl.getExtension('OES_texture_half_float_linear');
      gl.getExtension('EXT_color_buffer_half_float');
      halfFloat = ext && linear ? ext.HALF_FLOAT_OES : 0;
    }
    return halfFloat || gl.UNSIGNED_BYTE;
  }

  // ---- vapour ----
  function stepVapour(dt, src) {
    vapour = pingPong(vapour, VAPOUR_SCALE);
    if (!vapourProg) vapourProg = link(COMMON + BODIES.vapourStep, ['uPrev', 'uSize', 'uDt', 'uSrc', 'uTime']);
    const { prog, U } = vapourProg;
    const write = 1 - vapour.read;
    gl.bindFramebuffer(gl.FRAMEBUFFER, vapour.fb[write]);
    gl.viewport(0, 0, vapour.w, vapour.h);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, vapour.tex[vapour.read]);
    gl.uniform1i(U.uPrev, 0);
    gl.uniform2f(U.uSize, vapour.w, vapour.h);
    gl.uniform1f(U.uDt, dt);
    gl.uniform1f(U.uTime, clock);
    gl.uniform4fv(U.uSrc, src);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    vapour.read = write;
  }

  // Two pieces wander on their own; the rest are dropped by your finger and sublimate away.
  function iceSources() {
    const src = new Float32Array(SOURCES * 4);
    ice.forEach((k, i) => {
      if (k.auto) {
        const t = clock * 0.08;
        k.x = 0.5 + 0.3 * Math.sin(t * (1 + i * 0.37) + k.seed);
        k.y = 0.45 + 0.3 * Math.cos(t * (0.8 + i * 0.29) + k.seed * 1.7);
        src.set([k.x, k.y, 0.9, k.seed], i * 4);
      } else {
        const life = k.age >= ICE_LIFE ? 0 : 1 - Math.max(0, (k.age - ICE_LIFE * 0.6) / (ICE_LIFE * 0.4));
        src.set([k.x, k.y, life, k.seed], i * 4);
      }
    });
    return src;
  }

  // One feedback pass: step (decay 1 = full frame step, 2 = water only) and stamp a→b (if on).
  function trailPass(a, b, on, decay) {
    const write = 1 - trail.read;
    const { U } = trailProg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, trail.fb[write]);
    gl.bindTexture(gl.TEXTURE_2D, trail.tex[trail.read]);
    gl.uniform2f(U.uA, a[0], a[1]);
    gl.uniform2f(U.uB, b[0], b[1]);
    gl.uniform1f(U.uOn, on ? 1 : 0);
    gl.uniform1f(U.uDecay, decay);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    trail.read = write;
  }

  // Fade once, then stamp every segment the finger travelled since the last frame (so curves stay
  // curves even when frames are slower than pointer events).
  function stepTrail() {
    trail = pingPong(trail, TRAIL_SCALE, [0, 0.5, 0.5, 1], true); // water starts at rest
    const { prog, U } = trailProg;
    gl.viewport(0, 0, trail.w, trail.h);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(U.uPrev, 0);
    gl.uniform2f(U.uSize, trail.w, trail.h);
    gl.uniform2f(U.uTexel, 1 / trail.w, 1 / trail.h);
    gl.uniform1f(U.uR, BRUSH);
    gl.uniform1f(U.uPress, 0.9 * Math.sin(clock * 9)); // a pulse, so a held finger keeps making waves
    const pts = path.splice(0);
    trailPass([0, 0], [0, 0], false, 1);
    trailPass([0, 0], [0, 0], false, 2); // a second water step: waves travel twice as far
    if (pts.length === 1 && touch.down) trailPass(pts[0], pts[0], true, 0);
    for (let i = 1; i < pts.length; i++) trailPass(pts[i - 1], pts[i], true, 0);
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
      trailProg = link(TRAIL, ['uPrev', 'uSize', 'uTexel', 'uA', 'uB', 'uOn', 'uR', 'uDecay', 'uPress']);
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

  function bindPointers() {
    canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = toUV(e);
      Object.assign(touch, { x, y, id: e.pointerId });
      touch.down++;
      path.length = 0;
      path.push([x, y], [x, y]); // a dot even if the finger never moves
      if (style.prog === 'vapour') {
        const k = oldest(ice.filter((q) => !q.auto));
        Object.assign(k, { x, y, age: 0, seed: Math.random() * 50, held: true });
      }
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!touch.down || e.pointerId !== touch.id) return;
      const [x, y] = toUV(e);
      const dx = (x - touch.x) * canvas.width / canvas.height, dy = y - touch.y, len = Math.hypot(dx, dy);
      if (len > 0.002) {
        drag.x += (dx / len - drag.x) * 0.3;
        drag.y += (dy / len - drag.y) * 0.3;
        drag.amount = Math.min(1.5, drag.amount + len * 25);
      }
      Object.assign(touch, { x, y });
      ice.forEach((k) => { if (k.held) Object.assign(k, { x, y }); });
      if (path.length < 48) path.push([x, y]);
    });
    const lift = (e) => {
      if (!touch.down) return;
      touch.down = Math.max(0, touch.down - 1);
      if (e.pointerId === touch.id) touch.id = null;
      ice.forEach((k) => { k.held = false; });
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
    if (touch.down) {
      const k = Math.min(1, dt * 4);
      light.x += (touch.x - light.x) * k;
      light.y += (touch.y - light.y) * k;
    }

    clock += dt;
    ice.forEach((k) => { if (!k.auto) k.age = Math.min(99, k.age + dt); });
    const liquid = style.prog === 'liquid';
    if (liquid) stepTrail();
    const vap = style.prog === 'vapour';
    const src = vap ? iceSources() : null;
    if (vap) stepVapour(dt, src);

    const { prog, U } = program(style.prog);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uWarp, cur.warp);
    gl.uniform1f(U.uBright, cur.bright);
    gl.uniform1f(U.uCount, count);
    gl.uniform3fv(U.uCols, cols);
    gl.uniform3f(U.uTouch, touch.x, touch.y, touch.z);
    gl.uniform2f(U.uLight, light.x, light.y);
    if (vap) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, vapour.tex[vapour.read]);
      gl.uniform1i(U.uVap, 0);
      gl.uniform4fv(U.uSrc, src);
    }
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
