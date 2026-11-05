/* Drawing to STEP — order form: files, validation, upload, the TOOLFLUX gear send screen.
 * Free for everyone: no payment step. Backend: dts-sync.gs (Apps Script) at DTS_URL.
 * On localhost, ?demo=1 runs the whole flow against a fake backend (add &fail=1 to see an upload error). */
(function (root) {
  'use strict';

  var DTS_URL = 'https://script.google.com/macros/s/AKfycbwM3b7QEqxiyLwP6eKD0HVWAg2ik1wwtnkV9XKrwEz9W4ySWXhNZiN-cLlcHmCPhoM/exec'; // Apps Script web app (dts-sync.gs). Empty = the form sends people to WhatsApp.
  var WHATSAPP = 'https://wa.me/918660234766';
  var MAX_FILES = 10, MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL = 25 * 1024 * 1024;
  var DRAWING = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif'];
  var CAD = ['dxf', 'dwg'];

  // ───────── pure helpers (tested in tests/dts-order.test.js) ─────────
  function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
  function kind(name) {
    var e = ext(name);
    if (e === 'pdf') return 'pdf';
    if (DRAWING.indexOf(e) >= 0) return 'image';
    if (CAD.indexOf(e) >= 0) return 'cad';
    return 'other';
  }
  function fmtSize(b) { return b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
  // Phone photos are big and sometimes HEIC; re-encode those as JPEG before upload.
  function needsShrink(name, size) { var e = ext(name); return kind(name) === 'image' && (e === 'heic' || e === 'heif' || size > 3 * 1024 * 1024); }

  function checkFiles(files) {
    if (!files.length) return 'Attach the drawing: a PDF or a photo of it.';
    if (files.length > MAX_FILES) return 'Attach at most ' + MAX_FILES + ' files.';
    for (var i = 0; i < files.length; i++) {
      var k = kind(files[i].name);
      if (k === 'other') return files[i].name + ' is not a PDF, photo, DXF or DWG.';
      if (files[i].size > MAX_FILE && !needsShrink(files[i].name, files[i].size)) return files[i].name + ' is over 10 MB.';
    }
    if (!files.some(function (f) { var k = kind(f.name); return k === 'pdf' || k === 'image'; }))
      return 'Add a PDF or photo of the drawing as well. We read the dimensions from it.';
    return '';
  }

  function checkField(name, value) {
    var v = String(value || '').trim();
    switch (name) {
      case 'part': return v ? '' : 'Enter the part name or drawing number.';
      case 'name': return v ? '' : 'Enter your name.';
      case 'email': return !v ? 'Enter the email the STEP file should go to.' : (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'This email looks incomplete, for example name@company.com.');
      case 'phone': var d = v.replace(/\D/g, ''); return d.length >= 10 && d.length <= 13 ? '' : 'Enter a 10-digit mobile number.';
      default: return '';
    }
  }

  var api = { ext: ext, kind: kind, fmtSize: fmtSize, needsShrink: needsShrink, checkFiles: checkFiles, checkField: checkField, MAX_FILES: MAX_FILES };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ───────── page ─────────
  var doc = root.document;
  doc.documentElement.classList.add('js');

  // entrances, once per element
  var rises = doc.querySelectorAll('.rise');
  if ('IntersectionObserver' in root) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    rises.forEach(function (el) { io.observe(el); });
  } else rises.forEach(function (el) { el.classList.add('in'); });

  var form = doc.getElementById('tb');
  if (!form) return;
  var $ = function (id) { return doc.getElementById(id); };
  var demo = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && /[?&]demo=1/.test(location.search);
  var reduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var files = [];      // { file, name, size, url }

  // ── files ──
  var drop = $('drop'), input = $('file'), list = $('files'), fileErr = $('file-err');
  input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer) addFiles(e.dataTransfer.files); });

  function addFiles(fl) {
    Array.prototype.forEach.call(fl || [], function (f) {
      if (files.length >= MAX_FILES) return;
      if (files.some(function (x) { return x.name === f.name && x.size === f.size; })) return;
      files.push({ file: f, name: f.name, size: f.size, url: kind(f.name) === 'image' && /^image\/(png|jpe?g|webp)$/.test(f.type) ? URL.createObjectURL(f) : '' });
    });
    renderFiles();
    fileErr.textContent = files.length ? checkFiles(files) : '';
  }
  function renderFiles() {
    list.innerHTML = '';
    files.forEach(function (f, i) {
      var li = doc.createElement('li');
      var th = doc.createElement('span'); th.className = 'thumb';
      if (f.url) { var im = doc.createElement('img'); im.src = f.url; im.alt = ''; th.appendChild(im); } else th.textContent = (ext(f.name) || 'file').toUpperCase().slice(0, 4);
      var mid = doc.createElement('span');
      mid.innerHTML = '<span class="nm"></span><span class="sz"></span>';
      mid.style.minWidth = '0'; mid.style.display = 'grid';
      mid.firstChild.textContent = f.name; mid.lastChild.textContent = fmtSize(f.size) + (needsShrink(f.name, f.size) ? ' · will be resized' : '');
      var rm = doc.createElement('button'); rm.type = 'button'; rm.textContent = 'Remove'; rm.setAttribute('aria-label', 'Remove ' + f.name);
      rm.addEventListener('click', function (e) { e.stopPropagation(); if (f.url) URL.revokeObjectURL(f.url); files.splice(i, 1); renderFiles(); fileErr.textContent = ''; });
      li.append(th, mid, rm);
      list.appendChild(li);
    });
    drop.classList.toggle('has', files.length > 0);
  }

  // ── field validation on blur, then live once wrong ──
  ['part', 'name', 'email', 'phone'].forEach(function (id) {
    var el = $(id);
    el.addEventListener('blur', function () { if (el.value) showErr(id, checkField(id, el.value)); });
    el.addEventListener('input', function () { if (el.closest('.cell').classList.contains('bad')) showErr(id, checkField(id, el.value)); });
  });
  function showErr(id, msg) {
    var el = $(id), cell = el.closest('.cell');
    $(id + '-err').textContent = msg;
    cell.classList.toggle('bad', !!msg);
    if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
    return msg;
  }

  // ── submit ──
  var sendBtn = $('pay'), note = $('pay-note'), summary = $('summary'), orderNote = doc.querySelector('[data-order-note]');
  var noteDefault = note.textContent;
  var online = !!(DTS_URL || demo);
  if (!online) {
    note.innerHTML = 'Online sending opens shortly. Until then, WhatsApp the drawing to <a style="color:inherit" href="' + WHATSAPP + '">+91 86602 34766</a>.';
    sendBtn.textContent = 'Send on WhatsApp';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!online) { location.href = WHATSAPP + '?text=' + encodeURIComponent('Drawing to STEP: ' + ($('part').value || 'part drawing')); return; }
    var errs = [];
    var fe = checkFiles(files); fileErr.textContent = fe; if (fe) errs.push(['file', fe]);
    ['part', 'name', 'email', 'phone'].forEach(function (id) { var m = showErr(id, checkField(id, $(id).value)); if (m) errs.push([id, m]); });
    if (errs.length) return showSummary(errs);
    summary.hidden = true;
    submit();
  });

  function showSummary(errs) {
    var ul = $('summary-list'); ul.innerHTML = '';
    errs.forEach(function (x) {
      var li = doc.createElement('li'), a = doc.createElement('a');
      a.href = '#' + x[0]; a.textContent = x[1];
      a.addEventListener('click', function (ev) { ev.preventDefault(); $(x[0]).focus(); });
      li.appendChild(a); ul.appendChild(li);
    });
    summary.hidden = false; summary.focus();
  }

  function busy(on) {
    sendBtn.disabled = on; form.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  // ── the TOOLFLUX gear panel that replaces the form once the customer presses Send ──
  var work = $('sending'), workTitle = $('work-title'), workLine = $('work-line'), workSmall = $('work-small');
  var gearSvg = work && work.querySelector('svg'), gearSpin = work && work.getElementsByTagName('animateTransform')[0];
  if (gearSvg && reduced && gearSvg.pauseAnimations) gearSvg.pauseAnimations();
  function stage(kind, info) {
    info = info || {};
    if (!work) return;
    if (orderNote) orderNote.hidden = kind !== 'form';
    if (kind === 'form') { work.hidden = true; form.hidden = false; return; }
    if (kind === 'send') {
      workTitle.textContent = 'Sending your drawing';
      workLine.textContent = 'Keep this page open for a moment.';
      workSmall.textContent = info.size ? info.size + ' on its way to TOOLFLUX' : '';
    } else {
      workTitle.textContent = 'Sit tight.';
      workLine.textContent = 'Your STEP file will arrive by email at ';
      var b = doc.createElement('b'); b.textContent = info.email || 'your email';
      workLine.appendChild(b); workLine.appendChild(doc.createTextNode('.'));
      workSmall.textContent = 'Order ' + info.orderId + '. If anything on the drawing is unclear, we will email you first. Check the spam folder if nothing arrives. ';
      var again = doc.createElement('a'); again.href = location.pathname + '#order'; again.textContent = 'Send another drawing';
      again.addEventListener('click', function (e) { e.preventDefault(); location.hash = 'order'; location.reload(); });
      workSmall.appendChild(again);
    }
    if (gearSpin) gearSpin.setAttribute('dur', kind === 'done' ? '9s' : '2.4s');
    work.classList.toggle('done-state', kind === 'done');
    if (work.hidden) {
      form.hidden = true; work.hidden = false; summary.hidden = true;
      $('order').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
    if (kind === 'done') workTitle.focus({ preventScroll: true });
  }

  async function submit() {
    try {
      busy(true);
      stage('send');
      var packed = [];
      for (var i = 0; i < files.length; i++) packed.push(await pack(files[i]));
      var total = packed.reduce(function (s, f) { return s + f.bytes; }, 0);
      if (total > MAX_TOTAL) throw userErr('The files are over 25 MB together. Send a smaller PDF or fewer photos.');
      stage('send', { size: fmtSize(total) });
      var units = form.querySelector('input[name=units]:checked').value;
      var res = await post({
        action: 'create', part: $('part').value, material: $('material').value, units: units,
        name: $('name').value, company: $('company').value, email: $('email').value, phone: $('phone').value, notes: $('notes').value,
        files: packed.map(function (f) { return { name: f.name, b64: f.b64 }; })
      });
      if (!res || !res.ok) throw userErr((res && res.message) || 'The drawing did not go through. Try again, or WhatsApp it to us.');
      busy(false);
      note.textContent = noteDefault;
      stage('done', { email: res.email || $('email').value, orderId: res.orderId });
    } catch (err) {
      stage('form');
      busy(false);
      note.textContent = err.user ? err.message : 'The connection dropped while sending. Check the connection and press Send again.';
    }
  }

  function userErr(m) { var e = new Error(m); e.user = true; return e; }

  function pack(f) {
    return new Promise(function (resolve, reject) {
      if (needsShrink(f.name, f.size)) return shrink(f).then(resolve, function () {
        f.size > MAX_FILE ? reject(userErr(f.name + ' could not be resized. Send it as a JPEG or PDF under 10 MB.')) : read(f.file, f.name).then(resolve, reject);
      });
      read(f.file, f.name).then(resolve, reject);
    });
  }
  function read(blob, name) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); resolve({ name: name, b64: s.slice(s.indexOf(',') + 1), bytes: blob.size }); };
      r.onerror = function () { reject(userErr('Could not read ' + name + '.')); };
      r.readAsDataURL(blob);
    });
  }
  // Long edge 3200 px keeps small dimension text legible.
  function shrink(f) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(f.file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 3200 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = doc.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (bl) { bl ? read(bl, f.name.replace(/\.[^.]+$/, '') + '.jpg').then(resolve, reject) : reject(new Error('encode')); }, 'image/jpeg', 0.9);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  // text/plain keeps it a simple request: Apps Script cannot answer a CORS preflight.
  async function post(body) {
    if (demo) return fakeBackend(body);
    var r = await fetch(DTS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    return r.json();
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ───────── localhost demo: fake backend ─────────
  async function fakeBackend(b) {
    await wait(1200);
    if (b.action === 'create') {
      if (/[?&]fail=1/.test(location.search)) return { ok: false, error: 'invalid', message: 'Demo: the upload was refused.' };
      return { ok: true, orderId: 'DTS-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-DEMO', email: b.email };
    }
    return { ok: true };
  }
})(typeof window !== 'undefined' ? window : globalThis);
