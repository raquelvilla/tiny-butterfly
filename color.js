// Colour maths: hex parsing, OKLab/OKLCH, and harmony-based palette suggestions.
const Color = (() => {
  function parseHex(input) {
    if (input == null) return null;
    let s = String(input).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
    return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toUpperCase() : null;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const toLinear = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  function toOklab(hex) {
    const [r, g, b] = hexToRgb(hex).map(toLinear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function toOklch(hex) {
    const [L, a, b] = toOklab(hex);
    return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
  }

  const hueDist = (a, b) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  };

  // Ink colour that stays readable on top of `hex`.
  const readableInk = (hex) => (toOklab(hex)[0] > 0.66 ? '#1E1A1D' : '#FFFFFF');

  // ---- Harmony suggestions ------------------------------------------------
  // Hue offsets (OKLCH degrees) from a seed colour, for each classic rule.
  const RULES = [
    { name: 'Analogous', offsets: [0, -30, 30, 60] },
    { name: 'Complementary', offsets: [0, 180, 25, 205] },
    { name: 'Triadic', offsets: [0, 120, 240] },
    { name: 'Split-complementary', offsets: [0, 150, 210] },
    { name: 'Tetradic', offsets: [0, 90, 180, 270] },
  ];
  const NEUTRAL_CHROMA = 0.035; // below this a colour is grey-ish and its hue means little

  // Pool entries ranked by how well they sit on `targetHue`; similar lightness to the seed is penalised.
  function rank(pool, seed, targetHue) {
    return pool
      .map((e) => {
        const hue = e.C < NEUTRAL_CHROMA ? 50 : hueDist(e.h, targetHue);
        const flat = Math.abs(e.L - seed.L) < 0.06 && e !== seed ? 15 : 0;
        return { e, score: hue + flat };
      })
      .sort((a, b) => a.score - b.score);
  }

  // days: { 'YYYY-MM-DD': { hex } }. Returns up to n suggestions:
  // { rule, slots: [{ ranked: [date…], idx }] } — slot colour is ranked[idx]; swapSlot walks `ranked`.
  function suggestPalettes(days, n = 3, rand = Math.random) {
    const pool = Object.entries(days).map(([date, d]) => ({ date, ...toOklch(d.hex) }));
    if (pool.length < 3) return [];
    const out = [];
    const seen = new Set();
    // Shuffled rule order so each suggestion leans on a different harmony.
    const order = RULES.map((r) => [rand(), r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
    for (let tries = 0; tries < 60 && out.length < n; tries++) {
      const tolerance = tries < 35 ? 55 : Infinity; // loosen up when colours are scarce
      const seed = pool[Math.floor(rand() * pool.length)];
      const rule = order[(out.length + Math.floor(tries / 8)) % order.length];
      const used = new Set([seed.date]);
      const slots = [{ ranked: rank(pool, seed, seed.h).map((r) => r.e.date), idx: 0 }];
      slots[0].ranked = [seed.date, ...slots[0].ranked.filter((d) => d !== seed.date)];
      for (const off of rule.offsets.slice(1)) {
        const scored = rank(pool, seed, (seed.h + off + 360) % 360);
        const pick = scored.find((r) => r.score < tolerance && !used.has(r.e.date))?.e.date;
        if (!pick) continue;
        const ranked = scored.map((r) => r.e.date);
        used.add(pick);
        slots.push({ ranked, idx: ranked.indexOf(pick) });
      }
      if (slots.length < 3) continue;
      const key = [...used].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ rule: rule.name, slots });
    }
    return out;
  }

  const suggestionDates = (s) => s.slots.map((sl) => sl.ranked[sl.idx]);

  // Move slot i to its next-best colour not already in the suggestion. Returns false if none.
  function swapSlot(s, i) {
    const sl = s.slots[i];
    const taken = new Set(suggestionDates(s));
    for (let k = 1; k < sl.ranked.length; k++) {
      const j = (sl.idx + k) % sl.ranked.length;
      if (!taken.has(sl.ranked[j])) {
        sl.idx = j;
        return true;
      }
    }
    return false;
  }

  return { parseHex, hexToRgb, toOklab, toOklch, hueDist, readableInk, suggestPalettes, suggestionDates, swapSlot };
})();
