# Tiny Butterfly — build plan

## Goal
A phone-first PWA where Raquel logs one colour a day (hex + optional Pantone label + note), groups
colours into palettes (by hand, or "Inspire me" via colour harmony), and turns any palette into a
full-screen shader-gradient visual that reacts to touch and sound.

## Context / constraints
- Separate project from `Everything`. Lives at `~/Documents/tiny-butterfly/`, local git repo only —
  no GitHub remote for now. GitHub Pages is a possible later step, only if Raquel asks.
- Runs locally via `serve.py` on the Mac. Note: on a phone over plain-HTTP LAN, browsers block the
  service worker (install/offline) and the microphone — those need localhost or HTTPS (e.g. Pages later).
- Vanilla JS, no framework, no build step — same style as the Everything modules.
  Local dev via `serve.py`.
- Data in `localStorage` on the phone. JSON export/import for backup. No backend.
- Pantone: library is licensed, so no bundled Pantone→hex table. Hex is the source of truth;
  Pantone is a free-text label the user types.
- Philosophy: garden not dashboard — playful and tactile, no stats/metrics.

## Data shape (`localStorage["tinyButterfly.v1"]`)
```json
{
  "days":     { "2026-10-29": { "hex": "#E4572E", "pantone": "17-1462 Flame", "note": "bonfire", "at": "ISO" } },
  "palettes": [ { "id": "p_abc", "name": "October embers", "dates": ["2026-10-02", "2026-10-29"],
                  "source": "manual|harmony", "createdAt": "ISO" } ]
}
```
Palettes reference days by date, so editing a day's colour updates every palette that uses it.

## Files
```
index.html        app shell, three tabs: Today · Palettes · Visual
style.css
app.js            state, storage, routing, Today + Palettes UI
color.js          hex/RGB/HSL/OKLab conversion, harmony scoring, palette suggestions
shader.js         WebGL setup, fragment shader, touch + mic input, PNG snapshot
manifest.json, sw.js, icons/   PWA install + offline
serve.py          local dev server
README.md
```

## Steps

### Phase 1 — skeleton
1. Create the folder, `git init`, and the files above as stubs. `serve.py` serves on a free local port.
2. `manifest.json` + `sw.js` (cache-first app shell) + butterfly icons generated as PNGs. Check the app
   installs and loads offline.

### Phase 2 — Today
3. `color.js`: `parseHex` (accepts `E4572E`, `#e4572e`, `#E57`), `hexToRgb`, `rgbToHsl`, `toOklab`.
4. Today screen: hex input with a live big swatch, invalid input shown gently, Pantone label field,
   note field, Save. If today already has a colour, show it and let it be edited. Past days can be
   edited too.
5. Diary view: a scroll of every logged day as small swatches (a month grid, empty days left blank).
   Tap a swatch to see or edit that day.

### Phase 3 — Palettes
6. Manual: "New palette", then tap 3–6 swatches from the diary, name it, save. Palettes list shows
   each one as a strip; tap to edit, rename, delete, or open in Visual.
7. "Inspire me": `color.js` `suggestPalettes(days, n)` picks a seed colour from the logged ones,
   then chooses companions whose OKLab hue matches a harmony rule (analogous, complementary,
   triadic, split-complementary), with a minimum lightness spread. It returns 3 suggestions, each
   labelled with its rule. Keep one, reroll, or swap individual colours. Saved suggestions get
   `source: "harmony"`.

### Phase 4 — Visual
8. `shader.js`: a full-screen WebGL canvas. The fragment shader uses domain-warped noise mapped
   through the palette colours (up to 6 uniforms, smooth blend). Slow, liquid motion.
9. Touch: dragging pushes a swirl into the warp field, and it decays over about 2s. Multi-touch
   supported.
10. Sound: a "🎙" toggle asks for mic permission, uses an AnalyserNode for bass/mid/high levels, and
    drives warp strength, speed and brightness. Off by default.
11. Controls auto-hide: palette switcher, mode presets (calm / liquid / storm), snapshot to PNG
    (download or share sheet).

### Phase 5 — polish & publish
12. Settings: export/import JSON, plus a note that data lives on this device.
13. README with how to run it locally (and the phone/HTTPS caveat).
14. Commit to the local git repo. No remote.

## Success criteria
- In the browser at localhost (desktop and mobile-size view): log a colour, reload, and it's still there.
- A palette made by hand and one from "Inspire me" both open in Visual and render smoothly (~60fps
  on a recent phone).
- Dragging visibly swirls the colours, and with the mic on, clapping or music visibly moves them.
- Export → wipe → import restores everything.
