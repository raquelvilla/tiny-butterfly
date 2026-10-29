# 🦋 Tiny Butterfly

A colour a day, folded into palettes and liquid light.

- **Today**: type a hex code (or use the little picker), add your Pantone name and a word or note.
  The diary below shows every day you've kept, month by month. Tap any day to see or edit it.
- **Palettes**: tap 3–6 of your colours to make a palette. Stuck? **✦ Inspire me** finds palettes in
  your own colours using colour harmony (analogous, complementary, triadic, split-complementary,
  tetradic). Tap a colour in a suggestion to swap it. *Keep* saves it, and *Tweak* opens it in the builder.
- **Visual**: a palette becomes a full-screen shader. Tap 🎙 to make it react to sound, and tap ◎ to
  save a still. Each style answers touch in its own way:
  - **liquid** / **storm**: domain-warped noise, gentle or wild. Taps ripple out, and drags leave a trail of ripples.
  - **ribs**: vertical stripes, each a slice of the palette from dark to light. Holding breaks them
    into stepped tiles that heal when you let go. Dragging sideways adds or removes ribs.
  - **pills**: columns of glowing ellipses on charcoal that swell like an equaliser (try the mic).
    No touch effect yet.

## Run it

Double-click **Tiny Butterfly** on the Desktop. It runs `launch.sh`, which starts the server on :8790 if
it isn't already running, then opens http://localhost:8790.

Or by hand:

```bash
python3 serve.py
```

## On your phone

`serve.py` also prints a Wi-Fi address (`http://192.168.x.x:8790`) you can open on your phone.
Over plain http on Wi-Fi, browsers **block the microphone and offline install**. Logging colours,
palettes and touch visuals all still work. To get the full app on a phone, it needs https (for
example GitHub Pages), which can be added later.

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
| `shader.js` | WebGL gradient, touch swirls, microphone |
| `sw.js`, `manifest.json`, `icons/` | installable / offline |
| `tools/make_icons.py` | redraws the butterfly icons |
