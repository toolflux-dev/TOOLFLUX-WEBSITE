/* Drawing to STEP — order form: files, validation, upload, Razorpay, confirmation.
 * Backend: dts-sync.gs (Apps Script). Paste its /exec URL into DTS_URL after deploying.
 * On localhost, ?demo=1 runs the whole flow against a fake backend and a fake checkout. */
(function (root) {
  'use strict';

  var DTS_URL = ''; // ← Apps Script web-app URL (…/exec). Empty = ordering shows the WhatsApp fallback.
  var WHATSAPP = 'https://wa.me/918660234766';
  var MAX_FILES = 3, MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL = 15 * 1024 * 1024;
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

  var api = { ext: ext, kind: kind, fmtSize: fmtSize, needsShrink: needsShrink, checkFiles: checkFiles, checkField: checkField };
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
  var files = [];      // { file, name, size, url }
  var pending = null;  // created order awaiting payment

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
  var payBtn = $('pay'), note = $('pay-note'), summary = $('summary');
  var noteDefault = note.textContent;
  if (!DTS_URL && !demo) {
    note.innerHTML = 'Online ordering opens shortly. Until then, WhatsApp the drawing to <a style="color:inherit" href="' + WHATSAPP + '">+91 86602 34766</a> and pay ₹79 by UPI.';
    payBtn.textContent = 'Send on WhatsApp';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!DTS_URL && !demo) { location.href = WHATSAPP + '?text=' + encodeURIComponent('Drawing to STEP order: ' + ($('part').value || 'part drawing')); return; }
    if (pending) { return openCheckout(pending); }
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

  function busy(on, text) {
    payBtn.disabled = on; form.setAttribute('aria-busy', on ? 'true' : 'false');
    if (text) payBtn.textContent = text;
  }

  async function submit() {
    try {
      busy(true, 'Preparing files…');
      var packed = [];
      for (var i = 0; i < files.length; i++) packed.push(await pack(files[i]));
      var total = packed.reduce(function (s, f) { return s + f.bytes; }, 0);
      if (total > MAX_TOTAL) throw userErr('The files are over 15 MB together. Send a smaller PDF or fewer photos.');
      busy(true, 'Uploading ' + fmtSize(total) + '…');
      var units = form.querySelector('input[name=units]:checked').value;
      var res = await post({
        action: 'create', part: $('part').value, material: $('material').value, units: units,
        name: $('name').value, company: $('company').value, email: $('email').value, phone: $('phone').value, notes: $('notes').value,
        files: packed.map(function (f) { return { name: f.name, b64: f.b64 }; })
      });
      if (!res.ok) throw userErr(res.message || 'The upload did not go through. Try again, or WhatsApp us the drawing.');
      pending = res;
      openCheckout(res);
    } catch (err) {
      busy(false, 'Pay ₹79 and send');
      note.textContent = err.user ? err.message : 'The connection dropped during upload. Nothing was charged. Try again.';
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
        c.toBlob(function (b) { b ? read(b, f.name.replace(/\.[^.]+$/, '') + '.jpg').then(resolve, reject) : reject(new Error('encode')); }, 'image/jpeg', 0.9);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  // ── payment ──
  function openCheckout(o) {
    busy(true, 'Opening payment…');
    loadRazorpay().then(function (Rzp) {
      var rz = new Rzp({
        key: o.keyId, order_id: o.rzpOrderId, amount: o.amount, currency: 'INR',
        name: 'TOOLFLUX', description: 'Drawing to STEP · ' + o.orderId,
        prefill: { name: o.name, email: o.email, contact: o.phone },
        notes: { order: o.orderId }, theme: { color: '#007a91' },
        handler: function (r) { confirm(o, r); },
        modal: { ondismiss: function () { notPaid(o); } }
      });
      rz.on('payment.failed', function () { /* Razorpay shows its own retry; dismiss lands in notPaid */ });
      rz.open();
    }, function () {
      busy(false, 'Pay ₹79');
      note.textContent = 'The payment window did not load. Check the connection and press Pay again. Your drawing is saved.';
    });
  }

  function notPaid(o) {
    busy(false, 'Pay ₹79');
    note.textContent = 'Payment not finished. Your drawing is saved under order ' + o.orderId + '. Press Pay to try again; unpaid orders are deleted after 3 days.';
  }

  async function confirm(o, r) {
    busy(true, 'Confirming payment…');
    var res = null;
    try { res = await post({ action: 'verify', orderId: o.orderId, razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature }); }
    catch (e) { res = null; }
    if (res && res.ok) return done(o);
    // The reply was lost or the check failed: ask the server, which asks Razorpay.
    for (var i = 0; i < 4; i++) {
      await wait(2500 * (i + 1));
      try { var s = await post({ action: 'status', orderId: o.orderId, email: o.email }); if (s.ok && s.status !== 'awaiting_payment') return done(o); } catch (e) { /* retry */ }
    }
    busy(false, 'Pay ₹79');
    note.innerHTML = 'We could not confirm the payment yet. If money left your account, it is safe: WhatsApp <a style="color:inherit" href="' + WHATSAPP + '?text=' + encodeURIComponent('Payment check for ' + o.orderId) + '">your order number ' + o.orderId + '</a> and we will check it.';
  }

  function done(o) {
    pending = null;
    var box = doc.createElement('div');
    box.className = 'done'; box.setAttribute('role', 'status'); box.tabIndex = -1;
    box.innerHTML = '<h3>Paid. We have your drawing.</h3>' +
      '<p>Order <span class="oid"></span>. A confirmation is on its way to <b class="em"></b>.</p>' +
      '<p>We read the drawing and model the part next. If anything is unclear, we will email you before modelling. The STEP file comes to the same address.</p>' +
      '<p><button type="button" class="btn btn-quiet" id="again">Send another drawing</button></p>';
    box.querySelector('.oid').textContent = o.orderId;
    box.querySelector('.em').textContent = o.email;
    form.replaceChildren(box);
    box.focus();
    $('again').addEventListener('click', function () { location.reload(); });
    note.textContent = noteDefault;
  }

  var rzpPromise = null;
  function loadRazorpay() {
    if (demo) return Promise.resolve(FakeRzp);
    if (root.Razorpay) return Promise.resolve(root.Razorpay);
    return rzpPromise || (rzpPromise = new Promise(function (resolve, reject) {
      var s = doc.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = function () { root.Razorpay ? resolve(root.Razorpay) : reject(); };
      s.onerror = function () { rzpPromise = null; reject(); };
      doc.head.appendChild(s);
    }));
  }

  // text/plain keeps it a simple request: Apps Script cannot answer a CORS preflight.
  async function post(body) {
    if (demo) return fakeBackend(body);
    var r = await fetch(DTS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    return r.json();
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ───────── localhost demo: fake backend + fake checkout ─────────
  var demoState = {};
  async function fakeBackend(b) {
    await wait(600);
    if (b.action === 'create') {
      if (/fail-upload/.test(b.notes)) return { ok: false, error: 'invalid', message: 'Demo: upload refused.' };
      var id = 'DTS-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-DEMO';
      demoState[id] = 'awaiting_payment';
      return { ok: true, orderId: id, rzpOrderId: 'order_demo', keyId: 'rzp_test_demo', amount: 7900, name: b.name, email: b.email, phone: b.phone };
    }
    if (b.action === 'verify') { demoState[b.orderId] = 'paid'; return { ok: true, status: 'paid' }; }
    if (b.action === 'status') return { ok: true, status: demoState[b.orderId] === 'paid' ? 'in_progress' : 'awaiting_payment' };
    return { ok: false };
  }
  function FakeRzp(opts) { this.o = opts; }
  FakeRzp.prototype.on = function () {};
  FakeRzp.prototype.open = function () {
    var o = this.o;
    setTimeout(function () {
      var pay = /fail-pay/.test($('notes').value) ? false : root.confirm('Demo checkout: pay ₹79 for ' + o.description + '?');
      if (pay) o.handler({ razorpay_order_id: o.order_id, razorpay_payment_id: 'pay_demo', razorpay_signature: 'sig_demo' });
      else o.modal.ondismiss();
    }, 200);
  };
})(typeof window !== 'undefined' ? window : globalThis);
