/**
 * TOOLFLUX EDGE LAB — Google Apps Script backend
 * Insert wear diagnostics: stores every run in Google Sheets, saves the
 * worn-edge photos to Drive, and calls the Claude API (Fable 5, vision)
 * for the diagnosis. The API key never leaves this script.
 *
 * SETUP (one-time, ~5 minutes):
 * ─────────────────────────────────────────────────────────────────────
 * 1. Go to https://sheets.google.com → create a spreadsheet.
 *    Name it "TOOLFLUX — EDGE LAB Data".
 *
 * 2. Copy the spreadsheet ID from the URL:
 *    https://docs.google.com/spreadsheets/d/  <<<THIS PART>>>  /edit
 *    Paste it into SPREADSHEET_ID below.
 *
 * 3. Go to https://script.google.com → New Project → paste this file. Save.
 *
 * 4. Project Settings → Script Properties → add:
 *      ANTHROPIC_API_KEY   your Anthropic API key (sk-ant-...)
 *      EDGELAB_EFFORT      optional: low | medium | high  (default: medium.
 *                          Higher = deeper analysis but slower; Apps Script
 *                          kills outbound calls that run too long, so raise
 *                          this only if "medium" responses feel thin.)
 *
 * 5. Deploy → New Deployment → type: Web App
 *      Execute as: Me   |   Who has access: Anyone
 *    → copy the Web App URL (https://script.google.com/macros/s/.../exec)
 *
 * 6. Open edgelab.html on your phone → SETUP tab → paste that URL → TEST.
 * ─────────────────────────────────────────────────────────────────────
 */

const SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID_HERE';

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';
const PRIMARY_MODEL   = 'claude-fable-5';
const FALLBACK_MODEL  = 'claude-opus-4-8';
const IMAGE_FOLDER    = 'EDGELAB — Insert Photos';

const NAVY = '#012B42';
const TEAL = '#0097B2';

function getSecret_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

// ─── Entry points ─────────────────────────────────────────────────

function doGet(e) {
  const action = (e.parameter.action || '').toLowerCase();
  if (action === 'ping') {
    return json_({ ok: true, hasKey: !!getSecret_('ANTHROPIC_API_KEY') });
  }
  return json_({ ok: false, error: 'Unknown action' });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'diagnose') return json_(handleDiagnose_(data));
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    return json_({ ok: false, error: 'Bad request: ' + err.message });
  }
}

// ─── Diagnose flow ────────────────────────────────────────────────

function handleDiagnose_(data) {
  const record = data.record || {};
  const images = data.images || [];
  if (!images.length) return { ok: false, error: 'At least one insert photo is required.' };
  if (!getSecret_('ANTHROPIC_API_KEY')) return { ok: false, error: 'ANTHROPIC_API_KEY not set in Script Properties.' };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const runId = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmmss');

  // 1. Save photos to Drive (data is kept even if the AI call fails)
  const imageUrls = images.map(function (img, i) {
    return saveImage_(runId + '_' + (img.label || 'photo' + (i + 1)) + '.jpg', img.data);
  });

  // 2. Call Claude
  let diagnosis = null, model = '', errMsg = '';
  try {
    const result = callClaude_(record, images);
    diagnosis = result.diagnosis;
    model = result.model;
  } catch (err) {
    errMsg = err.message;
    Logger.log('Claude call failed: ' + errMsg);
  }

  // 3. Log the run (inputs + result or error) to the sheet
  logRun_(ss, runId, record, diagnosis, model, imageUrls, errMsg);

  if (!diagnosis) return { ok: false, error: errMsg || 'Diagnosis failed.', imageUrls: imageUrls };
  return { ok: true, runId: runId, diagnosis: diagnosis, model: model, imageUrls: imageUrls };
}

// ─── Claude API ───────────────────────────────────────────────────

const DIAG_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2-3 plain sentences: what happened to this edge and why.' },
    wear: {
      type: 'object',
      properties: {
        primary_mode: { type: 'string', enum: ['flank_wear', 'crater_wear', 'built_up_edge', 'chipping', 'notch_wear', 'thermal_cracking', 'plastic_deformation', 'fracture', 'edge_rounding', 'unknown'] },
        secondary_modes: { type: 'array', items: { type: 'string' } },
        severity: { type: 'string', enum: ['light', 'moderate', 'severe', 'catastrophic'] },
        image_observations: { type: 'string', description: 'What is visible in the photo(s), stated concretely.' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
      },
      required: ['primary_mode', 'secondary_modes', 'severity', 'image_observations', 'confidence'],
      additionalProperties: false
    },
    root_causes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cause: { type: 'string' },
          likelihood: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: { type: 'string' }
        },
        required: ['cause', 'likelihood', 'evidence'],
        additionalProperties: false
      }
    },
    apply_first: { type: 'string', description: 'The single change to make before anything else, with the concrete number.' },
    parameter_changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          parameter: { type: 'string', description: 'e.g. Vc, fz, fn, ap, ae, overhang' },
          current: { type: 'string' },
          recommended: { type: 'string' },
          change: { type: 'string', description: 'e.g. -15%' },
          reason: { type: 'string' }
        },
        required: ['parameter', 'current', 'recommended', 'change', 'reason'],
        additionalProperties: false
      }
    },
    coolant: {
      type: 'object',
      properties: {
        verdict: { type: 'string', description: 'ok | change — one word plus a short clause' },
        recommendation: { type: 'string' }
      },
      required: ['verdict', 'recommendation'],
      additionalProperties: false
    },
    setup_rigidity: { type: 'array', items: { type: 'string' }, description: 'Overhang, clamping, holder, machine-condition actions. Empty if fine.' },
    grade_geometry: {
      type: 'object',
      properties: {
        verdict: { type: 'string' },
        recommendation: { type: 'string' }
      },
      required: ['verdict', 'recommendation'],
      additionalProperties: false
    },
    expected_result: { type: 'string', description: 'What should improve, quantified where possible.' },
    checks: { type: 'array', items: { type: 'string' }, description: 'What to verify or record on the next run to sharpen the next diagnosis.' }
  },
  required: ['summary', 'wear', 'root_causes', 'apply_first', 'parameter_changes', 'coolant', 'setup_rigidity', 'grade_geometry', 'expected_result', 'checks'],
  additionalProperties: false
};

function systemPrompt_() {
  return [
    'You are EDGE LAB, the insert-diagnostics engine of TOOLFLUX, a carbide cutting tool company in Hubli, India. You are an expert metal-cutting application engineer. You receive photographs of a used carbide insert plus the machining context, and you must identify the wear/failure mode, its root causes, and the corrective actions.',
    '',
    'METHOD',
    '- Read the photo(s) first: look at the flank, rake face, nose and edge line. Identify wear land, cratering, adhered material (BUE), chipping/frittering, notching at depth-of-cut line, comb (thermal) cracks, deformation/slumping, or gross fracture.',
    '- Cross-check the image against the process data: cutting speed vs material and grade, feed vs edge line quality, depth vs notch position, coolant vs thermal cracking, overhang and clamping vs chatter/chipping, achieved edge life vs what is normal.',
    '- Decide whether this edge died a NORMAL economic death (uniform flank wear at reasonable life) or a PREMATURE one. Say which.',
    '',
    'RULES',
    '- Metric units. Give concrete numbers, not just percentages: "Vc 180 → 150 m/min (-17%)".',
    '- Recommend the SMALLEST set of changes that fixes the dominant failure mode, and name exactly ONE change to apply first. Changing many things at once destroys the ability to learn.',
    '- Account for chip thinning on round, 45° and high-feed inserts when judging feed.',
    '- If the photo is blurry, dark or ambiguous: lower your confidence, say precisely what a better photo would show, and lean harder on the process data.',
    '- If inputs contradict each other or the photo, flag it in the summary.',
    '- Never push parameters beyond what the described machine/setup can safely hold. If rigidity data suggests a weak setup, fix the setup before raising parameters.',
    '- Some fields may be blank. Work with what you have; list the most valuable missing inputs under "checks".',
    '',
    'TOOLFLUX GRADES (use these names when a grade change is warranted; otherwise name the ISO application group):',
    '- TFX-P25 — ISO P, steels, AlTiN coating, general turning/milling of carbon & alloy steel',
    '- TFX-M35 — ISO M, stainless steels, TiSiN coating',
    '- TFX-K20 — ISO K, cast iron, TiCN coating',
    '- TFX-U15 — ISO N, aluminium and non-ferrous',
    '- TFX-S30 — ISO S, heat-resistant superalloys and titanium',
    '- TFX-H15 / TFX-H10 — CBN, hardened steel up to 60 HRC',
    '',
    'Fill every field of the required JSON schema. Keep prose tight and workshop-readable: the reader is a machine operator standing at the control.'
  ].join('\n');
}

function recordText_(record) {
  const L = [];
  function add(label, v) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return;
    L.push(label + ': ' + (Array.isArray(v) ? v.join(', ') : v));
  }
  L.push('=== MACHINING CONTEXT ===');
  add('Operator', record.operator);
  add('Machine', record.machine);
  add('Machine type', record.machineType);
  add('Operation', record.operation);
  add('Component / feature', record.component);
  L.push('');
  L.push('--- Workpiece material ---');
  add('Material', record.material);
  add('ISO group', record.isoGroup);
  add('Hardness', record.hardness);
  add('Material condition', record.materialCondition);
  L.push('');
  L.push('--- Tooling ---');
  add('Insert designation', record.insertDesig);
  add('Insert recognition (ISO 1832 parse)', record.insertParsed);
  add('Insert brand', record.brand);
  add('Insert grade', record.grade);
  add('Chipbreaker / geometry', record.chipbreaker);
  add('Cutter body / holder designation', record.cutterBody);
  add('Cutter diameter Dc (mm)', record.cutterDia);
  add('Effective teeth z', record.teeth);
  add('Tool overhang (mm)', record.overhang);
  add('Workholding', record.workholding);
  add('Setup / rigidity notes', record.holderNotes);
  L.push('');
  L.push('--- Present cutting parameters ---');
  add('Cutting speed Vc (m/min)', record.vc);
  add('Spindle speed n (rpm)', record.rpm);
  add('Feed fn (mm/rev)', record.feedPerRev);
  add('Feed fz (mm/tooth)', record.feedPerTooth);
  add('Table feed vf (mm/min)', record.feedRate);
  add('Depth of cut ap (mm)', record.ap);
  add('Width of cut ae (mm)', record.ae);
  add('Workpiece diameter (mm)', record.workDia);
  L.push('');
  L.push('--- Coolant ---');
  add('Coolant', record.coolantType);
  add('Concentration (%)', record.coolantConc);
  add('Pressure (bar)', record.coolantPressure);
  L.push('');
  L.push('--- Edge life & observed failure ---');
  add('Edge life achieved', record.edgeLife ? record.edgeLife + ' ' + (record.edgeLifeUnit || '') : '');
  add('Expected / previous life', record.expectedLife);
  add('Operator-observed failure signs', record.failureModes);
  add('When did it fail', record.failureTiming);
  add('Chip colour / form', record.chipNotes);
  add('Notes', record.notes);
  L.push('');
  L.push('Diagnose this insert. The attached photo(s) show the used edge.');
  return L.join('\n');
}

function callClaude_(record, images) {
  const apiKey = getSecret_('ANTHROPIC_API_KEY');
  const effort = (getSecret_('EDGELAB_EFFORT') || 'medium').toLowerCase();

  const content = images.map(function (img) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: img.mime || 'image/jpeg', data: img.data }
    };
  });
  content.push({ type: 'text', text: recordText_(record) });

  const body = {
    model: PRIMARY_MODEL,
    max_tokens: 16000,
    output_config: { effort: effort, format: { type: 'json_schema', schema: DIAG_SCHEMA } },
    fallbacks: [{ model: FALLBACK_MODEL }],
    system: systemPrompt_(),
    messages: [{ role: 'user', content: content }]
  };

  let resp = fetchClaude_(apiKey, body, true);

  // If the fallbacks beta is rejected for any reason, retry once without it.
  if (resp.getResponseCode() === 400 && resp.getContentText().indexOf('fallback') !== -1) {
    const noFb = JSON.parse(JSON.stringify(body));
    delete noFb.fallbacks;
    resp = fetchClaude_(apiKey, noFb, false);
  }

  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code !== 200) {
    let msg = 'API error ' + code;
    try { msg += ': ' + JSON.parse(text).error.message; } catch (_) {}
    throw new Error(msg);
  }

  const out = JSON.parse(text);
  if (out.stop_reason === 'refusal') {
    throw new Error('The model declined this request' + (out.stop_details && out.stop_details.explanation ? ': ' + out.stop_details.explanation : '.'));
  }
  if (out.stop_reason === 'max_tokens') {
    throw new Error('Response was truncated (max_tokens). Try again.');
  }

  let jsonText = '';
  (out.content || []).forEach(function (b) { if (b.type === 'text' && !jsonText) jsonText = b.text; });
  if (!jsonText) throw new Error('Empty response from model.');

  return { diagnosis: JSON.parse(jsonText), model: out.model || PRIMARY_MODEL };
}

function fetchClaude_(apiKey, body, withFallbackBeta) {
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };
  if (withFallbackBeta) headers['anthropic-beta'] = 'server-side-fallback-2026-06-01';
  return UrlFetchApp.fetch(ANTHROPIC_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
}

// ─── Storage ──────────────────────────────────────────────────────

function saveImage_(name, base64) {
  try {
    const folder = getFolder_();
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', name);
    const file = folder.createFile(blob);
    return file.getUrl();
  } catch (err) {
    Logger.log('saveImage failed: ' + err.message);
    return '';
  }
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(IMAGE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(IMAGE_FOLDER);
}

function logRun_(ss, runId, r, diag, model, imageUrls, errMsg) {
  const sheet = ss.getSheetByName('Diagnostics') || ss.insertSheet('Diagnostics');
  if (sheet.getLastRow() === 0) {
    const cols = ['Run ID', 'Date', 'Time', 'Operator', 'Machine', 'Operation',
      'Material', 'ISO', 'Hardness', 'Insert', 'Brand', 'Grade', 'Cutter body',
      'Vc (m/min)', 'RPM', 'fn (mm/rev)', 'fz (mm/t)', 'ap (mm)', 'ae (mm)',
      'Overhang (mm)', 'Coolant', 'Edge life', 'Observed failure',
      'AI: wear mode', 'AI: severity', 'AI: confidence', 'AI: apply first',
      'AI: summary', 'Model', 'Photos', 'Error', 'Full JSON'];
    sheet.appendRow(cols);
    sheet.getRange(1, 1, 1, cols.length)
      .setBackground(NAVY).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9);
    sheet.setFrozenRows(1);
  }
  const now = new Date();
  const w = diag ? diag.wear : null;
  sheet.appendRow([
    runId,
    Utilities.formatDate(now, 'Asia/Kolkata', 'dd MMM yyyy'),
    Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm'),
    r.operator || '', r.machine || '', r.operation || '',
    r.material || '', r.isoGroup || '', r.hardness || '',
    r.insertDesig || '', r.brand || '', r.grade || '', r.cutterBody || '',
    r.vc || '', r.rpm || '', r.feedPerRev || '', r.feedPerTooth || '',
    r.ap || '', r.ae || '', r.overhang || '',
    [r.coolantType, r.coolantConc ? r.coolantConc + '%' : '', r.coolantPressure ? r.coolantPressure + ' bar' : ''].filter(String).join(' / '),
    r.edgeLife ? r.edgeLife + ' ' + (r.edgeLifeUnit || '') : '',
    (r.failureModes || []).join(', '),
    w ? w.primary_mode : '', w ? w.severity : '', w ? w.confidence : '',
    diag ? diag.apply_first : '',
    diag ? diag.summary : '',
    model || '',
    imageUrls.filter(String).join('\n'),
    errMsg || '',
    diag ? JSON.stringify(diag).slice(0, 45000) : ''
  ]);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
