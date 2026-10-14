// TOOLFLUX grades shown by the customer insert finder (toolflux.co.in/request).
// Source: TOOLFLUX_AI_BRIEFING.md "4-TYPE RANGE" (13 Oct 2026); table confirmed by the owner
// 14 Oct 2026. Batch work = TX line, Continuous production = TFX line. Edit here only.
// Customer text never says premium or economy. TX coating is "not specified" to customers.
window.TFX_GRADES = {
  grades: {
    'TFX-TUV30':    { iso: ['M', 'P', 'K'], coating: 'PVD' },
    'TX-TPV20':     { iso: ['P', 'M'] },
    'TFX-TKC20-CX': { iso: ['K', 'H'], coating: 'CVD', minRadius: 0.8 },
    'TX-TKC15-CX':  { iso: ['K'], minRadius: 0.8 },
    'TFX-TNV15':    { iso: ['N'], coating: 'PVD', note: 'VCGT inserts' },
    'TX-TNV10':     { iso: ['N'], note: 'VCGT inserts' },
    'TFX-MUV20':    { iso: ['M', 'P', 'K'], coating: 'PVD' },
    'TX-MPV20':     { iso: ['P', 'M'] },
    'TFX-MGV15':    { iso: ['K', 'H'], coating: 'PVD', note: 'AOMT123604' },
    'TX-MGC10':     { iso: ['K'] },
    'TFX-GUV25':    { iso: ['M', 'P'], coating: 'PVD' },
    'TX-GUV20':     { iso: ['P', 'K'] },
    'TFX-DUV25':    { iso: ['M', 'P'], coating: 'PVD' },
    'TX-DUV20':     { iso: ['P', 'K'] },
  },
  // [metal family ISO][operation] = { batch, continuous }; null = none in the range.
  table: {
    P: { turning: { batch: 'TX-TPV20', continuous: 'TFX-TUV30' }, milling: { batch: 'TX-MPV20', continuous: 'TFX-MUV20' },
      grooving: { batch: 'TX-GUV20', continuous: 'TFX-GUV25' }, drilling: { batch: 'TX-DUV20', continuous: 'TFX-DUV25' } },
    M: { turning: { batch: 'TX-TPV20', continuous: 'TFX-TUV30' }, milling: { batch: 'TX-MPV20', continuous: 'TFX-MUV20' },
      grooving: { batch: null, continuous: 'TFX-GUV25' }, drilling: { batch: null, continuous: 'TFX-DUV25' } },
    K: { turning: { batch: 'TX-TKC15-CX', continuous: 'TFX-TKC20-CX' }, milling: { batch: 'TX-MGC10', continuous: 'TFX-MGV15' },
      grooving: { batch: 'TX-GUV20', continuous: null }, drilling: { batch: 'TX-DUV20', continuous: null } },
    H: { turning: { batch: null, continuous: 'TFX-TKC20-CX' }, milling: { batch: null, continuous: 'TFX-MGV15' },
      grooving: { batch: null, continuous: null }, drilling: { batch: null, continuous: null } },
    N: { turning: { batch: 'TX-TNV10', continuous: 'TFX-TNV15' }, milling: { batch: null, continuous: null },
      grooving: { batch: null, continuous: null }, drilling: { batch: null, continuous: null } },
    S: { turning: { batch: null, continuous: null }, milling: { batch: null, continuous: null },
      grooving: { batch: null, continuous: null }, drilling: { batch: null, continuous: null } },
  },
  // Finishing uses small corner radii: grades that need r >= 0.8 step aside. Cast iron falls back
  // to TFX-TUV30 (K secondary); hardened has no small-radius grade, so it gets "we'll advise".
  finishing: { K: { 'TFX-TKC20-CX': 'TFX-TUV30', 'TX-TKC15-CX': null }, H: { 'TFX-TKC20-CX': null } },
  copy: {
    batch: { label: 'Batch work', text: 'Made for job work and short runs. A sharp, consistent edge at a lower price per insert: you pay for exactly the life your batch needs.' },
    continuous: { label: 'Continuous production', text: 'Made for long runs. More parts per edge and fewer stops, which brings down your cost per part. We prove it on a trial.' },
  },
};

/** The grade cards for a metal family, operation and duty: [{ line, code, ... }]. */
window.TFX_GRADES.pick = function pick(iso, operation, duty) {
  const T = window.TFX_GRADES;
  const row = (T.table[iso] || {})[operation] || {};
  const out = [];
  for (const line of ['batch', 'continuous']) {
    let code = row[line];
    const swap = duty === 'finishing' ? T.finishing[iso] || {} : {};
    if (code && Object.prototype.hasOwnProperty.call(swap, code)) code = swap[code];
    if (code) out.push({ line, code, ...T.grades[code], ...T.copy[line] });
  }
  return out;
};
