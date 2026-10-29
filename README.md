# 🦋 Tiny Butterfly

A colour a day, folded into palettes and liquid light.

- **Today**: type a hex code (or use the little picker), add your Pantone name and a word or note.
  The diary below shows every day you've kept, month by month. Tap any day to see or edit it.
- **Palettes**: tap 3–6 of your colours to make a palette. Stuck? **✦ Inspire me** finds palettes in
  your own colours using colour harmony (analogous, complementary, triadic, split-complementary,
  tetradic). Tap a colour in a suggestion to swap it. *Keep* saves it, and *Tweak* opens it in the builder.
- **Visual**: a palette becomes a full-screen shader. Tap ◎ to save a still. Each style answers touch
  in its own way:
  - **liquid**: smooth domain-warped noise. Your finger draws a liquid-chrome trail that spreads wider
    as it ages (thin at your finger, broad further back) and bends
    the colours under it and slowly melts away. The stroke also pushes a simulated water surface, so
    chrome waves spread out from the shape you draw (and keep coming while you hold still).
  - **storm**: fast, finely detailed noise. Hold a finger down and lightning runs along the noise's own
    paths from it, with branches peeling off onto neighbouring veins; it heads the way you drag.
  - **clouds**: soft, photographic volumetric clouds in two drifting layers over a palette sky,
    self-shadowed with glowing edges, a sun with a hot core, and god rays. Your finger moves the sun.
  - **vapour**: little glowing hearts sublimating into fibrous vapour on black, like dry ice, coloured
    like heat through your palette. Tap to drop a heart; drag to carry it and stream its vapour behind.
  - **threads**: the palette's name in fine glowing outline on black. Drag through it and the letters
    come apart into a constellation of palette-coloured nodes joined by thin lines, some stretching into
    vertical strings, then knit back together. Left alone a while, it disturbs itself now and then.

## Run it

Double-click **Tiny Butterfly** on the Desktop. It runs `launch.sh`, which starts the server on :8790 if
it isn't already running, then opens http://localhost:8790.

Or by hand:

```bash
python3 serve.py
```

## On your phone

`serve.py` also prints a Wi-Fi address (`http://192.168.x.x:8790`) you can open on your phone.
Over plain http on Wi-Fi, browsers **block offline install**. Logging colours, palettes and visuals
all still work. To install it on a phone, it needs https (for example GitHub Pages), which can be
added later.

Note that each browser keeps its own colours: phone and Mac don't sync. Use ⋯ → Export / Import backup
to move them between devices.

## Data

Everything is stored in `localStorage` under `tinyButterfly.v1`:

```json
{
  "days":     { "2026-10-29": { "hex": "#6A4C93", "pantone": "", "note": "plum dusk", "at": "…" } },
  "palettes": [ { "id": "p_…", "name": "…", "dates": ["2026-10-29", "…"], "source": "manual|harmony" } ],
  "lastVisual": "p_…"
}
```

Palettes point at days, so changing a day's colour changes it in every palette that uses it.

## Files

| file | what |
|---|---|
| `index.html`, `style.css` | shell and look |
| `app.js` | state, Today, diary, palettes, settings |
| `color.js` | hex parsing, OKLab/OKLCH, harmony suggestions |
| `shader.js` | WebGL styles and their touch effects |
| `threads.js` | the threads style's lettering and particles (drawn in 2D, composited by `shader.js`) |
| `sw.js`, `manifest.json`, `icons/` | installable / offline |
| `tools/make_icons.py` | redraws the butterfly icons |
