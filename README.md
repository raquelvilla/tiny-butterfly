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

## Where your colours live

- **Your own copy (from your Mac):** `serve.py` keeps everything in `data.json` in this folder (the previous
  version in `data.prev.json`; both stay out of git, and the nightly Luna backup copies `data.json`). Open
  the app at http://localhost:8790 on the Mac, or at **https://<your-mac>.<tailnet>.ts.net:8790** on your
  phone over Tailscale (private to your devices; add it to the Home Screen). Every device syncs with the
  Mac: the newest version of each colour wins, removals stay removed, and it keeps working offline.
  Set up once with `tailscale serve --bg --https=8790 http://localhost:8790`.
- **For friends:** https://raquelvilla.github.io/tiny-butterfly/ (GitHub Pages, `git push` to update).
  There's no Mac behind it, so each visitor's colours stay private in their own browser.

⋯ → Export / Import backup moves colours between any of these; importing only adds, never replaces.

## Data

```json
{
  "days":     { "2026-10-29": { "hex": "#6A4C93", "note": "plum dusk", "at": "…" } },
  "palettes": [ { "id": "p_…", "name": "…", "dates": ["2026-10-29", "…"], "source": "manual|harmony", "updatedAt": "…" } ],
  "lastVisual": "p_…",
  "gone":     { "days": { "2026-10-01": "…" }, "palettes": { "p_…": "…" } }
}
```

In the browser it's under `localStorage['tinyButterfly.v1']`; on the Mac it's `data.json`. Palettes point
at days, so changing a day's colour changes it in every palette that uses it. `gone` remembers removals so
syncing can't bring them back.

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
