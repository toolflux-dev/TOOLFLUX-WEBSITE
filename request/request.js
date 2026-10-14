'use strict';
/* TOOLFLUX insert finder: one tap per screen. Data: wmg.js (Dormer Pramet WMG, from FLUX
   GRADE), grades.js (the TOOLFLUX range), designations.js (loaded only for "type your grade").
   Sends to the Apps Script in config.js; FLUX TRIALS -> Requests reads it. */
(function () {
  const CFG = window.TFX_REQUEST_CONFIG || {};
  const I = window.TFX_ICONS;
  const WMG = (window.TFX_WMG || { families: [] }).families;
  const G = window.TFX_GRADES;
  const START = Date.now();
  const DRAFT = 'tfx-finder-v2';
  const MAX_FILES = 3;
  const MAX_BYTES = 8 * 1024 * 1024;
  const stage = document.getElementById('stage');

  const PRODUCTS = [
    ['insert', 'Insert', 'Turning, milling, grooving or U-drill inserts', I.insert],
    ['drill', 'Drill', 'U-drills and solid drills', I.drill],
    ['holder', 'Holder', 'Turning and milling holders', I.holder],
  ];
  const OPS = [['turning', 'Turning'], ['milling', 'Milling'], ['grooving', 'Grooving'], ['drilling', 'U-drilling']];
  const DUTY = [['roughing', 'Roughing', 'Deep cuts, heavy stock removal'], ['medium', 'Medium', 'General machining'], ['finishing', 'Finishing', 'Light cuts, final size and finish']];
  const ISSUES = [['chipping', 'Breaks or chips'], ['wear', 'Wears out fast'], ['finish', 'Poor finish'], ['chatter', 'Chatter'],
    ['chips', 'Long chips'], ['bue', 'Built-up edge'], ['none', 'Nothing, new job']];

  let st = blank();
  function blank() {
    return { product: '', iso: '', group: '', groupName: '', sub: '', typed: '', operation: '', duty: '', line: '', grade: '',
      issues: [], extras: { currentInsert: '', partsPerEdge: '', note: '' }, contact: { name: '', company: '', phone: '', email: '' } };
  }
  let files = [];
  let step = 0;

  // ------------------------------------------------------------ helpers
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fam = (iso) => WMG.find((f) => f.iso === iso);
  const isoChip = (iso) => `<span class="iso ${iso}" style="background:var(--iso-${iso})">${iso}</span>`;
  const save = () => { try { localStorage.setItem(DRAFT, JSON.stringify({ st, step })); } catch (e) { /* private mode */ } };
  const load = () => { try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d && d.st) { st = { ...blank(), ...d.st }; return d.step || 0; } } catch (e) { /* none */ } return 0; };

  // The path depends on what they need: inserts get the full finder; drills and holders a short one.
  function path() {
    return st.product === 'insert' || !st.product
      ? ['product', 'family', 'group', 'operation', 'duty', 'grades', 'issues', 'contact']
      : ['product', 'family', 'group', 'issues', 'contact'];
  }

  // ------------------------------------------------------------ navigation
  function show(n, dir = 1, push = true) {
    const p = path();
    step = Math.max(0, Math.min(n, p.length - 1));
    const name = p[step];
    const next = SCREENS[name]();
    next.classList.add('screen', 'enter');
    if (dir < 0) next.classList.add('rev');
    const old = stage.querySelector('.screen:not(.leave)');
    if (old) {
      old.classList.add('leave');
      if (dir < 0) old.classList.add('rev');
      setTimeout(() => old.remove(), 320);
    }
    stage.append(next);
    document.getElementById('back').hidden = step === 0;
    // The grade reveal is the one dark moment: the whole page goes navy with it.
    const dark = name === 'grades';
    document.body.classList.toggle('dark', dark);
    document.querySelector('.logo').src = dark ? '../assets/toolflux-logo-light.svg' : '../assets/toolflux-logo.svg';
    progress();
    if (push) history.pushState({ step }, '', '');
    save();
    const focus = next.querySelector('h1');
    if (focus) { focus.setAttribute('tabindex', '-1'); focus.focus({ preventScroll: true }); }
  }
  const forward = (delay = 260) => setTimeout(() => show(step + 1, 1), delay);
  function progress() {
    const p = path();
    const frac = step / (p.length - 1);
    document.getElementById('cut').style.transform = `scaleX(${frac})`;
    const track = document.querySelector('.track');
    document.getElementById('tip').style.transform = `translateX(${frac * track.clientWidth - 10}px)`;
    document.getElementById('count').textContent = `${step + 1} / ${p.length}`;
  }
  window.addEventListener('popstate', (e) => { if (e.state && Number.isInteger(e.state.step)) show(e.state.step, e.state.step < step ? -1 : 1, false); });
  document.getElementById('back').innerHTML = I.back;
  document.getElementById('back').addEventListener('click', () => history.back());
  window.addEventListener('resize', progress);

  // tap: mark the tile, then move on, so the choice is seen before the screen turns
  function choose(tile, apply, delay) {
    tile.parentElement.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
    tile.classList.add('on');
    apply();
    save();
    forward(delay);
  }

  // ------------------------------------------------------------ screens
  const SCREENS = {
    product() {
      const s = el(`<section><p class="kicker">TOOLFLUX · 30 SECONDS</p><h1>Insert, drill or holder?</h1><div class="stack product"></div></section>`);
      const box = s.querySelector('.product');
      for (const [v, t, h, svg] of PRODUCTS) {
        const b = el(`<button type="button" class="tile${st.product === v ? ' on' : ''}">${svg}<span><span class="t">${t}</span><br><span class="h">${h}</span></span></button>`);
        b.onclick = () => choose(b, () => { if (st.product !== v) { st.product = v; } }, v === 'insert' ? 620 : 300);
        box.append(b);
      }
      return s;
    },

    family() {
      const s = el(`<section><h1>Which metal?</h1><div class="metals"></div><button type="button" class="link">Type your grade instead (EN8, SS304, GG25…)</button></section>`);
      const box = s.querySelector('.metals');
      for (const f of WMG) {
        const b = el(`<button type="button" class="tile${st.iso === f.iso ? ' on' : ''}">${isoChip(f.iso)}${I.metals[f.iso]}<span class="t">${esc(f.name)}</span></button>`);
        b.onclick = () => choose(b, () => { if (st.iso !== f.iso) { st.group = ''; st.groupName = ''; st.sub = ''; st.typed = ''; } st.iso = f.iso; });
        box.append(b);
      }
      s.querySelector('.link').onclick = () => { st.iso = ''; show(step + 1, 1); };
      return s;
    },

    group() {
      const f = fam(st.iso);
      const s = el(`<section><h1>${f ? esc(f.name) : 'Your grade'}</h1>
        <div class="find"><input type="search" placeholder="Type your grade: EN8, 1.7225, SCM440" autocomplete="off" aria-label="Type your grade"></div>
        <div class="hits"></div><div class="rows"></div></section>`);
      const rows = s.querySelector('.rows');
      if (f) {
        for (const g of f.groups) {
          const b = el(`<button type="button" class="row${st.group === g.code ? ' on' : ''}"><span class="code">${g.code}</span>
            <span><span class="n">${esc(g.name)}</span><span class="ex">${esc(g.examples.slice(0, 4).join(' · '))}</span></span><span class="chev"></span></button>`);
          b.onclick = () => choose(b, () => { st.group = g.code; st.groupName = g.name; st.sub = ''; st.typed = ''; }, 200);
          rows.append(b);
        }
        const ns = el(`<button type="button" class="row"><span class="code">${f.iso}</span><span><span class="n">Not sure</span><span class="ex">We'll confirm the exact steel with you</span></span><span class="chev"></span></button>`);
        ns.onclick = () => choose(ns, () => { st.group = ''; st.groupName = ''; st.sub = ''; }, 200);
        rows.append(ns);
      }
      const input = s.querySelector('input');
      const hits = s.querySelector('.hits');
      if (st.typed) input.value = st.typed;
      let t = null;
      input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => lookup(input.value, hits), 180); });
      if (!f) setTimeout(() => input.focus(), 400);
      return s;
    },

    operation() {
      const s = el(`<section><h1>Which operation?</h1><div class="ops"></div></section>`);
      const box = s.querySelector('.ops');
      for (const [v, t] of OPS) {
        const b = el(`<button type="button" class="tile${st.operation === v ? ' on' : ''}">${I.ops[v]}<span class="t">${t}</span></button>`);
        b.onclick = () => choose(b, () => { st.operation = v; st.line = ''; st.grade = ''; });
        box.append(b);
      }
      return s;
    },

    duty() {
      const s = el(`<section><h1>Roughing, medium or finishing?</h1><div class="stack duty"></div></section>`);
      const box = s.querySelector('.duty');
      for (const [v, t, h] of DUTY) {
        const b = el(`<button type="button" class="tile${st.duty === v ? ' on' : ''}"><span class="t">${t}</span><span class="h">${h}</span>${I.duty[v]}</button>`);
        b.onclick = () => choose(b, () => { st.duty = v; st.line = ''; st.grade = ''; });
        box.append(b);
      }
      return s;
    },

    grades() {
      const iso = st.iso || (st.sub || st.group || '').charAt(0);
      const cards = iso ? G.pick(iso, st.operation, st.duty) : [];
      const where = [st.groupName || (fam(iso) && fam(iso).name) || st.typed, OPS.find((o) => o[0] === st.operation)?.[1], DUTY.find((d) => d[0] === st.duty)?.[1]].filter(Boolean).join(' · ');
      const s = el(`<section class="reveal"><p class="kicker">${esc(where.toUpperCase())}</p><h1>${cards.length ? 'Your TOOLFLUX grades' : 'We\'ll pick it for you'}</h1><div class="cards"></div></section>`);
      const box = s.querySelector('.cards');
      if (!cards.length) {
        box.append(el(`<div class="advise"><b>We'll recommend after studying your job</b><p>This combination needs a closer look. Tell us what needs fixing and we will come back with the right grade.</p></div>`));
        const go = el('<div class="act"><button type="button" class="go">Continue</button></div>');
        go.querySelector('button').onclick = () => { st.line = 'help'; st.grade = ''; forward(0); };
        s.append(go);
        return s;
      }
      for (const c of cards) {
        const b = el(`<button type="button" class="gcard${st.grade === c.code ? ' on' : ''}"><span class="line">${esc(c.label.toUpperCase())}</span>
          <span class="code">${esc(c.code)}</span>
          <span class="isos">${c.iso.map(isoChip).join('')}${c.coating ? `<span class="coat">${c.coating}</span>` : ''}</span>
          <p>${esc(c.text)}</p>${c.note ? `<span class="gnote">${esc(c.note)}</span>` : ''}</button>`);
        b.onclick = () => choose(b, () => { st.line = c.line; st.grade = c.code; }, 420);
        box.append(b);
      }
      const help = el(`<button type="button" class="link">Not sure? Help me choose</button>`);
      help.onclick = () => { st.line = 'help'; st.grade = ''; forward(0); };
      s.append(help);
      return s;
    },

    issues() {
      const s = el(`<section><h1>What needs fixing?</h1><p class="sub">Pick any.</p><div class="chips"></div>
        <label class="photo">${I.camera}<span>Add a photo or drawing</span><input type="file" accept="image/*,application/pdf" multiple></label>
        <div class="thumbs"></div>
        <details class="extras"><summary>Add details (optional)</summary><div class="fields">
          <label class="f">Insert or tool you use now<input data-x="currentInsert" placeholder="e.g. CNMG120408 and its grade"></label>
          <label class="f">Parts per edge today<input data-x="partsPerEdge" inputmode="numeric" placeholder="e.g. 80"></label>
          <label class="f">Anything else<textarea data-x="note" rows="3" placeholder="Sizes, batch, what you have tried"></textarea></label>
        </div></details>
        <div class="grow"></div><div class="act"><button type="button" class="go">Next</button></div></section>`);
      const box = s.querySelector('.chips');
      const draw = () => {
        box.textContent = '';
        for (const [v, t] of ISSUES) {
          const b = el(`<button type="button" class="chip${st.issues.includes(v) ? ' on' : ''}">${I.issues[v]}<span>${t}</span></button>`);
          b.onclick = () => {
            if (v === 'none') st.issues = st.issues.includes('none') ? [] : ['none'];
            else st.issues = st.issues.includes(v) ? st.issues.filter((x) => x !== v) : st.issues.filter((x) => x !== 'none').concat(v);
            save(); draw();
          };
          box.append(b);
        }
      };
      draw();
      s.querySelectorAll('[data-x]').forEach((inp) => {
        inp.value = st.extras[inp.dataset.x] || '';
        inp.addEventListener('input', () => { st.extras[inp.dataset.x] = inp.value; save(); });
      });
      const det = s.querySelector('details');
      if (st.extras.currentInsert || st.extras.partsPerEdge || st.extras.note) det.open = true;
      det.addEventListener('toggle', () => { if (det.open) setTimeout(() => det.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); });
      const thumbs = s.querySelector('.thumbs');
      const drawThumbs = () => {
        thumbs.textContent = '';
        files.forEach((f, i) => {
          const t = el(`<span>${f.preview ? `<img src="${f.preview}" alt="">` : 'PDF'}<button type="button" aria-label="Remove">×</button></span>`);
          t.querySelector('button').onclick = () => { files.splice(i, 1); drawThumbs(); };
          thumbs.append(t);
        });
      };
      drawThumbs();
      s.querySelector('input[type=file]').addEventListener('change', async (e) => { await addFiles(e.target.files); e.target.value = ''; drawThumbs(); });
      s.querySelector('.go').onclick = () => show(step + 1, 1);
      return s;
    },

    contact() {
      const c = st.contact;
      const s = el(`<section><h1>Where do we send your recommendation?</h1><div class="fields">
        <label class="f">Your name<input data-c="name" autocomplete="name" enterkeyhint="next"></label>
        <label class="f">Company<input data-c="company" autocomplete="organization" enterkeyhint="next"></label>
        <label class="f">WhatsApp number<input data-c="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+91" enterkeyhint="next"></label>
        <label class="f">Email<input data-c="email" type="email" inputmode="email" autocomplete="email" enterkeyhint="send"></label>
        <label class="hp" aria-hidden="true">Website<input data-c="website" tabindex="-1" autocomplete="off"></label>
        </div><p class="err" role="alert"></p><div class="grow"></div>
        <div class="act"><button type="button" class="go">Send</button><p class="fine">By sending, you agree TOOLFLUX may call, WhatsApp or email you about this request.</p></div></section>`);
      s.querySelectorAll('[data-c]').forEach((inp) => {
        inp.value = c[inp.dataset.c] || '';
        inp.addEventListener('input', () => { c[inp.dataset.c] = inp.value; inp.parentElement.classList.remove('bad'); save(); });
      });
      s.querySelector('[data-c=email]').addEventListener('keydown', (e) => { if (e.key === 'Enter') s.querySelector('.go').click(); });
      s.querySelector('.go').onclick = () => send(s);
      return s;
    },
  };

  // ------------------------------------------------------------ "type your grade"
  let desig = null;
  function loadDesig() {
    if (desig) return Promise.resolve(desig);
    return new Promise((res) => {
      const sc = document.createElement('script');
      sc.src = 'designations.js';
      sc.onload = () => { desig = window.TFX_DESIG || { map: {}, iso: {}, names: [] }; res(desig); };
      sc.onerror = () => res({ map: {}, iso: {}, names: [] });
      document.head.append(sc);
    });
  }
  async function lookup(q, box) {
    const key = String(q).toUpperCase().replace(/[^A-Z0-9]/g, '');
    box.textContent = '';
    if (key.length < 2) return;
    const d = await loadDesig();
    const exact = d.map[key];
    const isoHit = d.iso[key] != null ? d.names[d.iso[key]] : null;
    const add = (html, fn) => { const b = el(`<button type="button" class="hit">${html}</button>`); b.onclick = fn; box.append(b); };
    if (exact) {
      const g = exact.split('.')[0];
      const group = WMG.flatMap((f) => f.groups).find((x) => x.code === g);
      add(`<b>${esc(q.toUpperCase())}</b> is <b>${exact}</b> · ${esc(group ? group.name : '')}`, () => {
        st.typed = q; st.sub = exact; st.group = g; st.groupName = group ? group.name : ''; st.iso = exact.charAt(0); save(); show(step + 1, 1);
      });
    } else if (isoHit) {
      const [iso, name] = isoHit.split('|');
      add(`<b>${esc(q.toUpperCase())}</b> is ISO ${iso} · ${esc(name)}`, () => {
        st.typed = q; st.sub = ''; st.group = ''; st.groupName = ''; st.iso = iso; save(); show(step + 1, 1);
      });
    } else if (key.length >= 3) {
      box.append(el(`<p class="note">Not in our list. Pick the closest group below, or carry on and we'll check "${esc(q)}" for you.</p>`));
      add(`Use "${esc(q)}" and carry on`, () => { st.typed = q; save(); show(step + 1, 1); });
    }
  }

  // ------------------------------------------------------------ files (photos shrunk on the phone)
  const readURL = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  async function shrink(f) {
    const url = await readURL(f);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  }
  async function addFiles(list) {
    for (const f of [...list]) {
      if (files.length >= MAX_FILES) break;
      try {
        if (f.type === 'application/pdf' && f.size <= MAX_BYTES) {
          const u = await readURL(f);
          files.push({ name: f.name, mime: 'application/pdf', data: u.split(',')[1], preview: null });
        } else if (/^image\//.test(f.type)) {
          const u = await shrink(f);
          files.push({ name: f.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', data: u.split(',')[1], preview: u });
        }
      } catch (e) { /* unreadable file: skipped */ }
    }
  }

  // ------------------------------------------------------------ send
  function summary() {
    const f = fam(st.iso);
    const bits = [
      PRODUCTS.find((p) => p[0] === st.product)?.[1],
      [f && f.name, st.group && `${st.sub || st.group} ${st.groupName}`, st.typed && `typed: ${st.typed}`].filter(Boolean).join(' / '),
      OPS.find((o) => o[0] === st.operation)?.[1], DUTY.find((d) => d[0] === st.duty)?.[1],
      st.grade ? `${G.copy[st.line] ? G.copy[st.line].label : ''}: ${st.grade}` : st.line === 'help' ? 'Grade: help me choose' : '',
      st.issues.length ? `Fix: ${st.issues.map((v) => ISSUES.find((x) => x[0] === v)?.[1]).join(', ')}` : '',
    ];
    return bits.filter(Boolean).join(' | ');
  }
  function endpoint() {
    const local = /^(localhost|127\.0\.0\.1|)$/.test(location.hostname);
    const q = new URLSearchParams(location.search).get('endpoint');
    return local && q ? q : CFG.endpoint;
  }
  async function send(s) {
    const c = st.contact;
    const err = s.querySelector('.err');
    const bad = (k) => s.querySelector(`[data-c=${k}]`).parentElement.classList.add('bad');
    err.textContent = '';
    if (!c.name.trim()) { bad('name'); err.textContent = 'Please give your name.'; return; }
    if (!c.company.trim()) { bad('company'); err.textContent = 'Please give your company.'; return; }
    if (c.phone.replace(/\D/g, '').length < 10) { bad('phone'); err.textContent = 'Please give a WhatsApp number we can reach.'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email.trim())) { bad('email'); err.textContent = 'Please give an email address for the recommendation.'; return; }
    const url = endpoint();
    if (!url) { err.textContent = 'This page is not live yet. Please WhatsApp TOOLFLUX on +91 8660234766.'; return; }
    const btn = s.querySelector('.go');
    btn.disabled = true; btn.textContent = files.length ? 'Sending photos…' : 'Sending…';
    try {
      const payload = {
        action: 'submit',
        contact: { name: c.name.trim(), company: c.company.trim(), phone: c.phone.trim(), email: c.email.trim(), city: '' },
        answers: { v: 2, product: st.product, metal: { iso: st.iso, group: st.group, groupName: st.groupName, code: st.sub, typed: st.typed },
          operation: st.operation, duty: st.duty, line: st.line, grade: st.grade, issues: st.issues, extras: st.extras },
        summary: summary(), note: st.extras.note || '',
        files: files.map((f) => ({ name: f.name, mime: f.mime, data: f.data })),
        website: c.website || '', elapsedMs: Date.now() - START,
      };
      // text/plain keeps it a simple request: Apps Script cannot answer a CORS preflight.
      const r = await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })).json();
      if (!r.ok) throw new Error(r.error || 'The request was not accepted.');
      try { localStorage.removeItem(DRAFT); } catch (e) { /* fine */ }
      done(r.id);
    } catch (e) {
      err.textContent = `${e.message} If it keeps failing, WhatsApp us on +91 8660234766.`;
      btn.disabled = false; btn.textContent = 'Send';
    }
  }
  function done(id) {
    const s = el(`<section class="done">${I.tick}<h1>Request sent</h1><p class="rid">${esc(id)}</p>
      <p class="sub">We'll study your job and send your recommendation to ${esc(st.contact.email)}.</p>
      <button type="button" class="link">Start another request</button></section>`);
    s.classList.add('screen', 'enter');
    stage.querySelectorAll('.screen').forEach((x) => x.remove());
    document.body.classList.remove('dark');
    document.querySelector('.logo').src = '../assets/toolflux-logo.svg';
    stage.append(s);
    document.getElementById('back').hidden = true;
    document.getElementById('cut').style.transform = 'scaleX(1)';
    document.getElementById('tip').style.transform = `translateX(${document.querySelector('.track').clientWidth - 10}px)`;
    document.getElementById('count').textContent = '';
    s.querySelector('.link').onclick = () => { st = blank(); files = []; history.replaceState({ step: 0 }, '', ''); show(0, -1, false); };
  }

  // ------------------------------------------------------------ start
  document.querySelector('.track .tip').innerHTML = I.tip;
  const resume = load();
  history.replaceState({ step: 0 }, '', '');
  const at = Math.max(0, Math.min(resume, path().length - 1));
  for (let i = 1; i <= at; i += 1) history.pushState({ step: i }, '', '');
  show(at, 1, false);
}());
