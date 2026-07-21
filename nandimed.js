/* ══════════════════════════════════════════════════════════════
   NANDI Med — by Flux
   Clinic patient register for Ayurveda / Homeopathy / Physio OPD.
   Single-file vanilla PWA. localStorage-first, optional Sheet sync.
   No paid services required to run.
   ══════════════════════════════════════════════════════════════ */
'use strict';

/* ── Config ──────────────────────────────────────────────────── */
const DB_KEY   = 'nandimed.db.v1';
const SEEN_KEY = 'nandimed.seen';
const TRIAL_DAYS = 15;
// Pre-wired so a new clinic syncs the moment it registers. A doctor never has
// to paste a URL; Settings can still override these if a clinic self-hosts.
const DEFAULT_BACKEND_URL = 'https://script.google.com/macros/s/AKfycbysek9iwOixeXERi7czOGWdjSX0oxX6OKoi8NR_ULxFlQXwEVhjq4b6KWnSpos8UJOwIg/exec';
const DEFAULT_PUBLIC_URL  = 'https://toolflux-dev.github.io/nandimed/';
const LICENSE_GRACE_DAYS   = 5;   // keep working past expiry while renewal syncs
const LICENSE_RECHECK_DAYS = 3;   // how often to re-verify with the backend
const RAZORPAY_PLAN_LINK = 'https://rzp.io/rzp/REPLACE_ME'; // set when a real plan exists
const APP_VERSION = '1.0';

/* ── Tiny helpers ────────────────────────────────────────────── */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digits = s => String(s||'').replace(/\D/g,'');
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const slug = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,28) || 'clinic';

function effectiveNow(){
  const stored = +localStorage.getItem(SEEN_KEY) || 0;
  const now = Date.now();
  const eff = Math.max(now, stored);
  if (now >= stored) localStorage.setItem(SEEN_KEY, String(now));
  return eff;
}
function touchSeen(){ effectiveNow(); }

function fmtDate(ts){ const d=new Date(ts); return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtTime(ts){ const d=new Date(ts); return d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}); }
function fmtDay(ts){ const d=new Date(ts); return d.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'}); }
function isoDate(ts){ const d=new Date(ts); return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); }
function startOfDay(ts){ const d=new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
function relDays(dateStr){
  if(!dateStr) return null;
  const target = startOfDay(new Date(dateStr+'T00:00').getTime());
  const today = startOfDay(effectiveNow());
  return Math.round((target-today)/864e5);
}

/* ── Database ────────────────────────────────────────────────── */
let db;
function freshDB(){
  return {
    v:1,
    clinic:null,          // {name, doctorName, regNo, email, phone, address, clinicId, accessKey, countryCode, trialStartedAt, license, backendUrl, publicUrl}
    patients:{},          // phoneKey -> {phone, name, age, sex, createdAt}
    visits:[],            // newest last
    ui:{ tab:'home', countryCode:'91' }
  };
}
function loadDB(){
  try{ db = JSON.parse(localStorage.getItem(DB_KEY)) || freshDB(); }
  catch(e){ db = freshDB(); }
  if(!db.patients) db.patients={};
  if(!db.visits) db.visits=[];
  if(!db.ui) db.ui={tab:'home'};
  // Clinics registered before the URLs were pre-wired get them filled in once.
  if(db.clinic){
    if(!db.clinic.backendUrl) db.clinic.backendUrl=DEFAULT_BACKEND_URL;
    if(!db.clinic.publicUrl)  db.clinic.publicUrl=DEFAULT_PUBLIC_URL;
  }
  return db;
}
let saveTimer=null;
function saveDB(sync=true){
  touchSeen();
  try{ localStorage.setItem(DB_KEY, JSON.stringify(db)); }catch(e){ toast('Storage full — could not save','err'); }
  if(sync && db.clinic && db.clinic.backendUrl){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(pushSync, 3500);
  }
}

/* ── App state (transient) ───────────────────────────────────── */
const ui = { tab:'home', route:null, draft:null, medSeq:0, invSeq:0, rec:null };

/* ── Icons ───────────────────────────────────────────────────── */
const I = {
  stetho:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v6a5 5 0 0 0 10 0V3"/><path d="M4 3H2m2 0h2M14 3h-2m2 0h2"/><path d="M9 14v2a6 6 0 0 0 12 0v-2"/><circle cx="21" cy="10" r="2"/></svg>',
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-6h5v6"/></svg>',
  users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17 20a5.5 5.5 0 0 0-2.3-4.5"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
  chev:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  wa:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.7 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2Zm5.6 14.2c-.2.6-1.2 1.2-1.7 1.2-.5.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.5-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1-1.4-1-2.6 0-1.2.6-1.8.9-2 .2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .5l-.4.5-.3.3c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.2.1.4.1.5-.1l.7-.9c.2-.2.4-.2.6-.1l1.8.9c.2.1.4.2.5.3.1.2.1.7-.1 1.4Z"/></svg>',
  print:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M7 17h10v4H7z"/></svg>',
  save:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>',
  mic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17l9-10"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  flask:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v6l-4.5 8A2 2 0 0 0 6.3 20h11.4a2 2 0 0 0 1.8-3L15 9V3"/><path d="M8 3h8M7.5 14h9"/></svg>',
  pill:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M8.5 8.5 15 15"/></svg>',
  spark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>',
  heart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.5-9.5-9A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 9.5 5c-2.5 4.5-9.5 9-9.5 9Z"/></svg>',
  file:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 13h6M9 17h6"/></svg>',
  download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
};
const markSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v6a5 5 0 0 0 10 0V3"/><path d="M4 3H2.5m1.5 0h1.5M14 3h-1.5m1.5 0h1.5"/><path d="M9 14v2a6 6 0 0 0 12 0v-2"/><circle cx="21" cy="10" r="1.8"/></svg>';

/* ── Constants for the form ──────────────────────────────────── */
const TEMPERAMENTS = ['Calm','Anxious','Irritable','Cooperative','Talkative','Reserved','Restless','Fearful','Cheerful','Low mood'];
const TIMINGS = ['Morning','Afternoon','Evening','Night'];
const FOODS   = ['Before food','After food'];
const SEXES   = ['Male','Female','Other'];

/* ── Toast ───────────────────────────────────────────────────── */
function toast(msg, kind){
  const el=document.createElement('div');
  el.className='toast'+(kind?' '+kind:'');
  el.innerHTML=(kind==='ok'?I.check:kind==='err'?I.x:'')+'<span>'+esc(msg)+'</span>';
  $('#toasts').appendChild(el);
  setTimeout(()=>{el.style.transition='opacity .3s';el.style.opacity='0';setTimeout(()=>el.remove(),300);},2600);
}

/* ── License / trial ─────────────────────────────────────────── */
function licenseStatus(){
  const c=db.clinic; if(!c) return {state:'none'};
  const lic=c.license;
  const now=effectiveNow();
  if(lic && lic.token && /^NM[0-9A-F]{64}$/.test(lic.token)){
    if(lic.expiresAt && lic.expiresAt>now) return {state:'licensed', plan:lic.plan, until:lic.expiresAt};
    // Renewal may not have synced yet. Keep working for a grace window rather
    // than locking a paying doctor out mid-clinic over a network hiccup.
    if(lic.expiresAt && now-lic.expiresAt < LICENSE_GRACE_DAYS*864e5)
      return {state:'licensed', plan:lic.plan, until:lic.expiresAt, grace:true};
  }
  const started=c.trialStartedAt||now;
  const left=Math.ceil((started+TRIAL_DAYS*864e5-now)/864e5);
  if(left>0) return {state:'trial', left};
  return {state:'expired'};
}
// Quietly re-check the subscription every few days so cancellations and
// renewals both land without the doctor doing anything.
function verifyLicenseIfNeeded(){
  const c=db.clinic;
  if(!c||!c.backendUrl||!c.license||!c.license.email) return;
  const now=effectiveNow(), last=c.license.lastVerified||0;
  if(now-last < LICENSE_RECHECK_DAYS*864e5) return;
  backendFetch('action=verify&email='+encodeURIComponent(c.license.email)+'&token='+encodeURIComponent(c.license.token))
    .then(r=>{
      if(r&&r.valid){
        c.license.expiresAt=r.expiresAt||c.license.expiresAt;
        c.license.lastVerified=now; c.license.strikes=0;
      }else if(r&&r.expired){
        // Server says the subscription lapsed. Three strikes before locking,
        // so one bad response can't wrongly paywall a paying clinic.
        c.license.strikes=(c.license.strikes||0)+1;
        if(c.license.strikes>=3){ c.license=null; }
      }
      saveDB(false);
      if(licenseStatus().state==='expired') render();
    })
    .catch(()=>{});   // offline: leave the license alone
}

/* ══════════════════════════════════════════════════════════════
   BOOT + ROUTER
   ══════════════════════════════════════════════════════════════ */
function render(){
  const app=$('#app');
  if(!db.clinic){ document.body.classList.add('no-nav'); app.innerHTML=vSetup(); afterMount(); return; }
  if(isLocked()){ document.body.classList.add('no-nav'); app.innerHTML=vLock(); afterMount(); const p=$('#lock-pin'); if(p) p.focus(); return; }
  const ls=licenseStatus();
  if(ls.state==='expired'){ document.body.classList.add('no-nav'); app.innerHTML=vPaywall(ls); afterMount(); return; }
  document.body.classList.remove('no-nav');
  let view='';
  // Guard: never render the consult form without a draft behind it.
  if(ui.route==='consult' && !ui.draft){ ui.route=null; ui.tab='home'; }
  if(ui.route==='consult') view=vConsult();
  else if(ui.route==='patient') view=vPatient(ui.routeArg);
  else if(ui.route==='visit') view=vVisitDetail(ui.routeArg);
  else if(ui.tab==='home') view=vHome(ls);
  else if(ui.tab==='patients') view=vPatients();
  else if(ui.tab==='reminders') view=vReminders();
  else if(ui.tab==='settings') view=vSettings();
  app.innerHTML = appbar(ls) + '<div class="wrap view">'+view+'</div>' + navbar();
  afterMount();
  window.scrollTo(0,0);
}
function go(tab){ ui.tab=tab; ui.route=null; render(); }
// NOTE: must NOT be called `open` — inside an inline onclick, bare `open`
// resolves to document.open(), which blanks the page instead of routing.
function openDetail(route,arg){ ui.route=route; ui.routeArg=arg; render(); }
function back(){ ui.route=null; render(); }

function appbar(ls){
  const c=db.clinic;
  let pill='';
  if(ls.state==='trial') pill='<span class="pill '+(ls.left<=3?'warn':'')+'"><span class="dot"></span>'+ls.left+' day'+(ls.left===1?'':'s')+' left</span>';
  else if(ls.state==='licensed') pill='<span class="pill ok"><span class="dot"></span>Active</span>';
  return '<div class="appbar">'
    + '<div class="brand"><div class="mark">'+markSvg+'</div>'
    + '<div class="brand-txt"><div class="n1">NANDI <b>Med</b></div><div class="n2">by Flux</div></div></div>'
    + '<div class="appbar-sp"></div>'+pill+'</div>';
}
function navbar(){
  const t=ui.tab, r=ui.route;
  const on=x=>(!r&&t===x)?'on':'';
  return '<div class="nav">'
    + '<button data-tab="home" class="'+on('home')+'" onclick="go(\'home\')">'+I.home+'<span>Home</span></button>'
    + '<button data-tab="patients" class="'+on('patients')+'" onclick="go(\'patients\')">'+I.users+'Patients</button>'
    + '<div class="fab-wrap"><button class="fab" onclick="newConsult()" aria-label="New consultation">'+I.plus+'</button><span>Consult</span></div>'
    + '<button data-tab="reminders" class="'+on('reminders')+'" onclick="go(\'reminders\')">'+I.bell+'Reminders</button>'
    + '<button data-tab="settings" class="'+on('settings')+'" onclick="go(\'settings\')">'+I.gear+'Settings</button>'
    + '</div>';
}

function afterMount(){
  // focus behaviours, restore chip states handled inline
}

/* ══════════════════════════════════════════════════════════════
   SETUP / REGISTRATION
   ══════════════════════════════════════════════════════════════ */
function vSetup(){
  return '<div class="center-page view">'
  + '<div class="hero-mark">'+markSvg+'</div>'
  + '<h1 style="text-align:center;font-size:1.5rem;letter-spacing:-.02em">NANDI <span style="color:var(--accent)">Med</span></h1>'
  + '<div style="text-align:center;font-size:.6rem;font-weight:700;letter-spacing:.28em;text-transform:uppercase;color:var(--mut-2);margin-top:3px">by Flux</div>'
  + '<p class="note" style="text-align:center;margin:14px auto 18px;max-width:340px">Register your clinic once. Your patient records stay on this device and back up privately to the cloud.</p>'
  + '<div class="block"><div class="block-b">'
  + '<div class="field"><label>Clinic name</label><input class="ctl" id="su-clinic" placeholder="e.g. Shanti Ayurveda Clinic" autocomplete="off"></div>'
  + '<div class="field"><label>Doctor name</label><input class="ctl" id="su-doc" placeholder="Dr. ..." autocomplete="off"></div>'
  + '<div class="grid2"><div class="field"><label>Registration no. <span class="hint">optional</span></label><input class="ctl" id="su-reg" placeholder="Reg / license no."></div>'
  + '<div class="field"><label>Discipline</label><select class="ctl" id="su-disc"><option>Ayurveda</option><option>Homeopathy</option><option>Electro-homeopathy</option><option>Physiotherapy</option><option>General OPD</option></select></div></div>'
  + '<div class="field"><label>Your email</label><input class="ctl" id="su-email" type="email" placeholder="Used for your subscription" autocomplete="off"><div class="hint">This is where your subscription is registered. Not shared with patients.</div></div>'
  + '<div class="grid2"><div class="field"><label>Clinic phone <span class="hint">optional</span></label><input class="ctl" id="su-phone" inputmode="tel" placeholder="Shown on prescription"></div>'
  + '<div class="field"><label>Country code</label><input class="ctl mono" id="su-cc" value="91" inputmode="numeric"></div></div>'
  + '<div class="field"><label>Clinic address <span class="hint">optional</span></label><textarea class="ctl" id="su-addr" placeholder="Printed on the prescription letterhead"></textarea></div>'
  + '</div></div>'
  + setupInstallBanner()
  + '<button class="btn primary btn-xl block" style="margin-top:18px" onclick="submitSetup()">Start '+TRIAL_DAYS+'-day free trial</button>'
  + '<p class="note" style="text-align:center;margin-top:12px">No card needed for the trial. '+String.fromCharCode(8377)+'299 / month afterwards.</p>'
  + '</div>';
}
function submitSetup(){
  const name=$('#su-clinic').value.trim();
  const doc=$('#su-doc').value.trim();
  const email=$('#su-email').value.trim();
  if(!name){ toast('Enter the clinic name','err'); $('#su-clinic').focus(); return; }
  if(!doc){ toast('Enter the doctor name','err'); $('#su-doc').focus(); return; }
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast('Enter a valid email','err'); $('#su-email').focus(); return; }
  const cc=digits($('#su-cc').value)||'91';
  db.clinic={
    name, doctorName:doc, regNo:$('#su-reg').value.trim(),
    discipline:$('#su-disc').value, email, phone:$('#su-phone').value.trim(),
    countryCode:cc, address:$('#su-addr').value.trim(),
    clinicId: slug(name)+'-'+rid().slice(-4),
    accessKey: rid()+rid(),
    trialStartedAt: effectiveNow(),
    license:null, backendUrl:DEFAULT_BACKEND_URL, publicUrl:DEFAULT_PUBLIC_URL, tourDone:false
  };
  saveDB(false);
  toast('Welcome, '+doc,'ok');
  ui.tab='home'; render();
  setTimeout(startTour, 350);   // first-run walkthrough
}

/* ══════════════════════════════════════════════════════════════
   HOME
   ══════════════════════════════════════════════════════════════ */
function vHome(ls){
  const today=startOfDay(effectiveNow());
  const seenToday=db.visits.filter(v=>startOfDay(v.at)===today).length;
  const dueToday=remindersDue().filter(r=>r.rel<=0).length;
  const total=Object.keys(db.patients).length;
  let banner='';
  if(ls.state==='trial'){
    banner='<div class="tbanner'+(ls.left<=3?' warn':'')+'"><div class="tb-ic">'+I.spark+'</div>'
      +'<div class="tb-t"><b>Free trial</b><div>'+ls.left+' day'+(ls.left===1?'':'s')+' remaining. Subscribe anytime to keep going.</div></div>'
      +'<button class="btn '+(ls.left<=3?'primary':'')+'" onclick="go(\'settings\')">Subscribe</button></div>';
  }
  let s='';
  s+=banner;
  // Big search + consult
  s+='<div class="search-hero">'
    +'<div class="lbl" style="margin-bottom:10px">Find or register a patient</div>'
    +'<div class="search-box">'+I.search.replace('<svg','<svg class="mag"')
    +'<input id="home-search" inputmode="tel" placeholder="Phone number" autocomplete="off" oninput="homeSearch()" onkeydown="if(event.key===\'Enter\')homeSearchEnter()"></div>'
    +'<div id="home-results" style="margin-top:12px"></div>'
    +'<button class="btn primary btn-xl block" style="margin-top:14px" onclick="newConsult()">'+I.plus+'New consultation</button>'
    +'</div>';
  // Stats
  s+='<div class="stats" style="margin-top:16px">'
    +'<div class="stat accent"><div class="v tnum">'+seenToday+'</div><div class="k">Seen today</div></div>'
    +'<div class="stat"><div class="v tnum">'+total+'</div><div class="k">Patients</div></div>'
    +'<div class="stat"><div class="v tnum" style="'+(dueToday?'color:var(--red)':'')+'">'+dueToday+'</div><div class="k">Reminders due</div></div>'
    +'</div>';
  // Recent visits
  const recent=db.visits.slice(-6).reverse();
  s+='<div class="block" style="margin-top:16px"><div class="block-h">'+I.heart+'<h3>Recent consultations</h3><div class="rt lbl">'+db.visits.length+' total</div></div>';
  if(recent.length){
    s+='<div class="list">'+recent.map(v=>visitRow(v)).join('')+'</div>';
  }else{
    s+='<div class="empty"><div class="ic">'+I.heart+'</div><h3>No consultations yet</h3><p>Tap New consultation to see your first patient.</p></div>';
  }
  s+='</div>';
  return s;
}
function homeSearch(){
  const q=digits($('#home-search').value);
  const box=$('#home-results'); if(!box) return;
  if(q.length<3){ box.innerHTML=''; return; }
  const matches=Object.values(db.patients).filter(p=>digits(p.phone).includes(q)).slice(0,4);
  if(!matches.length){
    box.innerHTML='<div class="note" style="padding:8px 2px">No match. This will register a new patient.</div>';
    return;
  }
  box.innerHTML='<div class="list block">'+matches.map(p=>patientRow(p,true)).join('')+'</div>';
}
function homeSearchEnter(){
  const q=digits($('#home-search').value);
  if(q.length>=6){ newConsult(q); }
}

/* ══════════════════════════════════════════════════════════════
   PATIENTS
   ══════════════════════════════════════════════════════════════ */
function vPatients(){
  const all=Object.values(db.patients).sort((a,b)=>(b.lastAt||b.createdAt)-(a.lastAt||a.createdAt));
  let s='<div class="row" style="align-items:center;margin-bottom:14px"><h2 style="font-size:1.3rem">Patients</h2><div class="grow"></div><span class="pill">'+all.length+'</span></div>';
  s+='<div class="search-box" style="margin-bottom:14px">'+I.search.replace('<svg','<svg class="mag"')
    +'<input id="pat-search" placeholder="Search name or phone" oninput="filterPatients()" style="height:52px;font-family:var(--sans);font-size:1rem"></div>';
  if(!all.length){
    return s+'<div class="empty"><div class="ic">'+I.users+'</div><h3>No patients yet</h3><p>Every consultation you save registers the patient here, keyed by phone number.</p></div>';
  }
  s+='<div class="block"><div class="list" id="pat-list">'+all.map(p=>patientRow(p)).join('')+'</div></div>';
  return s;
}
function filterPatients(){
  const q=$('#pat-search').value.trim().toLowerCase();
  const qd=digits(q);
  $$('#pat-list .item').forEach(el=>{
    const n=el.getAttribute('data-n'), ph=el.getAttribute('data-p');
    const hit=!q || n.includes(q) || (qd&&ph.includes(qd));
    el.style.display=hit?'':'none';
  });
}
function patientRow(p, compact){
  const key=digits(p.phone);
  const visits=db.visits.filter(v=>digits(v.phone)===key);
  const last=visits.length?visits[visits.length-1].at:p.createdAt;
  const initial=(p.name||'?').trim().charAt(0).toUpperCase();
  return '<button class="item" data-n="'+esc((p.name||'').toLowerCase())+'" data-p="'+esc(key)+'" onclick="openDetail(\'patient\',\''+key+'\')">'
    +'<div class="av">'+esc(initial)+'</div>'
    +'<div class="mid"><div class="t">'+esc(p.name||'Unnamed')+'</div>'
    +'<div class="s"><span class="mono">'+esc(p.phone)+'</span>'+(p.age?'<span>&middot; '+esc(p.age)+(p.sex?'/'+esc(p.sex.charAt(0)):'')+'</span>':'')+'</div></div>'
    +'<div class="rt">'+(compact?'':'<span class="tag">'+visits.length+' visit'+(visits.length===1?'':'s')+'</span>')+'<span class="s mono" style="color:var(--mut-2)">'+fmtDate(last)+'</span></div>'
    +'<span class="chev">'+I.chev+'</span></button>';
}

function vPatient(key){
  const p=db.patients[key];
  if(!p) return '<div class="empty"><h3>Patient not found</h3></div>';
  const visits=db.visits.filter(v=>digits(v.phone)===key).sort((a,b)=>b.at-a.at);
  const initial=(p.name||'?').trim().charAt(0).toUpperCase();
  let s='<button class="btn ghost" onclick="back()" style="margin-bottom:8px">'+I.back+' Back</button>';
  s+='<div class="block"><div class="block-b"><div class="row" style="align-items:center;gap:14px">'
    +'<div class="av" style="width:56px;height:56px;font-size:1.4rem;border-radius:16px">'+esc(initial)+'</div>'
    +'<div class="grow"><h2 style="font-size:1.25rem">'+esc(p.name||'Unnamed')+'</h2>'
    +'<div class="s mono" style="color:var(--mut);font-size:.86rem">'+esc(p.phone)+'</div>'
    +'<div class="s" style="color:var(--mut);font-size:.8rem;margin-top:2px">'+(p.age?esc(p.age)+' yrs':'')+(p.sex?' &middot; '+esc(p.sex):'')+' &middot; '+visits.length+' visit'+(visits.length===1?'':'s')+'</div></div>'
    +'</div>'
    +'<div class="row" style="margin-top:14px"><button class="btn primary btn-lg grow" onclick="newConsult(\''+key+'\')">'+I.plus+'New consultation</button>'
    +'<button class="btn btn-lg wa" onclick="waPatient(\''+key+'\')">'+I.wa+'</button></div>'
    +'</div></div>';
  s+='<div class="lbl" style="margin:18px 2px 10px">Visit history</div>';
  if(!visits.length){ s+='<div class="note">No visits recorded.</div>'; }
  else{
    s+='<div class="tl">'+visits.map(v=>{
      const vit=v.vitals||{};
      const bp=(vit.bpSys&&vit.bpDia)?vit.bpSys+'/'+vit.bpDia:'';
      return '<div class="tl-item"><button class="item" style="border-radius:var(--r);border:1px solid var(--rule)" onclick="openDetail(\'visit\',\''+v.id+'\')">'
        +'<div class="mid"><div class="t" style="font-size:.9rem">'+esc(v.complaint||'Consultation')+'</div>'
        +'<div class="s"><span class="mono">'+fmtDay(v.at)+'</span>'+(bp?'<span>&middot; BP '+esc(bp)+'</span>':'')+(v.meds&&v.meds.length?'<span>&middot; '+v.meds.length+' med'+(v.meds.length===1?'':'s')+'</span>':'')+'</div></div>'
        +'<span class="chev">'+I.chev+'</span></button></div>';
    }).join('')+'</div>';
  }
  return s;
}

/* ── shared rows ─────────────────────────────────────────────── */
function visitRow(v){
  const p=db.patients[digits(v.phone)]||{};
  const initial=(v.patientName||p.name||'?').trim().charAt(0).toUpperCase();
  return '<button class="item" onclick="openDetail(\'visit\',\''+v.id+'\')">'
    +'<div class="av">'+esc(initial)+'</div>'
    +'<div class="mid"><div class="t">'+esc(v.patientName||p.name||'Unnamed')+'</div>'
    +'<div class="s"><span>'+esc((v.complaint||'Consultation').slice(0,40))+'</span></div></div>'
    +'<div class="rt"><span class="s mono" style="color:var(--mut-2)">'+fmtTime(v.at)+'</span><span class="s" style="color:var(--mut-2);font-size:.68rem">'+fmtDate(v.at)+'</span></div>'
    +'</button>';
}

/* ══════════════════════════════════════════════════════════════
   CONSULTATION FORM
   ══════════════════════════════════════════════════════════════ */
function newConsult(prefill){
  const key = prefill && db.patients[prefill] ? prefill : (prefill?digits(prefill):'');
  const p = key && db.patients[key];
  ui.draft = {
    id:rid(), editing:false,
    phone: p?p.phone:(prefill&&!db.patients[prefill]?prefill:''),
    patientName:p?p.name:'', age:p?p.age:'', sex:p?p.sex:'',
    complaint:'', history:'',
    vitals:{}, temperament:[], notes:'',
    prescriptionPrivate:'', meds:[{name:'',timing:[],food:[]}],
    advice:'', investigations:[{name:''}], fee:'',
    reminderMsg:'', reminderDate:''
  };
  openDetail('consult');
}
function editVisit(id){
  const v=db.visits.find(x=>x.id===id); if(!v) return;
  ui.draft=JSON.parse(JSON.stringify(v));
  ui.draft.editing=true;
  if(!ui.draft.meds||!ui.draft.meds.length) ui.draft.meds=[{name:'',timing:[],food:[]}];
  if(!ui.draft.investigations||!ui.draft.investigations.length) ui.draft.investigations=[{name:''}];
  ui.draft.reminderMsg=v.reminder?v.reminder.msg:'';
  ui.draft.reminderDate=v.reminder?v.reminder.date:'';
  openDetail('consult');
}

function vConsult(){
  const d=ui.draft;
  const known = digits(d.phone) && db.patients[digits(d.phone)];
  let s='<button class="btn ghost" onclick="cancelConsult()" style="margin-bottom:8px">'+I.back+' Cancel</button>';
  s+='<h2 style="font-size:1.35rem;margin-bottom:4px">'+(d.editing?'Edit consultation':'New consultation')+'</h2>';
  s+='<p class="note" style="margin-bottom:16px">Fields left blank are simply skipped. Only name and phone are required.</p>';

  // 1 Patient
  s+=block(1,'Patient','Registered by phone number',
     '<div class="field"><label>Phone number</label>'
    +'<input class="ctl mono" id="f-phone" inputmode="tel" value="'+esc(d.phone)+'" placeholder="10-digit mobile" oninput="phoneLookup()" onblur="phoneLookup()"></div>'
    +'<div id="phone-note"></div>'
    +'<div class="field"><label>Full name</label><input class="ctl" id="f-name" value="'+esc(d.patientName)+'" placeholder="Patient name" autocomplete="off"></div>'
    +'<div class="grid2"><div class="field"><label>Age</label><input class="ctl" id="f-age" inputmode="numeric" value="'+esc(d.age)+'" placeholder="Years"></div>'
    +'<div class="field"><label>Sex</label>'+selectHtml('f-sex',SEXES,d.sex)+'</div></div>');

  // 2 Complaint
  s+=block(2,'Presenting complaint',null,
     '<div class="field"><label>Chief complaint</label><textarea class="ctl" id="f-complaint" placeholder="What the patient came in for">'+esc(d.complaint)+'</textarea></div>'
    +'<div class="field"><label>Quick history of illness</label><textarea class="ctl" id="f-history" placeholder="Onset, duration, progression, past episodes">'+esc(d.history)+'</textarea></div>');

  // 3 Vitals
  const vit=d.vitals||{};
  s+=block(3,'Vitals',null,
     '<div class="grid2">'
    +vitalField('bpSys','BP systolic','mmHg',vit.bpSys)
    +vitalField('bpDia','BP diastolic','mmHg',vit.bpDia)
    +vitalField('pulse','Pulse','bpm',vit.pulse)
    +vitalField('temp','Temperature','°F',vit.temp)
    +vitalField('spo2','SpO2','%',vit.spo2)
    +vitalField('weight','Weight','kg',vit.weight)
    +'</div>');

  // 4 Temperament
  s+=block(4,'Temperament','Observed disposition',
     '<div class="chips" id="temper-chips">'+TEMPERAMENTS.map(t=>chip(t,(d.temperament||[]).includes(t))).join('')+'</div>');

  // 5 Notes / voice
  const recSupported = ('webkitSpeechRecognition' in window)||('SpeechRecognition' in window);
  s+=block(5,'Consultation notes','Optional — dictate or type',
     (recSupported?'<button class="btn block" id="rec-btn" onclick="toggleRec()" style="margin-bottom:10px">'+I.mic+' Start voice notes</button>'
       :'<div class="note" style="margin-bottom:10px">Voice dictation needs Chrome or Android. You can type notes below.</div>')
    +'<textarea class="ctl" id="f-notes" style="min-height:90px" placeholder="Examination findings, observations, conversation summary">'+esc(d.notes)+'</textarea>');

  // 6 Treatment — PRIVATE prescription/dilution
  s+=block(6,'Prescription / Dilution','<span class="priv">'+I.lock+' Private &middot; never sent to patient</span>',
     '<div class="field"><label>Remedy / formulation</label><textarea class="ctl" id="f-rx" placeholder="Your remedy, potency, dilution — kept in your records only">'+esc(d.prescriptionPrivate)+'</textarea>'
    +'<div class="hint">This box is for your reference. It is never shown to the patient, printed, or sent on WhatsApp.</div></div>');

  // 7 Doctor's advice — medication table (patient-facing)
  s+=block(7,'Doctor\'s advice','Shared with patient',
     '<div class="med-sub"><span class="ml">Medicines &amp; dosing</span><div id="med-list">'
    + d.meds.map((m,i)=>medRow(i,m)).join('')
    +'</div><button class="btn block" onclick="addMed()">'+I.plus+' Add medicine</button></div>'
    +'<div class="field" style="margin-top:16px"><label>Advice / instructions</label><textarea class="ctl" id="f-advice" placeholder="Diet, lifestyle, precautions, anything to tell the patient">'+esc(d.advice)+'</textarea></div>');

  // 8 Investigations
  s+=block(8,'Pending investigations','Tests to be submitted',
     '<div id="inv-list">'+d.investigations.map((iv,i)=>invRow(i,iv)).join('')+'</div>'
    +'<button class="btn block" onclick="addInv()">'+I.plus+' Add test</button>');

  // 9 Documents & photos (doctor upload)
  if(!d.documents) d.documents=[];
  s+=block(9,'Documents &amp; photos','Attach reports, scans, images',
     '<button class="btn block" onclick="$(\'#doc-file\').click()">'+I.file+' Add document or photo</button>'
    +'<input type="file" id="doc-file" accept="image/*,application/pdf" multiple capture="environment" style="display:none" onchange="onDocFiles(event)">'
    +'<div class="thumbs-doc" id="doc-grid">'+d.documents.map((doc,i)=>docThumb(doc,i)).join('')+'</div>');

  // 10 Fee (private)
  s+=block(10,'Consultation fee','<span class="priv">'+I.lock+' Private &middot; your records only</span>',
     '<div class="field"><label>Fee charged</label><div class="inline-unit"><input class="ctl mono" id="f-fee" inputmode="numeric" value="'+esc(d.fee)+'" placeholder="0"><span class="u">'+String.fromCharCode(8377)+'</span></div>'
    +'<div class="hint">Recorded for your accounts. Never shown to the patient.</div></div>');

  // 11 Reminder
  s+=block(11,'Follow-up reminder','Optional — send later on WhatsApp',
     '<div class="field"><label>Reminder message</label><input class="ctl" id="f-remind-msg" value="'+esc(d.reminderMsg)+'" placeholder="e.g. Review after 7 days"></div>'
    +'<div class="field"><label>Reminder date</label><input class="ctl" id="f-remind-date" type="date" value="'+esc(d.reminderDate)+'"></div>');

  // Action bar
  s+='<div class="actionbar no-print"><button class="btn primary btn-xl grow" onclick="saveConsult()">'+I.save+' Save consultation</button></div>';
  return s;
}

function block(n,title,sub,body){
  return '<div class="block" style="margin-bottom:14px"><div class="block-h"><span class="idx">'+n+'</span><h3>'+title+'</h3>'
    +(sub?'<div class="sub" style="margin-left:auto">'+sub+'</div>':'')+'</div><div class="block-b">'+body+'</div></div>';
}
function vitalField(id,label,unit,val){
  return '<div class="field"><label>'+label+'</label><div class="inline-unit"><input class="ctl mono" id="v-'+id+'" inputmode="decimal" value="'+esc(val==null?'':val)+'" placeholder="—"><span class="u">'+unit+'</span></div></div>';
}
function selectHtml(id,opts,sel){
  return '<select class="ctl" id="'+id+'"><option value="">—</option>'+opts.map(o=>'<option'+(o===sel?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select>';
}
function chip(label,on){
  return '<div class="chip'+(on?' on':'')+'" onclick="this.classList.toggle(\'on\')" data-v="'+esc(label)+'">'+esc(label)+'</div>';
}
function medRow(i,m){
  return '<div class="med" data-med>'
    +'<div class="med-top"><span class="n">Rx</span><input class="ctl med-name" placeholder="Medicine name" value="'+esc(m.name||'')+'">'
    +'<button class="btn ghost del" onclick="delMed(this)" aria-label="Remove">'+I.trash+'</button></div>'
    +'<div class="med-sub"><span class="ml">When to take</span><div class="chips" data-timing>'+TIMINGS.map(t=>chipSm(t,(m.timing||[]).includes(t))).join('')+'</div></div>'
    +'<div class="med-sub"><span class="ml">Food</span><div class="chips" data-food>'+FOODS.map(f=>chipSm(f,(m.food||[]).includes(f))).join('')+'</div></div>'
    +'</div>';
}
function chipSm(label,on){
  return '<div class="chip sm'+(on?' on':'')+'" onclick="this.classList.toggle(\'on\')" data-v="'+esc(label)+'">'+esc(label)+'</div>';
}
function invRow(i,iv){
  return '<div class="mini-row" data-inv><input class="ctl" placeholder="Test / investigation name" value="'+esc(iv.name||'')+'"><button class="btn ghost" onclick="this.parentElement.remove()" aria-label="Remove">'+I.trash+'</button></div>';
}
function addMed(){ harvestConsult(); $('#med-list').insertAdjacentHTML('beforeend', medRow(ui.draft.meds.length,{name:'',timing:[],food:[]})); }
function delMed(btn){ const list=$('#med-list'); if(list.querySelectorAll('[data-med]').length<=1){ toast('Keep at least one row','err'); return;} btn.closest('[data-med]').remove(); }
function addInv(){ $('#inv-list').insertAdjacentHTML('beforeend', invRow(0,{name:''})); }

/* ── Document capture (doctor side) ──────────────────────────── */
function docThumb(doc,i){
  const src = doc.data ? ('data:'+(doc.mime||'image/jpeg')+';base64,'+doc.data) : doc.url;
  const isImg = (doc.mime||'').indexOf('image/')===0 || (doc.data && !doc.mime);
  const inner = isImg && src ? '<img src="'+esc(src)+'" alt="">' : '<span>'+esc((doc.name||'file').slice(0,18))+'</span>';
  return '<div class="thumb'+(isImg?'':' doc')+'" data-doc="'+i+'">'+inner
    +'<button class="rm" onclick="delDoc('+i+')" aria-label="Remove">&times;</button>'
    +(doc.url&&!doc.data?'<div class="fname">saved</div>':'')+'</div>';
}
function redrawDocs(){ const g=$('#doc-grid'); if(g) g.innerHTML=ui.draft.documents.map((doc,i)=>docThumb(doc,i)).join(''); }
function onDocFiles(e){
  const files=Array.from(e.target.files||[]);
  files.forEach(f=>{
    if(ui.draft.documents.length>=10){ toast('Up to 10 files per visit','err'); return; }
    if(f.type.indexOf('image/')===0){
      downscaleImg(f, dataUrl=>{ ui.draft.documents.push({name:f.name,mime:'image/jpeg',data:dataUrl.split(',')[1],by:'doctor',at:effectiveNow()}); redrawDocs(); });
    }else{
      const rd=new FileReader();
      rd.onload=()=>{ ui.draft.documents.push({name:f.name,mime:f.type||'application/octet-stream',data:rd.result.split(',')[1],by:'doctor',at:effectiveNow()}); redrawDocs(); };
      rd.readAsDataURL(f);
    }
  });
  e.target.value='';
}
function downscaleImg(file,cb){
  const img=new Image(), rd=new FileReader();
  rd.onload=()=>{ img.onload=()=>{
    let max=1280,w=img.width,h=img.height;
    if(w>max||h>max){ if(w>h){h=Math.round(h*max/w);w=max;}else{w=Math.round(w*max/h);h=max;} }
    const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
    cv.getContext('2d').drawImage(img,0,0,w,h);
    cb(cv.toDataURL('image/jpeg',0.82));
  }; img.src=rd.result; };
  rd.readAsDataURL(file);
}
function delDoc(i){ ui.draft.documents.splice(i,1); redrawDocs(); }

function phoneLookup(){
  const el=$('#f-phone'); if(!el) return;
  const key=digits(el.value);
  const note=$('#phone-note'); if(!note) return;
  if(key.length<6){ note.innerHTML=''; return; }
  const p=db.patients[key];
  if(p){
    const n=db.visits.filter(v=>digits(v.phone)===key).length;
    if(!$('#f-name').value) $('#f-name').value=p.name||'';
    if(!$('#f-age').value && p.age) $('#f-age').value=p.age;
    if(!$('#f-sex').value && p.sex) $('#f-sex').value=p.sex;
    note.innerHTML='<div class="tbanner" style="margin:0 0 13px"><div class="tb-ic" style="background:var(--green)">'+I.check+'</div><div class="tb-t"><b>Returning patient</b><div>'+esc(p.name||'Unnamed')+' &middot; '+n+' previous visit'+(n===1?'':'s')+'</div></div><button class="btn" onclick="openDetail(\'patient\',\''+key+'\')">History</button></div>';
  }else{
    note.innerHTML='<div class="note" style="margin:-4px 0 13px;color:var(--accent)">New patient — will be registered on save.</div>';
  }
}

function harvestConsult(){
  const d=ui.draft; if(!d) return;
  const g=id=>{const e=$('#'+id);return e?e.value.trim():'';};
  d.phone=g('f-phone'); d.patientName=g('f-name'); d.age=g('f-age'); d.sex=g('f-sex');
  d.complaint=g('f-complaint'); d.history=g('f-history'); d.notes=g('f-notes');
  d.prescriptionPrivate=g('f-rx'); d.advice=g('f-advice'); d.fee=g('f-fee');
  d.reminderMsg=g('f-remind-msg'); d.reminderDate=g('f-remind-date');
  d.vitals={};
  ['bpSys','bpDia','pulse','temp','spo2','weight'].forEach(k=>{const e=$('#v-'+k);if(e&&e.value.trim())d.vitals[k]=e.value.trim();});
  d.temperament=$$('#temper-chips .chip.on').map(c=>c.getAttribute('data-v'));
  d.meds=$$('#med-list [data-med]').map(row=>({
    name:(row.querySelector('.med-name').value||'').trim(),
    timing:Array.from(row.querySelectorAll('[data-timing] .chip.on')).map(c=>c.getAttribute('data-v')),
    food:Array.from(row.querySelectorAll('[data-food] .chip.on')).map(c=>c.getAttribute('data-v'))
  }));
  d.investigations=$$('#inv-list .mini-row input').map(i=>({name:i.value.trim()})).filter(x=>x.name);
}

function saveConsult(){
  harvestConsult();
  const d=ui.draft;
  if(!digits(d.phone)||digits(d.phone).length<6){ toast('Enter a valid phone number','err'); $('#f-phone').focus(); return; }
  if(!d.patientName){ toast('Enter the patient name','err'); $('#f-name').focus(); return; }
  const key=digits(d.phone);
  // upsert patient
  const now=effectiveNow();
  const existing=db.patients[key]||{createdAt:now};
  db.patients[key]={ phone:d.phone, name:d.patientName, age:d.age, sex:d.sex,
    createdAt:existing.createdAt, lastAt:now };
  // build visit
  const meds=(d.meds||[]).filter(m=>m.name);
  const visit={
    id:d.id, phone:d.phone, patientName:d.patientName, age:d.age, sex:d.sex,
    at: d.editing ? (db.visits.find(v=>v.id===d.id)||{}).at||now : now,
    complaint:d.complaint, history:d.history, vitals:d.vitals,
    temperament:d.temperament, notes:d.notes,
    prescriptionPrivate:d.prescriptionPrivate, meds, advice:d.advice,
    investigations:d.investigations, fee:d.fee,
    documents: d.documents||[],
    reminder: d.reminderDate||d.reminderMsg ? {msg:d.reminderMsg,date:d.reminderDate,sent:false} : null,
    uploadToken: (db.visits.find(v=>v.id===d.id)||{}).uploadToken || rid()+rid().slice(0,6),
    synced:false, updatedAt:now
  };
  const idx=db.visits.findIndex(v=>v.id===d.id);
  if(idx>=0) db.visits[idx]=visit; else db.visits.push(visit);
  saveDB();
  ui.draft=null;
  toast('Consultation saved','ok');
  showPostSave(visit);
}
function cancelConsult(){ ui.draft=null; back(); }

/* ── Post-save actions (between-patient moment: big buttons) ──── */
function showPostSave(v){
  const key=digits(v.phone);
  const hasMsg = (v.meds&&v.meds.length)||v.advice||(v.investigations&&v.investigations.length)||(v.reminder&&v.reminder.msg);
  const body='<div class="stack">'
    +'<div style="text-align:center;padding:6px 0 2px"><div class="hero-mark" style="width:60px;height:60px;background:var(--green);box-shadow:none;margin-bottom:12px">'+I.check+'</div>'
    +'<h2 style="font-size:1.2rem">Saved for '+esc(v.patientName)+'</h2>'
    +'<p class="note">What next?</p></div>'
    +(hasMsg?'<button class="btn wa btn-xl block" onclick="sendWhatsApp(\''+v.id+'\')">'+I.wa+' Send advice on WhatsApp</button>':'')
    +'<button class="btn btn-lg block" onclick="printRx(\''+v.id+'\')">'+I.print+' Print prescription</button>'
    +'<button class="btn btn-lg block" onclick="closeModal();openDetail(\'patient\',\''+key+'\')">'+I.users+' View patient history</button>'
    +'<button class="btn ghost block" onclick="closeModal();go(\'home\')">Done</button>'
    +'</div>';
  modal('Consultation complete', body);
}

/* ══════════════════════════════════════════════════════════════
   VISIT DETAIL
   ══════════════════════════════════════════════════════════════ */
function vVisitDetail(id){
  const v=db.visits.find(x=>x.id===id);
  if(!v) return '<div class="empty"><h3>Visit not found</h3></div>';
  const key=digits(v.phone);
  const vit=v.vitals||{};
  let s='<button class="btn ghost" onclick="back()" style="margin-bottom:8px">'+I.back+' Back</button>';
  s+='<div class="row" style="align-items:baseline;margin-bottom:4px"><h2 style="font-size:1.3rem">'+esc(v.patientName)+'</h2><div class="grow"></div><span class="lbl mono">'+fmtDate(v.at)+' &middot; '+fmtTime(v.at)+'</span></div>';
  s+='<div class="s mono" style="color:var(--mut);margin-bottom:14px">'+esc(v.phone)+(v.age?' &middot; '+esc(v.age)+' yrs':'')+(v.sex?' &middot; '+esc(v.sex):'')+'</div>';

  if(v.complaint||v.history) s+=detBlock('Complaint',(v.complaint?'<b>'+esc(v.complaint)+'</b>':'')+(v.history?'<div style="margin-top:6px;color:var(--ink-2)">'+esc(v.history)+'</div>':''));
  const vitParts=[['BP',(vit.bpSys&&vit.bpDia)?vit.bpSys+'/'+vit.bpDia:''],['Pulse',vit.pulse],['Temp',vit.temp&&vit.temp+'°F'],['SpO2',vit.spo2&&vit.spo2+'%'],['Wt',vit.weight&&vit.weight+'kg']].filter(x=>x[1]);
  if(vitParts.length) s+=detBlock('Vitals','<div class="row wrap" style="gap:16px">'+vitParts.map(x=>'<div><div class="lbl">'+x[0]+'</div><div class="mono" style="font-size:1.1rem;font-weight:700">'+esc(x[1])+'</div></div>').join('')+'</div>');
  if(v.temperament&&v.temperament.length) s+=detBlock('Temperament','<div class="chips">'+v.temperament.map(t=>'<span class="chip on sm" style="pointer-events:none">'+esc(t)+'</span>').join('')+'</div>');
  if(v.notes) s+=detBlock('Notes','<div style="white-space:pre-wrap;color:var(--ink-2)">'+esc(v.notes)+'</div>');
  if(v.prescriptionPrivate) s+=detBlock('Prescription / Dilution','<div style="white-space:pre-wrap">'+esc(v.prescriptionPrivate)+'</div>','<span class="priv">'+I.lock+' Private</span>');
  if(v.meds&&v.meds.length) s+=detBlock('Medicines',v.meds.map(m=>medLine(m)).join(''));
  if(v.advice) s+=detBlock('Advice','<div style="white-space:pre-wrap;color:var(--ink-2)">'+esc(v.advice)+'</div>');
  if(v.investigations&&v.investigations.length) s+=detBlock('Pending investigations',v.investigations.map(iv=>'<div class="row" style="align-items:center;gap:9px;margin-bottom:5px">'+I.flask.replace('<svg','<svg width="16" height="16" style="color:var(--accent)"')+'<span>'+esc(iv.name)+'</span></div>').join(''));
  if(v.fee) s+=detBlock('Fee','<div class="mono" style="font-size:1.2rem;font-weight:700">'+String.fromCharCode(8377)+' '+esc(v.fee)+'</div>','<span class="priv">'+I.lock+' Private</span>');
  if(v.reminder&&(v.reminder.msg||v.reminder.date)) s+=detBlock('Follow-up',(v.reminder.msg?'<b>'+esc(v.reminder.msg)+'</b>':'')+(v.reminder.date?'<div class="mono" style="color:var(--mut);margin-top:4px">'+fmtDate(new Date(v.reminder.date+'T00:00').getTime())+(v.reminder.sent?' &middot; sent':'')+'</div>':''));
  if(v.documents&&v.documents.length){
    const byDoc=v.documents.filter(x=>x.by!=='patient'), byPat=v.documents.filter(x=>x.by==='patient');
    s+=detBlock('Documents &amp; photos',
      '<div class="thumbs-doc">'+v.documents.map((doc,i)=>docViewThumb(doc)).join('')+'</div>'
      +'<div class="note" style="margin-top:8px">'+byDoc.length+' by clinic'+(byPat.length?', '+byPat.length+' by patient':'')+(v.documents.some(x=>x.data&&!x.url)?' · not yet synced to Drive':'')+'</div>');
  }

  s+='<div class="stack" style="margin-top:18px">'
    +'<div class="row"><button class="btn btn-lg grow" onclick="editVisit(\''+v.id+'\')">Edit</button>'
    +'<button class="btn btn-lg grow" onclick="printRx(\''+v.id+'\')">'+I.print+' Print</button></div>'
    +(((v.meds&&v.meds.length)||v.advice||(v.investigations&&v.investigations.length))?'<button class="btn wa btn-lg block" onclick="sendWhatsApp(\''+v.id+'\')">'+I.wa+' Send advice on WhatsApp</button>':'')
    +'<button class="btn ghost danger block" onclick="deleteVisit(\''+v.id+'\')">'+I.trash+' Delete this visit</button>'
    +'</div>';
  return s;
}
function detBlock(title,body,tag){
  return '<div class="block" style="margin-bottom:12px"><div class="block-h"><h3 style="font-size:.8rem">'+title+'</h3>'+(tag?'<div class="rt">'+tag+'</div>':'')+'</div><div class="block-b tight">'+body+'</div></div>';
}
function docViewThumb(doc){
  const src = doc.data ? ('data:'+(doc.mime||'image/jpeg')+';base64,'+doc.data) : doc.url;
  const isImg = (doc.mime||'').indexOf('image/')===0 || (doc.data && !doc.mime);
  const badge = doc.by==='patient'?'<div class="fname">patient</div>':'';
  if(isImg && src) return '<a class="thumb" href="'+esc(src)+'" target="_blank" rel="noopener"><img src="'+esc(src)+'" alt="">'+badge+'</a>';
  return '<a class="thumb doc" href="'+esc(src||'#')+'" target="_blank" rel="noopener"><span>'+esc((doc.name||'file').slice(0,18))+'</span>'+badge+'</a>';
}
function medLine(m){
  const when=[].concat(m.timing||[]).join(', ');
  const food=[].concat(m.food||[]).join(', ');
  const meta=[when,food].filter(Boolean).join(' · ');
  return '<div class="row" style="align-items:baseline;gap:9px;margin-bottom:8px">'+I.pill.replace('<svg','<svg width="16" height="16" style="color:var(--accent);flex:none"')
    +'<div><b>'+esc(m.name)+'</b>'+(meta?'<div class="s" style="color:var(--mut);font-size:.8rem">'+esc(meta)+'</div>':'')+'</div></div>';
}
function deleteVisit(id){
  confirmSheet('Delete this visit?','This removes the consultation record permanently. The patient stays registered.',()=>{
    db.visits=db.visits.filter(v=>v.id!==id);
    saveDB(); toast('Visit deleted','ok'); back();
  });
}

/* ══════════════════════════════════════════════════════════════
   WHATSAPP
   ══════════════════════════════════════════════════════════════ */
function waPhone(phone){
  const cc=(db.clinic&&db.clinic.countryCode)||'91';
  let d=digits(phone);
  if(d.length===10) d=cc+d;
  else if(d.length===11 && d.charAt(0)==='0') d=cc+d.slice(1);
  return d;
}
function uploadLink(v){
  const c=db.clinic;
  let base=c.publicUrl||'';
  if(!base){
    // derive from current location
    const href=location.href.split('#')[0].split('?')[0];
    base=href.replace(/[^/]*$/,'')+'nandimed-upload.html';
  }else{
    base=base.replace(/\/?$/,'/')+'nandimed-upload.html';
  }
  return base+'?c='+encodeURIComponent(c.clinicId)+'&v='+encodeURIComponent(v.id)+'&t='+encodeURIComponent(v.uploadToken);
}
function buildWaMessage(v){
  const c=db.clinic;
  let L=[];
  L.push('*'+c.name+'*');
  if(c.doctorName) L.push('Dr. '+c.doctorName.replace(/^dr\.?\s*/i,''));
  L.push('');
  L.push('Namaste '+(v.patientName||'')+',');
  L.push('Here is your advice from today\'s visit ('+fmtDate(v.at)+'):');
  if(v.meds&&v.meds.length){
    L.push(''); L.push('*Medicines*');
    v.meds.forEach((m,i)=>{
      const meta=[[].concat(m.timing||[]).join(', '),[].concat(m.food||[]).join(', ')].filter(Boolean).join(' | ');
      L.push((i+1)+'. '+m.name+(meta?'  ('+meta+')':''));
    });
  }
  if(v.advice){ L.push(''); L.push('*Advice*'); L.push(v.advice); }
  if(v.investigations&&v.investigations.length){ L.push(''); L.push('*Tests to do*'); v.investigations.forEach(iv=>L.push('• '+iv.name)); }
  if(v.reminder&&v.reminder.date){ L.push(''); L.push('*Next visit*: '+fmtDate(new Date(v.reminder.date+'T00:00').getTime())+(v.reminder.msg?' — '+v.reminder.msg:'')); }
  // Only offer the upload link once a backend is connected — otherwise the page is dead.
  if(c.backendUrl){ L.push(''); L.push('You can upload your reports or photos here:'); L.push(uploadLink(v)); }
  L.push(''); L.push('Get well soon.');
  return L.join('\n');
}
function sendWhatsApp(id){
  const v=db.visits.find(x=>x.id===id); if(!v) return;
  const url='https://wa.me/'+waPhone(v.phone)+'?text='+encodeURIComponent(buildWaMessage(v));
  window.open(url,'_blank');
  closeModal();
}
function waPatient(key){
  const visits=db.visits.filter(v=>digits(v.phone)===key);
  if(!visits.length){ window.open('https://wa.me/'+waPhone(db.patients[key].phone),'_blank'); return; }
  sendWhatsApp(visits[visits.length-1].id);
}

/* ══════════════════════════════════════════════════════════════
   PRINT PRESCRIPTION
   (patient-facing content only — no private Rx/dilution, no fee)
   ══════════════════════════════════════════════════════════════ */
function printRx(id){
  const v=db.visits.find(x=>x.id===id); if(!v) return;
  const c=db.clinic;
  const vit=v.vitals||{};
  const vitParts=[['BP',(vit.bpSys&&vit.bpDia)?vit.bpSys+'/'+vit.bpDia:''],['Pulse',vit.pulse],['Temp',vit.temp&&vit.temp+'°F'],['SpO2',vit.spo2&&vit.spo2+'%'],['Wt',vit.weight&&vit.weight+' kg']].filter(x=>x[1]);
  let h='<style>#rx-print{font-family:Georgia,"Times New Roman",serif;color:#111;padding:26px 30px;max-width:760px;margin:0 auto}'
    +'#rx-print .rx-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #222;padding-bottom:12px}'
    +'#rx-print h1{font-size:22px;margin:0;letter-spacing:.3px}#rx-print .rx-sub{font-size:12px;color:#444;margin-top:3px}'
    +'#rx-print .rx-doc{text-align:right;font-size:12px;color:#333}'
    +'#rx-print .rx-pt{display:flex;justify-content:space-between;font-size:13px;margin:14px 0;padding-bottom:8px;border-bottom:1px solid #bbb}'
    +'#rx-print .rx-sym{font-size:34px;font-weight:700;font-family:Georgia,serif;margin:6px 0 4px}'
    +'#rx-print table{width:100%;border-collapse:collapse;margin-top:6px;font-size:13px}'
    +'#rx-print td,#rx-print th{border:1px solid #999;padding:7px 9px;text-align:left}#rx-print th{background:#eee;font-size:11px;letter-spacing:.4px;text-transform:uppercase}'
    +'#rx-print .sec{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#555;margin:16px 0 4px;font-family:Arial,sans-serif}'
    +'#rx-print .rx-foot{margin-top:38px;display:flex;justify-content:space-between;align-items:flex-end;font-size:12px;color:#444}'
    +'#rx-print .sign{border-top:1px solid #333;padding-top:5px;min-width:180px;text-align:center}</style>';
  h+='<div class="rx-head"><div><h1>'+esc(c.name)+'</h1>'
    +(c.discipline?'<div class="rx-sub">'+esc(c.discipline)+'</div>':'')
    +(c.address?'<div class="rx-sub">'+esc(c.address).replace(/\n/g,', ')+'</div>':'')
    +(c.phone?'<div class="rx-sub">Ph: '+esc(c.phone)+'</div>':'')+'</div>'
    +'<div class="rx-doc"><b>'+esc(c.doctorName)+'</b>'+(c.regNo?'<div>Reg. No: '+esc(c.regNo)+'</div>':'')+'<div>'+fmtDate(v.at)+'</div></div></div>';
  h+='<div class="rx-pt"><div><b>'+esc(v.patientName)+'</b>'+(v.age?' &nbsp; '+esc(v.age)+' yrs':'')+(v.sex?' / '+esc(v.sex):'')+'</div><div>'+esc(v.phone)+'</div></div>';
  if(v.complaint) h+='<div class="sec">Complaint</div><div>'+esc(v.complaint)+'</div>';
  if(vitParts.length) h+='<div class="sec">Vitals</div><div>'+vitParts.map(x=>x[0]+': '+esc(x[1])).join(' &nbsp;|&nbsp; ')+'</div>';
  h+='<div class="rx-sym">R<span style="font-size:18px">x</span></div>';
  if(v.meds&&v.meds.length){
    h+='<table><tr><th style="width:26px">#</th><th>Medicine</th><th>When</th><th>Food</th></tr>'
      +v.meds.map((m,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(m.name)+'</td><td>'+esc([].concat(m.timing||[]).join(', '))+'</td><td>'+esc([].concat(m.food||[]).join(', '))+'</td></tr>').join('')+'</table>';
  }else{ h+='<div style="color:#777;font-style:italic">As advised.</div>'; }
  if(v.advice) h+='<div class="sec">Advice</div><div>'+esc(v.advice).replace(/\n/g,'<br>')+'</div>';
  if(v.investigations&&v.investigations.length) h+='<div class="sec">Investigations advised</div><div>'+v.investigations.map(iv=>esc(iv.name)).join(' &nbsp;•&nbsp; ')+'</div>';
  if(v.reminder&&v.reminder.date) h+='<div class="sec">Next visit</div><div>'+fmtDate(new Date(v.reminder.date+'T00:00').getTime())+(v.reminder.msg?' — '+esc(v.reminder.msg):'')+'</div>';
  h+='<div class="rx-foot"><div style="font-size:10px;color:#888">Generated by NANDI Med · by Flux</div><div class="sign">'+esc(c.doctorName)+'</div></div>';
  $('#rx-print').innerHTML=h;
  closeModal();
  setTimeout(()=>window.print(),120);
}

/* ══════════════════════════════════════════════════════════════
   REMINDERS
   ══════════════════════════════════════════════════════════════ */
function remindersDue(){
  return db.visits.filter(v=>v.reminder&&v.reminder.date&&!v.reminder.sent)
    .map(v=>({v, rel:relDays(v.reminder.date)}))
    .sort((a,b)=>a.rel-b.rel);
}
function vReminders(){
  const all=remindersDue();
  let s='<div class="row" style="align-items:center;margin-bottom:14px"><h2 style="font-size:1.3rem">Reminders</h2><div class="grow"></div><span class="pill">'+all.length+' pending</span></div>';
  if(!all.length){
    return s+'<div class="empty"><div class="ic">'+I.bell+'</div><h3>No pending reminders</h3><p>Add a follow-up date on any consultation and it shows up here on the day.</p></div>';
  }
  const groups=[['Due now',all.filter(r=>r.rel<=0)],['This week',all.filter(r=>r.rel>0&&r.rel<=7)],['Later',all.filter(r=>r.rel>7)]];
  groups.forEach(([label,list])=>{
    if(!list.length) return;
    s+='<div class="lbl" style="margin:16px 2px 8px">'+label+'</div><div class="block"><div class="list">';
    s+=list.map(({v,rel})=>{
      const tag= rel<0?'<span class="tag due">'+(-rel)+'d overdue</span>':rel===0?'<span class="tag due">Today</span>':rel<=7?'<span class="tag soon">in '+rel+'d</span>':'<span class="tag">'+fmtDate(new Date(v.reminder.date+'T00:00').getTime())+'</span>';
      return '<div class="item"><div class="av">'+esc((v.patientName||'?').charAt(0).toUpperCase())+'</div>'
        +'<div class="mid"><div class="t">'+esc(v.patientName)+'</div><div class="s">'+esc(v.reminder.msg||'Follow-up')+'</div></div>'
        +'<div class="rt">'+tag+'</div>'
        +'<button class="btn wa" style="padding:9px 12px;margin-left:8px" onclick="sendReminder(\''+v.id+'\')">'+I.wa+'</button></div>';
    }).join('');
    s+='</div></div>';
  });
  return s;
}
function sendReminder(id){
  const v=db.visits.find(x=>x.id===id); if(!v) return;
  const c=db.clinic;
  let msg='*'+c.name+'*\nNamaste '+(v.patientName||'')+',\n\n'+(v.reminder.msg||'This is a reminder for your follow-up visit')+'.';
  if(v.reminder.date) msg+='\nDate: '+fmtDate(new Date(v.reminder.date+'T00:00').getTime());
  msg+='\n\nRegards,\n'+(c.doctorName||c.name);
  window.open('https://wa.me/'+waPhone(v.phone)+'?text='+encodeURIComponent(msg),'_blank');
  confirmSheet('Mark reminder as sent?','You just opened WhatsApp for '+esc(v.patientName)+'. Mark this follow-up as done?',()=>{
    v.reminder.sent=true; v.synced=false; saveDB(); toast('Reminder marked sent','ok'); render();
  },'Mark sent','Keep pending');
}

/* ══════════════════════════════════════════════════════════════
   SETTINGS
   ══════════════════════════════════════════════════════════════ */
function vSettings(){
  const c=db.clinic; const ls=licenseStatus();
  let s='<h2 style="font-size:1.3rem;margin-bottom:14px">Settings</h2>';
  // subscription
  s+='<div class="block" style="margin-bottom:14px"><div class="block-h">'+I.spark+'<h3>Subscription</h3></div><div class="block-b">';
  if(ls.state==='licensed'){
    s+='<div class="tbanner"><div class="tb-ic" style="background:var(--green)">'+I.check+'</div><div class="tb-t"><b>Active subscription</b><div>Valid till '+fmtDate(ls.until)+'</div></div></div>';
  }else{
    s+='<div class="tbanner'+(ls.left<=3?' warn':'')+'"><div class="tb-ic">'+I.spark+'</div><div class="tb-t"><b>Free trial</b><div>'+ls.left+' day'+(ls.left===1?'':'s')+' left</div></div></div>';
    s+='<div class="row" style="align-items:baseline;margin:6px 0 12px"><div class="v mono" style="font-size:1.7rem;font-weight:800">'+String.fromCharCode(8377)+'299</div><div class="lbl">/ month</div></div>';
    s+='<button class="btn primary btn-lg block" onclick="openSubscribe()" style="margin-bottom:10px">Subscribe now</button>';
    s+='<div class="field"><label>Already paid? Activate by email</label><div class="row"><input class="ctl grow" id="act-email" type="email" value="'+esc(c.email)+'" placeholder="Your email"><button class="btn" onclick="activateLicense()">Activate</button></div></div>';
  }
  s+='</div></div>';
  // clinic profile
  // install + tutorial
  s+='<div class="block" style="margin-bottom:14px"><div class="block-h">'+I.download+'<h3>App &amp; help</h3></div><div class="block-b">'
    +installCard()
    +'<button class="btn btn-lg block" style="margin-top:12px" onclick="startTour()">'+I.spark+' Replay the tutorial</button>'
    +'</div></div>';
  s+='<div class="block" style="margin-bottom:14px"><div class="block-h">'+I.stetho+'<h3>Clinic profile</h3></div><div class="block-b">'
    +setField('Clinic name','set-name',c.name)
    +setField('Doctor name','set-doc',c.doctorName)
    +'<div class="grid2">'+setField('Reg. no.','set-reg',c.regNo)+'<div class="field"><label>Discipline</label>'+selectHtml2('set-disc',['Ayurveda','Homeopathy','Electro-homeopathy','Physiotherapy','General OPD'],c.discipline)+'</div></div>'
    +'<div class="grid2">'+setField('Clinic phone','set-phone',c.phone)+setField('Country code','set-cc',c.countryCode)+'</div>'
    +'<div class="field"><label>Address</label><textarea class="ctl" id="set-addr">'+esc(c.address||'')+'</textarea></div>'
    +'<button class="btn primary block" onclick="saveProfile()">Save profile</button>'
    +'</div></div>';
  // passcode
  s+='<div class="block" style="margin-bottom:14px"><div class="block-h">'+I.lock+'<h3>Passcode</h3>'
    +'<div class="rt lbl">'+(hasPin()?'<span style="color:var(--green)">ON</span>':'<span style="color:var(--red)">OFF</span>')+'</div></div><div class="block-b">'
    +'<p class="note" style="margin-bottom:12px">'
    +(hasPin()
      ? 'Your records are behind a passcode. The app re-locks after 5 minutes idle.'
      : 'Anyone who picks up this device can read your patient records. Set a passcode to stop that.')
    +'</p>'
    +'<button class="btn '+(hasPin()?'':'primary')+' btn-lg block" onclick="changePinPrompt()">'
    + (hasPin()?'Change or remove passcode':'Set a passcode')+'</button>'
    +(hasPin()?'<button class="btn ghost block" style="margin-top:8px" onclick="lockNow()">Lock now</button>':'')
    +'</div></div>';

  // backup — URLs are pre-wired, so the doctor only ever sees a button
  s+='<div class="block" style="margin-bottom:14px"><div class="block-h">'+I.file+'<h3>Cloud backup</h3>'
    +'<div class="rt lbl">'+(c.backendUrl?'<span style="color:var(--green)">connected</span>':'off')+'</div></div><div class="block-b">'
    +'<p class="note" style="margin-bottom:12px">Your records are saved on this device and copied to a secure cloud sheet, so nothing is lost if this device breaks.</p>'
    +'<div class="row"><button class="btn grow" onclick="testBackend()">Check connection</button><button class="btn primary grow" onclick="pushSync(true)">Back up now</button></div>'
    +'<div id="sync-status" class="note" style="margin-top:10px"></div>'
    +'<details style="margin-top:12px"><summary class="lbl" style="cursor:pointer">Advanced</summary>'
    +'<div class="field" style="margin-top:10px"><label>Backend URL</label><input class="ctl mono" id="set-url" value="'+esc(c.backendUrl||'')+'" style="font-size:.72rem"></div>'
    +'<div class="field"><label>Public app URL</label><input class="ctl mono" id="set-public" value="'+esc(c.publicUrl||'')+'" style="font-size:.72rem"></div>'
    +'<p class="note">Only change these if you run your own backend.</p></details>'
    +'</div></div>';
  // clinic id
  s+='<div class="block" style="margin-bottom:14px"><div class="block-h">'+I.lock+'<h3>Clinic identity</h3></div><div class="block-b">'
    +'<div class="lbl" style="margin-bottom:6px">Clinic ID</div><div class="copyrow" style="margin-bottom:10px"><span class="v">'+esc(c.clinicId)+'</span><button class="btn ghost" onclick="copyText(\''+esc(c.clinicId)+'\')">Copy</button></div>'
    +'<div class="lbl" style="margin-bottom:6px">Access key <span style="color:var(--red)">keep private</span></div><div class="copyrow"><span class="v">'+esc(c.accessKey).slice(0,10)+'••••••••</span><button class="btn ghost" onclick="copyText(\''+esc(c.accessKey)+'\')">Copy</button></div>'
    +'<p class="note" style="margin-top:10px">Your access key protects your clinic\'s data on the shared backend. Only paste it into the Apps Script if asked during setup.</p>'
    +'</div></div>';
  // data
  s+='<div class="block" style="margin-bottom:14px"><div class="block-h">'+I.save+'<h3>Data</h3></div><div class="block-b">'
    +'<div class="row"><button class="btn grow" onclick="exportData()">Export backup</button><button class="btn grow" onclick="$(\'#import-file\').click()">Import backup</button></div>'
    +'<input type="file" id="import-file" accept="application/json" style="display:none" onchange="importData(event)">'
    +'<div class="divide" style="margin:14px 0"></div>'
    +'<button class="btn ghost danger block" onclick="resetApp()">Reset all data</button>'
    +'</div></div>';
  s+='<p class="note" style="text-align:center;padding:8px 0 20px">NANDI Med · by Flux · v'+APP_VERSION+'</p>';
  return s;
}
function setField(label,id,val){ return '<div class="field"><label>'+label+'</label><input class="ctl" id="'+id+'" value="'+esc(val||'')+'"></div>'; }
function selectHtml2(id,opts,sel){ return '<select class="ctl" id="'+id+'">'+opts.map(o=>'<option'+(o===sel?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select>'; }
function saveProfile(){
  const c=db.clinic;
  c.name=$('#set-name').value.trim()||c.name;
  c.doctorName=$('#set-doc').value.trim()||c.doctorName;
  c.regNo=$('#set-reg').value.trim();
  c.discipline=$('#set-disc').value;
  c.phone=$('#set-phone').value.trim();
  c.countryCode=digits($('#set-cc').value)||'91';
  c.address=$('#set-addr').value.trim();
  c.backendUrl=($('#set-url')?$('#set-url').value.trim():c.backendUrl);
  saveDB(); toast('Profile saved','ok'); render();
}
function saveSync(){
  const u=$('#set-url'), p=$('#set-public');   // may be absent if not on Settings
  if(u) db.clinic.backendUrl=u.value.trim();
  if(p) db.clinic.publicUrl=p.value.trim();
  saveDB(false);
}
function openSubscribe(){
  if(RAZORPAY_PLAN_LINK.includes('REPLACE_ME')){
    modal('Subscribe', '<p class="note" style="margin-bottom:14px">Payment link is not configured yet. To subscribe, contact the NANDI Med team, or set up your Razorpay plan link (see the setup guide). Once you pay, activate with your email in Settings.</p><button class="btn primary block" onclick="closeModal()">OK</button>');
    return;
  }
  window.open(RAZORPAY_PLAN_LINK,'_blank');
}

/* ══════════════════════════════════════════════════════════════
   PAYWALL
   ══════════════════════════════════════════════════════════════ */
function vPaywall(ls){
  const c=db.clinic;
  return '<div class="center-page view">'
    +'<div class="hero-mark">'+I.lock+'</div>'
    +'<h1 style="text-align:center;font-size:1.4rem">Your trial has ended</h1>'
    +'<p class="note" style="text-align:center;margin:12px auto 20px;max-width:340px">Your patient records are safe on this device. Subscribe to keep adding consultations and sending advice.</p>'
    +'<div class="block"><div class="block-b" style="text-align:center">'
    +'<div class="row" style="justify-content:center;align-items:baseline;gap:4px;margin-bottom:6px"><div class="mono" style="font-size:2.4rem;font-weight:800">'+String.fromCharCode(8377)+'299</div><div class="lbl">/ month</div></div>'
    +'<p class="note">Unlimited patients and consultations, WhatsApp advice, printable prescriptions, follow-up reminders.</p>'
    +'<button class="btn primary btn-xl block" style="margin-top:16px" onclick="openSubscribe()">Subscribe</button>'
    +'</div></div>'
    +'<div class="block" style="margin-top:14px"><div class="block-b">'
    +'<div class="field"><label>Already subscribed? Activate by email</label><div class="row"><input class="ctl grow" id="act-email" type="email" value="'+esc(c.email)+'"><button class="btn primary" onclick="activateLicense()">Activate</button></div></div>'
    +'</div></div>'
    +'<button class="btn ghost block" style="margin-top:14px" onclick="exportData()">Export my data</button>'
    +'</div>';
}

/* ══════════════════════════════════════════════════════════════
   BACKEND SYNC + LICENSE
   ══════════════════════════════════════════════════════════════ */
function backendFetch(params){
  const url=db.clinic.backendUrl;
  const sep=url.indexOf('?')===-1?'?':'&';
  return fetch(url+sep+params, {method:'GET'}).then(r=>r.json());
}
function backendPost(payload){
  return fetch(db.clinic.backendUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)}).then(r=>r.json());
}
function testBackend(){
  saveSync();
  const st=$('#sync-status'); if(st) st.textContent='Testing…';
  if(!db.clinic.backendUrl){ if(st) st.textContent='Enter a backend URL first.'; return; }
  backendFetch('action=ping').then(r=>{
    if(st) st.innerHTML= r&&r.ok ? '<span style="color:var(--green)">Connected. Backend is reachable.</span>' : '<span style="color:var(--red)">Reached the URL but got an unexpected response.</span>';
  }).catch(()=>{ if(st) st.innerHTML='<span style="color:var(--red)">Could not reach the backend. Check the URL.</span>'; });
}
function pushSync(manual){
  if(!db.clinic||!db.clinic.backendUrl) { if(manual) toast('Add a backend URL in Settings','err'); return; }
  if(manual){ saveSync(); const st=$('#sync-status'); if(st) st.textContent='Syncing…'; }
  const unsynced=db.visits.filter(v=>!v.synced);
  // Send visits WITHOUT the heavy base64 document bytes — those go via docupload.
  const lightVisits=unsynced.map(v=>Object.assign({}, v, {documents:(v.documents||[]).map(d=>({name:d.name,mime:d.mime,by:d.by,at:d.at,url:d.url||''}))}));
  const payload={ action:'sync', clinicId:db.clinic.clinicId, accessKey:db.clinic.accessKey,
    clinic:{name:db.clinic.name,doctorName:db.clinic.doctorName,email:db.clinic.email},
    patients:db.patients, visits:lightVisits };
  backendPost(payload).then(r=>{
    if(r&&r.ok){
      unsynced.forEach(v=>v.synced=true);
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      const st=$('#sync-status'); if(st) st.innerHTML='<span style="color:var(--green)">Synced '+unsynced.length+' record'+(unsynced.length===1?'':'s')+' at '+fmtTime(Date.now())+'.</span>';
      if(manual) toast('Synced to sheet','ok');
      syncDocs(manual);
    }else{
      const st=$('#sync-status'); if(st) st.innerHTML='<span style="color:var(--red)">Sync rejected: '+esc((r&&r.error)||'unknown')+'</span>';
      if(manual) toast('Sync rejected','err');
    }
  }).catch(()=>{
    const st=$('#sync-status'); if(st) st.innerHTML='<span style="color:var(--amber)">Offline — will retry later.</span>';
    if(manual) toast('Offline, saved locally','err');
  });
}
// Upload any doctor-side documents still holding local bytes, then reclaim the space.
function syncDocs(manual){
  const pend=db.visits.filter(v=>(v.documents||[]).some(d=>d.data&&!d.url&&d.by!=='patient'));
  if(!pend.length) return;
  let done=0;
  pend.forEach(v=>{
    const files=v.documents.filter(d=>d.data&&!d.url&&d.by!=='patient');
    backendPost({action:'docupload', clinicId:db.clinic.clinicId, accessKey:db.clinic.accessKey,
      visitId:v.id, phone:v.phone, files:files.map(d=>({name:d.name,mime:d.mime,data:d.data}))})
    .then(r=>{
      if(r&&r.ok&&r.urls){
        files.forEach((d,i)=>{ if(r.urls[i]){ d.url=r.urls[i]; delete d.data; } });
        localStorage.setItem(DB_KEY, JSON.stringify(db));
      }
      if(++done===pend.length && manual) toast('Documents uploaded to Drive','ok');
    }).catch(()=>{});
  });
}
function activateLicense(){
  const em=$('#act-email'); const email=(em?em.value:db.clinic.email).trim();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast('Enter a valid email','err'); return; }
  if(!db.clinic.backendUrl){ toast('Connect your backend first (Settings)','err'); return; }
  toast('Checking subscription…');
  backendFetch('action=activate&email='+encodeURIComponent(email)).then(r=>{
    if(r&&r.valid){
      db.clinic.license={token:r.token||'',email,expiresAt:r.expiresAt||(effectiveNow()+32*864e5),plan:r.plan||'monthly',lastVerified:effectiveNow()};
      db.clinic.email=email;
      saveDB(false); toast('Subscription activated','ok'); ui.tab='home'; render();
    }else{
      toast((r&&r.message)||'No active subscription found for that email','err');
    }
  }).catch(()=>toast('Could not reach the backend','err'));
}

/* ══════════════════════════════════════════════════════════════
   VOICE NOTES (Web Speech API — free, browser built-in)
   ══════════════════════════════════════════════════════════════ */
function toggleRec(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(ui.rec){ ui.rec.stop(); return; }
  if(!SR){ toast('Voice dictation needs Chrome, Edge or Android','err'); return; }
  // Dictation needs a real http(s) origin. Opened as a file:// page Chrome
  // refuses both the mic and the speech service, with no prompt at all.
  if(location.protocol==='file:'){
    toast('Open the app from your web link (not the file) to use voice','err');
    return;
  }
  // Ask for the microphone explicitly so the browser actually shows its prompt.
  if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){
    navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
      stream.getTracks().forEach(t=>t.stop());   // permission is all we needed
      startRec(SR);
    }).catch(err=>{
      const n=err&&err.name;
      toast(n==='NotAllowedError' ? 'Microphone blocked — tap the lock icon in the address bar and allow it'
          : n==='NotFoundError'  ? 'No microphone found on this device'
          : 'Could not open the microphone','err');
    });
  }else startRec(SR);
}
function startRec(SR){
  const btn=$('#rec-btn'), notes=$('#f-notes');
  if(!notes) return;
  const r=new SR(); r.lang='en-IN'; r.continuous=true; r.interimResults=true;
  let base=notes.value; if(base && !base.endsWith(' ')) base+=' ';
  r.onresult=e=>{
    let fin='',interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const t=e.results[i][0].transcript;
      if(e.results[i].isFinal) fin+=t+' '; else interim+=t;
    }
    if(fin){ base+=fin; }
    notes.value=base+interim;
  };
  r.onerror=e=>{
    const c=e&&e.error;
    toast(c==='not-allowed'||c==='service-not-allowed' ? 'Microphone permission denied'
        : c==='network' ? 'Voice needs an internet connection'
        : c==='no-speech' ? 'Did not catch that — try again'
        : 'Voice error: '+c,'err');
    stopRec();
  };
  r.onend=()=>{ stopRec(); };
  try{ r.start(); ui.rec=r; }
  catch(err){ toast('Could not start voice input','err'); return; }
  if(btn){ btn.innerHTML='<span class="rec"><span class="blip"></span>Listening… tap to stop</span>'; btn.classList.add('danger'); }
}
function stopRec(){
  ui.rec=null;
  const btn=$('#rec-btn');
  if(btn){ btn.innerHTML=I.mic+' Start voice notes'; btn.classList.remove('danger'); }
}

/* ══════════════════════════════════════════════════════════════
   MODAL / CONFIRM
   ══════════════════════════════════════════════════════════════ */
function modal(title, bodyHtml){
  const root=$('#modal-root');
  root.innerHTML='<div class="scrim" onclick="if(event.target===this)closeModal()"><div class="sheet"><div class="grab"></div>'
    +'<div class="sheet-h"><h2>'+esc(title)+'</h2><button class="x" onclick="closeModal()">'+I.x+'</button></div>'
    +'<div class="sheet-b">'+bodyHtml+'</div></div></div>';
}
function closeModal(){ $('#modal-root').innerHTML=''; }
function confirmSheet(title,msg,onYes,yesLabel,noLabel){
  window.__confirmYes=onYes;
  modal(title, '<p class="note" style="margin-bottom:18px">'+esc(msg)+'</p>'
    +'<div class="row"><button class="btn ghost grow" onclick="closeModal()">'+esc(noLabel||'Cancel')+'</button>'
    +'<button class="btn primary grow" onclick="(window.__confirmYes||function(){})();closeModal()">'+esc(yesLabel||'Confirm')+'</button></div>');
}

/* ══════════════════════════════════════════════════════════════
   PASSCODE LOCK
   A privacy screen, not encryption. Records live in this browser's
   storage, so someone with the unlocked device and technical skill
   could still read them. What this stops is the realistic case: a
   patient, a relative or staff picking up the phone on the desk.
   ══════════════════════════════════════════════════════════════ */
const LOCK_AFTER_MS = 5*60*1000;   // re-lock after 5 idle minutes

/* Compact synchronous SHA-256. crypto.subtle is async and unavailable on
   file:// pages, and the PIN check has to be usable during render. */
function sha256Hex(msg){
  function rr(n,x){ return (x>>>n)|(x<<(32-n)); }
  var K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  var H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var b=[],i;
  var u=unescape(encodeURIComponent(msg));           // UTF-8 bytes
  for(i=0;i<u.length;i++) b.push(u.charCodeAt(i)&255);
  var bl=b.length*8; b.push(0x80);
  while(b.length%64!==56) b.push(0);
  for(i=7;i>=0;i--) b.push((bl/Math.pow(2,i*8))&255);
  for(i=0;i<b.length;i+=64){
    var w=new Array(64),j;
    for(j=0;j<16;j++) w[j]=(b[i+j*4]<<24)|(b[i+j*4+1]<<16)|(b[i+j*4+2]<<8)|b[i+j*4+3];
    for(j=16;j<64;j++){
      var s0=rr(7,w[j-15])^rr(18,w[j-15])^(w[j-15]>>>3);
      var s1=rr(17,w[j-2])^rr(19,w[j-2])^(w[j-2]>>>10);
      w[j]=(w[j-16]+s0+w[j-7]+s1)|0;
    }
    var a=H[0],bb=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for(j=0;j<64;j++){
      var S1=rr(6,e)^rr(11,e)^rr(25,e), ch=(e&f)^(~e&g);
      var t1=(h+S1+ch+K[j]+w[j])|0;
      var S0=rr(2,a)^rr(13,a)^rr(22,a), mj=(a&bb)^(a&c)^(bb&c);
      var t2=(S0+mj)|0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=bb; bb=a; a=(t1+t2)|0;
    }
    H[0]=(H[0]+a)|0; H[1]=(H[1]+bb)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
    H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
  }
  return H.map(function(x){ return ('00000000'+(x>>>0).toString(16)).slice(-8); }).join('');
}
function pinHash(pin){
  // Salted with the clinic id so the same PIN hashes differently per install.
  return sha256Hex(String(pin) + '|' + (db.clinic ? db.clinic.clinicId : ''));
}
function hasPin(){ return !!(db.clinic && db.clinic.pinHash); }
function isLocked(){
  if(!hasPin()) return false;
  if(ui.unlocked && (effectiveNow()-ui.unlockedAt) < LOCK_AFTER_MS) return false;
  return true;
}
function lockNow(){ ui.unlocked=false; ui.unlockedAt=0; render(); }
function setPin(pin){
  if(!/^\d{4,6}$/.test(String(pin))) return false;
  db.clinic.pinHash = pinHash(pin);
  saveDB(false);
  ui.unlocked=true; ui.unlockedAt=effectiveNow();
  return true;
}
function vLock(){
  return '<div class="center-page view">'
    +'<div class="hero-mark">'+I.lock+'</div>'
    +'<h1 style="text-align:center;font-size:1.25rem">'+esc(db.clinic.name||'NANDI Med')+'</h1>'
    +'<p class="note" style="text-align:center;margin:10px auto 18px;max-width:300px">Enter your passcode to open your patient records.</p>'
    +'<div class="block"><div class="block-b">'
    +'<div class="field"><label>Passcode</label>'
    +'<input class="ctl mono" id="lock-pin" type="password" inputmode="numeric" autocomplete="off" '
    +'style="font-size:1.6rem;text-align:center;letter-spacing:.4em" maxlength="6" '
    +'onkeydown="if(event.key===\'Enter\')tryUnlock()"></div>'
    +'<div id="lock-msg" class="note" style="text-align:center;min-height:18px"></div>'
    +'<button class="btn primary btn-xl block" style="margin-top:10px" onclick="tryUnlock()">Unlock</button>'
    +'</div></div>'
    +'<button class="btn ghost block" style="margin-top:12px" onclick="forgotPin()">Forgot passcode?</button>'
    +'</div>';
}
function tryUnlock(){
  const el=$('#lock-pin'); if(!el) return;
  const msg=$('#lock-msg');
  if(pinHash(el.value)===db.clinic.pinHash){
    ui.unlocked=true; ui.unlockedAt=effectiveNow();
    ui.pinTries=0; render();
  }else{
    ui.pinTries=(ui.pinTries||0)+1;
    el.value='';
    if(msg) msg.innerHTML='<span style="color:var(--red)">Wrong passcode'+(ui.pinTries>=3?' — use "Forgot passcode?" below':'')+'</span>';
  }
}
function forgotPin(){
  modal('Reset passcode',
    '<p class="note" style="margin-bottom:12px">Enter the email you registered this clinic with. '
   +'This unlocks the app so you can set a new passcode. Your records are not touched.</p>'
   +'<div class="field"><input class="ctl" id="pin-reset-email" type="email" placeholder="you@example.com"></div>'
   +'<div id="pin-reset-msg" class="note" style="min-height:18px"></div>'
   +'<button class="btn primary block" onclick="doPinReset()">Unlock</button>');
}
function doPinReset(){
  const em=$('#pin-reset-email'), msg=$('#pin-reset-msg');
  const given=(em?em.value:'').trim().toLowerCase();
  if(given && given===String(db.clinic.email||'').trim().toLowerCase()){
    db.clinic.pinHash=''; saveDB(false);
    ui.unlocked=true; ui.unlockedAt=effectiveNow();
    closeModal(); toast('Passcode cleared — set a new one in Settings','ok'); render();
  }else if(msg){
    msg.innerHTML='<span style="color:var(--red)">That is not the registered email</span>';
  }
}
function changePinPrompt(){
  modal(hasPin()?'Change passcode':'Set a passcode',
    '<p class="note" style="margin-bottom:12px">4 to 6 digits. You will be asked for this each time you open the app.</p>'
   +'<div class="field"><label>New passcode</label><input class="ctl mono" id="np1" type="password" inputmode="numeric" maxlength="6"></div>'
   +'<div class="field"><label>Repeat it</label><input class="ctl mono" id="np2" type="password" inputmode="numeric" maxlength="6"></div>'
   +'<div id="np-msg" class="note" style="min-height:18px"></div>'
   +'<div class="row"><button class="btn primary grow" onclick="savePin()">Save</button>'
   +(hasPin()?'<button class="btn ghost grow" onclick="removePin()">Remove</button>':'')+'</div>');
}
function savePin(){
  const a=$('#np1').value, b=$('#np2').value, msg=$('#np-msg');
  if(!/^\d{4,6}$/.test(a)){ msg.innerHTML='<span style="color:var(--red)">Use 4 to 6 digits</span>'; return; }
  if(a!==b){ msg.innerHTML='<span style="color:var(--red)">The two do not match</span>'; return; }
  setPin(a); closeModal(); toast('Passcode set','ok'); render();
}
function removePin(){
  db.clinic.pinHash=''; saveDB(false); closeModal();
  toast('Passcode removed — anyone opening this device can read your records','err');
  render();
}

/* ══════════════════════════════════════════════════════════════
   INSTALL — Android/desktop get the native prompt; iOS has no API
   so it gets written instructions instead.
   ══════════════════════════════════════════════════════════════ */
let deferredInstall=null;
addEventListener('beforeinstallprompt', e=>{
  e.preventDefault();            // keep it, fire it from our own button
  deferredInstall=e;
  const b=$('#install-btn'); if(b) b.style.display='';
  // The event often fires after first paint. If the doctor is still on the
  // registration screen, redraw so the one-tap Install button replaces the
  // written steps.
  if(!db.clinic && !$('#setup-install-btn') && $('.setup-install')) render();
});
addEventListener('appinstalled', ()=>{
  deferredInstall=null;
  toast('Installed. Open it from your home screen','ok');
  if(ui.tab==='settings') render();
});
function isStandalone(){
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
}
function platform(){
  const ua=navigator.userAgent||'';
  if(/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if(/Android/i.test(ua)) return 'android';
  return 'desktop';
}
function doInstall(){
  if(!deferredInstall){ toast('Use your browser menu to install','err'); return; }
  deferredInstall.prompt();
  deferredInstall.userChoice.then(()=>{ deferredInstall=null; const b=$('#install-btn'); if(b) b.style.display='none'; });
}
/* Install prompt on the very first screen. A doctor who registers in a browser
   tab and closes it has to find the link again; installing first avoids that.
   Hidden once the app is running installed. */
function setupInstallBanner(){
  if(isStandalone()) return '';
  const p=platform();
  const where = p==='desktop' ? 'your desktop' : 'your home screen';
  let how;
  if(deferredInstall){
    how = '<button class="btn primary btn-lg block" id="setup-install-btn" onclick="doInstall()" style="margin-top:10px">'
        + I.download+' Install now</button>';
  }else if(p==='ios'){
    how = '<ol class="install-steps" style="margin-top:8px"><li>Tap <b>Share</b> at the bottom of Safari</li>'
        + '<li>Tap <b>Add to Home Screen</b></li><li>Tap <b>Add</b></li></ol>'
        + '<p class="note" style="margin-top:6px;font-size:.7rem">Must be Safari. This does not work in Chrome on iPhone.</p>';
  }else if(p==='android'){
    how = '<ol class="install-steps" style="margin-top:8px"><li>Tap the <b>⋮</b> menu in Chrome</li>'
        + '<li>Tap <b>Install app</b></li><li>Confirm <b>Install</b></li></ol>';
  }else{
    how = '<ol class="install-steps" style="margin-top:8px"><li>Click the <b>install icon</b> in the address bar</li>'
        + '<li>Or ⋮ menu → <b>Install NANDI Med</b></li></ol>';
  }
  return '<div class="setup-install">'
    +'<div class="si-top"><div class="ic">'+I.download+'</div>'
    +'<div><b>Add it to '+where+' first</b>'
    +'<p>It opens like a normal app, works without internet, and you will not have to find this link again.</p></div></div>'
    + how
    +'<button class="btn ghost block" style="margin-top:8px" onclick="skipInstall()">I will do this later</button>'
    +'</div>';
}
function skipInstall(){
  const el=$('.setup-install'); if(el) el.remove();
}

// Settings card that teaches installation on whatever device this is.
function installCard(){
  if(isStandalone()){
    return '<div class="install-card"><div class="ic">'+I.check+'</div><div><b>Installed</b>'
      +'<p>You are running the installed app. It opens without a browser and works offline.</p></div></div>';
  }
  const p=platform();
  let steps='';
  if(p==='ios'){
    steps='<ol class="install-steps"><li>Tap the <b>Share</b> button at the bottom of Safari</li>'
      +'<li>Scroll down and tap <b>Add to Home Screen</b></li><li>Tap <b>Add</b></li></ol>'
      +'<p style="margin-top:8px;font-size:.72rem">On iPhone this only works in Safari, not Chrome.</p>';
  }else if(p==='android'){
    steps='<ol class="install-steps"><li>Tap the <b>⋮</b> menu in Chrome</li>'
      +'<li>Tap <b>Install app</b> or <b>Add to Home screen</b></li><li>Confirm <b>Install</b></li></ol>';
  }else{
    steps='<ol class="install-steps"><li>Look for the <b>install icon</b> in the address bar (a screen with a down arrow)</li>'
      +'<li>Or open the <b>⋮</b> menu and choose <b>Install NANDI Med</b></li>'
      +'<li>The app then opens in its own window, like any desktop program</li></ol>';
  }
  return '<div class="install-card"><div class="ic">'+I.download+'</div><div style="min-width:0"><b>Install on this device</b>'
    +'<p>Get an icon on your '+(p==='desktop'?'desktop':'home screen')+', open it without the browser, and keep working with no internet.</p>'
    +steps+'</div></div>'
    +'<button class="btn primary btn-lg block" id="install-btn" onclick="doInstall()"'
      +(deferredInstall?'':' style="display:none"')+'>'+I.download+' Install now</button>';
}

/* ══════════════════════════════════════════════════════════════
   GUIDED TOUR — runs once after setup, replayable from Settings.
   Steps may switch tabs or open a scratch consultation so the
   doctor sees each feature in the real screen, not a mock.
   ══════════════════════════════════════════════════════════════ */
const TOUR=[
  {t:'Welcome to NANDI Med',
   b:'A two-minute tour of everything. You can stop anytime, and replay it later from Settings.',
   tab:'home'},
  {t:'Start a consultation',
   b:'This button opens a new consultation. It is the button you will press most, so it sits in the middle of the bar on every screen.',
   tab:'home', sel:'.nav .fab'},
  {t:'The phone number is the patient file',
   b:'Type the phone number first. If that patient has been here before, their full history loads instantly and you will see a "Returning patient" banner.',
   consult:true, sel:'#f-phone'},
  {t:'Complaint and history',
   b:'What brought them in today, and the short background of the illness.',
   consult:true, sel:'#f-complaint'},
  {t:'Vitals',
   b:'BP, pulse, temperature, SpO2 and weight. Leave blank whatever you did not measure. Nothing is compulsory.',
   consult:true, sel:'#v-bpSys'},
  {t:'Voice notes',
   b:'Tap to dictate instead of typing. Your speech is written into the notes box as you talk, and you can edit it afterwards.',
   consult:true, sel:'#rec-btn'},
  {t:'This box is private',
   b:'Your remedy, potency or dilution. It is stored for your records only, and is never printed, never shown to the patient, and never sent on WhatsApp.',
   consult:true, sel:'#f-rx'},
  {t:'This is what the patient receives',
   b:'Add each medicine, then tap the chips to set when to take it and whether before or after food. You can pick more than one of each.',
   consult:true, sel:'#med-list'},
  {t:'Tests and documents',
   b:'List any pending investigations, and attach reports, scans or photographs. Patients can add their own photos later through the WhatsApp link.',
   consult:true, sel:'#inv-list'},
  {t:'Your fee stays private',
   b:'Recorded for your accounts only. Like the prescription box, the patient never sees it.',
   consult:true, sel:'#f-fee'},
  {t:'Follow-up reminder',
   b:'Set a review date. The Reminders tab then shows you who is due, and sends them a WhatsApp nudge in one tap.',
   consult:true, sel:'#f-remind-msg'},
  {t:'After you save',
   b:'You get one tap to send the advice on WhatsApp, and one tap to print it on your clinic letterhead.',
   consult:true, sel:'.actionbar'},
  {t:'All your patients',
   b:'Every patient you have seen, searchable by name or phone. Tap anyone to see their whole visit history.',
   tab:'patients', sel:'.nav button[data-tab="patients"]'},
  {t:'Who is due today',
   b:'Everyone with a follow-up date that has arrived, ready to message.',
   tab:'reminders', sel:'.nav button[data-tab="reminders"]'},
  {t:'Settings',
   b:'Your clinic details for the prescription header, Google Sheet backup, your subscription, and this tour again whenever you want it.',
   tab:'settings', sel:'.nav button[data-tab="settings"]'},
  {t:'That is everything',
   b:'Your records stay on this device and work with no internet. Connect a Google Sheet in Settings when you want a backup.',
   tab:'home', last:true}
];
let tourIx=-1, tourOpenedConsult=false;

function startTour(){
  closeModal();
  tourIx=0; tourOpenedConsult=false;
  document.body.classList.add('touring');
  showTourStep();
}
function showTourStep(){
  const st=TOUR[tourIx];
  if(!st){ endTour(); return; }
  // put the app on the screen this step talks about
  if(st.consult){
    if(!ui.draft){ newConsult(); tourOpenedConsult=true; }
  }else{
    if(tourOpenedConsult){ ui.draft=null; tourOpenedConsult=false; }
    if(st.tab){ ui.tab=st.tab; ui.route=null; render(); }
  }
  // setTimeout, not requestAnimationFrame: rAF never fires in a hidden or
  // background tab, which would leave the tour invisible but active.
  setTimeout(()=>paintTour(st), 16);
}
function paintTour(st){
  let root=$('#tour-root');
  if(!root){ root=document.createElement('div'); root.id='tour-root'; document.body.appendChild(root); }
  const el=st.sel?$(st.sel):null;
  if(el&&el.scrollIntoView) el.scrollIntoView({block:'center',behavior:'instant'});

  const total=TOUR.length, n=tourIx+1;
  const card='<div class="tour-card" id="tour-card">'
    +'<div class="tour-count">Step '+n+' of '+total+'</div>'
    +'<h3>'+esc(st.t)+'</h3><p>'+esc(st.b)+'</p>'
    +'<div class="tour-dots">'+TOUR.map((_,i)=>'<span class="'+(i===tourIx?'on':'')+'"></span>').join('')+'</div>'
    +'<div class="tour-btns">'
      +(tourIx>0?'<button class="btn ghost" onclick="tourPrev()">Back</button>':'<button class="btn ghost" onclick="endTour()">Skip</button>')
      +'<button class="btn primary grow" onclick="tourNext()">'+(st.last?'Start using it':'Next')+'</button>'
    +'</div></div>';

  if(el){
    const r=el.getBoundingClientRect();
    const pad=6;
    root.innerHTML='<div class="tour-ring" style="top:'+(r.top-pad)+'px;left:'+(r.left-pad)+'px;width:'+(r.width+pad*2)+'px;height:'+(r.height+pad*2)+'px"></div>'+card;
    const c=$('#tour-card');
    const cw=c.offsetWidth, ch=c.offsetHeight;
    const vw=innerWidth, vh=innerHeight;
    let top = r.bottom+14, left = r.left + r.width/2 - cw/2;
    if(top+ch>vh-10) top = Math.max(10, r.top-ch-14);      // flip above
    left = Math.max(10, Math.min(left, vw-cw-10));          // keep on screen
    c.style.top=top+'px'; c.style.left=left+'px';
  }else{
    root.innerHTML='<div class="tour-scrim"></div>'+card;
    const c=$('#tour-card');
    c.style.top=Math.max(10,(innerHeight-c.offsetHeight)/2)+'px';
    c.style.left=Math.max(10,(innerWidth-c.offsetWidth)/2)+'px';
  }
}
function tourNext(){ tourIx++; if(tourIx>=TOUR.length){ endTour(); return; } showTourStep(); }
function tourPrev(){ if(tourIx>0){ tourIx--; showTourStep(); } }
function endTour(){
  tourIx=-1;
  const root=$('#tour-root'); if(root) root.remove();
  document.body.classList.remove('touring');
  if(tourOpenedConsult){ ui.draft=null; tourOpenedConsult=false; }
  if(db.clinic && !db.clinic.tourDone){ db.clinic.tourDone=true; saveDB(false); }
  ui.tab='home'; ui.route=null; render();
}
// Re-anchor the highlight if the window changes size mid-tour.
addEventListener('resize',()=>{ if(tourIx>=0) paintTour(TOUR[tourIx]); });

/* ── Data export / import / reset ────────────────────────────── */
function exportData(){
  const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='nandimed-backup-'+isoDate(Date.now())+'.json';
  a.click();
  toast('Backup downloaded','ok');
}
function importData(e){
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const data=JSON.parse(rd.result);
      if(!data.clinic||!data.visits){ toast('Not a valid backup','err'); return; }
      confirmSheet('Replace all data?','This replaces everything currently on this device with the backup file.',()=>{
        db=data; if(!db.patients)db.patients={}; if(!db.visits)db.visits=[];
        saveDB(false); toast('Backup restored','ok'); ui.tab='home'; render();
      },'Replace');
    }catch(err){ toast('Could not read file','err'); }
  };
  rd.readAsText(f);
}
function resetApp(){
  confirmSheet('Reset all data?','This permanently deletes every patient and consultation on this device. Export a backup first if you want to keep it.',()=>{
    localStorage.removeItem(DB_KEY);
    db=freshDB(); ui.tab='home'; ui.route=null; render();
    toast('All data cleared','ok');
  },'Delete everything');
}
function copyText(t){ navigator.clipboard.writeText(t).then(()=>toast('Copied','ok')).catch(()=>toast('Copy failed','err')); }

/* ── Global exposure for inline handlers ─────────────────────── */
Object.assign(window,{
  go,openDetail,back,submitSetup,newConsult,editVisit,saveConsult,cancelConsult,
  phoneLookup,addMed,delMed,addInv,onDocFiles,delDoc,homeSearch,homeSearchEnter,filterPatients,
  sendWhatsApp,waPatient,printRx,sendReminder,deleteVisit,
  saveProfile,openSubscribe,activateLicense,testBackend,pushSync,
  toggleRec,startRec,modal,closeModal,confirmSheet,exportData,importData,resetApp,copyText,
  startTour,tourNext,tourPrev,endTour,doInstall,skipInstall,
  tryUnlock,forgotPin,doPinReset,changePinPrompt,savePin,removePin,lockNow,
  showPostSave
});

/* ── Init ────────────────────────────────────────────────────── */
loadDB();
render();
// register service worker
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')){
  navigator.serviceWorker.register('nandimed-sw.js').catch(()=>{});
}
// retry sync when back online
window.addEventListener('online',()=>{ if(db.clinic&&db.clinic.backendUrl) pushSync(); });
// re-check the subscription shortly after launch (never blocks the UI)
setTimeout(verifyLicenseIfNeeded, 3000);
// resume the walkthrough for a clinic that set up before the tour existed
if(db.clinic && !db.clinic.tourDone) setTimeout(startTour, 600);
