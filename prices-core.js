/* TOOLFLUX price list — shared logic for prices.html and prices-admin.html.
   Data lives in the website repo, served by GitHub Pages:
     pricelists/index.json        { updated, lists: [{ id, title, effective, note, count, file }] }
     pricelists/<id>.json         { id, title, effective, note, currency, items: [Item] }
   Item: { code, desc, cat, sub, iso, specs: { key: value }, unit, price }
   Only extracted rows are published. The source PDF / Excel never leaves the owner's browser. */
(function (root) {
  'use strict';

  // Top-level families the AI must file every row under. Sub-categories are free but reused.
  const CATEGORIES = [
    { id: 'inserts',    name: 'Inserts',            subs: ['Turning', 'Milling', 'Threading', 'Grooving & parting', 'Drilling', 'CBN & PCD'] },
    { id: 'endmills',   name: 'End mills',          subs: ['Square', 'Ball nose', 'Corner radius', 'Roughing', 'Aluminium'] },
    { id: 'drills',     name: 'Solid drills',       subs: ['Carbide drills', 'HSS drills', 'Spot & centre drills'] },
    { id: 'udrills',    name: 'U-Drills',           subs: ['2D', '3D', '4D', '5D'] },
    { id: 'turning',    name: 'Turning holders',    subs: ['External', 'Boring bars', 'Threading', 'Grooving & parting'] },
    { id: 'milling',    name: 'Milling cutters',    subs: ['Face mills', 'Shoulder mills', 'High-feed', 'Slot & side'] },
    { id: 'holding',    name: 'Toolholders',        subs: ['BT / CAT adaptors', 'Collet chucks', 'Collets', 'Pull studs'] },
    { id: 'threading',  name: 'Taps & thread mills', subs: ['Taps', 'Thread mills'] },
    { id: 'spares',     name: 'Spares',             subs: ['Screws', 'Shims', 'Clamps', 'Keys'] },
    { id: 'other',      name: 'Other',              subs: [] },
  ];
  const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
  const ISO = { P: 'Steel', M: 'Stainless', K: 'Cast iron', N: 'Non-ferrous', S: 'Superalloys', H: 'Hardened' };

  // Search key: lower case, no spaces / dashes / dots / slashes, so "CNMG 12 04 08" finds "CNMG120408".
  const squash = s => String(s == null ? '' : s).toLowerCase().replace(/[\s\-_.\/×x*]+/g, '');
  const words = s => String(s || '').toLowerCase().split(/\s+/).filter(Boolean);

  function indexItem(it) {
    const specs = it.specs ? Object.entries(it.specs).map(([k, v]) => k + ' ' + v).join(' ') : '';
    it._hay = (it.code + ' ' + it.desc + ' ' + it.sub + ' ' + (CAT_BY_ID[it.cat] || {}).name + ' ' + specs).toLowerCase();
    it._sq = squash(it.code) + '|' + squash(it.desc) + '|' + squash(specs);
    return it;
  }

  // Every query word must match, either as plain text or squashed (so part numbers survive spacing).
  function matches(it, q) {
    const ws = words(q);
    return ws.every(w => it._hay.includes(w) || it._sq.includes(squash(w)));
  }
  // Rank: exact code, code prefix, code contains, then the rest.
  function rank(it, q) {
    const c = squash(it.code), s = squash(q);
    if (!s) return 3;
    if (c === s) return 0;
    if (c.startsWith(s)) return 1;
    if (c.includes(s)) return 2;
    return 3;
  }

  const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPrice = (p, cur) => (p == null || isNaN(p)) ? null : ((cur && cur !== 'INR') ? cur + ' ' : '₹') + inr.format(p);
  const fmtCount = n => new Intl.NumberFormat('en-IN').format(n);
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Wrap matched query words in <mark>, on escaped text.
  function highlight(text, q) {
    let out = esc(text);
    const ws = words(q).filter(w => w.length > 1).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!ws.length) return out;
    return out.replace(new RegExp('(' + ws.join('|') + ')', 'gi'), '<mark>$1</mark>');
  }

  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'list';
  }

  // Clean one row coming from the AI or an edit; returns problems for the owner's review.
  function cleanItem(raw) {
    const it = {
      code: String(raw.code || '').trim(),
      desc: String(raw.desc || '').replace(/\s+/g, ' ').trim(),
      cat: CAT_BY_ID[raw.cat] ? raw.cat : 'other',
      sub: String(raw.sub || '').trim(),
      iso: /^[PMKNSH]+$/.test(String(raw.iso || '').toUpperCase()) ? String(raw.iso).toUpperCase() : '',
      specs: {},
      unit: String(raw.unit || 'pc').trim() || 'pc',
      price: raw.price === '' || raw.price == null ? null : Number(String(raw.price).replace(/[^\d.]/g, '')),
    };
    if (it.price != null && (isNaN(it.price) || it.price <= 0)) it.price = null;
    if (raw.specs && typeof raw.specs === 'object') {
      const list = Array.isArray(raw.specs) ? raw.specs : Object.entries(raw.specs).map(([k, v]) => ({ k, v }));
      list.slice(0, 5).forEach(s => { const k = String(s.k || '').trim(), v = String(s.v || '').trim(); if (k && v) it.specs[k] = v; });
    }
    return it;
  }

  function problems(items) {
    const first = new Map(), out = new Map();
    const add = (i, m) => { const a = out.get(i) || []; if (!a.includes(m)) a.push(m); out.set(i, a); };
    items.forEach((it, i) => {
      if (!it.code) add(i, 'No part number');
      if (it.price == null) add(i, 'No price');
      if (it.cat === 'other') add(i, 'Not categorised');
      const k = squash(it.code);
      if (!k) return;
      if (first.has(k)) { add(i, 'Duplicate part number'); add(first.get(k), 'Duplicate part number'); } else first.set(k, i);
    });
    return out;
  }

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
    return r.json();
  }

  // Load every published list and flatten to one array of indexed items.
  async function loadAll(base) {
    base = (base || 'pricelists').replace(/\/$/, '');
    const index = await getJSON(base + '/index.json');
    if (!index || !Array.isArray(index.lists)) return { index: { lists: [] }, lists: [], items: [] };
    const lists = (await Promise.all(index.lists.map(l => getJSON(base + '/' + (l.file || l.id + '.json'))))).filter(Boolean);
    const items = [];
    lists.forEach(l => (l.items || []).forEach(raw => {
      const it = cleanItem(raw);
      it.list = l.id; it.currency = l.currency || 'INR';
      items.push(indexItem(it));
    }));
    return { index, lists, items };
  }

  const api = { CATEGORIES, CAT_BY_ID, ISO, squash, indexItem, matches, rank, fmtPrice, fmtCount, fmtDate, esc, highlight, slug, cleanItem, problems, getJSON, loadAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PL = api;
})(typeof window !== 'undefined' ? window : globalThis);
