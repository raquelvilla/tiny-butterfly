# 🦋 Tiny Butterfly

A colour a day, folded into palettes and liquid light.

- **Today**: type a hex code (or use the little picker) and add a word or note.
  The diary below shows every day you've kept, month by month. Tap any day to see or edit it.
- **Palettes**: tap 3–6 of your colours to make a palette. Stuck? **Harmonies** finds palettes in
  your own colours using colour harmony (analogous, complementary, triadic, split-complementary,
  tetradic). Tap a colour in a suggestion to swap it. With fewer than 3
  colours, it shows example palettes grown from your latest colour instead, ready to play in the visuals. *Keep* saves it, and *Tweak* opens it in the builder.
- **Visual**: a palette becomes a full-screen shader. Tap ◎ to save a still. Each style answers touch
  in its own way:
  - **liquid**: smooth domain-warped noise. Your finger draws a liquid-chrome trail that spreads wider
    as it ages (thin at your finger, broad further back) and bends
    the colours under it and slowly melts away. The stroke also pushes a simulated water surface, so
    chrome waves spread out from the shape you draw (and keep coming while you hold still).
  - **storm**: smooth, silky flowing noise. Hold a finger down and lightning runs along the noise's own
    paths from it, with branches peeling off onto neighbouring veins; it heads the way you drag.
  - **clouds**: soft, photographic volumetric clouds in two drifting layers over a palette sky,
    self-shadowed with glowing edges, a sun with a hot core, and god rays. Your finger moves the sun.
  - **vapour**: little glowing hearts sublimating into fibrous vapour on black, like dry ice, coloured
    like heat through your palette. Tap to drop a heart; drag to carry it and stream its vapour behind.
  - **mist**: a steamy bathroom mirror. Soft, pale pools of your palette blend behind fogged glass,
    water beads on it (each a tiny lens), drops now and then slide down leaving clear wakes, and wisps
    of vapour drift across. Draw in the mist with your finger: the stroke wipes the glass clear and dry (every drop it
    touches is gone, and they only slowly come back), the
    water you pushed aside gathers as fine beads along its edges. It all slowly fogs back over.
  - **threads**: a bezier pen. Tap to place points (tap and drag to pull out their handles), drag a
    point to move it, drag a handle to bend the curve, double-tap a point to remove it. The curve is a
    fine glowing line in your palette with a light travelling along it; the points and handles fade
    away after a few seconds so you're left with just the line. Your curve is remembered.
  - **birthdays**: an abstraction of a birthday: only flames, in the dark. Tap to light a flame wherever
    you touch; drag to blow, and flames lean away from your breath while the nearest go out with a
    curl of smoke. Flames crowded together merge into one bigger, brighter, taller fire: the more you
    light, the more it all burns. The fire burns in your palette, darkest at the edges to lightest at the heart.

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
  "days":     { "2026-10-29": { "hex": "#6A4C93", "note": "plum dusk", "at": "…" } },
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
| `threads.js` | the threads style's bezier pen (drawn in 2D, composited by `shader.js`) |
| `candles.js` | the candles style's flames (as heat) and smoke (drawn in 2D, composited by `shader.js`) |
| `sw.js`, `manifest.json`, `icons/` | installable / offline |
| `tools/make_icons.py` | redraws the butterfly icons |
