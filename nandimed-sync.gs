/* ══════════════════════════════════════════════════════════════
   NANDI Med — by Flux · Google Apps Script backend
   Free multi-clinic sync + patient upload + license check.

   Model:
   - One deployment + one Google Sheet serves many clinics.
   - Each clinic is namespaced by clinicId and gated by an accessKey
     (owner devices). Patient uploads are gated by a per-visit token
     and can ONLY write files, never read clinical data.
   - Licensing: 15-day trial is enforced on the client; paid status
     lives in the "_Subscriptions" tab. Activate by email. Tokens are
     HMAC-derived, never stored.

   SETUP: see NANDIMED-SETUP.md
   ══════════════════════════════════════════════════════════════ */

// ── EDIT THIS: paste the ID of your Google Sheet ─────────────────
var SPREADSHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';

// Script Properties (Project Settings → Script Properties):
//   TOKEN_HMAC_SECRET  — any long random string (required for licensing)
// Optional / future:
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, WEBHOOK_SECRET

var UPLOAD_FOLDER = 'NANDI Med — Patient Uploads';
var CLINIC_SHEET_PREFIX = 'NANDI Med — ';

/* Each clinic gets its OWN spreadsheet, created on first sync and shared with
   the doctor's email as a viewer. Keeps one clinic's records away from another's,
   avoids the 10M-cell ceiling of a single shared sheet, and lets the doctor see
   their own data in their Drive. The master sheet keeps only the control tabs. */
function getClinicSS_(master, cid, clinicName, email){
  var clinics = sheet_(master, '_Clinics',
    ['ClinicId','Name','DoctorName','Email','AccessKeyHash','SheetId','FirstSeen','LastSync']);
  var row = findRow_(clinics, 'ClinicId', cid);
  var sid = row ? getCell_(clinics, row, 'SheetId') : '';
  if(sid){
    try{ return SpreadsheetApp.openById(sid); }
    catch(err){ sid=''; }        // deleted or unreachable: fall through and rebuild
  }
  // Serialise creation. Two syncs arriving together would otherwise each make a
  // spreadsheet, and the clinic would end up with duplicates.
  var lock = LockService.getScriptLock();
  try{ lock.waitLock(20000); }catch(err){}
  try{
    row = findRow_(clinics, 'ClinicId', cid);          // re-read inside the lock
    sid = row ? getCell_(clinics, row, 'SheetId') : '';
    if(sid){
      try{ return SpreadsheetApp.openById(sid); }catch(err){}
    }
    var ss = SpreadsheetApp.create(CLINIC_SHEET_PREFIX + (clinicName || cid));
    try{
      ss.getSheets()[0].setName('_info');
      if(email && isEmail_(email)) DriveApp.getFileById(ss.getId()).addViewer(email);
    }catch(err){}                // sharing failure must not break the sync
    if(row) setCell_(clinics, row, 'SheetId', ss.getId());
    SpreadsheetApp.flush();      // make sure the id is committed before unlocking
    return ss;
  } finally {
    try{ lock.releaseLock(); }catch(err){}
  }
}
var TRIAL_GRACE_DAYS = 32; // license validity window granted on activation

/* ── Entry points ────────────────────────────────────────────── */
function doGet(e){
  try{
    var a = (e.parameter.action||'').toLowerCase();
    if(a==='ping')     return json_({ok:true, service:'nandimed', hasSecret: !!prop_('TOKEN_HMAC_SECRET')});
    if(a==='activate') return json_(handleActivate_(e.parameter.email));
    if(a==='verify')   return json_(handleVerify_(e.parameter.email, e.parameter.token));
    if(a==='uploadinfo') return json_(handleUploadInfo_(e.parameter.c, e.parameter.v, e.parameter.t));
    return json_({ok:false, error:'Unknown action'});
  }catch(err){ return json_({ok:false, error:'Bad request'}); }
}

function doPost(e){
  try{
    var raw = e.postData.contents;
    var data = JSON.parse(raw);

    // Razorpay posts its own shape (no `action`), so detect it before routing.
    if((e.parameter && e.parameter.wh) || (data.event && data.payload))
      return json_(handleWebhook_(e, raw));

    var a = (data.action||'').toLowerCase();
    if(a==='sync')      return json_(handleSync_(data));
    if(a==='upload')    return json_(handleUpload_(data));       // patient, token-gated
    if(a==='docupload') return json_(handleDocUpload_(data));    // doctor, accessKey-gated
    return json_({ok:false, error:'Unknown action'});
  }catch(err){ return json_({ok:false, error:'Bad request'}); }
}

/* ══════════════════════════════════════════════════════════════
   SYNC — owner device pushes patients + visits (accessKey gated)
   ══════════════════════════════════════════════════════════════ */
function handleSync_(data){
  var cid = sanitizeId_(data.clinicId);
  if(!cid) return {ok:false, error:'Missing clinicId'};
  if(!data.accessKey) return {ok:false, error:'Missing accessKey'};

  var master = SpreadsheetApp.openById(SPREADSHEET_ID);
  var keyHash = sha256_(String(data.accessKey));

  // Register or verify the clinic's access key
  var clinics = sheet_(master, '_Clinics',
    ['ClinicId','Name','DoctorName','Email','AccessKeyHash','SheetId','FirstSeen','LastSync']);
  var crow = findRow_(clinics, 'ClinicId', cid);
  if(crow){
    var storedHash = getCell_(clinics, crow, 'AccessKeyHash');
    if(storedHash && !safeEqual_(storedHash, keyHash)) return {ok:false, error:'Access key mismatch'};
    setCell_(clinics, crow, 'LastSync', new Date());
    if(data.clinic){ setCell_(clinics, crow, 'Name', safe_(data.clinic.name)); setCell_(clinics, crow, 'Email', safe_(data.clinic.email)); }
  }else{
    clinics.appendRow([cid, safe_(data.clinic&&data.clinic.name), safe_(data.clinic&&data.clinic.doctorName),
      safe_(data.clinic&&data.clinic.email), keyHash, '', new Date(), new Date()]);
  }

  // This clinic's own spreadsheet (created + shared on first sync)
  var ss = getClinicSS_(master, cid, data.clinic&&data.clinic.name, data.clinic&&data.clinic.email);

  // Upsert patients
  var pTab = sheet_(ss, 'Patients', ['Phone','Name','Age','Sex','CreatedAt','LastAt']);
  var patients = data.patients||{};
  Object.keys(patients).forEach(function(k){
    var p = patients[k];
    var row = findRow_(pTab, 'Phone', String(p.phone));
    var vals = [safe_(p.phone), safe_(p.name), safe_(p.age), safe_(p.sex),
                p.createdAt?new Date(p.createdAt):'', p.lastAt?new Date(p.lastAt):''];
    if(row) writeRow_(pTab, row, vals); else pTab.appendRow(vals);
  });

  // Upsert visits
  var vHead = ['VisitId','Date','Time','Phone','PatientName','Age','Sex','Complaint','History',
    'BP','Pulse','Temp','SpO2','Weight','Temperament','Notes','PrescriptionPrivate',
    'Medicines','Advice','Investigations','Fee','ReminderMsg','ReminderDate','ReminderSent','UploadToken','UpdatedAt'];
  var vTab = sheet_(ss, 'Visits', vHead);
  var visits = data.visits||[];
  var count = 0;
  visits.forEach(function(v){
    var vit = v.vitals||{};
    var bp = (vit.bpSys&&vit.bpDia)?(vit.bpSys+'/'+vit.bpDia):'';
    var meds = (v.meds||[]).map(function(m){
      var meta = [].concat(m.timing||[]).concat(m.food||[]).join(', ');
      return m.name + (meta?(' ['+meta+']'):'');
    }).join(' ; ');
    var invs = (v.investigations||[]).map(function(x){return x.name;}).join(', ');
    var d = v.at?new Date(v.at):new Date();
    var vals = [safe_(v.id), Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'), Utilities.formatDate(d, tz_(), 'HH:mm'),
      safe_(v.phone), safe_(v.patientName), safe_(v.age), safe_(v.sex),
      safe_(v.complaint), safe_(v.history), safe_(bp), safe_(vit.pulse), safe_(vit.temp), safe_(vit.spo2), safe_(vit.weight),
      safe_((v.temperament||[]).join(', ')), safe_(v.notes), safe_(v.prescriptionPrivate),
      safe_(meds), safe_(v.advice), safe_(invs), safe_(v.fee),
      safe_(v.reminder&&v.reminder.msg), safe_(v.reminder&&v.reminder.date), (v.reminder&&v.reminder.sent)?'yes':'',
      safe_(v.uploadToken), new Date()];
    var row = findRow_(vTab, 'VisitId', String(v.id));
    if(row) writeRow_(vTab, row, vals); else vTab.appendRow(vals);
    count++;
  });

  return {ok:true, synced:count, clinic:cid};
}

/* ══════════════════════════════════════════════════════════════
   UPLOAD — patient-facing. Token-gated, WRITE ONLY.
   Never returns any clinical data.
   ══════════════════════════════════════════════════════════════ */
function handleUploadInfo_(cid, visitId, token){
  cid = sanitizeId_(cid);
  var v = lookupVisitForUpload_(cid, visitId, token);
  if(!v.ok) return {ok:false, error:'Invalid or expired link'};
  // Only expose the patient's own first name + clinic name so the page can greet them.
  return {ok:true, clinic:v.clinicName, patientFirst:(v.patientName||'').split(' ')[0]};
}

function handleUpload_(data){
  var cid = sanitizeId_(data.clinicId);
  var v = lookupVisitForUpload_(cid, data.visitId, data.token);
  if(!v.ok) return {ok:false, error:'Invalid or expired link'};

  var files = data.files||[];
  if(!files.length) return {ok:false, error:'No files'};
  if(files.length>8) return {ok:false, error:'Too many files (max 8)'};

  var folder = getUploadFolder_(cid);
  var ss = openClinicSS_(cid);
  if(!ss) return {ok:false, error:'Invalid or expired link'};
  var dTab = sheet_(ss, 'Documents', ['VisitId','Phone','UploadedBy','FileName','DriveUrl','At']);
  var saved = 0;
  files.forEach(function(f){
    if(!f.data) return;
    var bytes = Utilities.base64Decode(f.data);
    var blob = Utilities.newBlob(bytes, f.mime||'application/octet-stream', clean_(f.name)||('upload-'+Date.now()));
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    dTab.appendRow([safe_(data.visitId), safe_(v.phone), 'patient', safe_(f.name), file.getUrl(), new Date()]);
    saved++;
  });
  return {ok:true, saved:saved};
}

// Doctor-side document upload — gated by the clinic accessKey (not a visit token).
function handleDocUpload_(data){
  var cid = sanitizeId_(data.clinicId);
  if(!cid || !data.accessKey) return {ok:false, error:'Missing credentials'};
  var master = SpreadsheetApp.openById(SPREADSHEET_ID);
  var clinics = master.getSheetByName('_Clinics');
  var crow = clinics ? findRow_(clinics, 'ClinicId', cid) : 0;
  if(!crow) return {ok:false, error:'Unknown clinic'};
  var storedHash = getCell_(clinics, crow, 'AccessKeyHash');
  if(!storedHash || !safeEqual_(storedHash, sha256_(String(data.accessKey)))) return {ok:false, error:'Access key mismatch'};

  var files = data.files||[];
  if(!files.length) return {ok:false, error:'No files'};
  if(files.length>10) return {ok:false, error:'Too many files'};
  var ss = openClinicSS_(cid);
  if(!ss) return {ok:false, error:'Clinic sheet not ready'};
  var folder = getUploadFolder_(cid);
  var dTab = sheet_(ss, 'Documents', ['VisitId','Phone','UploadedBy','FileName','DriveUrl','At']);
  var urls = [];
  files.forEach(function(f){
    if(!f.data){ urls.push(''); return; }
    var blob = Utilities.newBlob(Utilities.base64Decode(f.data), f.mime||'application/octet-stream', clean_(f.name)||('doc-'+Date.now()));
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    dTab.appendRow([safe_(data.visitId), safe_(data.phone), 'doctor', safe_(f.name), file.getUrl(), new Date()]);
    urls.push(file.getUrl());
  });
  return {ok:true, urls:urls};
}

// Open a clinic's own spreadsheet by id recorded in _Clinics. Never creates one.
function openClinicSS_(cid){
  var master = SpreadsheetApp.openById(SPREADSHEET_ID);
  var clinics = master.getSheetByName('_Clinics');
  var row = clinics ? findRow_(clinics, 'ClinicId', cid) : 0;
  if(!row) return null;
  var sid = getCell_(clinics, row, 'SheetId');
  if(!sid) return null;
  try{ return SpreadsheetApp.openById(sid); }catch(err){ return null; }
}

function lookupVisitForUpload_(cid, visitId, token){
  if(!cid || !visitId || !token) return {ok:false};
  var ss = openClinicSS_(cid);
  if(!ss) return {ok:false};
  var vTab = ss.getSheetByName('Visits');
  if(!vTab) return {ok:false};
  var row = findRow_(vTab, 'VisitId', String(visitId));
  if(!row) return {ok:false};
  var stored = getCell_(vTab, row, 'UploadToken');
  if(!stored || !safeEqual_(String(stored), String(token))) return {ok:false};
  var master = SpreadsheetApp.openById(SPREADSHEET_ID);
  var clinics = master.getSheetByName('_Clinics');
  var crow = clinics ? findRow_(clinics, 'ClinicId', cid) : null;
  return {ok:true, phone:getCell_(vTab,row,'Phone'), patientName:getCell_(vTab,row,'PatientName'),
    clinicName: crow?getCell_(clinics,crow,'Name'):'the clinic'};
}

function getUploadFolder_(cid){
  var root = folderByName_(UPLOAD_FOLDER) || DriveApp.createFolder(UPLOAD_FOLDER);
  var it = root.getFoldersByName(cid);
  return it.hasNext()?it.next():root.createFolder(cid);
}
function folderByName_(name){ var it=DriveApp.getFoldersByName(name); return it.hasNext()?it.next():null; }

/* ══════════════════════════════════════════════════════════════
   LICENSE — activate / verify by email
   ══════════════════════════════════════════════════════════════ */
function handleActivate_(email){
  email = String(email||'').trim().toLowerCase();
  if(!isEmail_(email)) return {valid:false, message:'Invalid email'};
  if(!rateOk_(email)) return {valid:false, message:'Too many attempts, try later'};

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var subs = sheet_(ss, '_Subscriptions', ['Email','Status','ExpiresAt','Plan','RazorpaySubId','LastVerified','Note']);
  var row = findRow_(subs, 'Email', email);
  // Same message whether the email is absent or inactive (no account enumeration)
  if(!row) return {valid:false, message:'No active subscription found for that email'};
  var status = String(getCell_(subs, row, 'Status')||'').toLowerCase();
  if(status!=='active') return {valid:false, message:'No active subscription found for that email'};

  var exp = getCell_(subs, row, 'ExpiresAt');
  var expMs = exp ? new Date(exp).getTime() : (Date.now()+TRIAL_GRACE_DAYS*864e5);
  setCell_(subs, row, 'LastVerified', new Date());
  return {valid:true, token:deriveToken_(email), expiresAt:expMs, plan:getCell_(subs,row,'Plan')||'monthly'};
}

function handleVerify_(email, token){
  email = String(email||'').trim().toLowerCase();
  if(!isEmail_(email) || !token) return {valid:false};
  if(!safeEqual_(String(token), deriveToken_(email))) return {valid:false};
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var subs = ss.getSheetByName('_Subscriptions');
  var row = subs ? findRow_(subs, 'Email', email) : null;
  if(!row) return {valid:false};
  var status = String(getCell_(subs, row, 'Status')||'').toLowerCase();
  if(status!=='active') return {valid:false, expired:true};
  var exp = getCell_(subs, row, 'ExpiresAt');
  var expMs = exp ? new Date(exp).getTime() : (Date.now()+TRIAL_GRACE_DAYS*864e5);
  return {valid:true, expiresAt:expMs};
}

/* ══════════════════════════════════════════════════════════════
   RAZORPAY WEBHOOK — keeps _Subscriptions in step with real billing
   so a monthly plan renews (and lapses) with no manual editing.

   Dashboard → Settings → Webhooks → add:
     URL     <your /exec URL>?wh=1
     Secret  the value of the WEBHOOK_SECRET script property
     Events  subscription.activated, subscription.charged,
             subscription.halted, subscription.cancelled,
             subscription.completed, subscription.pending
   ══════════════════════════════════════════════════════════════ */
function handleWebhook_(e, raw){
  if(!verifyWebhookSig_(e, raw)) return {ok:false, error:'Bad signature'};

  var data; try{ data = JSON.parse(raw); }catch(err){ return {ok:false, error:'Bad body'}; }
  var event = String(data.event||'');
  var sub = data.payload && data.payload.subscription && data.payload.subscription.entity;
  var pay = data.payload && data.payload.payment && data.payload.payment.entity;

  // Razorpay puts the buyer's email either on the payment or in subscription notes.
  var email = '';
  if(pay && pay.email) email = pay.email;
  else if(sub && sub.notes && sub.notes.email) email = sub.notes.email;
  email = String(email||'').trim().toLowerCase();
  if(!isEmail_(email)) return {ok:true, ignored:'no email on event'};

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Replay protection: Razorpay retries, and a retried charge must not
  // stack another month onto the expiry date.
  var evId = String(data.id || (pay&&pay.id) || (sub&&sub.id) || '') + '|' + event;
  var seen = sheet_(ss, '_ProcessedEvents', ['EventKey','At']);
  if(findRow_(seen, 'EventKey', evId)) return {ok:true, duplicate:true};
  seen.appendRow([safe_(evId), new Date()]);

  var subs = sheet_(ss, '_Subscriptions', ['Email','Status','ExpiresAt','Plan','RazorpaySubId','LastVerified','Note']);
  var row = findRow_(subs, 'Email', email);
  if(!row){ subs.appendRow([safe_(email),'','','monthly','','','']); row = findRow_(subs,'Email',email); }

  var ACTIVE = {'subscription.activated':1, 'subscription.charged':1};
  var DEAD   = {'subscription.halted':1, 'subscription.cancelled':1, 'subscription.completed':1};

  if(ACTIVE[event]){
    // Prefer Razorpay's own next-charge date; fall back to +32 days.
    var until = sub && sub.current_end ? sub.current_end*1000 : (Date.now()+32*864e5);
    setCell_(subs, row, 'Status', 'active');
    setCell_(subs, row, 'ExpiresAt', new Date(until));
    setCell_(subs, row, 'Plan', (sub&&sub.plan_id) ? 'monthly' : 'monthly');
    if(sub&&sub.id) setCell_(subs, row, 'RazorpaySubId', safe_(sub.id));
    setCell_(subs, row, 'LastVerified', new Date());
    setCell_(subs, row, 'Note', safe_(event));
  }else if(DEAD[event]){
    setCell_(subs, row, 'Status', event==='subscription.completed' ? 'completed' : 'cancelled');
    setCell_(subs, row, 'Note', safe_(event));
    setCell_(subs, row, 'LastVerified', new Date());
  }else{
    setCell_(subs, row, 'Note', safe_(event));   // pending/other: record, don't change access
  }
  return {ok:true, event:event};
}

// HMAC-SHA256 of the raw body, compared in constant time.
function verifyWebhookSig_(e, raw){
  var secret = prop_('WEBHOOK_SECRET');
  if(!secret) return false;                       // unset secret must never mean "allow"
  var sig = '';
  try{
    var h = e && e.headers ? e.headers : {};
    sig = h['X-Razorpay-Signature'] || h['x-razorpay-signature'] || '';
  }catch(err){}
  if(!sig && e && e.parameter) sig = e.parameter.sig || '';
  if(!sig) return false;
  var mac = Utilities.computeHmacSha256Signature(raw, secret);
  var hex = mac.map(function(b){ var v=(b<0?b+256:b).toString(16); return v.length===1?'0'+v:v; }).join('');
  return safeEqual_(hex, String(sig).toLowerCase());
}

function deriveToken_(email){
  var secret = prop_('TOKEN_HMAC_SECRET') || 'nandimed-default-secret-change-me';
  var raw = Utilities.computeHmacSha256Signature(email, secret);
  return 'NM' + raw.map(function(b){ var v=(b<0?b+256:b).toString(16); return v.length===1?'0'+v:v; }).join('').toUpperCase();
}

/* ══════════════════════════════════════════════════════════════
   Sheet helpers (header-name lookup, upsert, injection-safe)
   ══════════════════════════════════════════════════════════════ */
function sheet_(ss, name, header){
  var sh = ss.getSheetByName(name);
  if(!sh){
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.getRange(1,1,1,header.length).setFontWeight('bold').setBackground('#4939c9').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    return sh;
  }
  // The sheet already exists, possibly from an older schema. Append any columns
  // it is missing, otherwise getCell_/setCell_ by name silently no-op and data
  // written to the new column is lost.
  if(sh.getLastColumn()===0){
    sh.getRange(1,1,1,header.length).setValues([header])
      .setFontWeight('bold').setBackground('#4939c9').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    return sh;
  }
  var have = headerMap_(sh);
  var missing = [];
  for(var i=0;i<header.length;i++) if(!have[header[i]]) missing.push(header[i]);
  if(missing.length){
    sh.getRange(1, sh.getLastColumn()+1, 1, missing.length).setValues([missing])
      .setFontWeight('bold').setBackground('#4939c9').setFontColor('#ffffff');
  }
  return sh;
}
function headerMap_(sh){
  var h = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  var m = {}; for(var i=0;i<h.length;i++) m[h[i]] = i+1;
  return m;
}
function findRow_(sh, colName, value){
  var last = sh.getLastRow(); if(last<2) return 0;
  var map = headerMap_(sh); var col = map[colName]; if(!col) return 0;
  var vals = sh.getRange(2, col, last-1, 1).getValues();
  for(var i=0;i<vals.length;i++){ if(String(vals[i][0])===String(value)) return i+2; }
  return 0;
}
function getCell_(sh, row, colName){ var c=headerMap_(sh)[colName]; return c?sh.getRange(row,c).getValue():''; }
function setCell_(sh, row, colName, val){ var c=headerMap_(sh)[colName]; if(c) sh.getRange(row,c).setValue(val); }
function writeRow_(sh, row, vals){ sh.getRange(row, 1, 1, vals.length).setValues([vals]); }

/* ── Security / util ─────────────────────────────────────────── */
function prop_(k){ return PropertiesService.getScriptProperties().getProperty(k)||''; }
function tz_(){ return Session.getScriptTimeZone()||'Asia/Kolkata'; }
function sanitizeId_(s){ return String(s||'').replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,40); }
function isEmail_(s){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }
function clean_(s){ return String(s||'').replace(/[^\w.\- ]/g,'_').slice(0,80); }
// Prevent Sheets formula injection: prefix risky leading chars with an apostrophe
function safe_(v){ if(v==null) return ''; var s=String(v); return /^[=+\-@\t\r]/.test(s) ? ("'"+s) : s; }
function sha256_(s){
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return raw.map(function(b){ var v=(b<0?b+256:b).toString(16); return v.length===1?'0'+v:v; }).join('');
}
function safeEqual_(a,b){ a=String(a); b=String(b); if(a.length!==b.length) return false; var r=0; for(var i=0;i<a.length;i++) r|=a.charCodeAt(i)^b.charCodeAt(i); return r===0; }
function rateOk_(email){
  var cache = CacheService.getScriptCache();
  var key = 'rl_'+sha256_(email).slice(0,16);
  var n = parseInt(cache.get(key)||'0',10);
  if(n>=6) return false;
  cache.put(key, String(n+1), 900); // 15 min window
  return true;
}
function json_(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
