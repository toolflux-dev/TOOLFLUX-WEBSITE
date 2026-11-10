/* TOOLFLUX price admin — upload a supplier PDF / Excel, let Gemini read and categorise it,
   check the rows, publish the cleaned list to the website repo through the GitHub API.
   Keys live in this browser's localStorage only. The source file is never uploaded to GitHub. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const CFG_KEY = 'tfx-pl-cfg', DRAFT_KEY = 'tfx-pl-draft';
  const DEFAULTS = { gemini: '', model: 'gemini-2.5-flash', token: '', repo: 'toolflux-dev/TOOLFLUX-WEBSITE', branch: 'main', site: 'https://www.toolflux.co.in/prices.html' };
  const PAGES_PER_BATCH = 3, ROWS_PER_BATCH = 150, PARALLEL = 2;

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Browser storage is full. Publish or discard soon'); return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const cfg = () => Object.assign({}, DEFAULTS, store.get(CFG_KEY, {}));

  // Work state: the list being built or edited.
  let W = null;          // { id, title, effective, note, currency, items, editing }
  let published = [];    // index.lists from the repo
  let filter = 'all';

  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }
  window.addEventListener('scroll', () => $('top').classList.toggle('scrolled', scrollY > 4), { passive: true });

  /* ---------------- GitHub ---------------- */
  const b64 = str => { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  async function gh(path, opts = {}) {
    const c = cfg();
    const r = await fetch('https://api.github.com/repos/' + c.repo + path, Object.assign({}, opts, {
      headers: Object.assign({ Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, opts.headers || {}),
    }));
    if (r.status === 404 && !opts.method) return null;
    if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch (e) { /* */ } throw new Error('GitHub ' + r.status + (m ? ': ' + m : '')); }
    return opts.raw ? r.text() : r.json();
  }
  const ref = () => '?ref=' + encodeURIComponent(cfg().branch);
  async function ghList() { const l = await gh('/contents/pricelists' + ref()); return Array.isArray(l) ? l : []; }
  async function ghRead(name) { const t = await gh('/contents/pricelists/' + name + ref(), { raw: true, headers: { Accept: 'application/vnd.github.raw+json' } }); return t == null ? null : JSON.parse(t); }
  async function ghWrite(name, text, sha, message) {
    return gh('/contents/pricelists/' + name, { method: 'PUT', body: JSON.stringify({ message, content: b64(text), branch: cfg().branch, sha: sha || undefined }) });
  }
  async function ghDelete(name, sha, message) {
    return gh('/contents/pricelists/' + name, { method: 'DELETE', body: JSON.stringify({ message, sha, branch: cfg().branch }) });
  }

  // One item per line, so each price change is one line in git history.
  function listJSON(l) {
    const head = { id: l.id, title: l.title, effective: l.effective, note: l.note, currency: l.currency || 'INR', updated: new Date().toISOString().slice(0, 10) };
    const items = l.items.map(it => JSON.stringify({ code: it.code, desc: it.desc, cat: it.cat, sub: it.sub, iso: it.iso || undefined, specs: Object.keys(it.specs || {}).length ? it.specs : undefined, unit: it.unit, price: it.price }));
    return JSON.stringify(head).slice(0, -1) + ',"items":[\n' + items.join(',\n') + '\n]}\n';
  }

  async function loadPublished() {
    const c = cfg();
    if (!c.token) {
      $('setupNote').innerHTML = '<p class="notice">Add your Gemini key and GitHub token in <a href="#" data-open-settings>Settings</a> to start. Both stay in this browser.</p>';
      $('pubRows').innerHTML = '<tr><td colspan="5" class="dash">Connect GitHub in Settings to see what is published.</td></tr>';
      return;
    }
    $('setupNote').innerHTML = c.gemini ? '' : '<p class="notice">Add a Gemini API key in <a href="#" data-open-settings>Settings</a> so files can be read.</p>';
    try {
      const idx = await ghRead('index.json');
      published = (idx && idx.lists) || [];
      renderPublished();
    } catch (e) {
      $('pubRows').innerHTML = `<tr><td colspan="5"><span style="color:var(--negative)">Couldn’t read the repository: ${PL.esc(e.message)}.</span> <button class="btn ghost" type="button" data-act="reload">Retry</button></td></tr>`;
    }
  }
  function renderPublished() {
    const total = published.reduce((s, l) => s + (l.count || 0), 0);
    $('pubMeta').textContent = published.length ? `${published.length} list${published.length === 1 ? '' : 's'} · ${PL.fmtCount(total)} items` : '';
    $('pubRows').innerHTML = published.length ? published.map(l => `<tr>
        <td><strong>${PL.esc(l.title)}</strong>${l.note ? `<span class="sub" style="display:block;color:var(--muted);font-size:12px">${PL.esc(l.note)}</span>` : ''}</td>
        <td class="n num">${PL.fmtCount(l.count || 0)}</td>
        <td>${PL.fmtDate(l.effective) || '<span class="dash">–</span>'}</td>
        <td>${PL.fmtDate(l.updated) || '<span class="dash">–</span>'}</td>
        <td class="n" style="white-space:nowrap"><button class="btn ghost" type="button" data-edit="${PL.esc(l.id)}">Edit</button><button class="btn ghost" type="button" data-remove="${PL.esc(l.id)}" style="color:var(--negative)">Remove</button></td>
      </tr>`).join('')
      : '<tr><td colspan="5" class="dash">Nothing published yet. Customers see “The price list is being updated”.</td></tr>';
  }

  /* ---------------- Gemini ---------------- */
  const SCHEMA = {
    type: 'OBJECT',
    properties: {
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            code: { type: 'STRING' }, desc: { type: 'STRING' },
            cat: { type: 'STRING', enum: PL.CATEGORIES.map(c => c.id) },
            sub: { type: 'STRING' }, iso: { type: 'STRING' },
            specs: { type: 'ARRAY', items: { type: 'OBJECT', properties: { k: { type: 'STRING' }, v: { type: 'STRING' } }, required: ['k', 'v'] } },
            unit: { type: 'STRING' }, price: { type: 'NUMBER', nullable: true },
          },
          required: ['code', 'desc', 'cat', 'sub', 'price'],
        },
      },
    },
    required: ['items'],
  };

  function knownSubs() {
    const m = {};
    PL.CATEGORIES.forEach(c => m[c.id] = new Set(c.subs));
    (W && W.items || []).forEach(it => it.sub && m[it.cat] && m[it.cat].add(it.sub));
    return PL.CATEGORIES.map(c => `- ${c.id} (${c.name})${m[c.id].size ? ': ' + [...m[c.id]].join(', ') : ''}`).join('\n');
  }

  function prompt(where, hideMakers) {
    return `You are extracting a cutting-tool PRICE LIST for TOOLFLUX, a carbide tool supplier in India. ${where}

Return every orderable item as one row:
- code: the part number / designation exactly as printed (keep letters, digits, dashes). If one designation is priced in several grades or variants in separate columns, make one row per grade with the grade appended after a space, e.g. "CNMG120408-PM TFX-P25".
- desc: a short plain-English description a machinist understands, max 80 characters (type, size). ${hideMakers ? 'Do NOT include any manufacturer, brand, supplier or company names, catalogue page numbers or source references.' : 'Keep product names as printed.'}
- cat: one of these category ids, and sub: a type inside it. Reuse a listed type when it fits; only invent a new short type when none fits.
${knownSubs()}
- iso: ISO 513 application letters (P, M, K, N, S, H — several allowed, e.g. "PM") only when the list states them or the grade is clearly marked for them; otherwise "".
- specs: up to 4 short facts a buyer chooses by, e.g. Grade, Ø, Corner R, Flutes, Length, Shank, Taper, Pitch. Values with units.
- unit: pc, box, set or m, as printed (default pc). If a price is per box of 10, unit "box of 10".
- price: the LIST price as a plain number in the list's currency, copied exactly. Never compute, convert, discount or add tax. If the item has no price, null.

Skip headings, column titles, terms and conditions, totals, and pictures. Do not invent rows. If the pages contain no price rows, return {"items":[]}.`;
  }

  async function gemini(parts) {
    const c = cfg();
    const gen = { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0, maxOutputTokens: 65536 };
    if (/flash/.test(c.model)) gen.thinkingConfig = { thinkingBudget: 0 };
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${c.model}:generateContent?key=${encodeURIComponent(c.gemini)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: gen }),
      });
      if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 4000 * (attempt + 1))); continue; }
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || 'Gemini HTTP ' + r.status);
      const cand = j.candidates && j.candidates[0];
      const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
      if (cand && cand.finishReason === 'MAX_TOKENS') throw new Error('Too many rows for one call. Split the file into smaller parts');
      try { return JSON.parse(text).items || []; } catch (e) { throw new Error('AI reply was not valid data'); }
    }
    throw new Error('Gemini is busy. Retry this batch');
  }

  /* ---------------- reading the file ---------------- */
  const toB64 = bytes => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };

  async function batchesFor(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      const n = src.getPageCount(), out = [];
      for (let s = 0; s < n; s += PAGES_PER_BATCH) {
        const e = Math.min(n, s + PAGES_PER_BATCH);
        out.push({
          label: n === 1 ? 'Page 1' : `Pages ${s + 1}–${e} of ${n}`,
          make: async () => {
            const doc = await PDFLib.PDFDocument.create();
            (await doc.copyPages(src, Array.from({ length: e - s }, (_, i) => s + i))).forEach(p => doc.addPage(p));
            return [{ inline_data: { mime_type: 'application/pdf', data: toB64(await doc.save()) } }];
          },
          where: `These are pages ${s + 1} to ${e} of a ${n}-page PDF.`,
        });
      }
      return out;
    }
    // Excel / CSV: read locally, send as CSV text in slices that keep the header rows.
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const out = [];
    wb.SheetNames.forEach(sheet => {
      const lines = XLSX.utils.sheet_to_csv(wb.Sheets[sheet], { blankrows: false }).split('\n').filter(l => l.replace(/,/g, '').trim());
      if (!lines.length) return;
      const head = lines.slice(0, 3);
      for (let s = 3; s < Math.max(lines.length, 4); s += ROWS_PER_BATCH) {
        const body = lines.slice(s, s + ROWS_PER_BATCH);
        const label = `${sheet}: rows ${s + 1}–${Math.min(lines.length, s + ROWS_PER_BATCH)}`;
        out.push({
          label,
          make: async () => [{ text: 'CSV:\n' + head.concat(body).join('\n') }],
          where: `This is sheet "${sheet}" of a spreadsheet, given as CSV. The first lines are the sheet's header rows; extract rows only from the lines after them${s === 3 ? ', and from the header lines too if they hold priced items' : ''}.`,
        });
      }
    });
    return out;
  }

  let jobs = [];
  async function readFile(file) {
    if (!cfg().gemini) { openSettings(); toast('Add a Gemini key first'); return; }
    if (!$('fTitle').value.trim()) $('fTitle').value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    syncMeta();
    $('extract').hidden = false;
    $('batches').innerHTML = '<div class="batch"><span>Opening the file…</span></div>';
    try { jobs = (await batchesFor(file)).map(b => Object.assign(b, { state: 'wait', rows: [] })); }
    catch (e) { $('batches').innerHTML = `<div class="batch err"><span>Couldn’t open this file: ${PL.esc(e.message)}</span></div>`; return; }
    if (!jobs.length) { $('batches').innerHTML = '<div class="batch err"><span>The file has no pages or rows.</span></div>'; return; }
    drawJobs();
    let next = 0;
    const worker = async () => { while (next < jobs.length) await runJob(jobs[next++]); };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    finishReading();
  }
  async function runJob(j) {
    j.state = 'run'; j.err = ''; drawJobs();
    try {
      const raw = await gemini((await j.make()).concat({ text: prompt(j.where, $('fHide').checked) }));
      j.rows = raw.map(PL.cleanItem); j.state = 'done';
    } catch (e) { j.state = 'err'; j.err = e.message; }
    drawJobs();
  }
  function drawJobs() {
    const done = jobs.filter(j => j.state === 'done' || j.state === 'err').length;
    $('barFill').style.width = (100 * done / jobs.length) + '%';
    $('batches').innerHTML = jobs.map((j, i) => `<div class="batch ${j.state === 'err' ? 'err' : ''}">
      <span>${PL.esc(j.label)}</span>
      <span class="st">${j.state === 'wait' ? 'Waiting' : j.state === 'run' ? 'Reading…' : j.state === 'done' ? PL.fmtCount(j.rows.length) + ' rows' : PL.esc(j.err)}</span>
      ${j.state === 'err' ? `<button class="btn ghost" type="button" data-retry="${i}">Retry</button>` : '<span></span>'}
    </div>`).join('');
  }
  function finishReading() {
    const fresh = jobs.flatMap(j => j.rows);
    W.items = W.items.concat(fresh);
    jobs.forEach(j => { if (j.state === 'done') j.rows = []; });
    saveDraft(); renderReview();
    const failed = jobs.filter(j => j.state === 'err').length;
    toast(failed ? `${fresh.length} rows read · ${failed} batch${failed > 1 ? 'es' : ''} failed, retry below` : `${fresh.length} rows read`);
  }

  /* ---------------- review ---------------- */
  function syncMeta() {
    if (!W) return;
    W.title = $('fTitle').value.trim(); W.effective = $('fDate').value; W.note = $('fNote').value.trim();
    saveDraft();
  }
  function saveDraft() { if (W) store.set(DRAFT_KEY, W); }

  const catOptions = sel => PL.CATEGORIES.map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${PL.esc(c.name)}</option>`).join('');
  function renderReview() {
    if (!W || !W.items.length) { $('review').hidden = true; return; }
    $('review').hidden = false;
    const probs = PL.problems(W.items);
    $('fFlag').textContent = `Needs a look ${probs.size}`;
    $('fAll').textContent = `All ${PL.fmtCount(W.items.length)}`;
    const counts = {};
    W.items.forEach(it => counts[it.cat] = (counts[it.cat] || 0) + 1);
    $('catsum').innerHTML = PL.CATEGORIES.filter(c => counts[c.id]).map(c => `<span class="pill${c.id === 'other' ? ' warn' : ''}">${PL.esc(c.name)} ${counts[c.id]}</span>`).join('');
    const subs = new Set(); W.items.forEach(it => it.sub && subs.add(it.sub)); PL.CATEGORIES.forEach(c => c.subs.forEach(s => subs.add(s)));
    $('subList').innerHTML = [...subs].map(s => `<option value="${PL.esc(s)}">`).join('');
    const idx = W.items.map((_, i) => i).filter(i => filter === 'all' || probs.has(i));
    $('revRows').innerHTML = idx.length ? idx.map(i => {
      const it = W.items[i], p = probs.get(i);
      const specs = Object.entries(it.specs || {}).map(([k, v]) => k + ': ' + v).join('; ');
      return `<tr data-i="${i}" class="${p ? 'flag' : ''}">
        <td><input data-k="code" value="${PL.esc(it.code)}" aria-label="Part number">${p ? `<span class="why">${p.join(' · ')}</span>` : ''}</td>
        <td><input data-k="desc" value="${PL.esc(it.desc)}" aria-label="Description"></td>
        <td><select data-k="cat" aria-label="Category">${catOptions(it.cat)}</select></td>
        <td><input data-k="sub" list="subList" value="${PL.esc(it.sub)}" aria-label="Type"></td>
        <td><input data-k="iso" value="${PL.esc(it.iso)}" maxlength="6" aria-label="ISO group"></td>
        <td><input data-k="specs" value="${PL.esc(specs)}" placeholder="Grade: TFX-P25; Ø: 10 mm" aria-label="Specifications"></td>
        <td><input data-k="unit" value="${PL.esc(it.unit)}" aria-label="Unit"></td>
        <td><input data-k="price" class="n" inputmode="decimal" value="${it.price == null ? '' : it.price}" aria-label="List price"></td>
        <td><button class="del" type="button" data-del="${i}" aria-label="Delete row"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="margin:auto"><path d="m4 4 8 8M12 4l-8 8"/></svg></button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="9"><p class="empty" style="margin:12px 0">Every row has a part number, a price and a category.</p></td></tr>';
  }
  $('revRows').addEventListener('change', e => {
    const k = e.target.dataset.k, tr = e.target.closest('tr[data-i]');
    if (!k || !tr) return;
    const it = W.items[+tr.dataset.i];
    if (k === 'specs') {
      it.specs = {};
      e.target.value.split(';').forEach(p => { const m = p.split(':'); if (m.length > 1 && m[0].trim()) it.specs[m[0].trim()] = m.slice(1).join(':').trim(); });
    } else if (k === 'price') {
      it.price = PL.cleanItem({ price: e.target.value }).price;
    } else if (k === 'iso') {
      it.iso = PL.cleanItem({ iso: e.target.value }).iso; e.target.value = it.iso;
    } else it[k] = e.target.value.trim();
    saveDraft();
    if (k === 'cat' || k === 'code' || k === 'price') renderReview();
  });
  $('revRows').addEventListener('click', e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    W.items.splice(+b.dataset.del, 1); saveDraft(); renderReview();
  });
  document.querySelector('.seg').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', x === b));
    renderReview();
  });
  $('addRow').addEventListener('click', () => {
    W.items.unshift(PL.cleanItem({ cat: 'other' })); saveDraft(); filter = 'all';
    document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', x.dataset.f === 'all'));
    renderReview(); $('revRows').querySelector('input').focus();
  });

  /* ---------------- start, edit, discard ---------------- */
  function openWork(list) {
    W = list;
    $('work').hidden = false;
    $('workTitle').textContent = W.editing ? 'Edit ' + (W.title || 'price list') : 'New price list';
    $('fTitle').value = W.title || ''; $('fDate').value = W.effective || new Date().toISOString().slice(0, 10); $('fNote').value = W.note || '';
    $('extract').hidden = true; $('batches').innerHTML = '';
    $('drop').querySelector('strong').textContent = W.editing ? 'Add rows from another file' : 'Choose a PDF, Excel or CSV file';
    syncMeta(); renderReview();
    $('work').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('addBtn').addEventListener('click', () => {
    if (W && W.items.length && !confirm('Discard the unpublished list “' + (W.title || 'untitled') + '” and start a new one?')) return;
    openWork({ id: '', title: '', effective: '', note: '', currency: 'INR', items: [], editing: false });
  });
  $('discard').addEventListener('click', () => {
    if (W && W.items.length && !confirm(`Discard ${W.items.length} unpublished rows? Published prices stay as they are.`)) return;
    W = null; store.del(DRAFT_KEY); $('work').hidden = true; $('review').hidden = true;
  });
  ['fTitle', 'fDate', 'fNote'].forEach(id => $(id).addEventListener('input', syncMeta));
  $('fFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) readFile(f); });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  $('batches').addEventListener('click', async e => {
    const b = e.target.closest('[data-retry]'); if (!b) return;
    const j = jobs[+b.dataset.retry];
    await runJob(j);
    if (j.state === 'done') { W.items = W.items.concat(j.rows); j.rows = []; saveDraft(); renderReview(); toast('Batch read'); }
  });

  $('pubRows').addEventListener('click', async e => {
    if (e.target.closest('[data-act="reload"]')) return loadPublished();
    const ed = e.target.closest('[data-edit]'), rm = e.target.closest('[data-remove]');
    if (ed) {
      if (W && W.items.length && !confirm('Discard the unpublished list you are working on?')) return;
      try {
        const meta = published.find(l => l.id === ed.dataset.edit);
        const l = await ghRead(meta.file || meta.id + '.json');
        openWork({ id: l.id, title: l.title, effective: l.effective, note: l.note, currency: l.currency || 'INR', items: (l.items || []).map(PL.cleanItem), editing: true });
      } catch (err) { toast('Couldn’t open it: ' + err.message); }
    }
    if (rm) {
      const meta = published.find(l => l.id === rm.dataset.remove);
      if (!confirm(`Remove “${meta.title}” (${meta.count} items) from the customer page? This cannot be undone from here.`)) return;
      try {
        const files = await ghList();
        const f = files.find(x => x.name === (meta.file || meta.id + '.json'));
        published = published.filter(l => l.id !== meta.id);
        await writeIndex(files, 'Price list: remove ' + meta.title);
        if (f) await ghDelete(f.name, f.sha, 'Price list: remove ' + meta.title);
        renderPublished(); toast('Removed. The customer page updates in about a minute.');
      } catch (err) { toast('Couldn’t remove: ' + err.message); loadPublished(); }
    }
  });

  /* ---------------- preview + publish ---------------- */
  $('previewBtn').addEventListener('click', () => { syncMeta(); if (!W.id) W.id = PL.slug(W.title); saveDraft(); window.open('prices.html?draft=1', '_blank', 'noopener'); });

  async function writeIndex(files, message) {
    const f = files.find(x => x.name === 'index.json');
    const body = { updated: new Date().toISOString().slice(0, 10), lists: published };
    await ghWrite('index.json', JSON.stringify(body, null, 1) + '\n', f && f.sha, message);
  }

  $('publishBtn').addEventListener('click', async () => {
    syncMeta();
    const c = cfg();
    if (!c.token) { openSettings(); return; }
    if (!W.title) { $('fTitle').focus(); toast('Give the list a title customers will see'); return; }
    const probs = PL.problems(W.items);
    const noPrice = W.items.filter(it => it.price == null).length;
    if (!confirm(`Publish “${W.title}” with ${W.items.length} items?` + (probs.size ? `\n\n${probs.size} rows still need a look (${noPrice} without a price show as “On request”).` : '') + '\n\nCustomers see it in about a minute.')) return;
    const btn = $('publishBtn'); btn.disabled = true; btn.textContent = 'Publishing…';
    try {
      const files = await ghList();
      if (!W.id) {
        let id = PL.slug(W.title), n = 2;
        while (published.some(l => l.id === id)) id = PL.slug(W.title) + '-' + n++;
        W.id = id;
      }
      const name = W.id + '.json';
      const f = files.find(x => x.name === name);
      await ghWrite(name, listJSON(W), f && f.sha, (f ? 'Price list: update ' : 'Price list: add ') + W.title);
      const entry = { id: W.id, title: W.title, effective: W.effective, note: W.note, count: W.items.length, file: name, updated: new Date().toISOString().slice(0, 10) };
      published = published.filter(l => l.id !== W.id).concat(entry);
      await writeIndex(await ghList(), 'Price list index: ' + W.title);
      store.del(DRAFT_KEY); W = null;
      $('work').hidden = true; $('review').hidden = true;
      renderPublished(); toast('Published. Live in about a minute.');
    } catch (err) { toast('Publish failed: ' + err.message); }
    btn.disabled = false; btn.textContent = 'Publish';
  });

  /* ---------------- settings ---------------- */
  function openSettings() {
    const c = cfg();
    $('sGemini').value = c.gemini; $('sModel').value = c.model; $('sToken').value = c.token; $('sRepo').value = c.repo; $('sBranch').value = c.branch; $('sSite').value = c.site;
    $('setMsg').textContent = ''; $('settings').showModal();
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-open-settings], #openSettings')) { e.preventDefault(); openSettings(); } });
  $('saveSettings').addEventListener('click', e => {
    e.preventDefault();
    store.set(CFG_KEY, { gemini: $('sGemini').value.trim(), model: $('sModel').value, token: $('sToken').value.trim(), repo: $('sRepo').value.trim() || DEFAULTS.repo, branch: $('sBranch').value.trim() || 'main', site: $('sSite').value.trim() || DEFAULTS.site });
    $('settings').close(); $('custLink').value = cfg().site; loadPublished(); toast('Saved in this browser');
  });
  $('copyLink').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('custLink').value); toast('Link copied'); } catch (e) { $('custLink').select(); } });

  /* ---------------- boot ---------------- */
  $('custLink').value = cfg().site;
  const draft = store.get(DRAFT_KEY, null);
  if (draft && draft.items) { openWork(draft); toast('Restored your unpublished list'); }
  loadPublished();
})();
