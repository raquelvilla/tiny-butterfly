// Tiny Butterfly — state, storage and UI for Today, Palettes and Visual.
(() => {
  const KEY = 'tinyButterfly.v1';
  const LILAC = '#C9B6F2'; // the picker's starting colour, and the accent when there's none yet
  const $ = (s) => document.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids);
    return n;
  };

  // ---- state --------------------------------------------------------------
  // { days: { 'YYYY-MM-DD': { hex, note, at } (older entries may also carry a pantone) },
  //   palettes: [{ id, name, dates: [...], source: 'manual'|'harmony', createdAt }],
  //   lastVisual: paletteId | null, lastStyle: 'liquid'|'storm'|'clouds'|'vapour' }
  let state = load();

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.days && Array.isArray(s.palettes)) return s;
    } catch {}
    return { days: {}, palettes: [], lastVisual: null };
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      toast('Could not save on this device');
    }
  }

  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => isoDate(new Date());
  const fromKey = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const fmtDay = (k, opts = { weekday: 'long', day: 'numeric', month: 'long' }) =>
    fromKey(k).toLocaleDateString(undefined, opts);
  const uid = () => 'p_' + Math.random().toString(36).slice(2, 9);
  const paletteHexes = (p) => p.dates.map((d) => state.days[d]?.hex).filter(Boolean);

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function setAccent(hex) {
    const root = document.documentElement.style;
    root.setProperty('--accent', hex || LILAC);
    root.setProperty('--accent-ink', hex ? Color.readableInk(hex) : '#FFFFFF');
  }

  // ---- views --------------------------------------------------------------
  let view = 'today';
  function show(next) {
    view = next;
    for (const v of ['today', 'palettes', 'visual']) $(`#view-${v}`).hidden = v !== next;
    for (const b of $('#tabs').children) {
      if (b.dataset.view === next) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    document.body.classList.toggle('visual-on', next === 'visual');
    if (next === 'visual') openVisual();
    else Visual.stop();
    if (next === 'palettes') renderPalettes();
    window.scrollTo(0, 0);
  }
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) show(b.dataset.view);
  });

  // ---- today / day editor ---------------------------------------------------
  let editing = todayKey();
  const hexInput = $('#hexInput');

  function openDay(key) {
    editing = key;
    const d = state.days[key];
    hexInput.value = d ? d.hex.slice(1) : '';
    $('#noteInput').value = d?.note || '';
    renderEditor();
    renderDiary();
  }

  function renderEditor() {
    const hex = Color.parseHex(hexInput.value);
    const has = !!state.days[editing];
    const isToday = editing === todayKey();
    const sw = $('#bigSwatch');
    sw.style.backgroundColor = hex || '';
    sw.style.color = hex ? Color.readableInk(hex) : '';
    sw.classList.toggle('filled', !!hex);
    $('#swatchEmpty').hidden = !!hex;
    $('#dayLabel').textContent = isToday ? 'Today' : fmtDay(editing);
    $('#hexEcho').textContent = hex || '';
    $('#colorPick').value = (hex || LILAC).toLowerCase();
    setAccent(hex || state.days[todayKey()]?.hex);

    const saved = state.days[editing];
    const unchanged = saved && saved.hex === hex &&
      (saved.note || '') === $('#noteInput').value.trim();
    $('#saveBtn').disabled = !hex || unchanged;
    $('#saveBtn').textContent = has ? 'Update' : isToday ? 'Keep this colour' : 'Keep for this day';
    $('#backToday').hidden = isToday;
    $('#clearDay').hidden = !has;
    $('#dayHint').textContent = hexInput.value.trim() && !hex ? 'Hex codes look like E4572E or E57' : '';
  }

  hexInput.addEventListener('input', () => {
    hexInput.value = hexInput.value.replace(/[^0-9a-f#]/gi, '').toUpperCase();
    renderEditor();
  });
  $('#colorPick').addEventListener('input', (e) => {
    hexInput.value = e.target.value.slice(1).toUpperCase();
    renderEditor();
  });
  $('#noteInput').addEventListener('input', renderEditor);

  $('#dayForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const hex = Color.parseHex(hexInput.value);
    if (!hex) return;
    state.days[editing] = {
      hex,
      ...(state.days[editing]?.pantone ? { pantone: state.days[editing].pantone } : {}), // kept from older entries
      note: $('#noteInput').value.trim(),
      at: new Date().toISOString(),
    };
    save();
    flutter();
    renderEditor();
    renderDiary();
    toast(editing === todayKey() ? 'Kept for today' : `Kept for ${fmtDay(editing, { day: 'numeric', month: 'short' })}`);
  });

  $('#backToday').addEventListener('click', () => openDay(todayKey()));
  $('#clearDay').addEventListener('click', () => {
    const inPalettes = state.palettes.filter((p) => p.dates.includes(editing)).length;
    const msg = inPalettes
      ? `Remove this colour? It's in ${inPalettes} palette${inPalettes > 1 ? 's' : ''} and will leave ${inPalettes > 1 ? 'them' : 'it'}.`
      : 'Remove this colour?';
    if (!confirm(msg)) return;
    delete state.days[editing];
    for (const p of state.palettes) p.dates = p.dates.filter((d) => d !== editing);
    save();
    openDay(editing);
  });

  function flutter() {
    const sw = $('#bigSwatch');
    sw.classList.add('pop');
    setTimeout(() => sw.classList.remove('pop'), 300);
    const b = el('span', { className: 'flutter', textContent: '🦋' });
    sw.append(b);
    b.addEventListener('animationend', () => b.remove());
  }

  // ---- diary -------------------------------------------------------------------
  function renderDiary() {
    const box = $('#diary');
    const keys = Object.keys(state.days).sort();
    const now = new Date();
    const first = keys.length ? fromKey(keys[0]) : now;
    const today = todayKey();
    box.replaceChildren();
    let y = now.getFullYear();
    let m = now.getMonth();
    while (y > first.getFullYear() || (y === first.getFullYear() && m >= first.getMonth())) {
      box.append(monthEl(y, m, today));
      if (--m < 0) { m = 11; y--; }
    }
  }

  function monthEl(y, m, today) {
    const cal = el('div', { className: 'cal' });
    for (const wd of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) cal.append(el('span', { className: 'wd', textContent: wd }));
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;
    for (let i = 0; i < lead; i++) cal.append(el('span'));
    const count = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= count; d++) {
      const key = `${y}-${pad(m + 1)}-${pad(d)}`;
      const day = state.days[key];
      const b = el('button', { className: 'day', textContent: d, type: 'button' });
      b.dataset.key = key;
      if (day) {
        b.classList.add('has');
        b.style.backgroundColor = day.hex;
        b.style.color = Color.readableInk(day.hex);
        b.title = [day.hex, day.pantone, day.note].filter(Boolean).join(' · ');
      }
      if (key > today) { b.classList.add('future'); b.disabled = true; }
      if (key === editing) b.classList.add('editing');
      cal.append(b);
    }
    const title = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    return el('section', { className: 'month' }, el('h3', { textContent: title }), cal);
  }

  $('#diary').addEventListener('click', (e) => {
    const b = e.target.closest('.day');
    if (!b || b.disabled) return;
    openDay(b.dataset.key);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ---- palettes ----------------------------------------------------------------
  const strip = (hexes) => el('div', { className: 'strip' },
    ...hexes.map((h) => { const s = el('span'); s.style.backgroundColor = h; return s; }));

  function renderPalettes() {
    const list = $('#paletteList');
    list.replaceChildren();
    if (!state.palettes.length) {
      const n = Object.keys(state.days).length;
      list.append(el('p', {
        className: 'empty-note',
        textContent: n < 3
          ? `Keep a few colours first — you have ${n}. Palettes need at least 3.`
          : 'No palettes yet. Make one, or let ✦ Inspire me find some.',
      }));
      return;
    }
    for (const p of [...state.palettes].reverse()) {
      const s = strip(paletteHexes(p));
      s.title = 'Play';
      s.addEventListener('click', () => play(p.id));
      const tag = p.source === 'harmony' ? el('span', { className: 'tag', textContent: '✦' }) : '';
      list.append(el('div', { className: 'pal-card' }, s,
        el('div', { className: 'meta' },
          el('span', { className: 'name', textContent: p.name || 'untitled' }), tag,
          el('button', { className: 'mini', textContent: '▶ play', onclick: () => play(p.id) }),
          el('button', { className: 'mini', textContent: 'edit', onclick: () => openBuilder(p) }),
          el('button', { className: 'mini', textContent: 'delete', onclick: () => removePalette(p) }))));
    }
  }

  function removePalette(p) {
    if (!confirm(`Delete “${p.name || 'untitled'}”? Your colours stay in the diary.`)) return;
    state.palettes = state.palettes.filter((x) => x !== p);
    save();
    renderPalettes();
  }

  function play(id) {
    state.lastVisual = id;
    save();
    show('visual');
  }

  // builder
  let picked = [];
  let builderTarget = null; // palette being edited, or null for new

  function openBuilder(p = null) {
    builderTarget = p;
    picked = p ? [...p.dates] : [];
    $('#paletteName').value = p?.name || '';
    $('#inspire').hidden = true;
    $('#builder').hidden = false;
    renderBuilder();
    $('#builder').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderBuilder() {
    const grid = $('#builderGrid');
    grid.replaceChildren();
    const keys = Object.keys(state.days).sort().reverse();
    for (const k of keys) {
      const hex = state.days[k].hex;
      const b = el('button', { className: 'pick', type: 'button', title: `${fmtDay(k, { day: 'numeric', month: 'short' })} · ${hex}` });
      b.style.backgroundColor = hex;
      const i = picked.indexOf(k);
      if (i >= 0) { b.classList.add('on'); b.append(el('span', { className: 'n', textContent: i + 1 })); }
      b.addEventListener('click', () => {
        if (i >= 0) picked.splice(i, 1);
        else if (picked.length < 6) picked.push(k);
        else return toast('Six colours is the most a palette holds');
        renderBuilder();
      });
      grid.append(b);
    }
    const prev = $('#builderPreview');
    prev.replaceChildren(...strip(picked.map((d) => state.days[d].hex)).children);
    $('#builderHint').textContent = keys.length < 3
      ? `You have ${keys.length} colour${keys.length === 1 ? '' : 's'} so far — palettes need 3.`
      : `Tap 3–6 colours · ${picked.length} chosen`;
    $('#builderSave').disabled = picked.length < 3;
  }

  $('#newPalette').addEventListener('click', () => openBuilder());
  $('#builderCancel').addEventListener('click', () => { $('#builder').hidden = true; });
  $('#builderSave').addEventListener('click', () => {
    const name = $('#paletteName').value.trim();
    if (builderTarget) Object.assign(builderTarget, { name, dates: [...picked] });
    else state.palettes.push({ id: uid(), name, dates: [...picked], source: 'manual', createdAt: new Date().toISOString() });
    save();
    $('#builder').hidden = true;
    renderPalettes();
    toast('Palette saved');
  });

  // inspire me
  let suggestions = [];

  function inspire() {
    suggestions = Color.suggestPalettes(state.days, 3);
    $('#builder').hidden = true;
    $('#inspire').hidden = false;
    renderSuggestions();
  }

  function renderSuggestions() {
    const box = $('#suggestions');
    box.replaceChildren();
    if (!suggestions.length) {
      box.append(el('p', { className: 'empty-note', textContent: 'Keep at least 3 colours and I’ll find palettes in them.' }));
      return;
    }
    suggestions.forEach((s, si) => {
      const dates = Color.suggestionDates(s);
      const row = el('div', { className: 'strip' });
      dates.forEach((d, i) => {
        const b = el('button', { type: 'button', title: 'Swap this colour' });
        b.style.backgroundColor = state.days[d].hex;
        b.addEventListener('click', () => {
          if (!Color.swapSlot(s, i)) toast('No other colour fits there');
          renderSuggestions();
        });
        row.append(b);
      });
      box.append(el('div', { className: 'suggestion' },
        el('p', { className: 'rule', textContent: s.rule }), row,
        el('div', { className: 'row' },
          el('button', { className: 'primary', textContent: 'Keep', onclick: () => keepSuggestion(si) }),
          el('button', { className: 'ghost', textContent: 'Tweak', onclick: () => tweakSuggestion(si) }))));
    });
  }

  function keepSuggestion(i) {
    const s = suggestions[i];
    const name = `${s.rule} · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
    state.palettes.push({ id: uid(), name, dates: Color.suggestionDates(s), source: 'harmony', createdAt: new Date().toISOString() });
    save();
    suggestions.splice(i, 1);
    renderSuggestions();
    renderPalettes();
    toast('Palette kept');
  }

  function tweakSuggestion(i) {
    const s = suggestions[i];
    openBuilder(null);
    picked = Color.suggestionDates(s);
    $('#paletteName').value = s.rule;
    renderBuilder();
  }

  $('#inspireBtn').addEventListener('click', inspire);
  $('#reroll').addEventListener('click', inspire);
  $('#inspireClose').addEventListener('click', () => { $('#inspire').hidden = true; });

  // ---- visual ------------------------------------------------------------------
  const DEMO = ['#F6C9B8', '#E4572E', '#3D2C8D', '#C9B6F2'];
  let visualReady = null;

  function visualSources() {
    const out = state.palettes
      .map((p) => ({ id: p.id, name: p.name || 'untitled', hexes: paletteHexes(p) }))
      .filter((s) => s.hexes.length >= 2);
    const recent = Object.keys(state.days).sort().slice(-5).map((k) => state.days[k].hex);
    if (recent.length >= 2) out.push({ id: '_recent', name: 'Latest colours', hexes: recent });
    out.push({ id: '_demo', name: 'Butterfly', hexes: DEMO });
    return out;
  }

  function openVisual() {
    if (visualReady === null) visualReady = Visual.init($('#glCanvas'));
    if (!visualReady) { $('#visFallback').hidden = false; return; }
    const sources = visualSources();
    const sel = $('#visPalette');
    sel.replaceChildren(...sources.map((s) => el('option', { value: s.id, textContent: s.name })));
    const chosen = sources.find((s) => s.id === state.lastVisual) || sources[0];
    sel.value = chosen.id;
    Visual.setPalette(chosen.hexes);
    Visual.setWord(chosen.name);
    setStyle(state.lastStyle);
    Visual.start();
    pokeUi();
  }

  $('#visPalette').addEventListener('change', (e) => {
    const s = visualSources().find((x) => x.id === e.target.value);
    if (!s) return;
    state.lastVisual = s.id;
    save();
    Visual.setPalette(s.hexes);
    Visual.setWord(s.name);
  });

  function setStyle(name) {
    if (!Visual.styles.includes(name)) name = 'liquid';
    Visual.setStyle(name);
    for (const x of $('#styles').children) x.classList.toggle('on', x.dataset.style === name);
    if (state.lastStyle !== name) { state.lastStyle = name; save(); }
  }
  $('#styles').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setStyle(b.dataset.style);
  });

  $('#snapBtn').addEventListener('click', async () => {
    const blob = await Visual.snapshot();
    if (!blob) return toast('Could not capture a still');
    const file = new File([blob], `tiny-butterfly-${todayKey()}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch {}
    }
    const a = el('a', { href: URL.createObjectURL(blob), download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Still saved');
  });

  $('#exitVisual').addEventListener('click', () => show('palettes'));

  // Controls fade away while you play, and come back on touch.
  let uiTimer;
  function pokeUi() {
    $('#visUi').classList.remove('hide');
    clearTimeout(uiTimer);
    uiTimer = setTimeout(() => $('#visUi').classList.add('hide'), 3500);
  }
  $('#view-visual').addEventListener('pointerdown', pokeUi);
  $('#view-visual').addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') pokeUi(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && view === 'visual') show('palettes'); });

  // ---- settings: backup -----------------------------------------------------
  $('#settingsBtn').addEventListener('click', () => $('#settings').showModal());

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `tiny-butterfly-backup-${todayKey()}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || typeof data.days !== 'object' || !Array.isArray(data.palettes)) throw new Error('shape');
      for (const [k, d] of Object.entries(data.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Color.parseHex(d?.hex)) throw new Error('day');
      }
      const n = Object.keys(data.days).length;
      if (!confirm(`Replace everything here with this backup (${n} colours, ${data.palettes.length} palettes)?`)) return;
      state = { days: data.days, palettes: data.palettes, lastVisual: data.lastVisual ?? null };
      save();
      $('#settings').close();
      openDay(todayKey());
      renderPalettes();
      toast('Backup restored');
    } catch {
      toast('That file doesn’t look like a Tiny Butterfly backup');
    }
  });

  // ---- boot ---------------------------------------------------------------------
  // Roll the editor over to the new day if the app stays open past midnight.
  let lastToday = todayKey();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || todayKey() === lastToday) return;
    if (editing === lastToday) openDay(todayKey());
    lastToday = todayKey();
  });

  openDay(todayKey());

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
