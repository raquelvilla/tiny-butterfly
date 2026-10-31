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
//   fluid  — a tribute to The Coding Train's fluid simulation: stir dye in your palette (fluid.js)
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
  const VAPOUR_SCALE = 1.0; // vapour buffer resolution relative to the canvas (higher = finer fibres)
  const ICE_LIFE = 12;      // seconds a dropped piece takes to sublimate away
  const VAPOUR_LIFE = 4.6;  // seconds a wisp of vapour lives before it's gone
  const HUE_SPEED = 0.08;   // vapour: how many times a second each heart goes all the way round the palette
  const WIPE = 0.06;        // mist: how wide your finger wipes the glass, in screen heights

  const STYLES = {
    liquid: { prog: 'liquid', speed: 0.3, warp: 2.6, bright: 1.0 },
    storm: { prog: 'storm', speed: 0.7, warp: 3.4, bright: 1.0 },
    clouds: { prog: 'clouds', speed: 0.12, warp: 0, bright: 1.0 },
    vapour: { prog: 'vapour', speed: 1, warp: 0, bright: 1.0 },
    threads: { prog: 'threads', speed: 1, warp: 0, bright: 1.0 },
    candles: { prog: 'candles', speed: 1, warp: 0, bright: 1.0 },
    mist: { prog: 'mist', speed: 1, warp: 0, bright: 1.0 },
    fluid: { prog: 'fluid', speed: 1, warp: 0, bright: 1.0 },
  };

  const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

  // Feedback pass: last frame's trail, softly blurred and faded, plus a capsule stamped along the
  // finger's path since the previous frame (so fast strokes stay continuous).
  const TRAIL = `
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uSize, uTexel, uA, uB;
uniform float uOn, uR, uDecay, uPress;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
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
    hn = mix(hn, (n * 2. - 4.) * .25, .05);         // a little viscosity: wavefronts stay soft and rounded
    hp = h;
    h = hn;
  }
  if (uDecay > .5 && uDecay < 1.5) {
    // Spread: each frame the trail diffuses a little into its surroundings (like ink in water), so
    // older parts of a stroke are wider and softer than where your finger just was. A blur on a
    // circle grows round, soft-edged shapes; keeping the brighter of it and the old value lets the
    // trail widen without just dimming.
    float blur = v * .2;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * .7854 + .39;
      blur += texture2D(uPrev, uv + vec2(cos(a), sin(a)) * uTexel * 2.4).r * .1;
    }
    v = max(v * .97, blur * 1.009);
    v = max(v * .99 - .002, 0.);     // the subtraction makes sure 8-bit values reach zero
  }
  vec2 asp = vec2(uSize.x / uSize.y, 1.);
  vec2 p = uv * asp, a = uA * asp, b = uB * asp;
  vec2 pa = p - a, ba = b - a;
  float k = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0., 1.);
  float d = length(pa - ba * k);
  // a soft dome with an uneven, wavering edge, so the stroke looks poured rather than drawn with a tube
  float wob = noise(p * 38.) * .65 + noise(p * 90.) * .35;
  d *= .75 + .5 * wob;
  float stamp = uOn * exp(-d * d / (uR * uR) * 3.);
  v = max(v, stamp);
  h = mix(h, uPress, stamp);                      // the stroke pushes the water in a pulse
  gl_FragColor = vec4(v, clamp(h * .5 + .5, 0., 1.), clamp(hp * .5 + .5, 0., 1.), 1.);
}`;

  // Mist's fogged glass. R = how fogged (1 = fully): it slowly fogs back up, the finger wipes it clear.
  // G = water the finger pushed aside: it gathers in a ridge along the edges of each stroke and slowly
  // evaporates. B is unused.
  // A = how wet the glass is: wiping dries it, so no drops sit or slide there until it slowly re-wets.
  const FOG = `
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uSize, uTexel, uA, uB;
uniform float uOn, uR, uDt;
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 c = texture2D(uPrev, uv);
  float v = c.r, g = c.g, b = c.b, w = c.a;
  if (uOn < .5) {
    // soften the edges of a wipe a little, then fog back over in ~7s
    float n = texture2D(uPrev, uv + vec2(uTexel.x, 0.)).r + texture2D(uPrev, uv - vec2(uTexel.x, 0.)).r
            + texture2D(uPrev, uv + vec2(0., uTexel.y)).r + texture2D(uPrev, uv - vec2(0., uTexel.y)).r;
    v = mix(v, n * .25, .25);
    v = min(1., v + uDt * .14);
    g = max(g - uDt * .05, 0.);                   // the ridge slowly evaporates
    w = min(1., w + uDt * .05);                   // the glass re-wets over ~20s
  }
  vec2 asp = vec2(uSize.x / uSize.y, 1.);
  vec2 p = uv * asp, a = uA * asp, bb = uB * asp, pa = p - a, ba = bb - a;
  float d = length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0., 1.));
  float wipe = uOn * smoothstep(uR, uR * .35, d);
  float ridge = uOn * smoothstep(uR * .7, uR * 1.05, d) * smoothstep(uR * 1.6, uR * 1.1, d);
  v = min(v, 1. - wipe);
  g = max(g * (1. - wipe), ridge);                // water is swept out of the stroke onto its edges
  b = 0.;
  w = min(w, 1. - wipe);
  gl_FragColor = vec4(v, g, b, w);
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
  // slope from two scales averaged, so the surface reads as one soft rounded body
  vec2 o = uTexel * 4., O = uTexel * 10.;
  float hx = (trail(uv + vec2(o.x, 0.)) - trail(uv - vec2(o.x, 0.))
            + (trail(uv + vec2(O.x, 0.)) - trail(uv - vec2(O.x, 0.))) * .6) * .6;
  float hy = (trail(uv + vec2(0., o.y)) - trail(uv - vec2(0., o.y))
            + (trail(uv + vec2(0., O.y)) - trail(uv - vec2(0., O.y))) * .6) * .6;
  vec3 n = normalize(vec3(-hx, -hy, .3));
  float body = smoothstep(.0, .45, h);

  // Smooth: three octaves at a broader scale.
  vec2 p = uv * asp * FIELD * .75 + n.xy * .6 * body;

  // Ripples: a packet of concentric crests travels outward and fades, bending the colour slightly
  // and catching light on each crest so it reads as a ring.
  // The water surface's slope joins the trail's slope as one chrome surface, so waves shade like chrome.
  // slope taken over a wide span at two scales, so the rings read as soft swells, not drawn lines
  vec2 w = uTexel * 3., W2 = uTexel * 6.;
  vec2 slope = (vec2(texture2D(uTrail, uv + vec2(w.x, 0.)).g - texture2D(uTrail, uv - vec2(w.x, 0.)).g,
                     texture2D(uTrail, uv + vec2(0., w.y)).g - texture2D(uTrail, uv - vec2(0., w.y)).g)
              + vec2(texture2D(uTrail, uv + vec2(W2.x, 0.)).g - texture2D(uTrail, uv - vec2(W2.x, 0.)).g,
                     texture2D(uTrail, uv + vec2(0., W2.y)).g - texture2D(uTrail, uv - vec2(0., W2.y)).g) * .5) * 3.6;
  p += slope * .25;
  n = normalize(vec3(-hx - slope.x, -hy - slope.y, .3));
  body = max(body, smoothstep(.05, .6, length(slope)) * .8);

  float f;
  vec3 col = field(p, 3., f);

  vec3 L = normalize(vec3(-.45, .6, .65));
  float diff = clamp(dot(n, L), 0., 1.);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0., 0., 1.)), 0., 1.), 14.);
  float rim = pow(1. - n.z, 2.);
  vec3 env = palette(.5 + .5 * n.y);                     // the chrome reflects the palette
  vec3 glass = col * (.6 + .55 * diff) + env * rim * .35;
  glass = mix(glass, glass * .55, rim * .5);              // a gentle shade toward the edges, no outline
  glass += spec * .4;
  col = mix(col, glass, body);
  gl_FragColor = vec4(finish(col, .18, .03), 1.);
}`,

    // Smooth, silky warped noise that conducts lightning. Bolts are traced in JS along the contour of
    // the noise that passes through the finger (see traceStrike) and arrive here as line segments in a
    // small float texture; each one is drawn as a thin white core in a palette-tinted glow, growing
    // out from the finger and fading.
    storm: `
uniform sampler2D uSegs;  // row 0: segment a.xy, b.xy (uv); row 1: x = strike age, y = 0..1 along its bolt, z = weight
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  float f;
  vec3 col = field(uv * asp * FIELD * 1.35, 4., f);   // few octaves: smooth, silky noise
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
// Cellular (Worley) noise: distance to the nearest of a grid of slowly churning points.
float worley(vec2 p, float t){
  vec2 i = floor(p), f = fract(p);
  float d = 1.5;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash(i + g), hash(i + g + 17.3));
      o = .5 + .4 * sin(t * .5 + 6.2832 * o);
      d = min(d, length(g + o - f));
    }
  return d;
}
// Photographic cloud density with some cumulus "cauliflower" mixed in: inverted cellular noise
// rounds the edges into billowing lumps. puffy = 0 swaps the billows for their average (cheap, for
// the many god-ray samples). PUFF keeps the last billow value so puffs can catch a little light.
float PUFF;
float density(vec2 q, float t, float oct, float puffy){
  vec2 m = q + vec2(t * .6, t * .1);
  float f = fbm(m, oct);
  float g = fbm(q * 2.3 - vec2(t * .3, 0.), max(oct - 2., 1.));
  float e = noise(q * 9. + vec2(t, 0.));                       // fine erosion at the edges
  float b = .56;
  if (puffy > .5) b = (1. - worley(m * 1.4, t)) * .65 + (1. - worley(m * 3.1 + 3.7, t)) * .35;
  PUFF = b;
  return smoothstep(.555, .695, f * .7 + g * .22 + b * .3 - (e - .5) * .06);
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
    float d = density(q, tt, oct, 1.);
    if (d < .001) continue;
    float pf = PUFF;
    float acc = 0.;
    float stepLen = sc * .035 * calm;            // shadow steps fade out at the sun
    for (int i = 1; i <= 4; i++) acc += density(q + toSun * stepLen * float(i), tt, oct, 1.);
    float lit = exp(-acc * 1.05);
    float rim = (1. - d) * lit;
    vec3 c = mix(shadowCol, litCol, lit) * (.9 + .22 * smoothstep(.4, .85, pf))   // puffs catch the light
           + palette(1.) * rim * sun * .8 + rim * .06;
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
    open += 1. - density(sp * 3.8 + vec2(7.3, 3.1), t * 1.6, 3., 0.);
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
    // (vapourStep), which also remembers which palette colour each strand was born with (B), so every
    // colour streams out as its own fibres, brightening toward white-hot where the vapour is densest.
    // Each piece is a white-hot heart with a glow.
    vapour: `
uniform sampler2D uVap;
uniform vec4 uSrc[${SOURCES}];   // xy = uv, z = strength 0..1, w = seed
// Signed distance to a heart (point at the origin, lobes up to y ~ 1); negative inside.
vec3 colAt(float k){   // palette colour k (no dynamic indexing in WebGL 1)
  vec3 c = uCols[0];
  for (int j = 1; j < ${MAX_COLS}; j++) if (float(j) == k) c = uCols[j];
  return c;
}
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
  // The colour this vapour was born with: B goes round the palette (0..1 = first colour .. back to it),
  // eased toward each palette colour so each one reads.
  float hx = V.b * uCount, hk = floor(hx), hf = smoothstep(.15, .85, fract(hx));
  vec3 pc = mix(colAt(mod(hk, uCount)), colAt(mod(hk + 1., uCount)), hf);
  vec3 c3 = mix(palette(1.), vec3(1.), .5);
  vec3 col = mix(vec3(.006), pc * .5, smoothstep(.07, .4, v)); // faint vapour stays dark, so strands read
  col = mix(col, pc, smoothstep(.28, .7, v));
  col = mix(col, mix(pc, vec3(1.), .45), smoothstep(.8, 1., v));
  for (int i = 0; i < ${SOURCES}; i++) {
    vec4 S = uSrc[i];
    if (S.z <= 0.) continue;
    vec2 d = p - S.xy * asp;
    float r = length(d);
    // each piece is a little white-hot heart, rocking gently
    float size = .018 * (.55 + .45 * S.z);
    float a = .25 * sin(uTime * 1.3 + S.w);
    vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * d / size + vec2(0., .5);
    float edge = 1.5 / (size * uRes.y);
    col = mix(col, vec3(1.), smoothstep(edge, -edge, heart(q)));
    col += c3 * exp(-r * 45.) * .6 * S.z;
  }
  gl_FragColor = vec4(finish(col, .25, .02), 1.);
}`,

    // Fire from the heat candles.js painted (uTrail: R = heat, G = smoke). Rising turbulence makes the
    // heat lick upward in ragged tongues; the palette, dark to light, colours it like a fire ramp, so
    // where many flames' heat piles up they merge and burn brighter. Plus a glow (uVap) over the dark.
    candles: `
uniform sampler2D uTrail, uVap;
uniform vec2 uTexel;   // one texel of the small glow layer
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 p = uv * asp;
  float n1 = fbm(p * vec2(7., 3.2) - vec2(0., uTime * 1.9), 3.);
  float n2 = fbm(p * vec2(16., 7.) - vec2(0., uTime * 3.2) + 4.2, 2.);
  // sample the heat below and to the side: what's drawn rises in tongues and flickers sideways
  vec2 off = vec2((n1 - .5) * .022 + (n2 - .5) * .009, -(n1 * .04 + n2 * .012));
  float own = texture2D(uTrail, uv + off).r;
  // the flames' shared heat (the blurred glow layer): sparse flames barely touch it, a crowd of
  // them piles it up into one body of fire
  // the more heat has gathered here, the higher the merged fire climbs (big fires burn taller)
  float pile = texture2D(uVap, uv - vec2(0., .04)).r;
  vec2 off2 = off * 2.2 - vec2(0., smoothstep(.15, .8, pile) * .07);
  float shared = 0.;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * .785;
    shared += texture2D(uVap, uv + off2 + vec2(cos(a), sin(a)) * uTexel * 1.2).r;
  }
  shared /= 8.;
  // heat is stored gently (so a crowd doesn't max it out) and stretched here
  float h = (own * 1.6 + smoothstep(.12, .75, shared) * .55) * (.6 + .75 * n2);  // ragged, licking edges
  float smoke = texture2D(uTrail, uv + off * .6).g;

  // the fire burns in your palette: its darkest colour at the cool, faint edges, climbing through the
  // palette to the lightest near the core, then a soft white-hot heart
  float t = smoothstep(.04, 1.7, h);
  vec3 c = palette(t) * smoothstep(.03, .3, h) * (.8 + .45 * t);   // fades to black at the edges
  c = mix(c, mix(palette(1.), vec3(1.), .55), smoothstep(1.6, 2.4, h) * .8);
  vec3 tint = palette(.8);

  vec3 g = texture2D(uVap, uv).rgb * 2.;
  float wsum = 2.;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * .5236 + .26;
    for (int j = 1; j <= 3; j++) {
      float w = 1. / float(j);
      g += texture2D(uVap, uv + vec2(cos(a), sin(a)) * uTexel * float(j) * 1.8).rgb * w;
      wsum += w;
    }
  }
  float glow = (g / wsum).r;
  vec3 warm = tint;
  vec3 col = c + warm * glow * .7 + vec3(.55, .52, .5) * smoke * .3;
  col = col / (1. + max(col - .9, 0.) * .8);
  gl_FragColor = vec4(finish(col, .4, .02), 1.);
}`,

    // The dye fluid.js simulated (uTrail, a small grid smoothed up to the screen). Its amount is cut
    // into soft-edged blobs at screen resolution, so the shapes stay crisp however small the grid,
    // with a gentle sheen from the slope of the dye, like thick liquid catching the light.
    fluid: `
uniform sampler2D uTrail, uVap;
uniform vec2 uTexel;   // one cell of the fluid grid
float amt(vec2 uv){ vec3 c = texture2D(uTrail, uv).rgb; return max(max(c.r, c.g), c.b); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture2D(uTrail, uv).rgb;
  float a = max(max(c.r, c.g), c.b);
  vec3 hue = c / max(a, 1e-3);
  float body = smoothstep(.12, .17, a);                  // the blob's edge: clean, like a drop
  vec2 dx = vec2(uTexel.x, 0.), dy = vec2(0., uTexel.y);
  vec2 g = vec2(amt(uv + dx) - amt(uv - dx), amt(uv + dy) - amt(uv - dy));
  vec3 n = normalize(vec3(-g * 3.5, .2));
  float lit = .55 + .45 * max(dot(n, normalize(vec3(-.4, .5, .8))), 0.);   // rounded, like a bead of liquid
  float sheen = pow(max(dot(n, normalize(vec3(-.45, .55, 1.))), 0.), 30.) * body;
  vec3 col = hue * body * lit * (.6 + .4 * smoothstep(.15, .6, a));
  col += mix(hue, vec3(1.), .6) * sheen * .45;
  float halo = smoothstep(.0, .16, a) * (1. - body);       // a faint glow just outside each blob
  col += hue * halo * .12;
  gl_FragColor = vec4(finish(col, .3, .02), 1.);
}`,

    // The lines threads.js drew (uTrail), over a soft glow blurred from its small copy (uVap).
    threads: `
uniform sampler2D uTrail, uVap;
uniform vec2 uTexel;   // one texel of the small glow copy
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 line = texture2D(uTrail, uv).rgb;
  vec3 g = texture2D(uVap, uv).rgb * 2.;
  float wsum = 2.;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * .5236 + .26;
    for (int j = 1; j <= 3; j++) {
      float w = 1. / float(j);
      g += texture2D(uVap, uv + vec2(cos(a), sin(a)) * uTexel * float(j) * 1.4).rgb * w;
      wsum += w;
    }
  }
  g /= wsum;
  vec3 haze = mix(vec3(1.), palette(1.), .35);
  float glow = dot(g, vec3(.33));
  vec3 col = line + (g * .35 + haze * glow * .6) / (1. + glow * 2.5); // a soft haze that never blows out
  gl_FragColor = vec4(finish(col, .3, .025), 1.);
}`,

    // A steamy bathroom mirror: soft, pale palette colours blending behind fogged glass. Water beads
    // on the glass (each a tiny lens), now and then one slides down and leaves a clear trail, and wisps
    // of vapour drift across. Your finger wipes the fog away; it slowly mists back over.
    mist: `
uniform sampler2D uTrail;   // the fog buffer (see FOG)
// The colours behind the glass; fewer octaves = blurrier.
vec3 behind(vec2 p, float oct){
  float t = uTime;
  float f = fbm(p * 1.5 + vec2(t * .035, t * .02), oct);
  float g = fbm(p * 2.1 - vec2(t * .03, -t * .015) + 3.1, oct);
  vec3 c = palette(.5 + .5 * sin((f * 1.4 + g) * 7. + t * .05)); // cycles through every colour, in soft pools
  return mix(c, vec3(1.), .28);
}
// One layer of water on the glass, in cells of 1/scale screen heights.
// Returns xy = refraction (how the water bends what's behind), z = how much is water, w = clear trail.
vec4 water(vec2 p, float t, float scale, float seed, float dens, float slide){
  vec4 o = vec4(0.);
  // beads sitting still
  vec2 q = p * scale, id = floor(q), f = fract(q) - .5;
  float h = hash(id + seed);
  vec2 c = (vec2(hash(id + seed + 1.3), hash(id + seed + 7.1)) - .5) * .55;
  float r = mix(.07, .26, hash(id + seed + 3.7) * hash(id + seed + 9.2));
  float bead = smoothstep(1., .7, length(f - c) / r) * step(1. - dens, h);
  o.xy += (f - c) / r * bead;
  o.z = bead;
  // a drop sliding down each column now and then, leaving a clear wake with little beads in it
  float cw = 2.6 / scale, col = floor(p.x / cw), ch = hash(vec2(col, seed + 11.));
  if (slide > .01 && ch > .62) {
    float speed = mix(.04, .12, hash(vec2(col, seed + 5.)));
    float y = 1.15 - fract(t * speed + ch * 7.) * 1.4;
    float wob = sin(p.y * 23. + ch * 40.) * .25 + sin(p.y * 9. + ch * 13.) * .35;
    float x = (col + .5 + wob * .3) * cw;
    float R = cw * .14;
    vec2 d = (p - vec2(x, y)) / vec2(R, R * 1.3);
    float drop = smoothstep(1., .75, length(d)) * slide;
    o.xy += d * drop * 1.3;
    o.z = max(o.z, drop);
    float wake = smoothstep(R * .75, R * .15, abs(p.x - x)) * step(y, p.y) * exp(-(p.y - y) * 4.) * slide;
    o.w = wake;
    vec2 wq = vec2(p.x / (R * .9), p.y * scale * 2.6);
    vec2 wf = fract(wq) - .5;
    float wb = smoothstep(.3, .18, length(wf)) * wake * step(.55, hash(floor(wq) + col));
    o.xy += wf * wb;
    o.z = max(o.z, wb);
  }
  return o;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 p = uv * asp;
  vec4 F = texture2D(uTrail, uv);
  float onGlass = smoothstep(.25, .95, F.a);              // where you've wiped, the glass is dry: no drops
  vec4 a = water(p, uTime, 26., 0., .42 * onGlass, onGlass);
  vec4 b = water(p + 7.3, uTime * 1.2, 52., 4.2, .42 * onGlass, onGlass);
  vec4 e = water(p + 3.1, 0., 95., 8.6, smoothstep(.1, .9, F.g) * .85, 0.); // fine beads on the ridge you drew
  float wet = max(max(a.z, b.z * .8), e.z);
  vec2 bend = a.xy / 26. + b.xy / 52. * .7 + e.xy / 95. * .7;
  float fog = F.r * (1. - max(max(a.w, b.w * .7), wet));

  vec3 clear = behind(p - bend * 3., 4.);           // through clear glass and water: crisp and richer
  clear = mix(vec3(dot(clear, vec3(.33))), clear, 1.25);
  vec3 misted = mix(behind(p, 1.6), vec3(1.), .4);   // through fog: blurred, pale and milky
  float w = fbm(p * 2.3 + vec2(uTime * .07, uTime * .025), 3.);
  float w2 = fbm(p * 5. - vec2(uTime * .05, 0.) + 9., 2.);
  misted += (w - .5) * .14 + (w2 - .5) * .05;        // wisps drifting in the steam
  vec3 col = mix(clear, misted, fog);

  // water catches the light from the top left, with a soft darker rim
  vec3 n = normalize(vec3(-a.xy - b.xy * .6 - e.xy * .6, 1.2));
  float spec = pow(clamp(dot(reflect(-normalize(vec3(-.4, .6, .7)), n), vec3(0., 0., 1.)), 0., 1.), 24.);
  col *= 1. - .06 * smoothstep(.2, .9, length(a.xy)) * a.z;
  col += spec * wet * .55;
  gl_FragColor = vec4(finish(col, .12, .015), 1.);
}`,

    // One step of the vapour simulation: carry last frame's vapour along a swirling flow (curl noise,
    // a gentle rise, and a push outward from each piece), fade it, and emit new fibres around each
    // piece. Fibres are angular noise around the core, so they stream out as hair-like strands.
    vapourStep: `
uniform sampler2D uPrev;
uniform vec2 uSize;
uniform float uDt;
uniform vec4 uSrc[${SOURCES}];
vec2 curl(vec2 p, float oct){
  float e = .05;
  float a = fbm(p + vec2(0., e), oct), b = fbm(p - vec2(0., e), oct);
  float c = fbm(p + vec2(e, 0.), oct), d = fbm(p - vec2(e, 0.), oct);
  return vec2(a - b, -(c - d)) / (2. * e);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 asp = vec2(uSize.x / uSize.y, 1.);
  vec2 p = uv * asp;
  vec2 vel = curl(p * 1.6 + vec2(0., uTime * .06), 3.) * .13 + vec2(0., .05)   // broad, slow currents
          + curl(p * 5.5 - vec2(uTime * .04, 0.) + 7., 2.) * .035;             // and fine eddies within them
  float em = 0., emc = 0.;
  for (int i = 0; i < ${SOURCES}; i++) {
    vec4 S = uSrc[i];
    if (S.z <= 0.) continue;
    vec2 d = p - S.xy * asp;
    float r = length(d) + 1e-4;
    vel += d / r * .25 * S.z * exp(-r * 5.);
    float ang = atan(d.y, d.x);
    float fib = noise(vec2(ang * 72. + S.w, uTime * 1. + S.w)) * noise(vec2(ang * 19. - S.w, uTime * .35));
    float e = exp(-r * 32.) * (.016 + pow(fib, 2.5) * 9.) * S.z;  // mostly fibre, only a little smooth glow
    // Each piece breathes out one palette colour at a time, going round all of them, so its plume trails
    // away in the colours it's been through. Where in the round each piece is comes from its seed's
    // fraction, so pieces stay out of step (a new one starts on its own colour).
    float hue = fract(uTime * ${HUE_SPEED} + fract(S.w));
    em += e; emc += e * hue;
  }
  // Vapour has a lifecycle: R = density, G = age (0 newborn .. 1 dead), B = its palette colour (0..1).
  // It's carried by the flow, ages every frame, and is gone at age 1, so only the last few seconds of vapour ever exist and
  // the frame can't fill up. New vapour born at the ice resets the age where it lands.
  vec2 back = uv - vel / asp * uDt;
  vec4 prev = texture2D(uPrev, back);
  float d = prev.r, age = prev.g, hue = prev.b;
  float born = em * uDt * 3.;
  born *= step(.0015, born);   // faint traces far from the ice don't count as births (or nothing would ever die)
  float w = born / max(d + born, 1e-4);
  age = mix(age, 0., w);
  hue = mix(hue, emc / max(em, 1e-5), w);
  d = min(d + born, 1.);
  age += uDt / ${VAPOUR_LIFE.toFixed(2)};
  if (age >= 1.) d = 0.;
  // 8-bit storage: dither so slow ageing still advances on average instead of rounding away.
  float dz = (hash(gl_FragCoord.xy + fract(uTime * 7.3) * 113.) - .5) / 255.;
  gl_FragColor = vec4(clamp(d + dz, 0., 1.), clamp(age + dz, 0., 1.), hue, 1.);
}`,
  };

  let canvas, gl;
  const programs = {};
  let trailProg = null;
  let fog = null, fogProg = null; // mist's fogged glass
  let trail = null; // { w, h, tex: [a, b], fb: [a, b], read: 0 }
  let vapour = null, vapourProg = null;
  let clock = 0;    // real seconds since start (vapour's flow shouldn't depend on style speed)
  const ice = Array.from({ length: SOURCES }, (_, i) =>
    ({ auto: i < 2, x: 0.5, y: 0.5, age: 99, seed: Math.floor(Math.random() * 50) + i * 0.5, held: false }));
  let dropped = 0;  // vapour: hearts you've dropped, so each starts on the next palette colour
  let running = false, raf = 0, last = 0, time = 0;
  let cols = new Float32Array(MAX_COLS * 3), count = 2;
  let style = STYLES.liquid;
  const cur = { speed: style.speed, warp: style.warp, bright: style.bright };
  const touch = { x: 0.5, y: 0.5, z: 0, down: 0, id: null };
  const path = []; // finger points [x, y, brush radius] not yet stamped (capped so a stall can't pile up)
  const brushAt = () => BRUSH * 0.95; // constant; the trail itself spreads as it ages (see TRAIL)
  const strikes = Array.from({ length: STRIKES }, () => ({ age: 99 }));
  let strikeAt = 0;
  const segData = new Float32Array(MAXSEG * 2 * 4); // the uSegs texture's contents
  let segTex = null;   // null until made; false if this device can't sample float textures
  let grid = null;     // read-back of the storm noise: { w, h, tex, fb, buf, f }
  const drag = { x: 1, y: 0, amount: 0 }; // recent drag direction, and how much you're moving
  const light = { x: 0.28, y: 0.82 }; // clouds' sun; drifts to your finger and stays there
  let threadTex = null; // 2D styles (threads, candles): [scene, glow] textures, refilled each frame

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
    if (on) gl.uniform1f(U.uR, b[2]);
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
    gl.uniform1f(U.uPress, 0.9 * Math.sin(clock * 9)); // a pulse, so a held finger keeps making waves
    const pts = path.splice(0);
    trailPass([0, 0], [0, 0], false, 1);
    trailPass([0, 0], [0, 0], false, 2); // a second water step: waves travel twice as far
    if (pts.length === 1 && touch.down) trailPass(pts[0], pts[0], true, 0);
    for (let i = 1; i < pts.length; i++) trailPass(pts[i - 1], pts[i], true, 0);
    if (touch.down) path.push(pts.length ? pts[pts.length - 1] : [touch.x, touch.y, brushAt()]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Mist: fog the glass back up a little, then wipe along the finger's path since the last frame.
  function stepFog(dt) {
    fog = pingPong(fog, 0.5, [1, 0, 0, 1], true); // starts fully fogged
    const { prog, U } = fogProg;
    gl.viewport(0, 0, fog.w, fog.h);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(U.uPrev, 0);
    gl.uniform2f(U.uSize, fog.w, fog.h);
    gl.uniform2f(U.uTexel, 1 / fog.w, 1 / fog.h);
    gl.uniform1f(U.uDt, dt);
    gl.uniform1f(U.uR, WIPE);
    const pass = (a, b, on) => {
      const write = 1 - fog.read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fog.fb[write]);
      gl.bindTexture(gl.TEXTURE_2D, fog.tex[fog.read]);
      gl.uniform2f(U.uA, a[0], a[1]);
      gl.uniform2f(U.uB, b[0], b[1]);
      gl.uniform1f(U.uOn, on ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      fog.read = write;
    };
    const pts = path.splice(0);
    pass([0, 0], [0, 0], false);
    if (pts.length === 1 && touch.down) pass(pts[0], pts[0], true);
    for (let i = 1; i < pts.length; i++) pass(pts[i - 1], pts[i], true);
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
      fogProg = link(FOG, ['uPrev', 'uSize', 'uTexel', 'uA', 'uB', 'uOn', 'uR', 'uDt']);
      program('liquid');
      Threads.init();
      Candles.init();
      Fluid.init();
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
    Threads.setColours(cols, count);
    Candles.setColours(cols, count);
    Fluid.setColours(cols, count);
  }

  // Styles drawn in 2D (threads, candles, fluid) and composited here.
  const painter = () => ({ threads: Threads, candles: Candles, fluid: Fluid })[style.prog] || null;

  function uploadThreads(src) {
    if (!threadTex) {
      threadTex = [0, 1].map(() => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      });
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    [src.lines, src.glow].forEach((c, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, threadTex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    });
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
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
      path.push([x, y, brushAt()], [x, y, brushAt()]); // a dot even if the finger never moves
      painter()?.pointer('down', x, y);
      if (style.prog === 'vapour') {
        const k = oldest(ice.filter((q) => !q.auto));
        // seed's fraction = where this heart starts in the colour cycle: right on the next palette colour
        const target = ((dropped++ % count) + 0.5) / count;
        const phase = (((target - clock * HUE_SPEED) % 1) + 1) % 1;
        Object.assign(k, { x, y, age: 0, seed: Math.floor(Math.random() * 50) + phase, held: true });
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
      painter()?.pointer('move', x, y);
      ice.forEach((k) => { if (k.held) Object.assign(k, { x, y }); });
      if (path.length < 48) path.push([x, y, brushAt()]);
    });
    const lift = (e) => {
      if (!touch.down) return;
      touch.down = Math.max(0, touch.down - 1);
      if (e.pointerId === touch.id) touch.id = null;
      painter()?.pointer('up', ...toUV(e));
      ice.forEach((k) => { k.held = false; });
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
  }

  // ---- loop --------------------------------------------------------------------
  function frame(now) {
    if (!running) return;
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000 || 0)); // rAF's first timestamp can predate start()
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
    const mist = style.prog === 'mist';
    if (mist) stepFog(dt);
    const vap = style.prog === 'vapour';
    const src = vap ? iceSources() : null;
    if (vap) stepVapour(dt, src);
    const drawn = painter()?.render(dt, canvas.width, canvas.height);

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
    if (mist) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fog.tex[fog.read]);
      gl.uniform1i(U.uTrail, 0);
    }
    if (liquid) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, trail.tex[trail.read]);
      gl.uniform1i(U.uTrail, 0);
      gl.uniform2f(U.uTexel, 1 / trail.w, 1 / trail.h);
    }
    if (drawn) {
      uploadThreads(drawn);
      gl.uniform1i(U.uTrail, 0);
      gl.uniform1i(U.uVap, 1);
      gl.uniform2f(U.uTexel, 1 / drawn.glow.width, 1 / drawn.glow.height);
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
