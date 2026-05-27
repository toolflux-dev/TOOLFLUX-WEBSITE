/*
 * TOOLFLUX PATHPRO — calculation engine
 * Modeled to the judgement of a senior CNC machinist (25+ yrs).
 * All tables in IMPERIAL (SFM, in/rev, in/tooth, inches).
 *
 * Sources synthesized from:  Machinery's Handbook (30th),
 *   Sandvik Coromant tech guides, Kennametal cutting data,
 *   Iscar feeds & speeds, OSG drill catalog, Haas tooling docs.
 * Values are CONSERVATIVE midpoints suitable for a production shop.
 */

// ─────────────────────────────────────────────────────────────
// Workpiece materials.  sfm = { hss, carbide, coated } in SFM.
// kc = specific cutting energy (hp · min / in^3) — used for HP est.
// ipr_factor = drill feed scaling vs diameter (multiplied later)
// ipt_factor = mill chip-load scaling
// ─────────────────────────────────────────────────────────────
const MATERIALS = [
  { id: 'al6061', name: 'Aluminum 6061-T6',     group: 'Non-ferrous',
    sfm: { hss: 350, carbide: 1200, coated: 1500 }, kc: 0.30, ipr: 1.10, ipt: 1.10, note: 'Use polished flutes; G-Wizard-style high SFM tolerated.' },
  { id: 'al7075', name: 'Aluminum 7075-T6',     group: 'Non-ferrous',
    sfm: { hss: 300, carbide: 1000, coated: 1300 }, kc: 0.35, ipr: 1.05, ipt: 1.05, note: 'Harder than 6061 — back off ~15% for finish ops.' },
  { id: 'brass',  name: 'Brass 360 (free-cut)', group: 'Non-ferrous',
    sfm: { hss: 250, carbide: 600,  coated: 700  }, kc: 0.40, ipr: 1.00, ipt: 1.00, note: 'Use zero-rake or neg geometry — chip-grabs on positive.' },
  { id: 'copper', name: 'Copper C110',          group: 'Non-ferrous',
    sfm: { hss: 200, carbide: 500,  coated: 600  }, kc: 0.55, ipr: 0.90, ipt: 0.90, note: 'Gummy. Flood coolant; sharp positive geometry.' },
  { id: 'mild',   name: 'Mild Steel 1018',      group: 'Steel',
    sfm: { hss: 90,  carbide: 350,  coated: 500  }, kc: 1.00, ipr: 0.85, ipt: 0.95, note: 'Workhorse setting. Honor the BUE — no dwell.' },
  { id: 'medc',   name: 'Medium C-Steel 1045',  group: 'Steel',
    sfm: { hss: 70,  carbide: 300,  coated: 450  }, kc: 1.10, ipr: 0.80, ipt: 0.90, note: 'Tougher chips — short chipbreaker geometry preferred.' },
  { id: '4140',   name: 'Alloy Steel 4140 HT',  group: 'Steel',
    sfm: { hss: 50,  carbide: 220,  coated: 350  }, kc: 1.30, ipr: 0.70, ipt: 0.80, note: 'Heat-treated 28–32 HRC.  Above 35 HRC, derate 30%.' },
  { id: '304',    name: 'Stainless 304',        group: 'Stainless',
    sfm: { hss: 55,  carbide: 250,  coated: 350  }, kc: 1.30, ipr: 0.70, ipt: 0.75, note: 'Work-hardens — never dwell, never light cut. Feed firmly.' },
  { id: '316',    name: 'Stainless 316',        group: 'Stainless',
    sfm: { hss: 45,  carbide: 200,  coated: 300  }, kc: 1.40, ipr: 0.65, ipt: 0.70, note: 'Gummier than 304. Through-coolant strongly advised.' },
  { id: '174ph',  name: 'Stainless 17-4 PH H900', group: 'Stainless',
    sfm: { hss: 40,  carbide: 180,  coated: 280  }, kc: 1.55, ipr: 0.60, ipt: 0.65, note: 'Aged condition is abrasive — use TiAlN; expect short edge life.' },
  { id: 'cigray', name: 'Cast Iron — Gray',     group: 'Cast Iron',
    sfm: { hss: 80,  carbide: 350,  coated: 450  }, kc: 0.80, ipr: 0.80, ipt: 0.85, note: 'Run DRY. Coolant cracks the casting skin and inserts.' },
  { id: 'ciduc',  name: 'Cast Iron — Ductile',  group: 'Cast Iron',
    sfm: { hss: 60,  carbide: 280,  coated: 400  }, kc: 0.95, ipr: 0.75, ipt: 0.80, note: 'Tougher than gray; treat closer to mild steel.' },
  { id: 'tool',   name: 'Tool Steel D2 / A2',   group: 'Tool Steel',
    sfm: { hss: 40,  carbide: 180,  coated: 260  }, kc: 1.50, ipr: 0.60, ipt: 0.70, note: 'Annealed only. If hardened ≥55 HRC switch to CBN.' },
  { id: 'ti64',   name: 'Titanium Ti-6Al-4V',   group: 'Exotic',
    sfm: { hss: 30,  carbide: 140,  coated: 200  }, kc: 1.50, ipr: 0.55, ipt: 0.55, note: 'Galls and ignites. High-pressure coolant + never dwell.' },
  { id: 'inco',   name: 'Inconel 718',          group: 'Exotic',
    sfm: { hss: 18,  carbide: 80,   coated: 130  }, kc: 2.10, ipr: 0.45, ipt: 0.45, note: 'Trochoidal milling, full DOC, light WOC.  Edge life is currency.' },
  { id: 'plast',  name: 'Plastic (Delrin/UHMW)',group: 'Plastic',
    sfm: { hss: 400, carbide: 900,  coated: 900  }, kc: 0.15, ipr: 1.30, ipt: 1.30, note: 'Razor edges only.  Air blast, no flood.' },
];

// ─────────────────────────────────────────────────────────────
// Tool / insert materials
// ─────────────────────────────────────────────────────────────
const TOOL_MATERIALS = [
  { id: 'hss',     name: 'HSS',                bucket: 'hss',     blurb: 'M2/M7 high-speed steel. Forgiving but slow.' },
  { id: 'cohss',   name: 'Cobalt HSS (M42)',   bucket: 'hss',     mult: 1.20, blurb: '+20% over plain HSS. Good in stainless.' },
  { id: 'carb',    name: 'Solid Carbide',      bucket: 'carbide', blurb: 'Rigid setups only. Brittle in interrupted cuts.' },
  { id: 'tin',     name: 'Carbide • TiN',      bucket: 'coated',  mult: 0.85, blurb: 'Yellow coating. General-purpose, ductile materials.' },
  { id: 'tialn',   name: 'Carbide • TiAlN',    bucket: 'coated',  mult: 1.00, blurb: 'Violet coating. Hot-hardness — best in steels.' },
  { id: 'altin',   name: 'Carbide • AlTiN',    bucket: 'coated',  mult: 1.10, blurb: 'Above 800°C operation. Stainless & superalloy.' },
  { id: 'dlc',     name: 'Carbide • DLC',      bucket: 'coated',  mult: 0.90, blurb: 'Diamond-like carbon — non-ferrous & plastics only.' },
  { id: 'cbn',     name: 'CBN',                bucket: 'coated',  mult: 1.50, blurb: 'Hardened steel ≥45 HRC. Negative geometry, no coolant.' },
];

// ─────────────────────────────────────────────────────────────
// Milling insert geometries — lead angle, chip thinning, notes.
// kapr = approach (lead) angle in degrees from the work surface.
// Chip-thinning factor = 1 / sin(kapr).
// ─────────────────────────────────────────────────────────────
const INSERT_GEOMETRIES = [
  { id: 'apkt',  code: 'APKT / APMT', shape: 'Parallelogram, 90°', kapr: 90, ctf: 1.00,
    use: '90° shoulder mill.  True square shoulders, modest DOC.',
    typical: 'Pockets, walls, slots. Most common shop insert.' },
  { id: 'sekn',  code: 'SEKN / SDKN', shape: 'Square, 75°',        kapr: 75, ctf: 1.04,
    use: '75° face mill.  Balanced radial/axial force.',
    typical: 'Face milling cast iron, flycutting steel plate.' },
  { id: 'rckt',  code: 'RC.. / RPMT', shape: 'Round',              kapr: 45, ctf: 1.41,
    use: 'Round insert. Strong edge; chip-thinning doubles effective feed.',
    typical: 'Roughing, copy milling, hardened-steel pocketing.' },
  { id: 'octn',  code: 'ONHU / ONMU', shape: 'Octagonal, 45°',     kapr: 45, ctf: 1.41,
    use: '45° face mill.  8 edges/insert. Forgiving.',
    typical: 'Heavy face mill on steel — workhorse productivity geom.' },
  { id: 'tnmg',  code: 'TNMG (mill)', shape: 'Triangle, 90°',      kapr: 90, ctf: 1.00,
    use: 'Triangular — 3 edges, sharper corners.',
    typical: 'Lower-power machines; thin walls; finishing.' },
  { id: 'hfeed', name: 'High Feed',   code: 'XOMX / SOMX', shape: 'High-feed, 10–17°', kapr: 12, ctf: 4.80,
    use: 'High-feed mill. Tiny lead angle puts force into spindle.',
    typical: 'Heavy DOC=light, IPT very high.  Mass-removal champion.' },
];

const PI = Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r = (v, d = 0) => {
  if (!isFinite(v)) return '—';
  const f = Math.pow(10, d);
  return (Math.round(v * f) / f).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
};

// ─────────────────────────────────────────────────────────────
// Generic helpers
// ─────────────────────────────────────────────────────────────
function pickSFM(mat, tool) {
  const base = mat.sfm[tool.bucket];
  return base * (tool.mult || 1);
}
function rpmFromSFM(sfm, dia_in) {
  return (sfm * 12) / (PI * dia_in);
}

// ─────────────────────────────────────────────────────────────
// SAFETY presets — applied as global SFM × feed multipliers.
// ─────────────────────────────────────────────────────────────
const SPEED_MODES = {
  safe:     { sfm: 0.85, feed: 0.92, label: 'Safe',     blurb: 'Conservative — long tool life, forgiving setups.' },
  nominal:  { sfm: 1.00, feed: 1.00, label: 'Nominal',  blurb: 'Handbook midpoints — rigid setups, fresh tools.' },
  spirited: { sfm: 1.15, feed: 1.08, label: 'Spirited', blurb: 'Production push — modern machine, sharp tool, supervision.' },
};
function _mode(m) { return SPEED_MODES[m] || SPEED_MODES.safe; }

// ─────────────────────────────────────────────────────────────
// DRILLING
// ─────────────────────────────────────────────────────────────
function calcDrill({ dia, overhang, workId, toolId, coolant, depth, speedMode = 'safe' }) {
  const mat = MATERIALS.find(m => m.id === workId);
  const tool = TOOL_MATERIALS.find(t => t.id === toolId);
  if (!mat || !tool || !(dia > 0)) return null;

  const sm = _mode(speedMode);
  let sfm = pickSFM(mat, tool) * sm.sfm;

  const LD_o = overhang / dia;
  const LD_h = depth / dia;
  const LD = Math.max(LD_o, LD_h);
  let ldPenalty = 1;
  if (LD > 8) ldPenalty = 0.55;
  else if (LD > 5) ldPenalty = 0.70;
  else if (LD > 3) ldPenalty = 0.85;
  sfm *= ldPenalty;

  let coolantBonus = 1;
  if (coolant && LD_h > 3) coolantBonus = 1.20;
  else if (coolant) coolantBonus = 1.08;
  sfm *= coolantBonus;

  const rpm = rpmFromSFM(sfm, dia);

  let iprBase;
  if (dia <= 0.125) iprBase = 0.002 + dia * 0.02;
  else if (dia <= 0.5) iprBase = 0.004 + dia * 0.016;
  else if (dia <= 1.0) iprBase = 0.008 + dia * 0.010;
  else                 iprBase = 0.014 + dia * 0.004;
  let ipr = iprBase * mat.ipr * sm.feed;
  if (LD > 5) ipr *= 0.75;
  else if (LD > 3) ipr *= 0.88;
  if (tool.bucket === 'hss') ipr *= 0.85;

  const feed_ipm = rpm * ipr;

  const area = PI * Math.pow(dia / 2, 2);
  const mrr = area * feed_ipm;
  const hp = mrr * mat.kc;
  const torque_lbft = (hp * 5252) / Math.max(rpm, 1);

  const advice = [];
  if (LD_h > 3) advice.push(coolant
    ? 'Peck cycle G73 (chip-break) advised. Through-coolant clearing fines effectively.'
    : 'Deep-hole peck G83 mandatory: full retracts every 1×D. Strongly consider through-coolant.');
  if (LD_o > 4) advice.push('Excessive stick-out — shorten holder or expect chatter & walk.');
  if (mat.group === 'Stainless') advice.push('Feed firmly through entry. Never dwell at break-through.');
  if (mat.group === 'Cast Iron' && tool.bucket !== 'hss') advice.push('Run dry. Air-blast OK for chip clearing.');
  if (dia < 0.125 && rpm > 8000) advice.push('Micro-drill: verify spindle TIR < 0.0002" — runout dominates tool life.');

  return {
    sfm, rpm, ipr, feed_ipm, mrr, hp, torque_lbft, LD, ldPenalty, coolantBonus,
    advice, mat, tool, speedMode, modeInfo: sm,
  };
}

// ─────────────────────────────────────────────────────────────
// MILLING
// ─────────────────────────────────────────────────────────────
function calcMill({ dia, overhang, teeth, ap, ae, insertId, workId, toolId, coolant, speedMode = 'safe', customGeom }) {
  const mat = MATERIALS.find(m => m.id === workId);
  const tool = TOOL_MATERIALS.find(t => t.id === toolId);
  let ins = customGeom && customGeom.kapr != null && customGeom.ctf != null
    ? { id: 'custom', code: customGeom.code || customGeom.family || 'CUSTOM',
        shape: customGeom.shape || '', kapr: customGeom.kapr, ctf: customGeom.ctf,
        use: customGeom.desc || '', typical: customGeom.input || '' }
    : INSERT_GEOMETRIES.find(i => i.id === insertId);
  if (!mat || !tool || !ins || !(dia > 0) || !(teeth > 0)) return null;

  const sm = _mode(speedMode);
  let sfm = pickSFM(mat, tool) * sm.sfm;

  const LD = overhang / dia;
  let ldPenalty = 1;
  if (LD > 5) ldPenalty = 0.55;
  else if (LD > 4) ldPenalty = 0.70;
  else if (LD > 3) ldPenalty = 0.85;
  sfm *= ldPenalty;

  if (coolant) sfm *= 1.05;

  const rpm = rpmFromSFM(sfm, dia);

  let iptBase;
  if (dia <= 0.25)  iptBase = 0.0015 + dia * 0.005;
  else if (dia <= 0.5) iptBase = 0.003 + dia * 0.004;
  else if (dia <= 1.0) iptBase = 0.005 + dia * 0.003;
  else if (dia <= 2.0) iptBase = 0.007 + dia * 0.0025;
  else                 iptBase = 0.010 + dia * 0.0015;

  let ipt = iptBase * mat.ipt * sm.feed;

  let ctf_radial = 1;
  if (ae > 0 && ae < dia / 2) ctf_radial = Math.sqrt(dia / (2 * ae));
  const ctf_lead = ins.ctf;
  const ctf = ctf_radial * ctf_lead;
  const ipt_commanded = ipt * ctf;

  const feed_ipm = rpm * ipt_commanded * teeth;

  const mrr = ap * ae * feed_ipm;
  const hp = mrr * mat.kc;
  const torque_lbft = (hp * 5252) / Math.max(rpm, 1);

  const advice = [];
  if (ins.id === 'hfeed') advice.push('High-feed mill: keep ae ≤ 0.10×D and ap ≤ 0.04×D. Force is axial — easy on the spindle.');
  if (ins.id === 'rckt')  advice.push('Round insert: programmed DOC ≠ effective DOC. Reduce ap by ~25% near the corner radius.');
  if (ae >= dia * 0.7)    advice.push('Wide engagement (≥0.7×D). Consider trochoidal/dynamic toolpath — spreads heat, frees chips.');
  if (mat.group === 'Stainless' && tool.bucket !== 'coated') advice.push('Bare carbide in stainless = short life. TiAlN/AlTiN strongly preferred.');
  if (LD > 4) advice.push('Long stick-out: ramp angle ≤2° and back off SFM further if you hear chatter.');
  if (mat.id === 'inco') advice.push('Inconel 718: trochoidal, ae ≤ 0.10×D, ap = 1.5×D, climb only. Through-coolant non-negotiable.');

  return {
    sfm, rpm, ipt, ipt_commanded, ctf, feed_ipm, mrr, hp, torque_lbft,
    LD, ldPenalty, advice, mat, tool, ins, speedMode, modeInfo: sm,
  };
}

// ─────────────────────────────────────────────────────────────
// TURNING
// ─────────────────────────────────────────────────────────────
function calcTurn({ stockDia, doc, noseRad, op, workId, toolId, coolant, speedMode = 'safe' }) {
  const mat = MATERIALS.find(m => m.id === workId);
  const tool = TOOL_MATERIALS.find(t => t.id === toolId);
  if (!mat || !tool || !(stockDia > 0)) return null;

  const sm = _mode(speedMode);
  let sfm = pickSFM(mat, tool) * sm.sfm;
  if (op === 'finish')  sfm *= 1.15;
  if (op === 'profile') sfm *= 1.00;
  if (coolant) sfm *= 1.05;

  const rpm = rpmFromSFM(sfm, stockDia);

  let ipr;
  if (op === 'finish') {
    const ra_in = 32e-6;
    ipr = Math.sqrt(8 * ra_in * noseRad);
    ipr = clamp(ipr, 0.003, 0.012);
  } else if (op === 'rough') {
    ipr = clamp(noseRad * 0.5, 0.010, 0.025);
  } else {
    ipr = clamp(noseRad * 0.35, 0.006, 0.018);
  }
  ipr *= mat.ipr * sm.feed;

  const feed_ipm = rpm * ipr;
  const mrr = 12 * sfm * doc * ipr;
  const hp = mrr * mat.kc;
  const torque_lbft = (hp * 5252) / Math.max(rpm, 1);
  const cuttingForce_lbf = (hp * 33000) / (sfm || 1);

  const advice = [];
  if (doc > noseRad * 5) advice.push('Depth of cut > 5× nose radius — risk of insert chipping at entry. Ramp in.');
  if (op === 'finish' && doc < noseRad * 0.5) advice.push('Light finish pass below 0.5× nose radius — risk of rubbing; insert wears flat.');
  if (mat.group === 'Stainless') advice.push('Constant Surface Speed (G96) mandatory. Don\'t let RPM drop near centerline.');
  if (mat.group === 'Cast Iron') advice.push('Run dry. Negative-rake insert for skin pass; positive for finish.');
  if (mat.id === 'ti64') advice.push('Ti-6Al-4V: high-pressure coolant directed at the chip-tool interface. Never dwell.');

  return {
    sfm, rpm, ipr, feed_ipm, mrr, hp, torque_lbft, cuttingForce_lbf,
    advice, mat, tool, op, speedMode, modeInfo: sm,
  };
}

// expose to other scripts
Object.assign(window, {
  MATERIALS, TOOL_MATERIALS, INSERT_GEOMETRIES, SPEED_MODES,
  calcDrill, calcMill, calcTurn, fmt: r,
});
