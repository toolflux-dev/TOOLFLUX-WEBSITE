/**
 * CONTRACT STRIKE — Google Apps Script backend
 * The referee of the game: pulls real KPIs from Zoho Books so business
 * milestones auto-verify, generates AI trivia via the Claude API, and
 * backs the game state up to a Sheet. All secrets stay in this script.
 *
 * SETUP (one-time, ~10 minutes) — full guide: CONTRACT-STRIKE-SETUP.md
 * ─────────────────────────────────────────────────────────────────────
 * 1. Create a Google Sheet named "TOOLFLUX — CONTRACT STRIKE".
 *    Copy its ID from the URL into SPREADSHEET_ID below.
 *
 * 2. Zoho self client (gives this script read access to Zoho Books):
 *      a. https://api-console.zoho.in → ADD CLIENT → Self Client → CREATE.
 *      b. Copy Client ID and Client Secret.
 *      c. In the "Generate Code" tab enter scope:
 *           ZohoBooks.invoices.READ,ZohoBooks.contacts.READ
 *         duration 10 minutes → CREATE → copy the code.
 *      d. Run this in a terminal (or Postman) WITHIN 10 minutes:
 *           curl -X POST "https://accounts.zoho.in/oauth/v2/token" \
 *             -d "grant_type=authorization_code" \
 *             -d "client_id=YOUR_CLIENT_ID" \
 *             -d "client_secret=YOUR_CLIENT_SECRET" \
 *             -d "code=PASTED_CODE"
 *         → copy the "refresh_token" from the response.
 *
 * 3. script.google.com → New Project → paste this file → Save.
 *    Project Settings → Script Properties → add:
 *      ANTHROPIC_API_KEY    sk-ant-…            (for AI trivia)
 *      ZOHO_CLIENT_ID       from step 2b
 *      ZOHO_CLIENT_SECRET   from step 2b
 *      ZOHO_REFRESH_TOKEN   from step 2d
 *      ZOHO_ORG_ID          60021669308
 *
 * 4. Deploy → New deployment → Web app
 *      Execute as: Me  |  Who has access: Anyone
 *    → copy the /exec URL into the game's SETUP tab → TEST → SYNC.
 * ─────────────────────────────────────────────────────────────────────
 */

const SPREADSHEET_ID = '144V0sjE2pi1LGSdUKtDqpq0K8eT0ivbSqaULSRqP5rg';

const ZOHO_TOKEN_URL = 'https://accounts.zoho.in/oauth/v2/token';
const ZOHO_API       = 'https://www.zohoapis.in/books/v3';
const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages';
const PRIMARY_MODEL  = 'claude-fable-5';
const FALLBACK_MODEL = 'claude-opus-4-8';
const QUIET_DAYS     = 45;   // top account with no invoice for this long = "gone quiet"

function prop_(k){ return PropertiesService.getScriptProperties().getProperty(k) || ''; }

// ─── Entry points ─────────────────────────────────────────────────

function doGet(e) {
  const action = (e.parameter.action || '').toLowerCase();
  if (action === 'ping') {
    return json_({ ok: true,
      hasKey:  !!prop_('ANTHROPIC_API_KEY'),
      hasZoho: !!(prop_('ZOHO_CLIENT_ID') && prop_('ZOHO_CLIENT_SECRET') && prop_('ZOHO_REFRESH_TOKEN') && prop_('ZOHO_ORG_ID')) });
  }
  if (action === 'restore') {
    try {
      const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Saves');
      if (!sheet || sheet.getLastRow() < 2) return json_({ ok: false, error: 'No backup found.' });
      const last = sheet.getRange(sheet.getLastRow(), 2).getValue();
      return json_({ ok: true, state: JSON.parse(last) });
    } catch (err) { return json_({ ok: false, error: err.message }); }
  }
  return json_({ ok: false, error: 'Unknown action' });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'sync')   return json_(handleSync_(data));
    if (data.action === 'trivia') return json_(handleTrivia_(data));
    if (data.action === 'backup') return json_(handleBackup_(data));
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    return json_({ ok: false, error: 'Bad request: ' + err.message });
  }
}

// ─── Zoho auth ────────────────────────────────────────────────────

function zohoToken_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('zoho_at');
  if (hit) return hit;
  const resp = UrlFetchApp.fetch(ZOHO_TOKEN_URL, {
    method: 'post',
    payload: {
      grant_type: 'refresh_token',
      client_id: prop_('ZOHO_CLIENT_ID'),
      client_secret: prop_('ZOHO_CLIENT_SECRET'),
      refresh_token: prop_('ZOHO_REFRESH_TOKEN')
    },
    muteHttpExceptions: true
  });
  const j = JSON.parse(resp.getContentText());
  if (!j.access_token) throw new Error('Zoho auth failed: ' + resp.getContentText().slice(0, 200));
  cache.put('zoho_at', j.access_token, 3000); // ~50 min
  return j.access_token;
}

function zohoGet_(path, params) {
  const org = prop_('ZOHO_ORG_ID');
  let qs = 'organization_id=' + org;
  for (const k in (params || {})) qs += '&' + k + '=' + encodeURIComponent(params[k]);
  const resp = UrlFetchApp.fetch(ZOHO_API + path + '?' + qs, {
    headers: { Authorization: 'Zoho-oauthtoken ' + zohoToken_() },
    muteHttpExceptions: true
  });
  const j = JSON.parse(resp.getContentText());
  if (j.code !== 0) throw new Error('Zoho API ' + path + ': ' + (j.message || resp.getResponseCode()));
  return j;
}

// ─── Sync: build the KPI packet ───────────────────────────────────

function handleSync_(data) {
  if (!prop_('ZOHO_REFRESH_TOKEN')) return { ok: false, error: 'Zoho not configured (Script Properties).' };
  try {
    const now = new Date();
    const tz = 'Asia/Kolkata';
    const fmt = d => Utilities.formatDate(d, tz, 'yyyy-MM-dd');

    // 13 monthly revenue totals (incl. current month, last element)
    const months = [];
    for (let i = 12; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end   = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const r = zohoGet_('/invoices', {
        date_start: fmt(start), date_end: fmt(end),
        response_option: 3, per_page: 1
      });
      const pc = r.page_context || {};
      months.push({
        m: Utilities.formatDate(start, tz, 'yyyy-MM'),
        revenue: (pc.sum_columns && pc.sum_columns.total) || 0,
        count: pc.total || 0
      });
    }
    const cur = months[months.length - 1];
    const curMonth = {
      m: cur.m, revenue: cur.revenue, count: cur.count,
      dayOfMonth: now.getDate(),
      daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    };

    // Receivables: total + count + top overdue invoices
    const unpaid = zohoGet_('/invoices', { status: 'unpaid', response_option: 3, per_page: 1 });
    const overdue = zohoGet_('/invoices', { status: 'overdue', response_option: 1, per_page: 200, sort_column: 'balance' });
    const invs = (overdue.invoices || []).sort((a, b) => b.balance - a.balance);
    const topOverdue = invs.slice(0, 10).map(i => ({
      customer: i.customer_name, amount: i.balance,
      days: i.due_date ? Math.max(Math.floor((now - new Date(i.due_date)) / 864e5), 0) : null,
      invno: i.invoice_number
    }));
    const receivables = {
      total: (unpaid.page_context && unpaid.page_context.sum_columns && unpaid.page_context.sum_columns.balance) || 0,
      overdueCount: (overdue.page_context && overdue.page_context.total) || invs.length,
      topOverdue: topOverdue
    };

    // Recent invoices (last 180 days) → last-invoice-per-customer + quiet detection
    const since = new Date(now.getTime() - 180 * 864e5);
    const lastByCustomer = {};
    for (let page = 1; page <= 3; page++) {
      const r = zohoGet_('/invoices', { date_start: fmt(since), per_page: 200, page: page, sort_column: 'date' });
      (r.invoices || []).forEach(i => {
        if (i.status === 'void') return;
        const c = i.customer_name;
        if (!lastByCustomer[c] || i.date > lastByCustomer[c].last) lastByCustomer[c] = { last: i.date, total: 0 };
        lastByCustomer[c].total += i.total;
      });
      if (!(r.page_context && r.page_context.has_more_page)) break;
    }
    const quietCut = fmt(new Date(now.getTime() - QUIET_DAYS * 864e5));
    const quiet = Object.keys(lastByCustomer)
      .filter(c => lastByCustomer[c].last < quietCut && lastByCustomer[c].total > 30000)
      .sort((a, b) => lastByCustomer[b].total - lastByCustomer[a].total)
      .slice(0, 5)
      .map(c => ({ name: c, lastDate: lastByCustomer[c].last, sixMoTotal: Math.round(lastByCustomer[c].total) }));

    // New customers: contacts created within the season
    const seasonStart = (data.season && data.season.start) || fmt(new Date(now.getFullYear(), now.getMonth() - 2, 1));
    let newCustomers = [];
    try {
      const cr = zohoGet_('/contacts', { contact_type: 'customer', per_page: 200, sort_column: 'created_time' });
      newCustomers = (cr.contacts || [])
        .filter(c => (c.created_time || '').slice(0, 10) >= seasonStart)
        .map(c => ({ name: c.contact_name, firstDate: (c.created_time || '').slice(0, 10) }));
    } catch (err) { Logger.log('contacts pull failed: ' + err.message); }

    // Heist targets: does any invoice exist for a customer matching the name?
    const targets = {};
    for (const id in (data.targets || {})) {
      const name = data.targets[id];
      let matched = false, firstInvoice = null;
      try {
        const r = zohoGet_('/invoices', { customer_name_contains: name, per_page: 1, sort_column: 'date' });
        if (r.invoices && r.invoices.length) { matched = true; firstInvoice = r.invoices[0].date; }
      } catch (err) { Logger.log('target check "' + name + '": ' + err.message); }
      targets[id] = { name: name, matched: matched, firstInvoice: firstInvoice };
    }

    const kpi = { months: months, curMonth: curMonth, receivables: receivables,
                  quiet: quiet, newCustomers: newCustomers, targets: targets };
    logKpi_(kpi);
    return { ok: true, kpi: kpi };
  } catch (err) {
    Logger.log('sync failed: ' + err.message);
    return { ok: false, error: err.message };
  }
}

// ─── AI trivia ────────────────────────────────────────────────────

const TRIVIA_SCHEMA = {
  type: 'object',
  properties: {
    scenario: { type: 'string', description: 'The question. For insert kind: a concrete machining situation (material, operation, condition). 2-4 lines, workshop-real.' },
    options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
    correct: { type: 'integer', minimum: 0, maximum: 3 },
    coaching: { type: 'string', description: 'Teach: WHY the right answer wins and why the tempting wrong ones fail. 2-4 sentences, may use <b> tags. This is shown after answering, right or wrong.' }
  },
  required: ['scenario', 'options', 'correct', 'coaching'],
  additionalProperties: false
};

function triviaSystem_() {
  return [
    'You write one multiple-choice question for CONTRACT STRIKE, the training game of the owner of TOOLFLUX (carbide cutting tools, Hubli, India). He sells inserts, end mills, drills, U-Drills and holders to machine shops and OEMs, and must be the sharpest application engineer in the room.',
    '',
    'KIND "insert": a realistic machining scenario (workpiece material + operation + constraint) where he must pick the correct insert geometry and/or TFX grade. Make wrong options tempting-but-flawed, not silly.',
    'KIND "trade": metal-cutting theory and trade knowledge — ISO 1832/513 codes, coatings, wear modes, cutting-data relationships, tool economics, chip thinning, drilling/milling practice.',
    '',
    'TOOLFLUX GRADES (use these names): TFX-P25 (ISO P steel, AlTiN) · TFX-M35 (ISO M stainless, TiSiN) · TFX-K20 (ISO K cast iron, TiCN) · TFX-U15 (ISO N aluminium) · TFX-S30 (ISO S superalloys/Ti) · TFX-H15/H10 (CBN, to 60 HRC).',
    '',
    'RULES: metric units; India workshop context; exactly one defensible correct answer; the coaching must teach a transferable principle, not just restate the answer. Vary topics — avoid repeating the recent topics listed by the user. Difficulty: solid mid-professional.'
  ].join('\n');
}

function handleTrivia_(data) {
  const apiKey = prop_('ANTHROPIC_API_KEY');
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY not set.' };
  const kind = data.kind === 'trade' ? 'trade' : 'insert';
  const body = {
    model: PRIMARY_MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: TRIVIA_SCHEMA } },
    fallbacks: [{ model: FALLBACK_MODEL }],
    system: triviaSystem_(),
    messages: [{ role: 'user', content: 'KIND: ' + kind + '\nRecent topics to avoid: ' + JSON.stringify(data.recent || []) + '\nGenerate one question.' }]
  };
  let resp = fetchClaude_(apiKey, body, true);
  if (resp.getResponseCode() === 400 && resp.getContentText().indexOf('fallback') !== -1) {
    const noFb = JSON.parse(JSON.stringify(body));
    delete noFb.fallbacks;
    resp = fetchClaude_(apiKey, noFb, false);
  }
  const code = resp.getResponseCode();
  if (code !== 200) {
    let msg = 'API error ' + code;
    try { msg += ': ' + JSON.parse(resp.getContentText()).error.message; } catch (_) {}
    return { ok: false, error: msg };
  }
  const out = JSON.parse(resp.getContentText());
  if (out.stop_reason === 'refusal') return { ok: false, error: 'Model declined.' };
  let txt = '';
  (out.content || []).forEach(function (b) { if (b.type === 'text' && !txt) txt = b.text; });
  if (!txt) return { ok: false, error: 'Empty response.' };
  return { ok: true, question: JSON.parse(txt), model: out.model || PRIMARY_MODEL };
}

function fetchClaude_(apiKey, body, withFallbackBeta) {
  const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  if (withFallbackBeta) headers['anthropic-beta'] = 'server-side-fallback-2026-06-01';
  return UrlFetchApp.fetch(ANTHROPIC_URL, {
    method: 'post', contentType: 'application/json', headers: headers,
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
}

// ─── Storage ──────────────────────────────────────────────────────

function handleBackup_(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Saves') || ss.insertSheet('Saves');
    if (sheet.getLastRow() === 0) sheet.appendRow(['Saved at', 'State JSON']);
    sheet.appendRow([new Date(), JSON.stringify(data.state).slice(0, 49000)]);
    if (sheet.getLastRow() > 31) sheet.deleteRows(2, sheet.getLastRow() - 31); // keep last 30
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

function logKpi_(kpi) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('KPI Log') || ss.insertSheet('KPI Log');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Date', 'Month revenue', 'Month invoices', 'Receivables', 'Overdue count', 'New customers', 'Quiet accounts', 'Full JSON']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([
      new Date(), kpi.curMonth.revenue, kpi.curMonth.count,
      kpi.receivables.total, kpi.receivables.overdueCount,
      (kpi.newCustomers || []).length,
      (kpi.quiet || []).map(function (q) { return q.name; }).join(', '),
      JSON.stringify(kpi).slice(0, 45000)
    ]);
  } catch (err) { Logger.log('logKpi failed: ' + err.message); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
